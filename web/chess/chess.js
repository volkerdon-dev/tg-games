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

const statusEl = document.getElementById("status");
const turnEl = document.getElementById("turn");
const movesEl = document.getElementById("moves");
const selectedEl = document.getElementById("selected");
const hintTextEl = document.getElementById("hintText");

const newGameBtn = document.getElementById("newGame");
const resignBtn = document.getElementById("endGame");
const undoBtn = document.getElementById("undo");
const hintBtn = document.getElementById("hint");
const resetBtn = document.getElementById("reset");

// -------------------- pieces --------------------
// NOTE: bP changed to plain "♟" (без variation selector) — меньше проблем со “светлыми” пешками
const PIECES = {
  wK:"♔", wQ:"♕", wR:"♖", wB:"♗", wN:"♘", wP:"♙",
  bK:"♚", bQ:"♛", bR:"♜", bB:"♝", bN:"♞", bP:"♟"
};

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
const rankOf = (sq) => sq >> 4;      // 0..7 (0 = top)
const fileOf = (sq) => sq & 7;       // 0..7
const sqOf = (rank, file) => (rank << 4) | file;

const algebraic = (sq) => {
  const file = "abcdefgh"[fileOf(sq)];
  const rank = String(8 - rankOf(sq));
  return file + rank;
};

function opponent(color){ return color === WHITE ? BLACK : WHITE; }

// -------------------- engine state --------------------
let game = null;

function createEmptyBoard() {
  return new Array(128).fill(null);
}

function initialGame(playerColor) {
  const board = createEmptyBoard();
  const put = (r,f,c,t) => { board[sqOf(r,f)] = { c, t }; };

  // black pieces
  put(0,0,BLACK,"R"); put(0,1,BLACK,"N"); put(0,2,BLACK,"B"); put(0,3,BLACK,"Q");
  put(0,4,BLACK,"K"); put(0,5,BLACK,"B"); put(0,6,BLACK,"N"); put(0,7,BLACK,"R");
  for (let f=0; f<8; f++) put(1,f,BLACK,"P");

  // white pieces
  for (let f=0; f<8; f++) put(6,f,WHITE,"P");
  put(7,0,WHITE,"R"); put(7,1,WHITE,"N"); put(7,2,WHITE,"B"); put(7,3,WHITE,"Q");
  put(7,4,WHITE,"K"); put(7,5,WHITE,"B"); put(7,6,WHITE,"N"); put(7,7,WHITE,"R");

  const aiColor = opponent(playerColor);

  return {
    board,
    playerColor,
    aiColor,

    turn: WHITE,
    castling: { wK:true, wQ:true, bK:true, bQ:true },
    ep: -1,
    history: [],
    plies: 0,
    kingSq: { w: sqOf(7,4), b: sqOf(0,4) },

    gameOver: false,
    result: null,

    selectedSq: -1,
    legalTargets: new Set(),
    lastMove: null,

    aiThinking: false
  };
}

function cloneCastling(c) {
  return { wK: !!c.wK, wQ: !!c.wQ, bK: !!c.bK, bQ: !!c.bQ };
}

function snapshot() {
  const s = {
    board: game.board.slice(),
    turn: game.turn,
    castling: cloneCastling(game.castling),
    ep: game.ep,
    plies: game.plies,
    kingSq: { w: game.kingSq.w, b: game.kingSq.b },
    gameOver: game.gameOver,
    result: game.result ? { ...game.result } : null,
    lastMove: game.lastMove ? { ...game.lastMove } : null,
    // selection/history UI not needed
    aiThinking: game.aiThinking
  };
  game.history.push(s);
}

function restore() {
  const s = game.history.pop();
  if (!s) return;
  game.board = s.board.slice();
  game.turn = s.turn;
  game.castling = cloneCastling(s.castling);
  game.ep = s.ep;
  game.plies = s.plies;
  game.kingSq = { w: s.kingSq.w, b: s.kingSq.b };
  game.gameOver = s.gameOver;
  game.result = s.result ? { ...s.result } : null;
  game.lastMove = s.lastMove ? { ...s.lastMove } : null;
  game.aiThinking = s.aiThinking;

  game.selectedSq = -1;
  game.legalTargets = new Set();
}

