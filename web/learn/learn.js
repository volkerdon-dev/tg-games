import { initTelegram, sendEvent } from "../shared/telegram.js";
import { loadState, saveState, touch } from "../shared/storage.js";
import { escapeHtml } from "../shared/ui.js";
import { applyI18n, getLang, loadDict, t } from "../shared/i18n.js";

initTelegram();

const state = loadState();
touch(state);

const LEARN_PROGRESS_KEY = "tg_learn_progress_v1";

const listEl = document.getElementById("lessonsList");
const lessonDetailEl = document.getElementById("lessonDetail");
const trackLessonCountEl = document.getElementById("trackLessonCount");
const trackEstimatedEl = document.getElementById("trackEstimated");
const trackProgressBarEl = document.getElementById("trackProgressBar");
const trackProgressTextEl = document.getElementById("trackProgressText");
const continueSubtitleEl = document.getElementById("continueSubtitle");
const nextLessonBtn = document.getElementById("nextLessonBtn");
const beginnerProgressBarEl = document.getElementById("beginnerProgressBar");
const beginnerTrackProgressEl = document.getElementById("beginnerTrackProgress");
const beginnerProgressTextEl = document.getElementById("beginnerProgressText");

const pageTrack = document.body?.dataset?.track || "Beginner";

function defaultLearnProgress() {
  return { completed: {}, lastLessonId: null };
}

function loadLearnProgress() {
  try {
    const raw = localStorage.getItem(LEARN_PROGRESS_KEY);
    if (!raw) return defaultLearnProgress();
    const parsed = JSON.parse(raw);
    return {
      completed: { ...(parsed.completed || {}) },
      lastLessonId: parsed.lastLessonId || null,
    };
  } catch {
    return defaultLearnProgress();
  }
}

function saveLearnProgress(progress) {
  localStorage.setItem(LEARN_PROGRESS_KEY, JSON.stringify(progress));
}

let learnProgress = loadLearnProgress();

async function loadLessons() {
  const lang = getLang();
  const candidates = [
    `../data/lessons.${lang}.json`,
    "../data/lessons.en.json",
    "../data/lessons.json",
  ];

  for (const path of candidates) {
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) continue;
      return await res.json();
    } catch {
      continue;
    }
  }

  return [];
}

function normalizeTrack(value) {
  return String(value || "").trim().toLowerCase();
}

function getTrackLessons(lessons, track) {
  const needle = normalizeTrack(track);
  return lessons.filter((lesson) => normalizeTrack(lesson.level) === needle);
}

function setLastLessonId(lessonId) {
  learnProgress.lastLessonId = lessonId;
  saveLearnProgress(learnProgress);
}

function markLessonCompleted(lessonId) {
  if (!learnProgress.completed[lessonId]) {
    learnProgress.completed[lessonId] = true;
    if (!state.completedLessons[lessonId]) {
      state.completedLessons[lessonId] = true;
      state.stats.lessonsCompleted += 1;
      touch(state);
      saveState(state);
    }
  }
  learnProgress.lastLessonId = lessonId;
  saveLearnProgress(learnProgress);
}

function getNextLesson(track, lessons) {
  const trackLessons = getTrackLessons(lessons, track);
  if (!trackLessons.length) return null;
  const next = trackLessons.find((lesson) => !learnProgress.completed[lesson.id]);
  return next || trackLessons[trackLessons.length - 1];
}

window.getNextLesson = getNextLesson;

function getProgressSummary(trackLessons) {
  const completedCount = trackLessons.filter((lesson) => learnProgress.completed[lesson.id]).length;
  return {
    completedCount,
    total: trackLessons.length,
    percent: trackLessons.length ? Math.round((completedCount / trackLessons.length) * 100) : 0,
  };
}

function buildTryItFen(tryIt) {
  const base = String(tryIt?.fen || "").trim();
  if (!base) return null;
  const parts = base.split(/\s+/);
  if (parts.length >= 2) return base;
  const side = tryIt?.sideToMove === "b" ? "b" : "w";
  return `${base} ${side} - - 0 1`;
}

