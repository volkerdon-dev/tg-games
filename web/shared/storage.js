import { getInitData } from "./telegram.js";

const KEY = "tg_chess_v1";
const PROGRESS_API_PATH = "/api/progress";
const FETCH_TIMEOUT_MS = 5000;
const NUMERIC_STAT_KEYS = [
  "gamesPlayed",
  "gamesWon",
  "gamesLost",
  "gamesDraw",
  "totalMoves",
  "adaptiveWinStreak",
  "adaptiveLossStreak",
  "learningGamesPlayed",
  "hintsUsed",
  "blundersAvoided",
  "lessonsCompleted",
  "puzzlesSolved",
  "puzzlesFailed",
  "streakDays",
];

function nowISO() {
  return new Date().toISOString();
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toSafeNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  if (num < 0) return 0;
  return num;
}

function parseDateMs(value) {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function pickEarliestIso(a, b) {
  const aMs = parseDateMs(a);
  const bMs = parseDateMs(b);
  if (aMs === null && bMs === null) return undefined;
  if (aMs === null) return b;
  if (bMs === null) return a;
  return bMs >= aMs ? a : b;
}

function pickLatestIso(a, b) {
  const aMs = parseDateMs(a);
  const bMs = parseDateMs(b);
  if (aMs === null && bMs === null) return undefined;
  if (aMs === null) return b;
  if (bMs === null) return a;
  return bMs >= aMs ? b : a;
}

function mergeStats(localStats, serverStats) {
  const local = isPlainObject(localStats) ? localStats : {};
  const server = isPlainObject(serverStats) ? serverStats : {};
  const merged = {};

  NUMERIC_STAT_KEYS.forEach((key) => {
    merged[key] = Math.max(toSafeNumber(local[key]), toSafeNumber(server[key]));
  });

  if (typeof server.lastStreakDate === "string" || server.lastStreakDate === null) {
    merged.lastStreakDate = server.lastStreakDate;
  } else if (typeof local.lastStreakDate === "string" || local.lastStreakDate === null) {
    merged.lastStreakDate = local.lastStreakDate;
  } else {
    merged.lastStreakDate = null;
  }

  return merged;
}

function mergeRecordMaps(localMap, serverMap) {
  const local = isPlainObject(localMap) ? localMap : {};
  const server = isPlainObject(serverMap) ? serverMap : {};
  return { ...local, ...server };
}

function mergeStateWithServer(localState, serverState) {
  const base = defaultState();
  const local = isPlainObject(localState) ? localState : {};
  const server = isPlainObject(serverState) ? serverState : {};

  const merged = {
    ...base,
    ...local,
    ...server,
    stats: mergeStats(local.stats, server.stats),
    completedLessons: mergeRecordMaps(local.completedLessons, server.completedLessons),
    puzzleHistory: mergeRecordMaps(local.puzzleHistory, server.puzzleHistory),
  };

  const createdAt = pickEarliestIso(local.createdAt, server.createdAt);
  if (typeof createdAt === "string") merged.createdAt = createdAt;

  const lastActiveAt = pickLatestIso(local.lastActiveAt, server.lastActiveAt);
  if (typeof lastActiveAt === "string") merged.lastActiveAt = lastActiveAt;

  return merged;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const base = defaultState();
    return {
      ...base,
      ...parsed,
      stats: {
        ...base.stats,
        ...(isPlainObject(parsed?.stats) ? parsed.stats : {}),
      },
      completedLessons: isPlainObject(parsed?.completedLessons) ? parsed.completedLessons : {},
      puzzleHistory: isPlainObject(parsed?.puzzleHistory) ? parsed.puzzleHistory : {},
    };
  } catch {
    return defaultState();
  }
}

export function saveState(state, { skipServerSync = false } = {}) {
  localStorage.setItem(KEY, JSON.stringify(state));
  if (!skipServerSync) {
    void syncToServer(state);
  }
}

export function defaultState() {
  return {
    createdAt: nowISO(),
    lastActiveAt: nowISO(),

    stats: {
      gamesPlayed: 0,
      gamesWon: 0,
      gamesLost: 0,
      gamesDraw: 0,
      totalMoves: 0,
      adaptiveWinStreak: 0,
      adaptiveLossStreak: 0,
      learningGamesPlayed: 0,
      hintsUsed: 0,
      blundersAvoided: 0,

      lessonsCompleted: 0,
      puzzlesSolved: 0,
      puzzlesFailed: 0,

      streakDays: 0,
      lastStreakDate: null,
    },

    completedLessons: {},
    puzzleHistory: {},
  };
}

export async function syncToServer(state) {
  try {
    const initData = getInitData();
    if (!initData) return false;

    const response = await fetchWithTimeout(PROGRESS_API_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-init-data": initData,
      },
      body: JSON.stringify({ state }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

export async function loadFromServer() {
  const localState = loadState();
  try {
    const initData = getInitData();
    if (!initData) return localState;

    const response = await fetchWithTimeout(PROGRESS_API_PATH, {
      method: "GET",
      headers: {
        "x-telegram-init-data": initData,
      },
    });

    if (!response.ok) return localState;
    const payload = await response.json();
    if (!isPlainObject(payload?.progress)) return localState;

    const merged = mergeStateWithServer(localState, payload.progress);
    saveState(merged, { skipServerSync: true });
    return merged;
  } catch {
    return localState;
  }
}

export function touch(state) {
  state.lastActiveAt = nowISO();
  updateStreak(state);
  saveState(state);
}

export function updateStreak(state) {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const key = `${yyyy}-${mm}-${dd}`;

  const last = state.stats.lastStreakDate;
  if (!last) {
    state.stats.streakDays = 1;
    state.stats.lastStreakDate = key;
    return;
  }
  if (last === key) return;

  const lastDate = new Date(last + "T00:00:00");
  const diffDays = Math.round((today - lastDate) / (1000 * 60 * 60 * 24));

  if (diffDays === 1) state.stats.streakDays += 1;
  else state.stats.streakDays = 1;

  state.stats.lastStreakDate = key;
}
