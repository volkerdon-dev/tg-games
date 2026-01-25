import { getInitData, initTelegram, sendEvent } from "../shared/telegram.js";
import { loadState, saveState, touch } from "../shared/storage.js";
import { setText } from "../shared/ui.js";
import { applyI18n, getLang, loadDict, t } from "../shared/i18n.js";

initTelegram();
await loadDict(getLang());
await applyI18n();

const state = loadState();
touch(state);

// -------------------- UI refs --------------------
const boardEl = document.getElementById("board");
const sideEl = document.getElementById("side");
const levelEl = document.getElementById("level");
const humanLikeEl = document.getElementById("humanLike");
const thinkTimeEl = document.getElementById("thinkTime");
const statusTagEl = document.getElementById("statusTag");
const statusBarEl = document.getElementById("statusBar");
const engineBadgeEl = document.getElementById("engineBadge");
const engineRetryEl = document.getElementById("engineRetry");
const moveListEl = document.getElementById("moveList");
const settingsPanelEl = document.getElementById("settingsPanel");
const settingsToggleEl = document.getElementById("settingsToggle");
const settingsSummaryEl = document.getElementById("settingsSummary");

const timeControlEl = document.getElementById("timeControl");
const customTimeWrap = document.getElementById("customTimeWrap");
const timeMinutesEl = document.getElementById("timeMinutes");
const timeSecondsEl = document.getElementById("timeSeconds");

const filesTopEl = document.getElementById("filesTop");
const filesBottomEl = document.getElementById("filesBottom");
const ranksLeftEl = document.getElementById("ranksLeft");
const ranksRightEl = document.getElementById("ranksRight");

const hintTextEl = document.getElementById("hintText");

const playerClockLabelEl = document.getElementById("playerClockLabel");
const playerClockEl = document.getElementById("playerClock");

const newGameBtn = document.getElementById("newGame");
const resignBtn = document.getElementById("endGame");
const undoBtn = document.getElementById("undo");
const hintBtn = document.getElementById("hint");
const resetBtn = document.getElementById("reset");
const coachBtn = document.getElementById("coachBtn");
const coachModalEl = document.getElementById("coachModal");
const coachCloseBtn = document.getElementById("coachClose");
const coachContentEl = document.getElementById("coachContent");
const coachStatusEl = document.getElementById("coachStatus");
const coachCopyBtn = document.getElementById("coachCopy");
const coachRetryBtn = document.getElementById("coachRetry");
const coachDisclaimerEl = document.getElementById("coachDisclaimer");

// Promotion modal
const promoModalEl = document.getElementById("promoModal");
const promoTitleEl = document.getElementById("promoTitle");
const promoBtns = Array.from(document.querySelectorAll(".promoBtn"));

// -------------------- pieces --------------------
// Use filled glyphs and color them for solid look.
const GLYPH = { K:"♚", Q:"♛", R:"♜", B:"♝", N:"♞", P:"♟" };

const VALUE = { P:1, N:3, B:3, R:5, Q:9, K:1000 };

const OFFSETS = {
  N: [-33,-31,-18,-14,14,18,31,33],
  B: [-17,-15,15,17],
  R: [-16,-1,1,16],
  Q: [-17,-16,-15,-1,1,15,16,17],
  K: [-17,-16,-15,-1,1,15,16,17]
};

const WHITE = "w";
const BLACK = "b";
const PAWN_ATTACK_OFFSETS = {
  [WHITE]: [-17, -15],
  [BLACK]: [17, 15],
};

// 0x88 helpers
const isOffboard = (sq) => (sq & 0x88) !== 0;
const rankOf = (sq) => sq >> 4;
const fileOf = (sq) => sq & 7;
const sqOf = (rank, file) => (rank << 4) | file;

const algebraic = (sq) => {
  const file = "abcdefgh"[fileOf(sq)];
  const rank = String(8 - rankOf(sq));
  return file + rank;
};

function moveToUci(move) {
  const from = algebraic(move.from);
  const to = algebraic(move.to);
  const promo = move.promotion ? String(move.promotion).toLowerCase() : "";
  return `${from}${to}${promo}`;
}

function popMoveUci() {
  if (gameMovesUci.length) gameMovesUci.pop();
}

function opponent(color){ return color === WHITE ? BLACK : WHITE; }
function clonePiece(p){ return p ? { c: p.c, t: p.t } : null; }
function sideLabel(color) { return color === WHITE ? t("common.white") : t("common.black"); }

// -------------------- engine state --------------------
let game = null;

let gameSeq = 0;

let pendingPromotion = null;
let promoSeq = 0;

let startFen = "";
let gameMovesUci = [];

let coachAbort = null;
let coachRequestSeq = 0;
let coachData = null;

// -------------------- Engine mode (visible) --------------------
const engineStatus = {
  mode: "fallback", // "stockfish" | "fallback" | "loading"
  reason: "",
  source: null, // "local" | "cdn"
};

function setEngineStatus(mode, { reason = "", source = null } = {}) {
  engineStatus.mode = mode;
  engineStatus.reason = reason;
  engineStatus.source = source;
  updateEngineBadge();
}

function updateEngineBadge() {
  if (!engineBadgeEl) return;
  const isSf = engineStatus.mode === "stockfish";
  const isLoading = engineStatus.mode === "loading";
  engineBadgeEl.classList.toggle("stockfish", isSf);
  engineBadgeEl.classList.toggle("fallback", !isSf && !isLoading);
  engineBadgeEl.classList.toggle("neutral", isLoading);
  let text = "Engine: Smart AI (fallback) ⚠️";
  if (isLoading) text = "Engine: Loading…";
  if (isSf) text = "Engine: Stockfish ✅";
  if (!isSf && !isLoading && engineStatus.reason) text += ` (${engineStatus.reason})`;
  engineBadgeEl.textContent = text;
  if (engineRetryEl) {
    const canRetry = !isSf;
    engineRetryEl.disabled = !canRetry || isLoading;
    engineRetryEl.style.display = canRetry ? "inline-flex" : "none";
  }
}

// -------------------- AI presets (named) --------------------
const AI_PRESETS = {
  // Six tiers: beginner -> grandmaster
  // Axes:
  // - UCI_LimitStrength / UCI_Elo / Skill Level
  // - movetime (ms) (can be overridden by Think time control)
  // - human-like selection (weights + eval drop cap)
  //
  // NOTE: UI enforces a minimum 2s visual delay, so very low movetime still *looks* clear.
  beginner: {
    limitStrength: true,
    elo: 800,
    skill: 2,
    movetime: 150,
    multiPv: 4,
    humanWeights: [0.25, 0.35, 0.25, 0.15],
    maxDropCp: 500,
    tacticalBias: 0.14,
  },
  easy: {
    limitStrength: true,
    elo: 1100,
    skill: 5,
    movetime: 250,
    multiPv: 4,
    humanWeights: [0.45, 0.3, 0.2, 0.05],
    maxDropCp: 320,
    tacticalBias: 0.1,
  },
  intermediate: {
    limitStrength: true,
    elo: 1400,
    skill: 8,
    movetime: 400,
    multiPv: 3,
    humanWeights: [0.65, 0.25, 0.1],
    maxDropCp: 260,
    tacticalBias: 0.0,
  },
  advanced: {
    limitStrength: true,
    elo: 1700,
    skill: 12,
    movetime: 700,
    multiPv: 3,
    humanWeights: [0.8, 0.2],
    maxDropCp: 150,
    tacticalBias: 0.0,
  },
  expert: {
    limitStrength: true,
    elo: 2100,
    skill: 16,
    movetime: 1200,
    multiPv: 2,
    humanWeights: [0.9, 0.1],
    maxDropCp: 120,
    tacticalBias: 0.0,
  },
  grandmaster: {
    limitStrength: true,
    elo: 2600,
    skill: 20,
    movetime: 2800,
    multiPv: 2,
    humanWeights: [0.97, 0.03],
    maxDropCp: 80,
    tacticalBias: 0.0,
  },
};

const AI_LEVEL_STORAGE_KEY = "chess.aiLevel";
const AI_HUMAN_STORAGE_KEY = "chess.humanLike";

function normalizeLevelKey(raw) {
  const key = String(raw || "").toLowerCase();
  if (AI_PRESETS[key]) return key;
  const legacyMap = {
    casual: "intermediate",
    club: "advanced",
    strong: "expert",
    master: "grandmaster",
    im: "grandmaster",
    gm: "grandmaster",
    supergm: "grandmaster",
  };
  return legacyMap[key] || "intermediate";
}

function readThinkTimeOverrideMs() {
  const v = String(thinkTimeEl?.value ?? "auto").trim().toLowerCase();
  if (!v || v === "auto") return null;
  const seconds = Number(v);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round(seconds * 1000);
}

function loadAiSettingsFromStorage() {
  try {
    const savedLevel = localStorage.getItem(AI_LEVEL_STORAGE_KEY);
    if (savedLevel && levelEl) {
      const normalized = normalizeLevelKey(savedLevel);
      levelEl.value = normalized;
    }
  } catch {
    // ignore storage issues
  }
  try {
    const savedHuman = localStorage.getItem(AI_HUMAN_STORAGE_KEY);
    if (humanLikeEl) {
      humanLikeEl.checked = savedHuman == null ? true : !(savedHuman === "0" || savedHuman === "false");
    }
  } catch {
    // ignore storage issues
  }
}

function saveAiSettingsToStorage() {
  try {
    if (levelEl) localStorage.setItem(AI_LEVEL_STORAGE_KEY, String(levelEl.value || "intermediate"));
    if (humanLikeEl) localStorage.setItem(AI_HUMAN_STORAGE_KEY, humanLikeEl.checked ? "1" : "0");
  } catch {
    // ignore storage issues
  }
}