function pieceAt(sq) { return game.board[sq]; }
function setPiece(sq, p) { game.board[sq] = p; }

// -------------------- attack / check logic --------------------
function isSquareAttacked(byColor, targetSq) {
  // Pawns
  if (byColor === WHITE) {
    const a1 = targetSq + 17;
    const a2 = targetSq + 15;
    if (!isOffboard(a1)) { const p = pieceAt(a1); if (p && p.c === WHITE && p.t === "P") return true; }
    if (!isOffboard(a2)) { const p = pieceAt(a2); if (p && p.c === WHITE && p.t === "P") return true; }
  } else {
    const a1 = targetSq - 17;
    const a2 = targetSq - 15;
    if (!isOffboard(a1)) { const p = pieceAt(a1); if (p && p.c === BLACK && p.t === "P") return true; }
    if (!isOffboard(a2)) { const p = pieceAt(a2); if (p && p.c === BLACK && p.t === "P") return true; }
  }

  // Knights
  for (const d of OFFSETS.N) {
    const sq = targetSq + d;
    if (isOffboard(sq)) continue;
    const p = pieceAt(sq);
    if (p && p.c === byColor && p.t === "N") return true;
  }

  // Bishops / Queens
  for (const d of OFFSETS.B) {
    let sq = targetSq + d;
    while (!isOffboard(sq)) {
      const p = pieceAt(sq);
      if (p) { if (p.c === byColor && (p.t === "B" || p.t === "Q")) return true; break; }
      sq += d;
    }
  }

  // Rooks / Queens
  for (const d of OFFSETS.R) {
    let sq = targetSq + d;
    while (!isOffboard(sq)) {
      const p = pieceAt(sq);
      if (p) { if (p.c === byColor && (p.t === "R" || p.t === "Q")) return true; break; }
      sq += d;
    }
  }

  // King
  for (const d of OFFSETS.K) {
    const sq = targetSq + d;
    if (isOffboard(sq)) continue;
    const p = pieceAt(sq);
    if (p && p.c === byColor && p.t === "K") return true;
  }

  return false;
}

function inCheck(color) {
  return isSquareAttacked(opponent(color), game.kingSq[color]);
}

