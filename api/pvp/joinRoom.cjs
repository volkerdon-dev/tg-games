const { get, set } = require("./_storage.cjs");
const { readRequestBody, parseJsonBody, sendJson, requireUser } = require("./_helpers.cjs");

const ROOM_TTL_SECONDS = 24 * 60 * 60;

function normalizeJoinCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function canAccessRoom(room, userId) {
  if (room.hostUserId === userId) return true;
  if (room.guestUserId === userId) return true;
  if (!room.guestUserId) return true;
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

  const joinCode = normalizeJoinCode(payload?.joinCode);
  if (!joinCode) {
    sendJson(res, 400, { error: "missing_join_code" });
    return;
  }

  let gameId;
  try {
    gameId = await get(`pvp:code:${joinCode}`);
  } catch {
    sendJson(res, 500, { error: "storage_failed" });
    return;
  }

  if (!gameId) {
    sendJson(res, 404, { error: "room_not_found" });
    return;
  }

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

  if (!canAccessRoom(room, auth.userId)) {
    sendJson(res, 403, { error: "room_full" });
    return;
  }

  let changed = false;
  if (!room.guestUserId && room.hostUserId !== auth.userId) {
    room.guestUserId = auth.userId;
    changed = true;
  }

  if (room.hostUserId && room.guestUserId && room.status !== "ended" && room.status !== "active") {
    room.status = "active";
    changed = true;
  }

  if (changed) {
    room.updatedAt = Math.floor(Date.now() / 1000);
    room.version = (room.version || 1) + 1;
    try {
      await set(`pvp:game:${gameId}`, JSON.stringify(room), ROOM_TTL_SECONDS);
    } catch {
      sendJson(res, 500, { error: "storage_failed" });
      return;
    }
  }

  sendJson(res, 200, { gameId, room });
};