function getAiPreset() {
  const key = normalizeLevelKey(levelEl?.value || "intermediate");
  const base = AI_PRESETS[key] ? { key, ...AI_PRESETS[key] } : { key: "intermediate", ...AI_PRESETS.intermediate };
  const override = readThinkTimeOverrideMs();
  const movetime = override != null ? override : base.movetime;
  const humanLike = humanLikeEl ? Boolean(humanLikeEl.checked) : true;
  const multiPv = humanLike ? base.multiPv : 1;
  return {
    ...base,
    movetime,
    thinkTimeOverrideMs: override,
    humanLike,
    multiPv,
  };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function createEmptyBoard() {
  return new Array(128).fill(null);
}

function initialGame(playerColor) {
  const board = createEmptyBoard();
  const put = (r,f,c,t) => { board[sqOf(r,f)] = { c, t }; };

  // black
  put(0,0,BLACK,"R"); put(0,1,BLACK,"N"); put(0,2,BLACK,"B"); put(0,3,BLACK,"Q");
  put(0,4,BLACK,"K"); put(0,5,BLACK,"B"); put(0,6,BLACK,"N"); put(0,7,BLACK,"R");
  for (let f=0; f<8; f++) put(1,f,BLACK,"P");

  // white
  for (let f=0; f<8; f++) put(6,f,WHITE,"P");
  put(7,0,WHITE,"R"); put(7,1,WHITE,"N"); put(7,2,WHITE,"B"); put(7,3,WHITE,"Q");
  put(7,4,WHITE,"K"); put(7,5,WHITE,"B"); put(7,6,WHITE,"N"); put(7,7,WHITE,"R");

  return {
    id: ++gameSeq,
    board,
    playerColor,
    aiColor: opponent(playerColor),

    turn: WHITE,
    castling: { wK:true, wQ:true, bK:true, bQ:true },
    ep: -1,
    plies: 0,
    kingSq: { w: sqOf(7,4), b: sqOf(0,4) },

    gameOver: false,
    result: null,

    // UI selection
    selectedSq: -1,
    selectedMoves: [],
    hintMap: new Map(),

    // undo for real moves only
    undoStack: [],

    // last move highlight
    lastMove: null,
    moveHistory: [],
    checkHighlight: { color: null, isMate: false },

    aiThinking: false,

    // clock: ONLY for player (AI clock removed)
    clock: {
      enabled: false,
      playerMs: 0,
      timerId: null,
      lastTs: null,
    }
  };
}

function parseFen(fen) {
  if (!fen || typeof fen !== "string") throw new Error("Empty FEN");
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) throw new Error("Invalid FEN fields");

  const [boardPart, turnPart, castlingPart = "-", epPart = "-", halfmovePart = "0"] = parts;
  const rows = boardPart.split("/");
  if (rows.length !== 8) throw new Error("Invalid FEN board");

  const board = createEmptyBoard();
  let whiteKing = -1;
  let blackKing = -1;

  rows.forEach((row, r) => {
    let file = 0;
    for (const char of row) {
      if (/[1-8]/.test(char)) {
        file += Number.parseInt(char, 10);
        continue;
      }
      const piece = char.toUpperCase();
      if (!"KQRBNP".includes(piece)) throw new Error("Invalid piece");
      const color = char === char.toUpperCase() ? WHITE : BLACK;
      if (file > 7) throw new Error("Invalid file");
      const square = sqOf(r, file);
      board[square] = { c: color, t: piece };
      if (piece === "K") {
        if (color === WHITE) whiteKing = square;
        else blackKing = square;
      }
      file += 1;
    }
    if (file !== 8) throw new Error("Invalid row width");
  });

  if (whiteKing === -1 || blackKing === -1) throw new Error("Missing king");
  const turn = turnPart === WHITE || turnPart === BLACK ? turnPart : null;
  if (!turn) throw new Error("Invalid turn");

  const castling = { wK: false, wQ: false, bK: false, bQ: false };
  if (castlingPart !== "-") {
    if (/[^KQkq]/.test(castlingPart)) throw new Error("Invalid castling");
    castling.wK = castlingPart.includes("K");
    castling.wQ = castlingPart.includes("Q");
    castling.bK = castlingPart.includes("k");
    castling.bQ = castlingPart.includes("q");
  }

  let ep = -1;
  if (epPart !== "-") {
    if (!/^[a-h][36]$/.test(epPart)) throw new Error("Invalid en passant");
    const file = "abcdefgh".indexOf(epPart[0]);
    const rank = 8 - Number.parseInt(epPart[1], 10);
    ep = sqOf(rank, file);
  }

  const halfmove = Number.parseInt(halfmovePart, 10);

  return {
    board,
    turn,
    castling,
    ep,
    kingSq: { w: whiteKing, b: blackKing },
    halfmove: Number.isFinite(halfmove) ? halfmove : 0,
  };
}

function pieceAt(sq){ return game.board[sq]; }
function setPiece(sq, p){ game.board[sq] = p; }

// -------------------- coords + orientation --------------------
function orientation() {
  return game.playerColor === BLACK ? "black" : "white";
}

function updateCoords() {
  const ori = orientation();
  const files = (ori === "white")
    ? ["a","b","c","d","e","f","g","h"]
    : ["h","g","f","e","d","c","b","a"];

  const ranks = (ori === "white")
    ? ["8","7","6","5","4","3","2","1"]
    : ["1","2","3","4","5","6","7","8"];

  filesTopEl.innerHTML = files.map(x => `<span>${x}</span>`).join("");
  filesBottomEl.innerHTML = files.map(x => `<span>${x}</span>`).join("");
  ranksLeftEl.innerHTML = ranks.map(x => `<span>${x}</span>`).join("");
  ranksRightEl.innerHTML = ranks.map(x => `<span>${x}</span>`).join("");
}

function displayToSq(r, c) {
  const ori = orientation();
  const rank = (ori === "white") ? r : (7 - r);
  const file = (ori === "white") ? c : (7 - c);
  return sqOf(rank, file);
}

// -------------------- clock (player only) --------------------
function stopClock() {
  if (game?.clock?.timerId) {
    clearInterval(game.clock.timerId);
    game.clock.timerId = null;
  }
  if (game?.clock) game.clock.lastTs = null;
}

