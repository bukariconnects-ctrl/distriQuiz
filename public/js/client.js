let _msgCounter = 0;
let _rpcIdCounter = 0;

const dfsCache = {
  get(ufid) {
    try {
      const data = localStorage.getItem("dfs:" + ufid);
      if (data) {
        console.log(`[DFS Cache] Hit for UFID ${ufid.slice(0, 8)}... loaded from local memory`);
        return JSON.parse(data);
      }
    } catch { /* ignore */ }
    return null;
  },
  set(ufid, mimeType, data) {
    try {
      localStorage.setItem("dfs:" + ufid, JSON.stringify({ mimeType, data }));
    } catch { /* localStorage full */ }
  },
};

async function dfsFetch(ufid) {
  const cached = dfsCache.get(ufid);
  if (cached) return cached;

  console.log(`[DFS Cache] Miss for UFID ${ufid.slice(0, 8)}... fetching from server`);
  const res = await fetch("/api/assets/raw/" + ufid);
  if (!res.ok) throw new Error("DFS fetch failed");

  const blob = await res.blob();
  const mimeType = res.headers.get("content-type") || "application/octet-stream";

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result;
      dfsCache.set(ufid, mimeType, dataUrl);
      console.log(`[DFS Cache] Cached UFID ${ufid.slice(0, 8)}... (${(dataUrl.length * 0.75 / 1024).toFixed(1)} KB)`);
      resolve({ data: dataUrl, mimeType });
    };
    reader.readAsDataURL(blob);
  });
}

async function resolveAndFetch(logicalPath) {
  const res = await fetch("/api/assets/by-path?path=" + encodeURIComponent(logicalPath));
  if (!res.ok) throw new Error("Path resolution failed");
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const blob = await res.blob();

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result;
      const ufid = res.headers.get("x-ufid") || logicalPath;
      dfsCache.set(ufid, contentType, dataUrl);
      resolve({ data: dataUrl, mimeType: contentType });
    };
    reader.readAsDataURL(blob);
  });
}

function wrapMessage(event, payload) {
  return {
    event,
    payload,
    timestamp: Date.now(),
    messageId: `${Date.now()}-${++_msgCounter}-${Math.random().toString(36).slice(2, 8)}`,
  };
}

function rpcCall(procedureName, params) {
  return new Promise((resolve, reject) => {
    const requestId = `rpc-${++_rpcIdCounter}-${Date.now()}`;
    let attempts = 0;
    const maxAttempts = 3;
    const timeoutMs = 3000;

    function attempt() {
      attempts++;
      const responseEvent = "rpc-response-" + requestId;

      const handler = (envelope) => {
        socket.off(responseEvent, handler);
        if (envelope.payload) {
          if (envelope.payload.success) {
            resolve(envelope.payload.result);
          } else {
            reject(new Error(envelope.payload.error || "RPC failed"));
          }
        } else {
          if (envelope.success) {
            resolve(envelope.result);
          } else {
            reject(new Error(envelope.error || "RPC failed"));
          }
        }
      };

      socket.on(responseEvent, handler);

      socket.emit("rpc-request", wrapMessage("rpc-request", { requestId, procedureName, params }));

      if (attempts < maxAttempts) {
        setTimeout(() => {
          socket.off(responseEvent, handler);
          console.log(`RPC ${procedureName} failed. Retrying... (Attempt ${attempts + 1})`);
          attempt();
        }, timeoutMs);
      } else {
        setTimeout(() => {
          socket.off(responseEvent, handler);
          reject(new Error(`RPC ${procedureName} failed after ${maxAttempts} attempts`));
        }, timeoutMs);
      }
    }

    attempt();
  });
}

async function loadDfsAsset(dfsAsset) {
  const area = document.getElementById("dfs-asset-area");
  const img = document.getElementById("dfs-asset-img");
  if (!dfsAsset || !area || !img) return;
  try {
    const { data } = await resolveAndFetch(dfsAsset);
    img.src = data;
    area.style.display = "block";
  } catch (err) {
    console.log("[DFS] Asset not available:", dfsAsset, err.message);
    area.style.display = "none";
  }
}

const socket = io();
const page = window.location.pathname;
let sessionToken = null;

socket.on("connect", () => {
  console.log("Connected to DistriQuiz server");

  if (page === "/player.html") {
    const roomCode = new URLSearchParams(window.location.search).get("room");
    const username = new URLSearchParams(window.location.search).get("name");
    if (roomCode && username) {
      socket.emit("join-room", wrapMessage("join-room", { roomCode, username }));
    }
  }
});

socket.on("disconnect", () => {
  console.log("Disconnected from DistriQuiz server");
});

