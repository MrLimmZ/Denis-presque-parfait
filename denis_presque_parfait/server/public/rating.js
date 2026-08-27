function createRatingFlow({ container, criteria, onComplete }) {
  let currentStep = 0;
  const scores = {}; // criterion_id -> score

  function render() {
    container.innerHTML = "";

    if (!criteria || criteria.length === 0) {
      container.innerHTML = `<p class="hint">Aucun critère de notation n'est configuré pour le moment.</p>`;
      return;
    }

    const criterion = criteria[currentStep];

    // Progress
    const progress = document.createElement("div");
    progress.className = "rating-progress";
    criteria.forEach((_, i) => {
      const dot = document.createElement("span");
      dot.className = "rating-progress-dot";
      if (i < currentStep) dot.classList.add("done");
      if (i === currentStep) dot.classList.add("active");
      progress.appendChild(dot);
    });
    container.appendChild(progress);

    const stepLabel = document.createElement("p");
    stepLabel.className = "rating-step-label";
    stepLabel.textContent = `Critère ${currentStep + 1} / ${criteria.length}`;
    container.appendChild(stepLabel);

    const title = document.createElement("h2");
    title.className = "rating-criterion-title";
    title.textContent = criterion.label;
    container.appendChild(title);

    const notesRow = document.createElement("div");
    notesRow.className = "rating-notes-row";
    for (let n = 1; n <= criterion.max_note; n++) {
      const btn = document.createElement("button");
      btn.className = "rating-note-btn";
      btn.textContent = n;
      if (scores[criterion.id] === n) btn.classList.add("selected");
      btn.addEventListener("click", () => {
        scores[criterion.id] = n;
        render();
      });
      notesRow.appendChild(btn);
    }
    container.appendChild(notesRow);

    const navRow = document.createElement("div");
    navRow.className = "rating-nav-row";

    if (currentStep > 0) {
      const prevBtn = document.createElement("button");
      prevBtn.className = "rating-nav-btn rating-nav-secondary";
      prevBtn.textContent = "← Précédent";
      prevBtn.addEventListener("click", () => {
        currentStep -= 1;
        render();
      });
      navRow.appendChild(prevBtn);
    }

    const isLast = currentStep === criteria.length - 1;
    const nextBtn = document.createElement("button");
    nextBtn.className = "rating-nav-btn";
    nextBtn.textContent = isLast ? "Terminer" : "Suivant →";
    nextBtn.disabled = scores[criterion.id] === undefined;
    nextBtn.addEventListener("click", () => {
      if (isLast) {
        const result = criteria.map((c) => ({ criterion_id: c.id, score: scores[c.id] }));
        onComplete && onComplete(result);
      } else {
        currentStep += 1;
        render();
      }
    });
    navRow.appendChild(nextBtn);

    container.appendChild(navRow);
  }

  render();

  return {
    reset() {
      currentStep = 0;
      Object.keys(scores).forEach((k) => delete scores[k]);
      render();
    },
  };
}