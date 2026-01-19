const OpenAI = require("openai");
const {
  verifyAdmin,
  getIp,
  rateLimit,
  cacheGet,
  cacheSet,
  createCacheKey,
} = require("./_auth.cjs");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  if (!verifyAdmin(req, res)) {
    return;
  }

  const ip = getIp(req);
  const rate = rateLimit(ip);
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

  const { track, level, lessonsCount } = payload;
  if (!track || !level || !lessonsCount) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "missing_fields" }));
    return;
  }

  const cacheKey = createCacheKey("generateTrackOutline", rawBody);
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(cached));
    return;
  }

  const systemPrompt =
    "You are a friendly chess coach. Respond with ONLY valid JSON, no markdown, no extra text.";
  const userPrompt = `Create a concise chess learning track outline.
Track: ${track}
Level: ${level}
Lessons count: ${lessonsCount}

Return JSON with this shape:
{
  "track":"${track}",
  "title":"...",
  "summary":"...",
  "modules":[
    {"title":"Module 1","lessons":[{"id":"prefix-01","title":"...","description":"...","level":"${level}"}]}
  ]
}

Rules:
- IDs must be unique, and use prefix: beginner=bf, tactics=ta, strategy=st, endgames=eg.
- lessons count across all modules must equal ${lessonsCount}.
- Keep summaries short and practical.
- Output ONLY valid JSON.`;

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
    cacheSet(cacheKey, data);
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
          debugText: responseText.slice(0, 2000),
        })
      );
    } else {
      res.end(JSON.stringify({ error: "openai_error" }));
    }
  }
};