function renderLessonDetail(lesson) {
  if (!lessonDetailEl) return;

  const badges = [];
  if (Number.isFinite(lesson.estimatedMinutes)) {
    badges.push(`<span class="badge badge-meta">⏱ ${lesson.estimatedMinutes} ${escapeHtml(t("common.minutes"))}</span>`);
  }
  if (Array.isArray(lesson.tags)) {
    lesson.tags.forEach((tag) => {
      badges.push(`<span class="badge badge-tag">#${escapeHtml(tag)}</span>`);
    });
  }

  const tryIt = lesson.tryIt || null;
  const tryItFen = buildTryItFen(tryIt);
  const tryItBlock = tryItFen
    ? `
      <div class="tryit-card">
        <div>
          <h4>${escapeHtml(t("learn.tryIt.title"))}</h4>
          <p>${escapeHtml(tryIt?.prompt || t("learn.tryIt.defaultPrompt"))}</p>
        </div>
        <a class="btn" href="../chess/index.html?fen=${encodeURIComponent(tryItFen)}&from=learn&lesson=${encodeURIComponent(lesson.id)}">${escapeHtml(t("learn.tryIt.openBoard"))}</a>
      </div>
    `
    : "";

  const primaryTag = Array.isArray(lesson.tags) ? lesson.tags[0] : "";
  const trainHref = primaryTag
    ? `../train/themes.html?theme=${encodeURIComponent(primaryTag)}`
    : "../train/themes.html";

  lessonDetailEl.innerHTML = `
    <div class="lesson-detail-header">
      <div>
        <h2>${escapeHtml(lesson.title)}</h2>
        <p class="small">${escapeHtml(lesson.description || "")}</p>
      </div>
    </div>
    ${badges.length ? `<div class="badge-group">${badges.join("")}</div>` : ""}
    <div class="lesson-content">
      ${(lesson.content || []).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
    </div>
    ${tryItBlock}
    <div class="cta-row">
      <a class="btn" href="${trainHref}">${escapeHtml(t("learn.cta.trainTheme"))}</a>
      <a class="btn secondary" href="../chess/index.html">${escapeHtml(t("learn.cta.practiceGame"))}</a>
    </div>
  `;

  lessonDetailEl.classList.remove("hidden");
  lessonDetailEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderLesson(lesson) {
  const done = !!learnProgress.completed[lesson.id];

  const el = document.createElement("div");
  el.className = "item";

  el.innerHTML = `
    <h3>${escapeHtml(lesson.title)}</h3>
    <p>${escapeHtml(lesson.description || "")}</p>
    <div class="badge">${escapeHtml(t("learn.lesson.level"))}: ${escapeHtml(lesson.level || t("learn.lesson.anyLevel"))}${done ? ` • ✅ ${escapeHtml(t("learn.lesson.completed"))}` : ""}</div>
    <div class="row" style="margin-top:10px">
      <button class="btn" data-action="open">${escapeHtml(t("learn.lesson.open"))}</button>
      <button class="btn secondary" data-action="complete">${escapeHtml(done ? t("learn.lesson.completed") : t("learn.lesson.markDone"))}</button>
    </div>
  `;

  el.querySelector('[data-action="open"]').addEventListener("click", () => {
    setLastLessonId(lesson.id);
    renderLessonDetail(lesson);
  });

  el.querySelector('[data-action="complete"]').addEventListener("click", () => {
    if (!learnProgress.completed[lesson.id]) {
      markLessonCompleted(lesson.id);
      sendEvent({ type: "lesson_complete", lessonId: lesson.id });
      refresh();
    } else {
      setLastLessonId(lesson.id);
    }
  });

  return el;
}

function updateTrackUI(track, lessons) {
  const trackLessons = getTrackLessons(lessons, track);
  const summary = getProgressSummary(trackLessons);

  if (trackLessonCountEl) trackLessonCountEl.textContent = String(summary.total);

  if (trackEstimatedEl) {
    const totalMinutes = trackLessons.reduce((acc, lesson) => acc + (Number.isFinite(lesson.estimatedMinutes) ? lesson.estimatedMinutes : 0), 0);
    trackEstimatedEl.textContent = totalMinutes ? String(totalMinutes) : t("common.dash");
  }

  if (trackProgressBarEl) {
    const span = trackProgressBarEl.querySelector("span");
    if (span) span.style.width = `${summary.percent}%`;
  }

  if (trackProgressTextEl) {
    trackProgressTextEl.textContent = t("learn.progressTrack", {
      completed: summary.completedCount,
      total: summary.total,
    });
  }
}

function updateHubUI(lessons) {
  const trackLessons = getTrackLessons(lessons, "Beginner");
  const summary = getProgressSummary(trackLessons);

  if (continueSubtitleEl) {
    continueSubtitleEl.textContent = t("learn.continueSubtitle", {
      track: t("learn.track.beginnerShort"),
      completed: summary.completedCount,
      total: summary.total,
    });
  }

  if (beginnerProgressBarEl) {
    const span = beginnerProgressBarEl.querySelector("span");
    if (span) span.style.width = `${summary.percent}%`;
  }

  if (beginnerTrackProgressEl) {
    beginnerTrackProgressEl.style.width = `${summary.percent}%`;
  }

  if (beginnerProgressTextEl) {
    beginnerProgressTextEl.textContent = t("learn.progressShort", {
      completed: summary.completedCount,
      total: summary.total,
    });
  }

  if (nextLessonBtn) {
    const nextLesson = getNextLesson("Beginner", lessons);
    if (nextLesson) {
      nextLessonBtn.textContent = t("learn.nextLessonWithTitle", { title: nextLesson.title });
      nextLessonBtn.href = `./beginner.html?lesson=${encodeURIComponent(nextLesson.id)}`;
      nextLessonBtn.removeAttribute("aria-disabled");
    } else {
      nextLessonBtn.textContent = t("learn.nextLesson");
      nextLessonBtn.href = "./beginner.html";
      nextLessonBtn.setAttribute("aria-disabled", "true");
    }
  }
}

async function refresh() {
  await loadDict(getLang());
  await applyI18n();
  const lessons = await loadLessons();

  updateHubUI(lessons);

  if (listEl) {
    const trackLessons = getTrackLessons(lessons, pageTrack);
    listEl.innerHTML = "";
    trackLessons.forEach((lesson) => listEl.appendChild(renderLesson(lesson)));
    updateTrackUI(pageTrack, lessons);

    const params = new URLSearchParams(window.location.search);
    const lessonId = params.get("lesson");
    if (lessonId) {
      const matched = trackLessons.find((lesson) => lesson.id === lessonId);
      if (matched) {
        setLastLessonId(matched.id);
        renderLessonDetail(matched);
      }
    }
  }
}

refresh();
