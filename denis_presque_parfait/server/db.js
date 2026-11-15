const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || (fs.existsSync("/data") ? "/data" : path.join(__dirname, "data"));
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "denis.db");
const db = new Database(DB_PATH);

// Schéma historique (v0). Les évolutions sont appliquées ensuite par les
// migrations versionnées (PRAGMA user_version), y compris sur une base neuve.
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

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS absences (
    date TEXT NOT NULL,
    voter_participant_id INTEGER NOT NULL,
    target_participant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (date, voter_participant_id, target_participant_id)
  );

  CREATE TABLE IF NOT EXISTS editions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT,
    archived_at TEXT DEFAULT (datetime('now')),
    participants_json TEXT NOT NULL,
    criteria_json TEXT NOT NULL,
    results_json TEXT NOT NULL
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

// --- Migrations versionnées ---
// v1 : mode équipes. Le "cuisinier" d'un jour peut être une personne (mode solo)
// ou une équipe (mode équipes) : assignations, votes et absences peuvent viser
// l'un ou l'autre. Les tables sont reconstruites (SQLite ne sait pas relâcher une
// contrainte NOT NULL) en conservant toutes les données existantes.
// Positionné par la migration v2, traité en fin de module (voir plus bas).
let legacyBonusCheck = false;

const MIGRATIONS = [
  () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS teams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        avatar_color TEXT NOT NULL DEFAULT '#DE0076',
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    const pCols = db.prepare("PRAGMA table_info(participants)").all().map((c) => c.name);
    if (!pCols.includes("team_id")) db.exec(`ALTER TABLE participants ADD COLUMN team_id INTEGER DEFAULT NULL`);

    db.exec(`
      CREATE TABLE assignments_v1 (
        date TEXT PRIMARY KEY,
        participant_id INTEGER UNIQUE,
        team_id INTEGER UNIQUE
      );
      INSERT INTO assignments_v1 (date, participant_id) SELECT date, participant_id FROM assignments;
      DROP TABLE assignments;
      ALTER TABLE assignments_v1 RENAME TO assignments;

      CREATE TABLE votes_v1 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        voter_participant_id INTEGER NOT NULL,
        target_participant_id INTEGER,
        target_team_id INTEGER,
        criterion_id INTEGER NOT NULL,
        score INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(date, voter_participant_id, criterion_id)
      );
      INSERT INTO votes_v1 (id, date, voter_participant_id, target_participant_id, criterion_id, score, created_at)
        SELECT id, date, voter_participant_id, target_participant_id, criterion_id, score, created_at FROM votes;
      DROP TABLE votes;
      ALTER TABLE votes_v1 RENAME TO votes;

      CREATE TABLE absences_v1 (
        date TEXT NOT NULL,
        voter_participant_id INTEGER NOT NULL,
        target_participant_id INTEGER,
        target_team_id INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (date, voter_participant_id)
      );
      INSERT OR IGNORE INTO absences_v1 (date, voter_participant_id, target_participant_id, created_at)
        SELECT date, voter_participant_id, target_participant_id, created_at FROM absences;
      DROP TABLE absences;
      ALTER TABLE absences_v1 RENAME TO absences;
    `);

    const eCols = db.prepare("PRAGMA table_info(editions)").all().map((c) => c.name);
    if (!eCols.includes("mode")) db.exec(`ALTER TABLE editions ADD COLUMN mode TEXT NOT NULL DEFAULT 'solo'`);
  },
  // v2 : point bonus. Une fois tous les repas notés, chacun donne un point bonus
  // secret à un autre cuisinier (personne ou équipe, jamais soi-même).
  () => {
    legacyBonusCheck = true;
    db.exec(`
      CREATE TABLE IF NOT EXISTS bonus_votes (
        voter_participant_id INTEGER PRIMARY KEY,
        target_id INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
  },
  // v3 : catégorie de critère (ex : "Plat", "Dessert") pour noter chaque type de
  // plat séparément et afficher une note par catégorie.
  () => {
    const cCols = db.prepare("PRAGMA table_info(criteria)").all().map((c) => c.name);
    if (!cCols.includes("category")) db.exec(`ALTER TABLE criteria ADD COLUMN category TEXT DEFAULT NULL`);
  },
  // v4 : avatars par thème (ex : avatar de Noël). L'avatar de base reste dans
  // participants.avatar_image et sert de repli quand un thème n'a pas d'image.
  () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS participant_theme_avatars (
        participant_id INTEGER NOT NULL,
        theme TEXT NOT NULL,
        image TEXT NOT NULL,
        PRIMARY KEY (participant_id, theme)
      );
    `);
  },
];