function formatMs(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function renderPlayerClock() {
  if (!playerClockEl) return;

  if (!game.clock.enabled) {
    playerClockLabelEl.textContent = t("chess.clock.off");
    playerClockEl.textContent = t("common.dash");
    return;
  }

  const sideName = sideLabel(game.playerColor);
  playerClockLabelEl.textContent = t("chess.clock.label", { side: sideName });
  playerClockEl.textContent = formatMs(game.clock.playerMs);
}

function onTimeout() {
  if (game.gameOver) return;

  game.gameOver = true;
  game.result = { type: "timeout", winner: game.aiColor, loser: game.playerColor };
  stopClock();
  clearSelection();
  render();
  onGameFinished();
}

function tickClock() {
  if (!game.clock.enabled) return;
  if (game.gameOver) return;

  // IMPORTANT: clock ticks ONLY on player's turn (AI clock removed)
  if (game.turn !== game.playerColor) {
    game.clock.lastTs = performance.now();
    return;
  }

  const now = performance.now();
  if (game.clock.lastTs == null) game.clock.lastTs = now;

  const dt = now - game.clock.lastTs;
  game.clock.lastTs = now;

  game.clock.playerMs -= dt;

  if (game.clock.playerMs <= 0) return onTimeout();

  renderPlayerClock();
}

function startClockIfEnabled() {
  stopClock();
  if (!game.clock.enabled) {
    renderPlayerClock();
    return;
  }
  game.clock.lastTs = performance.now();
  game.clock.timerId = setInterval(tickClock, 200);
  renderPlayerClock();
}

function readTimeSettingSeconds() {
  const v = timeControlEl?.value ?? "20";
  if (v === "off") return null;
  if (v === "custom") {
    const mm = Math.max(0, parseInt(timeMinutesEl?.value ?? "20", 10) || 0);
    const ss = Math.max(0, Math.min(59, parseInt(timeSecondsEl?.value ?? "0", 10) || 0));
    return mm * 60 + ss;
  }
  const minutes = Math.max(0, parseInt(v, 10) || 0);
  return minutes * 60;
}

function initClockFromUI() {
  const seconds = readTimeSettingSeconds();
  if (!seconds || seconds <= 0) {
    game.clock.enabled = false;
    game.clock.playerMs = 0;
    startClockIfEnabled();
    return;
  }
  game.clock.enabled = true;
  game.clock.playerMs = seconds * 1000;
  startClockIfEnabled();
}

// -------------------- attack / check --------------------
function isSquareAttacked(byColor, targetSq) {
  // pawns
  for (const offset of PAWN_ATTACK_OFFSETS[byColor]) {
    const from = targetSq - offset;
    if (isOffboard(from)) continue;
    const p = pieceAt(from);
    if (p && p.c === byColor && p.t === "P") return true;
  }

  // knights
  for (const d of OFFSETS.N) {
    const sq = targetSq + d;
    if (isOffboard(sq)) continue;
    const p = pieceAt(sq);
    if (p && p.c===byColor && p.t==="N") return true;
  }

  // bishops/queens
  for (const d of OFFSETS.B) {
    let sq = targetSq + d;
    while (!isOffboard(sq)) {
      const p = pieceAt(sq);
      if (p) {
        if (p.c===byColor && (p.t==="B" || p.t==="Q")) return true;
        break;
      }
      sq += d;
    }
  }

  // rooks/queens
  for (const d of OFFSETS.R) {
    let sq = targetSq + d;
    while (!isOffboard(sq)) {
      const p = pieceAt(sq);
      if (p) {
        if (p.c===byColor && (p.t==="R" || p.t==="Q")) return true;
        break;
      }
      sq += d;
    }
  }

  // king
  for (const d of OFFSETS.K) {
    const sq = targetSq + d;
    if (isOffboard(sq)) continue;
    const p = pieceAt(sq);
    if (p && p.c===byColor && p.t==="K") return true;
  }

  return false;
}

function inCheck(color) {
  return isSquareAttacked(opponent(color), game.kingSq[color]);
}

function formatMoveText(move) {
  const from = algebraic(move.from);
  const to = algebraic(move.to);
  const sep = move.capture ? "x" : "-";
  let text = `${from}${sep}${to}`;
  if (move.promotion) text += `=${move.promotion}`;
  return text;
}

function renderMoveList() {
  if (!moveListEl || !game) return;
  moveListEl.innerHTML = "";
  const moves = game.moveHistory || [];
  for (let i = 0; i < moves.length; i += 2) {
    const row = document.createElement("div");
    row.className = "moveRow";

    const num = document.createElement("span");
    num.className = "moveNumber";
    num.textContent = `${Math.floor(i / 2) + 1}.`;

    const text = document.createElement("span");
    text.className = "moveText";
    const white = moves[i] || "";
    const black = moves[i + 1] ? ` ${moves[i + 1]}` : "";
    text.textContent = `${white}${black}`.trim();

    row.appendChild(num);
    row.appendChild(text);
    moveListEl.appendChild(row);
  }
  requestAnimationFrame(() => {
    moveListEl.scrollTop = moveListEl.scrollHeight;
  });
}

function pushMoveHistory(move) {
  if (!game) return;
  if (!Array.isArray(game.moveHistory)) game.moveHistory = [];
  game.moveHistory.push(formatMoveText(move));
  renderMoveList();
}

function popMoveHistory() {
  if (!game?.moveHistory?.length) return;
  game.moveHistory.pop();
  renderMoveList();
}

// -------------------- move gen (pseudo) --------------------
function addMove(moves, move) {
  if (move.capture && move.capture.t === "K") return;
  moves.push(move);
}

function genPseudoMoves(color) {
  const moves = [];

  for (let sq=0; sq<128; sq++) {
    if (isOffboard(sq)) { sq += 7; continue; }
    const p = pieceAt(sq);
    if (!p || p.c !== color) continue;

    if (p.t === "P") {
      const dir = (color === WHITE) ? -16 : 16;
      const startRank = (color === WHITE) ? 6 : 1;
      const promoteRank = (color === WHITE) ? 0 : 7;

      const one = sq + dir;
      if (!isOffboard(one) && !pieceAt(one)) {
        if (rankOf(one) === promoteRank) {
          for (const promo of ["Q","R","B","N"]) addMove(moves, { from:sq,to:one,piece:clonePiece(p),capture:null,promotion:promo,flags:"p" });
        } else {
          addMove(moves, { from:sq,to:one,piece:clonePiece(p),capture:null,promotion:null,flags:"" });
        }
        const two = sq + dir*2;
        if (rankOf(sq) === startRank && !isOffboard(two) && !pieceAt(two)) {
          addMove(moves, { from:sq,to:two,piece:clonePiece(p),capture:null,promotion:null,flags:"2" });
        }
      }

      for (const capDir of PAWN_ATTACK_OFFSETS[color]) {
        const to = sq + capDir;
        if (isOffboard(to)) continue;

        if (to === game.ep) {
          addMove(moves, { from:sq,to,piece:clonePiece(p),capture:{c:opponent(color),t:"P"},promotion:null,flags:"e" });
          continue;
        }

        const target = pieceAt(to);
        if (target && target.c !== color) {
          if (rankOf(to) === promoteRank) {
            for (const promo of ["Q","R","B","N"]) addMove(moves, { from:sq,to,piece:clonePiece(p),capture:clonePiece(target),promotion:promo,flags:"cp" });
          } else {
            addMove(moves, { from:sq,to,piece:clonePiece(p),capture:clonePiece(target),promotion:null,flags:"c" });
          }
        }
      }
      continue;
    }

    if (p.t === "N") {
      for (const d of OFFSETS.N) {
        const to = sq + d;
        if (isOffboard(to)) continue;
        const target = pieceAt(to);
        if (!target) addMove(moves, { from:sq,to,piece:clonePiece(p),capture:null,promotion:null,flags:"" });
        else if (target.c !== color) addMove(moves, { from:sq,to,piece:clonePiece(p),capture:clonePiece(target),promotion:null,flags:"c" });
      }
      continue;
    }

    if (p.t === "B" || p.t === "R" || p.t === "Q") {
      const dirs = (p.t === "B") ? OFFSETS.B : (p.t === "R" ? OFFSETS.R : OFFSETS.Q);
      for (const d of dirs) {
        let to = sq + d;
        while (!isOffboard(to)) {
          const target = pieceAt(to);
          if (!target) addMove(moves, { from:sq,to,piece:clonePiece(p),capture:null,promotion:null,flags:"" });
          else {
            if (target.c !== color) addMove(moves, { from:sq,to,piece:clonePiece(p),capture:clonePiece(target),promotion:null,flags:"c" });
            break;
          }
          to += d;
        }
      }
      continue;
    }

    if (p.t === "K") {
      for (const d of OFFSETS.K) {
        const to = sq + d;
        if (isOffboard(to)) continue;
        const target = pieceAt(to);
        if (!target) addMove(moves, { from:sq,to,piece:clonePiece(p),capture:null,promotion:null,flags:"" });
        else if (target.c !== color) addMove(moves, { from:sq,to,piece:clonePiece(p),capture:clonePiece(target),promotion:null,flags:"c" });
      }

      // castling (same as before)
      if (color === WHITE) {
        if (game.castling.wK) {
          const e1 = sqOf(7,4), f1 = sqOf(7,5), g1 = sqOf(7,6), h1 = sqOf(7,7);
          if (sq === e1 && pieceAt(h1)?.t === "R" && !pieceAt(f1) && !pieceAt(g1)) {
            if (!inCheck(WHITE) && !isSquareAttacked(BLACK,f1) && !isSquareAttacked(BLACK,g1)) {
              addMove(moves, { from:e1,to:g1,piece:{c:WHITE,t:"K"},capture:null,promotion:null,flags:"k" });
            }
          }
        }
        if (game.castling.wQ) {
          const e1 = sqOf(7,4), d1 = sqOf(7,3), c1 = sqOf(7,2), b1 = sqOf(7,1), a1 = sqOf(7,0);
          if (sq === e1 && pieceAt(a1)?.t === "R" && !pieceAt(d1) && !pieceAt(c1) && !pieceAt(b1)) {
            if (!inCheck(WHITE) && !isSquareAttacked(BLACK,d1) && !isSquareAttacked(BLACK,c1)) {
              addMove(moves, { from:e1,to:c1,piece:{c:WHITE,t:"K"},capture:null,promotion:null,flags:"q" });
            }
          }
        }
      } else {
        if (game.castling.bK) {
          const e8 = sqOf(0,4), f8 = sqOf(0,5), g8 = sqOf(0,6), h8 = sqOf(0,7);
          if (sq === e8 && pieceAt(h8)?.t === "R" && !pieceAt(f8) && !pieceAt(g8)) {
            if (!inCheck(BLACK) && !isSquareAttacked(WHITE,f8) && !isSquareAttacked(WHITE,g8)) {
              addMove(moves, { from:e8,to:g8,piece:{c:BLACK,t:"K"},capture:null,promotion:null,flags:"k" });
            }
          }
        }
        if (game.castling.bQ) {
          const e8 = sqOf(0,4), d8 = sqOf(0,3), c8 = sqOf(0,2), b8 = sqOf(0,1), a8 = sqOf(0,0);
          if (sq === e8 && pieceAt(a8)?.t === "R" && !pieceAt(d8) && !pieceAt(c8) && !pieceAt(b8)) {
            if (!inCheck(BLACK) && !isSquareAttacked(WHITE,d8) && !isSquareAttacked(WHITE,c8)) {
              addMove(moves, { from:e8,to:c8,piece:{c:BLACK,t:"K"},capture:null,promotion:null,flags:"q" });
            }
          }
        }
      }
      continue;
    }
  }

  return moves;
}

// -------------------- APPLY / REVERT --------------------
function applyMove(move, { recordUndo = false } = {}) {
  const color = move.piece.c;
  const opp = opponent(color);

  const prev = {
    from: move.from,
    to: move.to,
    moved: clonePiece(pieceAt(move.from)) || clonePiece(move.piece),
    captured: clonePiece(pieceAt(move.to)),
    prevCastling: { ...game.castling },
    prevEp: game.ep,
    prevPlies: game.plies,
    prevTurn: game.turn,
    prevKingW: game.kingSq.w,
    prevKingB: game.kingSq.b,
    prevGameOver: game.gameOver,
    prevResult: game.result ? { ...game.result } : null,
    rookMove: null,
    epCapture: null,
    prevClockPlayerMs: recordUndo ? game.clock.playerMs : null,
    prevLastMove: recordUndo ? (game.lastMove ? { ...game.lastMove } : null) : null,
  };

  game.ep = -1;

  if (move.flags.includes("e")) {
    const capSq = (color === WHITE) ? (move.to + 16) : (move.to - 16);
    prev.epCapture = { sq: capSq, piece: clonePiece(pieceAt(capSq)) };
    setPiece(capSq, null);
  }

  if (prev.moved?.t === "K") {
    if (color === WHITE) { game.castling.wK = false; game.castling.wQ = false; }
    else { game.castling.bK = false; game.castling.bQ = false; }
  }
  if (prev.moved?.t === "R") {
    if (move.from === sqOf(7,7)) game.castling.wK = false;
    if (move.from === sqOf(7,0)) game.castling.wQ = false;
    if (move.from === sqOf(0,7)) game.castling.bK = false;
    if (move.from === sqOf(0,0)) game.castling.bQ = false;
  }
  if (prev.captured?.t === "R") {
    if (move.to === sqOf(7,7)) game.castling.wK = false;
    if (move.to === sqOf(7,0)) game.castling.wQ = false;
    if (move.to === sqOf(0,7)) game.castling.bK = false;
    if (move.to === sqOf(0,0)) game.castling.bQ = false;
  }

  setPiece(move.from, null);

  let placed = clonePiece(move.piece);
  if (move.promotion) placed = { c: color, t: move.promotion };
  setPiece(move.to, placed);

  if (move.flags === "k" || move.flags === "q") {
    if (color === WHITE) {
      if (move.flags === "k") {
        const h1 = sqOf(7,7), f1 = sqOf(7,5);
        prev.rookMove = { from: h1, to: f1, piece: clonePiece(pieceAt(h1)) };
        setPiece(f1, pieceAt(h1));
        setPiece(h1, null);
      } else {
        const a1 = sqOf(7,0), d1 = sqOf(7,3);
        prev.rookMove = { from: a1, to: d1, piece: clonePiece(pieceAt(a1)) };
        setPiece(d1, pieceAt(a1));
        setPiece(a1, null);
      }
    } else {
      if (move.flags === "k") {
        const h8 = sqOf(0,7), f8 = sqOf(0,5);
        prev.rookMove = { from: h8, to: f8, piece: clonePiece(pieceAt(h8)) };
        setPiece(f8, pieceAt(h8));
        setPiece(h8, null);
      } else {
        const a8 = sqOf(0,0), d8 = sqOf(0,3);
        prev.rookMove = { from: a8, to: d8, piece: clonePiece(pieceAt(a8)) };
        setPiece(d8, pieceAt(a8));
        setPiece(a8, null);
      }
    }
  }

  if (placed.t === "K") game.kingSq[color] = move.to;

  if (move.piece.t === "P" && move.flags === "2") {
    game.ep = (color === WHITE) ? (move.from - 16) : (move.from + 16);
  }

  game.turn = opp;
  game.plies += 1;

  if (recordUndo) {
    game.undoStack.push(prev);
    game.lastMove = { from: move.from, to: move.to };
    gameMovesUci.push(moveToUci(move));
    pushMoveHistory(move);
    if (game.clock.enabled) game.clock.lastTs = performance.now();
  }

  return prev;
}

function revertMove(prev) {
  game.castling = { ...prev.prevCastling };
  game.ep = prev.prevEp;
  game.plies = prev.prevPlies;
  game.turn = prev.prevTurn;
  game.kingSq.w = prev.prevKingW;
  game.kingSq.b = prev.prevKingB;
  game.gameOver = prev.prevGameOver;
  game.result = prev.prevResult ? { ...prev.prevResult } : null;

  if (prev.rookMove) {
    setPiece(prev.rookMove.from, prev.rookMove.piece);
    setPiece(prev.rookMove.to, null);
  }

  setPiece(prev.from, prev.moved);
  setPiece(prev.to, prev.captured);

  if (prev.epCapture) {
    setPiece(prev.epCapture.sq, prev.epCapture.piece);
  }

  if (prev.prevClockPlayerMs != null) {
    game.clock.playerMs = prev.prevClockPlayerMs;
    game.clock.lastTs = performance.now();
  }

  if (prev.prevLastMove !== undefined) {
    game.lastMove = prev.prevLastMove;
  }
}

// -------------------- legal moves --------------------
function genLegalMoves(color) {
  const pseudo = genPseudoMoves(color);
  const legal = [];

  for (const m of pseudo) {
    const undo = applyMove(m, { recordUndo: false });
    const illegal = inCheck(color);
    revertMove(undo);
    if (!illegal) legal.push(m);
  }
  return legal;
}

function legalMovesFromSquare(color, fromSq) {
  return genLegalMoves(color).filter(m => m.from === fromSq);
}

function finalizeIfGameOver() {
  const sideToPlay = game.turn;
  const legal = genLegalMoves(sideToPlay);

  if (legal.length > 0) {
    game.gameOver = false;
    game.result = null;
    return;
  }

  if (inCheck(sideToPlay)) {
    game.gameOver = true;
    game.result = { type: "checkmate", winner: opponent(sideToPlay) };
  } else {
    game.gameOver = true;
    game.result = { type: "stalemate", winner: null };
  }

  stopClock();
}

// -------------------- AI --------------------
function evaluateMove(move, preset, { deterministic = false } = {}) {
  let score = 0;
  if (move.capture) score += VALUE[move.capture.t] * 10;
  if (move.promotion) score += 90;
  if (move.flags === "k" || move.flags === "q") score += 2;

  const undo = applyMove(move, { recordUndo: false });
  const givesCheck = inCheck(game.turn);
  revertMove(undo);
  if (givesCheck) score += 6;

  if (!deterministic) {
    // Fallback AI: weaker presets = more randomness
    const skill = Math.max(0, Math.min(20, Number(preset?.skill ?? 4)));
    const noiseFactor = (22 - skill); // 2..22
    score += Math.random() * noiseFactor * 3;
  }
  return score;
}

// ---- Stockfish WASM (UCI) via WebWorker ----
let sf = {
  worker: null,
  initPromise: null,
  ready: false,
  pendingReadies: [],
  currentJob: null, // { resolve, reject, bestMovePending, token }
  lastMultiPv: [],
  uciEloRange: null,
  supports: {
    elo: false,
    limitStrength: false,
    skill: false,
    multiPv: false,
  },
  version: null,
  lastErrorReason: "",
  lastInitAttemptMs: 0,
  hasLoggedStartup: false,
};

const STOCKFISH_LOCAL_URL = "./engine/stockfish.worker.js";
const STOCKFISH_INIT_TIMEOUT_MS = 12000;
const STOCKFISH_RETRY_COOLDOWN_MS = 5000;

function sfPost(cmd) {
  try { sf.worker?.postMessage(cmd); } catch { /* ignore */ }
}

function sfStop() {
  if (!sf.worker) return;
  sfPost("stop");
}

function classifyEngineError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  if (!msg) return "Unknown error";
  if (msg.includes("timeout")) return "Timeout";
  if (msg.includes("worker") && msg.includes("blocked")) return "Worker blocked";
  if (msg.includes("security")) return "Worker blocked";
  if (msg.includes("cors") || msg.includes("cross-origin") || msg.includes("origin")) return "Network blocked";
  if (msg.includes("failed to load") || msg.includes("not found") || msg.includes("404")) return "Missing engine file";
  if (msg.includes("wasm")) return "WASM load error";
  return "Worker error";
}

