const { get, set, setIfNotExists, del } = require("./_storage.cjs");
const { readRequestBody, parseJsonBody, sendJson, requireUser } = require("./_helpers.cjs");

const ROOM_TTL_SECONDS = 24 * 60 * 60;
const LOCK_TTL_SECONDS = 2;
const LOCK_RETRIES = 2;

function getUserColor(room, userId) {
  if (room.hostUserId === userId) return room.hostColor;
  if (room.guestUserId === userId) return room.hostColor === "w" ? "b" : "w";
  return null;
}

function resultFromWinner(winner) {
  if (winner === "w") return "1-0";
  if (winner === "b") return "0-1";
  return "1/2-1/2";
}

async function acquireLock(lockKey) {
  for (let attempt = 0; attempt <= LOCK_RETRIES; attempt += 1) {
    const ok = await setIfNotExists(lockKey, "1", 0, { ttlMs: LOCK_TTL_SECONDS * 1000 });
    if (ok) return true;
    if (attempt < LOCK_RETRIES) await new Promise(resolve => setTimeout(resolve, 80));
  }
  return false;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const auth = requireUser(req, res);
  if (!auth) return;

  let rawBody = "";
  try {
    rawBody = await readRequestBody(req);
  } catch {
    sendJson(res, 400, { error: "invalid_body" });
    return;
  }

  const payload = parseJsonBody(rawBody);
  if (payload === null) {
    sendJson(res, 400, { error: "invalid_json" });
    return;
  }

  const gameId = String(payload?.gameId || "").trim();
  if (!gameId) {
    sendJson(res, 400, { error: "missing_game_id" });
    return;
  }

  const lockKey = `pvp:lock:${gameId}`;
  let lockAcquired = false;
  try {
    lockAcquired = await acquireLock(lockKey);
  } catch {
    lockAcquired = false;
  }

  if (!lockAcquired) {
    sendJson(res, 409, { error: "lock_busy" });
    return;
  }

  try {
    let roomRaw;
    try {
      roomRaw = await get(`pvp:game:${gameId}`);
    } catch {
      sendJson(res, 500, { error: "storage_failed" });
      return;
    }

    if (!roomRaw) {
      sendJson(res, 404, { error: "room_not_found" });
      return;
    }

    let room;
    try {
      room = JSON.parse(roomRaw);
    } catch {
      sendJson(res, 500, { error: "room_corrupt" });
      return;
    }

    const userColor = getUserColor(room, auth.userId);
    if (!userColor) {
      sendJson(res, 403, { error: "forbidden" });
      return;
    }

    if (room.status === "ended") {
      sendJson(res, 200, { room });
      return;
    }

    const winner = userColor === "w" ? "b" : "w";
    room.status = "ended";
    room.result = resultFromWinner(winner);
    room.endReason = "resign";
    room.updatedAt = Math.floor(Date.now() / 1000);
    room.version = (room.version || 1) + 1;

    try {
      await set(`pvp:game:${gameId}`, JSON.stringify(room), ROOM_TTL_SECONDS);
    } catch {
      sendJson(res, 500, { error: "storage_failed" });
      return;
    }

    sendJson(res, 200, { room });
  } finally {
    try {
      await del(lockKey);
    } catch {
      // ignore lock cleanup errors
    }
  }
};
