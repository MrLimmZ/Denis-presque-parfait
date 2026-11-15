// Thème visuel global ("classic" | "christmas"), choisi dans le panel admin et
// diffusé par le serveur à tous les écrans. Le dernier thème connu est mémorisé
// localement : un petit script dans le <head> de chaque page l'applique avant
// l'affichage, pour éviter un flash du thème classique au chargement.
const ThemeManager = (function () {
  const STORAGE_KEY = "denis_theme";
  let current = null;
  let effects = null; // { stop() } des décors animés du thème actif

  const reducedMotion = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // --- Noël : neige qui tombe (canvas plein écran, ne capte aucun clic) ---
  function startSnow() {
    const canvas = document.createElement("canvas");
    canvas.className = "theme-snow";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    let width = 0;
    let height = 0;
    let flakes = [];
    let rafId = null;

    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      // Densité proportionnelle à la surface, plafonnée pour rester léger sur mobile.
      const count = Math.min(90, Math.round((width * height) / 14000));
      flakes = Array.from({ length: count }, () => makeFlake(true));
    }

    function makeFlake(anywhere) {
      return {
        x: Math.random() * width,
        y: anywhere ? Math.random() * height : -10,
        r: 0.8 + Math.random() * 2.4,
        speed: 0.25 + Math.random() * 0.75,
        drift: Math.random() * Math.PI * 2,
        opacity: 0.35 + Math.random() * 0.55,
      };
    }

    function frame() {
      ctx.clearRect(0, 0, width, height);
      flakes.forEach((f, i) => {
        f.y += f.speed;
        f.drift += 0.01;
        f.x += Math.sin(f.drift) * 0.35;
        if (f.y > height + 10) flakes[i] = makeFlake(false);
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${f.opacity})`;
        ctx.fill();
      });
      rafId = requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener("resize", resize);
    if (reducedMotion()) {
      frame();
      cancelAnimationFrame(rafId); // une seule image figée : de la neige posée, sans mouvement
    } else {
      frame();
    }

    return {
      stop() {
        cancelAnimationFrame(rafId);
        window.removeEventListener("resize", resize);
        canvas.remove();
      },
    };
  }

  // --- Noël : guirlande lumineuse en haut de l'écran ---
  function startLights() {
    const garland = document.createElement("div");
    garland.className = "theme-lights";
    garland.setAttribute("aria-hidden", "true");
    const count = Math.ceil(window.innerWidth / 46) + 1;
    for (let i = 0; i < count; i++) {
      const bulb = document.createElement("span");
      bulb.className = `theme-bulb theme-bulb-${i % 4}`;
      bulb.style.animationDelay = `${(i % 7) * 0.35}s`;
      garland.appendChild(bulb);
    }
    document.body.appendChild(garland);
    return { stop: () => garland.remove() };
  }

  function startEffects(theme) {
    if (theme !== "christmas") return null;
    const parts = [startLights(), startSnow()];
    return { stop: () => parts.forEach((p) => p.stop()) };
  }

  function apply(theme) {
    theme = theme === "christmas" ? "christmas" : "classic";
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Stockage indisponible (navigation privée...) : le thème s'applique quand même.
    }
    if (theme === current) return;
    current = theme;
    document.documentElement.dataset.theme = theme;
    // Couleur de la barre du navigateur mobile, alignée sur le fond du thème.
    let themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (!themeColorMeta) {
      themeColorMeta = document.createElement("meta");
      themeColorMeta.name = "theme-color";
      document.head.appendChild(themeColorMeta);
    }
    themeColorMeta.content = theme === "christmas" ? "#0e1c16" : "#15161a";
    if (effects) effects.stop();
    effects = document.body ? startEffects(theme) : null;
    document.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
  }

  function get() {
    return current || document.documentElement.dataset.theme || "classic";
  }

  // Couleur d'étiquette d'un cuisinier (pastilles du calendrier, du panel...).
  // En thème Noël, on remplace les couleurs de marque par une palette de Noël,
  // stable pour un même cuisinier (choisie d'après son identifiant) et assez
  // foncée pour garder le texte blanc lisible.
  const CHRISTMAS_COLORS = ["#c1121f", "#2d6a4f", "#a8741a", "#7b1e2c", "#40916c", "#9d0208", "#1b4332", "#8a5a12"];

  function cookColor(cook) {
    const base = (cook && cook.avatar_color) || "var(--accent)";
    if (get() !== "christmas" || !cook) return base;
    const id = Number(cook.cook_id != null ? cook.cook_id : cook.id) || 1;
    return CHRISTMAS_COLORS[(id - 1) % CHRISTMAS_COLORS.length];
  }

  function init() {
    apply(document.documentElement.dataset.theme || "classic");
    if (typeof AppWS !== "undefined") AppWS.on("theme", (data) => apply(data.theme));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  return { apply, get, cookColor };
})();
