const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = fs.existsSync("/data") ? "/data" : path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "denis.db");
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS assignments (
    date TEXT PRIMARY KEY,
    participant_id INTEGER NOT NULL UNIQUE,
    FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS criteria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    max_note INTEGER NOT NULL DEFAULT 5,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    voter_participant_id INTEGER NOT NULL,
    target_participant_id INTEGER NOT NULL,
    criterion_id INTEGER NOT NULL,
    score INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(date, voter_participant_id, criterion_id)
  );
`);

// --- Migration légère : ajoute les colonnes avatar si elles n'existent pas encore
// (utile pour les bases créées avant l'introduction de cette fonctionnalité) ---
const participantColumns = db.prepare("PRAGMA table_info(participants)").all().map((c) => c.name);
if (!participantColumns.includes("avatar_icon")) {
  db.exec(`ALTER TABLE participants ADD COLUMN avatar_icon TEXT NOT NULL DEFAULT '👤'`);
}
if (!participantColumns.includes("avatar_color")) {
  db.exec(`ALTER TABLE participants ADD COLUMN avatar_color TEXT NOT NULL DEFAULT '#e8a33d'`);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function hasVotesForDate(date) {
  return db.prepare("SELECT COUNT(*) AS n FROM votes WHERE date = ?").get(date).n > 0;
}

// --- Participants ---

function listParticipants() {
  return db
    .prepare(
      `SELECT p.id, p.name, p.avatar_icon, p.avatar_color,
        EXISTS(
          SELECT 1 FROM assignments a
          WHERE a.participant_id = p.id
            AND EXISTS(SELECT 1 FROM votes v WHERE v.date = a.date AND v.target_participant_id = a.participant_id)
        ) AS locked
       FROM participants p
       ORDER BY p.id ASC`
    )
    .all();
}

function getParticipant(id) {
  return db
    .prepare("SELECT id, name, avatar_icon, avatar_color FROM participants WHERE id = ?")
    .get(id);
}

function addParticipant(name) {
  const result = db.prepare("INSERT INTO participants (name) VALUES (?)").run(name);
  return getParticipant(result.lastInsertRowid);
}

function renameParticipant(id, name) {
  db.prepare("UPDATE participants SET name = ? WHERE id = ?").run(name, id);
}

function setParticipantAvatar(id, icon, color) {
  db.prepare("UPDATE participants SET avatar_icon = ?, avatar_color = ? WHERE id = ?").run(icon, color, id);
}

function deleteParticipant(id) {
  db.prepare("DELETE FROM participants WHERE id = ?").run(id);
}

// --- Assignations (calendrier) ---

function listAssignmentsForMonth(month) {
  return db
    .prepare(
      `SELECT a.date, a.participant_id, p.name AS participant_name,
              p.avatar_icon, p.avatar_color,
        EXISTS(SELECT 1 FROM votes v WHERE v.date = a.date AND v.target_participant_id = a.participant_id) AS has_votes
       FROM assignments a
       JOIN participants p ON p.id = a.participant_id
       WHERE a.date LIKE ?
       ORDER BY a.date ASC`
    )
    .all(`${month}-%`);
}

function getAssignmentForDate(date) {
  return db
    .prepare(
      `SELECT a.date, a.participant_id, p.name AS participant_name,
              p.avatar_icon, p.avatar_color,
        EXISTS(SELECT 1 FROM votes v WHERE v.date = a.date AND v.target_participant_id = a.participant_id) AS has_votes
       FROM assignments a
       JOIN participants p ON p.id = a.participant_id
       WHERE a.date = ?`
    )
    .get(date);
}

function getAssignmentForParticipant(participantId) {
  return db.prepare("SELECT date FROM assignments WHERE participant_id = ?").get(participantId);
}

function setAssignment(date, participantId) {
  if (date < todayStr()) {
    return { ok: false, error: "Impossible d'assigner un jour déjà passé." };
  }

  const existingOnDate = db.prepare("SELECT participant_id FROM assignments WHERE date = ?").get(date);
  if (existingOnDate && hasVotesForDate(date)) {
    return { ok: false, error: "Ce jour a déjà été noté, il ne peut plus être modifié." };
  }

  const existingForParticipant = getAssignmentForParticipant(participantId);
  if (existingForParticipant && existingForParticipant.date !== date) {
    if (hasVotesForDate(existingForParticipant.date)) {
      return { ok: false, error: "Ce participant a déjà été noté, il ne peut plus être déplacé." };
    }
    db.prepare("DELETE FROM assignments WHERE participant_id = ?").run(participantId);
  }

  db.prepare(
    `INSERT INTO assignments (date, participant_id) VALUES (?, ?)
     ON CONFLICT(date) DO UPDATE SET participant_id = excluded.participant_id`
  ).run(date, participantId);

  return { ok: true };
}

function deleteAssignment(date) {
  if (hasVotesForDate(date)) {
    return { ok: false, error: "Ce jour a déjà été noté, il ne peut plus être retiré." };
  }
  db.prepare("DELETE FROM assignments WHERE date = ?").run(date);
  return { ok: true };
}

// --- Critères de notation ---

function listCriteria() {
  return db
    .prepare(
      `SELECT c.id, c.label, c.max_note, c.position,
        EXISTS(SELECT 1 FROM votes v WHERE v.criterion_id = c.id) AS has_votes
       FROM criteria c
       ORDER BY c.position ASC, c.id ASC`
    )
    .all();
}

function criterionHasVotes(id) {
  return db.prepare("SELECT COUNT(*) AS n FROM votes WHERE criterion_id = ?").get(id).n > 0;
}

function addCriterion(label, maxNote) {
  const maxPos = db.prepare("SELECT COALESCE(MAX(position), -1) AS m FROM criteria").get().m;
  const result = db
    .prepare("INSERT INTO criteria (label, max_note, position) VALUES (?, ?, ?)")
    .run(label, maxNote, maxPos + 1);
  return { id: result.lastInsertRowid, label, max_note: maxNote, position: maxPos + 1 };
}

function updateCriterion(id, label, maxNote) {
  db.prepare("UPDATE criteria SET label = ?, max_note = ? WHERE id = ?").run(label, maxNote, id);
}

function deleteCriterion(id) {
  if (criterionHasVotes(id)) {
    return { ok: false, error: "Ce critère a déjà été utilisé, il ne peut plus être supprimé." };
  }
  db.prepare("DELETE FROM criteria WHERE id = ?").run(id);
  return { ok: true };
}

function moveCriterion(id, direction) {
  if (criterionHasVotes(id)) {
    return { ok: false, error: "L'ordre des critères est verrouillé dès qu'une note existe." };
  }

  const list = listCriteria();
  const index = list.findIndex((c) => c.id === id);
  if (index === -1) return { ok: false, error: "Critère introuvable." };

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= list.length) return { ok: true };

  const current = list[index];
  const swapWith = list[swapIndex];

  const updateStmt = db.prepare("UPDATE criteria SET position = ? WHERE id = ?");
  const tx = db.transaction(() => {
    updateStmt.run(swapWith.position, current.id);
    updateStmt.run(current.position, swapWith.id);
  });
  tx();
  return { ok: true };
}

// --- Votes ---

function submitVotes(date, voterParticipantId, targetParticipantId, scores) {
  const upsert = db.prepare(
    `INSERT INTO votes (date, voter_participant_id, target_participant_id, criterion_id, score)
     VALUES (@date, @voter, @target, @criterion, @score)
     ON CONFLICT(date, voter_participant_id, criterion_id)
     DO UPDATE SET score = excluded.score, target_participant_id = excluded.target_participant_id`
  );

  const tx = db.transaction((items) => {
    items.forEach((item) => {
      upsert.run({
        date,
        voter: voterParticipantId,
        target: targetParticipantId,
        criterion: item.criterion_id,
        score: item.score,
      });
    });
  });
  tx(scores);
}

function hasVotedToday(date, voterParticipantId) {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM votes WHERE date = ? AND voter_participant_id = ?")
    .get(date, voterParticipantId);
  return row.n > 0;
}

function listVotersForDateTarget(date, targetParticipantId) {
  return db
    .prepare(
      "SELECT DISTINCT voter_participant_id AS id FROM votes WHERE date = ? AND target_participant_id = ?"
    )
    .all(date, targetParticipantId)
    .map((r) => r.id);
}

function listVotes() {
  return db
    .prepare(
      `SELECT v.id, v.date, v.score,
              v.voter_participant_id, vp.name AS voter_name,
              v.target_participant_id, tp.name AS target_name,
              v.criterion_id, c.label AS criterion_label, c.max_note
       FROM votes v
       JOIN participants vp ON vp.id = v.voter_participant_id
       JOIN participants tp ON tp.id = v.target_participant_id
       JOIN criteria c ON c.id = v.criterion_id
       ORDER BY v.date DESC, v.id DESC`
    )
    .all();
}

// --- Statut de la partie ---

function computeGameStatus() {
  const participants = db.prepare("SELECT id FROM participants").all();
  if (participants.length < 2) return { complete: false };

  const assignmentRows = db.prepare("SELECT participant_id, date FROM assignments").all();
  const assignmentByParticipant = {};
  assignmentRows.forEach((r) => (assignmentByParticipant[r.participant_id] = r.date));

  for (const p of participants) {
    if (!assignmentByParticipant[p.id]) return { complete: false };
  }

  for (const p of participants) {
    const date = assignmentByParticipant[p.id];
    const expectedVoterIds = participants.filter((x) => x.id !== p.id).map((x) => x.id);
    const actualVoterIds = listVotersForDateTarget(date, p.id);
    const missing = expectedVoterIds.filter((id) => !actualVoterIds.includes(id));
    if (missing.length > 0) return { complete: false };
  }

  return { complete: true };
}

function getResults() {
  const rows = db
    .prepare(
      `SELECT v.target_participant_id, v.criterion_id, v.voter_participant_id, v.score,
              c.label AS criterion_label, c.max_note, c.position,
              vp.name AS voter_name
       FROM votes v
       JOIN criteria c ON c.id = v.criterion_id
       JOIN participants vp ON vp.id = v.voter_participant_id
       ORDER BY c.position ASC, c.id ASC`
    )
    .all();

  const byParticipant = {};
  rows.forEach((r) => {
    if (!byParticipant[r.target_participant_id]) byParticipant[r.target_participant_id] = [];
    byParticipant[r.target_participant_id].push(r);
  });

  const results = Object.entries(byParticipant).map(([targetId, voteRows]) => {
    const participant = getParticipant(Number(targetId));

    const ratios = voteRows.map((r) => r.score / r.max_note);
    const overallRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;

    const byCriterion = {};
    voteRows.forEach((r) => {
      if (!byCriterion[r.criterion_id]) {
        byCriterion[r.criterion_id] = { label: r.criterion_label, max_note: r.max_note, votes: [] };
      }
      byCriterion[r.criterion_id].votes.push({ voter_name: r.voter_name, score: r.score });
    });

    const criteriaBreakdown = Object.values(byCriterion).map((c) => ({
      label: c.label,
      max_note: c.max_note,
      votes: c.votes,
      average: Math.round((c.votes.reduce((a, b) => a + b.score, 0) / c.votes.length) * 10) / 10,
    }));

    return {
      participant_id: Number(targetId),
      participant_name: participant ? participant.name : "?",
      avatar_icon: participant ? participant.avatar_icon : "👤",
      avatar_color: participant ? participant.avatar_color : "#e8a33d",
      overall_average_out_of_10: Math.round(overallRatio * 100) / 10,
      criteria: criteriaBreakdown,
    };
  });

  results.sort((a, b) => b.overall_average_out_of_10 - a.overall_average_out_of_10);
  return results;
}

// --- Reset total ---

function resetDatabase() {
  db.exec(`
    DELETE FROM votes;
    DELETE FROM assignments;
    DELETE FROM criteria;
    DELETE FROM participants;
    DELETE FROM sqlite_sequence WHERE name IN ('participants', 'criteria', 'votes');
  `);
}

module.exports = {
  todayStr,
  listParticipants,
  getParticipant,
  addParticipant,
  renameParticipant,
  setParticipantAvatar,
  deleteParticipant,
  listAssignmentsForMonth,
  getAssignmentForDate,
  getAssignmentForParticipant,
  setAssignment,
  deleteAssignment,
  listCriteria,
  addCriterion,
  updateCriterion,
  deleteCriterion,
  moveCriterion,
  submitVotes,
  hasVotedToday,
  listVotersForDateTarget,
  listVotes,
  computeGameStatus,
  getResults,
  resetDatabase,
};