(function runMigrations() {
  const current = db.pragma("user_version", { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      MIGRATIONS[v]();
      db.pragma(`user_version = ${v + 1}`);
    })();
    console.log(`[DB] Migration v${v + 1} appliquée.`);
  }
})();

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

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function resetSequences(names) {
  const seqTableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'")
    .get();
  if (!seqTableExists || names.length === 0) return;
  db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${names.map(() => "?").join(", ")})`).run(...names);
}

// --- Réglages (clé/valeur) ---

function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

// --- Thème visuel ---
// "classic" utilise les avatars de base ; les autres thèmes peuvent avoir leurs
// propres avatars (table participant_theme_avatars), avec repli sur l'avatar de base.

const THEMES = ["classic", "christmas"];

function getTheme() {
  const theme = getSetting("theme");
  return THEMES.includes(theme) ? theme : "classic";
}

function setTheme(theme) {
  if (!THEMES.includes(theme)) return { ok: false, error: "Thème inconnu." };
  setSetting("theme", theme);
  return { ok: true };
}

// Remplace avatar_image par l'avatar du thème actif quand il existe, et indique
// au panel si la photo affichée est propre au thème (avatar_themed).
function withThemedAvatars(rows) {
  const theme = getTheme();
  if (theme === "classic") return rows.map((r) => ({ ...r, avatar_themed: false }));
  const themed = new Map(
    db.prepare("SELECT participant_id, image FROM participant_theme_avatars WHERE theme = ?")
      .all(theme)
      .map((r) => [r.participant_id, r.image])
  );
  return rows.map((r) =>
    themed.has(r.id) ? { ...r, avatar_image: themed.get(r.id), avatar_themed: true } : { ...r, avatar_themed: false }
  );
}

// --- Mode de jeu (solo / équipes) ---
// En solo, chaque jour est attribué à une personne ; en équipes, à une équipe
// (tous ses membres cuisinent ensemble et ne votent pas pour eux-mêmes).

function getMode() {
  return getSetting("game_mode") === "teams" ? "teams" : "solo";
}

function setMode(mode) {
  if (mode !== "solo" && mode !== "teams") return { ok: false, error: "Mode de jeu inconnu." };
  if (mode === getMode()) return { ok: true };
  if (totalVotesCount() > 0) {
    return { ok: false, error: "La partie a commencé, le mode de jeu ne peut plus changer." };
  }
  // Les jours étaient attribués à des personnes (ou à des équipes) : on repart
  // d'un calendrier vide dans le nouveau mode.
  db.transaction(() => {
    db.exec("DELETE FROM assignments; DELETE FROM absences;");
    setSetting("game_mode", mode);
  })();
  return { ok: true };
}

const isTeams = () => getMode() === "teams";
const cookColumn = () => (isTeams() ? "team_id" : "participant_id");
const targetColumn = () => (isTeams() ? "target_team_id" : "target_participant_id");

// --- Avatars ---

// 4 familles de teintes (vert/sarcelle, bleu, violet, rose), 4 variantes claires/foncées
// chacune. Doit rester identique à AVATAR_COLORS dans public/avatar.js
const AVATAR_COLOR_PALETTE = [
  "#012C27", "#02413B", "#0B5C52", "#157A6C",
  "#123A5C", "#1B6E96", "#2A9CD1", "#4FB2DE",
  "#3B1D57", "#623291", "#7C4AB0", "#8C5CC0",
  "#7A0041", "#A5005C", "#DE0076", "#F03D93",
];

// Couleurs des équipes : on alterne les familles pour que deux équipes voisines
// soient bien distinctes.
const TEAM_COLOR_PALETTE = [
  "#DE0076", "#2A9CD1", "#7C4AB0", "#157A6C",
  "#F03D93", "#1B6E96", "#623291", "#0B5C52",
];

function pickNextColor(table, palette) {
  const used = db.prepare(`SELECT avatar_color FROM ${table}`).all().map((r) => r.avatar_color);
  const usedSet = new Set(used);
  const firstUnused = palette.find((c) => !usedSet.has(c));
  if (firstUnused) return firstUnused;
  return palette[used.length % palette.length];
}

// --- Participants ---

function findParticipantByName(name) {
  return db.prepare("SELECT id FROM participants WHERE LOWER(name) = LOWER(?)").get(name.trim());
}

function listParticipants() {
  return withThemedAvatars(
    db
      .prepare(
        `SELECT id, name, avatar_icon, avatar_color, avatar_image, team_id
         FROM participants
         ORDER BY id ASC`
      )
      .all()
  );
}

function getParticipant(id) {
  const row = db
    .prepare("SELECT id, name, avatar_icon, avatar_color, avatar_image, team_id FROM participants WHERE id = ?")
    .get(id);
  return row ? withThemedAvatars([row])[0] : undefined;
}

function addParticipant(name) {
  const trimmed = name.trim();
  const existing = findParticipantByName(trimmed);
  if (existing) {
    return { ok: false, error: `Un participant nommé "${trimmed}" existe déjà.` };
  }

  const color = pickNextColor("participants", AVATAR_COLOR_PALETTE);
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

// Choisir une couleur remplace la photo du thème actif (la couleur, elle, est
// commune à tous les thèmes).
function setParticipantAvatarColor(id, color) {
  const theme = getTheme();
  db.transaction(() => {
    if (theme === "classic") {
      db.prepare("UPDATE participants SET avatar_color = ?, avatar_image = NULL WHERE id = ?").run(color, id);
    } else {
      db.prepare("UPDATE participants SET avatar_color = ? WHERE id = ?").run(color, id);
      db.prepare("DELETE FROM participant_theme_avatars WHERE participant_id = ? AND theme = ?").run(id, theme);
    }
  })();
}

// La photo importée (ou retirée, image = null) concerne le thème actif.
function setParticipantAvatarImage(id, image) {
  const theme = getTheme();
  if (theme === "classic") {
    db.prepare("UPDATE participants SET avatar_image = ? WHERE id = ?").run(image, id);
  } else if (image) {
    db.prepare(
      `INSERT INTO participant_theme_avatars (participant_id, theme, image) VALUES (?, ?, ?)
       ON CONFLICT(participant_id, theme) DO UPDATE SET image = excluded.image`
    ).run(id, theme, image);
  } else {
    db.prepare("DELETE FROM participant_theme_avatars WHERE participant_id = ? AND theme = ?").run(id, theme);
  }
}

function deleteParticipant(id) {
  db.transaction(() => {
    db.prepare("DELETE FROM assignments WHERE participant_id = ?").run(id);
    db.prepare("DELETE FROM participant_theme_avatars WHERE participant_id = ?").run(id);
    db.prepare("DELETE FROM participants WHERE id = ?").run(id);
  })();
}

// --- Équipes ---

function publicMember(p) {
  return { id: p.id, name: p.name, avatar_icon: p.avatar_icon, avatar_color: p.avatar_color, avatar_image: p.avatar_image };
}

function listTeams() {
  const teams = db.prepare("SELECT id, name, avatar_color FROM teams ORDER BY id ASC").all();
  const members = withThemedAvatars(
    db
      .prepare("SELECT id, name, avatar_icon, avatar_color, avatar_image, team_id FROM participants WHERE team_id IS NOT NULL ORDER BY id ASC")
      .all()
  );
  return teams.map((t) => ({
    ...t,
    avatar_image: null,
    members: members.filter((m) => m.team_id === t.id).map(publicMember),
  }));
}

function getTeam(id) {
  return listTeams().find((t) => t.id === Number(id)) || null;
}

function teamsAreFrozen() {
  return totalVotesCount() > 0;
}

const FROZEN_TEAMS_ERROR = "La partie a commencé, les équipes ne peuvent plus changer.";

function addTeam(name) {
  if (teamsAreFrozen()) return { ok: false, error: FROZEN_TEAMS_ERROR };
  const trimmed = (name || "").trim();
  if (!trimmed) return { ok: false, error: "Donne un nom à l'équipe." };
  const existing = db.prepare("SELECT id FROM teams WHERE LOWER(name) = LOWER(?)").get(trimmed);
  if (existing) return { ok: false, error: `Une équipe nommée "${trimmed}" existe déjà.` };
  const color = pickNextColor("teams", TEAM_COLOR_PALETTE);
  const result = db.prepare("INSERT INTO teams (name, avatar_color) VALUES (?, ?)").run(trimmed, color);
  return { ok: true, id: result.lastInsertRowid };
}

function renameTeam(id, name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return { ok: false, error: "Le nom de l'équipe ne peut pas être vide." };
  const existing = db.prepare("SELECT id FROM teams WHERE LOWER(name) = LOWER(?)").get(trimmed);
  if (existing && existing.id !== Number(id)) return { ok: false, error: `Une équipe nommée "${trimmed}" existe déjà.` };
  db.prepare("UPDATE teams SET name = ? WHERE id = ?").run(trimmed, id);
  return { ok: true };
}

function setTeamColor(id, color) {
  db.prepare("UPDATE teams SET avatar_color = ? WHERE id = ?").run(color, id);
  return { ok: true };
}

function deleteTeam(id) {
  if (teamsAreFrozen()) return { ok: false, error: FROZEN_TEAMS_ERROR };
  db.transaction(() => {
    db.prepare("UPDATE participants SET team_id = NULL WHERE team_id = ?").run(id);
    db.prepare("DELETE FROM assignments WHERE team_id = ?").run(id);
    db.prepare("DELETE FROM teams WHERE id = ?").run(id);
  })();
  return { ok: true };
}

function setParticipantTeam(participantId, teamId) {
  if (teamsAreFrozen()) return { ok: false, error: FROZEN_TEAMS_ERROR };
  if (teamId !== null && !db.prepare("SELECT id FROM teams WHERE id = ?").get(teamId)) {
    return { ok: false, error: "Équipe introuvable." };
  }
  db.prepare("UPDATE participants SET team_id = ? WHERE id = ?").run(teamId, participantId);
  return { ok: true };
}

// Tirage au sort : répartit tous les participants dans `count` équipes, de tailles
// aussi égales que possible. Les équipes existantes (et leurs noms) sont réutilisées,
// les manquantes créées, les surnuméraires supprimées.
function randomizeTeams(count) {
  if (teamsAreFrozen()) return { ok: false, error: FROZEN_TEAMS_ERROR };
  const participants = listParticipants();
  const n = Math.round(Number(count));
  if (!Number.isFinite(n) || n < 2) return { ok: false, error: "Il faut au moins 2 équipes." };
  if (participants.length < n) {
    return { ok: false, error: `Impossible de faire ${n} équipes avec ${participants.length} participants.` };
  }

  db.transaction(() => {
    let teams = db.prepare("SELECT id FROM teams ORDER BY id ASC").all().map((t) => t.id);
    teams.slice(n).forEach((id) => {
      db.prepare("DELETE FROM assignments WHERE team_id = ?").run(id);
      db.prepare("DELETE FROM teams WHERE id = ?").run(id);
    });
    teams = teams.slice(0, n);
    while (teams.length < n) {
      let index = teams.length + 1;
      let name = `Équipe ${index}`;
      while (db.prepare("SELECT id FROM teams WHERE LOWER(name) = LOWER(?)").get(name)) name = `Équipe ${++index}`;
      const color = pickNextColor("teams", TEAM_COLOR_PALETTE);
      teams.push(db.prepare("INSERT INTO teams (name, avatar_color) VALUES (?, ?)").run(name, color).lastInsertRowid);
    }
    const update = db.prepare("UPDATE participants SET team_id = ? WHERE id = ?");
    shuffle(participants).forEach((p, i) => update.run(teams[i % n], p.id));
  })();
  return { ok: true };
}

// --- "Cuisiniers" (personne en solo, équipe en mode équipes) ---
// Forme normalisée envoyée aux clients : le calendrier, la page de jeu et les
// résultats manipulent un cuisinier sans se soucier du mode.
//   { kind, cook_id, cook_name, avatar_icon, avatar_color, avatar_image, members[] }
// En solo, members = [la personne elle-même] : "est-ce que je cuisine ?" et "qui
// doit voter ?" s'écrivent alors pareil dans les deux modes.

function cookFromParticipant(p) {
  return {
    kind: "participant",
    cook_id: p.id,
    cook_name: p.name,
    avatar_icon: p.avatar_icon,
    avatar_color: p.avatar_color,
    avatar_image: p.avatar_image,
    members: [publicMember(p)],
  };
}

function cookFromTeam(t) {
  return {
    kind: "team",
    cook_id: t.id,
    cook_name: t.name,
    avatar_icon: null,
    avatar_color: t.avatar_color,
    avatar_image: null,
    members: t.members,
  };
}

function listCooks() {
  return isTeams() ? listTeams().map(cookFromTeam) : listParticipants().map(cookFromParticipant);
}

function getCook(id) {
  return listCooks().find((c) => c.cook_id === Number(id)) || null;
}

function listUnassignedCooks() {
  const col = cookColumn();
  const assigned = new Set(
    db.prepare(`SELECT ${col} AS id FROM assignments WHERE ${col} IS NOT NULL`).all().map((r) => r.id)
  );
  return listCooks().filter((c) => !assigned.has(c.cook_id));
}

// --- Assignations (calendrier) ---

function normalizeAssignment(date, cookId, cooksById) {
  const cook = cooksById ? cooksById.get(cookId) : getCook(cookId);
  if (!cook) return null;
  return { date, ...cook, has_votes: hasVotesForDate(date) };
}

function listAssignmentsForMonth(month) {
  const col = cookColumn();
  const cooksById = new Map(listCooks().map((c) => [c.cook_id, c]));
  return db
    .prepare(`SELECT date, ${col} AS cook_id FROM assignments WHERE date LIKE ? AND ${col} IS NOT NULL ORDER BY date ASC`)
    .all(`${month}-%`)
    .map((r) => normalizeAssignment(r.date, r.cook_id, cooksById))
    .filter(Boolean);
}

function getAssignmentForDate(date) {
  const col = cookColumn();
  const row = db.prepare(`SELECT ${col} AS cook_id FROM assignments WHERE date = ? AND ${col} IS NOT NULL`).get(date);
  return row ? normalizeAssignment(date, row.cook_id) : null;
}

// Prochain jour de repas à partir de `date` (inclus), et si l'édition a déjà
// commencé (au moins un jour de repas avant `date`). Sert au compte à rebours.
function getNextMealFrom(date) {
  const col = cookColumn();
  const next = db
    .prepare(`SELECT date FROM assignments WHERE date >= ? AND ${col} IS NOT NULL ORDER BY date ASC LIMIT 1`)
    .get(date);
  const started = !!db.prepare(`SELECT 1 FROM assignments WHERE date < ? AND ${col} IS NOT NULL LIMIT 1`).get(date);
  return { date: next ? next.date : null, started };
}

function getAssignmentForCook(cookId) {
  return db.prepare(`SELECT date FROM assignments WHERE ${cookColumn()} = ?`).get(cookId);
}

function setAssignment(date, cookId) {
  const col = cookColumn();
  cookId = Number(cookId);
  if (date < todayStr()) {
    return { ok: false, error: "Impossible d'assigner un jour déjà passé." };
  }
  if (!getCook(cookId)) {
    return { ok: false, error: isTeams() ? "Équipe introuvable." : "Participant introuvable." };
  }

  const existingOnDate = db.prepare(`SELECT ${col} AS cook_id FROM assignments WHERE date = ?`).get(date);
  if (existingOnDate && existingOnDate.cook_id !== null && hasVotesForDate(date)) {
    return { ok: false, error: "Ce jour a déjà été noté, il ne peut plus être modifié." };
  }

  const existingForCook = getAssignmentForCook(cookId);

  // Échange : le cuisinier déplacé avait déjà un jour, et le jour visé est pris
  // par quelqu'un d'autre -> les deux échangent leurs dates (ex : Axel mardi <->
  // Sonia jeudi), au lieu d'éjecter l'occupant du calendrier.
  if (
    existingOnDate &&
    existingOnDate.cook_id !== null &&
    existingOnDate.cook_id !== cookId &&
    existingForCook &&
    existingForCook.date !== date
  ) {
    return swapAssignments(existingForCook.date, date);
  }

  if (existingForCook && existingForCook.date !== date) {
    if (hasVotesForDate(existingForCook.date)) {
      return {
        ok: false,
        error: isTeams()
          ? "Cette équipe a déjà été notée, elle ne peut plus être déplacée."
          : "Ce participant a déjà été noté, il ne peut plus être déplacé.",
      };
    }
    db.prepare(`DELETE FROM assignments WHERE ${col} = ?`).run(cookId);
  }

  db.prepare(
    `INSERT INTO assignments (date, ${col}) VALUES (?, ?)
     ON CONFLICT(date) DO UPDATE SET participant_id = excluded.participant_id, team_id = excluded.team_id`
  ).run(date, cookId);

  return { ok: true };
}

// Échange les cuisiniers de deux jours. Possible en cours de partie tant qu'aucun
// des deux jours n'a encore reçu de vote et qu'aucun n'est passé.
function swapAssignments(dateA, dateB) {
  const col = cookColumn();
  const today = todayStr();
  if (dateA < today || dateB < today) {
    return { ok: false, error: "Impossible de déplacer un jour déjà passé." };
  }
  if (hasVotesForDate(dateA) || hasVotesForDate(dateB)) {
    return { ok: false, error: "Un de ces jours a déjà été noté, l'échange est impossible." };
  }
  const a = db.prepare(`SELECT ${col} AS cook_id FROM assignments WHERE date = ?`).get(dateA);
  const b = db.prepare(`SELECT ${col} AS cook_id FROM assignments WHERE date = ?`).get(dateB);
  if (!a || !b || a.cook_id === null || b.cook_id === null) {
    return { ok: false, error: "Les deux jours doivent avoir un cuisinier pour être échangés." };
  }

  db.transaction(() => {
    // Les colonnes cuisinier sont UNIQUE : on supprime les deux lignes avant de réinsérer.
    db.prepare("DELETE FROM assignments WHERE date IN (?, ?)").run(dateA, dateB);
    const insert = db.prepare(`INSERT INTO assignments (date, ${col}) VALUES (?, ?)`);
    insert.run(dateA, b.cook_id);
    insert.run(dateB, a.cook_id);
    // Les dispenses d'absence visaient l'ancien cuisinier de ces jours : obsolètes.
    db.prepare("DELETE FROM absences WHERE date IN (?, ?)").run(dateA, dateB);
  })();

  return { ok: true, swapped: [dateA, dateB] };
}

function deleteAssignment(date) {
  if (hasVotesForDate(date)) {
    return { ok: false, error: "Ce jour a déjà été noté, il ne peut plus être retiré." };
  }
  db.prepare("DELETE FROM assignments WHERE date = ?").run(date);
  return { ok: true };
}

function autoAssignUnassigned(daysAhead = 120) {
  const unassigned = listUnassignedCooks();
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

  const shuffledCooks = shuffle(unassigned);
  const shuffledDates = shuffle(candidateDates);
  const assigned = [];

  shuffledCooks.forEach((c, idx) => {
    const date = shuffledDates[idx];
    if (!date) return;
    const result = setAssignment(date, c.cook_id);
    if (result.ok) assigned.push({ cook_id: c.cook_id, date });
  });

  return { assigned };
}

// --- Critères de notation ---

function normalizeCategory(category) {
  const trimmed = typeof category === "string" ? category.trim() : "";
  return trimmed ? trimmed.slice(0, 40) : null;
}

// Regroupe les critères par catégorie (dans l'ordre d'apparition de chaque
// catégorie), sans casser l'ordre choisi par l'admin à l'intérieur d'une catégorie.
// Doit rester identique à orderCriteriaByCategory() dans public/client.js.
function orderByCategory(items, getCategory = (c) => c.category) {
  const order = [];
  items.forEach((c) => {
    const key = getCategory(c) || "";
    if (!order.includes(key)) order.push(key);
  });
  return [...items].sort((a, b) => order.indexOf(getCategory(a) || "") - order.indexOf(getCategory(b) || ""));
}

function listCriteria() {
  const rows = db
    .prepare(
      `SELECT c.id, c.label, c.category, c.max_note, c.position, c.coefficient,
        EXISTS(SELECT 1 FROM votes v WHERE v.criterion_id = c.id) AS has_votes
       FROM criteria c
       ORDER BY c.position ASC, c.id ASC`
    )
    .all();
  return orderByCategory(rows);
}

function criterionHasVotes(id) {
  return db.prepare("SELECT COUNT(*) AS n FROM votes WHERE criterion_id = ?").get(id).n > 0;
}

function addCriterion(label, maxNote, coefficient = 1, category = null) {
  const maxPos = db.prepare("SELECT COALESCE(MAX(position), -1) AS m FROM criteria").get().m;
  const cat = normalizeCategory(category);
  const result = db
    .prepare("INSERT INTO criteria (label, max_note, position, coefficient, category) VALUES (?, ?, ?, ?, ?)")
    .run(label, maxNote, maxPos + 1, coefficient, cat);
  return { id: result.lastInsertRowid, label, category: cat, max_note: maxNote, position: maxPos + 1, coefficient };
}

function updateCriterion(id, label, maxNote, coefficient = 1, category = null) {
  db.prepare("UPDATE criteria SET label = ?, max_note = ?, coefficient = ?, category = ? WHERE id = ?").run(
    label,
    maxNote,
    coefficient,
    normalizeCategory(category),
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
  // L'ordre se règle à l'intérieur d'une catégorie (changer la catégorie pour en sortir).
  if ((current.category || null) !== (swapWith.category || null)) return { ok: true };

  const updateStmt = db.prepare("UPDATE criteria SET position = ? WHERE id = ?");
  const tx = db.transaction(() => {
    updateStmt.run(swapWith.position, current.id);
    updateStmt.run(current.position, swapWith.id);
  });
  tx();
  return { ok: true };
}

// --- Votes ---
// La cible d'un vote est TOUJOURS déduite du calendrier (un seul cuisinier par
// jour) : on ne fait pas confiance à la cible envoyée par le téléphone, qui peut
// être périmée si l'admin vient d'échanger deux jours.

function submitVotes(date, voterParticipantId, scores) {
  const assignment = getAssignmentForDate(date);
  if (!assignment) return { ok: false, error: "Personne ne cuisine ce jour-là." };
  const voterId = Number(voterParticipantId);
  if (assignment.members.some((m) => m.id === voterId)) {
    return { ok: false, error: "Tu ne peux pas noter ton propre repas." };
  }

  const col = targetColumn();
  const upsert = db.prepare(
    `INSERT INTO votes (date, voter_participant_id, ${col}, criterion_id, score)
     VALUES (@date, @voter, @target, @criterion, @score)
     ON CONFLICT(date, voter_participant_id, criterion_id)
     DO UPDATE SET score = excluded.score,
                   target_participant_id = excluded.target_participant_id,
                   target_team_id = excluded.target_team_id`
  );

  db.transaction((items) => {
    items.forEach((item) => {
      upsert.run({ date, voter: voterId, target: assignment.cook_id, criterion: item.criterion_id, score: item.score });
    });
    // Si la personne vote finalement, elle n'est plus "absente" pour ce jour.
    db.prepare("DELETE FROM absences WHERE date = ? AND voter_participant_id = ?").run(date, voterId);
  })(scores);

  return { ok: true, target_id: assignment.cook_id };
}

function hasVotedToday(date, voterParticipantId) {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM votes WHERE date = ? AND voter_participant_id = ?")
    .get(date, voterParticipantId);
  return row.n > 0;
}

function listVoterIdsForDate(date) {
  return db
    .prepare("SELECT DISTINCT voter_participant_id AS id FROM votes WHERE date = ?")
    .all(date)
    .map((r) => r.id);
}

function listVotes() {
  return db
    .prepare(
      `SELECT v.id, v.date, v.score,
              v.voter_participant_id, vp.name AS voter_name,
              COALESCE(v.target_team_id, v.target_participant_id) AS target_id,
              COALESCE(t.name, tp.name) AS target_name,
              CASE WHEN v.target_team_id IS NOT NULL THEN 'team' ELSE 'participant' END AS target_kind,
              v.criterion_id, c.label AS criterion_label, c.max_note, c.coefficient
       FROM votes v
       JOIN participants vp ON vp.id = v.voter_participant_id
       LEFT JOIN participants tp ON tp.id = v.target_participant_id
       LEFT JOIN teams t ON t.id = v.target_team_id
       JOIN criteria c ON c.id = v.criterion_id
       ORDER BY v.date DESC, v.id DESC`
    )
    .all();
}

// --- Absences ---
// Permet de dispenser un votant d'un jour de notation précis (ex: absent ce jour-là)
// afin que la partie puisse quand même être considérée comme terminée.

function markAbsent(date, voterParticipantId) {
  const assignment = getAssignmentForDate(date);
  if (!assignment) return { ok: false, error: "Personne ne cuisine ce jour-là." };
  const voterId = Number(voterParticipantId);
  if (assignment.members.some((m) => m.id === voterId)) {
    return { ok: false, error: "On ne vote pas pour son propre repas, pas besoin de dispense." };
  }
  db.prepare(
    `INSERT INTO absences (date, voter_participant_id, ${targetColumn()})
     VALUES (?, ?, ?)
     ON CONFLICT(date, voter_participant_id) DO NOTHING`
  ).run(date, voterId, assignment.cook_id);
  return { ok: true, target_id: assignment.cook_id };
}

function unmarkAbsent(date, voterParticipantId) {
  db.prepare("DELETE FROM absences WHERE date = ? AND voter_participant_id = ?").run(date, voterParticipantId);
  return { ok: true };
}

function listAbsentVoterIdsForDate(date) {
  return db
    .prepare("SELECT voter_participant_id AS id FROM absences WHERE date = ?")
    .all(date)
    .map((r) => r.id);
}

// --- Statut de configuration (wizard admin) ---

function getSetupStatus() {
  const mode = getMode();
  const participantsCount = db.prepare("SELECT COUNT(*) AS n FROM participants").get().n;
  const criteriaCount = db.prepare("SELECT COUNT(*) AS n FROM criteria").get().n;
  const hasStarted = totalVotesCount() > 0;

  let teamsCount = 0;
  let unteamedCount = 0;
  let emptyTeamsCount = 0;
  if (mode === "teams") {
    const teams = listTeams();
    teamsCount = teams.length;
    emptyTeamsCount = teams.filter((t) => t.members.length === 0).length;
    unteamedCount = db.prepare("SELECT COUNT(*) AS n FROM participants WHERE team_id IS NULL").get().n;
  }
  const teamsReady = mode === "solo" || (teamsCount >= 2 && unteamedCount === 0 && emptyTeamsCount === 0);
  const unassignedCount = listUnassignedCooks().length;

  return {
    mode,
    participantsCount,
    unassignedCount,
    criteriaCount,
    hasStarted,
    teamsCount,
    unteamedCount,
    emptyTeamsCount,
    teamsReady,
  };
}

// --- Statut de la partie (fin de partie / résultats) ---

// Tous les repas ont-ils été notés (ou leurs votants manquants pardonnés) ?
function computeMealsStatus() {
  const participants = db.prepare("SELECT id FROM participants").all();
  if (participants.length < 2) return { complete: false };

  if (!getSetupStatus().teamsReady) return { complete: false };

  const cooks = listCooks();
  if (cooks.length < 2) return { complete: false };

  const col = cookColumn();
  const dateByCook = {};
  db.prepare(`SELECT ${col} AS cook_id, date FROM assignments WHERE ${col} IS NOT NULL`)
    .all()
    .forEach((r) => (dateByCook[r.cook_id] = r.date));

  for (const c of cooks) {
    if (!dateByCook[c.cook_id]) return { complete: false };
  }

  const today = todayStr();

  for (const c of cooks) {
    const date = dateByCook[c.cook_id];

    // Un jour déjà passé (avant aujourd'hui) ne bloque plus la partie même si
    // certains votants n'ont jamais voté (absence, oubli, etc.) : une fois la
    // journée terminée, ces votes manquants sont automatiquement "pardonnés"
    // sans intervention manuelle. Seul le jour en cours (aujourd'hui) exige
    // encore la participation complète, avec possibilité de dispense manuelle
    // immédiate via absences:mark (utile si une absence est connue à l'avance).
    if (date < today) continue;

    const memberIds = new Set(c.members.map((m) => m.id));
    const absentIds = new Set(listAbsentVoterIdsForDate(date));
    const actualVoterIds = new Set(listVoterIdsForDate(date));
    const missing = participants.filter(
      (p) => !memberIds.has(p.id) && !absentIds.has(p.id) && !actualVoterIds.has(p.id)
    );
    if (missing.length > 0) return { complete: false };
  }

  return { complete: true };
}

// --- Point bonus ---
// Phases de la partie : "playing" (repas en cours) -> "bonus" (tous les repas sont
// notés, chacun donne son point bonus) -> "done" (résultats révélés). La phase
// bonus se termine quand tout le monde a voté, ou quand l'admin la clôture.

const BONUS_VALUE = 0.5; // points ajoutés à la note sur 10 par bonus reçu

function getBonusStatus() {
  const participants = db.prepare("SELECT id, name FROM participants ORDER BY id").all();
  const voterIds = db.prepare("SELECT voter_participant_id AS id FROM bonus_votes").all().map((r) => r.id);
  const voted = new Set(voterIds);
  return {
    closed: getSetting("bonus_closed") === "1",
    expected_count: participants.length,
    voted_count: participants.filter((p) => voted.has(p.id)).length,
    voter_ids: voterIds,
    pending: participants.filter((p) => !voted.has(p.id)).map((p) => ({ id: p.id, name: p.name })),
    value: BONUS_VALUE,
  };
}

function computeGameStatus() {
  if (!computeMealsStatus().complete) return { complete: false, phase: "playing" };
  const bonus = getBonusStatus();
  if (bonus.closed || bonus.voted_count >= bonus.expected_count) return { complete: true, phase: "done" };
  return { complete: false, phase: "bonus", bonus };
}

function submitBonus(voterParticipantId, targetId) {
  const status = computeGameStatus();
  if (status.phase !== "bonus") {
    return {
      ok: false,
      error: status.phase === "playing" ? "Le vote bonus s'ouvre quand tous les repas sont notés." : "Le vote bonus est terminé.",
    };
  }
  const voterId = Number(voterParticipantId);
  if (!getParticipant(voterId)) return { ok: false, error: "Participant introuvable." };
  const cook = getCook(targetId);
  if (!cook) return { ok: false, error: "Choix introuvable." };
  if (cook.members.some((m) => m.id === voterId)) {
    return { ok: false, error: "Tu ne peux pas te donner ton propre point bonus." };
  }
  db.prepare(
    `INSERT INTO bonus_votes (voter_participant_id, target_id) VALUES (?, ?)
     ON CONFLICT(voter_participant_id) DO UPDATE SET target_id = excluded.target_id, created_at = datetime('now')`
  ).run(voterId, cook.cook_id);
  return { ok: true };
}

function getBonusVote(voterParticipantId) {
  const row = db.prepare("SELECT target_id FROM bonus_votes WHERE voter_participant_id = ?").get(voterParticipantId);
  return row ? row.target_id : null;
}

function closeBonus() {
  if (computeGameStatus().phase !== "bonus") return { ok: false, error: "Le vote bonus n'est pas en cours." };
  setSetting("bonus_closed", "1");
  return { ok: true };
}

// Classement pondéré : chaque critère compte proportionnellement à son coefficient.
// Les entrées gardent les clés historiques participant_id / participant_name (le
// rendu des résultats et les éditions archivées s'en servent) même quand le
// cuisinier classé est une équipe ; `kind` et `members` précisent de quoi il s'agit.
function getResults() {
  const col = targetColumn();
  const rows = db
    .prepare(
      `SELECT v.${col} AS target_id, v.criterion_id, v.voter_participant_id, v.score,
              c.label AS criterion_label, c.category, c.max_note, c.position, c.coefficient,
              vp.name AS voter_name
       FROM votes v
       JOIN criteria c ON c.id = v.criterion_id
       JOIN participants vp ON vp.id = v.voter_participant_id
       WHERE v.${col} IS NOT NULL
       ORDER BY c.position ASC, c.id ASC`
    )
    .all();

  const byTarget = {};
  rows.forEach((r) => {
    if (!byTarget[r.target_id]) byTarget[r.target_id] = [];
    byTarget[r.target_id].push(r);
  });

  const allParticipants = listParticipants();
  const cooksById = new Map(listCooks().map((c) => [c.cook_id, c]));

  // Points bonus reçus, révélés avec les résultats (qui a donné à qui).
  const bonusFromByTarget = {};
  db.prepare(
    `SELECT b.target_id, p.name AS voter_name FROM bonus_votes b
     JOIN participants p ON p.id = b.voter_participant_id ORDER BY b.created_at, p.id`
  )
    .all()
    .forEach((r) => {
      if (!bonusFromByTarget[r.target_id]) bonusFromByTarget[r.target_id] = [];
      bonusFromByTarget[r.target_id].push(r.voter_name);
    });

  const results = Object.entries(byTarget).map(([targetId, voteRows]) => {
    const targetIdNum = Number(targetId);
    const cook = cooksById.get(targetIdNum);

    const byCriterion = {};
    voteRows.forEach((r) => {
      if (!byCriterion[r.criterion_id]) {
        byCriterion[r.criterion_id] = {
          label: r.criterion_label,
          category: r.category || null,
          max_note: r.max_note,
          coefficient: r.coefficient,
          votes: [],
        };
      }
      byCriterion[r.criterion_id].votes.push({ voter_name: r.voter_name, score: r.score });
    });

    const criteriaBreakdown = orderByCategory(Object.values(byCriterion)).map((c) => ({
      label: c.label,
      category: c.category,
      max_note: c.max_note,
      coefficient: c.coefficient,
      votes: c.votes,
      average: Math.round((c.votes.reduce((a, b) => a + b.score, 0) / c.votes.length) * 10) / 10,
    }));

    // Moyenne globale = moyenne DE CHAQUE CRITÈRE (une seule valeur par critère,
    // ramenée sur 0-1), pondérée par son coefficient. On pondère par critère et non
    // par vote individuel : sinon un critère noté par plus de votants pèserait
    // artificiellement plus lourd qu'un critère noté par moins de monde.
    let weightedSum = 0;
    let weightTotal = 0;
    criteriaBreakdown.forEach((c) => {
      if (!c.max_note || c.max_note <= 0) return;
      const criterionRatio = c.average / c.max_note;
      weightedSum += criterionRatio * (c.coefficient || 0);
      weightTotal += c.coefficient || 0;
    });

    let overallRatio;
    if (weightTotal > 0) {
      overallRatio = weightedSum / weightTotal;
    } else if (criteriaBreakdown.length > 0) {
      // Filet de sécurité : si tous les critères notés ont un coefficient nul (ou
      // manquant), on retombe sur une moyenne simple non pondérée plutôt que
      // d'afficher 0/10, qui serait trompeur alors que le cuisinier a bien été noté.
      console.warn(
        `[RESULTS] Poids total nul pour ${targetIdNum} malgré ${criteriaBreakdown.length} critère(s) noté(s) — moyenne simple de secours.`
      );
      const simpleSum = criteriaBreakdown.reduce((s, c) => s + c.average / c.max_note, 0);
      overallRatio = simpleSum / criteriaBreakdown.length;
    } else {
      overallRatio = 0;
    }

    // Votants attendus (tout le monde sauf les cuisiniers eux-mêmes) qui n'ont en
    // fait jamais noté — absence dispensée, pardon automatique du lendemain, ou
    // simple oubli. Calculé depuis les votes réellement enregistrés.
    const memberIds = new Set((cook ? cook.members : []).map((m) => m.id));
    const actualVoterIds = new Set(voteRows.map((r) => r.voter_participant_id));
    const missingVoters = allParticipants
      .filter((p) => !memberIds.has(p.id) && !actualVoterIds.has(p.id))
      .map((p) => ({ id: p.id, name: p.name }));

    const baseScore = Math.round(overallRatio * 100) / 10;

    // Note sur 10 de chaque catégorie (ex : "Plat", "Dessert"), même pondération
    // que la note globale. Vide si aucun critère n'a de catégorie.
    const categories = [];
    if (criteriaBreakdown.some((c) => c.category)) {
      const byCat = new Map();
      criteriaBreakdown.forEach((c) => {
        if (!c.max_note || c.max_note <= 0) return;
        const key = c.category || "Autres";
        if (!byCat.has(key)) byCat.set(key, { sum: 0, weight: 0, simple: 0, n: 0 });
        const acc = byCat.get(key);
        acc.sum += (c.average / c.max_note) * (c.coefficient || 0);
        acc.weight += c.coefficient || 0;
        acc.simple += c.average / c.max_note;
        acc.n += 1;
      });
      byCat.forEach((acc, category) => {
        const ratio = acc.weight > 0 ? acc.sum / acc.weight : acc.simple / acc.n;
        categories.push({ category, score_out_of_10: Math.round(ratio * 100) / 10 });
      });
    }
    const bonusFrom = bonusFromByTarget[targetIdNum] || [];
    const bonusPoints = bonusFrom.length * BONUS_VALUE;

    return {
      kind: cook ? cook.kind : isTeams() ? "team" : "participant",
      participant_id: targetIdNum,
      participant_name: cook ? cook.cook_name : "?",
      avatar_icon: cook ? cook.avatar_icon : "👤",
      avatar_color: cook ? cook.avatar_color : "#02413B",
      avatar_image: cook ? cook.avatar_image : null,
      members: cook ? cook.members : [],
      categories,
      base_score_out_of_10: baseScore,
      bonus_count: bonusFrom.length,
      bonus_points: bonusPoints,
      bonus_from: bonusFrom,
      overall_average_out_of_10: Math.round((baseScore + bonusPoints) * 10) / 10,
      criteria: criteriaBreakdown,
      missing_voters: missingVoters,
    };
  });

  results.sort((a, b) => b.overall_average_out_of_10 - a.overall_average_out_of_10);
  return results;
}

// --- Éditions archivées ---
// Permet de conserver le résultat complet d'une édition terminée (participants,
// critères, classement détaillé) avant de remettre les tables actives à zéro pour
// en démarrer une nouvelle. Les éditions archivées ne sont JAMAIS touchées par les
// remises à zéro : elles vivent dans leur propre table, indépendante du jeu en cours.

function archiveCurrentEdition(label) {
  const participants = listParticipants();
  const criteria = listCriteria();
  const results = getResults();

  const result = db
    .prepare(
      `INSERT INTO editions (label, mode, participants_json, criteria_json, results_json)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      label && label.trim() ? label.trim() : null,
      getMode(),
      JSON.stringify(participants),
      JSON.stringify(criteria),
      JSON.stringify(results)
    );

  return getEditionById(result.lastInsertRowid);
}

