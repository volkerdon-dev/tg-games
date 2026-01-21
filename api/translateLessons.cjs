const {
  client,
  parseJsonBody,
  sendJson,
  enforceAdmin,
  enforceRateLimit,
  cacheGet,
  cacheSet,
  createCacheKey,
  translationSchema,
} = require("./_translate_common.cjs");

const SUPPORTED_TARGETS = new Set(["ru", "tr", "de", "fr"]);
const SUPPORTED_SOURCES = new Set(["en", "ru", "tr", "de", "fr"]);

function buildLessonTranslationMap(lessons) {
  const map = {};
  lessons.forEach((lesson, index) => {
    if (typeof lesson.title === "string") {
      map[`lessons.${index}.title`] = lesson.title;
    }
    if (typeof lesson.description === "string") {
      map[`lessons.${index}.description`] = lesson.description;
    }
    if (Array.isArray(lesson.content)) {
      lesson.content.forEach((line, lineIndex) => {
        if (typeof line === "string") {
          map[`lessons.${index}.content.${lineIndex}`] = line;
        }
      });
    }
    if (lesson.tryIt && typeof lesson.tryIt.prompt === "string") {
      map[`lessons.${index}.tryIt.prompt`] = lesson.tryIt.prompt;
    }
    if (Array.isArray(lesson.quiz)) {
      lesson.quiz.forEach((item, qIndex) => {
        if (typeof item.q === "string") {
          map[`lessons.${index}.quiz.${qIndex}.q`] = item.q;
        }
        if (Array.isArray(item.options)) {
          item.options.forEach((option, oIndex) => {
            if (typeof option === "string") {
              map[`lessons.${index}.quiz.${qIndex}.options.${oIndex}`] = option;
            }
          });
        }
        if (typeof item.explanation === "string") {
          map[`lessons.${index}.quiz.${qIndex}.explanation`] = item.explanation;
        }
      });
    }
  });
  return map;
}

function setLessonPath(lessons, path, value) {
  const parts = path.split(".").slice(1);
  let current = lessons;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    const key = Number.isNaN(Number(part)) ? part : Number(part);
    if (current == null || !(key in current)) {
      return;
    }
    current = current[key];
  }
  const last = parts[parts.length - 1];
  const finalKey = Number.isNaN(Number(last)) ? last : Number(last);
  if (current && finalKey in current) {
    current[finalKey] = value;
  }
}

function applyLessonTranslations(lessons, translations, requestedMap) {
  const output = JSON.parse(JSON.stringify(lessons));
  Object.keys(requestedMap).forEach((path) => {
    const translated = translations[path];
    if (typeof translated === "string") {
      setLessonPath(output, path, translated);
    }
  });
  return output;
}

function glossaryFor(targetLang) {
  const glossary = {
    ru: {
      check: "шах",
      checkmate: "мат",
      stalemate: "пат",
      fork: "вилка",
      pin: "связка",
      skewer: "шпилька",
      castling: "рокировка",
      "en passant": "взятие на проходе",
      promotion: "превращение пешки",
    },
    tr: {
      check: "şah",
      checkmate: "şah mat",
      stalemate: "pat",
      castling: "rok",
      fork: "çatal",
      pin: "bağlama",
      promotion: "terfi",
    },
    de: {
      check: "Schach",
      checkmate: "Schachmatt",
      stalemate: "Patt",
      castling: "Rochade",
      fork: "Gabel",
      pin: "Fesselung",
      promotion: "Umwandlung",
    },
    fr: {
      check: "échec",
      checkmate: "échec et mat",
      stalemate: "pat",
      castling: "roque",
      fork: "fourchette",
      pin: "clouage",
      promotion: "promotion",
    },
  };
  return glossary[targetLang] || {};
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  if (!enforceAdmin(req, res)) return;
  if (!enforceRateLimit(req, res, "translate_lessons")) return;

  const parsed = await parseJsonBody(req, res);
  if (!parsed) return;
  const { payload, rawBody } = parsed;

  const { sourceLang, targetLang, lessons } = payload;
  if (!SUPPORTED_SOURCES.has(sourceLang) || !SUPPORTED_TARGETS.has(targetLang)) {
    sendJson(res, 400, { error: "unsupported_language" });
    return;
  }
  if (!Array.isArray(lessons)) {
    sendJson(res, 400, { error: "missing_lessons" });
    return;
  }

  const cacheKey = createCacheKey("translateLessons", rawBody);
  const cached = cacheGet(cacheKey);
  if (cached) {
    sendJson(res, 200, cached);
    return;
  }

  const translationMap = buildLessonTranslationMap(lessons);
  const glossary = glossaryFor(targetLang);
  const systemPrompt = "You are a friendly chess coach and translator. Return ONLY valid JSON.";
  const userPrompt = `Translate lesson text from ${sourceLang} to ${targetLang}.
Rules:
- Only translate text values. Do NOT alter ids, level, tags, FEN strings, sideToMove, bestMove, UCI moves, or coordinates like a1-h8.
- Keep placeholders like {x}, %s, $1 unchanged.
- Keep the tone: friendly coach, short and clear. Do not bloat bullet length.
Glossary: ${JSON.stringify(glossary)}

Translate the following flat map of lesson text. Return ONLY JSON with translations for each key.
Input: ${JSON.stringify(translationMap)}`;

  let responseText = "";
  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      temperature: 0.1,
      response_format: translationSchema("lesson_translations"),
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    responseText = response.output_text || "";
    const data = JSON.parse(responseText.trim());
    const translations = data.translations || {};
    const translatedLessons = applyLessonTranslations(lessons, translations, translationMap);
    const result = { lessons: translatedLessons };
    cacheSet(cacheKey, result);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { error: "openai_error", debugText: responseText.slice(0, 2000) });
  }
};