function sfTerminate({ reason = "" } = {}) {
  try { sf.worker?.terminate(); } catch { /* ignore */ }
  sf.worker = null;
  sf.ready = false;
  sf.pendingReadies = [];
  if (sf.currentJob) {
    try { sf.currentJob.reject(new Error("Stockfish terminated")); } catch { /* ignore */ }
  }
  sf.currentJob = null;
  sf.initPromise = null;
  sf.lastErrorReason = reason;
  sf.uciEloRange = null;
  sf.supports = { elo: false, limitStrength: false, skill: false, multiPv: false };
  setEngineStatus("fallback", { reason: reason || t("chess.engine.unavailable") });
}

function createStockfishWorker(url, { timeoutMs = STOCKFISH_INIT_TIMEOUT_MS } = {}) {
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(url);
    } catch (e) {
      reject(e);
      return;
    }

    const onError = (e) => {
      cleanup();
      try { worker.terminate(); } catch { /* ignore */ }
      const err = e?.error || new Error("Stockfish worker error");
      reject(err);
    };

    let gotUciOk = false;
    let gotReadyOk = false;
    const onMessage = (ev) => {
      const line = String(ev?.data ?? "");
      if (!line) return;
      if (line.includes("uciok")) {
        gotUciOk = true;
        try { worker.postMessage("isready"); } catch { /* ignore */ }
        return;
      }
      if (line.includes("readyok")) gotReadyOk = true;
      if (gotUciOk && gotReadyOk) {
        cleanup();
        resolve({ worker, initMs: performance.now() - startedAt });
      }
    };

    const cleanup = () => {
      clearTimeout(tid);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("message", onMessage);
    };

    worker.addEventListener("error", onError);
    worker.addEventListener("message", onMessage);
    try { worker.postMessage("uci"); } catch { /* ignore */ }

    const tid = setTimeout(() => {
      cleanup();
      try { worker.terminate(); } catch { /* ignore */ }
      reject(new Error("Stockfish init timeout"));
    }, Math.max(500, timeoutMs));
  });
}

function sfHandleLine(lineRaw) {
  const line = String(lineRaw ?? "").trim();
  if (!line) return;

  if (line.startsWith("id name")) {
    sf.version = line.replace(/^id name\s+/i, "").trim();
    return;
  }

  if (line.startsWith("option name UCI_Elo")) {
    sf.supports.elo = true;
    const minMatch = line.match(/\bmin\s+(\d+)/i);
    const maxMatch = line.match(/\bmax\s+(\d+)/i);
    const min = minMatch ? Number(minMatch[1]) : null;
    const max = maxMatch ? Number(maxMatch[1]) : null;
    if (Number.isFinite(min) && Number.isFinite(max)) {
      sf.uciEloRange = { min, max };
    }
    return;
  }

  if (line.startsWith("option name UCI_LimitStrength")) {
    sf.supports.limitStrength = true;
    return;
  }

  if (line.startsWith("option name Skill Level")) {
    sf.supports.skill = true;
    return;
  }

  if (line.startsWith("option name MultiPV")) {
    sf.supports.multiPv = true;
    return;
  }

  if (line === "readyok") {
    const r = sf.pendingReadies.shift();
    if (r) {
      try { r(); } catch { /* ignore */ }
    }
    return;
  }

  if (line.startsWith("bestmove ")) {
    const parts = line.split(/\s+/);
    const bm = parts[1] || "(none)";
    if (sf.currentJob) {
      if (sf.currentJob.token !== aiRequestSeq) {
        sf.currentJob = null;
        return;
      }
      const { resolve } = sf.currentJob;
      sf.currentJob = null;
      resolve(bm === "(none)" ? null : bm);
    }
    return;
  }

  // Optional: capture MultiPV lines for coaching later
  // Example: "info depth 14 seldepth 22 multipv 2 score cp 23 pv e2e4 e7e5 ..."
  if (line.startsWith("info ") && line.includes(" multipv ") && line.includes(" pv ")) {
    const m = line.match(/\bmultipv\s+(\d+)\b/);
    const pvIdx = m ? Number(m[1]) : 0;
    const pvMatch = line.match(/\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)/i);
    if (pvIdx > 0 && pvMatch) {
      const scoreMate = line.match(/\bscore\s+mate\s+(-?\d+)/i);
      const scoreCp = line.match(/\bscore\s+cp\s+(-?\d+)/i);
      sf.lastMultiPv[pvIdx - 1] = {
        index: pvIdx,
        move: pvMatch[1],
        scoreMate: scoreMate ? Number(scoreMate[1]) : null,
        scoreCp: scoreCp ? Number(scoreCp[1]) : null,
      };
    }
  }
}