// -------------------- move generation --------------------
function addMove(moves, move) {
  if (move.capture && move.capture.t === "K") return; // king never captured
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
          for (const promo of ["Q","R","B","N"]) addMove(moves, { from:sq, to:one, piece:p, capture:null, promotion:promo, flags:"p" });
        } else {
          addMove(moves, { from:sq, to:one, piece:p, capture:null, promotion:null, flags:"" });
        }

        const two = sq + dir*2;
        if (rankOf(sq) === startRank && !pieceAt(two) && !isOffboard(two)) {
          addMove(moves, { from:sq, to:two, piece:p, capture:null, promotion:null, flags:"2" });
        }
      }

      for (const capDir of (color === WHITE ? [-17,-15] : [17,15])) {
        const to = sq + capDir;
        if (isOffboard(to)) continue;

        if (to === game.ep) {
          addMove(moves, { from:sq, to, piece:p, capture:{ c: opponent(color), t:"P" }, promotion:null, flags:"e" });
          continue;
        }

        const target = pieceAt(to);
        if (target && target.c !== color) {
          if (rankOf(to) === promoteRank) {
            for (const promo of ["Q","R","B","N"]) addMove(moves, { from:sq, to, piece:p, capture:target, promotion:promo, flags:"cp" });
          } else {
            addMove(moves, { from:sq, to, piece:p, capture:target, promotion:null, flags:"c" });
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
        if (!target) addMove(moves, { from:sq, to, piece:p, capture:null, promotion:null, flags:"" });
        else if (target.c !== color) addMove(moves, { from:sq, to, piece:p, capture:target, promotion:null, flags:"c" });
      }
      continue;
    }

    if (p.t === "B" || p.t === "R" || p.t === "Q") {
      const dirs = (p.t === "B") ? OFFSETS.B : (p.t === "R" ? OFFSETS.R : OFFSETS.Q);
      for (const d of dirs) {
        let to = sq + d;
        while (!isOffboard(to)) {
          const target = pieceAt(to);
          if (!target) addMove(moves, { from:sq, to, piece:p, capture:null, promotion:null, flags:"" });
          else { if (target.c !== color) addMove(moves, { from:sq, to, piece:p, capture:target, promotion:null, flags:"c" }); break; }
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
        if (!target) addMove(moves, { from:sq, to, piece:p, capture:null, promotion:null, flags:"" });
        else if (target.c !== color) addMove(moves, { from:sq, to, piece:p, capture:target, promotion:null, flags:"c" });
      }

      // castling
      if (color === WHITE) {
        if (game.castling.wK) {
          const e1 = sqOf(7,4), f1 = sqOf(7,5), g1 = sqOf(7,6), h1 = sqOf(7,7);
          if (sq === e1 && pieceAt(h1)?.t === "R" && !pieceAt(f1) && !pieceAt(g1)) {
            if (!inCheck(WHITE) && !isSquareAttacked(BLACK, f1) && !isSquareAttacked(BLACK, g1)) {
              addMove(moves, { from:e1, to:g1, piece:p, capture:null, promotion:null, flags:"k" });
            }
          }
        }
        if (game.castling.wQ) {
          const e1 = sqOf(7,4), d1 = sqOf(7,3), c1 = sqOf(7,2), b1 = sqOf(7,1), a1 = sqOf(7,0);
          if (sq === e1 && pieceAt(a1)?.t === "R" && !pieceAt(d1) && !pieceAt(c1) && !pieceAt(b1)) {
            if (!inCheck(WHITE) && !isSquareAttacked(BLACK, d1) && !isSquareAttacked(BLACK, c1)) {
              addMove(moves, { from:e1, to:c1, piece:p, capture:null, promotion:null, flags:"q" });
            }
          }
        }
      } else {
        if (game.castling.bK) {
          const e8 = sqOf(0,4), f8 = sqOf(0,5), g8 = sqOf(0,6), h8 = sqOf(0,7);
          if (sq === e8 && pieceAt(h8)?.t === "R" && !pieceAt(f8) && !pieceAt(g8)) {
            if (!inCheck(BLACK) && !isSquareAttacked(WHITE, f8) && !isSquareAttacked(WHITE, g8)) {
              addMove(moves, { from:e8, to:g8, piece:p, capture:null, promotion:null, flags:"k" });
            }
          }
        }
        if (game.castling.bQ) {
          const e8 = sqOf(0,4), d8 = sqOf(0,3), c8 = sqOf(0,2), b8 = sqOf(0,1), a8 = sqOf(0,0);
          if (sq === e8 && pieceAt(a8)?.t === "R" && !pieceAt(d8) && !pieceAt(c8) && !pieceAt(b8)) {
            if (!inCheck(BLACK) && !isSquareAttacked(WHITE, d8) && !isSquareAttacked(WHITE, c8)) {
              addMove(moves, { from:e8, to:c8, piece:p, capture:null, promotion:null, flags:"q" });
            }
          }
        }
      }

      continue;
    }
  }

  return moves;
}

