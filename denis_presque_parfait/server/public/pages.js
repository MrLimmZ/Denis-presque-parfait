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
// Clin d'œil de Noël : le Père Noël et sa bulle (accueil, thème Noël)
// ============================================================
// Message général aux "rageux" (personne n'est visé) ; un tap fait défiler.
const SANTA_MESSAGES = [
  "Oh oh oh ! Cette année, le Père Noël surveille les rageux… Une mauvaise note par vengeance, et c'est du charbon sous le sapin !",
  "Oh oh oh ! Petit rappel : on note le plat, pas la rancune de l'an dernier. 😉",
  "Un 2/10 par dépit ? Oh oh oh… Je note tout dans mon carnet, moi aussi !",
  "Ici on note avec les papilles, pas avec les nerfs. Les rageux sont prévenus ! 🎅",
  "Liste des sages ou liste des rageux ? Ce sont tes notes qui décideront… 🎁",
];

function mountSanta(container) {
  let el = null;
  let index = Math.floor(Math.random() * SANTA_MESSAGES.length);
  let timers = [];
  let typing = false;
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  // Affiche un message : "en train d'écrire…" puis frappe lettre par lettre.
  // La version complète (invisible) réserve la place : la bulle ne bouge pas.
  function say(message) {
    clearTimers();
    const ghost = el.querySelector(".santa-bubble-ghost");
    const typed = el.querySelector(".santa-bubble-typed");
    const bubble = el.querySelector(".santa-bubble");
    ghost.textContent = message;
    typed.textContent = "";
    el.querySelectorAll(".santa-bubble-dot").forEach((d, i) => d.classList.toggle("active", i === index));

    if (reduceMotion) {
      typed.textContent = message;
      typing = false;
      return;
    }

    typing = true;
    bubble.classList.add("is-typing");
    later(() => {
      bubble.classList.remove("is-typing");
      const chars = [...message];
      let i = 0;
      const step = () => {
        i += 1;
        typed.textContent = chars.slice(0, i).join("");
        if (i < chars.length) {
          // Petite pause après la ponctuation, pour un rythme de parole naturel.
          const pause = /[.!?…,]/.test(chars[i - 1]) ? 170 : 24;
          later(step, pause);
        } else {
          typing = false;
        }
      };
      step();
    }, 750);
  }

  function next() {
    if (!el) return;
    const typed = el.querySelector(".santa-bubble-typed");
    // Toucher pendant la frappe : on affiche directement le message complet.
    if (typing) {
      clearTimers();
      el.querySelector(".santa-bubble").classList.remove("is-typing");
      typed.textContent = SANTA_MESSAGES[index];
      typing = false;
      return;
    }
    index = (index + 1) % SANTA_MESSAGES.length;
    const figure = el.querySelector(".santa-figure");
    figure.classList.remove("santa-hop");
    void figure.offsetWidth; // relance l'animation
    figure.classList.add("santa-hop");
    say(SANTA_MESSAGES[index]);
  }

  function show() {
    if (el || ThemeManager.get() !== "christmas") return;
    el = document.createElement("div");
    el.className = "santa";
    el.innerHTML = `
      <div class="santa-bubble" role="button" tabindex="0" aria-live="polite" aria-label="Message du Père Noël, touche pour le suivant">
        <span class="santa-bubble-name">🎅 Le Père Noël</span>
        <p class="santa-bubble-text">
          <span class="santa-bubble-ghost" aria-hidden="true"></span>
          <span class="santa-bubble-typed"></span>
          <span class="santa-typing" aria-hidden="true"><i></i><i></i><i></i></span>
        </p>
        <span class="santa-bubble-footer">
          <span class="santa-bubble-dots">${SANTA_MESSAGES.map(() => `<span class="santa-bubble-dot"></span>`).join("")}</span>
          <span class="santa-bubble-hint">touche pour la suite</span>
        </span>
      </div>
      <button type="button" class="santa-figure" aria-label="Message suivant du Père Noël">
        <img src="santa.webp" alt="" width="387" height="440" />
      </button>`;
    const bubble = el.querySelector(".santa-bubble");
    bubble.addEventListener("click", next);
    bubble.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        next();
      }
    });
    el.querySelector(".santa-figure").addEventListener("click", next);
    container.appendChild(el);
    container.classList.add("has-santa");

    // Le Père Noël arrive, puis la bulle éclot et il commence à "écrire".
    el.querySelector(".santa-bubble-ghost").textContent = SANTA_MESSAGES[index];
    later(() => say(SANTA_MESSAGES[index]), reduceMotion ? 0 : 1350);
  }

  function hide() {
    clearTimers();
    if (!el) return;
    el.remove();
    el = null;
    container.classList.remove("has-santa");
  }

  const onThemeChange = () => (ThemeManager.get() === "christmas" ? show() : hide());
  document.addEventListener("themechange", onThemeChange);
  show();

  return () => {
    document.removeEventListener("themechange", onThemeChange);
    hide();
  };
}

// ============================================================
// Détecteur de rageux (pour rire) : avant l'envoi de notes très basses
// ============================================================
const RAGE_MESSAGES = [
  "Tes notes sont… disons, glaciales. Tu confirmes que c'est le plat qui parle, et pas la rancune ?",
  "Nos capteurs détectent une forte odeur de vengeance. Le plat était-il vraiment si terrible ?",
  "Attention : ce niveau de sévérité est généralement observé chez les rageux de l'édition précédente.",
  "Le Père Noël voit tout. Même les 2/10 mis par dépit. Tu es sûr de toi ?",
  "Respire un grand coup… Bois un verre d'eau… Et maintenant, tu maintiens ces notes ?",
];

