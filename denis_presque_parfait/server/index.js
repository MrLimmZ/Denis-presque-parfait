const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const db = require("./db");
const ha = require("./ha");
const { recordResultsVideo } = require("./videoRecorder");

const PORT = process.env.PORT || 8080;

const app = express();
app.use(express.json({ limit: "5mb" }));

if (process.env.NODE_ENV !== "production") {
  const livereload = require("livereload");
  const connectLivereload = require("connect-livereload");

  const lrServer = livereload.createServer();
  lrServer.watch(path.join(__dirname, "public"));

  app.use(connectLivereload());
}

// --- Pages HTML : thème et balises meta injectés côté serveur ---
// Les aperçus de lien (iMessage, WhatsApp...) ne lisent que le HTML brut, sans
// exécuter de JS : l'image et la description du thème actif doivent donc y être
// écrites par le serveur. On pose aussi data-theme sur <html>, ce qui évite tout
// flash du mauvais thème au chargement.
const HTML_PAGES = ["index.html", "game.html", "results.html", "editions.html", "panel.html"];
const THEME_META = {
  classic: {
    color: "#15161a",
    title: "Un Denis Presque Parfait",
    description: "Le jeu de cuisine en famille : chacun cuisine, tout le monde note.",
  },
  christmas: {
    color: "#0e1c16",
    title: "Un Denis Presque Parfait · Édition de Noël 🎄",
    description: "L'édition de Noël : chacun cuisine, tout le monde note.",
  },
};

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function renderHtmlPage(file, req) {
  const theme = db.getTheme();
  const meta = THEME_META[theme] || THEME_META.classic;
  // URL absolue de la bannière (exigée par Open Graph), en tenant compte du
  // préfixe Ingress de Home Assistant quand la page passe par la sidebar.
  const proto = (req.get("x-forwarded-proto") || req.protocol).split(",")[0];
  const host = req.get("x-forwarded-host") || req.get("host");
  const ingressPath = (req.get("x-ingress-path") || "").replace(/\/$/, "");
  const image = `${proto}://${host}${ingressPath}/banner-${theme}.png`;

  const tags = `
  <meta name="theme-color" content="${meta.color}" />
  <meta name="description" content="${escapeAttr(meta.description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Un Denis Presque Parfait" />
  <meta property="og:title" content="${escapeAttr(meta.title)}" />
  <meta property="og:description" content="${escapeAttr(meta.description)}" />
  <meta property="og:image" content="${escapeAttr(image)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="${escapeAttr(image)}" />
  <link rel="icon" type="image/png" href="icon.png" />
`;
  const html = fs.readFileSync(path.join(__dirname, "public", file), "utf8");
  return html.replace('<html lang="fr">', `<html lang="fr" data-theme="${theme}">`).replace("</head>", `${tags}</head>`);
}

app.get(["/", ...HTML_PAGES.map((p) => `/${p}`)], (req, res) => {
  const file = req.path === "/" ? "index.html" : req.path.slice(1);
  res.set("Cache-Control", "no-cache");
  res.type("html").send(renderHtmlPage(file, req));
});

app.use(express.static(path.join(__dirname, "public")));

// Sert la version locale de jsPDF (installée via `npm install jspdf`) plutôt que
// de dépendre d'un CDN externe, qui peut être inaccessible selon le réseau (ex:
// instance Home Assistant sans accès internet direct depuis le LAN, ou bloqué par
// une extension/proxy côté client).
const NODE_MODULES = path.join(__dirname, "node_modules");
app.use("/vendor/jspdf", express.static(path.join(NODE_MODULES, "jspdf", "dist")));
app.use("/vendor/barba", express.static(path.join(NODE_MODULES, "@barba", "core", "dist")));
app.use("/vendor/gsap", express.static(path.join(NODE_MODULES, "gsap", "dist")));
app.use("/vendor/html2canvas", express.static(path.join(NODE_MODULES, "html2canvas", "dist")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 5 * 1024 * 1024 });

function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) client.send(payload);
  });
}

// Participants, équipes et "cuisiniers" non planifiés évoluent ensemble (un
// participant qui change d'équipe, une équipe supprimée...) : on les diffuse
// toujours en bloc.
function broadcastParticipants() {
  broadcast({ type: "participants", list: db.listParticipants() });
  broadcast({ type: "teams", list: db.listTeams() });
  broadcast({ type: "cooks:unassigned", list: db.listUnassignedCooks() });
}