const assetCache = {};
let p2pTotalTransfers = 0;
let p2pPeerTransfers = 0;

function p2pFetchAsset(assetGuid) {
  return new Promise((resolve) => {
    if (assetCache[assetGuid]) {
      resolve("cached");
      return;
    }

    socket.emit("get-asset-providers", wrapMessage("get-asset-providers", { assetGuid }));

    const providerHandler = (envelope) => {
      const data = envelope.payload;
      socket.off("asset-providers", providerHandler);

      if (data.providers && data.providers.length > 0) {
        const targetId = data.providers[Math.floor(Math.random() * data.providers.length)];
        if (targetId === socket.id) {
          simulateServerDownload(assetGuid, resolve);
          return;
        }
        p2pTotalTransfers++;
        p2pPeerTransfers++;
        socket.emit("p2p-transfer-request", wrapMessage("p2p-transfer-request", {
          assetGuid,
          targetSocketId: targetId,
          fromSocketId: socket.id,
        }));
        console.log(`[P2P] Requesting ${assetGuid} from peer ${targetId}`);
        assetCache[assetGuid] = true;

        const incomingHandler = (msg) => {
          socket.off("p2p-transfer-data-" + assetGuid, incomingHandler);
          resolve("p2p");
        };
        socket.on("p2p-transfer-data-" + assetGuid, incomingHandler);

        setTimeout(() => {
          socket.off("p2p-transfer-data-" + assetGuid, incomingHandler);
          console.log(`[P2P] Peer transfer timed out for ${assetGuid}, falling back to server`);
          simulateServerDownload(assetGuid, resolve);
        }, 2000);
      } else {
        simulateServerDownload(assetGuid, resolve);
      }
    };

    socket.on("asset-providers", providerHandler);
  });
}

function simulateServerDownload(assetGuid, resolve) {
  p2pTotalTransfers++;
  console.log(`[P2P] Downloading ${assetGuid} from server`);
  setTimeout(() => {
    assetCache[assetGuid] = true;
    socket.emit("register-asset-holder", wrapMessage("register-asset-holder", { assetGuid }));
    console.log(`[P2P] Registered as holder for ${assetGuid}`);
    resolve("server");
  }, 500);
}

socket.on("p2p-transfer-incoming", (envelope) => {
  const data = envelope.payload;
  const { assetGuid, fromSocketId } = data;
  console.log(`[P2P Server Peer] Transferring cached file ${assetGuid} to requesting Peer Client ${fromSocketId}...`);
  socket.emit("p2p-transfer-data-" + assetGuid, wrapMessage("p2p-transfer-data-" + assetGuid, { assetGuid, from: socket.id }));
});