async function initStockfish({ timeoutMs = STOCKFISH_INIT_TIMEOUT_MS, force = false } = {}) {
  if (sf.ready && sf.worker) return true;
  if (sf.initPromise) return sf.initPromise;

  sf.initPromise = (async () => {
    sf.lastInitAttemptMs = Date.now();
    setEngineStatus("loading");
    const start = performance.now();
    try {
      const local = await createStockfishWorker(STOCKFISH_LOCAL_URL, { timeoutMs });
      sf.worker = local.worker;
      engineStatus.source = "local";
      console.info(`[Stockfish] Loaded local worker in ${local.initMs.toFixed(0)}ms (${STOCKFISH_LOCAL_URL})`);
    } catch (err) {
      const reason = classifyEngineError(err);
      console.warn(`[Stockfish] Local worker failed (${STOCKFISH_LOCAL_URL}): ${reason}`);
      throw new Error(reason);
    }

    sf.worker.onmessage = (ev) => sfHandleLine(ev?.data);
    sf.worker.onerror = (e) => sfTerminate({ reason: classifyEngineError(e?.message || e?.error || e) });

    // Now we can confidently call it ready (uci+ready handshake already completed).
    sf.ready = true;
    sfPost("uci");
    sfPost("isready");

    setEngineStatus("stockfish", { source: engineStatus.source });

    if (!sf.hasLoggedStartup) {
      sf.hasLoggedStartup = true;
      const tookMs = performance.now() - start;
      console.info(`[Stockfish] Ready in ${tookMs.toFixed(0)}ms${sf.version ? ` (${sf.version})` : ""}`);
    }
    return true;
  })().catch((e) => {
    const reason = classifyEngineError(e);
    sfTerminate({ reason });
    if (!sf.hasLoggedStartup) {
      sf.hasLoggedStartup = true;
      console.warn(`[Stockfish] Failed -> fallback (${reason})`);
    }
    throw e;
  });

  return sf.initPromise;
}

function sfIsReady({ timeoutMs = 1200 } = {}) {
  return new Promise((resolve, reject) => {
    if (!sf.worker) return reject(new Error("No Stockfish worker"));
    const done = () => resolve();
    sf.pendingReadies.push(done);
    sfPost("isready");
    setTimeout(() => {
      // Don't block forever; if we didn't get readyok, proceed (and allow fallback later).
      const idx = sf.pendingReadies.indexOf(done);
      if (idx >= 0) sf.pendingReadies.splice(idx, 1);
      resolve();
    }, Math.max(200, timeoutMs));
  });
}

function clampElo(elo) {
  if (!Number.isFinite(elo)) return null;
  if (sf.uciEloRange) {
    return Math.max(sf.uciEloRange.min, Math.min(sf.uciEloRange.max, elo));
  }
  return elo;
}

const MATE_SCORE_CP = 100000;

function scoreLineToCp(line) {
  if (!line) return null;
  if (Number.isFinite(line.scoreMate)) {
    const sign = Math.sign(line.scoreMate || 0) || 1;
    const distance = Math.min(99, Math.abs(line.scoreMate || 0));
    return sign * (MATE_SCORE_CP - distance * 1000);
  }
  if (Number.isFinite(line.scoreCp)) return line.scoreCp;
  return null;
}

function normalizeWeights(weights) {
  const sum = weights.reduce((acc, v) => acc + v, 0);
  if (!sum) return weights.map(() => 1 / weights.length);
  return weights.map((v) => v / sum);
}

function applyTacticalBias(weights, bias) {
  if (!bias || weights.length < 2) return weights;
  const normalized = normalizeWeights(weights);
  const maxShift = Math.max(0, normalized[0] - 0.05);
  const shift = Math.min(bias, maxShift);
  if (shift <= 0) return normalized;
  const tail = normalized.slice(1);
  const tailSum = tail.reduce((acc, v) => acc + v, 0) || 1;
  const adjusted = normalized.slice();
  adjusted[0] -= shift;
  for (let i = 1; i < adjusted.length; i += 1) {
    adjusted[i] += shift * (tail[i - 1] / tailSum);
  }
  return adjusted;
}

function weightedPick(options, weights) {
  if (options.length <= 1) return options[0];
  const normalized = normalizeWeights(weights.slice(0, options.length));
  const roll = Math.random();
  let acc = 0;
  for (let i = 0; i < options.length; i += 1) {
    acc += normalized[i] ?? 0;
    if (roll <= acc) return options[i];
  }
  return options[options.length - 1];
}

function pickHumanMoveFromLines(lines, preset) {
  if (!preset?.humanLike) return lines[0]?.move || null;
  if (!lines.length) return null;
  const scored = lines
    .map((line) => ({ ...line, scoreCp: scoreLineToCp(line) }))
    .filter((line) => line.move);
  if (!scored.length) return null;

  scored.sort((a, b) => (b.scoreCp ?? -Infinity) - (a.scoreCp ?? -Infinity));
  const bestScore = scored[0]?.scoreCp;
  let filtered = scored;
  if (Number.isFinite(bestScore) && Number.isFinite(preset.maxDropCp)) {
    filtered = scored.filter((line) => {
      if (!Number.isFinite(line.scoreCp)) return false;
      const drop = bestScore - line.scoreCp;
      return drop <= preset.maxDropCp;
    });
  }
  if (!filtered.length) filtered = scored;

  const tactical = Number.isFinite(bestScore) && Math.abs(bestScore) >= 200;
  const baseWeights = preset.humanWeights || [1];
  const candidates = filtered.slice(0, baseWeights.length);
  const weights = applyTacticalBias(baseWeights, tactical ? preset.tacticalBias : 0);
  const choice = weightedPick(candidates, weights);
  return choice?.move || scored[0]?.move || null;
}

async function sfBestMoveFromFEN(fen, preset, token) {
  if (token !== aiRequestSeq) return null;
  // Avoid hammering init attempts if the environment blocks workers/CDN.
  const now = Date.now();
  if (!sf.ready && (now - (sf.lastInitAttemptMs || 0)) < STOCKFISH_RETRY_COOLDOWN_MS) {
    setEngineStatus("fallback", { reason: sf.lastErrorReason || t("chess.engine.initCooldown") });
    return null;
  }

  const ok = await initStockfish({ timeoutMs: STOCKFISH_INIT_TIMEOUT_MS }).catch(() => false);
  if (!ok || !sf.worker || !sf.ready) {
    setEngineStatus("fallback", { reason: sf.lastErrorReason || t("chess.engine.unavailable") });
    return null;
  }

  // Only one outstanding search at a time
  if (sf.currentJob?.bestMovePending) return null;

  await sfIsReady().catch(() => {});

  sf.lastMultiPv = [];
  const requestedMultiPv = Math.max(1, Number(preset.multiPv) || 1);
  const multiPv = preset.humanLike && sf.supports.multiPv ? requestedMultiPv : 1;
  const elo = preset.limitStrength && preset.elo != null ? clampElo(Number(preset.elo)) : null;

  sfPost("ucinewgame");
  sfPost("setoption name Threads value 1");
  sfPost("setoption name Hash value 64");
  if (sf.supports.multiPv || multiPv > 1) sfPost(`setoption name MultiPV value ${multiPv}`);
  if (sf.supports.limitStrength || sf.supports.elo) {
    sfPost(`setoption name UCI_LimitStrength value ${preset.limitStrength ? "true" : "false"}`);
  }
  if (elo != null && (sf.supports.elo || sf.supports.limitStrength)) sfPost(`setoption name UCI_Elo value ${elo}`);
  if (sf.supports.skill) sfPost(`setoption name Skill Level value ${Number(preset.skill)}`);

  await sfIsReady().catch(() => {});

  sfPost(`position fen ${fen}`);

  const bestMovePromise = new Promise((resolve, reject) => {
    sf.currentJob = { resolve, reject, bestMovePending: true, token };
  });

  sfPost(`go movetime ${Number(preset.movetime)}`);

  // Safety timeout so we can fall back to heuristic.
  const bestMove = await Promise.race([
    bestMovePromise,
    sleep(Math.max(1500, Number(preset.movetime) + 1200)).then(() => null)
  ]).catch(() => null);

  // If we timed out, clear the pending job so future searches still work.
  if (bestMove == null && sf.currentJob?.bestMovePending) {
    sfStop();
    sf.currentJob = null;
  }

  if (bestMove == null) return null;
  const lines = sf.lastMultiPv.filter((entry) => entry?.move);
  const ordered = lines.sort((a, b) => a.index - b.index);
  const humanMove = pickHumanMoveFromLines(ordered, preset);
  return humanMove || bestMove;
}

// ---- FEN export from 0x88 board ----
function toFEN() {
  const rows = [];
  for (let rank = 0; rank < 8; rank++) {
    let empty = 0;
    let row = "";
    for (let file = 0; file < 8; file++) {
      const sq = sqOf(rank, file);
      const p = pieceAt(sq);
      if (!p) { empty++; continue; }
      if (empty) { row += String(empty); empty = 0; }
      const letter = p.t.toLowerCase();
      row += (p.c === WHITE) ? letter.toUpperCase() : letter;
    }
    if (empty) row += String(empty);
    rows.push(row);
  }

  const side = (game.turn === WHITE) ? "w" : "b";

  let castling = "";
  if (game.castling.wK) castling += "K";
  if (game.castling.wQ) castling += "Q";
  if (game.castling.bK) castling += "k";
  if (game.castling.bQ) castling += "q";
  if (!castling) castling = "-";

  const ep = (game.ep >= 0) ? algebraic(game.ep) : "-";
  const halfmove = "0";
  const fullmove = String(1 + Math.floor(game.plies / 2));

  return `${rows.join("/")} ${side} ${castling} ${ep} ${halfmove} ${fullmove}`;
}

