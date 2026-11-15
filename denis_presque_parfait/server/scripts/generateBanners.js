// Génère les images d'aperçu de lien (Open Graph, 1200×630) pour chaque thème :
//   public/banner-classic.png et public/banner-christmas.png
// Les images sont versionnées ; ce script ne sert qu'à les régénérer après un
// changement de logo ou de thème :   node scripts/generateBanners.js
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

// Récupère le SVG du logo depuis public/logo.js (source unique du logo).
const logoSource = fs.readFileSync(path.join(PUBLIC_DIR, "logo.js"), "utf8");
const LOGO_SVG = logoSource.match(/const LOGO_SVG = `([\s\S]*?)`;/)[1];

const THEMES = {
  classic: {
    bg: "#15161a",
    text: "#f2f2f3",
    muted: "#9a9ca3",
    logo: { "#DE0076": "#DE0076", "#2A9CD1": "#2A9CD1", "#02413B": "#02413B" },
    extra: "",
  },
  christmas: {
    bg: "#0e1c16",
    text: "#f7f0e3",
    muted: "#a8b9a9",
    logo: { "#DE0076": "#d62839", "#2A9CD1": "#f7f0e3", "#02413B": "#e9c46a" },
    extra: "christmas",
  },
};

function resolveChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  return [
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((p) => fs.existsSync(p));
}

function bannerHtml(theme) {
  let logo = LOGO_SVG;
  Object.entries(theme.logo).forEach(([from, to]) => (logo = logo.split(`fill="${from}"`).join(`fill="${to}"`)));

  // Décor de Noël : guirlande en haut + flocons (positions fixes, rendu reproductible).
  const bulbColors = ["#d62839", "#e9c46a", "#52b788", "#f7f0e3"];
  const bulbs = Array.from({ length: 22 }, (_, i) => {
    const c = bulbColors[i % 4];
    return `<span class="bulb" style="background:${c};box-shadow:0 0 22px 6px ${c}"></span>`;
  }).join("");
  let seed = 7;
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const flakes = Array.from({ length: 70 }, () => {
    const r = 1.5 + rand() * 4;
    return `<span class="flake" style="left:${rand() * 1200}px;top:${60 + rand() * 570}px;width:${r * 2}px;height:${r * 2}px;opacity:${0.3 + rand() * 0.6}"></span>`;
  }).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin: 0; box-sizing: border-box; }
    body { width: 1200px; height: 630px; overflow: hidden; background: ${theme.bg};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: ${theme.text};
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 34px; position: relative; }
    ${theme.extra ? `body { background: radial-gradient(ellipse 80% 60% at 50% 115%, rgba(45,106,79,.45), transparent 70%), ${theme.bg}; }` : ""}
    .logo svg { width: 520px; height: auto; display: block; }
    .tagline { font-size: 34px; font-weight: 600; letter-spacing: .01em; }
    .sub { font-size: 24px; color: ${theme.muted}; margin-top: -22px; }
    .lights { position: absolute; top: 0; left: 0; right: 0; display: flex; justify-content: space-between; padding: 0 22px; }
    .lights::before { content: ""; position: absolute; left: 0; right: 0; top: -30px; height: 52px;
      border-bottom: 3px solid rgba(247,240,227,.3); border-radius: 0 0 50% 50% / 0 0 100% 100%; }
    .bulb { position: relative; top: 18px; width: 18px; height: 26px; border-radius: 50% 50% 50% 50% / 40% 40% 60% 60%; }
    .flake { position: absolute; border-radius: 50%; background: #fff; }
  </style></head><body>
    ${theme.extra ? `<div class="lights">${bulbs}</div>${flakes}` : ""}
    <div class="logo">${logo}</div>
    <div class="tagline">${theme.extra ? "🎄 Édition de Noël" : "Le jeu de cuisine en famille"}</div>
    <div class="sub">Chacun cuisine, tout le monde note.</div>
  </body></html>`;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: resolveChrome(), headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  for (const [name, theme] of Object.entries(THEMES)) {
    await page.setContent(bannerHtml(theme), { waitUntil: "load" });
    const out = path.join(PUBLIC_DIR, `banner-${name}.png`);
    await page.screenshot({ path: out });
    console.log("Bannière générée :", out);
  }
  await browser.close();
})();
