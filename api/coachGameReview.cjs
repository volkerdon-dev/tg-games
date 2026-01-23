const OpenAI = require("openai");
const {
  getIp,
  rateLimitWithConfig,
  cacheGet,
  cacheSetWithTtl,
  createCacheKey,
} = require("./_auth.cjs");
const { verifyTelegramInitData } = require("./_telegramInitData.cjs");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_PLY = 240;
const TRIM_PLY = 120;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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

function getInitDataHeader(req) {
  const header = req.headers["x-telegram-init-data"];
  if (Array.isArray(header)) return header[0];
  return header || "";
}

function getBotToken() {
  return process.env.TG_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
}

function isOriginAllowed(origin) {
  const allowed = process.env.ALLOWED_ORIGINS;
  if (!allowed) return true;
  if (!origin) return false;
  const list = allowed
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
  if (!list.length) return true;
  return list.includes(origin);
}

function isValidUci(move) {
  return typeof move === "string" && /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(move.trim());
}

function validatePayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") {
    errors.push("payload");
    return errors;
  }
  if (typeof payload.startFen !== "string" || !payload.startFen.trim()) errors.push("startFen");
  if (!Array.isArray(payload.movesUci)) errors.push("movesUci");
  if (Array.isArray(payload.movesUci) && payload.movesUci.some(move => !isValidUci(move))) {
    errors.push("movesUci");
  }
  if (!["1-0", "0-1", "1/2-1/2"].includes(payload.result)) errors.push("result");
  if (!["checkmate", "stalemate", "timeout", "resign", "other"].includes(payload.reason)) {
    errors.push("reason");
  }
  if (!["w", "b"].includes(payload.playerSide)) errors.push("playerSide");
  if (typeof payload.difficulty !== "string" || !payload.difficulty.trim()) errors.push("difficulty");
  if (!["stockfish", "fallback"].includes(payload.engine)) errors.push("engine");
  if (payload.finalFen && typeof payload.finalFen !== "string") errors.push("finalFen");
  return errors;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  const origin = getOrigin(req);
  if (!isOriginAllowed(origin)) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "origin_not_allowed" }));
    return;
  }

  const botToken = getBotToken();
  let telegramUserId;
  if (botToken) {
    const initData = getInitDataHeader(req);
    if (!initData) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "missing_init_data" }));
      return;
    }
    const maxAgeEnv = Number(process.env.TG_INITDATA_MAX_AGE_SECONDS);
    const maxAgeSeconds = Number.isFinite(maxAgeEnv) && maxAgeEnv > 0 ? maxAgeEnv : 86400;
    const verification = verifyTelegramInitData(initData, botToken, { maxAgeSeconds });
    if (!verification.ok) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: verification.error || "invalid_init_data" }));
      return;
    }
    telegramUserId = verification.userId;
  }

  const rateKey = telegramUserId || getIp(req);
  const rate = rateLimitWithConfig(rateKey, {
    windowMs: 30 * 60 * 1000,
    limit: 3,
    keyPrefix: "coach",
  });
  if (!rate.allowed) {
    res.statusCode = 429;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Retry-After", String(rate.retryAfter));
    res.end(JSON.stringify({ error: "rate_limited" }));
    return;
  }

  let rawBody = "";
  try {
    rawBody = await readRequestBody(req);
  } catch (error) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid_body" }));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch (error) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid_json" }));
    return;
  }

  const errors = validatePayload(payload);
  if (errors.length) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid_payload", fields: errors }));
    return;
  }

  const startFen = payload.startFen.trim();
  const movesAll = payload.movesUci.map(move => move.trim());
  const result = payload.result;

  let movesUci = movesAll;
  let trimNote = "";
  if (movesAll.length > MAX_PLY) {
    movesUci = movesAll.slice(-TRIM_PLY);
    trimNote = `Analyze only the last ${TRIM_PLY} ply of the game.`;
  }

  const cacheKey = createCacheKey(
    "coachGameReview",
    JSON.stringify({ startFen, movesUci, result })
  );
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(cached));
    return;
  }

  const systemPrompt =
    "You are a friendly chess coach. Respond with ONLY valid JSON. No markdown or extra text.";

  const userPrompt = `Create a short coach review for a finished chess game.
Difficulty: ${payload.difficulty}
Player side: ${payload.playerSide === "w" ? "White" : "Black"}
Result: ${payload.result}
Reason: ${payload.reason}
Engine: ${payload.engine}
Start FEN: ${startFen}
Moves (UCI, ply list, 1-based indices): ${JSON.stringify(movesUci)}
Final FEN (optional): ${payload.finalFen || "n/a"}
${trimNote}

Rules:
- Output ONLY valid JSON matching the schema below.
- Style: friendly, concrete chess coach. No fluff.
- Do not invent moves; rely on the moves list. If unsure, say "possibly" or "likely".
- Summary: 2-3 sentences, max 60 words.
- keyMoments: up to 2 items.
- mistakes: up to 3 items.
- moveIndex is 1-based ply index within the provided moves list.

Return ONLY this JSON shape:
{
  "summary": "2-3 sentences",
  "keyMoments": [
    { "moveIndex": 7, "title": "Turning point", "whatHappened": "...", "betterIdea": "..." }
  ],
  "mistakes": [
    { "moveIndex": 12, "side": "player|opponent", "mistake": "...", "why": "...", "better": "..." }
  ],
  "oneTip": "One actionable training tip",
  "suggestedDrills": ["Forks basics", "Mate in 1 patterns"],
  "disclaimer": "Short note that analysis may be imperfect"
}`;

  let responseText = "";
  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    responseText = response.output_text || "";
    const data = JSON.parse(responseText.trim());
    cacheSetWithTtl(cacheKey, data, CACHE_TTL_MS);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    if (responseText) {
      res.end(
        JSON.stringify({
          error: "invalid_json",
          message: "Model returned invalid JSON.",
        })
      );
    } else {
      res.end(
        JSON.stringify({
          error: "openai_error",
          message: "Failed to generate coach review.",
        })
      );
    }
  }
};
