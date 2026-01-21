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

function flattenStrings(source, prefix = "", map = {}) {
  if (typeof source === "string") {
    map[prefix] = source;
    return map;
  }
  if (Array.isArray(source)) {
    source.forEach((item, index) => {
      const next = prefix ? `${prefix}.${index}` : String(index);
      flattenStrings(item, next, map);
    });
    return map;
  }
  if (source && typeof source === "object") {
    Object.entries(source).forEach(([key, value]) => {
      const next = prefix ? `${prefix}.${key}` : key;
      flattenStrings(value, next, map);
    });
  }
  return map;
}

function applyTranslations(source, translations, prefix = "") {
  if (typeof source === "string") {
    return translations[prefix] || source;
  }
  if (Array.isArray(source)) {
    return source.map((item, index) => {
      const next = prefix ? `${prefix}.${index}` : String(index);
      return applyTranslations(item, translations, next);
    });
  }
  if (source && typeof source === "object") {
    const output = {};
    Object.entries(source).forEach(([key, value]) => {
      const next = prefix ? `${prefix}.${key}` : key;
      output[key] = applyTranslations(value, translations, next);
    });
    return output;
  }
  return source;
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
  if (!enforceRateLimit(req, res, "translate_ui")) return;

  const parsed = await parseJsonBody(req, res);
  if (!parsed) return;
  const { payload, rawBody } = parsed;

  const { sourceLang, targetLang, json } = payload;
  if (!SUPPORTED_SOURCES.has(sourceLang) || !SUPPORTED_TARGETS.has(targetLang)) {
    sendJson(res, 400, { error: "unsupported_language" });
    return;
  }
  if (!json || typeof json !== "object") {
    sendJson(res, 400, { error: "missing_json" });
    return;
  }

  const cacheKey = createCacheKey("translateUiStrings", rawBody);
  const cached = cacheGet(cacheKey);
  if (cached) {
    sendJson(res, 200, cached);
    return;
  }

  const flat = flattenStrings(json);
  const glossary = glossaryFor(targetLang);
  const systemPrompt = "You are a professional translator for chess apps. Return ONLY valid JSON.";
  const userPrompt = `Translate UI strings from ${sourceLang} to ${targetLang}.
Rules:
- Keep placeholders like {name}, %s, $1 unchanged.
- Do not translate coordinates like a1, h8.
- Keep punctuation and emoji.
- Use consistent chess terms.
Glossary: ${JSON.stringify(glossary)}

Translate this flat map of strings. Return ONLY JSON matching the schema with translations for every key.
Input: ${JSON.stringify(flat)}`;

  let responseText = "";
  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      temperature: 0.1,
      response_format: translationSchema("ui_translations"),
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    responseText = response.output_text || "";
    const data = JSON.parse(responseText.trim());
    const translations = data.translations || {};
    const rebuilt = applyTranslations(json, translations);
    const result = { json: rebuilt };
    cacheSet(cacheKey, result);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { error: "openai_error", debugText: responseText.slice(0, 2000) });
  }
};
