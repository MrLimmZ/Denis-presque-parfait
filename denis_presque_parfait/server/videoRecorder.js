const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
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

function resolveFfmpegPath() {
  try {
    return require("@ffmpeg-installer/ffmpeg").path;
  } catch {
    return "ffmpeg";
  }
}

const RECORDER_CONFIG = {
  followNewTab: false,
  fps: 30,
  videoFrame: { width: 1920, height: 1080 },
  videoCrf: 16,
  videoCodec: "libx264",
  videoPreset: "fast",
  videoBitrate: 6000,
  autopad: { color: "#15161a" },
};

let isRecording = false;

// Réécrit le MP4 brut (silencieux, moov atom en fin de fichier) en ajoutant une piste
// audio silencieuse + le flag faststart — indispensable pour une lecture fiable via
// AirPlay sur Apple TV (sans ça : erreur 500 sur /playback-info côté device).
// Ne ré-encode PAS la vidéo (-c:v copy), donc quasi instantané.
function postProcessForAirPlay(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = resolveFfmpegPath();
    const args = [
      "-y",
      "-i", inputPath,
      "-f", "lavfi",
      "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-shortest",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      outputPath,
    ];

    execFile(ffmpegPath, args, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`ffmpeg post-traitement échoué: ${stderr || err.message}`));
      } else {
        resolve();
      }
    });
  });
}

async function recordResultsVideo({ port, durationMs = 12000 } = {}) {
  if (isRecording) {
    console.log("[VIDEO] Un enregistrement est déjà en cours, celui-ci est ignoré.");
    return null;
  }
  isRecording = true;

  const rawPath = path.join(VIDEOS_DIR, `results-raw-${Date.now()}.mp4`);
  const tempFinalPath = path.join(VIDEOS_DIR, `results-${Date.now()}.mp4`);
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
        "--force-device-scale-factor=1",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ ...RECORDER_CONFIG.videoFrame, deviceScaleFactor: 1 });

    page.on("pageerror", (err) => console.error("[PAGE ERROR]", err.message));
    page.on("requestfailed", (req) => {
      if (req.url().includes("livereload")) return;
      console.error("[PAGE REQUEST FAILED]", req.url(), req.failure() && req.failure().errorText);
    });

    await page.evaluateOnNewDocument(() => {
      sessionStorage.setItem("denis_splash_shown", "1");
    });

    recorder = new PuppeteerScreenRecorder(page, RECORDER_CONFIG);
    await recorder.start(rawPath);
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

    console.log("[VIDEO] Post-traitement (piste audio + faststart) pour compatibilité AirPlay...");
    await postProcessForAirPlay(rawPath, tempFinalPath);
    fs.unlinkSync(rawPath);

    fs.renameSync(tempFinalPath, finalPath);
    console.log("[VIDEO] Vidéo des résultats générée :", finalPath);
    return finalPath;
  } catch (err) {
    console.error("[VIDEO] Échec de l'enregistrement :", err);
    if (recorder) await recorder.stop().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    [rawPath, tempFinalPath].forEach((p) => {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
    return null;
  } finally {
    isRecording = false;
  }
}

module.exports = { recordResultsVideo };