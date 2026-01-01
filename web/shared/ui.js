export function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

export function qs(sel, root=document) {
  return root.querySelector(sel);
}

export function qsa(sel, root=document) {
  return Array.from(root.querySelectorAll(sel));
}

export function escapeHtml(str) {
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
