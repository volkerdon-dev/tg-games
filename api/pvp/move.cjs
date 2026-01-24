const { get, set, setIfNotExists, del } = require("./_storage.cjs");
const { readRequestBody, parseJsonBody, sendJson, requireUser } = require("./_helpers.cjs");

const ROOM_TTL_SECONDS = 24 * 60 * 60;
const LOCK_TTL_SECONDS = 2;
const LOCK_RETRIES = 2;

function isRoomMember(room, userId) {
  return room.hostUserId === userId || room.guestUserId === userId;
}

function getUserColor(room, userId) {
  if (room.hostUserId === userId) return room.hostColor;
  if (room.guestUserId === userId) return room.hostColor === "w" ? "b" : "w";
  return null;
}

function isValidUci(move) {
  return typeof move === "string" && /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(move.trim());
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
  const move = String(payload?.move || "").trim();
  const nextFen = String(payload?.nextFen || "").trim();
  const clientVersion = Number(payload?.clientVersion);

  if (!gameId || !isValidUci(move) || !nextFen) {
    sendJson(res, 400, { error: "invalid_payload" });
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

    if (!isRoomMember(room, auth.userId)) {
      sendJson(res, 403, { error: "forbidden" });
      return;
    }

    if (room.status !== "active") {
      sendJson(res, 409, { error: "room_not_active", room });
      return;
    }

    const userColor = getUserColor(room, auth.userId);
    if (!userColor) {
      sendJson(res, 403, { error: "forbidden" });
      return;
    }

    if (room.turn !== userColor) {
      sendJson(res, 409, { error: "not_your_turn", room });
      return;
    }

    if (!Number.isFinite(clientVersion) || clientVersion !== room.version) {
      sendJson(res, 409, { error: "version_mismatch", room });
      return;
    }

    room.moves = Array.isArray(room.moves) ? room.moves : [];
    room.moves.push(move);
    room.fen = nextFen;
    room.turn = room.turn === "w" ? "b" : "w";
    room.updatedAt = Math.floor(Date.now() / 1000);
    room.version = (room.version || 1) + 1;

    try {
      await set(`pvp:game:${gameId}`, JSON.stringify(room), ROOM_TTL_SECONDS);
    } catch {
      sendJson(res, 500, { error: "storage_failed" });
      return;
    }

    sendJson(res, 200, { ok: true, room });
  } finally {
    try {
      await del(lockKey);
    } catch {
      // ignore lock cleanup errors
    }
  }
};