function sqFromAlg(a) {
  if (!a || a.length !== 2) return -1;
  const file = "abcdefgh".indexOf(a[0]);
  const rankNum = parseInt(a[1], 10);
  if (file < 0 || rankNum < 1 || rankNum > 8) return -1;
  const rank = 8 - rankNum;
  return sqOf(rank, file);
}

function uciToLegalMove(uci, legalMoves) {
  if (!uci || uci.length < 4) return null;
  const from = sqFromAlg(uci.slice(0, 2));
  const to = sqFromAlg(uci.slice(2, 4));
  if (from < 0 || to < 0) return null;

  const candidates = legalMoves.filter(m => m.from === from && m.to === to);
  if (!candidates.length) return null;

  const promoChar = uci.length >= 5 ? String(uci[4]).toLowerCase() : "";
  const promoMap = { q:"Q", r:"R", b:"B", n:"N" };
  const promo = promoMap[promoChar] || null;

  if (promo) {
    const exact = candidates.find(m => m.promotion === promo);
    if (exact) return exact;
  }

  // If engine omitted promotion but the legal move requires one, default to Queen.
  const queen = candidates.find(m => m.promotion === "Q");
  if (queen) return queen;

  return candidates[0];
}

let aiRequestSeq = 0;
function cancelPendingAi({ stopEngine = true } = {}) {
  aiRequestSeq += 1;
  if (stopEngine) {
    sfStop();
    // Avoid getting stuck in a "busy" state if a bestmove never arrives.
    if (sf.currentJob?.bestMovePending) {
      try { sf.currentJob.reject(new Error("AI cancelled")); } catch { /* ignore */ }
      sf.currentJob = null;
    }
    sf.pendingReadies = [];
  }
  if (game) game.aiThinking = false;
}

function moveLeadsToCheckmate(move, colorToPlay) {
  const undo = applyMove(move, { recordUndo: false });
  const legal = genLegalMoves(opponent(colorToPlay));
  const isMate = legal.length === 0 && inCheck(opponent(colorToPlay));
  revertMove(undo);
  return isMate;
}

function allowsOpponentMateInOne(move, colorToPlay) {
  const undo = applyMove(move, { recordUndo: false });
  const opp = opponent(colorToPlay);
  const oppMoves = genLegalMoves(opp);
  let mateInOne = false;
  for (const oppMove of oppMoves) {
    if (moveLeadsToCheckmate(oppMove, opp)) {
      mateInOne = true;
      break;
    }
  }
  revertMove(undo);
  return mateInOne;
}

function pickHumanMoveFromScores(scored, preset) {
  if (!scored.length) return null;
  const ordered = scored.slice().sort((a, b) => b.score - a.score);
  if (!preset?.humanLike) return ordered[0].move;
  const bestScore = ordered[0].score;
  let filtered = ordered;
  const dropCap = Number.isFinite(preset.maxDropCp) ? (preset.maxDropCp / 10) : null;
  if (Number.isFinite(dropCap)) {
    filtered = ordered.filter((item) => (bestScore - item.score) <= dropCap);
  }
  if (!filtered.length) filtered = ordered;
  const tactical = Number.isFinite(bestScore) && Math.abs(bestScore) >= 30;
  const baseWeights = preset.humanWeights || [1];
  const candidates = filtered.slice(0, baseWeights.length);
  const weights = applyTacticalBias(baseWeights, tactical ? preset.tacticalBias : 0);
  const choice = weightedPick(candidates, weights);
  return choice?.move || ordered[0].move;
}

async function aiMoveIfNeeded() {
  if (game.gameOver) return;
  if (game.turn !== game.aiColor) return;

  const preset = getAiPreset();

  const legalMoves = genLegalMoves(game.turn);
  if (!legalMoves.length) {
    finalizeIfGameOver();
    render();
    return;
  }

  const mySeq = ++aiRequestSeq;
  const myGame = game;

  game.aiThinking = true;
  render();

  const started = performance.now();

  let chosenMove = null;

  // Try Stockfish first
  try {
    const fen = toFEN();
    const bestUci = await sfBestMoveFromFEN(fen, preset, mySeq);
    if (game !== myGame || mySeq !== aiRequestSeq) return;
    if (!game.gameOver && game.turn === game.aiColor && bestUci) {
      const mapped = uciToLegalMove(bestUci, legalMoves);
      if (mapped) chosenMove = mapped;
    }
  } catch {
    // fall back below
  }

  if (!chosenMove) {
    const mateMove = legalMoves.find((move) => moveLeadsToCheckmate(move, game.turn));
    if (mateMove) {
      chosenMove = mateMove;
    } else {
      const safeMoves = legalMoves.filter((move) => !allowsOpponentMateInOne(move, game.turn));
      const candidateMoves = safeMoves.length ? safeMoves : legalMoves;
      const scored = candidateMoves.map((move) => ({
        move,
        score: evaluateMove(move, preset, { deterministic: true }),
      }));
      chosenMove = pickHumanMoveFromScores(scored, preset);
    }
  }

  // Enforce minimum visual thinking time (always >= 2s).
  // For high levels (or user-selected Think time), allow longer delays.
  const minDelayMs = Math.max(2000, Number(preset.movetime) || 0);
  const elapsed = performance.now() - started;
  if (elapsed < minDelayMs) await sleep(minDelayMs - elapsed);

  if (game !== myGame || mySeq !== aiRequestSeq) return;

  game.aiThinking = false;
  if (game.gameOver) return;
  if (game.turn !== game.aiColor) return;

  applyMove(chosenMove, { recordUndo: true });
  clearSelection();

  finalizeIfGameOver();
  render();
  if (game.gameOver) onGameFinished();
}

// -------------------- selection helpers --------------------
function clearSelection() {
  game.selectedSq = -1;
  game.selectedMoves = [];
  game.hintMap = new Map();
  hintTextEl.textContent = "";
}

function selectSquare(sq) {
  game.selectedSq = sq;
  game.selectedMoves = legalMovesFromSquare(game.turn, sq);
  game.hintMap = new Map();

  for (const m of game.selectedMoves) {
    const undo = applyMove(m, { recordUndo: false });
    const givesCheck = inCheck(game.turn);
    revertMove(undo);
    game.hintMap.set(m.to, { type: m.capture ? "capture" : "move", givesCheck });
  }

  if (game.selectedMoves.length) {
    const moves = game.selectedMoves.map(m => algebraic(m.to)).slice(0, 10).join(", ");
    const suffix = game.selectedMoves.length > 10 ? "…" : "";
    hintTextEl.textContent = t("chess.hint.legalMoves", { moves: `${moves}${suffix}` });
  } else {
    hintTextEl.textContent = t("chess.hint.noLegalMoves");
  }
}

// -------------------- render --------------------
function statusText() {
  if (game.aiThinking) return t("chess.status.aiThinking");
  if (game.gameOver && game.result) {
    if (game.result.type === "checkmate") return t("chess.status.checkmate", { winner: sideLabel(game.result.winner) });
    if (game.result.type === "stalemate") return t("chess.status.stalemate");
    if (game.result.type === "resign") return t("chess.status.resign", { winner: sideLabel(game.result.winner) });
    if (game.result.type === "timeout") return t("chess.status.timeout", { winner: sideLabel(game.result.winner) });
  }
  return inCheck(game.turn) ? t("chess.status.check") : t("chess.status.playing");
}

function updateStatusUI() {
  if (!game) return;
  const isMate = game.gameOver && game.result?.type === "checkmate";
  const isStalemate = game.gameOver && game.result?.type === "stalemate";
  const isTimeout = game.gameOver && game.result?.type === "timeout";
  const isResigned = game.gameOver && game.result?.type === "resign";
  const checkedColor = inCheck(game.turn) ? game.turn : (isMate ? game.turn : null);

  game.checkHighlight = { color: checkedColor, isMate };

  if (!statusTagEl) return;
  let label = "Your move";
  let variant = "normal";
  if (isMate) {
    label = "CHECKMATE";
    variant = "mate";
  } else if (isStalemate) {
    label = "STALEMATE";
    variant = "draw";
  } else if (isTimeout) {
    label = "TIMEOUT";
    variant = "warn";
  } else if (isResigned) {
    label = "RESIGNED";
    variant = "warn";
  } else if (checkedColor) {
    label = "CHECK!";
    variant = "check";
  } else if (game.aiThinking || game.turn !== game.playerColor) {
    label = "AI thinking…";
    variant = "thinking";
  }

  statusTagEl.textContent = label;
  statusTagEl.className = `tag ${variant}`;
}

function applyPieceColorStyles(el, piece) {
  if (!piece) return;
  if (piece.c === WHITE) {
    el.style.color = "#ffffff";
    el.style.textShadow = "0 0 2px rgba(0,0,0,0.65), 0 2px 2px rgba(0,0,0,0.35)";
  } else {
    el.style.color = "#111111";
    el.style.textShadow = "0 0 2px rgba(255,255,255,0.85), 0 2px 2px rgba(0,0,0,0.35)";
  }
}

function isPromotionPieceLetter(x) {
  return x === "Q" || x === "R" || x === "B" || x === "N";
}

function closePromotionModal() {
  if (!promoModalEl) return;
  promoModalEl.classList.add("hidden");
  promoModalEl.setAttribute("aria-hidden", "true");
}

function cancelPendingPromotion() {
  pendingPromotion = null;
  closePromotionModal();
}

function openPromotionModal({ color } = {}) {
  if (!promoModalEl) return;
  const pieceColor = color || game?.turn || WHITE;

  if (promoTitleEl) promoTitleEl.textContent = t("chess.promo.title");

  for (const btn of promoBtns) {
    const promo = String(btn.dataset.promo || "").toUpperCase();
    btn.textContent = GLYPH[promo] || "";
    applyPieceColorStyles(btn, { c: pieceColor, t: promo });
  }

  promoModalEl.classList.remove("hidden");
  promoModalEl.setAttribute("aria-hidden", "false");
}

