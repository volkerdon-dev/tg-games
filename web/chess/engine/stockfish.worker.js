/*
  Lightweight local UCI worker.
  This keeps the engine on the same origin for Telegram WebView while
  allowing the main thread to fall back to the heuristic AI when needed.
*/
let lastFen = "";
let lastMoves = "";

function respond(line) {
  self.postMessage(line);
}

function handleCommand(cmd) {
  if (!cmd) return;
  if (cmd === "uci") {
    respond("id name Stockfish Local");
    respond("id author tg-games");
    respond("uciok");
    return;
  }
  if (cmd === "isready") {
    respond("readyok");
    return;
  }
  if (cmd.startsWith("position")) {
    lastFen = cmd;
    const movesIdx = cmd.indexOf(" moves ");
    lastMoves = movesIdx >= 0 ? cmd.slice(movesIdx + 7) : "";
    return;
  }
  if (cmd.startsWith("go")) {
    // We don't calculate real moves in the worker; answer quickly and let
    // the main thread fallback heuristic choose if needed.
    setTimeout(() => respond("bestmove 0000"), 20);
    return;
  }
  if (cmd === "ucinewgame") {
    lastFen = "";
    lastMoves = "";
    return;
  }
  if (cmd === "quit") {
    self.close();
  }
}

self.onmessage = (ev) => {
  const cmd = String(ev?.data ?? "").trim();
  handleCommand(cmd);
};
