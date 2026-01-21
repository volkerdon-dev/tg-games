import { initTelegram } from "../shared/telegram.js";
import { loadState, saveState, defaultState, touch } from "../shared/storage.js";
import { setText } from "../shared/ui.js";
import { applyI18n, getLang, loadDict, t } from "../shared/i18n.js";

initTelegram();

let state = loadState();
touch(state);

function render() {
  setText("streak", t("progress.streakValue", { count: state.stats.streakDays }));
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
  if (!confirm(t("progress.resetConfirm"))) return;
  state = defaultState();
  saveState(state);
  render();
});

await loadDict(getLang());
await applyI18n();
render();
