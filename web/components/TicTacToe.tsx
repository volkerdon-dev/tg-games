import React, { useMemo, useState, useEffect } from "react";

const LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6],
];

function checkWinner(board: (string|null)[]) {
  for (const [a,b,c] of LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
}
const emptyMoves = (board: (string|null)[]) => board.map((v,i)=>v?null:i).filter(v=>v!==null) as number[];
const isDraw = (board: (string|null)[]) => !checkWinner(board) && emptyMoves(board).length === 0;

function minimax(board: (string|null)[], player: string, ai: string, human: string, alpha: number, beta: number) {
  const winner = checkWinner(board);
  if (winner === ai)   return { score: 10 };
  if (winner === human) return { score: -10 };
  if (isDraw(board))    return { score: 0 };

  const maximizing = (player === ai);
  let best = { score: maximizing ? -Infinity : Infinity, idx: -1 };

  for (const idx of emptyMoves(board)) {
    const copy = board.slice();
    copy[idx] = player;
    const next = minimax(copy, player === ai ? human : ai, ai, human, alpha, beta);
    if (maximizing) {
      if (next.score > best.score) best = { score: next.score, idx };
      alpha = Math.max(alpha, next.score);
    } else {
      if (next.score < best.score) best = { score: next.score, idx };
      beta = Math.min(beta, next.score);
    }
    if (beta <= alpha) break;
  }
  return best;
}

function bestMove(board: (string|null)[], ai: string, human: string) {
  const winner = checkWinner(board);
  if (winner === ai)   return { score: 10, idx: -1 };
  if (winner === human) return { score: -10, idx: -1 };
  if (isDraw(board))    return { score: 0, idx: -1 };

  let best = { idx: emptyMoves(board)[0]!, score: -Infinity };
  for (const idx of emptyMoves(board)) {
    const copy = board.slice();
    copy[idx] = ai;
    const result = minimax(copy, human, ai, human, -Infinity, Infinity);
    if (result.score > best.score) best = { idx, score: result.score };
  }
  return best;
}

export default function TicTacToe() {
  const [board, setBoard] = useState<(string|null)[]>(Array(9).fill(null));
  const [player, setPlayer] = useState<string|null>(null);
  const [ai, setAi] = useState<string|null>(null);
  const [turn, setTurn] = useState<"X"|"O">("X");

  const winner = useMemo(()=>checkWinner(board), [board]);
  const draw = useMemo(()=>isDraw(board), [board]);
  const gameOver = !!winner || draw;

  function handleChoose(mark: "X"|"O") {
    setPlayer(mark);
    setAi(mark === "X" ? "O" : "X");
    setBoard(Array(9).fill(null));
    setTurn("X");
  }

  function handleCellClick(i: number) {
    if (!player || gameOver) return;
    if (turn !== player) return;
    if (board[i]) return;
    const next = board.slice();
    next[i] = player;
    setBoard(next);
    setTurn(ai as "X"|"O");
  }

  useEffect(() => {
    if (!player || !ai || gameOver) return;
    if (turn !== ai) return;

    const t = setTimeout(() => {
      const { idx } = bestMove(board, ai, player);
      if (idx !== undefined && idx !== null && idx >= 0) {
        const next = board.slice();
        next[idx] = ai;
        setBoard(next);
        setTurn(player as "X"|"O");
      }
    }, 150);
    return () => clearTimeout(t);
  }, [turn, ai, player, board, gameOver]);

  function reset() {
    setBoard(Array(9).fill(null));
    setTurn("X");
  }

  return (
    <div className="mx-auto max-w-md p-4">
      <h1 className="text-3xl font-bold flex items-center gap-2">
        <span className="text-red-500">✖</span> Tic-Tac-Toe
      </h1>

      <div className="mt-3 flex items-center gap-3">
        {player ? (
          <>
            <span className="text-lg">Ход: <b>{turn}</b></span>
            <button onClick={reset} className="px-3 py-1 rounded-xl bg-gray-200 hover:bg-gray-300">
              Сброс
            </button>
          </>
        ) : (
          <span className="text-lg text-gray-600">Выбери, кем играть:</span>
        )}
      </div>

      {!player && (
        <div className="mt-3 flex gap-2">
          <button onClick={() => handleChoose("X")} className="px-4 py-2 rounded-2xl bg-gray-900 text-gray-100 hover:opacity-90">
            Play as X
          </button>
          <button onClick={() => handleChoose("O")} className="px-4 py-2 rounded-2xl bg-gray-900 text-gray-100 hover:opacity-90">
            Play as O
          </button>
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-3" style={{ touchAction: "manipulation" }}>
        {board.map((cell, i) => (
          <button
            key={i}
            onClick={() => handleCellClick(i)}
            className="h-28 rounded-2xl shadow bg-gray-900/95 flex items-center justify-center active:scale-[0.98] transition"
            disabled={!player || gameOver || turn !== player || !!cell}
            aria-label={`cell ${i}`}
          >
            <span className={`text-5xl font-extrabold tracking-tight select-none ${cell ? "opacity-100" : "opacity-0"} ${cell === "X" ? "text-white" : "text-gray-100"}`}>
              {cell ?? "•"}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 text-xl min-h-7">
        {winner && <span>Победитель: <b>{winner}</b></span>}
        {!winner && draw && <span>Ничья</span>}
      </div>
    </div>
  );
}