function makeMove(move, { simulate = false } = {}) {
  snapshot();

  const color = move.piece.c;
  const opp = opponent(color);

  game.ep = -1;

  const from = move.from;
  const to = move.to;

  if (move.piece.t === "K") {
    if (color === WHITE) { game.castling.wK = false; game.castling.wQ = false; }
    else { game.castling.bK = false; game.castling.bQ = false; }
  }

  if (move.piece.t === "R") {
    if (from === sqOf(7,7)) game.castling.wK = false;
    if (from === sqOf(7,0)) game.castling.wQ = false;
    if (from === sqOf(0,7)) game.castling.bK = false;
    if (from === sqOf(0,0)) game.castling.bQ = false;
  }

  if (move.capture && move.flags.includes("c")) {
    if (to === sqOf(7,7)) game.castling.wK = false;
    if (to === sqOf(7,0)) game.castling.wQ = false;
    if (to === sqOf(0,7)) game.castling.bK = false;
    if (to === sqOf(0,0)) game.castling.bQ = false;
  }

  if (move.flags.includes("e")) {
    if (color === WHITE) setPiece(to + 16, null);
    else setPiece(to - 16, null);
  }

  setPiece(from, null);

  let placed = move.piece;
  if (move.promotion) placed = { c: color, t: move.promotion };

  setPiece(to, placed);

  if (move.flags === "k" || move.flags === "q") {
    if (color === WHITE) {
      if (move.flags === "k") {
        const h1 = sqOf(7,7), f1 = sqOf(7,5);
        const rook = pieceAt(h1);
        setPiece(h1, null); setPiece(f1, rook);
      } else {
        const a1 = sqOf(7,0), d1 = sqOf(7,3);
        const rook = pieceAt(a1);
        setPiece(a1, null); setPiece(d1, rook);
      }
    } else {
      if (move.flags === "k") {
        const h8 = sqOf(0,7), f8 = sqOf(0,5);
        const rook = pieceAt(h8);
        setPiece(h8, null); setPiece(f8, rook);
      } else {
        const a8 = sqOf(0,0), d8 = sqOf(0,3);
        const rook = pieceAt(a8);
        setPiece(a8, null); setPiece(d8, rook);
      }
    }
  }

  if (placed.t === "K") game.kingSq[color] = to;

  if (move.piece.t === "P" && move.flags === "2") {
    game.ep = (color === WHITE) ? (from - 16) : (from + 16);
  }

  game.turn = opp;
  game.plies += 1;
  game.lastMove = { from, to };

  if (!simulate) finalizeIfGameOver();
}

function unmakeMove() {
  restore();
}

function genLegalMoves(color) {
  const pseudo = genPseudoMoves(color);
  const legal = [];

  for (const m of pseudo) {
    makeMove(m, { simulate: true });
    const mover = opponent(game.turn);
    const illegal = inCheck(mover);
    unmakeMove();
    if (!illegal) legal.push(m);
  }
  return legal;
}

function legalMovesFromSquare(color, fromSq) {
  const all = genLegalMoves(color);
  return all.filter(m => m.from === fromSq);
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
}

// -------------------- AI --------------------
function evaluateMove(move, level) {
  let score = 0;

  if (move.capture) score += VALUE[move.capture.t] * 10;
  if (move.promotion) score += 90;
  if (move.flags === "k" || move.flags === "q") score += 2;

  makeMove(move, { simulate: true });
  const givesCheck = inCheck(game.turn);
  unmakeMove();
  if (givesCheck) score += 6;

  const noiseFactor = (11 - level);
  score += Math.random() * noiseFactor * 3;

  return score;
}

function aiMoveIfNeeded() {
  if (game.gameOver) return;
  if (game.turn !== game.aiColor) return;

  const level = Number(levelEl.value) || 4;
  const moves = genLegalMoves(game.turn);

  if (moves.length === 0) {
    finalizeIfGameOver();
    render();
    return;
  }

  let best = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const s = evaluateMove(m, level);
    if (s > bestScore) { bestScore = s; best = m; }
  }

  game.aiThinking = true;
  render();

  setTimeout(() => {
    game.aiThinking = false;
    if (game.gameOver) return;
    if (game.turn !== game.aiColor) return;

    makeMove(best);
    clearSelection(); // важно: после хода ИИ сбрасываем выделение
    render();

    if (game.gameOver) onGameFinished();
  }, 200);
}

