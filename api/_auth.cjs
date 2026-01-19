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

function rateLimitWithConfig(
  ip,
  { windowMs = 60 * 1000, limit = 10, keyPrefix = "default" } = {}
) {
  const now = Date.now();
  const key = `${keyPrefix}:${ip || "unknown"}`;
  const entry = rateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
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

function rateLimit(ip) {
  return rateLimitWithConfig(ip, { windowMs: 60 * 1000, limit: 10, keyPrefix: "admin" });
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

function cacheSetWithTtl(key, value, ttlMs) {
  const ttl = Number(ttlMs);
  const safeTtl = Number.isFinite(ttl) && ttl > 0 ? ttl : 10 * 60 * 1000;
  cacheStore.set(key, { value, expiresAt: Date.now() + safeTtl });
}

function createCacheKey(endpoint, body) {
  return crypto.createHash("sha256").update(`${endpoint}:${body}`).digest("hex");
}

module.exports = {
  verifyAdmin,
  getIp,
  rateLimit,
  rateLimitWithConfig,
  cacheGet,
  cacheSet,
  cacheSetWithTtl,
  createCacheKey,
};
