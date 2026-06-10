import { getDB } from "./database.js";

export async function initDirectoryTable() {
  const db = getDB();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS directory_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      logical_path TEXT UNIQUE NOT NULL,
      ufid TEXT NOT NULL,
      mime_type TEXT DEFAULT 'application/octet-stream',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function registerPath(logicalPath, ufid, mimeType) {
  const db = getDB();
  await db.run(
    "INSERT OR REPLACE INTO directory_entries (logical_path, ufid, mime_type) VALUES (?, ?, ?)",
    logicalPath,
    ufid,
    mimeType || "application/octet-stream"
  );
  return { logicalPath, ufid };
}

export async function lookup(logicalPath) {
  const db = getDB();
  return db.get(
    "SELECT ufid, mime_type FROM directory_entries WHERE logical_path = ?",
    logicalPath
  );
}

export async function resolveUfid(ufid) {
  const db = getDB();
  return db.get(
    "SELECT logical_path, mime_type FROM directory_entries WHERE ufid = ?",
    ufid
  );
}

export async function deleteEntry(logicalPath) {
  const db = getDB();
  await db.run("DELETE FROM directory_entries WHERE logical_path = ?", logicalPath);
}
