// --- Registre des modules de page (mount/unmount à chaque navigation Barba) ---
const PageModules = (function () {
  const modules = {};
  const activeUnsubs = {};

  function register(namespace, mod) {
    modules[namespace] = mod;
  }

  function mount(namespace, container) {
    const mod = modules[namespace];
    if (!mod) return;
    activeUnsubs[namespace] = mod.mount(container) || [];
  }

  function unmount(namespace) {
    const unsubs = activeUnsubs[namespace] || [];
    unsubs.forEach((off) => off && off());
    activeUnsubs[namespace] = [];
    const mod = modules[namespace];
    if (mod && mod.unmount) mod.unmount();
  }

  return { register, mount, unmount };
})();

// ============================================================
// HOME (index.html) — sélection du participant
// ============================================================
PageModules.register("home", {
  mount(container) {
    document.body.classList.add("has-home-decor");

    const loaderEl = document.getElementById("page-loader");
    loaderEl.style.display = "flex";

    const loadStart = Date.now();
    const existingParticipant = getCookie("participant_id");

    const listEl = container.querySelector("#participants-list");
    const emptyEl = container.querySelector("#participants-empty");
    const selectionEl = container.querySelector("#profile-selection");
    const setupNoticeEl = container.querySelector("#setup-notice");
    const setupNoticeTextEl = container.querySelector("#setup-notice-text");

    let participantsLoaded = false;
    let gameStatusKnown = false;
    let setupStatusKnown = false;
    let currentSetupStatus = null;
    let redirecting = false;
    let latestButtons = [];
    let hasAnimatedParticipants = false;

    function animateParticipants() {
      if (hasAnimatedParticipants) return;
      if (latestButtons.length === 0) return;
      hasAnimatedParticipants = true;

      if (typeof gsap === "undefined") {
        gsap.set(latestButtons, { opacity: 1, scale: 1, y: 0, rotate: 0 }); // fallback sans lib
        return;
      }

      gsap.to(latestButtons, {
        opacity: 1,
        scale: 1,
        y: 0,
        rotate: 0,
        duration: 0.6,
        ease: "back.out(2.4)",
        stagger: 0.08,
      });
    }

    function reveal() {
      if (redirecting) return;
      if (!participantsLoaded || !gameStatusKnown || !setupStatusKnown) return;

      const notReady =
        currentSetupStatus &&
        !currentSetupStatus.hasStarted &&
        (currentSetupStatus.participantsCount === 0 ||
          currentSetupStatus.unassignedCount > 0 ||
          currentSetupStatus.criteriaCount === 0);

      if (notReady) {
        selectionEl.style.display = "none";
        setupNoticeEl.style.display = "flex";
        setupNoticeTextEl.textContent =
          currentSetupStatus.participantsCount === 0
            ? "Aucun participant n'a encore été ajouté."
            : currentSetupStatus.unassignedCount > 0
              ? "Les participants n'ont pas encore tous une date."
              : "Les critères de notation ne sont pas encore définis.";
      } else {
        selectionEl.style.display = "block";
        setupNoticeEl.style.display = "none";
      }

      withMinDelay(loadStart, 300, () => {
        AppBoot.ready(() => {
          loaderEl.style.display = "none";
          container.classList.add("is-ready");
          // L'animation ne démarre qu'une fois le loader retiré et la page révélée,
          // jamais pendant que le loader est encore par-dessus.
          if (!notReady) animateParticipants();
        });
      });
    }

    function renderParticipants(list) {
      listEl.innerHTML = "";
      latestButtons = [];

      if (!list || list.length === 0) {
        listEl.appendChild(emptyEl);
        return;
      }

      list.forEach((p) => {
        const btn = document.createElement("button");
        btn.className = "participant-btn";
        btn.appendChild(createAvatarElement(p, "md"));

        const nameSpan = document.createElement("span");
        nameSpan.textContent = p.name;
        btn.appendChild(nameSpan);

        btn.addEventListener("click", () => {
          setCookie("participant_id", p.id);
          barba.go("game.html");
        });
        listEl.appendChild(btn);
        latestButtons.push(btn);
      });

      // État de départ posé immédiatement (caché, décalé, tourné), mais l'animation
      // qui les amène à leur position finale n'est déclenchée que dans reveal().
      if (typeof gsap !== "undefined") {
        gsap.set(latestButtons, {
          opacity: 0,
          scale: 0.5,
          y: () => gsap.utils.random(-28, 28),
          rotate: () => gsap.utils.random(-16, 16),
        });
      }
    }

    const offParticipants = AppWS.on("participants", (data) => {
      participantsLoaded = true;
      renderParticipants(data.list);
      reveal();
    });

    const offSetupStatus = AppWS.on("setup:status", (data) => {
      setupStatusKnown = true;
      currentSetupStatus = data.status;
      reveal();
    });

    const offGameStatus = AppWS.on("game:status", (data) => {
      gameStatusKnown = true;
      if (data.complete) {
        redirecting = true;
        barba.go("results.html");
      } else if (existingParticipant) {
        redirecting = true;
        barba.go("game.html");
      } else {
        reveal();
      }
    });

    const offGameComplete = AppWS.on("game:complete", () => {
      redirecting = true;
      barba.go("results.html");
    });

    AppWS.send({ type: "participants:list" });
    AppWS.send({ type: "setup:status" });
    AppWS.send({ type: "game:status" });

    const cleanupDecor = () => document.body.classList.remove("has-home-decor");

    return [
      offParticipants,
      offSetupStatus,
      offGameStatus,
      offGameComplete,
      cleanupDecor,
    ];
  },
});

