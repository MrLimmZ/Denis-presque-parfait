function initShareButton({ title = "Un Denis Presque Parfait" } = {}) {
  // --- Bouton flottant fixe, présent sur n'importe quelle page qui appelle cette fonction ---
  const fab = document.createElement("button");
  fab.className = "share-fab";
  fab.title = "Partager ce lien";
  fab.innerHTML = "🔗";
  document.body.appendChild(fab);

  // --- Construction du DOM de la modale (une seule fois) ---
  const overlay = document.createElement("div");
  overlay.className = "share-overlay";
  overlay.innerHTML = `
    <div class="share-card" role="dialog" aria-modal="true" aria-label="Partager">
      <button class="share-close" aria-label="Fermer">&times;</button>

      <div class="share-illustration" id="share-illustration">
        <div class="share-screenshot-loading">
          <span class="share-spinner"></span>
          Capture en cours...
        </div>
      </div>

      <div class="share-body">
        <span class="share-eyebrow">Partager</span>
        <h2 class="share-title">${title}</h2>

        <div class="share-url-row">
          <span class="share-url" id="share-url-text"></span>
          <button class="share-copy" id="share-copy-btn">Copier</button>
        </div>

        <div class="share-options">
          <button class="share-option" data-action="whatsapp">
            <span class="share-option-icon">💬</span>
            <span>WhatsApp</span>
          </button>
          <button class="share-option" data-action="sms">
            <span class="share-option-icon">✉️</span>
            <span>Message</span>
          </button>
          <button class="share-option" data-action="email">
            <span class="share-option-icon">📧</span>
            <span>Email</span>
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const urlTextEl = overlay.querySelector("#share-url-text");
  const copyBtn = overlay.querySelector("#share-copy-btn");
  const closeBtn = overlay.querySelector(".share-close");
  const illustrationEl = overlay.querySelector("#share-illustration");

  // Le lien partagé pointe toujours vers la racine de l'app (pas game.html/panel.html),
  // même si la capture d'écran ci-dessous montre bien la page actuelle.
  function getShareUrl() {
    return typeof buildBaseUrl === "function" ? buildBaseUrl() : window.location.href;
  }

  function renderLoading() {
    illustrationEl.innerHTML = `
      <div class="share-screenshot-loading">
        <span class="share-spinner"></span>
        Capture en cours...
      </div>
    `;
  }

  function renderScreenshot(imgUrl) {
    illustrationEl.innerHTML = "";
    const img = document.createElement("img");
    img.src = imgUrl;
    img.alt = "Aperçu de la page";
    illustrationEl.appendChild(img);
  }

  function renderError(message) {
    illustrationEl.innerHTML = `<div class="share-screenshot-loading">${message}</div>`;
  }

  // Capture la page ACTUELLE (peu importe l'URL partagée) — sert uniquement d'illustration
  async function captureScreenshot() {
    if (typeof html2canvas === "undefined") {
      renderError("Aperçu indisponible");
      return;
    }

    try {
      const bg = getComputedStyle(document.body).backgroundColor;
      const canvas = await html2canvas(document.body, { backgroundColor: bg });
      canvas.toBlob((blob) => {
        const imgUrl = URL.createObjectURL(blob);
        renderScreenshot(imgUrl);
      }, "image/png");
    } catch {
      renderError("Aperçu indisponible");
    }
  }

  async function open() {
    urlTextEl.textContent = getShareUrl();
    renderLoading();

    // On capture AVANT d'afficher la modale, sinon elle se prend elle-même en photo
    overlay.style.visibility = "hidden";
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await captureScreenshot();
    overlay.style.visibility = "";

    overlay.classList.add("open");
    document.addEventListener("keydown", onKeydown);
  }

  function close() {
    overlay.classList.remove("open");
    document.removeEventListener("keydown", onKeydown);
  }

  function onKeydown(e) {
    if (e.key === "Escape") close();
  }

  fab.addEventListener("click", () => open());

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  closeBtn.addEventListener("click", close);

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(getShareUrl());
      copyBtn.textContent = "Copié ✓";
      setTimeout(() => (copyBtn.textContent = "Copier"), 1500);
    } catch {
      const range = document.createRange();
      range.selectNode(urlTextEl);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    }
  });

  overlay.querySelectorAll(".share-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = getShareUrl();
      const text = encodeURIComponent(`${title} : ${url}`);
      const action = btn.dataset.action;

      if (action === "whatsapp") {
        window.open(`https://wa.me/?text=${text}`, "_blank");
      } else if (action === "sms") {
        window.location.href = `sms:?body=${text}`;
      } else if (action === "email") {
        window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${text}`;
      }
    });
  });

  return { open, close };
}