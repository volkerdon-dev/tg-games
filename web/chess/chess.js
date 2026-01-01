import { initTelegram, sendEvent } from "../shared/telegram.js";
import { loadState, saveState, touch } from "../shared/storage.js";
import { setText } from "../shared/ui.js";

initTelegram();

const state = loadState();
touch(state);

const boardEl = document.getElementById("board");
const sideEl = document.getElementById("side");
const levelEl = document.getElementById("level");

const turnEl = document.getElementById("turn");
const movesEl = document.getElementById("moves");
const selectedEl = document.getElementById("selected");
const hintTextEl = document.getElementById("hintText");

const newGameBtn = document.getElementById("newGame");
const endGameBtn = document.getElementById("endGame");
const undoBtn = document.getElementById("undo");
const hintBtn = document.getElementById("hint");
const resetBtn = document.getElementById("reset");

const PIECES = {
  wK:"♔", wQ:"♕", wR:"♖", wB:"♗", wN:"♘", wP:"♙",
  bK:"♚", bQ:"♛", bR:"♜", bB:"♝", bN:"♞", bP:"♟︎"
};

let game = null;

function initialPosition() {
  // 8x8 array, row 0 is rank 8
  return [
    ["bR","bN","bB","bQ","bK","bB","bN","bR"],
    ["bP","bP","bP","bP","bP","bP","bP","bP"],
    ["","","","","","","",""],
    ["","","","","","","",""],
    ["","","","","","","",""],
    ["","","","","","","",""],
    ["wP","wP","wP","wP","wP","wP","wP","wP"],
    ["wR","wN","wB","wQ","wK","wB","wN","wR"]
  ];
}

function createGame() {
  game = {
    pos: initialPosition(),
    turn: "w",
    moves: [],
    selected: null,
    history: []
  };
  hintTextEl.textContent = "";
  render();
}

function coordToSquare(r,c) {
  const file = "abcdefgh"[c];
  const rank = String(8 - r);
  return file + rank;
}

function getPiece(r,c){ return game.pos[r][c]; }

function setPiece(r,c,val){ game.pos[r][c] = val; }

function render() {
  boardEl.innerHTML = "";
  boardEl.style.display = "flex";
  boardEl.style.flexWrap = "wrap";

  setText("turn", game.turn === "w" ? "White" : "Black");
  setText("moves", String(game.moves.length));
  setText("selected", game.selected ? game.selected.square : "—");

  for (let r=0; r<8; r++){
    for (let c=0; c<8; c++){
      const sq = document.createElement("div");
      sq.className = "square " + (((r+c)%2===0) ? "light" : "dark");
      const piece = getPiece(r,c);
      sq.textContent = piece ? PIECES[piece] : "";

      const squareName = coordToSquare(r,c);
      sq.dataset.r = String(r);
      sq.dataset.c = String(c);
      sq.dataset.square = squareName;

      if (game.selected && game.selected.r===r && game.selected.c===c) {
        sq.classList.add("sel");
      }

      sq.addEventListener("click", onSquareClick);
      boardEl.appendChild(sq);
    }
  }
}

function onSquareClick(e) {
  const r = Number(e.currentTarget.dataset.r);
  const c = Number(e.currentTarget.dataset.c);
  const square = e.currentTarget.dataset.square;
  const piece = getPiece(r,c);

  // If nothing selected yet: select only if piece exists and matches turn color
  if (!game.selected) {
    if (!piece) return;
    const color = piece.startsWith("w") ? "w" : "b";
    if (color !== game.turn) return;

    game.selected = { r,c, square, piece };
    render();
    return;
  }

  // If clicking same square -> deselect
  if (game.selected.r === r && game.selected.c === c) {
    game.selected = null;
    render();
    return;
  }

  // Move: MVP (no strict legality). Prevent capturing own piece.
  const from = game.selected;
  const toPiece = piece;
  if (toPiece) {
    const toColor = toPiece.startsWith("w") ? "w" : "b";
    if (toColor === (from.piece.startsWith("w") ? "w" : "b")) {
      // selecting another own piece
      game.selected = { r,c, square, piece: toPiece };
      render();
      return;
    }
  }

  // Save snapshot for undo
  game.history.push(JSON.stringify(game.pos));

  setPiece(from.r, from.c, "");
  setPiece(r, c, from.piece);

  game.moves.push({
    from: from.square,
    to: square,
    captured: toPiece || null
  });

  game.selected = null;
  // switch turn
  game.turn = game.turn === "w" ? "b" : "w";
  hintTextEl.textContent = "";
  render();

  // "AI move" placeholder (random-ish): if turn is not user's chosen side, auto-move one pawn forward if possible
  autoAIMoveIfNeeded();
}

function autoAIMoveIfNeeded() {
  const userSide = sideEl.value === "white" ? "w" : "b";
  if (game.turn === userSide) return; // user's turn

  // very dumb AI: try move a pawn 1 step forward if empty
  const aiColor = game.turn;
  const dir = aiColor === "w" ? -1 : 1;

  for (let tries=0; tries<64; tries++){
    const r = Math.floor(Math.random()*8);
    const c = Math.floor(Math.random()*8);
    const p = getPiece(r,c);
    if (!p) continue;
    if ((aiColor==="w" && !p.startsWith("w")) || (aiColor==="b" && !p.startsWith("b"))) continue;
    if (!p.endsWith("P")) continue;

    const nr = r + dir;
    if (nr<0 || nr>7) continue;
    if (getPiece(nr,c) !== "") continue;

    game.history.push(JSON.stringify(game.pos));
    setPiece(nr,c,p);
    setPiece(r,c,"");
    game.moves.push({ from: coordToSquare(r,c), to: coordToSquare(nr,c), captured: null });
    game.turn = game.turn === "w" ? "b" : "w";
    render();
    return;
  }

  // if cannot move, just pass (MVP)
  game.turn = game.turn === "w" ? "b" : "w";
  render();
}

function undo() {
  const prev = game.history.pop();
  if (!prev) return;
  game.pos = JSON.parse(prev);
  game.moves.pop();
  game.turn = game.turn === "w" ? "b" : "w";
  game.selected = null;
  hintTextEl.textContent = "";
  render();
}

function hint() {
  hintTextEl.textContent = "Hint (MVP): focus on hanging pieces and checks. Stockfish hints coming next.";
}

function resetPosition() {
  game.pos = initialPosition();
  game.turn = "w";
  game.moves = [];
  game.history = [];
  game.selected = null;
  hintTextEl.textContent = "";
  render();
}

function endAndSave() {
  const level = Number(levelEl.value);
  const result = prompt("Result? type: win / loss / draw", "win");
  const normalized = (result || "").toLowerCase();
  const finalResult = ["win","loss","draw"].includes(normalized) ? normalized : "draw";

  // Update local stats
  state.stats.gamesPlayed += 1;
  if (finalResult === "win") state.stats.gamesWon += 1;
  if (finalResult === "loss") state.stats.gamesLost += 1;
  if (finalResult === "draw") state.stats.gamesDraw += 1;
  state.stats.totalMoves += game.moves.length;

  touch(state);
  saveState(state);

  // Send to Telegram bot
  sendEvent({
    type: "game_result",
    mode: "vs_ai_mvp",
    level,
    side: sideEl.value,
    result: finalResult,
    moves: game.moves.length
  });

  alert("Saved ✅");
}

newGameBtn.addEventListener("click", createGame);
undoBtn.addEventListener("click", undo);
hintBtn.addEventListener("click", hint);
resetBtn.addEventListener("click", resetPosition);
endGameBtn.addEventListener("click", endAndSave);

// init
createGame();
