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

  const { track, lessons } = payload;
  if (!track || !Array.isArray(lessons) || lessons.length === 0) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "missing_fields" }));
    return;
  }

  const cacheKey = createCacheKey("generateLessonBatch", rawBody);
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(cached));
    return;
  }

  const lessonList = lessons
    .map(
      lesson =>
        `- ${lesson.lessonId} | ${lesson.title} | ${lesson.level} | ${lesson.description}`
    )
    .join("\n");

  const systemPrompt =
    "You are a friendly chess coach. Respond with ONLY valid JSON, no markdown, no extra text.";
  const userPrompt = `Create short chess lessons for this track: ${track}.

Lessons:
${lessonList}

Return ONLY JSON with shape:
{
  "items":[
    {
      "id":"lesson-id",
      "track":"${track.toLowerCase()}",
      "title":"...",
      "level":"...",
      "description":"...",
      "content":["5-8 bullet lines"],
      "quiz":[
        {"q":"...","options":["A","B","C"],"answerIndex":1,"explanation":"..."}
      ],
      "tryIt": null
    }
  ]
}

Rules:
- Keep content 5-8 short bullet lines per lesson.
- Provide 3 quiz questions per lesson.
- Tone: friendly chess coach.
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
