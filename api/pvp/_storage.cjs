const crypto = require("crypto");

const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

const memoryStore = new Map();

function nowMs() {
  return Date.now();
}

function hasUpstash() {
  return Boolean(UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN);
}

function setMemory(key, value, ttlSeconds, ttlMs) {
  const ttlMsValue = Number(ttlMs) > 0
    ? Number(ttlMs)
    : (Number(ttlSeconds) > 0 ? Number(ttlSeconds) * 1000 : 0);
  const expiresAt = ttlMsValue ? nowMs() + ttlMsValue : null;
  memoryStore.set(key, { value, expiresAt });
}

function getMemory(key) {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt && nowMs() > entry.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

async function upstashRequest(path) {
  const url = `${UPSTASH_REDIS_REST_URL}/${path}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      return { ok: false, error: data.error || `upstash_${response.status}` };
    }
    return { ok: true, result: data.result };
  } catch (error) {
    return { ok: false, error: error?.message || "upstash_fetch_failed" };
  }
}

function buildSetPath(key, value, { ttlSeconds, ttlMs, nx } = {}) {
  const params = new URLSearchParams();
  if (Number(ttlMs) > 0) params.append("PX", String(Math.floor(Number(ttlMs))));
  else if (Number(ttlSeconds) > 0) params.append("EX", String(Math.floor(Number(ttlSeconds))));
  if (nx) params.append("NX", "");
  const suffix = params.toString();
  const encodedKey = encodeURIComponent(key);
  const encodedValue = encodeURIComponent(value);
  return `set/${encodedKey}/${encodedValue}${suffix ? `?${suffix}` : ""}`;
}

async function get(key) {
  if (!hasUpstash()) return getMemory(key);
  const path = `get/${encodeURIComponent(key)}`;
  const res = await upstashRequest(path);
  if (!res.ok) throw new Error(res.error || "storage_get_failed");
  return res.result ?? null;
}

async function set(key, value, ttlSeconds, options = {}) {
  if (!hasUpstash()) {
    setMemory(key, value, ttlSeconds, options.ttlMs);
    return true;
  }
  const path = buildSetPath(key, value, { ttlSeconds, ttlMs: options.ttlMs });
  const res = await upstashRequest(path);
  if (!res.ok) throw new Error(res.error || "storage_set_failed");
  return res.result === "OK";
}

async function setIfNotExists(key, value, ttlSeconds, options = {}) {
  if (!hasUpstash()) {
    if (getMemory(key) !== null) return false;
    setMemory(key, value, ttlSeconds, options.ttlMs);
    return true;
  }
  const path = buildSetPath(key, value, { ttlSeconds, ttlMs: options.ttlMs, nx: true });
  const res = await upstashRequest(path);
  if (!res.ok) throw new Error(res.error || "storage_set_failed");
  return res.result === "OK";
}

async function del(key) {
  if (!hasUpstash()) {
    memoryStore.delete(key);
    return true;
  }
  const path = `del/${encodeURIComponent(key)}`;
  const res = await upstashRequest(path);
  if (!res.ok) throw new Error(res.error || "storage_del_failed");
  return true;
}

function randomId(length) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function randomJoinCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

module.exports = {
  get,
  set,
  setIfNotExists,
  del,
  randomId,
  randomJoinCode,
  hasUpstash,
};
