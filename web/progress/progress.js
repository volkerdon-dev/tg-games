import { initTelegram } from "../shared/telegram.js";
import { loadState, saveState, defaultState, touch } from "../shared/storage.js";
import { setText } from "../shared/ui.js";

initTelegram();

let state = loadState();
touch(state);

function render() {
  setText("streak", `${state.stats.streakDays} day(s)`);
  setText("gp", String(state.stats.gamesPlayed));
  setText("gw", String(state.stats.gamesWon));
  setText("gl", String(state.stats.gamesLost));
  setText("gd", String(state.stats.gamesDraw));
  setText("moves", String(state.stats.totalMoves));
  setText("lc", String(state.stats.lessonsCompleted));
  setText("ps", String(state.stats.puzzlesSolved));
  setText("pf", String(state.stats.puzzlesFailed));
}

document.getElementById("reset").addEventListener("click", () => {
  if (!confirm("Reset local progress?")) return;
  state = defaultState();
  saveState(state);
  render();
});

render();
