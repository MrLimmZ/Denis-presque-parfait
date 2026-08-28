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

// --- Migrations légères (colonnes ajoutées après coup, rétrocompatibles) ---
const participantColumns = db.prepare("PRAGMA table_info(participants)").all().map((c) => c.name);
if (!participantColumns.includes("avatar_icon")) {
  db.exec(`ALTER TABLE participants ADD COLUMN avatar_icon TEXT NOT NULL DEFAULT '👤'`);
}
if (!participantColumns.includes("avatar_color")) {
  db.exec(`ALTER TABLE participants ADD COLUMN avatar_color TEXT NOT NULL DEFAULT '#02413B'`);
}
if (!participantColumns.includes("avatar_image")) {
  db.exec(`ALTER TABLE participants ADD COLUMN avatar_image TEXT DEFAULT NULL`);
}

const criteriaColumns = db.prepare("PRAGMA table_info(criteria)").all().map((c) => c.name);
if (!criteriaColumns.includes("coefficient")) {
  db.exec(`ALTER TABLE criteria ADD COLUMN coefficient REAL NOT NULL DEFAULT 1`);
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

function totalVotesCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM votes").get().n;
}

// --- Avatars ---

// 4 familles de teintes (vert/sarcelle, bleu, violet, rose), 4 variantes claires/foncées
// chacune. Doit rester identique à AVATAR_COLORS dans public/avatar.js
const AVATAR_COLOR_PALETTE = [
  "#012C27", "#02413B", "#0B5C52", "#157A6C",
  "#123A5C", "#1B6E96", "#2A9CD1", "#4FB2DE",
  "#3B1D57", "#623291", "#7C4AB0", "#8C5CC0",
  "#7A0041", "#A5005C", "#DE0076", "#F03D93",
];

function pickNextAvatarColor() {
  const used = db.prepare("SELECT avatar_color FROM participants").all().map((r) => r.avatar_color);
  const usedSet = new Set(used);
  const firstUnused = AVATAR_COLOR_PALETTE.find((c) => !usedSet.has(c));
  if (firstUnused) return firstUnused;
  // Palette épuisée : on cycle en reprenant la couleur la moins récemment utilisée
  return AVATAR_COLOR_PALETTE[used.length % AVATAR_COLOR_PALETTE.length];
}

// --- Participants ---

function findParticipantByName(name) {
  return db.prepare("SELECT id FROM participants WHERE LOWER(name) = LOWER(?)").get(name.trim());
}

