import { initTelegram, sendEvent } from "../shared/telegram.js";
import { loadState, saveState, touch } from "../shared/storage.js";
import { escapeHtml } from "../shared/ui.js";

initTelegram();

const state = loadState();
touch(state);

const listEl = document.getElementById("lessonsList");

async function loadLessons() {
  const res = await fetch("../data/lessons.json", { cache: "no-store" });
  return await res.json();
}

function renderLesson(lesson) {
  const done = !!state.completedLessons[lesson.id];

  const el = document.createElement("div");
  el.className = "item";

  el.innerHTML = `
    <h3>${escapeHtml(lesson.title)}</h3>
    <p>${escapeHtml(lesson.description || "")}</p>
    <div class="badge">Level: ${escapeHtml(lesson.level || "Any")} ${done ? " • ✅ Completed" : ""}</div>
    <div class="row" style="margin-top:10px">
      <button class="btn" data-action="open">Open</button>
      <button class="btn secondary" data-action="complete">${done ? "Completed" : "Mark as done"}</button>
    </div>
  `;

  el.querySelector('[data-action="open"]').addEventListener("click", () => {
    alert(lesson.content.join("\n\n"));
  });

  el.querySelector('[data-action="complete"]').addEventListener("click", () => {
    if (!state.completedLessons[lesson.id]) {
      state.completedLessons[lesson.id] = true;
      state.stats.lessonsCompleted += 1;
      touch(state);
      saveState(state);

      sendEvent({ type: "lesson_complete", lessonId: lesson.id });
      refresh();
    }
  });

  return el;
}

async function refresh() {
  listEl.innerHTML = "";
  const lessons = await loadLessons();
  lessons.forEach(ls => listEl.appendChild(renderLesson(ls)));
}

refresh();