if (page === "/host.html") {
  const setupPanel = document.getElementById("setup-panel");
  const createLobbyBtn = document.getElementById("create-lobby-btn");
  const quizSelect = document.getElementById("quiz-select");
  const durationInput = document.getElementById("duration-input");
  const setupError = document.getElementById("setup-error");
  const roomCodeHeader = document.getElementById("room-code-header");
  const roomCodeDisplay = document.getElementById("room-code-display");
  const playerList = document.getElementById("player-list");
  const startBtn = document.getElementById("start-game-btn");
  const lobbySection = document.getElementById("lobby");
  const lobbyQuizTitle = document.getElementById("lobby-quiz-title");
  const lobbyQuestionCount = document.getElementById("lobby-question-count");
  const questionArea = document.getElementById("question-area");
  const questionText = document.getElementById("question-text");
  const hostOptions = document.getElementById("host-options");
  const leaderboardSection = document.getElementById("leaderboard");
  const scoreList = document.getElementById("score-list");
  const gameOverSection = document.getElementById("game-over");

  let selectedQuizName = "";

  fetch("/api/quizzes")
    .then((res) => res.json())
    .then((quizzes) => {
      quizzes.forEach((q) => {
        const opt = document.createElement("option");
        opt.value = q.id;
        opt.textContent = q.title + (q.question_count ? ` (${q.question_count} questions)` : "");
        quizSelect.appendChild(opt);
      });
    })
    .catch(() => {
      quizSelect.innerHTML = "<option value=''>Failed to load quizzes</option>";
    });

  createLobbyBtn.addEventListener("click", () => {
    const quizId = quizSelect.value;
    const questionDuration = parseInt(durationInput.value, 10) || 15;
    selectedQuizName = quizId ? quizSelect.options[quizSelect.selectedIndex].text : "Random";
    setupError.textContent = "";
    socket.emit("create-room", wrapMessage("create-room", { quizId, questionDuration }));
  });

  socket.on("room-created", (envelope) => {
    const data = envelope.payload;
    roomCodeDisplay.textContent = data.roomCode;
    roomCodeHeader.style.display = "block";
    lobbyQuizTitle.textContent = "Quiz: " + selectedQuizName;
    lobbyQuestionCount.textContent = data.totalQuestions + " questions loaded";
    setupPanel.style.display = "none";
    lobbySection.style.display = "block";
  });

  socket.on("player-list-update", (envelope) => {
    const data = envelope.payload;
    playerList.innerHTML = "";
    if (data.players.length === 0) {
      playerList.innerHTML = "<li class='empty'>Waiting for players...</li>";
      if (startBtn) startBtn.disabled = true;
    } else {
      data.players.forEach((p) => {
        const li = document.createElement("li");
        li.textContent = p.username;
        if (!p.isOnline) li.classList.add("disconnected");
        playerList.appendChild(li);
      });
      if (startBtn) startBtn.disabled = false;
    }
  });

  if (startBtn) {
    startBtn.addEventListener("click", () => {
      const roomCode = roomCodeDisplay.textContent;
      socket.emit("start-game", wrapMessage("start-game", { roomCode }));
    });
  }

  socket.on("game-started", (envelope) => {
    lobbySection.style.display = "none";
    questionArea.style.display = "block";
    leaderboardSection.style.display = "block";
    gameOverSection.style.display = "none";
  });

  socket.on("next-question", (envelope) => {
    const data = envelope.payload;
    questionText.textContent = data.questionText;
    const labels = ["A", "B", "C", "D"];
    const opts = [data.optionA, data.optionB, data.optionC, data.optionD];
    hostOptions.innerHTML = "";
    labels.forEach((label, i) => {
      const div = document.createElement("div");
      div.className = "option";
      div.innerHTML = `<strong>${label}</strong><br><span class="option-text">${opts[i]}</span>`;
      hostOptions.appendChild(div);
    });
    loadDfsAsset(data.dfsAsset);
  });

  socket.on("question-over", (envelope) => {
    const data = envelope.payload;
    const optionDivs = hostOptions.querySelectorAll(".option");
    optionDivs.forEach((div, i) => {
      const label = String.fromCharCode(65 + i);
      if (label === data.correctOption) {
        div.classList.add("correct");
      }
    });
  });

  socket.on("leaderboard-update", (envelope) => {
    const data = envelope.payload;
    scoreList.innerHTML = "";
    data.ranking.forEach((p, i) => {
      const li = document.createElement("li");
      li.textContent = `${p.username} - ${p.score} pts`;
      if (!p.isOnline) li.classList.add("disconnected");
      if (i === 0) li.classList.add("first");
      scoreList.appendChild(li);
    });
  });

  socket.on("game-over", (envelope) => {
    const data = envelope.payload;
    questionArea.style.display = "none";
    gameOverSection.style.display = "block";
    const finalList = document.getElementById("final-ranking");
    finalList.innerHTML = "";
    data.ranking.forEach((p, i) => {
      const li = document.createElement("li");
      li.textContent = `${i + 1}. ${p.username} - ${p.score} pts`;
      if (i === 0) li.classList.add("winner");
      finalList.appendChild(li);
    });
  });

  const p2pMetricsEl = document.getElementById("p2p-metrics");

  socket.on("p2p-metrics-update", (envelope) => {
    const data = envelope.payload;
    if (p2pMetricsEl) {
      p2pMetricsEl.textContent = `${data.p2pPercent}% of assets downloaded via Peer-to-Peer (${data.peerTransfers}/${data.totalTransfers} transfers)`;
    }
  });

  socket.on("game-error", (envelope) => {
    const data = envelope.payload;
    alert(data.message);
  });

  socket.on("host-disconnected", () => {
    alert("The host has disconnected. This room is no longer available.");
  });
}

if (page === "/" || page === "/index.html") {
  const form = document.getElementById("join-form");
  const errorMsg = document.getElementById("join-error");

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const roomCode = document.getElementById("room-code").value.toUpperCase().trim();
      const username = document.getElementById("player-name").value.trim();

      if (!roomCode || !username) return;

      if (errorMsg) errorMsg.textContent = "";
      socket.emit("join-room", wrapMessage("join-room", { roomCode, username }));
    });
  }

  socket.on("join-success", (envelope) => {
    const data = envelope.payload;
    sessionToken = data.token;
    console.log(`Joined room ${data.roomCode} as ${data.username}`);
    window.location.href = `/player.html?room=${data.roomCode}&name=${encodeURIComponent(data.username)}&token=${encodeURIComponent(sessionToken)}`;
  });

  socket.on("join-error", (envelope) => {
    const data = envelope.payload;
    if (errorMsg) errorMsg.textContent = data.message;
  });

  socket.on("reconnect-success", (envelope) => {
    const data = envelope.payload;
    sessionToken = data.token;
    window.location.href = `/player.html?room=${data.roomCode}&name=${encodeURIComponent(data.username)}&token=${encodeURIComponent(sessionToken)}`;
  });
}

