import { tg } from "./telegram.js";

const SUPPORTED_LANGS = ["en", "ru", "tr", "de", "fr"];
const STORAGE_KEY = "tg_lang_v1";

const dictCache = {};
let activeLang = "en";
let activeDict = null;

function normalizeLang(lang) {
  if (!lang) return "en";
  const lower = String(lang).toLowerCase();
  if (SUPPORTED_LANGS.includes(lower)) return lower;
  const base = lower.split("-")[0];
  if (SUPPORTED_LANGS.includes(base)) return base;
  return "en";
}

export function getLang() {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored) return normalizeLang(stored);
  const telegramLang = tg()?.initDataUnsafe?.user?.language_code;
  if (telegramLang) return normalizeLang(telegramLang);
  const browserLang = navigator?.language || navigator?.userLanguage;
  return normalizeLang(browserLang);
}

export function setLang(lang) {
  const normalized = normalizeLang(lang);
  activeLang = normalized;
  window.localStorage.setItem(STORAGE_KEY, normalized);
  return normalized;
}

function getValueByPath(dict, key) {
  return key.split(".").reduce((acc, part) => {
    if (!acc || typeof acc !== "object") return undefined;
    return acc[part];
  }, dict);
}

function interpolate(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return String(vars[name]);
    }
    return match;
  });
}

export async function loadDict(lang) {
  const normalized = normalizeLang(lang);
  if (dictCache[normalized]) {
    activeLang = normalized;
    activeDict = dictCache[normalized];
    return activeDict;
  }

  try {
    const response = await fetch(`/i18n/${normalized}.json`, { cache: "no-store" });
    if (!response.ok) throw new Error("missing");
    const data = await response.json();
    dictCache[normalized] = data;
    activeLang = normalized;
    activeDict = data;
    if (!dictCache.en) {
      dictCache.en = normalized === "en" ? data : await loadDict("en");
    }
    return activeDict;
  } catch {
    if (normalized !== "en") return loadDict("en");
    dictCache.en = dictCache.en || {};
    activeLang = "en";
    activeDict = dictCache.en;
    return activeDict;
  }
}

export function t(key, vars) {
  const dict = activeDict || dictCache[activeLang] || dictCache.en || {};
  let value = getValueByPath(dict, key);
  if (value == null && dictCache.en) {
    value = getValueByPath(dictCache.en, key);
  }
  if (typeof value !== "string") return key;
  return interpolate(value, vars);
}

export async function applyI18n(root = document) {
  await loadDict(getLang());

  const elements = root.querySelectorAll("[data-i18n]");
  elements.forEach((el) => {
    const key = el.dataset.i18n;
    if (!key) return;
    let vars = null;
    if (el.dataset.i18nVars) {
      try {
        vars = JSON.parse(el.dataset.i18nVars);
      } catch {
        vars = null;
      }
    }
    el.textContent = t(key, vars);
  });

  const placeholders = root.querySelectorAll("[data-i18n-placeholder]");
  placeholders.forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    if (!key) return;
    let vars = null;
    if (el.dataset.i18nVars) {
      try {
        vars = JSON.parse(el.dataset.i18nVars);
      } catch {
        vars = null;
      }
    }
    el.setAttribute("placeholder", t(key, vars));
  });

  const ariaLabels = root.querySelectorAll("[data-i18n-aria]");
  ariaLabels.forEach((el) => {
    const key = el.dataset.i18nAria;
    if (!key) return;
    let vars = null;
    if (el.dataset.i18nVars) {
      try {
        vars = JSON.parse(el.dataset.i18nVars);
      } catch {
        vars = null;
      }
    }
    el.setAttribute("aria-label", t(key, vars));
  });
}

export function listSupportedLangs() {
  return [...SUPPORTED_LANGS];
}
