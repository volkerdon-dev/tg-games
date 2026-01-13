import { initTelegram, sendEvent } from "../shared/telegram.js";
import { loadState, saveState, touch } from "../shared/storage.js";
import { setText } from "../shared/ui.js";

initTelegram();

const state = loadState();
touch(state);

// -------------------- UI refs --------------------
const boardEl = document.getElementById("board");
const sideEl = document.getElementById("side");
const levelEl = document.getElementById("level");
const thinkTimeEl = document.getElementById("thinkTime");
const engineBadgeEl = document.getElementById("engineBadge");

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

function opponent(color){ return color === WHITE ? BLACK : WHITE; }
function clonePiece(p){ return p ? { c: p.c, t: p.t } : null; }

// -------------------- engine state --------------------
let game = null;

// -------------------- Engine mode (visible) --------------------
let engineMode = "fallback"; // "stockfish" | "fallback"

function updateEngineBadge() {
  if (!engineBadgeEl) return;
  const isSf = engineMode === "stockfish";
  engineBadgeEl.classList.toggle("stockfish", isSf);
  engineBadgeEl.classList.toggle("fallback", !isSf);
  engineBadgeEl.textContent = isSf ? "Engine: Stockfish" : "Engine: Fallback";
}

// -------------------- AI presets (named) --------------------
const AI_PRESETS = {
  // Strength tiers MUST stay as keys:
  // beginner, easy, casual, club, strong, expert, master, im, gm, supergm
  //
  // Two axes:
  // - UCI_LimitStrength / UCI_Elo / Skill Level
  // - movetime (ms) (can be overridden by Think time control)
  //
  // NOTE: UI enforces a minimum 2s visual delay, so very low movetime still *looks* clear.
  beginner: { limitStrength:true,  elo:700,  skill:1,  movetime:150,   blunder:0.32 },
  easy:     { limitStrength:true,  elo:1000, skill:4,  movetime:250,   blunder:0.18 },
  casual:   { limitStrength:true,  elo:1350, skill:7,  movetime:450,   blunder:0.10 },
  club:     { limitStrength:true,  elo:1650, skill:10, movetime:800,   blunder:0.05 },
  strong:   { limitStrength:true,  elo:1950, skill:13, movetime:1200,  blunder:0.02 },
  expert:   { limitStrength:true,  elo:2250, skill:16, movetime:2200,  blunder:0.00 },
  master:   { limitStrength:true,  elo:2500, skill:17, movetime:4000,  blunder:0.00 },
  im:       { limitStrength:true,  elo:2700, skill:18, movetime:6500,  blunder:0.00 },
  gm:       { limitStrength:true,  elo:2900, skill:20, movetime:8500,  blunder:0.00 },
  // Brutal: no strength limit, long think time (10–15s).
  supergm:  { limitStrength:false, elo:null, skill:20, movetime:12000, blunder:0.00 }
};

function readThinkTimeOverrideMs() {
  const v = String(thinkTimeEl?.value ?? "auto").trim().toLowerCase();
  if (!v || v === "auto") return null;
  const seconds = Number(v);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round(seconds * 1000);
}