function broadcastCriteria() {
  broadcast({ type: "criteria", list: db.listCriteria() });
}

function broadcastVotes() {
  broadcast({ type: "votes:list", list: db.listVotes() });
}

function broadcastSetupStatus() {
  broadcast({ type: "setup:status", status: db.getSetupStatus() });
}

let wasGameComplete = false;

// Message décrivant la phase de la partie ("playing" | "bonus" | "done"). En phase
// bonus, il contient l'avancement (qui a voté, jamais pour qui) et la liste des
// cuisiniers à qui on peut donner son point.
function phasePayload(status) {
  return {
    type: "game:phase",
    phase: status.phase,
    bonus: status.phase === "bonus" ? status.bonus : null,
    cooks: status.phase === "bonus" ? db.listCooks() : null,
  };
}

function checkAndBroadcastGameStatus() {
  const status = db.computeGameStatus();
  broadcast(phasePayload(status));

  if (status.complete && !wasGameComplete) {
    wasGameComplete = true;
    broadcast({ type: "game:complete", results: db.getResults() });
    recordResultsVideo({ port: PORT }).catch((err) => console.error("[VIDEO] Erreur:", err));
  } else if (!status.complete) {
    wasGameComplete = false;
  }
}

// Diffuse l'état d'un jour du calendrier (assignment = cuisinier normalisé, ou
// null si le jour est libre).
function broadcastAssignmentUpdateFor(date) {
  broadcast({ type: "assignments:update", date, assignment: db.getAssignmentForDate(date) });
}

function broadcastAbsenceUpdateFor(date, targetId, voterParticipantId, absent) {
  broadcast({
    type: "absences:update",
    date,
    target_id: targetId,
    voter_participant_id: voterParticipantId,
    absent: !!absent,
  });
}

// Le calendrier entier change (changement de mode, tirage des équipes...) : les
// clients rechargent le mois affiché.
function broadcastCalendarReload() {
  broadcast({ type: "assignments:reload" });
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "participants", list: db.listParticipants() }));
  ws.send(JSON.stringify({ type: "teams", list: db.listTeams() }));
  ws.send(JSON.stringify({ type: "cooks:unassigned", list: db.listUnassignedCooks() }));
  ws.send(JSON.stringify({ type: "criteria", list: db.listCriteria() }));
  ws.send(JSON.stringify({ type: "setup:status", status: db.getSetupStatus() }));
  ws.send(JSON.stringify({ type: "theme", theme: db.getTheme() }));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    try {
      handleMessage(ws, msg);
    } catch (err) {
      console.error("[SERVER] Erreur lors du traitement du message WS:", msg.type, err);
      ws.send(JSON.stringify({ type: "server:error", message: err.message || "Erreur serveur" }));
    }
  });
});

function sendError(ws, type, message) {
  ws.send(JSON.stringify({ type, message }));
}

