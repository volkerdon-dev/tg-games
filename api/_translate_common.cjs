const OpenAI = require("openai");
const {
  verifyAdmin,
  getIp,
  rateLimitWithConfig,
  cacheGet,
  cacheSet,
  createCacheKey,
} = require("./_auth.cjs");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", (err) => reject(err));
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function parseJsonBody(req, res) {
  let rawBody = "";
  try {
    rawBody = await readRequestBody(req);
  } catch (error) {
    sendJson(res, 400, { error: "invalid_body" });
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch (error) {
    sendJson(res, 400, { error: "invalid_json" });
    return null;
  }

  return { payload, rawBody };
}

function enforceAdmin(req, res) {
  if (!verifyAdmin(req, res)) {
    return false;
  }
  return true;
}

function enforceRateLimit(req, res, keyPrefix) {
  const ip = getIp(req);
  const rate = rateLimitWithConfig(ip, {
    windowMs: 60 * 1000,
    limit: 10,
    keyPrefix,
  });
  if (!rate.allowed) {
    sendJson(res, 429, { error: "rate_limited" });
    res.setHeader("Retry-After", String(rate.retryAfter));
    return false;
  }
  return true;
}

function translationSchema(name) {
  return {
    type: "json_schema",
    json_schema: {
      name,
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          translations: {
            type: "object",
            additionalProperties: { type: "string" },
          },
        },
        required: ["translations"],
      },
    },
  };
}

module.exports = {
  client,
  parseJsonBody,
  sendJson,
  enforceAdmin,
  enforceRateLimit,
  cacheGet,
  cacheSet,
  createCacheKey,
  translationSchema,
};
