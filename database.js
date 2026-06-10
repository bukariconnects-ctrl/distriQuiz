import sqlite3 from "sqlite3";
import { open } from "sqlite";

let db;

export async function initDB() {
  db = await open({
    filename: "./distriquiz.db",
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      score INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'waiting'
    );

    CREATE TABLE IF NOT EXISTS quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL
    );
  `);

  try {
    await db.exec("ALTER TABLE questions ADD COLUMN quiz_id INTEGER REFERENCES quizzes(id)");
  } catch {
    // column already exists
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER REFERENCES quizzes(id),
      question_text TEXT NOT NULL,
      option_a TEXT NOT NULL,
      option_b TEXT NOT NULL,
      option_c TEXT NOT NULL,
      option_d TEXT NOT NULL,
      correct_option TEXT NOT NULL
    );
  `);

  const count = await db.get("SELECT COUNT(*) AS cnt FROM questions");
  if (count.cnt === 0) {
    const seedQuiz = await db.get("SELECT id FROM quizzes LIMIT 1");
    let quizId;
    if (!seedQuiz) {
      const result = await db.run("INSERT INTO quizzes (title) VALUES (?)", "General Knowledge");
      quizId = result.lastID;
    } else {
      quizId = seedQuiz.id;
    }

    await db.run(
      "INSERT INTO questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option) VALUES (?, ?, ?, ?, ?, ?, ?)",
      quizId, "What is the capital of France?", "Berlin", "Madrid", "Paris", "Rome", "C"
    );
    await db.run(
      "INSERT INTO questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option) VALUES (?, ?, ?, ?, ?, ?, ?)",
      quizId, "Which planet is known as the Red Planet?", "Venus", "Mars", "Jupiter", "Saturn", "B"
    );
    await db.run(
      "INSERT INTO questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option) VALUES (?, ?, ?, ?, ?, ?, ?)",
      quizId, "What is 2 + 2?", "3", "4", "5", "6", "B"
    );
    console.log("Seeded 3 sample questions.");
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS directory_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      logical_path TEXT UNIQUE NOT NULL,
      ufid TEXT NOT NULL,
      mime_type TEXT DEFAULT 'application/octet-stream',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  const adminCount = await db.get("SELECT COUNT(*) AS cnt FROM admins");
  if (adminCount.cnt === 0) {
    await db.run(
      "INSERT INTO admins (username, password) VALUES (?, ?)",
      "mohammed", "moh123"
    );
    console.log("Default admin created: mohammed / moh123");
  }

  console.log("Database initialized: distriquiz.db");
  return db;
}

export function sanitizeInput(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/[<>"']/g, "")
    .replace(/&/g, "")
    .trim()
    .substring(0, 30);
}

export async function getRandomQuestions(limit = 5) {
  if (!db) throw new Error("Database not initialized. Call initDB() first.");
  return db.all(
    "SELECT id, question_text, option_a, option_b, option_c, option_d, correct_option FROM questions ORDER BY RANDOM() LIMIT ?",
    limit
  );
}

export async function getQuizList() {
  if (!db) throw new Error("Database not initialized. Call initDB() first.");
  return db.all(
    "SELECT id, question_text FROM questions ORDER BY id"
  );
}

export async function getPlayerStats(limit = 10) {
  if (!db) throw new Error("Database not initialized. Call initDB() first.");
  return db.all(
    "SELECT username, score FROM players ORDER BY score DESC LIMIT ?",
    limit
  );
}

export async function getAllQuizzes() {
  if (!db) throw new Error("Database not initialized. Call initDB() first.");
  return db.all(`
    SELECT q.id, q.title, COUNT(qs.id) AS question_count
    FROM quizzes q
    LEFT JOIN questions qs ON qs.quiz_id = q.id
    GROUP BY q.id
    ORDER BY q.id
  `);
}

export async function insertQuiz(title) {
  if (!db) throw new Error("Database not initialized. Call initDB() first.");
  const result = await db.run("INSERT INTO quizzes (title) VALUES (?)", title);
  return result.lastID;
}

export async function getQuizById(quizId) {
  if (!db) throw new Error("Database not initialized. Call initDB() first.");
  return db.get("SELECT id, title FROM quizzes WHERE id = ?", quizId);
}

export async function insertQuestion(quizId, questionText, optionA, optionB, optionC, optionD, correctOption) {
  if (!db) throw new Error("Database not initialized. Call initDB() first.");
  const result = await db.run(
    "INSERT INTO questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option) VALUES (?, ?, ?, ?, ?, ?, ?)",
    quizId, questionText, optionA, optionB, optionC, optionD, correctOption
  );
  return result.lastID;
}

export async function getQuestionsByQuizId(quizId) {
  if (!db) throw new Error("Database not initialized.");
  return db.all(
    "SELECT id, question_text, option_a, option_b, option_c, option_d, correct_option FROM questions WHERE quiz_id = ? ORDER BY id",
    quizId
  );
}

export async function deleteQuiz(quizId) {
  if (!db) throw new Error("Database not initialized. Call initDB() first.");
  await db.run("DELETE FROM questions WHERE quiz_id = ?", quizId);
  await db.run("DELETE FROM quizzes WHERE id = ?", quizId);
}

export async function verifyAdmin(username, password) {
  if (!db) throw new Error("Database not initialized.");
  const row = await db.get(
    "SELECT id FROM admins WHERE username = ? AND password = ?",
    username, password
  );
  return !!row;
}

export function getDB() {
  if (!db) throw new Error("Database not initialized. Call initDB() first.");
  return db;
}