function handleMessage(ws, msg) {
  // --- Thème visuel (réglage global, appliqué en direct sur tous les écrans) ---
  // Les avatars dépendent du thème : on rediffuse tout ce qui en affiche.
  if (msg.type === "theme:set" && db.setTheme(msg.theme).ok) {
    broadcast({ type: "theme", theme: msg.theme });
    broadcastParticipants();
    broadcastCalendarReload();
  }

  // --- Mode de jeu (solo / équipes) ---
  if (msg.type === "mode:set" && typeof msg.mode === "string") {
    const result = db.setMode(msg.mode);
    if (!result.ok) return sendError(ws, "mode:error", result.error);
    broadcastParticipants();
    broadcastSetupStatus();
    broadcastCalendarReload();
  }

  // --- Participants ---
  if (msg.type === "participants:add" && typeof msg.name === "string" && msg.name.trim()) {
    const result = db.addParticipant(msg.name.trim());
    if (!result.ok) return sendError(ws, "participants:error", result.error);
    broadcastParticipants();
    broadcastSetupStatus();
  }

  if (msg.type === "participants:rename" && msg.id && typeof msg.name === "string" && msg.name.trim()) {
    const result = db.renameParticipant(msg.id, msg.name.trim());
    if (!result.ok) return sendError(ws, "participants:error", result.error);
    broadcastParticipants();
    broadcastCalendarReload();
  }

  if (msg.type === "participants:avatar:color" && msg.id && typeof msg.color === "string") {
    db.setParticipantAvatarColor(msg.id, msg.color);
    broadcastParticipants();
    broadcastCalendarReload();
  }

  if (
    msg.type === "participants:avatar:image" &&
    msg.id &&
    (msg.image === null || typeof msg.image === "string")
  ) {
    db.setParticipantAvatarImage(msg.id, msg.image);
    broadcastParticipants();
    broadcastCalendarReload();
  }

  if (msg.type === "participants:delete" && msg.id) {
    db.deleteParticipant(msg.id);
    broadcastParticipants();
    broadcastSetupStatus();
    broadcastCalendarReload();
    checkAndBroadcastGameStatus();
  }

  // --- Équipes ---
  if (msg.type === "teams:add") {
    const result = db.addTeam(msg.name);
    if (!result.ok) return sendError(ws, "teams:error", result.error);
    broadcastParticipants();
    broadcastSetupStatus();
  }

  if (msg.type === "teams:rename" && msg.id) {
    const result = db.renameTeam(msg.id, msg.name);
    if (!result.ok) return sendError(ws, "teams:error", result.error);
    broadcastParticipants();
    broadcastCalendarReload();
  }

  if (msg.type === "teams:color" && msg.id && typeof msg.color === "string") {
    db.setTeamColor(msg.id, msg.color);
    broadcastParticipants();
    broadcastCalendarReload();
  }

  if (msg.type === "teams:delete" && msg.id) {
    const result = db.deleteTeam(msg.id);
    if (!result.ok) return sendError(ws, "teams:error", result.error);
    broadcastParticipants();
    broadcastSetupStatus();
    broadcastCalendarReload();
  }

  if (msg.type === "teams:set_member" && msg.participant_id) {
    const teamId = msg.team_id ? Number(msg.team_id) : null;
    const result = db.setParticipantTeam(Number(msg.participant_id), teamId);
    if (!result.ok) return sendError(ws, "teams:error", result.error);
    broadcastParticipants();
    broadcastSetupStatus();
    broadcastCalendarReload();
  }

  if (msg.type === "teams:random") {
    const result = db.randomizeTeams(msg.count);
    if (!result.ok) return sendError(ws, "teams:error", result.error);
    broadcastParticipants();
    broadcastSetupStatus();
    broadcastCalendarReload();
  }

  // --- Assignations (un "cuisinier" = participant en solo, équipe en mode équipes) ---
  if (msg.type === "assignments:list" && typeof msg.month === "string") {
    ws.send(
      JSON.stringify({
        type: "assignments:list",
        month: msg.month,
        list: db.listAssignmentsForMonth(msg.month),
      })
    );
  }

  if (msg.type === "assignments:get" && typeof msg.date === "string") {
    const assignment = db.getAssignmentForDate(msg.date);
    ws.send(JSON.stringify({ type: "assignments:get", date: msg.date, assignment: assignment || null }));
  }

  if (msg.type === "assignments:next" && typeof msg.date === "string") {
    ws.send(JSON.stringify({ type: "assignments:next", from: msg.date, ...db.getNextMealFrom(msg.date) }));
  }

  if (msg.type === "assignments:get_for_cook" && msg.cook_id) {
    const assignment = db.getAssignmentForCook(msg.cook_id);
    ws.send(
      JSON.stringify({
        type: "assignments:get_for_cook",
        cook_id: msg.cook_id,
        date: assignment ? assignment.date : null,
      })
    );
  }

  if (msg.type === "assignments:set" && typeof msg.date === "string" && msg.cook_id) {
    // Mémorise l'ancien jour du cuisinier : en cas d'échange ou de déplacement, il
    // faut aussi diffuser la mise à jour de ce jour-là.
    const previous = db.getAssignmentForCook(msg.cook_id);
    const result = db.setAssignment(msg.date, msg.cook_id);
    if (!result.ok) return sendError(ws, "assignments:error", result.error);
    broadcastAssignmentUpdateFor(msg.date);
    if (previous && previous.date !== msg.date) broadcastAssignmentUpdateFor(previous.date);
    broadcastParticipants();
    broadcastSetupStatus();
    checkAndBroadcastGameStatus();
  }

  if (msg.type === "assignments:delete" && typeof msg.date === "string") {
    const result = db.deleteAssignment(msg.date);
    if (!result.ok) return sendError(ws, "assignments:error", result.error);
    broadcastAssignmentUpdateFor(msg.date);
    broadcastParticipants();
    broadcastSetupStatus();
  }

  if (msg.type === "assignments:random") {
    db.autoAssignUnassigned();
    broadcastParticipants();
    broadcastSetupStatus();
    broadcast({ type: "assignments:random:done" });
  }

  // --- Critères de notation ---
  if (msg.type === "criteria:add" && typeof msg.label === "string" && msg.label.trim() && msg.max_note) {
    db.addCriterion(msg.label.trim(), Number(msg.max_note), Number(msg.coefficient) || 1, msg.category);
    broadcastCriteria();
    broadcastSetupStatus();
  }

  if (
    msg.type === "criteria:update" &&
    msg.id &&
    typeof msg.label === "string" &&
    msg.label.trim() &&
    msg.max_note
  ) {
    db.updateCriterion(msg.id, msg.label.trim(), Number(msg.max_note), Number(msg.coefficient) || 1, msg.category);
    broadcastCriteria();
  }

  if (msg.type === "criteria:delete" && msg.id) {
    const result = db.deleteCriterion(msg.id);
    if (!result.ok) return sendError(ws, "criteria:error", result.error);
    broadcastCriteria();
    broadcastSetupStatus();
  }

  if (msg.type === "criteria:move" && msg.id && (msg.direction === "up" || msg.direction === "down")) {
    const result = db.moveCriterion(msg.id, msg.direction);
    if (!result.ok) return sendError(ws, "criteria:error", result.error);
    broadcastCriteria();
  }

  // --- Votes ---
  // La cible est déduite du calendrier côté serveur (voir db.submitVotes).
  if (
    msg.type === "votes:submit" &&
    typeof msg.date === "string" &&
    msg.voter_participant_id &&
    Array.isArray(msg.scores)
  ) {
    const result = db.submitVotes(msg.date, msg.voter_participant_id, msg.scores);
    if (!result.ok) return sendError(ws, "votes:error", result.error);
    ws.send(JSON.stringify({ type: "votes:submitted" }));
    broadcastVotes();
    broadcastParticipants();
    broadcastSetupStatus();
    broadcastAssignmentUpdateFor(msg.date);

    broadcast({
      type: "votes:voter_update",
      date: msg.date,
      target_id: result.target_id,
      voter_participant_id: msg.voter_participant_id,
    });

    // La personne a voté : elle n'est plus "absente" pour ce jour (géré aussi côté
    // db.submitVotes, mais on informe les clients connectés du changement d'état).
    broadcastAbsenceUpdateFor(msg.date, result.target_id, msg.voter_participant_id, false);

    checkAndBroadcastGameStatus();
  }

  if (msg.type === "votes:list") {
    ws.send(JSON.stringify({ type: "votes:list", list: db.listVotes() }));
  }

  if (msg.type === "votes:has_voted_today" && typeof msg.date === "string" && msg.voter_participant_id) {
    ws.send(
      JSON.stringify({
        type: "votes:has_voted_today",
        hasVoted: db.hasVotedToday(msg.date, msg.voter_participant_id),
      })
    );
  }

  if (msg.type === "votes:voters_for_date" && typeof msg.date === "string") {
    const assignment = db.getAssignmentForDate(msg.date);
    ws.send(
      JSON.stringify({
        type: "votes:voters_for_date",
        date: msg.date,
        target_id: assignment ? assignment.cook_id : null,
        voter_ids: db.listVoterIdsForDate(msg.date),
      })
    );
  }

  // --- Absences ---
  // Permet d'exempter un votant absent un jour donné, pour que la partie
  // puisse tout de même être déclarée terminée sans son vote.
  if (msg.type === "absences:mark" && typeof msg.date === "string" && msg.voter_participant_id) {
    const result = db.markAbsent(msg.date, msg.voter_participant_id);
    if (!result.ok) return sendError(ws, "absences:error", result.error);
    broadcastAbsenceUpdateFor(msg.date, result.target_id, msg.voter_participant_id, true);
    checkAndBroadcastGameStatus();
  }

  if (msg.type === "absences:unmark" && typeof msg.date === "string" && msg.voter_participant_id) {
    db.unmarkAbsent(msg.date, msg.voter_participant_id);
    const assignment = db.getAssignmentForDate(msg.date);
    broadcastAbsenceUpdateFor(msg.date, assignment ? assignment.cook_id : null, msg.voter_participant_id, false);
    checkAndBroadcastGameStatus();
  }

  if (msg.type === "absences:list_for_date" && typeof msg.date === "string") {
    const assignment = db.getAssignmentForDate(msg.date);
    ws.send(
      JSON.stringify({
        type: "absences:list_for_date",
        date: msg.date,
        target_id: assignment ? assignment.cook_id : null,
        voter_ids: db.listAbsentVoterIdsForDate(msg.date),
      })
    );
  }

  // --- Requêtes explicites de données ---
  if (msg.type === "participants:list") {
    ws.send(JSON.stringify({ type: "participants", list: db.listParticipants() }));
  }

  if (msg.type === "teams:list") {
    ws.send(JSON.stringify({ type: "teams", list: db.listTeams() }));
  }

  if (msg.type === "criteria:list") {
    ws.send(JSON.stringify({ type: "criteria", list: db.listCriteria() }));
  }

  // --- Statut de configuration (wizard admin) ---
  if (msg.type === "setup:status") {
    ws.send(JSON.stringify({ type: "setup:status", status: db.getSetupStatus() }));
  }

  // --- Statut / résultats de la partie ---
  if (msg.type === "game:status") {
    const status = db.computeGameStatus();
    ws.send(
      JSON.stringify({
        type: "game:status",
        complete: status.complete,
        phase: status.phase,
        results: status.complete ? db.getResults() : null,
      })
    );
    ws.send(JSON.stringify(phasePayload(status)));
  }

  // --- Point bonus ---
  if (msg.type === "bonus:submit" && msg.voter_participant_id && msg.target_id) {
    const result = db.submitBonus(msg.voter_participant_id, msg.target_id);
    if (!result.ok) return sendError(ws, "bonus:error", result.error);
    ws.send(JSON.stringify({ type: "bonus:mine", target_id: Number(msg.target_id) }));
    checkAndBroadcastGameStatus();
  }

  if (msg.type === "bonus:get_mine" && msg.voter_participant_id) {
    ws.send(JSON.stringify({ type: "bonus:mine", target_id: db.getBonusVote(msg.voter_participant_id) }));
  }

  if (msg.type === "bonus:close") {
    const result = db.closeBonus();
    if (!result.ok) return sendError(ws, "bonus:error", result.error);
    checkAndBroadcastGameStatus();
  }

  // --- Éditions archivées ---
  // Sauvegarde l'édition actuelle (doit être terminée) puis remet tout à zéro
  // pour en démarrer une nouvelle, en une seule action atomique côté client.
  if (msg.type === "editions:archive_and_reset") {
    const status = db.computeGameStatus();
    if (!status.complete) {
      ws.send(JSON.stringify({ type: "editions:error", message: "La partie n'est pas encore terminée, impossible de l'archiver." }));
    } else {
      const keepParticipants = msg.keep_participants === true;
      const keepCriteria = msg.keep_criteria === true;
      const edition = db.archiveCurrentEdition(typeof msg.label === "string" ? msg.label : "");
      db.resetForNewEdition({ keepParticipants, keepCriteria });
      wasGameComplete = false;

      // "editions:archived" part en premier : le panel s'en sert pour recalculer
      // l'étape du wizard à afficher dès le "setup:status" qui suit.
      broadcast({
        type: "editions:archived",
        edition: { id: edition.id, label: edition.label, mode: edition.mode },
        keep_participants: keepParticipants,
        keep_criteria: keepCriteria,
      });
      broadcastParticipants();
      broadcastCriteria();
      broadcastVotes();
      broadcastSetupStatus();
      // Diffuse explicitement le nouveau statut (forcément incomplet juste après
      // un reset) : les pages résultats/jeu connectées se redirigent alors
      // automatiquement vers l'accueil via leur écouteur "game:status" existant.
      broadcast({ type: "game:status", complete: false, results: null });
    }
  }

  if (msg.type === "editions:list") {
    ws.send(JSON.stringify({ type: "editions:list", list: db.listEditions() }));
  }

  if (msg.type === "editions:get" && msg.id) {
    ws.send(JSON.stringify({ type: "editions:get", id: msg.id, edition: db.getEditionById(msg.id) }));
  }

  // --- Reset total de la base ---
  if (msg.type === "db:reset") {
    db.resetDatabase();
    wasGameComplete = false;
    broadcastCalendarReload();
    broadcastParticipants();
    broadcastCriteria();
    broadcastVotes();
    broadcastSetupStatus();
    broadcast({ type: "db:reset:done" });
  }

  // --- Intégration Home Assistant : diffusion des résultats sur une TV ---
  if (msg.type === "ha:list_media_players") {
    ha.listMediaPlayers()
      .then((players) => ws.send(JSON.stringify({ type: "ha:media_players", players })))
      .catch((err) =>
        ws.send(JSON.stringify({ type: "ha:error", message: "Impossible de récupérer les appareils HA : " + err.message }))
      );
  }

  if (msg.type === "ha:get_tv_config") {
    ws.send(
      JSON.stringify({
        type: "ha:tv_config",
        entity_id: db.getSetting("tv_entity_id") || "",
        base_url: db.getSetting("tv_base_url") || "",
      })
    );
  }

  if (msg.type === "ha:save_tv_config") {
    if (typeof msg.entity_id === "string") db.setSetting("tv_entity_id", msg.entity_id);
    if (typeof msg.base_url === "string") db.setSetting("tv_base_url", msg.base_url.replace(/\/$/, ""));
    broadcast({
      type: "ha:tv_config",
      entity_id: db.getSetting("tv_entity_id") || "",
      base_url: db.getSetting("tv_base_url") || "",
    });
  }

  if (msg.type === "video:generate_test") {
    ws.send(JSON.stringify({ type: "video:generating" }));
    recordResultsVideo({ port: PORT })
      .then((filePath) => {
        // Chemin relatif (sans "/" initial) : le client construit l'URL complète via
        // buildBaseUrl(), qui tient compte du préfixe Ingress HA dynamique — une URL
        // absolue "/videos/..." ignorerait ce préfixe et pointerait sur la racine de HA.
        broadcast({ type: "video:generated", ok: !!filePath, url: "videos/results-latest.mp4?t=" + Date.now() });
      })
      .catch((err) => {
        broadcast({ type: "video:generated", ok: false, error: err.message });
      });
  }

  if (msg.type === "video:push_to_tv") {
    const entityId = db.getSetting("tv_entity_id");
    const baseUrl = db.getSetting("tv_base_url");
    if (!entityId || !baseUrl) {
      ws.send(JSON.stringify({ type: "ha:error", message: "Choisis un appareil et renseigne l'URL de base d'abord." }));
    } else {
      const videoUrl = `${baseUrl}/videos/results-latest.mp4`;
      ha.turnOn(entityId)
        .then(() => ha.playMedia(entityId, videoUrl))
        .then(() => ws.send(JSON.stringify({ type: "video:pushed" })))
        .catch((err) => ws.send(JSON.stringify({ type: "ha:error", message: "Échec de la diffusion : " + err.message })));
    }
  }
}

server.listen(PORT, () => {
  console.log(`Denis Presque Parfait - serveur lancé sur le port ${PORT}`);
  // Le "jour en cours" (votes, fin de partie) dépend du fuseau du serveur : le
  // Supervisor HA injecte TZ avec le fuseau du système, on le logue pour vérifier.
  console.log(
    `[TZ] TZ=${process.env.TZ || "(non défini)"} · fuseau résolu: ${Intl.DateTimeFormat().resolvedOptions().timeZone} · aujourd'hui: ${db.todayStr()}`
  );

  // Vérifie le statut de la partie au démarrage (utile si le serveur a redémarré
  // alors que la partie était déjà terminée) puis toutes les 15 minutes, afin que
  // le passage à minuit (qui "pardonne" automatiquement les votants manquants des
  // jours passés, voir db.computeGameStatus) déclenche bien la fin de partie et la
  // génération de la vidéo sans qu'aucun client n'ait besoin de se connecter.
  checkAndBroadcastGameStatus();
  setInterval(checkAndBroadcastGameStatus, 15 * 60 * 1000);
});