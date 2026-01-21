const adminTokenInput = document.getElementById("adminToken");
const rememberTokenInput = document.getElementById("rememberToken");
const trackSelect = document.getElementById("trackSelect");
const levelSelect = document.getElementById("levelSelect");
const lessonsCountInput = document.getElementById("lessonsCount");
const generateOutlineBtn = document.getElementById("generateOutline");
const outlineStatus = document.getElementById("outlineStatus");
const outlineOutput = document.getElementById("outlineOutput");
const lessonList = document.getElementById("lessonList");
const generateAllBtn = document.getElementById("generateAll");
const lessonsOutput = document.getElementById("lessonsOutput");
const copyOutlineBtn = document.getElementById("copyOutline");
const copyLessonsBtn = document.getElementById("copyLessons");
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");
const translateTypeSelect = document.getElementById("translateType");
const sourceLangSelect = document.getElementById("sourceLang");
const targetLangSelect = document.getElementById("targetLang");
const translateSource = document.getElementById("translateSource");
const translateResult = document.getElementById("translateResult");
const translateBtn = document.getElementById("translateBtn");
const translateStatus = document.getElementById("translateStatus");
const translateHint = document.getElementById("translateHint");
const copyTranslateBtn = document.getElementById("copyTranslate");

let currentOutline = null;
let currentLessons = [];

const tokenStorageKey = "tg_admin_token";
const rememberStorageKey = "tg_admin_token_remember";

function loadToken() {
  const remember = window.localStorage.getItem(rememberStorageKey) === "true";
  if (rememberTokenInput) rememberTokenInput.checked = remember;
  if (!remember) return;
  const stored = window.localStorage.getItem(tokenStorageKey);
  if (stored && adminTokenInput) adminTokenInput.value = stored;
}

function saveToken() {
  const shouldRemember = Boolean(rememberTokenInput?.checked);
  window.localStorage.setItem(rememberStorageKey, shouldRemember ? "true" : "false");
  if (!shouldRemember) {
    window.localStorage.removeItem(tokenStorageKey);
    return;
  }
  if (adminTokenInput.value.trim()) {
    window.localStorage.setItem(tokenStorageKey, adminTokenInput.value.trim());
  }
}

function setStatus(message, isError = false) {
  outlineStatus.textContent = message;
  outlineStatus.style.color = isError ? "#fca5a5" : "";
}

function setTranslateStatus(message, isError = false) {
  translateStatus.textContent = message;
  translateStatus.style.color = isError ? "#fca5a5" : "";
}

function setActiveTab(tab) {
  tabButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.tabPanel === tab);
  });
}

async function postJson(url, body) {
  saveToken();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": adminTokenInput.value.trim(),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON response: ${text}`);
  }
  if (!response.ok) {
    throw new Error(data.error || response.statusText);
  }
  return data;
}

function renderLessons() {
  lessonList.innerHTML = "";
  currentLessons.forEach(lesson => {
    const card = document.createElement("div");
    card.className = "card";

    const title = document.createElement("h3");
    title.textContent = `${lesson.title} (${lesson.lessonId})`;

    const subtitle = document.createElement("p");
    subtitle.textContent = `${lesson.level} · ${lesson.description}`;

    const button = document.createElement("button");
    button.className = "btn";
    button.type = "button";
    button.textContent = "Generate lesson";
    button.addEventListener("click", () => generateLesson(lesson));

    card.appendChild(title);
    card.appendChild(subtitle);
    card.appendChild(button);
    lessonList.appendChild(card);
  });
}

function flattenLessons(modules) {
  const lessons = [];
  modules.forEach(module => {
    module.lessons.forEach(lesson => {
      lessons.push({
        lessonId: lesson.id,
        title: lesson.title,
        level: lesson.level,
        description: lesson.description,
      });
    });
  });
  return lessons;
}

