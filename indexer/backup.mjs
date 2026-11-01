// Weekly backup of the indexer database (used by .github/workflows/backup.yml).
//
//   node indexer/backup.mjs <source.sqlite> <backup-dir>
//
// Copies the database into <backup-dir>/indexer-YYYY-MM-DD.sqlite only if it is healthy:
//   - SQLite integrity_check is "ok",
//   - it has not gone backwards compared with the newest existing backup
//     (fewer events or a lower indexed block would mean something went wrong, so the good copy is kept).
// Keeps the newest KEEP copies (default 12 = about three months) and writes <backup-dir>/latest.json.
// Exits with code 1 (the workflow fails and GitHub e-mails the owner) when the database is not healthy.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const [src, dir] = process.argv.slice(2);
const KEEP = Math.max(1, Number(process.env.KEEP ?? 12) || 12);
if (!src || !dir) { console.error("usage: node backup.mjs <source.sqlite> <backup-dir>"); process.exit(2); }

function inspect(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").all().map((r) => Object.values(r)[0]).join(",");
    const events = db.prepare("SELECT COUNT(*) AS n FROM events").get().n;
    const cps = db.prepare("SELECT address, indexed_to FROM checkpoints").all();
    const indexedTo = cps.length ? Math.min(...cps.map((c) => c.indexed_to)) : 0;
    return { integrity, events: Number(events), checkpoints: cps.length, indexedTo: Number(indexedTo) };
  } finally { db.close(); }
}

// opening a WAL-mode database leaves -wal/-shm files beside it; they must not end up in the backup folder
function dropSidecars(file) { for (const ext of ["-wal", "-shm", "-journal"]) fs.rmSync(file + ext, { force: true }); }

function fail(msg) { console.error("BACKUP REFUSED: " + msg); process.exit(1); }

if (!fs.existsSync(src)) fail(`database not found: ${src}`);
const now = inspect(src);
console.log("current database:", JSON.stringify(now));
if (now.integrity !== "ok") fail(`integrity_check = ${now.integrity}`);
if (now.checkpoints === 0) fail("no checkpoints (empty database)");

fs.mkdirSync(dir, { recursive: true });
const latestFile = path.join(dir, "latest.json");
const prev = fs.existsSync(latestFile) ? JSON.parse(fs.readFileSync(latestFile, "utf8")) : null;
if (prev) {
  console.log("previous backup:", JSON.stringify(prev));
  if (now.events < prev.events) fail(`events went down: ${prev.events} -> ${now.events}`);
  if (now.indexedTo < prev.indexedTo) fail(`indexed block went down: ${prev.indexedTo} -> ${now.indexedTo}`);
}

const day = new Date().toISOString().slice(0, 10);
const name = `indexer-${day}.sqlite`;
const dest = path.join(dir, name);
fs.rmSync(dest, { force: true });                      // VACUUM INTO refuses to overwrite
{ const db = new DatabaseSync(src, { readOnly: true }); try { db.prepare("VACUUM INTO ?").run(dest); } finally { db.close(); } }
const copy = inspect(dest);           // the copy itself must read back identically
if (copy.integrity !== "ok" || copy.events !== now.events) fail("the copy does not read back correctly");

const all = fs.readdirSync(dir).filter((f) => /^indexer-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort();
for (const f of all) dropSidecars(path.join(dir, f));
for (const old of all.slice(0, Math.max(0, all.length - KEEP))) { fs.rmSync(path.join(dir, old)); console.log("removed old backup", old); }

const latest = { file: name, createdAt: new Date().toISOString(), events: now.events, indexedTo: now.indexedTo, checkpoints: now.checkpoints };
fs.writeFileSync(latestFile, JSON.stringify(latest, null, 2) + "\n");
console.log("backup written:", JSON.stringify(latest));
console.log("kept:", fs.readdirSync(dir).filter((f) => f.endsWith(".sqlite")).sort().join(", "));
