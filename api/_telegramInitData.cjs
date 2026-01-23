const crypto = require("crypto");

function parseInitData(initDataString) {
  const params = new URLSearchParams(initDataString || "");
  const map = new Map();
  for (const [key, value] of params.entries()) {
    map.set(key, value);
  }
  const hash = map.get("hash") || "";
  const authDateRaw = map.get("auth_date") || "";
  const authDate = authDateRaw ? Number(authDateRaw) : null;
  const userJsonString = map.get("user") || "";
  return { map, hash, authDate, userJsonString };
}

function buildDataCheckString(paramsMap) {
  const keys = Array.from(paramsMap.keys())
    .filter((key) => key !== "hash")
    .sort();
  return keys.map((key) => `${key}=${paramsMap.get(key)}`).join("\n");
}

function safeTimingEqual(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function verifyTelegramInitData(initDataString, botToken, { maxAgeSeconds = 86400 } = {}) {
  if (!initDataString || typeof initDataString !== "string") {
    return { ok: false, error: "missing_init_data" };
  }
  if (!botToken) {
    return { ok: false, error: "missing_bot_token" };
  }

  const { map, hash, authDate, userJsonString } = parseInitData(initDataString);
  if (!hash) {
    return { ok: false, error: "invalid_init_data" };
  }

  const dataCheckString = buildDataCheckString(map);
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const computed = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  let validHash = false;
  try {
    validHash = safeTimingEqual(
      Buffer.from(computed, "hex"),
      Buffer.from(hash, "hex")
    );
  } catch (error) {
    validHash = false;
  }

  if (!validHash) {
    return { ok: false, error: "invalid_init_data" };
  }

  if (!Number.isFinite(authDate)) {
    return { ok: false, error: "invalid_init_data" };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0) {
    if (nowSeconds - authDate > maxAgeSeconds) {
      return { ok: false, error: "stale_init_data", authDate };
    }
  }

  let userId;
  if (userJsonString) {
    try {
      const user = JSON.parse(userJsonString);
      if (user && typeof user.id !== "undefined") {
        userId = String(user.id);
      }
    } catch (error) {
      userId = undefined;
    }
  }

  return { ok: true, authDate, userId };
}

module.exports = {
  parseInitData,
  buildDataCheckString,
  verifyTelegramInitData,
};
