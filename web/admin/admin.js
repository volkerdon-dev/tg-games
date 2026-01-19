const adminTokenInput = document.getElementById("adminToken");
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

let currentOutline = null;
let currentLessons = [];

const tokenStorageKey = "tg_admin_token";

function loadToken() {
  const stored = window.localStorage.getItem(tokenStorageKey);
  if (stored) {
    adminTokenInput.value = stored;
  }
}

function saveToken() {
  if (adminTokenInput.value.trim()) {
    window.localStorage.setItem(tokenStorageKey, adminTokenInput.value.trim());
  }
}

function setStatus(message, isError = false) {
  outlineStatus.textContent = message;
  outlineStatus.style.color = isError ? "#fca5a5" : "";
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

copyOutlineBtn.addEventListener("click", () => copyToClipboard(outlineOutput));
copyLessonsBtn.addEventListener("click", () => copyToClipboard(lessonsOutput));
generateOutlineBtn.addEventListener("click", generateOutline);
generateAllBtn.addEventListener("click", generateAll);

loadToken();
