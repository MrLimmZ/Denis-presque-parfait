const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

// /data est le volume persistant fourni par le Supervisor HA.
// En dev local (hors add-on), on retombe sur un fichier dans le dossier courant.
const DATA_DIR = fs.existsSync("/data") ? "/data" : path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "denis.db");
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS state (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
  );
`);

function getValue(key) {
  const row = db.prepare("SELECT value FROM state WHERE key = ?").get(key);
  return row ? row.value : null;
}

function setValue(key, value) {
  db.prepare(
    `INSERT INTO state (key, value, updated_at)
     VALUES (@key, @value, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = datetime('now')`
  ).run({ key, value });
}

module.exports = { getValue, setValue };