// Seuils : moyenne sous 4,5/10, ou au moins une note à 2/10 ou moins (en proportion
// de la note max de chaque critère).
function isRageVote(result, criteria) {
  const ratios = result
    .map((r) => {
      const c = criteria.find((x) => x.id === r.criterion_id);
      return c && c.max_note ? r.score / c.max_note : null;
    })
    .filter((x) => x !== null);
  if (ratios.length === 0) return null;
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const harshest = Math.min(...ratios);
  if (avg >= 0.45 && harshest > 0.2) return null;
  // Niveau de rage affiché : plus les notes sont basses, plus il grimpe.
  return Math.min(99, Math.round(((1 - avg) * 0.7 + (1 - harshest) * 0.3) * 100));
}

// Diagnostic loufoque affiché ligne par ligne (choisi selon le niveau de rage).
function rageDiagnosis(level) {
  const lines = [
    ["Mauvaise foi", level > 70 ? "très élevée" : "élevée"],
    ["Traces de rancune", "détectées"],
    ["Papilles", level > 80 ? "en grève" : "suspectes"],
    ["Probabilité de bouderie", `${Math.min(99, level + 7)} %`],
  ];
  return lines.sort(() => Math.random() - 0.5).slice(0, 3);
}

function showRageDetector(level) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "app-dialog rage-dialog";
    const message = RAGE_MESSAGES[Math.floor(Math.random() * RAGE_MESSAGES.length)];
    const diagnosis = rageDiagnosis(level)
      .map(([label, value], i) => `<li style="animation-delay:${1.2 + i * 0.35}s"><span>${label}</span><strong>${value}</strong><em>✔</em></li>`)
      .join("");
    dialog.innerHTML = `
      <div class="app-dialog-body rage-body">
        <div class="rage-siren" aria-hidden="true">🚨</div>
        <span class="state-card-eyebrow rage-eyebrow">Alerte générale</span>
        <h2 class="app-dialog-title rage-title">Détecteur de rageux</h2>
        <div class="rage-meter" role="img" aria-label="Niveau de rage : ${level} %">
          <div class="rage-meter-head">
            <span>Niveau de rage <span class="rage-face" aria-hidden="true">😇</span></span>
            <strong class="rage-meter-value">0 %</strong>
          </div>
          <div class="rage-meter-track"><div class="rage-meter-fill"></div></div>
        </div>
        <div class="rage-diagnosis">
          <span class="rage-diagnosis-title">Diagnostic</span>
          <ul>${diagnosis}</ul>
        </div>
        <p class="rage-message">${escapeHtml(message)}</p>
        <div class="app-dialog-actions rage-actions">
          <button type="button" class="btn btn-secondary" data-choice="review">Je revois mes notes 😇</button>
          <button type="button" class="btn btn-primary rage-confirm" data-choice="confirm">J'assume, c'était pas bon 😤</button>
        </div>
        <div class="rage-stamp" aria-hidden="true">Rageux<br />certifié</div>
      </div>`;
    document.body.appendChild(dialog);

    let done = false;
    const close = (confirmed) => {
      if (done) return;
      done = true;
      dialog.close();
      dialog.remove();
      resolve(confirmed);
    };

    dialog.querySelector('[data-choice="review"]').addEventListener("click", () => close(false));

    // "J'assume" s'esquive au premier essai, puis se laisse attraper ; le tampon
    // "Rageux certifié" s'abat avant l'envoi.
    const confirmBtn = dialog.querySelector('[data-choice="confirm"]');
    let dodged = false;
    confirmBtn.addEventListener("click", () => {
      if (!dodged) {
        dodged = true;
        confirmBtn.classList.add("rage-dodge");
        confirmBtn.textContent = "Hé, pas si vite ! 🏃";
        setTimeout(() => {
          confirmBtn.classList.remove("rage-dodge");
          confirmBtn.textContent = "Bon… j'assume vraiment 😤";
        }, 900);
        return;
      }
      confirmBtn.disabled = true;
      dialog.querySelector('[data-choice="review"]').disabled = true;
      dialog.classList.add("is-stamped");
      setTimeout(() => close(true), 1300);
    });

    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close(false);
    });
    dialog.showModal();

    // La jauge grimpe jusqu'au niveau détecté, la tête s'énerve en chemin.
    const fill = dialog.querySelector(".rage-meter-fill");
    const value = dialog.querySelector(".rage-meter-value");
    const face = dialog.querySelector(".rage-face");
    const faces = [[0, "😇"], [25, "🙂"], [45, "😒"], [60, "😠"], [75, "😡"], [88, "🤬"]];
    requestAnimationFrame(() => (fill.style.width = `${level}%`));
    const start = performance.now();
    const tick = (now) => {
      // (Le premier horodatage d'animation peut précéder `start` : on borne à 0.)
      const t = Math.max(0, Math.min(1, (now - start) / 1100));
      const current = Math.round(level * (1 - Math.pow(1 - t, 3)));
      value.textContent = `${current} %`;
      face.textContent = faces.filter(([min]) => current >= min).pop()[1];
      if (t < 1 && dialog.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

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
        latestButtons.forEach((btn) => {
          btn.style.opacity = "1";
          btn.style.transform = "none";
        });
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
          currentSetupStatus.teamsReady === false ||
          currentSetupStatus.unassignedCount > 0 ||
          currentSetupStatus.criteriaCount === 0);

      if (notReady) {
        selectionEl.style.display = "none";
        setupNoticeEl.style.display = "flex";
        setupNoticeTextEl.textContent =
          currentSetupStatus.participantsCount === 0
            ? "Aucun participant n'a encore été ajouté."
            : currentSetupStatus.teamsReady === false
            ? "Les équipes ne sont pas encore formées."
            : currentSetupStatus.unassignedCount > 0
            ? currentSetupStatus.mode === "teams"
              ? "Les équipes n'ont pas encore toutes une date."
              : "Les participants n'ont pas encore tous une date."
            : "Les critères de notation ne sont pas encore définis.";
      } else {
        selectionEl.style.display = "block";
        setupNoticeEl.style.display = "none";
      }

      withMinDelay(loadStart, 300, () => {
        AppBoot.ready(() => {
          loaderEl.style.display = "none";
          container.classList.add("is-ready");
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

    const editionsLinkEl = container.querySelector("#home-editions-link");
    const offEditionsList = AppWS.on("editions:list", (data) => {
      if (editionsLinkEl) editionsLinkEl.style.display = data.list && data.list.length > 0 ? "inline-block" : "none";
    });

    AppWS.send({ type: "participants:list" });
    AppWS.send({ type: "setup:status" });
    AppWS.send({ type: "game:status" });
    AppWS.send({ type: "editions:list" });

    const cleanupDecor = () => document.body.classList.remove("has-home-decor");
    const cleanupSanta = mountSanta(container);

    return [offParticipants, offSetupStatus, offGameStatus, offGameComplete, offEditionsList, cleanupDecor, cleanupSanta];
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
    let absentVotersForToday = new Set();
    let hasRevealed = false;
    let redirecting = false;
    let gameStatusKnown = false;
    let activeRatingFlow = null;

    // Compte à rebours jusqu'au prochain repas (ou au début de l'édition).
    let nextMeal; // undefined = pas encore demandé, sinon { date, started }
    let countdownTimer = null;
    const stopCountdown = () => {
      if (countdownTimer) clearInterval(countdownTimer);
      countdownTimer = null;
    };

    // Phase bonus : une fois tous les repas notés, chacun donne un point bonus secret.
    let phase = null; // "playing" | "bonus" | "done"
    let bonusInfo = null; // { voted_count, expected_count, pending[], value }
    let bonusCooks = [];
    let myBonusTarget; // undefined = pas encore connu, null = pas encore voté
    let bonusRequested = false;
    let selectedBonusId = null;
    let bonusEditing = false;

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

    // La checklist "qui a voté" permet aussi de marquer un absent comme dispensé,
    // en cliquant dessus, pour que la partie puisse se terminer sans son vote.
    // Cette action est disponible pour tout le monde (pas seulement le cuisinier
    // du jour) car il n'y a pas de page admin dédiée pour ça.
    function renderVotersChecklist() {
      if (!todaysAssignment || allParticipants.length === 0) return "";
      // Tout le monde vote, sauf les cuisiniers du jour (la personne en solo,
      // toute l'équipe en mode équipes).
      const cookMemberIds = new Set((todaysAssignment.members || []).map((m) => String(m.id)));
      const expectedVoters = allParticipants.filter((p) => !cookMemberIds.has(String(p.id)));
      const items = expectedVoters
        .map((p) => {
          const voted = votersForToday.has(p.id);
          const absent = absentVotersForToday.has(p.id);
          const state = voted ? "voted" : absent ? "absent" : "pending";
          const icon = voted ? "✓" : absent ? "×" : "";
          const hint = voted ? "" : absent ? " (dispensé·e)" : "";
          return `
            <button type="button" class="voters-checklist-item ${state}" data-voter-id="${p.id}" ${
            voted ? "disabled" : ""
          }>
              ${renderAvatarHTML(p, "xs")}
              <span>${p.name}${hint}</span>
              <span class="voters-checklist-icon">${icon}</span>
            </button>
          `;
        })
        .join("");
      return `
        <div class="voters-checklist">
          <span class="label">Qui a voté</span>
          <div class="voters-checklist-list">${items}</div>
          <p class="voters-checklist-hint">Clique sur une personne absente pour la dispenser de vote.</p>
        </div>
      `;
    }

    function attachVotersChecklistHandlers(rootEl) {
      const buttons = rootEl.querySelectorAll(".voters-checklist-item[data-voter-id]");
      buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
          const voterId = Number(btn.dataset.voterId);
          const isAbsent = absentVotersForToday.has(voterId);
          AppWS.send({
            type: isAbsent ? "absences:unmark" : "absences:mark",
            date: today,
            voter_participant_id: voterId,
          });
        });
      });
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
      attachVotersChecklistHandlers(contentEl);
      showCalendar();
      reveal();
    }

    function updateVotersChecklistIfVisible() {
      if (alreadyVoted) renderThankYou();
    }

    function formatPoints(value) {
      return String(value).replace(".", ",");
    }

    function renderBonus() {
      if (myBonusTarget === undefined || !bonusInfo) return;
      hideCalendar();
      const me = String(myParticipantId);
      const progress = `
        <div class="bonus-progress">
          <span class="label">${bonusInfo.voted_count} / ${bonusInfo.expected_count} ont donné leur point</span>
          ${
            bonusInfo.pending.length
              ? `<span class="hint">On attend : ${escapeHtml(bonusInfo.pending.map((p) => p.name).join(", "))}</span>`
              : ""
          }
        </div>`;

      if (myBonusTarget !== null && !bonusEditing) {
        const chosen = bonusCooks.find((c) => c.cook_id === myBonusTarget);
        contentEl.innerHTML = `
          <div class="state-card">
            <div class="state-card-icon bonus-star">★</div>
            <span class="state-card-eyebrow">Point bonus</span>
            <h2 class="state-card-title">Ton point bonus est donné</h2>
            <p class="state-card-subtitle">
              Tu l'as offert à <strong>${escapeHtml(chosen ? chosen.cook_name : "?")}</strong>.
              Chut, c'est secret jusqu'à l'annonce des résultats !
            </p>
            ${progress}
            <button type="button" class="btn btn-secondary btn-sm bonus-change-btn" id="bonus-change-btn">Changer mon choix</button>
          </div>`;
        contentEl.querySelector("#bonus-change-btn").addEventListener("click", () => {
          bonusEditing = true;
          selectedBonusId = myBonusTarget;
          renderBonus();
        });
        reveal();
        return;
      }

      const choices = bonusCooks.filter((c) => !(c.members || []).some((m) => String(m.id) === me));
      const choicesHtml = choices
        .map((c) => {
          const avatars = c.kind === "team" ? c.members.map((m) => renderAvatarHTML(m, "sm")).join("") : renderAvatarHTML(c, "md");
          const sub = c.kind === "team" ? `<span class="bonus-choice-members">${escapeHtml(c.members.map((m) => m.name).join(", "))}</span>` : "";
          return `
            <button type="button" class="bonus-choice${selectedBonusId === c.cook_id ? " selected" : ""}" data-cook-id="${c.cook_id}">
              <span class="bonus-choice-avatars">${avatars}</span>
              <span class="bonus-choice-text"><strong>${escapeHtml(c.cook_name)}</strong>${sub}</span>
            </button>`;
        })
        .join("");

      contentEl.innerHTML = `
        <div class="state-card bonus-card">
          <div class="state-card-icon bonus-star">★</div>
          <span class="state-card-eyebrow">Dernière étape avant les résultats</span>
          <h2 class="state-card-title">À qui donnes-tu ton point bonus ?</h2>
          <p class="state-card-subtitle">
            Ton coup de cœur de l'édition : +${formatPoints(bonusInfo.value)} point${bonusInfo.value > 1 ? "s" : ""} pour ${
              bonusCooks[0] && bonusCooks[0].kind === "team" ? "l'équipe choisie" : "la personne choisie"
            }. Ton choix reste secret jusqu'à l'annonce.
          </p>
          <div class="bonus-choices">${choicesHtml}</div>
          <div class="bonus-actions">
            ${bonusEditing ? `<button type="button" class="btn btn-secondary" id="bonus-cancel-btn">Annuler</button>` : ""}
            <button type="button" class="btn btn-primary" id="bonus-confirm-btn" ${selectedBonusId === null ? "disabled" : ""}>
              Donner mon point bonus
            </button>
          </div>
          ${progress}
        </div>`;

      contentEl.querySelectorAll(".bonus-choice").forEach((btn) => {
        btn.addEventListener("click", () => {
          selectedBonusId = Number(btn.dataset.cookId);
          renderBonus();
        });
      });
      const cancelBtn = contentEl.querySelector("#bonus-cancel-btn");
      if (cancelBtn) {
        cancelBtn.addEventListener("click", () => {
          bonusEditing = false;
          renderBonus();
        });
      }
      contentEl.querySelector("#bonus-confirm-btn").addEventListener("click", () => {
        if (selectedBonusId === null) return;
        AppWS.send({ type: "bonus:submit", voter_participant_id: Number(myParticipantId), target_id: selectedBonusId });
      });
      reveal();
    }

    function renderCountdown() {
      stopCountdown();
      if (!nextMeal || !nextMeal.date) {
        contentEl.innerHTML = `<p class="hint">Pas de repas prévu aujourd'hui.</p>`;
        return;
      }
      const [y, m, d] = nextMeal.date.split("-").map(Number);
      const target = new Date(y, m - 1, d, 0, 0, 0).getTime();
      const dayLabel = new Date(y, m - 1, d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

      contentEl.innerHTML = `
        <div class="state-card countdown-card">
          <span class="state-card-eyebrow">${nextMeal.started ? "Prochain repas" : "Début de l'édition"}</span>
          <h2 class="state-card-title">${nextMeal.started ? "Prochain repas dans" : "Le jeu commence dans"}</h2>
          <div class="countdown-grid" role="timer" aria-live="off">
            <div class="countdown-unit"><span class="countdown-value" data-unit="d">0</span><span class="countdown-label" data-label="d">jours</span></div>
            <div class="countdown-unit"><span class="countdown-value" data-unit="h">00</span><span class="countdown-label" data-label="h">heures</span></div>
            <div class="countdown-unit"><span class="countdown-value" data-unit="m">00</span><span class="countdown-label">min</span></div>
            <div class="countdown-unit"><span class="countdown-value" data-unit="s">00</span><span class="countdown-label">sec</span></div>
          </div>
          <p class="state-card-subtitle">Rendez-vous le ${escapeHtml(dayLabel)}.</p>
        </div>`;

      const els = {};
      contentEl.querySelectorAll(".countdown-value").forEach((el) => (els[el.dataset.unit] = el));
      const pad = (n) => String(n).padStart(2, "0");
      const dayLabelEl = contentEl.querySelector('[data-label="d"]');
      const hourLabelEl = contentEl.querySelector('[data-label="h"]');

      function tick() {
        const diff = target - Date.now();
        if (diff <= 0) {
          // Le jour J est arrivé : on recharge pour repartir sur la bonne date du jour.
          stopCountdown();
          window.location.reload();
          return;
        }
        const total = Math.floor(diff / 1000);
        const days = Math.floor(total / 86400);
        const hours = Math.floor((total % 86400) / 3600);
        els.d.textContent = days;
        els.h.textContent = pad(hours);
        dayLabelEl.textContent = days > 1 ? "jours" : "jour";
        hourLabelEl.textContent = hours > 1 ? "heures" : "heure";
        els.m.textContent = pad(Math.floor((total % 3600) / 60));
        els.s.textContent = pad(total % 60);
      }
      tick();
      countdownTimer = setInterval(tick, 1000);
    }

    function renderContent() {
      if (!assignmentLoaded || !criteriaLoaded) return;
      stopCountdown();

      if (activeRatingFlow) {
        activeRatingFlow.destroy();
        activeRatingFlow = null;
      }

      if (phase === "bonus") {
        renderBonus();
        return;
      }

      if (!todaysAssignment) {
        if (nextMeal === undefined) {
          nextMeal = null;
          AppWS.send({ type: "assignments:next", date: today });
        }
        renderCountdown();
        showCalendar();
        reveal();
        return;
      }

      const isTeamDay = todaysAssignment.kind === "team";
      const isMyDay = (todaysAssignment.members || []).some((m) => String(m.id) === String(myParticipantId));

      if (isMyDay) {
        const teammates = (todaysAssignment.members || []).filter((m) => String(m.id) !== String(myParticipantId));
        contentEl.innerHTML = isTeamDay
          ? `
          <div class="state-card">
            <div class="state-card-icon team-avatar-stack">
              ${(todaysAssignment.members || []).map((m) => renderAvatarHTML(m, "lg")).join("")}
            </div>
            <span class="state-card-eyebrow">Aujourd'hui · ${escapeHtml(todaysAssignment.cook_name)}</span>
            <h2 class="state-card-title">C'est ton équipe qui cuisine</h2>
            <p class="state-card-subtitle">${
              teammates.length
                ? `Avec ${escapeHtml(teammates.map((m) => m.name).join(", ").replace(/, ([^,]*)$/, " et $1"))}. On a hâte de goûter !`
                : "On a hâte de goûter !"
            }</p>
            ${renderVotersChecklist()}
          </div>
        `
          : `
          <div class="state-card">
            <div class="state-card-icon">
              ${renderAvatarHTML(todaysAssignment, "xl")}
            </div>
            <span class="state-card-eyebrow">Aujourd'hui</span>
            <h2 class="state-card-title">C'est à toi de cuisiner</h2>
            <p class="state-card-subtitle">Prends ton temps, on a hâte de découvrir ton plat.</p>
            ${renderVotersChecklist()}
          </div>
        `;
        attachVotersChecklistHandlers(contentEl);
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

      // Rappel de qui on note (surtout utile en équipes : on note un groupe).
      const targetEl = document.createElement("div");
      targetEl.className = "rating-target";
      targetEl.innerHTML = `
        <span class="rating-target-avatars">${(isTeamDay ? todaysAssignment.members : [todaysAssignment])
          .map((m) => renderAvatarHTML(m, "sm"))
          .join("")}</span>
        <span>Tu notes <strong>${escapeHtml(todaysAssignment.cook_name)}</strong>${
          isTeamDay ? ` <span class="rating-target-members">(${escapeHtml(todaysAssignment.members.map((m) => m.name).join(", "))})</span>` : ""
        }</span>
      `;
      contentEl.appendChild(targetEl);

      const ratingContainer = document.createElement("div");
      ratingContainer.className = "rating-flow";
      contentEl.appendChild(ratingContainer);

      activeRatingFlow = createRatingFlow({
        container: ratingContainer,
        criteria: criteriaList,
        confirmBeforeComplete: (result) => {
          const rage = isRageVote(result, criteriaList);
          return rage === null ? Promise.resolve(true) : showRageDetector(rage);
        },
        onComplete: (scores) => {
          activeRatingFlow = null;
          AppWS.send({
            type: "votes:submit",
            date: today,
            voter_participant_id: Number(myParticipantId),
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

      if (data.assignment) {
        const cooksToday = (data.assignment.members || []).some((m) => String(m.id) === String(myParticipantId));
        if (!cooksToday) {
          AppWS.send({ type: "votes:has_voted_today", date: today, voter_participant_id: Number(myParticipantId) });
        }
        AppWS.send({ type: "votes:voters_for_date", date: today });
        AppWS.send({ type: "absences:list_for_date", date: today });
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
      if (data.date !== today || !todaysAssignment || data.target_id !== todaysAssignment.cook_id)
        return;
      votersForToday = new Set(data.voter_ids || []);
      updateVotersChecklistIfVisible();
    });

    const offVoterUpdate = AppWS.on("votes:voter_update", (data) => {
      if (data.date !== today || !todaysAssignment || data.target_id !== todaysAssignment.cook_id)
        return;
      votersForToday.add(data.voter_participant_id);
      absentVotersForToday.delete(data.voter_participant_id);
      updateVotersChecklistIfVisible();
      renderContent();
    });

    const offAbsencesListForDateTarget = AppWS.on("absences:list_for_date", (data) => {
      if (data.date !== today || !todaysAssignment || data.target_id !== todaysAssignment.cook_id)
        return;
      absentVotersForToday = new Set(data.voter_ids || []);
      updateVotersChecklistIfVisible();
      renderContent();
    });

    const offAbsencesUpdate = AppWS.on("absences:update", (data) => {
      if (data.date !== today || !todaysAssignment || data.target_id !== todaysAssignment.cook_id)
        return;
      if (data.absent) absentVotersForToday.add(data.voter_participant_id);
      else absentVotersForToday.delete(data.voter_participant_id);
      updateVotersChecklistIfVisible();
      renderContent();
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

    const offAssignmentsList = AppWS.on("assignments:list", (data) => calendar.setAssignments(data.month, data.list));
    const offAssignmentUpdate = AppWS.on("assignments:update", (data) => {
      calendar.applyUpdate(data.date, data.assignment);
      // Le cuisinier du jour a changé (échange de dates côté admin) : on recharge
      // tout l'état du jour (a voté ?, votants, absents) puis on réaffiche. On ne le
      // fait PAS pour une simple mise à jour has_votes (à chaque vote soumis), sinon
      // on détruirait le formulaire de notation en cours des autres votants.
      const previousTodayId = todaysAssignment ? todaysAssignment.cook_id : null;
      const newTodayId = data.assignment ? data.assignment.cook_id : null;
      if (data.date === today && newTodayId !== previousTodayId) {
        alreadyVoted = null;
        votersForToday = new Set();
        absentVotersForToday = new Set();
        AppWS.send({ type: "assignments:get", date: today });
        return;
      }
      if (data.date === today) todaysAssignment = data.assignment;
      // Le calendrier a bougé : le prochain repas a peut-être changé.
      if (!todaysAssignment) AppWS.send({ type: "assignments:next", date: today });
    });

    // Calendrier entièrement modifié (mode, équipes...) : on recharge le mois et
    // l'état du jour.
    const offCalendarReload = AppWS.on("assignments:reload", () => {
      AppWS.send({ type: "assignments:list", month: calendar.getCurrentMonthKey() });
      alreadyVoted = null;
      AppWS.send({ type: "assignments:get", date: today });
      AppWS.send({ type: "assignments:next", date: today });
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

    // Phase de la partie. ATTENTION : diffusée à chaque vote ; on ne réaffiche que
    // si la phase change (ou en phase bonus), sinon on détruirait le formulaire de
    // notation en cours des autres votants.
    const offGamePhase = AppWS.on("game:phase", (data) => {
      const changed = data.phase !== phase;
      phase = data.phase;
      if (phase === "bonus") {
        bonusInfo = data.bonus;
        bonusCooks = data.cooks || [];
        if (!bonusRequested) {
          bonusRequested = true;
          AppWS.send({ type: "bonus:get_mine", voter_participant_id: Number(myParticipantId) });
        }
        renderContent();
      } else if (changed) {
        renderContent();
      }
    });

    const offBonusMine = AppWS.on("bonus:mine", (data) => {
      myBonusTarget = data.target_id;
      bonusEditing = false;
      selectedBonusId = null;
      renderContent();
    });

    const offBonusError = AppWS.on("bonus:error", (data) => alert(data.message));

    const offNextMeal = AppWS.on("assignments:next", (data) => {
      if (data.from !== today) return;
      nextMeal = { date: data.date, started: data.started };
      if (!todaysAssignment && phase !== "bonus") renderContent();
    });

    AppWS.send({ type: "participants:list" });
    AppWS.send({ type: "criteria:list" });
    AppWS.send({ type: "game:status" });
    AppWS.send({ type: "assignments:get", date: today });

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
      offAbsencesListForDateTarget,
      offAbsencesUpdate,
      offAssignmentsList,
      offAssignmentUpdate,
      offCalendarReload,
      offGameStatus,
      offGameComplete,
      offGamePhase,
      offBonusMine,
      offBonusError,
      offNextMeal,
      stopCountdown,
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
    const downloadPdfBtn = container.querySelector("#download-pdf-btn");

    // --- Téléchargement des résultats en PDF ---
    // Capture le contenu affiché (podium + classement, y compris les détails déjà
    // dépliés le cas échéant) via html2canvas, puis l'insère dans un PDF généré
    // avec jsPDF et déclenche son téléchargement.
    async function downloadResultsAsPdf() {
      if (typeof html2canvas === "undefined" || typeof window.jspdf === "undefined") {
        alert("Le générateur de PDF n'a pas pu se charger. Vérifie ta connexion et réessaie.");
        return;
      }

      const pdfLabelEl = downloadPdfBtn.querySelector(".btn-label") || downloadPdfBtn;
      const originalLabel = pdfLabelEl.textContent;
      downloadPdfBtn.disabled = true;
      pdfLabelEl.textContent = "Génération du PDF...";

      try {
        const bgColor = getComputedStyle(document.body).backgroundColor || "#000000";
        const canvas = await html2canvas(resultsContentEl, {
          backgroundColor: bgColor,
          scale: 2,
          useCORS: true,
        });

        const imgData = canvas.toDataURL("image/png");
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
          orientation: canvas.width > canvas.height ? "landscape" : "portrait",
          unit: "px",
          format: [canvas.width, canvas.height],
        });
        pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
        pdf.save("resultats-denis-presque-parfait.pdf");
      } catch (err) {
        console.error("[RESULTS] Erreur génération PDF:", err);
        alert("Impossible de générer le PDF, réessaie.");
      } finally {
        downloadPdfBtn.disabled = false;
        pdfLabelEl.textContent = originalLabel;
      }
    }

    if (downloadPdfBtn) {
      downloadPdfBtn.addEventListener("click", downloadResultsAsPdf);
    }

    // --- Sauvegarder l'édition et en commencer une nouvelle ---
    const archiveBtn = container.querySelector("#archive-edition-btn");
    const archiveLabelEl = archiveBtn ? archiveBtn.querySelector(".btn-label") || archiveBtn : null;
    const archiveBtnOriginalLabel = archiveLabelEl ? archiveLabelEl.textContent : "";

    const archiveDialog = container.querySelector("#archive-dialog");
    const archiveForm = container.querySelector("#archive-form");
    const archiveLabelInput = container.querySelector("#archive-label-input");
    const archiveKeepParticipantsInput = container.querySelector("#archive-keep-participants");
    const archiveKeepCriteriaInput = container.querySelector("#archive-keep-criteria");
    const archiveCancelBtn = container.querySelector("#archive-cancel-btn");

    function defaultEditionLabel() {
      const monthYear = new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
      return monthYear.charAt(0).toUpperCase() + monthYear.slice(1);
    }

    // Ouvre la boîte de dialogue : nom de l'édition + choix de garder (ou non)
    // participants et critères pour la suivante.
    function archiveAndReset() {
      if (!archiveDialog || typeof archiveDialog.showModal !== "function") return;
      if (!archiveLabelInput.value) archiveLabelInput.value = defaultEditionLabel();
      archiveDialog.showModal();
      archiveLabelInput.select();
    }

    function submitArchive(event) {
      event.preventDefault();
      archiveDialog.close();
      archiveBtn.disabled = true;
      archiveLabelEl.textContent = "Sauvegarde en cours...";
      AppWS.send({
        type: "editions:archive_and_reset",
        label: archiveLabelInput.value.trim(),
        keep_participants: archiveKeepParticipantsInput.checked,
        keep_criteria: archiveKeepCriteriaInput.checked,
      });
    }

    const closeArchiveDialog = () => archiveDialog.close();
    if (archiveForm) archiveForm.addEventListener("submit", submitArchive);
    if (archiveCancelBtn) archiveCancelBtn.addEventListener("click", closeArchiveDialog);

    if (archiveBtn) {
      archiveBtn.addEventListener("click", archiveAndReset);
    }

    // En cas de succès, le serveur rediffuse "game:status" (complete: false), déjà
    // géré plus bas par offGameStatus, qui redirige automatiquement vers l'accueil
    // — pas besoin de code supplémentaire ici pour le chemin de succès.
    const offEditionsError = AppWS.on("editions:error", (data) => {
      if (!archiveBtn) return;
      archiveBtn.disabled = false;
      archiveLabelEl.textContent = archiveBtnOriginalLabel;
      alert(data.message || "Impossible de sauvegarder cette édition.");
    });

    let hasStartedCountdown = false;

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
        if (typeof gsap !== "undefined") {
          gsap.fromTo(
            countdownNumberEl,
            { scale: 0.3, opacity: 0, rotate: gsap.utils.random(-12, 12) },
            { scale: 1, opacity: 1, rotate: 0, duration: 0.5, ease: "back.out(3)" }
          );
        }
        i += 1;
        setTimeout(next, 800);
      }
      next();
    }

    // Anime un chiffre de 0 jusqu'à sa valeur finale (effet "compteur qui grimpe").
    function animateCountUp(el, finalValue, duration = 0.9, delay = 0) {
      if (typeof gsap === "undefined") {
        el.textContent = finalValue.toFixed(1);
        return;
      }
      const proxy = { value: 0 };
      gsap.to(proxy, {
        value: finalValue,
        duration,
        delay,
        ease: "power2.out",
        onUpdate: () => {
          el.textContent = proxy.value.toFixed(1);
        },
      });
    }

    const { computeRanks } = ResultsView;
    const renderPodium = (results, ranks) => ResultsView.renderPodium(podiumEl, results, ranks);
    const renderRankingList = (results, ranks) => ResultsView.renderRankingList(rankingListEl, results, ranks);

    function animateResultsReveal() {
      if (typeof gsap === "undefined") {
        podiumEl.querySelectorAll(".podium-score").forEach((el) => (el.textContent = Number(el.dataset.final).toFixed(1)));
        rankingListEl.querySelectorAll(".ranking-score").forEach((el) => (el.textContent = Number(el.dataset.final).toFixed(1)));
        return;
      }

      const podiumBlocks = [...podiumEl.querySelectorAll(".podium-block")];
      const byRank = (rank) => podiumBlocks.find((b) => Number(b.dataset.rankIndex) === rank);
      const revealOrder = [2, 1, 0].map(byRank).filter(Boolean);

      gsap.set(podiumBlocks, { opacity: 0, y: 40, scale: 0.7 });

      const tl = gsap.timeline();
      revealOrder.forEach((block, i) => {
        tl.to(
          block,
          {
            opacity: 1,
            y: 0,
            scale: 1,
            rotate: 0,
            duration: 0.55,
            ease: "back.out(2.2)",
            onStart: () => {
              // Un palier peut contenir plusieurs personnes ex æquo, donc plusieurs
              // scores à animer en même temps.
              block.querySelectorAll(".podium-score").forEach((scoreEl) => {
                animateCountUp(scoreEl, Number(scoreEl.dataset.final), 0.7);
              });
            },
          },
          i === 0 ? 0 : "+=0.15"
        );
      });

      const rankingItems = [...rankingListEl.querySelectorAll(".ranking-item")];
      if (rankingItems.length > 0) {
        gsap.set(rankingItems, {
          opacity: 0,
          scale: 0.5,
          y: () => gsap.utils.random(-20, 20),
          rotate: () => gsap.utils.random(-8, 8),
        });

        tl.addLabel("rankingReveal", "+=0.1");

        tl.to(
          rankingItems,
          {
            opacity: 1,
            scale: 1,
            y: 0,
            rotate: 0,
            duration: 0.5,
            ease: "back.out(2.4)",
            stagger: 0.07,
          },
          "rankingReveal"
        );

        // Le compteur de chaque ligne est déclenché explicitement (tl.call), avec
        // le même décalage que le stagger visuel ci-dessus. On évite de compter sur
        // le callback onStart d'une cible individuelle au sein d'un tween à
        // plusieurs cibles avec stagger : ça ne se déclenche pas de façon fiable
        // pour chaque élément (seule la 1ère ligne s'animait, les suivantes
        // restaient bloquées sur "0.0" malgré une donnée correcte).
        rankingItems.forEach((item, i) => {
          tl.call(
            () => {
              const scoreEl = item.querySelector(".ranking-score");
              if (scoreEl) animateCountUp(scoreEl, Number(scoreEl.dataset.final), 0.5);
            },
            null,
            `rankingReveal+=${i * 0.07}`
          );
        });
      }
    }

    const autoMode = new URLSearchParams(location.search).get("auto") === "1";

    function showResults(results) {
      const ranks = computeRanks(results);
      renderPodium(results, ranks);
      renderRankingList(results, ranks);

      if (autoMode) {
        loaderEl.style.display = "none";
        countdownOverlay.style.display = "flex";
        runCountdown(() => {
          resultsContentEl.style.display = "block";
          animateResultsReveal();
        });
        return;
      }

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
            animateResultsReveal();
          });
        },
        { once: true }
      );
    }

    const offGameStatus = AppWS.on("game:status", (data) => {
      if (data.complete && data.results) {
        showResults(data.results);
      } else {
        window.location.href = "index.html";
      }
    });

    AppWS.send({ type: "game:status" });

    const cleanupPdfBtn = () => {
      if (downloadPdfBtn) downloadPdfBtn.removeEventListener("click", downloadResultsAsPdf);
      if (archiveBtn) archiveBtn.removeEventListener("click", archiveAndReset);
      if (archiveForm) archiveForm.removeEventListener("submit", submitArchive);
      if (archiveCancelBtn) archiveCancelBtn.removeEventListener("click", closeArchiveDialog);
    };

    return [offGameStatus, offEditionsError, cleanupPdfBtn];
  },
});
// ============================================================
// EDITIONS (editions.html) — historique des éditions archivées
// ============================================================
PageModules.register("editions", {
  mount(container) {
    const loaderEl = document.getElementById("page-loader");
    loaderEl.style.display = "flex";
    const loadStart = Date.now();

    const listViewEl = container.querySelector("#editions-list-view");
    const listEl = container.querySelector("#editions-list");
    const detailViewEl = container.querySelector("#edition-detail-view");
    const detailDateEl = container.querySelector("#edition-detail-date");
    const detailTitleEl = container.querySelector("#edition-detail-title");
    const detailSubtitleEl = container.querySelector("#edition-detail-subtitle");
    const podiumEl = container.querySelector("#edition-podium");
    const rankingListEl = container.querySelector("#edition-ranking-list");
    const backBtn = container.querySelector("#editions-back-btn");

    let currentView = "list";
    let hasRevealed = false;

    // archived_at est stocké par SQLite en UTC ("YYYY-MM-DD HH:MM:SS").
    function formatArchivedAt(archivedAt) {
      if (!archivedAt) return "";
      const d = new Date(archivedAt.replace(" ", "T") + "Z");
      if (isNaN(d)) return archivedAt;
      return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    }

    function editionTitle(edition) {
      return edition.label || `Édition du ${formatArchivedAt(edition.archived_at)}`;
    }

    function reveal() {
      if (hasRevealed) return;
      hasRevealed = true;
      withMinDelay(loadStart, 300, () => {
        AppBoot.ready(() => {
          loaderEl.style.display = "none";
          container.classList.add("is-ready");
        });
      });
    }

    function showView(view) {
      currentView = view;
      listViewEl.style.display = view === "list" ? "block" : "none";
      detailViewEl.style.display = view === "detail" ? "block" : "none";
      window.scrollTo(0, 0);
    }

    function renderList(list) {
      listEl.innerHTML = "";

      if (!list || list.length === 0) {
        listEl.innerHTML = `
          <div class="state-card">
            <span class="state-card-eyebrow">Rien pour l'instant</span>
            <h2 class="state-card-title">Aucune édition archivée</h2>
            <p class="state-card-subtitle">À la fin d'une partie, « Lancer une nouvelle édition » la sauvegarde ici.</p>
          </div>`;
        return;
      }

      list.forEach((edition) => {
        const card = document.createElement("button");
        card.className = "edition-card";
        const winner = edition.winner_avatar || {};
        const meta = [
          formatArchivedAt(edition.archived_at),
          edition.participant_count
            ? `${edition.participant_count} ${edition.mode === "teams" ? "équipes" : "participants"}`
            : null,
          edition.winner_name ? `🏆 ${escapeHtml(edition.winner_name)}` : null,
        ]
          .filter(Boolean)
          .join(" · ");

        card.innerHTML = `
          ${renderAvatarHTML(winner, "md")}
          <span class="edition-card-main">
            <span class="edition-card-label">${escapeHtml(editionTitle(edition))}${
              edition.mode === "teams" ? ` <span class="edition-mode-badge">Équipes</span>` : ""
            }</span>
            <span class="edition-card-meta">${meta}</span>
          </span>
          ${edition.winner_score != null ? `<span class="edition-card-score">${Number(edition.winner_score).toFixed(1)}</span>` : ""}
        `;
        card.addEventListener("click", () => AppWS.send({ type: "editions:get", id: edition.id }));
        listEl.appendChild(card);
      });

      if (typeof gsap !== "undefined") {
        gsap.from(listEl.children, { opacity: 0, y: 16, duration: 0.35, stagger: 0.05, ease: "power2.out" });
      }
    }

    function renderDetail(edition) {
      const results = edition.results || [];
      detailDateEl.textContent = `Archivée le ${formatArchivedAt(edition.archived_at)}`;
      detailTitleEl.textContent = editionTitle(edition);
      const unit = edition.mode === "teams" ? "équipes" : "participants";
      detailSubtitleEl.textContent = `${results.length} ${unit} · ${(edition.criteria || []).length} critères`;

      const ranks = ResultsView.computeRanks(results);
      ResultsView.renderPodium(podiumEl, results, ranks);
      ResultsView.renderRankingList(rankingListEl, results, ranks);
      // Pas d'animation de compteur ici : on affiche directement les scores finaux.
      container.querySelectorAll(".podium-score, .ranking-score").forEach((el) => {
        el.textContent = Number(el.dataset.final).toFixed(1);
      });
      showView("detail");
    }

    const onBack = () => {
      if (currentView === "detail") showView("list");
      else barba.go("index.html");
    };
    backBtn.addEventListener("click", onBack);

    const offList = AppWS.on("editions:list", (data) => {
      renderList(data.list);
      reveal();
    });

    const offGet = AppWS.on("editions:get", (data) => {
      if (!data.edition) {
        alert("Cette édition est introuvable.");
        return;
      }
      renderDetail(data.edition);
    });

    // Une édition vient d'être archivée ailleurs : on rafraîchit la liste.
    const offArchived = AppWS.on("editions:archived", () => AppWS.send({ type: "editions:list" }));

    AppWS.send({ type: "editions:list" });

    return [offList, offGet, offArchived, () => backBtn.removeEventListener("click", onBack)];
  },
});
