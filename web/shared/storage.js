const KEY = "tg_chess_v1";

function nowISO() {
  return new Date().toISOString();
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
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

      lessonsCompleted: 0,
      puzzlesSolved: 0,
      puzzlesFailed: 0,

      streakDays: 0,
      lastStreakDate: null
    },

    completedLessons: {},
    puzzleHistory: {}
  };
}

export function touch(state) {
  state.lastActiveAt = nowISO();
  updateStreak(state);
  saveState(state);
}

export function updateStreak(state) {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth()+1).padStart(2,"0");
  const dd = String(today.getDate()).padStart(2,"0");
  const key = `${yyyy}-${mm}-${dd}`;

  const last = state.stats.lastStreakDate;
  if (!last) {
    state.stats.streakDays = 1;
    state.stats.lastStreakDate = key;
    return;
  }
  if (last === key) return;

  const lastDate = new Date(last + "T00:00:00");
  const diffDays = Math.round((today - lastDate) / (1000*60*60*24));

  if (diffDays === 1) state.stats.streakDays += 1;
  else state.stats.streakDays = 1;

  state.stats.lastStreakDate = key;
}