function getAiPreset() {
  const key = String(levelEl?.value || "casual").toLowerCase();
  const base = AI_PRESETS[key] ? { key, ...AI_PRESETS[key] } : { key: "casual", ...AI_PRESETS.casual };
  const override = readThinkTimeOverrideMs();
  const movetime = override != null ? override : base.movetime;
  return { ...base, movetime, thinkTimeOverrideMs: override };
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
    playerClockLabelEl.textContent = "No clock";
    playerClockEl.textContent = "—";
    return;
  }

  const sideName = game.playerColor === WHITE ? "White" : "Black";
  playerClockLabelEl.textContent = `Your time (${sideName})`;
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
  if (byColor === WHITE) {
    const a1 = targetSq + 17;
    const a2 = targetSq + 15;
    if (!isOffboard(a1)) { const p = pieceAt(a1); if (p && p.c===WHITE && p.t==="P") return true; }
    if (!isOffboard(a2)) { const p = pieceAt(a2); if (p && p.c===WHITE && p.t==="P") return true; }
  } else {
    const a1 = targetSq - 17;
    const a2 = targetSq - 15;
    if (!isOffboard(a1)) { const p = pieceAt(a1); if (p && p.c===BLACK && p.t==="P") return true; }
    if (!isOffboard(a2)) { const p = pieceAt(a2); if (p && p.c===BLACK && p.t==="P") return true; }
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

      for (const capDir of (color === WHITE ? [-17,-15] : [17,15])) {
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
  lastInitAttemptMs: 0,
  hasLoggedStartup: false,
};

const STOCKFISH_LOCAL_URL = "./engine/stockfish.worker.js";
const STOCKFISH_CDN_URL = "https://cdn.jsdelivr.net/npm/stockfish.wasm@0.10.0/stockfish.worker.js";
const STOCKFISH_INIT_TIMEOUT_MS = 2000;
const STOCKFISH_RETRY_COOLDOWN_MS = 5000;

function sfPost(cmd) {
  try { sf.worker?.postMessage(cmd); } catch { /* ignore */ }
}

function sfStop() {
  if (!sf.worker) return;
  sfPost("stop");
}

function sfTerminate() {
  try { sf.worker?.terminate(); } catch { /* ignore */ }
  sf.worker = null;
  sf.ready = false;
  sf.pendingReadies = [];
  if (sf.currentJob) {
    try { sf.currentJob.reject(new Error("Stockfish terminated")); } catch { /* ignore */ }
  }
  sf.currentJob = null;
  sf.initPromise = null;
  engineMode = "fallback";
  updateEngineBadge();
}

function createStockfishWorker(url, { timeoutMs = STOCKFISH_INIT_TIMEOUT_MS } = {}) {
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
      reject(e?.error || new Error("Stockfish worker error"));
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
        resolve(worker);
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
    if (pvIdx > 0) {
      sf.lastMultiPv[pvIdx - 1] = line;
    }
  }
}