function listEditions() {
  const rows = db
    .prepare("SELECT id, label, mode, archived_at, results_json FROM editions ORDER BY archived_at DESC, id DESC")
    .all();

  return rows.map((row) => {
    let winnerName = null;
    let winnerScore = null;
    let winner = null;
    let participantCount = null;
    try {
      const results = JSON.parse(row.results_json);
      participantCount = results.length;
      if (results.length > 0) {
        winnerName = results[0].participant_name;
        winnerScore = results[0].overall_average_out_of_10;
        winner = {
          avatar_color: results[0].avatar_color,
          avatar_image: results[0].avatar_image,
        };
      }
    } catch {
      // JSON corrompu (ne devrait pas arriver) : on affiche quand même la ligne,
      // juste sans résumé du gagnant.
    }
    return {
      id: row.id,
      label: row.label,
      mode: row.mode || "solo",
      archived_at: row.archived_at,
      winner_name: winnerName,
      winner_score: winnerScore,
      winner_avatar: winner,
      participant_count: participantCount,
    };
  });
}

function getEditionById(id) {
  const row = db.prepare("SELECT * FROM editions WHERE id = ?").get(id);
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    mode: row.mode || "solo",
    archived_at: row.archived_at,
    participants: JSON.parse(row.participants_json),
    criteria: JSON.parse(row.criteria_json),
    results: JSON.parse(row.results_json),
  };
}

