const AVATAR_ICONS = ["👤", "🧑‍🍳", "👨‍🍳", "👩‍🍳", "😀", "😎", "🤩", "🥳", "🐱", "🐶", "🦊", "🐸", "⭐", "❤️", "👑", "🔥"];

const AVATAR_COLORS = [
  "#e8a33d",
  "#e07a5f",
  "#81b29a",
  "#3d5a80",
  "#9c6644",
  "#c9564f",
  "#6a8caf",
  "#a06cd5",
  "#4a8f6a",
  "#d4af37",
];

const DEFAULT_AVATAR_ICON = "👤";
const DEFAULT_AVATAR_COLOR = "#e8a33d";

// Retourne le HTML d'un avatar (utilisable directement dans un template string)
function renderAvatarHTML(participant, size = "md") {
  const icon = (participant && participant.avatar_icon) || DEFAULT_AVATAR_ICON;
  const color = (participant && participant.avatar_color) || DEFAULT_AVATAR_COLOR;
  return `<span class="avatar avatar-${size}" style="background:${color}">${icon}</span>`;
}

// Retourne un élément DOM d'avatar (utilisable avec appendChild, pour les pastilles draggables par ex.)
function createAvatarElement(participant, size = "md") {
  const span = document.createElement("span");
  span.className = `avatar avatar-${size}`;
  span.style.background = (participant && participant.avatar_color) || DEFAULT_AVATAR_COLOR;
  span.textContent = (participant && participant.avatar_icon) || DEFAULT_AVATAR_ICON;
  return span;
}

// Construit un sélecteur d'avatar (grille d'icônes + palette de couleurs) dans `container`.
// Appelle onChange({icon, color}) à chaque changement de sélection.
function createAvatarPicker({ container, icon, color, onChange }) {
  let selectedIcon = icon || DEFAULT_AVATAR_ICON;
  let selectedColor = color || DEFAULT_AVATAR_COLOR;

  container.innerHTML = "";
  container.className = "avatar-picker";

  const iconsRow = document.createElement("div");
  iconsRow.className = "avatar-picker-icons";
  AVATAR_ICONS.forEach((ic) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "avatar-picker-icon-option";
    btn.textContent = ic;
    if (ic === selectedIcon) btn.classList.add("selected");
    btn.addEventListener("click", () => {
      selectedIcon = ic;
      onChange({ icon: selectedIcon, color: selectedColor });
      [...iconsRow.children].forEach((c) => c.classList.remove("selected"));
      btn.classList.add("selected");
    });
    iconsRow.appendChild(btn);
  });

  const colorsRow = document.createElement("div");
  colorsRow.className = "avatar-picker-colors";
  AVATAR_COLORS.forEach((c) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "avatar-picker-color-option";
    swatch.style.background = c;
    if (c === selectedColor) swatch.classList.add("selected");
    swatch.addEventListener("click", () => {
      selectedColor = c;
      onChange({ icon: selectedIcon, color: selectedColor });
      [...colorsRow.children].forEach((el) => el.classList.remove("selected"));
      swatch.classList.add("selected");
    });
    colorsRow.appendChild(swatch);
  });

  container.appendChild(iconsRow);
  container.appendChild(colorsRow);
}