// -------------------- UI board mapping (orientation) --------------------
function orientation() {
  // Теперь ориентация фиксируется на цвете игрока, а не берётся из select каждый раз
  return game.playerColor === BLACK ? "black" : "white";
}

function displayToSq(r, c) {
  const ori = orientation();
  const rank = (ori === "white") ? r : (7 - r);
  const file = (ori === "white") ? c : (7 - c);
  return sqOf(rank, file);
}

// -------------------- rendering --------------------
function pieceKey(p) {
  if (!p) return "";
  return (p.c === WHITE ? "w" : "b") + p.t;
}

function statusText() {
  if (game.aiThinking) return "AI thinking…";

  if (game.gameOver && game.result) {
    if (game.result.type === "checkmate") return `CHECKMATE — ${game.result.winner === WHITE ? "White" : "Black"} wins`;
    if (game.result.type === "stalemate") return "STALEMATE — Draw";
    if (game.result.type === "resign") return `RESIGN — ${game.result.winner === WHITE ? "White" : "Black"} wins`;
  }

  return inCheck(game.turn) ? "CHECK" : "Playing";
}

function applyPieceColorStyles(squareEl, piece) {
  if (!piece) return;
  if (piece.c === WHITE) {
    squareEl.style.color = "rgba(234,240,255,0.95)";
    squareEl.style.textShadow = "0 1px 2px rgba(0,0,0,0.55)";
  } else {
    squareEl.style.color = "rgba(10,12,16,0.92)";
    squareEl.style.textShadow = "0 0 2px rgba(255,255,255,0.70), 0 2px 3px rgba(0,0,0,0.55)";
  }
}

function render() {
  boardEl.innerHTML = "";
  boardEl.style.display = "flex";
  boardEl.style.flexWrap = "wrap";

  setText("status", statusText());
  setText("turn", game.turn === WHITE ? "White" : "Black");
  setText("moves", String(game.plies));
  setText("selected", game.selectedSq >= 0 ? algebraic(game.selectedSq) : "—");

  for (let r=0; r<8; r++) {
    for (let c=0; c<8; c++) {
      const sq = document.createElement("div");
      sq.className = "square " + (((r+c)%2===0) ? "light" : "dark");

      const internalSq = displayToSq(r,c);
      const p = pieceAt(internalSq);
      sq.textContent = p ? PIECES[pieceKey(p)] : "";
      if (p) applyPieceColorStyles(sq, p);

      if (game.selectedSq === internalSq) sq.classList.add("sel");
      if (game.legalTargets.has(internalSq)) sq.classList.add("hint");

      sq.dataset.r = String(r);
      sq.dataset.c = String(c);
      sq.addEventListener("click", onSquareClick);

      boardEl.appendChild(sq);
    }
  }
}

function clearSelection() {
  game.selectedSq = -1;
  game.legalTargets = new Set();
  hintTextEl.textContent = "";
}

function onSquareClick(e) {
  if (game.gameOver) return;
  if (game.aiThinking) return; // пока бот ходит — не кликаем

  const r = Number(e.currentTarget.dataset.r);
  const c = Number(e.currentTarget.dataset.c);
  const sq = displayToSq(r,c);

  // КЛЮЧЕВОЙ ФИКС: используем game.playerColor, а не sideEl.value
  if (game.turn !== game.playerColor) return;

  const p = pieceAt(sq);

  if (game.selectedSq < 0) {
    if (!p || p.c !== game.turn) return;
    selectSquare(sq);
    return;
  }

  if (game.selectedSq === sq) {
    clearSelection();
    render();
    return;
  }

  if (p && p.c === game.turn) {
    selectSquare(sq);
    return;
  }

  if (game.legalTargets.has(sq)) {
    const moves = legalMovesFromSquare(game.turn, game.selectedSq);
    let chosen = moves.find(m => m.to === sq);
    if (!chosen) return;

    if (chosen.promotion) {
      const q = moves.find(m => m.to === sq && m.promotion === "Q");
      if (q) chosen = q;
    }

    makeMove(chosen);
    clearSelection();
    render();

    if (game.gameOver) onGameFinished();
    else aiMoveIfNeeded();

    return;
  }

  clearSelection();
  render();
}