function listParticipants() {
  return db
    .prepare(
      `SELECT p.id, p.name, p.avatar_icon, p.avatar_color, p.avatar_image,
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
    .prepare("SELECT id, name, avatar_icon, avatar_color, avatar_image FROM participants WHERE id = ?")
    .get(id);
}

function addParticipant(name) {
  const trimmed = name.trim();
  const existing = findParticipantByName(trimmed);
  if (existing) {
    return { ok: false, error: `Un participant nommé "${trimmed}" existe déjà.` };
  }

  const color = pickNextAvatarColor();
  const result = db
    .prepare("INSERT INTO participants (name, avatar_color) VALUES (?, ?)")
    .run(trimmed, color);

  return { ok: true, participant: getParticipant(result.lastInsertRowid) };
}

function renameParticipant(id, name) {
  const trimmed = name.trim();
  const existing = findParticipantByName(trimmed);
  if (existing && existing.id !== id) {
    return { ok: false, error: `Un participant nommé "${trimmed}" existe déjà.` };
  }
  db.prepare("UPDATE participants SET name = ? WHERE id = ?").run(trimmed, id);
  return { ok: true };
}

// Choisir une couleur retire automatiquement la photo (les deux modes sont exclusifs).
function setParticipantAvatarColor(id, color) {
  db.prepare("UPDATE participants SET avatar_color = ?, avatar_image = NULL WHERE id = ?").run(color, id);
}

// image = data URL base64 (déjà recadrée/compressée côté client), ou null pour la retirer.
function setParticipantAvatarImage(id, image) {
  db.prepare("UPDATE participants SET avatar_image = ? WHERE id = ?").run(image, id);
}

function deleteParticipant(id) {
  db.prepare("DELETE FROM participants WHERE id = ?").run(id);
}

function listUnassignedParticipants() {
  return db
    .prepare(
      `SELECT p.id, p.name FROM participants p
       WHERE NOT EXISTS (SELECT 1 FROM assignments a WHERE a.participant_id = p.id)
       ORDER BY p.id ASC`
    )
    .all();
}

// --- Assignations (calendrier) ---

function listAssignmentsForMonth(month) {
  return db
    .prepare(
      `SELECT a.date, a.participant_id, p.name AS participant_name,
              p.avatar_icon, p.avatar_color, p.avatar_image,
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
              p.avatar_icon, p.avatar_color, p.avatar_image,
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

// Assigne aléatoirement les participants sans date à des jours futurs disponibles.
function autoAssignUnassigned(daysAhead = 120) {
  const unassigned = listUnassignedParticipants();
  if (unassigned.length === 0) return { assigned: [] };

  const takenDates = new Set(db.prepare("SELECT date FROM assignments").all().map((r) => r.date));
  const start = new Date();
  const candidateDates = [];

  for (let i = 0; candidateDates.length < unassigned.length && i < daysAhead; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const ds = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    if (!takenDates.has(ds)) candidateDates.push(ds);
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const shuffledParticipants = shuffle(unassigned);
  const shuffledDates = shuffle(candidateDates);
  const assigned = [];

  shuffledParticipants.forEach((p, idx) => {
    const date = shuffledDates[idx];
    if (!date) return;
    const result = setAssignment(date, p.id);
    if (result.ok) assigned.push({ participant_id: p.id, date });
  });

  return { assigned };
}

// --- Critères de notation ---

function listCriteria() {
  return db
    .prepare(
      `SELECT c.id, c.label, c.max_note, c.position, c.coefficient,
        EXISTS(SELECT 1 FROM votes v WHERE v.criterion_id = c.id) AS has_votes
       FROM criteria c
       ORDER BY c.position ASC, c.id ASC`
    )
    .all();
}

function criterionHasVotes(id) {
  return db.prepare("SELECT COUNT(*) AS n FROM votes WHERE criterion_id = ?").get(id).n > 0;
}

function addCriterion(label, maxNote, coefficient = 1) {
  const maxPos = db.prepare("SELECT COALESCE(MAX(position), -1) AS m FROM criteria").get().m;
  const result = db
    .prepare("INSERT INTO criteria (label, max_note, position, coefficient) VALUES (?, ?, ?, ?)")
    .run(label, maxNote, maxPos + 1, coefficient);
  return { id: result.lastInsertRowid, label, max_note: maxNote, position: maxPos + 1, coefficient };
}

function updateCriterion(id, label, maxNote, coefficient = 1) {
  db.prepare("UPDATE criteria SET label = ?, max_note = ?, coefficient = ? WHERE id = ?").run(
    label,
    maxNote,
    coefficient,
    id
  );
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
              v.criterion_id, c.label AS criterion_label, c.max_note, c.coefficient
       FROM votes v
       JOIN participants vp ON vp.id = v.voter_participant_id
       JOIN participants tp ON tp.id = v.target_participant_id
       JOIN criteria c ON c.id = v.criterion_id
       ORDER BY v.date DESC, v.id DESC`
    )
    .all();
}

// --- Statut de configuration (wizard admin) ---

function getSetupStatus() {
  const participantsCount = db.prepare("SELECT COUNT(*) AS n FROM participants").get().n;
  const unassignedCount = listUnassignedParticipants().length;
  const criteriaCount = db.prepare("SELECT COUNT(*) AS n FROM criteria").get().n;
  const hasStarted = totalVotesCount() > 0;

  return { participantsCount, unassignedCount, criteriaCount, hasStarted };
}

// --- Statut de la partie (fin de partie / résultats) ---

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

// Classement pondéré : chaque critère compte proportionnellement à son coefficient
function getResults() {
  const rows = db
    .prepare(
      `SELECT v.target_participant_id, v.criterion_id, v.voter_participant_id, v.score,
              c.label AS criterion_label, c.max_note, c.position, c.coefficient,
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

    const weightedSum = voteRows.reduce((sum, r) => sum + (r.score / r.max_note) * r.coefficient, 0);
    const weightTotal = voteRows.reduce((sum, r) => sum + r.coefficient, 0);
    const overallRatio = weightTotal > 0 ? weightedSum / weightTotal : 0;

    const byCriterion = {};
    voteRows.forEach((r) => {
      if (!byCriterion[r.criterion_id]) {
        byCriterion[r.criterion_id] = {
          label: r.criterion_label,
          max_note: r.max_note,
          coefficient: r.coefficient,
          votes: [],
        };
      }
      byCriterion[r.criterion_id].votes.push({ voter_name: r.voter_name, score: r.score });
    });

    const criteriaBreakdown = Object.values(byCriterion).map((c) => ({
      label: c.label,
      max_note: c.max_note,
      coefficient: c.coefficient,
      votes: c.votes,
      average: Math.round((c.votes.reduce((a, b) => a + b.score, 0) / c.votes.length) * 10) / 10,
    }));

    return {
      participant_id: Number(targetId),
      participant_name: participant ? participant.name : "?",
      avatar_icon: participant ? participant.avatar_icon : "👤",
      avatar_color: participant ? participant.avatar_color : "#02413B",
      avatar_image: participant ? participant.avatar_image : null,
      overall_average_out_of_10: Math.round(overallRatio * 100) / 10,
      criteria: criteriaBreakdown,
    };
  });

  results.sort((a, b) => b.overall_average_out_of_10 - a.overall_average_out_of_10);
  return results;
}

// --- Reset total ---

function resetDatabase() {
  const tx = db.transaction(() => {
    db.exec(`
      DELETE FROM votes;
      DELETE FROM assignments;
      DELETE FROM criteria;
      DELETE FROM participants;
    `);

    const seqTableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'")
      .get();
    if (seqTableExists) {
      db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('participants', 'criteria', 'votes');`);
    }
  });
  tx();
}

module.exports = {
  todayStr,
  listParticipants,
  getParticipant,
  addParticipant,
  renameParticipant,
  setParticipantAvatarColor,
  setParticipantAvatarImage,
  deleteParticipant,
  listUnassignedParticipants,
  listAssignmentsForMonth,
  getAssignmentForDate,
  getAssignmentForParticipant,
  setAssignment,
  deleteAssignment,
  autoAssignUnassigned,
  listCriteria,
  addCriterion,
  updateCriterion,
  deleteCriterion,
  moveCriterion,
  submitVotes,
  hasVotedToday,
  listVotersForDateTarget,
  listVotes,
  getSetupStatus,
  computeGameStatus,
  getResults,
  resetDatabase,
};