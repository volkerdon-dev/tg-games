export function tg() {
  return window.Telegram?.WebApp || null;
}

export function getInitData() {
  return tg()?.initData || "";
}

export function initTelegram() {
  const app = tg();
  if (!app) return;
  app.ready();
  app.expand();
}

export function sendEvent(payload) {
  const app = tg();
  if (!app) return;
  try {
    app.sendData(JSON.stringify(payload));
  } catch (e) {
    console.error("sendData failed:", e);
  }
}
