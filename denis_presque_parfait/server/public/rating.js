function createRatingFlow({ container, criteria, onComplete }) {
  let currentStep = 0;
  const scores = {}; // criterion_id -> score

  container.style.position = "relative";
  container.style.overflow = "hidden";

  // La barre (progress + nav) est fixée en bas de l'écran, hors du flux normal du contenu.
  const fixedBar = document.createElement("div");
  fixedBar.className = "rating-fixed-bar";
  document.body.appendChild(fixedBar);
  document.body.classList.add("has-rating-bar");

  function middleValue(maxNote) {
    return Math.round((1 + maxNote) / 2);
  }

  function updateNextButtonState() {
    const criterion = criteria[currentStep];
    const nextBtn = fixedBar.querySelector(".rating-nav-btn:not(.rating-nav-secondary)");
    if (nextBtn) nextBtn.disabled = scores[criterion.id] === undefined;
  }

  // --- Construction du slider pour un critère donné ---
  function buildSlider(criterion) {
    // Pré-remplit à la valeur médiane si le critère n'a encore jamais été touché,
    // pour ne jamais afficher de placeholder vide et laisser le curseur déjà positionné.
    if (scores[criterion.id] === undefined) {
      scores[criterion.id] = middleValue(criterion.max_note);
    }

    const wrap = document.createElement("div");
    wrap.className = "rating-slider-wrap";

    const numberDisplay = document.createElement("div");
    numberDisplay.className = "rating-slider-number";
    numberDisplay.textContent = scores[criterion.id];
    wrap.appendChild(numberDisplay);

    const maxLabel = document.createElement("div");
    maxLabel.className = "rating-slider-maxlabel";
    maxLabel.textContent = `sur ${criterion.max_note}`;
    wrap.appendChild(maxLabel);

    const track = document.createElement("div");
    track.className = "rating-slider-track";

    const fill = document.createElement("div");
    fill.className = "rating-slider-fill";
    track.appendChild(fill);

    const thumb = document.createElement("div");
    thumb.className = "rating-slider-thumb";
    track.appendChild(thumb);

    wrap.appendChild(track);

    // --- Échelle de paliers, sous le track : un trait vertical par valeur possible ---
    const scale = document.createElement("div");
    scale.className = "rating-slider-scale";
    const stopEls = [];
    for (let n = 1; n <= criterion.max_note; n++) {
      const stop = document.createElement("span");
      stop.className = "rating-slider-stop";
      scale.appendChild(stop);
      stopEls.push(stop);
    }
    wrap.appendChild(scale);

    function pctFor(v) {
      return criterion.max_note > 1 ? ((v - 1) / (criterion.max_note - 1)) * 100 : 100;
    }

    function highlightStops(roundedValue) {
      stopEls.forEach((stop, i) => {
        const stopValue = i + 1;
        stop.classList.toggle("active", stopValue === roundedValue);
        stop.classList.toggle("passed", stopValue < roundedValue);
      });
    }

    // Position continue (pas d'arrondi) : le curseur suit le doigt sans à-coups pendant le drag.
    function continuousValueFromClientX(clientX) {
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * (criterion.max_note - 1) + 1;
    }

    // Positionnement immédiat, sans animation — utilisé pendant le drag pour un suivi fluide.
    function paintImmediate(rawValue) {
      const pct = pctFor(rawValue);
      fill.style.width = pct + "%";
      thumb.style.left = pct + "%";
      const rounded = Math.round(Math.max(1, Math.min(criterion.max_note, rawValue)));
      numberDisplay.textContent = rounded;
      highlightStops(rounded);
    }

    // "Aimante" vers l'entier le plus proche avec un rebond élastique — utilisé à la relâche.
    function snapTo(value, animate = true) {
      value = Math.max(1, Math.min(criterion.max_note, Math.round(value)));
      scores[criterion.id] = value;
      const pct = pctFor(value);

      if (animate) {
        gsap.to(fill, { width: pct + "%", duration: 0.4, ease: "elastic.out(1, 0.6)" });
        gsap.to(thumb, { left: pct + "%", duration: 0.4, ease: "elastic.out(1, 0.6)" });
        gsap.fromTo(numberDisplay, { scale: 1.25 }, { scale: 1, duration: 0.3, ease: "back.out(2.5)" });
      } else {
        fill.style.width = pct + "%";
        thumb.style.left = pct + "%";
      }

      numberDisplay.textContent = value;
      highlightStops(value);
      updateNextButtonState();
    }

    let dragging = false;
    let rawValue = scores[criterion.id];

    track.addEventListener("pointerdown", (e) => {
      dragging = true;
      track.setPointerCapture(e.pointerId);
      rawValue = continuousValueFromClientX(e.clientX);
      paintImmediate(rawValue);
    });
    track.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      rawValue = continuousValueFromClientX(e.clientX);
      paintImmediate(rawValue);
    });
    track.addEventListener("pointerup", () => {
      if (!dragging) return;
      dragging = false;
      snapTo(rawValue); // effet magnétique : rebond élastique vers l'entier le plus proche
    });
    track.addEventListener("pointercancel", () => {
      dragging = false;
    });

    // Position initiale (valeur déjà stockée ou médiane fraîchement définie ci-dessus)
    snapTo(scores[criterion.id], false);

    return wrap;
  }

  // --- Construction de la "carte" d'un critère (label + slider) ---
  function buildCard(criterion) {
    const card = document.createElement("div");
    card.className = "rating-card";

    const stepLabel = document.createElement("p");
    stepLabel.className = "rating-step-label";
    stepLabel.textContent = `Critère ${currentStep + 1} / ${criteria.length}`;
    card.appendChild(stepLabel);

    const title = document.createElement("h2");
    title.className = "rating-criterion-title";
    title.textContent = criterion.label;
    card.appendChild(title);

    card.appendChild(buildSlider(criterion));

    return card;
  }

  function renderCard(direction = 0) {
    if (!criteria || criteria.length === 0) {
      container.innerHTML = `<p class="hint">Aucun critère de notation n'est configuré pour le moment.</p>`;
      return;
    }

    const criterion = criteria[currentStep];
    const newCard = buildCard(criterion);
    const oldCard = container.querySelector(".rating-card");

    if (direction !== 0 && oldCard) {
      gsap.to(oldCard, {
        x: direction * -36,
        opacity: 0,
        duration: 0.18,
        ease: "power1.in",
        onComplete: () => oldCard.remove(),
      });
      gsap.fromTo(newCard, { x: direction * 36, opacity: 0 }, { x: 0, opacity: 1, duration: 0.26, ease: "power2.out", delay: 0.06 });
      container.appendChild(newCard);
    } else {
      if (oldCard) oldCard.remove();
      container.appendChild(newCard);
      gsap.fromTo(newCard, { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "power2.out" });
    }
  }

  function renderBar() {
    fixedBar.innerHTML = "";

    if (!criteria || criteria.length === 0) return;

    const criterion = criteria[currentStep];

    const inner = document.createElement("div");
    inner.className = "rating-fixed-bar-inner";

    const progress = document.createElement("div");
    progress.className = "rating-progress";
    criteria.forEach((_, i) => {
      const dot = document.createElement("span");
      dot.className = "rating-progress-dot";
      if (i < currentStep) dot.classList.add("done");
      if (i === currentStep) dot.classList.add("active");
      progress.appendChild(dot);
    });
    inner.appendChild(progress);

    const navRow = document.createElement("div");
    navRow.className = "rating-nav-row";

    if (currentStep > 0) {
      const prevBtn = document.createElement("button");
      prevBtn.className = "rating-nav-btn rating-nav-secondary";
      prevBtn.textContent = "Précédent";
      prevBtn.addEventListener("click", () => {
        currentStep -= 1;
        renderCard(-1);
        renderBar();
      });
      navRow.appendChild(prevBtn);
    }

    const isLast = currentStep === criteria.length - 1;
    const nextBtn = document.createElement("button");
    nextBtn.className = "rating-nav-btn";
    nextBtn.textContent = isLast ? "Terminer" : "Suivant";
    nextBtn.disabled = scores[criterion.id] === undefined;
    nextBtn.addEventListener("click", () => {
      if (isLast) {
        const result = criteria.map((c) => ({ criterion_id: c.id, score: scores[c.id] }));
        destroy();
        onComplete && onComplete(result);
      } else {
        currentStep += 1;
        renderCard(1);
        renderBar();
      }
    });
    navRow.appendChild(nextBtn);

    inner.appendChild(navRow);
    fixedBar.appendChild(inner);

    // Petit pulse sur le point actif, pour renforcer le côté "jeu" à chaque étape.
    const activeDot = progress.querySelector(".rating-progress-dot.active");
    if (activeDot) {
      gsap.fromTo(activeDot, { scale: 1.6 }, { scale: 1, duration: 0.3, ease: "back.out(3)" });
    }
  }

  function destroy() {
    fixedBar.remove();
    document.body.classList.remove("has-rating-bar");
  }

  renderCard(0);
  renderBar();

  return {
    reset() {
      currentStep = 0;
      Object.keys(scores).forEach((k) => delete scores[k]);
      renderCard(0);
      renderBar();
    },
    destroy,
  };
}