import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import { initDB, getDB, getRandomQuestions, getQuizList, getPlayerStats, getAllQuizzes, getQuizById, getQuestionsByQuizId, insertQuiz, insertQuestion, deleteQuiz, sanitizeInput, verifyAdmin } from "./database.js";
import { sendToTarget, AnswerQueue } from "./ipcHelper.js";
import eventBroker from "./eventBroker.js";
import { generateUFID, writeContent, readContent, getFilePath, storeFile } from "./flatFileService.js";
import { registerPath, lookup, resolveUfid } from "./directoryService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const QUESTION_DURATION = 15;
const INTERMISSION_DELAY = 3000;
const DISCONNECT_CLEANUP_DELAY = 30000;
const SERVER_SECRET = crypto.randomBytes(32).toString("hex");

function generateToken(username, roomCode) {
  const hmac = crypto.createHmac("sha256", SERVER_SECRET);
  hmac.update(username + roomCode);
  return hmac.digest("hex");
}

function verifyToken(username, roomCode, signature) {
  const expected = generateToken(username, roomCode);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 1000;
const RATE_LIMIT_MAX = 5;

function checkRateLimit(socketId) {
  const now = Date.now();
  if (!rateLimitMap.has(socketId)) {
    rateLimitMap.set(socketId, []);
  }
  const timestamps = rateLimitMap.get(socketId).filter((t) => now - t < RATE_LIMIT_WINDOW);
  timestamps.push(now);
  rateLimitMap.set(socketId, timestamps);
  return timestamps.length <= RATE_LIMIT_MAX;
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());

const adminSessions = new Set();

function adminGuard(req, res, next) {
  if (req.path === "/admin.html" || req.path === "/admin") {
    const token = req.cookies && req.cookies.admin_session;
    if (!token || !adminSessions.has(token)) {
      return res.redirect("/admin-login.html");
    }
  }
  next();
}

app.use(adminGuard);
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/admin/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }
    const valid = await verifyAdmin(username, password);
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = crypto.randomBytes(32).toString("hex");
    adminSessions.add(token);
    res.cookie("admin_session", token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/quizzes", async (req, res) => {
  try {
    const quizzes = await getAllQuizzes();
    res.status(200).json(quizzes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/quizzes", async (req, res) => {
  try {
    const { title } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }
    const id = await insertQuiz(title.trim());
    res.status(201).json({ id, title: title.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/quizzes/:quizId/questions", async (req, res) => {
  try {
    const quizId = parseInt(req.params.quizId, 10);
    const quiz = await getQuizById(quizId);
    if (!quiz) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    const { questionText, optionA, optionB, optionC, optionD, correctOption } = req.body;
    if (!questionText || !optionA || !optionB || !optionC || !optionD || !correctOption) {
      return res.status(400).json({ error: "All question fields are required" });
    }

    const id = await insertQuestion(quizId, questionText, optionA, optionB, optionC, optionD, correctOption);
    res.status(201).json({ id, questionText });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/quizzes/:quizId", async (req, res) => {
  try {
    const quizId = parseInt(req.params.quizId, 10);
    const quiz = await getQuizById(quizId);
    if (!quiz) {
      return res.status(404).json({ error: "Quiz not found" });
    }
    await deleteQuiz(quizId);
    res.status(200).json({ message: "Quiz deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/assets/upload", async (req, res) => {
  try {
    const { logicalPath, data: base64Data, mimeType } = req.body;
    if (!logicalPath || !base64Data) {
      return res.status(400).json({ error: "logicalPath and data (base64) are required" });
    }
    const buffer = Buffer.from(base64Data, "base64");
    const { ufid } = await storeFile(buffer, path.extname(logicalPath));
    await registerPath(logicalPath, ufid, mimeType || "application/octet-stream");
    res.status(201).json({ logicalPath, ufid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/assets/by-path", async (req, res) => {
  try {
    const logicalPath = req.query.path;
    if (!logicalPath) {
      return res.status(400).json({ error: "path query parameter is required" });
    }
    const entry = await lookup(logicalPath);
    if (!entry) {
      return res.status(404).json({ error: "Asset not found" });
    }
    const filePath = await getFilePath(entry.ufid);
    if (!filePath) {
      return res.status(404).json({ error: "File not found on disk" });
    }
    res.type(entry.mime_type);
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/active-rooms", (req, res) => {
  const rooms = Object.entries(activeRooms)
    .filter(([, room]) => room.status === "waiting")
    .map(([code]) => ({ roomCode: code }));
  res.json(rooms);
});

app.get("/api/assets/raw/:ufid", async (req, res) => {
  try {
    const { ufid } = req.params;
    const filePath = await getFilePath(ufid);
    if (!filePath) {
      return res.status(404).json({ error: "File not found" });
    }
    const entry = await resolveUfid(ufid);
    if (entry) res.type(entry.mime_type);
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

const activeRooms = {};

function gameTopic(roomCode) {
  return "room:" + roomCode + ":gameplay";
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (activeRooms[code]);
  return code;
}

function sendQuestion(roomCode) {
  const room = activeRooms[roomCode];
  if (!room) return;

  const q = room.questions[room.currentQuestionIndex];
  if (!q) return;

  room.answerTimestamps = {};
  room.answeredPlayers = {};
  room.answersThisRound = [];
  room.remainingTime = room.questionDuration || QUESTION_DURATION;

  const assetPath = q.dfsAsset || null;

  eventBroker.publish(gameTopic(roomCode), "next-question", {
    questionIndex: room.currentQuestionIndex,
    questionText: q.question_text,
    optionA: q.option_a,
    optionB: q.option_b,
    optionC: q.option_c,
    optionD: q.option_d,
    duration: room.questionDuration || QUESTION_DURATION,
    dfsAsset: assetPath,
  });

  room.timer = setInterval(() => {
    room.remainingTime--;

    eventBroker.publish(gameTopic(roomCode), "timer-tick", {
      remainingTime: room.remainingTime,
    });

    if (room.remainingTime <= 0) {
      clearInterval(room.timer);
      room.timer = null;
      endQuestion(roomCode);
    }
  }, 1000);

  console.log(`[${roomCode}] Question ${room.currentQuestionIndex + 1} sent`);
}

function endQuestion(roomCode) {
  const room = activeRooms[roomCode];
  if (!room) return;

  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }

  const q = room.questions[room.currentQuestionIndex];
  const correctOption = q ? q.correct_option : null;

  eventBroker.publish(gameTopic(roomCode), "question-over", {
    correctOption,
    answers: room.answersThisRound || [],
  });

  const ranking = [...room.players].sort((a, b) => b.score - a.score);
  eventBroker.publish(gameTopic(roomCode), "leaderboard-update", {
    ranking: ranking.map((p) => ({
      username: p.username,
      score: p.score,
      isOnline: p.isOnline,
    })),
  });

  room.currentQuestionIndex++;

  if (room.currentQuestionIndex < room.questions.length) {
    room.pendingNext = setTimeout(() => sendQuestion(roomCode), INTERMISSION_DELAY);
  } else {
    room.status = "finished";
    eventBroker.publish(gameTopic(roomCode), "game-over", {
      ranking: ranking.map((p) => ({ username: p.username, score: p.score })),
    });
    console.log(`[${roomCode}] Game over`);
  }
}

function publishPlayerListUpdate(roomCode, players) {
  eventBroker.publish(gameTopic(roomCode), "player-list-update", {
    players: players.map((p) => ({
      username: p.username,
      score: p.score,
      isOnline: p.isOnline,
    })),
  });
}

const answerQueue = new AnswerQueue((socket, data) => {
  const { roomCode, username, selectedOption, token } = data;
  const room = activeRooms[roomCode];

  if (!room || room.status !== "playing" || !room.answerTimestamps) {
    return;
  }

  if (!token) {
    sendToTarget(socket, "unauthorized-action", { message: "Missing security token" });
    console.warn(`[Security Alert] Missing token in submit-answer from socket ${socket.id}`);
    return;
  }

  try {
    if (!verifyToken(username, roomCode, token)) {
      sendToTarget(socket, "unauthorized-action", { message: "Invalid security token" });
      console.warn(`[Security Alert] Blocked unauthorized submission attempt for username "${username}" in room ${roomCode}!`);
      return;
    }
  } catch {
    sendToTarget(socket, "unauthorized-action", { message: "Token verification error" });
    console.warn(`[Security Alert] Token verification exception for socket ${socket.id}`);
    return;
  }

  console.log(`[Security] Verified "${username}'s" Ticket successfully.`);

  const player = room.players.find((p) => p.id === socket.id);
  if (!player) return;

  if (room.answeredPlayers[player.username]) {
    return;
  }

  const q = room.questions[room.currentQuestionIndex];
  if (!q) return;

  const isCorrect = selectedOption === q.correct_option;

  let points = 0;
  if (isCorrect) {
    const duration = room.questionDuration || QUESTION_DURATION;
    const elapsed = (duration - room.remainingTime) * 1000;
    const ratio = Math.max(0, 1 - elapsed / (duration * 1000));
    points = Math.round(1000 * ratio);
  }

  player.score += points;

  const answer = {
    username,
    selectedOption,
    correctOption: q.correct_option,
    isCorrect,
    points,
  };
  room.answersThisRound.push(answer);
  room.answeredPlayers[player.username] = true;

  sendToTarget(socket, "answer-result", {
    isCorrect,
    points,
    correctOption: q.correct_option,
  });

  const onlineCount = room.players.filter((p) => p.isOnline).length;
  if (Object.keys(room.answeredPlayers).length >= onlineCount) {
    if (room.timer) {
      clearInterval(room.timer);
      room.timer = null;
    }
    endQuestion(roomCode);
  }
});

const rpcHistory = new Map();
const RPC_HISTORY_MAX = 100;

const rpcProcedures = {
  getQuizList: async () => {
    const list = await getQuizList();
    return list.map((q) => ({ id: q.id, title: q.question_text }));
  },
  getPlayerStats: async (params) => {
    const limit = params && params.limit ? params.limit : 10;
    return getPlayerStats(limit);
  },
};

const assetTracker = {};

function registerAssetHolder(assetGuid, socketId) {
  if (!assetTracker[assetGuid]) {
    assetTracker[assetGuid] = new Set();
  }
  assetTracker[assetGuid].add(socketId);
}

function unregisterSocketFromTracker(socketId) {
  for (const guid of Object.keys(assetTracker)) {
    assetTracker[guid].delete(socketId);
    if (assetTracker[guid].size === 0) {
      delete assetTracker[guid];
    }
  }
}

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("rpc-request", async (envelope) => {
    const { requestId, procedureName, params } = envelope.payload;

    if (rpcHistory.has(requestId)) {
      const cached = rpcHistory.get(requestId);
      socket.emit("rpc-response-" + requestId, cached);
      return;
    }

    const handler = rpcProcedures[procedureName];
    if (!handler) {
      const errResult = { success: false, error: `Unknown procedure: ${procedureName}` };
      rpcHistory.set(requestId, errResult);
      if (rpcHistory.size > RPC_HISTORY_MAX) {
        const firstKey = rpcHistory.keys().next().value;
        rpcHistory.delete(firstKey);
      }
      socket.emit("rpc-response-" + requestId, errResult);
      return;
    }

    try {
      const result = await handler(params);
      const successResult = { success: true, result };
      rpcHistory.set(requestId, successResult);
      if (rpcHistory.size > RPC_HISTORY_MAX) {
        const firstKey = rpcHistory.keys().next().value;
        rpcHistory.delete(firstKey);
      }
      socket.emit("rpc-response-" + requestId, successResult);
    } catch (err) {
      const errResult = { success: false, error: err.message };
      rpcHistory.set(requestId, errResult);
      if (rpcHistory.size > RPC_HISTORY_MAX) {
        const firstKey = rpcHistory.keys().next().value;
        rpcHistory.delete(firstKey);
      }
      socket.emit("rpc-response-" + requestId, errResult);
    }
  });

  socket.on("create-room", async (envelope) => {
    if (!checkRateLimit(socket.id)) {
      sendToTarget(socket, "game-error", { message: "Rate limited. Slow down." });
      return;
    }
    const data = envelope.payload;
    const { quizId, questionDuration } = data;
    const roomCode = generateRoomCode();

    let questions = [];
    if (quizId) {
      questions = await getQuestionsByQuizId(parseInt(quizId, 10));
    }
    if (questions.length === 0) {
      questions = await getRandomQuestions(5);
    }

    activeRooms[roomCode] = {
      hostId: socket.id,
      players: [],
      status: "waiting",
      questions,
      currentQuestionIndex: 0,
      answerTimestamps: {},
      answeredPlayers: {},
      answersThisRound: [],
      remainingTime: questionDuration || QUESTION_DURATION,
      questionDuration: questionDuration || QUESTION_DURATION,
      timer: null,
      pendingNext: null,
    };

    socket.join(roomCode);
    eventBroker.subscribe(gameTopic(roomCode), socket.id, socket);
    sendToTarget(socket, "room-created", { roomCode, totalQuestions: questions.length });

    try {
      const db = getDB();
      await db.run(
        "INSERT INTO rooms (room_code, status) VALUES (?, ?)",
        roomCode,
        "waiting"
      );
    } catch (err) {
      console.error("Failed to save room to DB:", err);
    }

    console.log(`Room created: ${roomCode} by host ${socket.id} (${questions.length} questions, ${questionDuration || QUESTION_DURATION}s)`);
  });

  socket.on("join-room", (envelope) => {
    const data = envelope.payload;
    const { roomCode, username: rawUsername } = data;
    const username = sanitizeInput(rawUsername);

    if (!checkRateLimit(socket.id)) {
      sendToTarget(socket, "game-error", { message: "Rate limited. Slow down." });
      console.warn(`[Security] Rate limit exceeded for socket ${socket.id}`);
      return;
    }

    if (!username) {
      sendToTarget(socket, "join-error", { message: "Invalid username" });
      return;
    }

    const room = activeRooms[roomCode];

    if (!room) {
      sendToTarget(socket, "join-error", { message: "Room not found" });
      return;
    }

    const existing = room.players.find((p) => p.username === username);

    if (existing) {
      if (existing.disconnectTimeout) {
        clearTimeout(existing.disconnectTimeout);
        existing.disconnectTimeout = null;
      }

      existing.id = socket.id;
      existing.isOnline = true;
      socket.join(roomCode);
      eventBroker.subscribe(gameTopic(roomCode), socket.id, socket);

      const token = generateToken(username, roomCode);
      sendToTarget(socket, "reconnect-success", {
        roomCode,
        username,
        score: existing.score,
        token,
      });
      console.log(`[Security] Issued token for reconnecting player "${username}"`);

      publishPlayerListUpdate(roomCode, room.players);

      if (room.status === "playing") {
        const q = room.questions[room.currentQuestionIndex];
        if (q) {
          sendToTarget(socket, "next-question", {
            questionIndex: room.currentQuestionIndex,
            questionText: q.question_text,
            optionA: q.option_a,
            optionB: q.option_b,
            optionC: q.option_c,
            optionD: q.option_d,
            duration: room.remainingTime,
          });
          sendToTarget(socket, "timer-tick", { remainingTime: room.remainingTime });
        }
      }

      console.log(`Player "${username}" reconnected to room ${roomCode}`);
      return;
    }

    const player = {
      id: socket.id,
      username,
      score: 0,
      isOnline: true,
      disconnectTimeout: null,
    };
    room.players.push(player);
    socket.join(roomCode);
    eventBroker.subscribe(gameTopic(roomCode), socket.id, socket);

    const token = generateToken(username, roomCode);
    sendToTarget(socket, "join-success", { roomCode, username, token });
    publishPlayerListUpdate(roomCode, room.players);

    console.log(`[Security] Issued token for player "${username}" in room ${roomCode}`);
  });

  socket.on("start-game", async (envelope) => {
    if (!checkRateLimit(socket.id)) {
      sendToTarget(socket, "game-error", { message: "Rate limited. Slow down." });
      return;
    }
    const data = envelope.payload;
    const { roomCode } = data;
    const room = activeRooms[roomCode];

    if (!room) {
      sendToTarget(socket, "game-error", { message: "Room not found" });
      return;
    }

    if (room.hostId !== socket.id) {
      sendToTarget(socket, "game-error", { message: "Only the host can start the game" });
      return;
    }

    try {
      if (!room.questions || room.questions.length === 0) {
        room.questions = await getRandomQuestions(5);
      }
      if (room.questions.length === 0) {
        sendToTarget(socket, "game-error", { message: "No questions available" });
        return;
      }

      room.currentQuestionIndex = 0;
      room.status = "playing";
      room.answerTimestamps = {};
      room.answeredPlayers = {};
      room.answersThisRound = [];

      eventBroker.publish(gameTopic(roomCode), "game-started", {
        totalQuestions: room.questions.length,
      });

      sendQuestion(roomCode);
      console.log(`[${roomCode}] Game started with ${room.questions.length} questions`);
    } catch (err) {
      console.error("Failed to start game:", err);
      sendToTarget(socket, "game-error", { message: "Failed to load questions" });
    }
  });

  socket.on("submit-answer", (envelope) => {
    if (!checkRateLimit(socket.id)) {
      sendToTarget(socket, "game-error", { message: "Rate limited. Slow down." });
      console.warn(`[Security] Rate limit exceeded for socket ${socket.id} on submit-answer`);
      return;
    }
    answerQueue.enqueue(socket, envelope.payload);
  });

  socket.on("register-asset-holder", (envelope) => {
    const data = envelope.payload;
    const { assetGuid } = data;
    registerAssetHolder(assetGuid, socket.id);
    console.log(`[P2P] Socket ${socket.id} registered as holder for ${assetGuid}`);
  });

  socket.on("get-asset-providers", (envelope) => {
    const data = envelope.payload;
    const { assetGuid } = data;
    const providers = assetTracker[assetGuid];
    const list = providers ? [...providers] : [];
    sendToTarget(socket, "asset-providers", { assetGuid, providers: list });
    console.log(`[P2P] Socket ${socket.id} queried providers for ${assetGuid}: ${list.length} found`);
  });

  socket.on("p2p-transfer-request", (envelope) => {
    const data = envelope.payload;
    const { targetSocketId, assetGuid, fromSocketId } = data;
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      sendToTarget(targetSocket, "p2p-transfer-incoming", {
        assetGuid,
        fromSocketId,
      });
      console.log(`[P2P] Transfer request for ${assetGuid} from ${fromSocketId} routed to ${targetSocketId}`);
    } else {
      sendToTarget(socket, "p2p-transfer-failed", {
        assetGuid,
        reason: "Target peer disconnected",
      });
    }
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    unregisterSocketFromTracker(socket.id);

    for (const [roomCode, room] of Object.entries(activeRooms)) {
      if (room.hostId === socket.id) {
        if (room.timer) clearInterval(room.timer);
        if (room.pendingNext) clearTimeout(room.pendingNext);
        eventBroker.publish(gameTopic(roomCode), "host-disconnected", {});
        eventBroker.unsubscribeAll(socket.id);
        delete activeRooms[roomCode];
        console.log(`Room ${roomCode} closed (host disconnected)`);
        break;
      }

      const player = room.players.find((p) => p.id === socket.id);
      if (player) {
        player.isOnline = false;
        eventBroker.unsubscribeAll(socket.id);
        publishPlayerListUpdate(roomCode, room.players);

        player.disconnectTimeout = setTimeout(() => {
          const idx = room.players.indexOf(player);
          if (idx !== -1) {
            room.players.splice(idx, 1);
            publishPlayerListUpdate(roomCode, room.players);
            console.log(`Player "${player.username}" removed from room ${roomCode} (cleanup)`);
          }
        }, DISCONNECT_CLEANUP_DELAY);

        console.log(`Player "${player.username}" disconnected from room ${roomCode}`);
        break;
      }
    }
  });
});

initDB()
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log(`DistriQuiz server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