// --- Reset total ---

function resetDatabase() {
  db.transaction(() => {
    db.exec(`
      DELETE FROM votes;
      DELETE FROM assignments;
      DELETE FROM criteria;
      DELETE FROM participants;
      DELETE FROM teams;
      DELETE FROM participant_theme_avatars;
      DELETE FROM absences;
      DELETE FROM bonus_votes;
      DELETE FROM settings WHERE key IN ('game_mode', 'bonus_closed');
    `);
    resetSequences(["participants", "criteria", "votes", "teams"]);
  })();
}

// Nouvelle édition : on vide toujours ce qui est propre à une partie (votes,
// calendrier, absences), et au choix on garde les participants (avec leurs
// avatars et leurs équipes) et/ou les critères. Le mode de jeu est conservé.
function resetForNewEdition({ keepParticipants = false, keepCriteria = false } = {}) {
  db.transaction(() => {
    db.exec(`
      DELETE FROM votes;
      DELETE FROM assignments;
      DELETE FROM absences;
      DELETE FROM bonus_votes;
      DELETE FROM settings WHERE key = 'bonus_closed';
    `);
    const resetSeq = ["votes"];
    if (!keepParticipants) {
      db.exec("DELETE FROM participants; DELETE FROM teams; DELETE FROM participant_theme_avatars;");
      resetSeq.push("participants", "teams");
    }
    if (!keepCriteria) {
      db.exec("DELETE FROM criteria;");
      resetSeq.push("criteria");
    }
    resetSequences(resetSeq);
  })();
}