async function generateOutline() {
  setStatus("Generating outline...");
  outlineOutput.value = "";
  lessonsOutput.value = "";
  currentLessons = [];
  currentOutline = null;
  renderLessons();

  const body = {
    track: trackSelect.value,
    level: levelSelect.value,
    lessonsCount: Number(lessonsCountInput.value || 8),
  };

  try {
    const data = await postJson("/api/generateTrackOutline", body);
    currentOutline = data;
    outlineOutput.value = JSON.stringify(data, null, 2);
    currentLessons = flattenLessons(data.modules || []);
    renderLessons();
    setStatus("Outline ready.");
  } catch (error) {
    setStatus(`Error: ${error.message}`, true);
  }
}

async function generateLesson(lesson) {
  setStatus(`Generating lesson ${lesson.lessonId}...`);
  try {
    const data = await postJson("/api/generateLesson", {
      track: trackSelect.value,
      lessonId: lesson.lessonId,
      title: lesson.title,
      level: lesson.level,
      description: lesson.description,
      style: "short_bullets",
    });
    currentLessons = currentLessons.map(item =>
      item.lessonId === lesson.lessonId ? { ...item, generated: data } : item
    );
    updateLessonsOutput();
    setStatus(`Lesson ${lesson.lessonId} ready.`);
  } catch (error) {
    setStatus(`Error: ${error.message}`, true);
  }
}

async function generateAll() {
  if (currentLessons.length === 0) {
    setStatus("Generate an outline first.", true);
    return;
  }
  setStatus("Generating all lessons...");
  try {
    const data = await postJson("/api/generateLessonBatch", {
      track: trackSelect.value,
      lessons: currentLessons.map(lesson => ({
        lessonId: lesson.lessonId,
        title: lesson.title,
        level: lesson.level,
        description: lesson.description,
      })),
    });
    const items = Array.isArray(data.items) ? data.items : [];
    currentLessons = currentLessons.map(lesson => {
      const match = items.find(item => item.id === lesson.lessonId);
      return match ? { ...lesson, generated: match } : lesson;
    });
    updateLessonsOutput();
    setStatus("All lessons ready.");
  } catch (error) {
    setStatus(`Error: ${error.message}`, true);
  }
}

function updateLessonsOutput() {
  const generated = currentLessons
    .map(lesson => lesson.generated)
    .filter(Boolean);
  if (generated.length > 0) {
    lessonsOutput.value = JSON.stringify(generated, null, 2);
  }
}

function copyToClipboard(textarea) {
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  navigator.clipboard.writeText(textarea.value || "");
}

function updateTranslateHint() {
  if (!translateHint) return;
  if (translateTypeSelect.value === "lessons") {
    translateHint.textContent = "Для Lessons: вставь lessons.en.json, получишь lessons.ru.json.";
  } else {
    translateHint.textContent = "Для UI: вставь en.json, получишь ru.json.";
  }
}

async function translateJson() {
  setTranslateStatus("Translating...");
  translateResult.value = "";
  let parsed;
  try {
    parsed = JSON.parse(translateSource.value || "{}");
  } catch (error) {
    setTranslateStatus("Invalid JSON in source.", true);
    return;
  }

  const payload = {
    sourceLang: sourceLangSelect.value,
    targetLang: targetLangSelect.value,
  };

  let endpoint = "/api/translateUiStrings";
  if (translateTypeSelect.value === "lessons") {
    payload.lessons = parsed;
    endpoint = "/api/translateLessons";
  } else {
    payload.json = parsed;
  }

  try {
    const data = await postJson(endpoint, payload);
    const output = translateTypeSelect.value === "lessons" ? data.lessons : data.json;
    translateResult.value = JSON.stringify(output, null, 2);
    setTranslateStatus("Translation ready.");
  } catch (error) {
    setTranslateStatus(`Error: ${error.message}`, true);
  }
}

copyOutlineBtn.addEventListener("click", () => copyToClipboard(outlineOutput));
copyLessonsBtn.addEventListener("click", () => copyToClipboard(lessonsOutput));
copyTranslateBtn.addEventListener("click", () => copyToClipboard(translateResult));
generateOutlineBtn.addEventListener("click", generateOutline);
generateAllBtn.addEventListener("click", generateAll);
translateBtn.addEventListener("click", translateJson);
translateTypeSelect.addEventListener("change", updateTranslateHint);
rememberTokenInput?.addEventListener("change", saveToken);
tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
});

loadToken();
updateTranslateHint();
