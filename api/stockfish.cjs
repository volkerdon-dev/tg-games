const path = require("path");
const { getIp, rateLimitWithConfig } = require("./_auth.cjs");
const { verifyTelegramInitData } = require("./_telegramInitData.cjs");

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", (error) => reject(error));
  });
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  Object.entries(extraHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.end(JSON.stringify(payload));
}

function getOrigin(req) {
  if (req.headers.origin) return req.headers.origin;
  if (req.headers.referer) {
    try {
      return new URL(req.headers.referer).origin;
    } catch {
      return null;
    }
  }
  return null;
}

function parseAllowedOrigins() {
  const allowed = process.env.ALLOWED_ORIGINS;
  if (!allowed) return [];
  return allowed
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isOriginAllowed(origin) {
  const list = parseAllowedOrigins();
  if (!list.length) return true;
  if (!origin) return false;
  return list.includes(origin);
}

function applyCorsHeaders(req, res) {
  const origin = getOrigin(req);
  const allowed = isOriginAllowed(origin);
  const allowAny = parseAllowedOrigins().length === 0;

  if (allowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (allowAny) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-telegram-init-data");
  res.setHeader("Access-Control-Max-Age", "86400");
  return { origin, allowed };
}

function getInitDataHeader(req) {
  const header = req.headers["x-telegram-init-data"];
  if (Array.isArray(header)) return header[0] || "";
  return header || "";
}

function normalizeEngineLine(payload) {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload.data === "string") return payload.data;
  return "";
}

function loadStockfishFactory() {
  try {
    return require("stockfish");
  } catch {
    return require("stockfish/src/stockfish-nnue-16-single.js");
  }
}

async function createEngine() {
  const Stockfish = loadStockfishFactory();
  const stockfishOptions = {
    locateFile(fileName) {
      return path.join(process.cwd(), "node_modules/stockfish/src", fileName);
    },
  };

  let rawEngine = typeof Stockfish === "function" ? Stockfish() : Stockfish;
  if (
    typeof rawEngine === "function" &&
    typeof rawEngine.postMessage !== "function" &&
    typeof rawEngine.addMessageListener !== "function"
  ) {
    rawEngine = rawEngine(stockfishOptions);
  }
  rawEngine = await Promise.resolve(rawEngine);

  if (
    rawEngine &&
    typeof rawEngine.postMessage === "function" &&
    typeof rawEngine.addMessageListener === "function"
  ) {
    let handler = null;
    const listener = (line) => {
      if (handler) handler(line);
    };
    rawEngine.addMessageListener(listener);
    return {
      set onmessage(fn) {
        handler = typeof fn === "function" ? fn : null;
      },
      postMessage(message) {
        if (
          (rawEngine.__IS_SINGLE_THREADED__ || rawEngine.__IS_NON_NESTED__) &&
          typeof rawEngine.onCustomMessage === "function"
        ) {
          rawEngine.onCustomMessage(message);
          return;
        }
        rawEngine.postMessage(message, true);
      },
      quit() {
        try {
          if (
            (rawEngine.__IS_SINGLE_THREADED__ || rawEngine.__IS_NON_NESTED__) &&
            typeof rawEngine.onCustomMessage === "function"
          ) {
            rawEngine.onCustomMessage("quit");
          } else {
            rawEngine.postMessage("quit", true);
          }
        } catch {
          // ignore
        }
        try {
          rawEngine.removeMessageListener(listener);
        } catch {
          // ignore
        }
        try {
          rawEngine.terminate();
        } catch {
          // ignore
        }
      },
    };
  }

  if (rawEngine && typeof rawEngine.postMessage === "function") {
    return {
      set onmessage(fn) {
        rawEngine.onmessage = fn;
      },
      postMessage(message) {
        if (
          (rawEngine.__IS_SINGLE_THREADED__ || rawEngine.__IS_NON_NESTED__) &&
          typeof rawEngine.onCustomMessage === "function"
        ) {
          rawEngine.onCustomMessage(message);
          return;
        }
        rawEngine.postMessage(message);
      },
      quit() {
        try {
          if (
            (rawEngine.__IS_SINGLE_THREADED__ || rawEngine.__IS_NON_NESTED__) &&
            typeof rawEngine.onCustomMessage === "function"
          ) {
            rawEngine.onCustomMessage("quit");
          } else {
            rawEngine.postMessage("quit");
          }
        } catch {
          // ignore
        }
        try {
          rawEngine.terminate();
        } catch {
          // ignore
        }
      },
    };
  }

  throw new Error("stockfish_init_failed");
}

module.exports = async (req, res) => {
  const { allowed } = applyCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    if (!allowed) {
      sendJson(res, 401, { error: "origin_not_allowed" });
      return;
    }
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!allowed) {
    sendJson(res, 401, { error: "origin_not_allowed" });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const botToken = process.env.TG_BOT_TOKEN || "";
  let telegramUserId;
  if (botToken) {
    const initData = getInitDataHeader(req);
    if (!initData) {
      sendJson(res, 401, { error: "missing_init_data" });
      return;
    }

    const maxAgeEnv = Number(process.env.TG_INITDATA_MAX_AGE_SECONDS);
    const maxAgeSeconds = Number.isFinite(maxAgeEnv) && maxAgeEnv > 0 ? maxAgeEnv : 86400;
    const verification = verifyTelegramInitData(initData, botToken, { maxAgeSeconds });
    if (!verification.ok) {
      sendJson(res, 401, { error: verification.error || "invalid_init_data" });
      return;
    }
    telegramUserId = verification.userId;
  }

  const rateKey = telegramUserId || getIp(req);
  const rate = rateLimitWithConfig(rateKey, {
    keyPrefix: "stockfish",
    windowMs: 60000,
    limit: 60,
  });
  if (!rate.allowed) {
    sendJson(res, 429, { error: "rate_limited" }, { "Retry-After": String(rate.retryAfter) });
    return;
  }

  let payload;
  try {
    const rawBody = await readRequestBody(req);
    payload = JSON.parse(rawBody || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid_json" });
    return;
  }

  const fen = payload?.fen;
  if (typeof fen !== "string" || !fen.trim()) {
    sendJson(res, 400, { error: "invalid_fen" });
    return;
  }

  const movetime = payload?.movetime;
  const skill = payload?.skill;
  const multiPv = payload?.multiPv;

  const safeMoveTime = Math.min(5000, Math.max(300, Number(movetime) || 1000));
  const safeSkill = Math.min(20, Math.max(0, Number(skill) || 10));
  const safeMultiPv = Math.min(5, Math.max(1, Number(multiPv) || 1));

  let engine;
  try {
    engine = await createEngine();
  } catch (error) {
    sendJson(res, 500, {
      error: "engine_error",
      message: error?.message || "Failed to initialize engine",
    });
    return;
  }
  const infoLines = [];

  try {
    await new Promise((resolve) => {
      engine.onmessage = (line) => {
        const text = normalizeEngineLine(line);
        if (text === "uciok") resolve();
      };
      engine.postMessage("uci");
    });

    await new Promise((resolve) => {
      engine.onmessage = (line) => {
        const text = normalizeEngineLine(line);
        if (text === "readyok") resolve();
      };
      engine.postMessage("isready");
    });

    engine.postMessage(`setoption name Skill Level value ${safeSkill}`);
    if (safeMultiPv > 1) engine.postMessage(`setoption name MultiPV value ${safeMultiPv}`);
    engine.postMessage(`position fen ${fen.trim()}`);

    const bestmove = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout")), safeMoveTime + 4000);
      engine.onmessage = (line) => {
        const text = normalizeEngineLine(line);
        if (typeof text === "string" && text.startsWith("info") && text.includes("pv")) {
          infoLines.push(text);
        }
        if (typeof text === "string" && text.startsWith("bestmove")) {
          clearTimeout(timeout);
          resolve(text.split(" ")[1] || null);
        }
      };
      engine.postMessage(`go movetime ${safeMoveTime}`);
    });

    engine.quit();
    sendJson(res, 200, { bestmove, lines: infoLines });
  } catch (error) {
    try {
      engine.quit();
    } catch {
      // ignore
    }
    sendJson(res, 500, {
      error: "engine_error",
      message: error?.message || "Failed to evaluate position",
    });
  }
};
