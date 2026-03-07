const { kv } = require("@vercel/kv");
const { getIp, rateLimitWithConfig } = require("./_auth.cjs");
const { verifyTelegramInitData } = require("./_telegramInitData.cjs");

const NUMERIC_STAT_KEYS = [
  "gamesPlayed",
  "gamesWon",
  "gamesLost",
  "gamesDraw",
  "totalMoves",
  "lessonsCompleted",
  "puzzlesSolved",
  "puzzlesFailed",
  "streakDays",
];

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  Object.entries(extraHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", (error) => reject(error));
  });
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toSafeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  if (number < 0) return 0;
  return number;
}

function parseDateMs(value) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickLatestIso(a, b) {
  const aMs = parseDateMs(a);
  const bMs = parseDateMs(b);
  if (aMs === null && bMs === null) return undefined;
  if (aMs === null) return b;
  if (bMs === null) return a;
  return bMs >= aMs ? b : a;
}

function pickEarliestIso(a, b) {
  const aMs = parseDateMs(a);
  const bMs = parseDateMs(b);
  if (aMs === null && bMs === null) return undefined;
  if (aMs === null) return b;
  if (bMs === null) return a;
  return bMs >= aMs ? a : b;
}

function pickLatestStreakDate(a, b) {
  const aDate = typeof a === "string" ? a : "";
  const bDate = typeof b === "string" ? b : "";
  if (!aDate && !bDate) return null;
  if (!aDate) return bDate;
  if (!bDate) return aDate;
  return bDate >= aDate ? bDate : aDate;
}

function normalizeStats(stats) {
  const source = isPlainObject(stats) ? stats : {};
  const normalized = {};
  NUMERIC_STAT_KEYS.forEach((key) => {
    normalized[key] = toSafeNumber(source[key]);
  });
  const streakDate = source.lastStreakDate;
  normalized.lastStreakDate = typeof streakDate === "string" ? streakDate : null;
  return normalized;
}

function normalizeRecordMap(mapValue) {
  return isPlainObject(mapValue) ? { ...mapValue } : {};
}

function normalizeState(state) {
  const source = isPlainObject(state) ? state : {};
  const normalized = {
    stats: normalizeStats(source.stats),
    completedLessons: normalizeRecordMap(source.completedLessons),
    puzzleHistory: normalizeRecordMap(source.puzzleHistory),
  };

  if (typeof source.createdAt === "string") {
    normalized.createdAt = source.createdAt;
  }
  if (typeof source.lastActiveAt === "string") {
    normalized.lastActiveAt = source.lastActiveAt;
  }

  return normalized;
}

function mergeRecordMaps(serverMap, incomingMap) {
  const merged = { ...serverMap };
  Object.keys(incomingMap).forEach((key) => {
    const serverValue = merged[key];
    const incomingValue = incomingMap[key];
    if (isPlainObject(serverValue) && isPlainObject(incomingValue)) {
      const serverAtMs = parseDateMs(serverValue.at);
      const incomingAtMs = parseDateMs(incomingValue.at);
      if (serverAtMs !== null && incomingAtMs !== null) {
        merged[key] = incomingAtMs >= serverAtMs
          ? { ...serverValue, ...incomingValue }
          : serverValue;
        return;
      }
      merged[key] = { ...serverValue, ...incomingValue };
      return;
    }
    merged[key] = incomingValue;
  });
  return merged;
}

function mergeState(serverState, incomingState) {
  const server = normalizeState(serverState);
  const incoming = normalizeState(incomingState);

  const stats = {};
  NUMERIC_STAT_KEYS.forEach((key) => {
    stats[key] = Math.max(toSafeNumber(server.stats[key]), toSafeNumber(incoming.stats[key]));
  });
  stats.lastStreakDate = pickLatestStreakDate(
    server.stats.lastStreakDate,
    incoming.stats.lastStreakDate
  );

  const merged = {
    stats,
    completedLessons: mergeRecordMaps(server.completedLessons, incoming.completedLessons),
    puzzleHistory: mergeRecordMaps(server.puzzleHistory, incoming.puzzleHistory),
  };

  const createdAt = pickEarliestIso(server.createdAt, incoming.createdAt);
  if (typeof createdAt === "string") merged.createdAt = createdAt;

  const lastActiveAt = pickLatestIso(server.lastActiveAt, incoming.lastActiveAt);
  if (typeof lastActiveAt === "string") merged.lastActiveAt = lastActiveAt;

  return merged;
}

function getInitDataHeader(req) {
  const header = req.headers["x-telegram-init-data"];
  if (Array.isArray(header)) return header[0] || "";
  return header || "";
}

function getBotToken() {
  return process.env.TG_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
}

function verifyRequest(req, res) {
  const initData = getInitDataHeader(req);
  if (!initData) {
    sendJson(res, 401, { error: "missing_init_data" });
    return null;
  }

  const botToken = getBotToken();
  if (!botToken) {
    sendJson(res, 500, { error: "missing_bot_token" });
    return null;
  }

  const maxAgeEnv = Number(process.env.TG_INITDATA_MAX_AGE_SECONDS);
  const maxAgeSeconds = Number.isFinite(maxAgeEnv) && maxAgeEnv > 0 ? maxAgeEnv : 86400;
  const verification = verifyTelegramInitData(initData, botToken, { maxAgeSeconds });

  if (!verification.ok || !verification.userId) {
    sendJson(res, 401, { error: verification.error || "invalid_init_data" });
    return null;
  }

  return verification.userId;
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const telegramUserId = verifyRequest(req, res);
  if (!telegramUserId) return;

  const rate = rateLimitWithConfig(telegramUserId || getIp(req), {
    windowMs: 60 * 1000,
    limit: 60,
    keyPrefix: "progress",
  });
  if (!rate.allowed) {
    sendJson(res, 429, { error: "rate_limited" }, { "Retry-After": String(rate.retryAfter) });
    return;
  }

  const redisKey = `progress:${telegramUserId}`;

  if (req.method === "GET") {
    try {
      const stored = await kv.get(redisKey);
      const progress = isPlainObject(stored) ? normalizeState(stored) : null;
      sendJson(res, 200, { ok: true, progress });
    } catch (error) {
      sendJson(res, 500, { error: "kv_error" });
    }
    return;
  }

  let payload;
  try {
    const bodyRaw = await readRequestBody(req);
    payload = JSON.parse(bodyRaw || "{}");
  } catch (error) {
    sendJson(res, 400, { error: "invalid_json" });
    return;
  }

  const incomingState = isPlainObject(payload?.state) ? payload.state : payload;
  if (!isPlainObject(incomingState)) {
    sendJson(res, 400, { error: "invalid_payload" });
    return;
  }

  try {
    const stored = await kv.get(redisKey);
    const merged = mergeState(stored, incomingState);
    await kv.set(redisKey, merged);
    sendJson(res, 200, { ok: true, progress: merged });
  } catch (error) {
    sendJson(res, 500, { error: "kv_error" });
  }
};
