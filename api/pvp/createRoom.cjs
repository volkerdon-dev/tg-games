const { randomId, randomJoinCode, set, setIfNotExists } = require("./_storage.cjs");
const { readRequestBody, parseJsonBody, sendJson, requireUser, getBaseUrl } = require("./_helpers.cjs");

const ROOM_TTL_SECONDS = 24 * 60 * 60;
const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function pickHostColor(preferred) {
  if (preferred === "w" || preferred === "b") return preferred;
  return Math.random() < 0.5 ? "w" : "b";
}

function normalizePreferred(value) {
  if (!value) return "random";
  const normalized = String(value).toLowerCase();
  if (normalized === "w" || normalized === "white") return "w";
  if (normalized === "b" || normalized === "black") return "b";
  return "random";
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

  const preferred = normalizePreferred(payload?.preferredColor);
  const hostColor = pickHostColor(preferred);
  const gameId = randomId(12);

  let joinCode = "";
  let codeStored = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    joinCode = randomJoinCode(6);
    try {
      codeStored = await setIfNotExists(`pvp:code:${joinCode}`, gameId, ROOM_TTL_SECONDS);
    } catch {
      codeStored = false;
    }
    if (codeStored) break;
  }

  if (!codeStored) {
    sendJson(res, 500, { error: "join_code_unavailable" });
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const room = {
    gameId,
    joinCode,
    createdAt: nowSeconds,
    updatedAt: nowSeconds,
    hostUserId: auth.userId,
    guestUserId: null,
    hostColor,
    turn: "w",
    fen: INITIAL_FEN,
    moves: [],
    status: "waiting",
    result: null,
    endReason: null,
    version: 1,
  };

  try {
    await set(`pvp:game:${gameId}`, JSON.stringify(room), ROOM_TTL_SECONDS);
  } catch {
    sendJson(res, 500, { error: "storage_failed" });
    return;
  }

  const baseUrl = getBaseUrl(req);
  const joinUrl = baseUrl ? `${baseUrl}/chess/?join=${joinCode}` : `/chess/?join=${joinCode}`;

  sendJson(res, 200, { gameId, joinCode, joinUrl, room });
};
