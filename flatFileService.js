import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = path.join(__dirname, "storage");

async function ensureStorageDir() {
  try {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
  } catch {
    // already exists
  }
}

export function generateUFID() {
  return crypto.randomUUID();
}

function sanitizeUFID(ufid) {
  return ufid.replace(/[^a-fA-F0-9-]/g, "");
}

export async function writeContent(ufid, data) {
  await ensureStorageDir();
  const safe = sanitizeUFID(ufid);
  const filePath = path.join(STORAGE_DIR, safe);
  await fs.writeFile(filePath, data);
  return safe;
}

export async function readContent(ufid) {
  const safe = sanitizeUFID(ufid);
  const filePath = path.join(STORAGE_DIR, safe);
  return fs.readFile(filePath);
}

export async function storeFile(buffer, extension) {
  await ensureStorageDir();
  const ufid = generateUFID();
  const filename = ufid + (extension ? "." + extension.replace(/^\./, "") : "");
  const filePath = path.join(STORAGE_DIR, filename);
  await fs.writeFile(filePath, buffer);
  return { ufid, filename };
}

export async function getFilePath(ufid) {
  const safe = sanitizeUFID(ufid);
  const filePath = path.join(STORAGE_DIR, safe);
  try {
    await fs.access(filePath);
    return filePath;
  } catch {
    const files = await fs.readdir(STORAGE_DIR);
    const match = files.find((f) => f.startsWith(safe));
    return match ? path.join(STORAGE_DIR, match) : null;
  }
}

export async function deleteContent(ufid) {
  const filePath = await getFilePath(ufid);
  if (filePath) {
    await fs.unlink(filePath);
  }
}