async function initStockfish({ timeoutMs = STOCKFISH_INIT_TIMEOUT_MS } = {}) {
  if (sf.ready && sf.worker) return true;
  if (sf.initPromise) return sf.initPromise;

  sf.initPromise = (async () => {
    sf.lastInitAttemptMs = Date.now();
    try {
      sf.worker = await createStockfishWorker(STOCKFISH_LOCAL_URL, { timeoutMs });
    } catch {
      sf.worker = await createStockfishWorker(STOCKFISH_CDN_URL, { timeoutMs });
    }

    sf.worker.onmessage = (ev) => sfHandleLine(ev?.data);
    sf.worker.onerror = () => sfTerminate();

    // Now we can confidently call it ready (uci+ready handshake already completed).
    sf.ready = true;

    engineMode = "stockfish";
    updateEngineBadge();

    if (!sf.hasLoggedStartup) {
      sf.hasLoggedStartup = true;
      console.info("Stockfish ready");
    }
    return true;
  })().catch((e) => {
    sfTerminate();
    if (!sf.hasLoggedStartup) {
      sf.hasLoggedStartup = true;
      console.warn("Stockfish failed -> fallback");
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

async function sfBestMoveFromFEN(fen, preset) {
  // Avoid hammering init attempts if the environment blocks workers/CDN.
  const now = Date.now();
  if (!sf.ready && (now - (sf.lastInitAttemptMs || 0)) < STOCKFISH_RETRY_COOLDOWN_MS) {
    engineMode = "fallback";
    updateEngineBadge();
    return null;
  }

  const ok = await initStockfish({ timeoutMs: STOCKFISH_INIT_TIMEOUT_MS }).catch(() => false);
  if (!ok || !sf.worker || !sf.ready) {
    engineMode = "fallback";
    updateEngineBadge();
    return null;
  }

  // Only one outstanding search at a time
  if (sf.currentJob?.bestMovePending) return null;

  await sfIsReady().catch(() => {});

  sfPost("ucinewgame");
  sfPost("setoption name Threads value 1");
  sfPost("setoption name Hash value 64");
  sfPost("setoption name MultiPV value 3");
  sfPost(`setoption name Skill Level value ${Number(preset.skill)}`);
  sfPost(`setoption name UCI_LimitStrength value ${preset.limitStrength ? "true" : "false"}`);
  if (preset.limitStrength && preset.elo != null) sfPost(`setoption name UCI_Elo value ${Number(preset.elo)}`);

  await sfIsReady().catch(() => {});

  sfPost(`position fen ${fen}`);

  const bestMovePromise = new Promise((resolve, reject) => {
    sf.currentJob = { resolve, reject, bestMovePending: true };
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

  return bestMove;
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

function chooseHeuristicBestMove(legalMoves, preset) {
  let best = legalMoves[0];
  let bestScore = -Infinity;
  for (const m of legalMoves) {
    const s = evaluateMove(m, preset);
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}

function chooseBlunderMove(legalMoves, preset) {
  if (legalMoves.length <= 2) return legalMoves[Math.floor(Math.random() * legalMoves.length)];
  const scored = legalMoves.map(m => ({ m, s: evaluateMove(m, preset, { deterministic: true }) }));
  scored.sort((a, b) => a.s - b.s);
  const cutoff = Math.max(1, Math.ceil(scored.length / 3));
  const pool = scored.slice(0, cutoff).map(x => x.m);
  return pool[Math.floor(Math.random() * pool.length)];
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
    const bestUci = await sfBestMoveFromFEN(fen, preset);
    if (game !== myGame || mySeq !== aiRequestSeq) return;
    if (!game.gameOver && game.turn === game.aiColor && bestUci) {
      const mapped = uciToLegalMove(bestUci, legalMoves);
      if (mapped) chosenMove = mapped;
    }
  } catch {
    // fall back below
  }

  if (!chosenMove) {
    chosenMove = chooseHeuristicBestMove(legalMoves, preset);
  }

  // Weak-level blunders
  if (preset.blunder > 0 && Math.random() < preset.blunder) {
    chosenMove = chooseBlunderMove(legalMoves, preset);
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
    game.hintMap.set(m.to, m.capture ? "capture" : "move");
  }

  hintTextEl.textContent = game.selectedMoves.length
    ? `Legal moves: ${game.selectedMoves.map(m => algebraic(m.to)).slice(0,10).join(", ")}${game.selectedMoves.length>10?"…":""}`
    : "No legal moves for this piece.";
}

// -------------------- render --------------------
function statusText() {
  if (game.aiThinking) return "AI thinking…";
  if (game.gameOver && game.result) {
    if (game.result.type === "checkmate") return `CHECKMATE — ${game.result.winner === WHITE ? "White" : "Black"} wins`;
    if (game.result.type === "stalemate") return "STALEMATE — Draw";
    if (game.result.type === "resign") return `RESIGN — ${game.result.winner === WHITE ? "White" : "Black"} wins`;
    if (game.result.type === "timeout") return `TIMEOUT — ${game.result.winner === WHITE ? "White" : "Black"} wins`;
  }
  return inCheck(game.turn) ? "CHECK" : "Playing";
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

function render() {
  boardEl.innerHTML = "";
  boardEl.style.display = "flex";
  boardEl.style.flexWrap = "wrap";

  updateCoords();

  setText("status", statusText());
  setText("turn", game.turn === WHITE ? "White" : "Black");
  setText("moves", String(game.plies));
  setText("selected", game.selectedSq >= 0 ? algebraic(game.selectedSq) : "—");

  renderPlayerClock();

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
      if (hint === "move") el.classList.add("hint-move");
      if (hint === "capture") el.classList.add("hint-capture");

      if (game.lastMove?.from === internalSq) el.classList.add("last-from");
      if (game.lastMove?.to === internalSq) el.classList.add("last-to");

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
    let chosen = game.selectedMoves.find(m => m.to === sq);
    if (!chosen) return;

    if (chosen.promotion) {
      const q = game.selectedMoves.find(m => m.to === sq && m.promotion === "Q");
      if (q) chosen = q;
    }

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
  sendEvent({
    type: "game_result",
    mode: "vs_ai_stockfish",
    level: String(levelEl.value || preset.key),
    elo: preset.elo ?? null,
    side: game.playerColor === WHITE ? "white" : "black",
    result,
    plies: game.plies
  });
}

function onGameFinished() {
  if (!game.result) return;
  if (game.result.type === "stalemate") return updateStatsAndSend("draw");
  if (game.result.type === "checkmate") return updateStatsAndSend(game.result.winner === game.playerColor ? "win" : "loss");
  if (game.result.type === "timeout") return updateStatsAndSend("loss");
  if (game.result.type === "resign") return updateStatsAndSend("loss");
}

// -------------------- controls --------------------
function newGame() {
  cancelPendingAi({ stopEngine: true });
  stopClock();

  const playerColor = (sideEl.value === "black") ? BLACK : WHITE;
  game = initialGame(playerColor);

  initClockFromUI();
  clearSelection();
  game.lastMove = null;

  finalizeIfGameOver();
  render();
  aiMoveIfNeeded();
}

function undo() {
  if (!game.undoStack.length) return;
  cancelPendingAi({ stopEngine: true });

  // undo last move
  revertMove(game.undoStack.pop());

  // if still not player's turn, undo one more (AI move)
  if (game.undoStack.length && game.turn !== game.playerColor) {
    revertMove(game.undoStack.pop());
  }

  clearSelection();
  game.lastMove = null;

  finalizeIfGameOver();

  if (game.clock.enabled) startClockIfEnabled();
  else stopClock();

  render();
}

function hint() {
  if (game.gameOver) { hintTextEl.textContent = "Game over. Start a new game or undo."; return; }
  if (game.aiThinking) { hintTextEl.textContent = "AI thinking…"; return; }
  if (game.turn !== game.playerColor) { hintTextEl.textContent = "Wait for AI move…"; return; }

  const moves = genLegalMoves(game.turn);
  if (!moves.length) { hintTextEl.textContent = "No legal moves."; return; }

  const preset = getAiPreset();
  let best = moves[0], bestScore = -Infinity;
  for (const m of moves) {
    const s = evaluateMove(m, { ...preset, skill: Math.max(preset.skill, 12) }, { deterministic: true });
    if (s > bestScore) { bestScore = s; best = m; }
  }
  hintTextEl.textContent = `Hint: ${algebraic(best.from)} → ${algebraic(best.to)}${best.promotion ? ` = ${best.promotion}` : ""}`;
}

function resign() {
  if (game.gameOver) return;
  cancelPendingAi({ stopEngine: true });
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

function logAiDiagnostics(reason = "") {
  const p = getAiPreset();
  console.info(
    `[AI] ${reason ? reason + " — " : ""}engine=${engineMode} level=${p.key} ` +
    `limitStrength=${Boolean(p.limitStrength)} elo=${p.elo ?? "-"} skill=${p.skill} ` +
    `movetime=${p.movetime}ms${p.thinkTimeOverrideMs != null ? " (override)" : ""}`
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

// bind
newGameBtn.addEventListener("click", newGame);
resetBtn.addEventListener("click", newGame);
undoBtn.addEventListener("click", undo);
hintBtn.addEventListener("click", hint);
resignBtn.addEventListener("click", resign);

sideEl.addEventListener("change", () => newGame());
levelEl.addEventListener("change", onAiSettingsChanged);
thinkTimeEl?.addEventListener("change", onAiSettingsChanged);
timeControlEl.addEventListener("change", onTimeControlUIChange);

// init
updateEngineBadge();
// Kick off engine init early so we don't silently fall back.
initStockfish({ timeoutMs: STOCKFISH_INIT_TIMEOUT_MS }).catch(() => {
  engineMode = "fallback";
  updateEngineBadge();
});

// Diagnostics helper (optional)
window.showAiDiagnostics = () => logAiDiagnostics("manual");

onTimeControlUIChange();
newGame();