// ============================================================
// GAME (game.html) — notation du jour / message / calendrier
// ============================================================
PageModules.register("game", {
  mount(container) {
    const loaderEl = document.getElementById("page-loader");
    loaderEl.style.display = "flex";

    const myParticipantId = getCookie("participant_id");
    if (!myParticipantId) {
      barba.go("index.html");
      return [];
    }

    const backBtn = container.querySelector("#back-btn");
    backBtn.addEventListener("click", () => {
      deleteCookie("participant_id");
      barba.go("index.html");
    });

    const loadStart = Date.now();
    const today = todayDateString();
    const contentEl = container.querySelector("#game-content");
    const assignmentViewEl = container.querySelector("#assignment-view");

    let allParticipants = [];
    let criteriaList = [];
    let todaysAssignment = null;
    let criteriaLoaded = false;
    let assignmentLoaded = false;
    let alreadyVoted = null;
    let votersForToday = new Set();
    let hasRevealed = false;
    let redirecting = false;
    let gameStatusKnown = false;
    let activeRatingFlow = null; // référence à l'instance en cours, pour pouvoir la détruire au démontage

    function reveal() {
      if (redirecting || hasRevealed) return;
      if (!gameStatusKnown) return;
      hasRevealed = true;
      withMinDelay(loadStart, 300, () => {
        AppBoot.ready(() => {
          loaderEl.style.display = "none";
          container.classList.add("is-ready");
        });
      });
    }

    function goToResults() {
      if (redirecting) return;
      redirecting = true;
      barba.go("results.html");
    }

    function showCalendar() {
      assignmentViewEl.style.display = "block";
    }
    function hideCalendar() {
      assignmentViewEl.style.display = "none";
    }

    function renderVotersChecklist() {
      if (!todaysAssignment || allParticipants.length === 0) return "";
      const expectedVoters = allParticipants.filter(
        (p) => String(p.id) !== String(todaysAssignment.participant_id),
      );
      const items = expectedVoters
        .map((p) => {
          const voted = votersForToday.has(p.id);
          return `
            <div class="voters-checklist-item ${voted ? "voted" : "pending"}">
              ${renderAvatarHTML(p, "xs")}
              <span>${p.name}</span>
              <span class="voters-checklist-icon">${voted ? "✓" : ""}</span>
            </div>
          `;
        })
        .join("");
      return `
        <div class="voters-checklist">
          <span class="label">Qui a voté</span>
          <div class="voters-checklist-list">${items}</div>
        </div>
      `;
    }

    function renderThankYou() {
      contentEl.innerHTML = `
        <div class="state-card">
          <div class="state-card-icon state-card-icon-check">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <span class="state-card-eyebrow">C'est noté</span>
          <h2 class="state-card-title">Merci pour ta notation</h2>
          <p class="state-card-subtitle">Reviens plus tard pour découvrir qui a gagné.</p>
          ${renderVotersChecklist()}
        </div>
      `;
      showCalendar();
      reveal();
    }

    function updateVotersChecklistIfVisible() {
      if (alreadyVoted) renderThankYou();
    }

    function renderContent() {
      if (!assignmentLoaded || !criteriaLoaded) return;

      if (activeRatingFlow) {
        activeRatingFlow.destroy();
        activeRatingFlow = null;
      }

      if (!todaysAssignment) {
        contentEl.innerHTML = `
          <div class="state-card">
            <div class="state-card-icon">
              ${renderAvatarHTML(todaysAssignment, "xl")}
            </div>
            <span class="state-card-eyebrow">Aujourd'hui</span>
            <h2 class="state-card-title">Pas de repas de prévu.</h2>
            <p class="state-card-subtitle">Prends ton temps de réfléchir à tes recettes..</p>
          </div>
        `;
        showCalendar();
        reveal();
        return;
      }

      const isMyDay =
        String(todaysAssignment.participant_id) === String(myParticipantId);

      if (isMyDay) {
        contentEl.innerHTML = `
          <div class="state-card">
            <div class="state-card-icon">
              ${renderAvatarHTML(todaysAssignment, "xl")}
            </div>
            <span class="state-card-eyebrow">Aujourd'hui</span>
            <h2 class="state-card-title">C'est à toi de cuisiner</h2>
            <p class="state-card-subtitle">Prends ton temps, on a hâte de découvrir ton plat.</p>
          </div>
        `;
        showCalendar();
        reveal();
        return;
      }

      if (alreadyVoted === null) return;

      if (alreadyVoted) {
        renderThankYou();
        return;
      }

      hideCalendar();
      contentEl.innerHTML = "";

      const ratingContainer = document.createElement("div");
      ratingContainer.className = "rating-flow";
      contentEl.appendChild(ratingContainer);

      activeRatingFlow = createRatingFlow({
        container: ratingContainer,
        criteria: criteriaList,
        onComplete: (scores) => {
          activeRatingFlow = null; // déjà auto-détruit en interne par rating.js avant l'appel
          AppWS.send({
            type: "votes:submit",
            date: today,
            voter_participant_id: Number(myParticipantId),
            target_participant_id: todaysAssignment.participant_id,
            scores,
          });
        },
      });

      reveal();
    }

    const offParticipants = AppWS.on("participants", (data) => {
      allParticipants = data.list || [];
      updateVotersChecklistIfVisible();
    });

    const offCriteria = AppWS.on("criteria", (data) => {
      criteriaList = data.list || [];
      criteriaLoaded = true;
      renderContent();
    });

    const offAssignmentGet = AppWS.on("assignments:get", (data) => {
      if (data.date !== today) return;
      todaysAssignment = data.assignment;
      assignmentLoaded = true;

      if (
        data.assignment &&
        String(data.assignment.participant_id) !== String(myParticipantId)
      ) {
        AppWS.send({
          type: "votes:has_voted_today",
          date: today,
          voter_participant_id: Number(myParticipantId),
        });
        AppWS.send({
          type: "votes:voters_for_date",
          date: today,
          target_participant_id: data.assignment.participant_id,
        });
      }

      renderContent();
    });

    const offHasVoted = AppWS.on("votes:has_voted_today", (data) => {
      alreadyVoted = data.hasVoted;
      renderContent();
    });

    const offVotesSubmitted = AppWS.on("votes:submitted", () => {
      alreadyVoted = true;
      renderThankYou();
    });

    const offVotersForDate = AppWS.on("votes:voters_for_date", (data) => {
      if (
        data.date !== today ||
        !todaysAssignment ||
        data.target_participant_id !== todaysAssignment.participant_id
      )
        return;
      votersForToday = new Set(data.voter_ids || []);
      updateVotersChecklistIfVisible();
    });

    const offVoterUpdate = AppWS.on("votes:voter_update", (data) => {
      if (
        data.date !== today ||
        !todaysAssignment ||
        data.target_participant_id !== todaysAssignment.participant_id
      )
        return;
      votersForToday.add(data.voter_participant_id);
      updateVotersChecklistIfVisible();
    });

    const calendar = createCalendar({
      container: container.querySelector("#assignment-calendar"),
      editable: false,
      today,
      onMonthChange: (month) => {
        AppWS.send({ type: "assignments:list", month });
      },
    });
    calendar.init();

    const offAssignmentsList = AppWS.on("assignments:list", (data) =>
      calendar.setAssignments(data.month, data.list),
    );
    const offAssignmentUpdate = AppWS.on("assignments:update", (data) => {
      calendar.applyUpdate(
        data.date,
        data.participant_id,
        data.participant_name,
        data.has_votes,
        data.avatar_icon,
        data.avatar_color,
        data.avatar_image,
      );
      if (data.date === today) {
        todaysAssignment = data.participant_id
          ? {
              date: data.date,
              participant_id: data.participant_id,
              participant_name: data.participant_name,
              has_votes: data.has_votes,
              avatar_icon: data.avatar_icon,
              avatar_color: data.avatar_color,
              avatar_image: data.avatar_image,
            }
          : null;
      }
    });

    const offGameStatus = AppWS.on("game:status", (data) => {
      gameStatusKnown = true;
      if (data.complete) {
        goToResults();
      } else {
        reveal();
        renderContent();
      }
    });

    const offGameComplete = AppWS.on("game:complete", () => goToResults());

    AppWS.send({ type: "participants:list" });
    AppWS.send({ type: "criteria:list" });
    AppWS.send({ type: "game:status" });
    AppWS.send({ type: "assignments:get", date: today });

    // Nettoyage explicite de la barre fixe de notation si on quitte la page en cours de route
    // (elle est attachée directement à document.body, donc jamais retirée automatiquement
    // par le swap de conteneur Barba).
    const cleanupRatingBar = () => {
      if (activeRatingFlow) {
        activeRatingFlow.destroy();
        activeRatingFlow = null;
      }
    };

    return [
      offParticipants,
      offCriteria,
      offAssignmentGet,
      offHasVoted,
      offVotesSubmitted,
      offVotersForDate,
      offVoterUpdate,
      offAssignmentsList,
      offAssignmentUpdate,
      offGameStatus,
      offGameComplete,
      cleanupRatingBar,
    ];
  },
});

