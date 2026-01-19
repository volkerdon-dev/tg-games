const crypto = require("crypto");

const rateLimits = new Map();
const cacheStore = new Map();

function verifyAdmin(req, res) {
  const token = req.headers["x-admin-token"];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "unauthorized" }));
    return false;
  }
  return true;
}

function getIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].trim();
  }
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function rateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const limit = 10;
  const entry = rateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  entry.count += 1;
  if (entry.count > limit) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }
  return { allowed: true };
}

function cacheGet(key) {
  const entry = cacheStore.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    cacheStore.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  const ttlMs = 10 * 60 * 1000;
  cacheStore.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function createCacheKey(endpoint, body) {
  return crypto.createHash("sha256").update(`${endpoint}:${body}`).digest("hex");
}

module.exports = {
  verifyAdmin,
  getIp,
  rateLimit,
  cacheGet,
  cacheSet,
  createCacheKey,
};