function render() {
  updateStatusUI();
  boardEl.innerHTML = "";
  boardEl.style.display = "flex";
  boardEl.style.flexWrap = "wrap";

  updateCoords();

  setText("status", statusText());
  setText("turn", sideLabel(game.turn));
  setText("moves", String(game.plies));
  setText("selected", game.selectedSq >= 0 ? algebraic(game.selectedSq) : t("common.dash"));

  renderPlayerClock();
  setCoachButtonState();

  for (let r=0; r<8; r++) {
    for (let c=0; c<8; c++) {
      const el = document.createElement("div");
      el.className = "square " + (((r+c)%2===0) ? "light" : "dark");

      const internalSq = displayToSq(r,c);
      const p = pieceAt(internalSq);

      el.textContent = p ? GLYPH[p.t] : "";
      if (p) applyPieceColorStyles(el, p);

      if (game.selectedSq === internalSq) el.classList.add("sel");

      const hint = game.hintMap.get(internalSq);
      if (hint?.type === "move") el.classList.add("hint-dot");
      if (hint?.type === "capture") el.classList.add("hint-ring");
      if (hint?.givesCheck) el.classList.add("hint-check");

      if (game.lastMove?.from === internalSq) el.classList.add("last-from");
      if (game.lastMove?.to === internalSq) el.classList.add("last-to");
      if (game.checkHighlight?.color && internalSq === game.kingSq[game.checkHighlight.color]) {
        el.classList.add("check-king");
        if (game.checkHighlight.isMate) el.classList.add("check-mate");
      }

      el.dataset.r = String(r);
      el.dataset.c = String(c);
      el.addEventListener("click", onSquareClick);

      boardEl.appendChild(el);
    }
  }
}

// -------------------- click logic --------------------
function onSquareClick(e) {
  if (game.gameOver) return;
  if (game.aiThinking) return;
  if (pendingPromotion) return;
  if (game.turn !== game.playerColor) return;

  const r = Number(e.currentTarget.dataset.r);
  const c = Number(e.currentTarget.dataset.c);
  const sq = displayToSq(r,c);

  const p = pieceAt(sq);

  if (game.selectedSq < 0) {
    if (!p || p.c !== game.turn) return;
    selectSquare(sq);
    render();
    return;
  }

  if (game.selectedSq === sq) {
    clearSelection();
    render();
    return;
  }

  if (p && p.c === game.turn) {
    selectSquare(sq);
    render();
    return;
  }

  const moveType = game.hintMap.get(sq);
  if (moveType) {
    const candidates = game.selectedMoves.filter(m => m.to === sq);
    if (!candidates.length) return;

    const hasPromotion = candidates.some(m => m.promotion);
    if (hasPromotion) {
      pendingPromotion = {
        id: ++promoSeq,
        gameId: game.id,
        from: game.selectedSq,
        to: sq,
        candidates,
        color: game.turn,
      };
      openPromotionModal({ color: game.turn });
      return;
    }

    const chosen = candidates[0];
    applyMove(chosen, { recordUndo: true });
    clearSelection();

    finalizeIfGameOver();
    render();

    if (game.gameOver) onGameFinished();
    else aiMoveIfNeeded();
    return;
  }

  clearSelection();
  render();
}

// -------------------- stats + event --------------------
function updateStatsAndSend(result) {
  state.stats.gamesPlayed += 1;
  if (result === "win") state.stats.gamesWon += 1;
  if (result === "loss") state.stats.gamesLost += 1;
  if (result === "draw") state.stats.gamesDraw += 1;
  state.stats.totalMoves += game.plies;

  touch(state);
  saveState(state);

  const preset = getAiPreset();
  const fullMoves = Math.ceil(game.plies / 2);
  sendEvent({
    type: "game_result",
    mode: engineStatus.mode === "stockfish" ? "vs_ai_stockfish" : "vs_ai_fallback",
    engine: engineStatus.mode,
    level: String(levelEl.value || preset.key),
    elo: preset.elo ?? null,
    side: game.playerColor === WHITE ? "white" : "black",
    result,
    moves: fullMoves,
    plies: game.plies,
  });
}

function onGameFinished() {
  if (!game.result) return;
  if (game.result.type === "stalemate") return updateStatsAndSend("draw");
  if (game.result.type === "checkmate") return updateStatsAndSend(game.result.winner === game.playerColor ? "win" : "loss");
  if (game.result.type === "timeout") return updateStatsAndSend("loss");
  if (game.result.type === "resign") return updateStatsAndSend("loss");
}

// -------------------- coach review --------------------
function setCoachButtonState() {
  if (!coachBtn) return;
  coachBtn.disabled = !game?.gameOver;
}

function openCoachModal() {
  if (!coachModalEl) return;
  coachModalEl.classList.remove("hidden");
  coachModalEl.setAttribute("aria-hidden", "false");
}

function closeCoachModal() {
  if (!coachModalEl) return;
  coachModalEl.classList.add("hidden");
  coachModalEl.setAttribute("aria-hidden", "true");
}

function resetCoachDisplay() {
  if (coachStatusEl) coachStatusEl.textContent = "";
  if (coachContentEl) coachContentEl.innerHTML = "";
  if (coachDisclaimerEl) coachDisclaimerEl.textContent = "";
  if (coachCopyBtn) coachCopyBtn.disabled = true;
  if (coachRetryBtn) coachRetryBtn.disabled = true;
}

function abortCoachRequest({ closeModal = false, bumpSeq = true } = {}) {
  if (coachAbort) {
    coachAbort.abort();
    coachAbort = null;
  }
  if (bumpSeq) coachRequestSeq += 1;
  coachData = null;
  if (closeModal) {
    closeCoachModal();
    resetCoachDisplay();
  }
}

function getGameResultInfo() {
  if (!game?.gameOver || !game.result) return null;
  let result = "1/2-1/2";
  if (game.result.winner === WHITE) result = "1-0";
  if (game.result.winner === BLACK) result = "0-1";
  const reason = ["checkmate", "stalemate", "timeout", "resign"].includes(game.result.type)
    ? game.result.type
    : "other";
  return { result, reason };
}

function getDifficultyLabel() {
  const option = levelEl?.options?.[levelEl.selectedIndex];
  return option?.textContent?.trim() || String(levelEl?.value || "intermediate");
}

function renderCoachResult(data) {
  if (!coachContentEl) return;
  coachContentEl.innerHTML = "";

  const sections = [];
  if (data.summary) sections.push(createCoachSection(t("chess.coach.summary"), data.summary));
  sections.push(
    createCoachSection(
      t("chess.coach.keyMoments"),
      Array.isArray(data.keyMoments) && data.keyMoments.length
        ? data.keyMoments.map(item =>
            `Move ${item.moveIndex}: ${item.title} — ${item.whatHappened} Better idea: ${item.betterIdea}`
          )
        : [t("chess.coach.noKeyMoments")]
    )
  );
  sections.push(
    createCoachSection(
      t("chess.coach.mistakes"),
      Array.isArray(data.mistakes) && data.mistakes.length
        ? data.mistakes.map(item =>
            `Move ${item.moveIndex} (${item.side}): ${item.mistake} Why: ${item.why} Better: ${item.better}`
          )
        : [t("chess.coach.noMistakes")]
    )
  );
  if (data.oneTip) sections.push(createCoachSection(t("chess.coach.oneTip"), data.oneTip));
  sections.push(
    createCoachSection(
      t("chess.coach.drills"),
      Array.isArray(data.suggestedDrills) && data.suggestedDrills.length
        ? data.suggestedDrills
        : [t("chess.coach.noDrills")]
    )
  );

  for (const section of sections) {
    coachContentEl.appendChild(section);
  }

  if (coachDisclaimerEl) coachDisclaimerEl.textContent = data.disclaimer || "";
}

function createCoachSection(title, content) {
  const section = document.createElement("div");
  section.className = "coachSection";
  const heading = document.createElement("h4");
  heading.textContent = title;
  section.appendChild(heading);

  if (Array.isArray(content)) {
    const list = document.createElement("ul");
    list.className = "coachList";
    content.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    });
    section.appendChild(list);
  } else {
    const body = document.createElement("p");
    body.textContent = content || t("common.dash");
    section.appendChild(body);
  }

  return section;
}

async function requestCoachReview() {
  if (!game?.gameOver) return;
  const resultInfo = getGameResultInfo();
  if (!resultInfo) return;

  abortCoachRequest({ bumpSeq: false });
  const mySeq = ++coachRequestSeq;
  coachAbort = new AbortController();

  openCoachModal();
  resetCoachDisplay();
  if (coachStatusEl) coachStatusEl.textContent = t("chess.coach.loading");
  if (coachRetryBtn) coachRetryBtn.disabled = true;

  const payload = {
    startFen,
    movesUci: gameMovesUci.slice(),
    finalFen: toFEN(),
    result: resultInfo.result,
    reason: resultInfo.reason,
    playerSide: game.playerColor,
    difficulty: getDifficultyLabel(),
    engine: engineStatus.mode === "stockfish" ? "stockfish" : "fallback",
  };

  try {
    const initData = getInitData();
    const headers = { "Content-Type": "application/json" };
    if (initData) headers["x-telegram-init-data"] = initData;
    const response = await fetch("/api/coachGameReview", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: coachAbort.signal,
    });

    if (mySeq !== coachRequestSeq) return;

    if (!response.ok) {
      const errorText = response.status === 429
        ? t("chess.coach.rateLimit")
        : t("chess.coach.failed");
      if (coachStatusEl) coachStatusEl.textContent = errorText;
      if (coachRetryBtn) coachRetryBtn.disabled = false;
      return;
    }

    const data = await response.json();
    if (mySeq !== coachRequestSeq) return;
    coachData = data;
    if (coachStatusEl) coachStatusEl.textContent = t("chess.coach.ready");
    renderCoachResult(data);
    if (coachCopyBtn) coachCopyBtn.disabled = false;
    if (coachRetryBtn) coachRetryBtn.disabled = false;
  } catch (error) {
    if (mySeq !== coachRequestSeq) return;
    if (error?.name === "AbortError") return;
    if (coachStatusEl) coachStatusEl.textContent = t("chess.coach.failed");
    if (coachRetryBtn) coachRetryBtn.disabled = false;
  }
}