function selectSquare(sq) {
  game.selectedSq = sq;
  game.legalTargets = new Set();

  const moves = legalMovesFromSquare(game.turn, sq);
  for (const m of moves) game.legalTargets.add(m.to);

  hintTextEl.textContent = moves.length
    ? `Legal moves: ${moves.map(m => algebraic(m.to)).slice(0,10).join(", ")}${moves.length>10?"…":""}`
    : "No legal moves for this piece.";

  render();
}

// -------------------- game results + stats --------------------
function updateStatsAndSend(result) {
  state.stats.gamesPlayed += 1;
  if (result === "win") state.stats.gamesWon += 1;
  if (result === "loss") state.stats.gamesLost += 1;
  if (result === "draw") state.stats.gamesDraw += 1;
  state.stats.totalMoves += game.plies;

  touch(state);
  saveState(state);

  sendEvent({
    type: "game_result",
    mode: "vs_ai_legal",
    level: Number(levelEl.value) || 4,
    side: game.playerColor === WHITE ? "white" : "black",
    result,
    plies: game.plies
  });
}

function onGameFinished() {
  if (!game.result) return;

  if (game.result.type === "stalemate") {
    updateStatsAndSend("draw");
    return;
  }

  if (game.result.type === "checkmate") {
    const winner = game.result.winner;
    updateStatsAndSend(winner === game.playerColor ? "win" : "loss");
    return;
  }

  if (game.result.type === "resign") {
    const winner = game.result.winner;
    updateStatsAndSend(winner === game.playerColor ? "win" : "loss");
  }
}

// -------------------- controls --------------------
function newGame() {
  const playerColor = (sideEl.value === "black") ? BLACK : WHITE;
  game = initialGame(playerColor);
  clearSelection();
  render();
  aiMoveIfNeeded(); // если игрок чёрный — белые (бот) стартуют
}

function resetPosition() {
  newGame();
}

function undo() {
  if (game.history.length === 0) return;

  if (game.gameOver) {
    game.gameOver = false;
    game.result = null;
  }

  // удобство vs AI: откатить до хода игрока
  restore();
  if (game.turn !== game.playerColor && game.history.length > 0) restore();

  clearSelection();
  render();
}

function hint() {
  if (game.gameOver) { hintTextEl.textContent = "Game over. Start a new game or undo."; return; }
  if (game.aiThinking) { hintTextEl.textContent = "AI thinking…"; return; }
  if (game.turn !== game.playerColor) { hintTextEl.textContent = "Wait for AI move…"; return; }

  const moves = genLegalMoves(game.turn);
  if (!moves.length) { hintTextEl.textContent = "No legal moves."; return; }

  const level = Math.max(6, Number(levelEl.value) || 6);
  let best = moves[0], bestScore = -Infinity;
  for (const m of moves) {
    const s = evaluateMove(m, level);
    if (s > bestScore) { bestScore = s; best = m; }
  }
  hintTextEl.textContent = `Hint: ${algebraic(best.from)} → ${algebraic(best.to)}${best.promotion ? ` = ${best.promotion}` : ""}`;
}

function resign() {
  if (game.gameOver) return;

  const winner = opponent(game.playerColor);
  game.gameOver = true;
  game.result = { type: "resign", winner };
  render();
  onGameFinished();
}

// -------------------- bind UI --------------------
newGameBtn.addEventListener("click", newGame);
resetBtn.addEventListener("click", resetPosition);
undoBtn.addEventListener("click", undo);
hintBtn.addEventListener("click", hint);
resignBtn.addEventListener("click", resign);

sideEl.addEventListener("change", () => newGame());

// init
newGame();
