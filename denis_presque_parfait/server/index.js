const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const db = require("./db");

const PORT = process.env.PORT || 8080;

const app = express();
app.use(express.json());

if (process.env.NODE_ENV !== "production") {
  const livereload = require("livereload");
  const connectLivereload = require("connect-livereload");

  const lrServer = livereload.createServer();
  lrServer.watch(path.join(__dirname, "public"));

  app.use(connectLivereload());
}

app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) client.send(payload);
  });
}

function broadcastParticipants() {
  broadcast({ type: "participants", list: db.listParticipants() });
}

function broadcastCriteria() {
  broadcast({ type: "criteria", list: db.listCriteria() });
}

function broadcastVotes() {
  broadcast({ type: "votes:list", list: db.listVotes() });
}

function checkAndBroadcastGameStatus() {
  const status = db.computeGameStatus();
  if (status.complete) {
    broadcast({ type: "game:complete", results: db.getResults() });
  }
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "participants", list: db.listParticipants() }));
  ws.send(JSON.stringify({ type: "criteria", list: db.listCriteria() }));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // --- Participants ---
    if (msg.type === "participants:add" && typeof msg.name === "string" && msg.name.trim()) {
      db.addParticipant(msg.name.trim());
      broadcastParticipants();
    }

    if (msg.type === "participants:rename" && msg.id && typeof msg.name === "string" && msg.name.trim()) {
      db.renameParticipant(msg.id, msg.name.trim());
      broadcastParticipants();
    }

    if (
      msg.type === "participants:avatar" &&
      msg.id &&
      typeof msg.icon === "string" &&
      typeof msg.color === "string"
    ) {
      db.setParticipantAvatar(msg.id, msg.icon, msg.color);
      broadcastParticipants();
    }

    if (msg.type === "participants:delete" && msg.id) {
      db.deleteParticipant(msg.id);
      broadcastParticipants();
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
        const participant = db.getParticipant(msg.participant_id);
        broadcast({
          type: "assignments:update",
          date: msg.date,
          participant_id: msg.participant_id,
          participant_name: participant ? participant.name : null,
          avatar_icon: participant ? participant.avatar_icon : null,
          avatar_color: participant ? participant.avatar_color : null,
          has_votes: false,
        });
        broadcastParticipants();
        checkAndBroadcastGameStatus();
      }
    }

    if (msg.type === "assignments:delete" && typeof msg.date === "string") {
      const result = db.deleteAssignment(msg.date);
      if (!result.ok) {
        ws.send(JSON.stringify({ type: "assignments:error", message: result.error }));
      } else {
        broadcast({
          type: "assignments:update",
          date: msg.date,
          participant_id: null,
          participant_name: null,
          avatar_icon: null,
          avatar_color: null,
          has_votes: false,
        });
      }
    }

    // --- Critères de notation ---
    if (msg.type === "criteria:add" && typeof msg.label === "string" && msg.label.trim() && msg.max_note) {
      db.addCriterion(msg.label.trim(), Number(msg.max_note));
      broadcastCriteria();
    }

    if (msg.type === "criteria:update" && msg.id && typeof msg.label === "string" && msg.label.trim() && msg.max_note) {
      db.updateCriterion(msg.id, msg.label.trim(), Number(msg.max_note));
      broadcastCriteria();
    }

    if (msg.type === "criteria:delete" && msg.id) {
      const result = db.deleteCriterion(msg.id);
      if (!result.ok) {
        ws.send(JSON.stringify({ type: "criteria:error", message: result.error }));
      } else {
        broadcastCriteria();
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

      const participant = db.getParticipant(msg.target_participant_id);
      broadcast({
        type: "assignments:update",
        date: msg.date,
        participant_id: msg.target_participant_id,
        participant_name: participant ? participant.name : null,
        avatar_icon: participant ? participant.avatar_icon : null,
        avatar_color: participant ? participant.avatar_color : null,
        has_votes: true,
      });

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
      broadcastParticipants();
      broadcastCriteria();
      broadcastVotes();
      broadcast({ type: "db:reset:done" });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Denis Presque Parfait - serveur lancé sur le port ${PORT}`);
});