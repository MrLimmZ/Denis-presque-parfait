const path = require("path");
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

app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 5 * 1024 * 1024 });

function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) client.send(payload);
  });
}

function broadcastParticipants() {
  broadcast({ type: "participants", list: db.listParticipants() });
  broadcast({ type: "participants:unassigned", list: db.listUnassignedParticipants() });
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

function checkAndBroadcastGameStatus() {
  const status = db.computeGameStatus();

  if (status.complete && !wasGameComplete) {
    wasGameComplete = true;
    broadcast({ type: "game:complete", results: db.getResults() });
    recordResultsVideo({ port: PORT }).catch((err) => console.error("[VIDEO] Erreur:", err));
  } else if (!status.complete) {
    wasGameComplete = false;
  }
}

function broadcastAssignmentUpdateFor(date, participantId, hasVotes) {
  const participant = participantId ? db.getParticipant(participantId) : null;
  broadcast({
    type: "assignments:update",
    date,
    participant_id: participantId || null,
    participant_name: participant ? participant.name : null,
    avatar_icon: participant ? participant.avatar_icon : null,
    avatar_color: participant ? participant.avatar_color : null,
    avatar_image: participant ? participant.avatar_image : null,
    has_votes: !!hasVotes,
  });
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "participants", list: db.listParticipants() }));
  ws.send(JSON.stringify({ type: "participants:unassigned", list: db.listUnassignedParticipants() }));
  ws.send(JSON.stringify({ type: "criteria", list: db.listCriteria() }));
  ws.send(JSON.stringify({ type: "setup:status", status: db.getSetupStatus() }));

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

function handleMessage(ws, msg) {
  // --- Participants ---
  if (msg.type === "participants:add" && typeof msg.name === "string" && msg.name.trim()) {
    const result = db.addParticipant(msg.name.trim());
    if (!result.ok) {
      ws.send(JSON.stringify({ type: "participants:error", message: result.error }));
    } else {
      broadcastParticipants();
      broadcastSetupStatus();
    }
  }

  if (msg.type === "participants:rename" && msg.id && typeof msg.name === "string" && msg.name.trim()) {
    const result = db.renameParticipant(msg.id, msg.name.trim());
    if (!result.ok) {
      ws.send(JSON.stringify({ type: "participants:error", message: result.error }));
    } else {
      broadcastParticipants();
    }
  }

  if (msg.type === "participants:avatar:color" && msg.id && typeof msg.color === "string") {
    db.setParticipantAvatarColor(msg.id, msg.color);
    broadcastParticipants();
  }

  if (
    msg.type === "participants:avatar:image" &&
    msg.id &&
    (msg.image === null || typeof msg.image === "string")
  ) {
    db.setParticipantAvatarImage(msg.id, msg.image);
    broadcastParticipants();
  }

  if (msg.type === "participants:delete" && msg.id) {
    db.deleteParticipant(msg.id);
    broadcastParticipants();
    broadcastSetupStatus();
    checkAndBroadcastGameStatus();
  }

  // --- Assignations ---
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

  if (msg.type === "assignments:get_for_participant" && msg.participant_id) {
    const assignment = db.getAssignmentForParticipant(msg.participant_id);
    ws.send(
      JSON.stringify({
        type: "assignments:get_for_participant",
        participant_id: msg.participant_id,
        date: assignment ? assignment.date : null,
      })
    );
  }

  if (msg.type === "assignments:set" && typeof msg.date === "string" && msg.participant_id) {
    const result = db.setAssignment(msg.date, msg.participant_id);
    if (!result.ok) {
      ws.send(JSON.stringify({ type: "assignments:error", message: result.error }));
    } else {
      broadcastAssignmentUpdateFor(msg.date, msg.participant_id, false);
      broadcastParticipants();
      broadcastSetupStatus();
      checkAndBroadcastGameStatus();
    }
  }

  if (msg.type === "assignments:delete" && typeof msg.date === "string") {
    const result = db.deleteAssignment(msg.date);
    if (!result.ok) {
      ws.send(JSON.stringify({ type: "assignments:error", message: result.error }));
    } else {
      broadcastAssignmentUpdateFor(msg.date, null, false);
      broadcastParticipants();
      broadcastSetupStatus();
    }
  }

  if (msg.type === "assignments:random") {
    db.autoAssignUnassigned();
    broadcastParticipants();
    broadcastSetupStatus();
    broadcast({ type: "assignments:random:done" });
  }

  // --- Critères de notation ---
  if (msg.type === "criteria:add" && typeof msg.label === "string" && msg.label.trim() && msg.max_note) {
    db.addCriterion(msg.label.trim(), Number(msg.max_note), Number(msg.coefficient) || 1);
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
    db.updateCriterion(msg.id, msg.label.trim(), Number(msg.max_note), Number(msg.coefficient) || 1);
    broadcastCriteria();
  }

  if (msg.type === "criteria:delete" && msg.id) {
    const result = db.deleteCriterion(msg.id);
    if (!result.ok) {
      ws.send(JSON.stringify({ type: "criteria:error", message: result.error }));
    } else {
      broadcastCriteria();
      broadcastSetupStatus();
    }
  }

  if (msg.type === "criteria:move" && msg.id && (msg.direction === "up" || msg.direction === "down")) {
    const result = db.moveCriterion(msg.id, msg.direction);
    if (!result.ok) {
      ws.send(JSON.stringify({ type: "criteria:error", message: result.error }));
    } else {
      broadcastCriteria();
    }
  }

  // --- Votes ---
  if (
    msg.type === "votes:submit" &&
    typeof msg.date === "string" &&
    msg.voter_participant_id &&
    msg.target_participant_id &&
    Array.isArray(msg.scores)
  ) {
    db.submitVotes(msg.date, msg.voter_participant_id, msg.target_participant_id, msg.scores);
    ws.send(JSON.stringify({ type: "votes:submitted" }));
    broadcastVotes();
    broadcastParticipants();
    broadcastSetupStatus();

    broadcastAssignmentUpdateFor(msg.date, msg.target_participant_id, true);

    broadcast({
      type: "votes:voter_update",
      date: msg.date,
      target_participant_id: msg.target_participant_id,
      voter_participant_id: msg.voter_participant_id,
    });

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

  if (msg.type === "votes:voters_for_date" && typeof msg.date === "string" && msg.target_participant_id) {
    ws.send(
      JSON.stringify({
        type: "votes:voters_for_date",
        date: msg.date,
        target_participant_id: msg.target_participant_id,
        voter_ids: db.listVotersForDateTarget(msg.date, msg.target_participant_id),
      })
    );
  }

  // --- Requêtes explicites de données ---
  if (msg.type === "participants:list") {
    ws.send(JSON.stringify({ type: "participants", list: db.listParticipants() }));
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
        results: status.complete ? db.getResults() : null,
      })
    );
  }

  // --- Reset total de la base ---
  if (msg.type === "db:reset") {
    db.resetDatabase();
    wasGameComplete = false;
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
});