import { initTelegram, sendEvent } from "../shared/telegram.js";
import { loadState, saveState, touch } from "../shared/storage.js";
import { setText } from "../shared/ui.js";
import { applyI18n, getLang, loadDict, t } from "../shared/i18n.js";

initTelegram();

const state = loadState();
touch(state);

const themeEl = document.getElementById("theme");
const nextBtn = document.getElementById("next");
const checkBtn = document.getElementById("check");
const answerEl = document.getElementById("answer");
const feedbackEl = document.getElementById("feedback");

let puzzles = [];
let current = null;

async function loadPuzzles() {
  const res = await fetch("../data/puzzles.json", { cache: "no-store" });
  return await res.json();
}

function getRequestedTheme() {
  const params = new URLSearchParams(window.location.search);
  const theme = params.get("theme");
  if (!theme) return null;
  const exists = Array.from(themeEl.options).some((option) => option.value === theme);
  return exists ? theme : null;
}

function pickPuzzle() {
  const theme = themeEl.value;
  const list = theme === "all" ? puzzles : puzzles.filter(p => p.theme === theme);
  if (!list.length) return null;

  // pick one not solved recently
  for (let i=0;i<12;i++){
    const p = list[Math.floor(Math.random()*list.length)];
    if (!state.puzzleHistory[p.id]) return p;
  }
  return list[Math.floor(Math.random()*list.length)];
}

function showPuzzle(p) {
  current = p;
  setText("puzzleId", p.id);
  setText("fen", p.fen);
  setText("expected", t("train.expectedHidden", { theme: p.theme }));
  feedbackEl.textContent = t("train.solvePrompt");
  answerEl.value = "";
  answerEl.focus();
}

function normalize(s) {
  return (s||"").trim().replace(/\s+/g,"");
}

function checkAnswer() {
  if (!current) return;
  const user = normalize(answerEl.value);
  const right = normalize(current.bestMove);

  const ok = user.toLowerCase() === right.toLowerCase();
  if (ok) {
    feedbackEl.textContent = t("train.correct");
    state.stats.puzzlesSolved += 1;
    state.puzzleHistory[current.id] = { ok: true, at: new Date().toISOString() };
    touch(state);
    saveState(state);

    sendEvent({ type: "puzzle_result", puzzleId: current.id, result: "solved", theme: current.theme });
  } else {
    feedbackEl.textContent = t("train.incorrect", { move: current.bestMove });
    state.stats.puzzlesFailed += 1;
    state.puzzleHistory[current.id] = { ok: false, at: new Date().toISOString() };
    touch(state);
    saveState(state);

    sendEvent({ type: "puzzle_result", puzzleId: current.id, result: "failed", theme: current.theme });
  }
}

async function init() {
  puzzles = await loadPuzzles();
  const requestedTheme = getRequestedTheme();
  if (requestedTheme) themeEl.value = requestedTheme;

  const p = pickPuzzle();
  if (!p) {
    feedbackEl.textContent = t("train.noPuzzles");
    return;
  }
  showPuzzle(p);
}

nextBtn.addEventListener("click", () => {
  const p = pickPuzzle();
  if (!p) {
    feedbackEl.textContent = t("train.noPuzzles");
    return;
  }
  showPuzzle(p);
});

checkBtn.addEventListener("click", checkAnswer);
answerEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") checkAnswer();
});

themeEl.addEventListener("change", () => {
  const p = pickPuzzle();
  if (!p) {
    feedbackEl.textContent = t("train.noPuzzles");
    return;
  }
  showPuzzle(p);
});

await loadDict(getLang());
await applyI18n();
init();