// -------------------- controls --------------------
function resetGame({ fen } = {}) {
  cancelPendingAi({ stopEngine: true });
  cancelPendingPromotion();
  stopClock();
  abortCoachRequest({ closeModal: true });

  const playerColor = (sideEl.value === "black") ? BLACK : WHITE;
  if (fen) {
    const parsed = parseFen(fen);
    const seeded = initialGame(playerColor);
    seeded.board = parsed.board;
    seeded.turn = parsed.turn;
    seeded.castling = parsed.castling;
    seeded.ep = parsed.ep;
    seeded.plies = 0;
    seeded.kingSq = parsed.kingSq;
    game = seeded;
  } else {
    game = initialGame(playerColor);
  }
  startFen = toFEN();
  gameMovesUci = [];
  game.moveHistory = [];

  initClockFromUI();
  clearSelection();
  game.lastMove = null;
  renderMoveList();

  finalizeIfGameOver();
  render();
  aiMoveIfNeeded();
}

function newGame() {
  resetGame();
}

function undo() {
  if (!game.undoStack.length) return;
  cancelPendingAi({ stopEngine: true });
  cancelPendingPromotion();
  abortCoachRequest({ closeModal: true });

  // undo last move
  revertMove(game.undoStack.pop());
  popMoveUci();
  popMoveHistory();

  // if still not player's turn, undo one more (AI move)
  if (game.undoStack.length && game.turn !== game.playerColor) {
    revertMove(game.undoStack.pop());
    popMoveUci();
    popMoveHistory();
  }

  clearSelection();
  game.lastMove = null;

  finalizeIfGameOver();

  if (game.clock.enabled) startClockIfEnabled();
  else stopClock();

  render();
}

function hint() {
  if (game.gameOver) { hintTextEl.textContent = t("chess.hint.gameOver"); return; }
  if (game.aiThinking) { hintTextEl.textContent = t("chess.hint.aiThinking"); return; }
  if (game.turn !== game.playerColor) { hintTextEl.textContent = t("chess.hint.waitAi"); return; }

  const moves = genLegalMoves(game.turn);
  if (!moves.length) { hintTextEl.textContent = t("chess.hint.noMoves"); return; }

  const preset = getAiPreset();
  let best = moves[0], bestScore = -Infinity;
  for (const m of moves) {
    const s = evaluateMove(m, { ...preset, skill: Math.max(preset.skill, 12) }, { deterministic: true });
    if (s > bestScore) { bestScore = s; best = m; }
  }
  hintTextEl.textContent = t("chess.hint.bestMove", {
    move: `${algebraic(best.from)} → ${algebraic(best.to)}${best.promotion ? ` = ${best.promotion}` : ""}`,
  });
}

function resign() {
  if (game.gameOver) return;
  cancelPendingAi({ stopEngine: true });
  cancelPendingPromotion();
  const winner = opponent(game.playerColor);
  game.gameOver = true;
  game.result = { type: "resign", winner };
  stopClock();
  render();
  onGameFinished();
}

function onTimeControlUIChange() {
  customTimeWrap.style.display = (timeControlEl.value === "custom") ? "block" : "none";
  if (timeControlEl.value !== "custom" && timeControlEl.value !== "off") {
    timeMinutesEl.value = String(parseInt(timeControlEl.value, 10) || 20);
    timeSecondsEl.value = "0";
  }
}

const SETTINGS_COLLAPSED_KEY = "chess.settingsCollapsed";

function updateSettingsSummary() {
  if (!settingsSummaryEl) return;
  const side = sideEl?.options?.[sideEl.selectedIndex]?.textContent?.trim() || "White";
  const strength = levelEl?.options?.[levelEl.selectedIndex]?.textContent?.trim() || "Intermediate";
  const think = thinkTimeEl?.options?.[thinkTimeEl.selectedIndex]?.textContent?.trim() || "Auto";
  const humanLabel = humanLikeEl && !humanLikeEl.checked
    ? t("chess.settings.humanLikeSummaryOff")
    : t("chess.settings.humanLikeSummaryOn");
  settingsSummaryEl.textContent = `${side} • ${strength} • ${humanLabel} • ${think}`;
}

function setSettingsCollapsed(collapsed) {
  if (!settingsPanelEl || !settingsToggleEl) return;
  settingsPanelEl.classList.toggle("collapsed", collapsed);
  settingsToggleEl.setAttribute("aria-expanded", String(!collapsed));
  try {
    localStorage.setItem(SETTINGS_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // ignore storage issues
  }
}

function toggleSettingsPanel() {
  if (!settingsPanelEl) return;
  const collapsed = settingsPanelEl.classList.contains("collapsed");
  setSettingsCollapsed(!collapsed);
}

function logAiDiagnostics(reason = "") {
  const p = getAiPreset();
  console.info(
    `[AI] ${reason ? reason + " — " : ""}engine=${engineStatus.mode} level=${p.key} ` +
    `limitStrength=${Boolean(p.limitStrength)} elo=${p.elo ?? "-"} skill=${p.skill} ` +
    `movetime=${p.movetime}ms multipv=${p.multiPv} humanLike=${Boolean(p.humanLike)} ` +
    `drop=${p.maxDropCp ?? "-"} weights=${(p.humanWeights || []).join(",")} ` +
    `${p.thinkTimeOverrideMs != null ? " (override)" : ""}`
  );
}

function onAiSettingsChanged() {
  // If the user changes strength/speed mid-search, cancel so we never apply a move from old settings.
  cancelPendingAi({ stopEngine: true });
  if (!game) return;
  render();
  logAiDiagnostics("settings changed");
  aiMoveIfNeeded();
}

function retryEngineInit() {
  cancelPendingAi({ stopEngine: true });
  sfTerminate({ reason: "" });
  sf.lastInitAttemptMs = 0;
  setEngineStatus("loading");
  initStockfish({ timeoutMs: STOCKFISH_INIT_TIMEOUT_MS, force: true }).catch((err) => {
    const reason = classifyEngineError(err);
    setEngineStatus("fallback", { reason });
  });
}

function initFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const fen = params.get("fen");
  const devMode = params.get("dev") === "1" || ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (fen && devMode) {
    try {
      resetGame({ fen });
    } catch (error) {
      resetGame();
      if (hintTextEl) {
        hintTextEl.textContent = t("chess.hint.invalidFen");
      }
    }
    return;
  }
  resetGame();
}

// bind
newGameBtn.addEventListener("click", newGame);
resetBtn.addEventListener("click", newGame);
undoBtn.addEventListener("click", undo);
hintBtn.addEventListener("click", hint);
resignBtn.addEventListener("click", resign);
engineRetryEl?.addEventListener("click", retryEngineInit);
coachBtn?.addEventListener("click", requestCoachReview);
coachCloseBtn?.addEventListener("click", () => abortCoachRequest({ closeModal: true }));
coachRetryBtn?.addEventListener("click", requestCoachReview);
coachCopyBtn?.addEventListener("click", async () => {
  if (!coachData) return;
  const text = JSON.stringify(coachData, null, 2);
  try {
    await navigator.clipboard?.writeText(text);
    if (coachStatusEl) coachStatusEl.textContent = t("chess.coach.copied");
  } catch {
    if (coachStatusEl) coachStatusEl.textContent = t("chess.coach.copyFailed");
  }
});

coachModalEl?.addEventListener("click", (event) => {
  if (event.target?.matches?.(".modalBackdrop")) {
    abortCoachRequest({ closeModal: true });
  }
});

window.addEventListener("beforeunload", () => abortCoachRequest({ closeModal: true }));

for (const btn of promoBtns) {
  btn.addEventListener("click", () => {
    const promo = String(btn.dataset.promo || "").toUpperCase();
    if (!isPromotionPieceLetter(promo)) return;
    if (!pendingPromotion) return;
    if (!game || pendingPromotion.gameId !== game.id) return cancelPendingPromotion();
    if (game.gameOver) return cancelPendingPromotion();
    if (game.aiThinking) return cancelPendingPromotion();
    if (game.turn !== game.playerColor) return cancelPendingPromotion();

    const chosen = pendingPromotion.candidates.find(m => m.promotion === promo);
    cancelPendingPromotion();
    if (!chosen) return;

    applyMove(chosen, { recordUndo: true });
    clearSelection();

    finalizeIfGameOver();
    render();

    if (game.gameOver) onGameFinished();
    else aiMoveIfNeeded();
  });
}

sideEl.addEventListener("change", () => {
  updateSettingsSummary();
  newGame();
});
levelEl.addEventListener("change", () => {
  saveAiSettingsToStorage();
  updateSettingsSummary();
  onAiSettingsChanged();
});
humanLikeEl?.addEventListener("change", () => {
  saveAiSettingsToStorage();
  updateSettingsSummary();
  onAiSettingsChanged();
});
thinkTimeEl?.addEventListener("change", () => {
  updateSettingsSummary();
  onAiSettingsChanged();
});
timeControlEl.addEventListener("change", onTimeControlUIChange);
settingsToggleEl?.addEventListener("click", toggleSettingsPanel);

// init
updateEngineBadge();
loadAiSettingsFromStorage();
// Kick off engine init early so we don't silently fall back.
initStockfish({ timeoutMs: STOCKFISH_INIT_TIMEOUT_MS }).catch(() => {
  setEngineStatus("fallback", { reason: sf.lastErrorReason || t("chess.engine.unavailable") });
});

// Diagnostics helper (optional)
window.showAiDiagnostics = () => logAiDiagnostics("manual");
if (new URLSearchParams(window.location.search).get("dev") === "1"
  || ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
  window.setChessFen = (fen) => resetGame({ fen });
}

onTimeControlUIChange();
updateSettingsSummary();
setSettingsCollapsed(localStorage.getItem(SETTINGS_COLLAPSED_KEY) !== "0");
initFromQuery();
