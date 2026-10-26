export const $ = (id) => document.getElementById(id);

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* index where the extension starts ("note.md" -> 4), or name.length if there is none */
export function extStart(name) {
  const i = name.lastIndexOf(".");
  return i > 0 ? i : name.length;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

const pad = (n) => String(n).padStart(2, "0");

/* HH:MM:SS for today, YYYY-MM-DD HH:MM otherwise */
export function fmtTime(ts) {
  const d = new Date(ts);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === new Date().toDateString()) return `${hm}:${pad(d.getSeconds())}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

export function fmtSize(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}
