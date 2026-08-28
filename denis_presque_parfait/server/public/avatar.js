// Icône utilisateur fixe (silhouette générique) — utilisée si le participant n'a pas de photo.
const USER_ICON_SVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.7 0 4.9-2.2 4.9-4.9S14.7 2.2 12 2.2 7.1 4.4 7.1 7.1 9.3 12 12 12zm0 2.2c-3.3 0-9.8 1.6-9.8 4.9v2.7h19.6v-2.7c0-3.3-6.5-4.9-9.8-4.9z"/></svg>`;

// 4 familles de teintes (vert/sarcelle, bleu, violet, rose), 4 variantes claires/foncées
// chacune. Doit rester identique à AVATAR_COLOR_PALETTE dans server/db.js
const AVATAR_COLORS = [
  "#012C27", "#02413B", "#0B5C52", "#157A6C",
  "#123A5C", "#1B6E96", "#2A9CD1", "#4FB2DE",
  "#3B1D57", "#623291", "#7C4AB0", "#8C5CC0",
  "#7A0041", "#A5005C", "#DE0076", "#F03D93",
];

const DEFAULT_AVATAR_COLOR = "#02413B";

// --- Rendu (utilisé partout : liste publique, calendrier, admin, résultats...) ---
// Si le participant a une photo (avatar_image), elle prend toujours le pas sur la couleur.

function renderAvatarHTML(participant, size = "md") {
  const image = participant && participant.avatar_image;
  if (image) {
    return `<span class="avatar avatar-${size} avatar-has-image"><img src="${image}" alt="" /></span>`;
  }
  const color = (participant && participant.avatar_color) || DEFAULT_AVATAR_COLOR;
  return `<span class="avatar avatar-${size}" style="background:${color}">${USER_ICON_SVG}</span>`;
}

function createAvatarElement(participant, size = "md") {
  const span = document.createElement("span");
  span.className = `avatar avatar-${size}`;

  const image = participant && participant.avatar_image;
  if (image) {
    span.classList.add("avatar-has-image");
    const img = document.createElement("img");
    img.src = image;
    img.alt = "";
    span.appendChild(img);
    return span;
  }

  const color = (participant && participant.avatar_color) || DEFAULT_AVATAR_COLOR;
  span.style.background = color;
  span.innerHTML = USER_ICON_SVG;
  return span;
}

// --- Recadrage/compression d'une image uploadée en carré, côté navigateur ---
// Évite d'envoyer/stocker des photos de plusieurs Mo : sortie ~10-25 Ko en JPEG.
function cropImageFileToDataUrl(file, targetSize = 240, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Lecture du fichier impossible"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Image invalide"));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext("2d");

        // Recadrage centré en carré (crop "cover"), quelle que soit l'orientation d'origine.
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, targetSize, targetSize);

        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// --- Sélecteur : couleur OU photo perso ---
// onChange reçoit soit { mode: "color", color }, soit { mode: "image", image },
// soit { mode: "remove" } (retire la photo, retombe sur la couleur déjà enregistrée).
function createAvatarPicker({ container, color, image, onChange }) {
  let selectedColor = color || DEFAULT_AVATAR_COLOR;
  const hasImage = !!image;

  container.innerHTML = "";
  container.className = "avatar-picker";

  // --- Section couleurs ---
  const colorSection = document.createElement("div");
  colorSection.className = "avatar-picker-section";

  const colorLabel = document.createElement("span");
  colorLabel.className = "avatar-picker-label";
  colorLabel.textContent = "Couleur";
  colorSection.appendChild(colorLabel);

  const colorsRow = document.createElement("div");
  colorsRow.className = "avatar-picker-colors";
  AVATAR_COLORS.forEach((c) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "avatar-picker-color-option";
    swatch.style.background = c;
    if (!hasImage && c === selectedColor) swatch.classList.add("selected");
    swatch.addEventListener("click", () => {
      selectedColor = c;
      onChange({ mode: "color", color: selectedColor });
    });
    colorsRow.appendChild(swatch);
  });
  colorSection.appendChild(colorsRow);
  container.appendChild(colorSection);

  // --- Séparateur ---
  const divider = document.createElement("div");
  divider.className = "avatar-picker-divider";
  divider.innerHTML = "<span>ou</span>";
  container.appendChild(divider);

  // --- Section photo ---
  const imageSection = document.createElement("div");
  imageSection.className = "avatar-picker-section";

  const uploadLabel = document.createElement("label");
  uploadLabel.className = "avatar-picker-upload-btn";
  uploadLabel.textContent = hasImage ? "Changer la photo" : "Importer une photo";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png,image/jpeg";
  fileInput.hidden = true;

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;

    if (!["image/png", "image/jpeg"].includes(file.type)) {
      alert("Seuls les fichiers PNG ou JPG sont acceptés.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      alert("Image trop lourde (8 Mo max).");
      return;
    }

    try {
      const dataUrl = await cropImageFileToDataUrl(file);
      onChange({ mode: "image", image: dataUrl });
    } catch {
      alert("Impossible de traiter cette image, réessaie avec une autre.");
    }
    fileInput.value = "";
  });

  uploadLabel.appendChild(fileInput);
  imageSection.appendChild(uploadLabel);

  if (hasImage) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "avatar-picker-remove-btn";
    removeBtn.textContent = "Retirer la photo";
    removeBtn.addEventListener("click", () => onChange({ mode: "remove" }));
    imageSection.appendChild(removeBtn);
  }

  container.appendChild(imageSection);
}