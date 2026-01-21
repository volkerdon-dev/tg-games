import { applyI18n, getLang, loadDict, setLang } from "../shared/i18n.js";
import { initTelegram } from "../shared/telegram.js";

initTelegram();

const languageSelect = document.getElementById("languageSelect");

async function init() {
  await loadDict(getLang());
  await applyI18n();
  if (languageSelect) {
    languageSelect.value = getLang();
    languageSelect.addEventListener("change", () => {
      setLang(languageSelect.value);
      window.location.reload();
    });
  }
}

init();
