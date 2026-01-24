const { get } = require("./_storage.cjs");
const { sendJson, requireUser, getQuery } = require("./_helpers.cjs");

function isRoomMember(room, userId) {
  return room.hostUserId === userId || room.guestUserId === userId;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const auth = requireUser(req, res);
  if (!auth) return;

  const query = getQuery(req);
  const gameId = query.get("gameId");
  if (!gameId) {
    sendJson(res, 400, { error: "missing_game_id" });
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

  if (!isRoomMember(room, auth.userId)) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }

  const sinceRaw = query.get("since");
  const since = Number(sinceRaw);
  if (Number.isFinite(since) && since > 0 && room.version === since) {
    res.statusCode = 204;
    res.end();
    return;
  }

  sendJson(res, 200, { room });
};