// ============================================================
// RESULTS (results.html) — countdown, podium, classement
// ============================================================
PageModules.register("results", {
  mount(container) {
    const loaderEl = document.getElementById("page-loader");
    loaderEl.style.display = "flex";

    const loadStart = Date.now();
    const introScreenEl = container.querySelector("#intro-screen");
    const showResultsBtn = container.querySelector("#show-results-btn");
    const countdownOverlay = container.querySelector("#countdown-overlay");
    const countdownNumberEl = container.querySelector("#countdown-number");
    const resultsContentEl = container.querySelector("#results-content");
    const podiumEl = container.querySelector("#podium");
    const rankingListEl = container.querySelector("#ranking-list");

    let hasStartedCountdown = false;
    let openDetailEl = null;

    function runCountdown(onDone) {
      if (hasStartedCountdown) return;
      hasStartedCountdown = true;
      const steps = ["3", "2", "1"];
      let i = 0;
      function next() {
        if (i >= steps.length) {
          countdownOverlay.style.display = "none";
          onDone();
          return;
        }
        countdownNumberEl.textContent = steps[i];
        countdownNumberEl.classList.remove("countdown-pulse");
        void countdownNumberEl.offsetWidth;
        countdownNumberEl.classList.add("countdown-pulse");
        i += 1;
        setTimeout(next, 800);
      }
      next();
    }

    function medalFor(index) {
      return ["🥇", "🥈", "🥉"][index] || "";
    }

    function renderPodium(results) {
      const top3 = results.slice(0, 3);
      const order = [1, 0, 2].filter((i) => top3[i]);
      podiumEl.innerHTML = "";
      order.forEach((i) => {
        const r = top3[i];
        const block = document.createElement("div");
        block.className = `podium-block podium-rank-${i + 1}`;
        block.innerHTML = `
          <span class="podium-medal">${medalFor(i)}</span>
          ${renderAvatarHTML(r, "lg")}
          <span class="podium-name">${r.participant_name}</span>
          <span class="podium-score">${r.overall_average_out_of_10}/10</span>
        `;
        podiumEl.appendChild(block);
      });
    }

    function buildDetailTable(result) {
      const voterNames = [
        ...new Set(
          result.criteria.flatMap((c) => c.votes.map((v) => v.voter_name)),
        ),
      ];
      let html = `<table class="votes-table"><thead><tr><th>Critère</th>`;
      voterNames.forEach((name) => (html += `<th>${name}</th>`));
      html += `<th>Moyenne</th></tr></thead><tbody>`;
      result.criteria.forEach((c) => {
        html += `<tr><td>${c.label}</td>`;
        voterNames.forEach((name) => {
          const vote = c.votes.find((v) => v.voter_name === name);
          html += `<td>${vote ? `${vote.score}/${c.max_note}` : "—"}</td>`;
        });
        html += `<td><strong>${c.average}/${c.max_note}</strong></td></tr>`;
      });
      html += `</tbody></table>`;
      return html;
    }

    function renderRankingList(results) {
      rankingListEl.innerHTML = "";
      openDetailEl = null;
      results.forEach((r, index) => {
        const item = document.createElement("div");
        item.className = "ranking-item";

        const row = document.createElement("button");
        row.className = "ranking-row";
        row.innerHTML = `
          <span class="ranking-position">${index + 1}</span>
          ${renderAvatarHTML(r, "sm")}
          <span class="ranking-name">${r.participant_name}</span>
          <span class="ranking-score">${r.overall_average_out_of_10}/10</span>
        `;

        const detail = document.createElement("div");
        detail.className = "ranking-detail";
        detail.innerHTML = buildDetailTable(r);
        detail.style.display = "none";

        row.addEventListener("click", () => {
          const isCurrentlyOpen = detail.style.display !== "none";
          if (openDetailEl && openDetailEl !== detail)
            openDetailEl.style.display = "none";
          detail.style.display = isCurrentlyOpen ? "none" : "block";
          openDetailEl = isCurrentlyOpen ? null : detail;
        });

        item.appendChild(row);
        item.appendChild(detail);
        rankingListEl.appendChild(item);
      });
    }

    function showResults(results) {
      renderPodium(results);
      renderRankingList(results);

      withMinDelay(loadStart, 300, () => {
        AppBoot.ready(() => {
          loaderEl.style.display = "none";
          introScreenEl.style.display = "flex";
        });
      });

      showResultsBtn.addEventListener(
        "click",
        () => {
          introScreenEl.style.display = "none";
          countdownOverlay.style.display = "flex";
          runCountdown(() => {
            resultsContentEl.style.display = "block";
          });
        },
        { once: true },
      );
    }

    const offGameStatus = AppWS.on("game:status", (data) => {
      if (data.complete && data.results) {
        showResults(data.results);
      } else {
        barba.go("index.html");
      }
    });

    AppWS.send({ type: "game:status" });

    return [offGameStatus];
  },
});