// Une partie déjà terminée avant l'arrivée du point bonus garde ses résultats tels
// quels : on ne la fait pas repasser par une phase de vote bonus.
if (legacyBonusCheck && computeMealsStatus().complete) {
  setSetting("bonus_closed", "1");
  console.log("[DB] Partie déjà terminée avant le point bonus : vote bonus considéré comme clos.");
}

module.exports = {
  THEMES,
  getTheme,
  setTheme,
  todayStr,
  getSetting,
  setSetting,
  getMode,
  setMode,
  listParticipants,
  getParticipant,
  addParticipant,
  renameParticipant,
  setParticipantAvatarColor,
  setParticipantAvatarImage,
  deleteParticipant,
  listTeams,
  getTeam,
  addTeam,
  renameTeam,
  setTeamColor,
  deleteTeam,
  setParticipantTeam,
  randomizeTeams,
  listCooks,
  getCook,
  listUnassignedCooks,
  listAssignmentsForMonth,
  getAssignmentForDate,
  getAssignmentForCook,
  getNextMealFrom,
  setAssignment,
  swapAssignments,
  deleteAssignment,
  autoAssignUnassigned,
  listCriteria,
  addCriterion,
  updateCriterion,
  deleteCriterion,
  moveCriterion,
  submitVotes,
  hasVotedToday,
  listVoterIdsForDate,
  listVotes,
  markAbsent,
  unmarkAbsent,
  listAbsentVoterIdsForDate,
  getSetupStatus,
  computeGameStatus,
  getBonusStatus,
  submitBonus,
  getBonusVote,
  closeBonus,
  getResults,
  archiveCurrentEdition,
  listEditions,
  getEditionById,
  resetDatabase,
  resetForNewEdition,
};