if (page === "/player.html") {
  const params = new URLSearchParams(window.location.search);
  const roomCode = params.get("room");
  const username = params.get("name");
  sessionToken = params.get("token");

  document.getElementById("room-code-display").textContent = roomCode || "---";
  document.getElementById("player-name-display").textContent = username || "Player";

  const waitingArea = document.getElementById("waiting-area");
  const questionArea = document.getElementById("question-area");
  const questionText = document.getElementById("question-text");
  const optionBtns = document.querySelectorAll(".option-btn");
  const timerDisplay = document.getElementById("timer-display");
  const resultOverlay = document.getElementById("result-overlay");

  let answered = false;

  socket.on("reconnect-success", (envelope) => {
    const data = envelope.payload;
    console.log(`Reconnected as ${data.username} with ${data.score} pts`);
  });

  socket.on("join-success", () => {
    waitingArea.innerHTML = "<h2>Waiting for the host to start...</h2>";
    p2pFetchAsset("asset:bgm:lobby.mp3");
    p2pFetchAsset("asset:img:q1_placeholder.png");
    p2pFetchAsset("asset:img:q2_placeholder.png");
    setInterval(() => {
      const pct = p2pTotalTransfers > 0 ? Math.round((p2pPeerTransfers / p2pTotalTransfers) * 100) : 0;
      socket.emit("p2p-metrics-update", wrapMessage("p2p-metrics-update", {
        totalTransfers: p2pTotalTransfers,
        peerTransfers: p2pPeerTransfers,
        p2pPercent: pct,
      }));
    }, 5000);
  });

  socket.on("game-started", () => {
    waitingArea.style.display = "none";
    questionArea.style.display = "block";
  });

  socket.on("next-question", (envelope) => {
    const data = envelope.payload;
    questionText.textContent = data.questionText;
    answered = false;
    const labels = ["A", "B", "C", "D"];
    const options = [data.optionA, data.optionB, data.optionC, data.optionD];
    optionBtns.forEach((btn, i) => {
      btn.textContent = `${labels[i]}: ${options[i]}`;
      btn.disabled = false;
      btn.classList.remove("selected", "correct", "wrong");
    });
    if (resultOverlay) resultOverlay.style.display = "none";
    if (timerDisplay) timerDisplay.textContent = data.duration;
    loadDfsAsset(data.dfsAsset);
  });

  socket.on("timer-tick", (envelope) => {
    const data = envelope.payload;
    if (timerDisplay) timerDisplay.textContent = data.remainingTime;
  });

  optionBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (answered) return;
      answered = true;
      const selected = btn.dataset.option;
      optionBtns.forEach((b) => (b.disabled = true));
      btn.classList.add("selected");
      socket.emit("submit-answer", wrapMessage("submit-answer", {
        roomCode,
        username,
        selectedOption: selected,
        token: sessionToken,
      }));
    });
  });

  socket.on("answer-result", (envelope) => {
    const data = envelope.payload;
    if (resultOverlay) {
      resultOverlay.style.display = "block";
      if (data.isCorrect) {
        resultOverlay.textContent = `Correct! +${data.points} pts`;
        resultOverlay.className = "result-correct";
      } else {
        resultOverlay.textContent = `Wrong! Answer was ${data.correctOption}`;
        resultOverlay.className = "result-wrong";
      }
    }
    optionBtns.forEach((btn) => {
      if (btn.dataset.option === data.correctOption) {
        btn.classList.add("correct");
      } else if (btn.classList.contains("selected") && !data.isCorrect) {
        btn.classList.add("wrong");
      }
    });
  });

  socket.on("question-over", (envelope) => {
    const data = envelope.payload;
    optionBtns.forEach((btn) => {
      btn.disabled = true;
      if (btn.dataset.option === data.correctOption) {
        btn.classList.add("correct");
      }
    });
  });

  socket.on("game-over", () => {
    questionArea.innerHTML = "<h2>Game Over!</h2><p>Thanks for playing!</p>";
  });

  socket.on("unauthorized-action", (envelope) => {
    const data = envelope.payload;
    alert("Security violation: " + data.message);
    console.error("[Security] Unauthorized action:", data.message);
  });

  socket.on("host-disconnected", () => {
    alert("The host has ended the game.");
  });
}
