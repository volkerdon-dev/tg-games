const { verifyTelegramInitData } = require("../_telegramInitData.cjs");
const { getIp } = require("../_auth.cjs");

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", err => reject(err));
  });
}

function getInitDataHeader(req) {
  const header = req.headers["x-telegram-init-data"];
  if (Array.isArray(header)) return header[0];
  return header || "";
}

function getBotToken() {
  return process.env.TG_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function getBaseUrl(req) {
  const host = req.headers.host;
  if (!host) return "";
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

function parseJsonBody(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function getQuery(req) {
  try {
    const base = getBaseUrl(req) || "http://localhost";
    return new URL(req.url || "", base).searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function requireUser(req, res) {
  const botToken = getBotToken();
  const initData = getInitDataHeader(req);
  if (!botToken) {
    if (isProduction()) {
      sendJson(res, 500, { error: "missing_bot_token" });
      return null;
    }
    return { userId: `dev:${getIp(req)}`, devMode: true };
  }
  if (!initData) {
    sendJson(res, 401, { error: "missing_init_data" });
    return null;
  }
  const maxAgeEnv = Number(process.env.TG_INITDATA_MAX_AGE_SECONDS);
  const maxAgeSeconds = Number.isFinite(maxAgeEnv) && maxAgeEnv > 0 ? maxAgeEnv : 86400;
  const verification = verifyTelegramInitData(initData, botToken, { maxAgeSeconds });
  if (!verification.ok) {
    sendJson(res, 401, { error: verification.error || "invalid_init_data" });
    return null;
  }
  if (!verification.userId) {
    sendJson(res, 401, { error: "missing_user" });
    return null;
  }
  return { userId: verification.userId, devMode: false };
}

module.exports = {
  readRequestBody,
  parseJsonBody,
  sendJson,
  getQuery,
  requireUser,
  getBaseUrl,
};
