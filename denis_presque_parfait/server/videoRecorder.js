const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");
const { PuppeteerScreenRecorder } = require("puppeteer-screen-recorder");

const PUBLIC_DIR = path.join(__dirname, "public");
const VIDEOS_DIR = path.join(PUBLIC_DIR, "videos");
if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });

function resolveExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;

  const candidates = [
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    "Aucun Chromium/Chrome trouvé pour l'enregistrement vidéo. Définis PUPPETEER_EXECUTABLE_PATH."
  );
}

// Qualité relevée : Full HD, framerate plus élevé, bitrate confortable, encodage plus
// soigné (preset "fast" au lieu de "ultrafast"). Ajuste videoPreset vers "ultrafast"
// si l'encodage s'avère trop lent sur le Pi en production.
const RECORDER_CONFIG = {
  followNewTab: false,
  fps: 30,
  videoFrame: { width: 1920, height: 1080 }, // Full HD, natif pour un écran de TV
  videoCrf: 16, // plus bas = meilleure qualité (12-18 = très bon, 23 = par défaut ffmpeg)
  videoCodec: "libx264",
  videoPreset: "fast",
  videoBitrate: 6000, // 6 Mbps, confortable pour du 1080p30 sans banding
  autopad: { color: "#15161a" },
};

let isRecording = false;

async function recordResultsVideo({ port, durationMs = 12000 } = {}) {
  if (isRecording) {
    console.log("[VIDEO] Un enregistrement est déjà en cours, celui-ci est ignoré.");
    return null;
  }
  isRecording = true;

  const tempPath = path.join(VIDEOS_DIR, `results-${Date.now()}.mp4`);
  const finalPath = path.join(VIDEOS_DIR, "results-latest.mp4");

  let browser;
  let recorder;
  try {
    console.log("[VIDEO] Lancement de Chromium...");
    browser = await puppeteer.launch({
      executablePath: resolveExecutablePath(),
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        `--window-size=${RECORDER_CONFIG.videoFrame.width},${RECORDER_CONFIG.videoFrame.height}`,
        "--force-device-scale-factor=1", // évite un rendu flou/sur-échantillonné selon l'écran hôte
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ ...RECORDER_CONFIG.videoFrame, deviceScaleFactor: 1 });

    page.on("pageerror", (err) => console.error("[PAGE ERROR]", err.message));
    page.on("requestfailed", (req) => {
      // Le rechargement à chaud (livereload) échoue toujours en headless, sans impact —
      // on l'ignore pour ne pas polluer les logs utiles.
      if (req.url().includes("livereload")) return;
      console.error("[PAGE REQUEST FAILED]", req.url(), req.failure() && req.failure().errorText);
    });

    await page.evaluateOnNewDocument(() => {
      sessionStorage.setItem("denis_splash_shown", "1");
    });

    recorder = new PuppeteerScreenRecorder(page, RECORDER_CONFIG);
    await recorder.start(tempPath);
    console.log("[VIDEO] Enregistrement démarré, navigation vers results.html...");

    await page.goto(`http://127.0.0.1:${port}/results.html?auto=1`, {
      waitUntil: "networkidle0",
      timeout: 15000,
    });
    console.log("[VIDEO] Page chargée, on laisse tourner l'enregistrement...");

    await new Promise((resolve) => setTimeout(resolve, durationMs));

    console.log("[VIDEO] Fin de la durée d'enregistrement, arrêt...");
    await recorder.stop();
    await browser.close();
    browser = null;

    fs.renameSync(tempPath, finalPath);
    console.log("[VIDEO] Vidéo des résultats générée :", finalPath);
    return finalPath;
  } catch (err) {
    console.error("[VIDEO] Échec de l'enregistrement :", err);
    if (recorder) await recorder.stop().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    return null;
  } finally {
    isRecording = false;
  }
}

module.exports = { recordResultsVideo };