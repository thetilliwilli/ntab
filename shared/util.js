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

/* "example.com" -> "https://example.com"; anything with a scheme and routes ("#/notes") stay as they are */
export const fixUrl = (u) => (/^([a-z][a-z0-9+.-]*:|#)/i.test(u) ? u : `https://${u}`);

/* "#/notes" -> "notes": the app a route opens; null for anything else */
export const routeOf = (url) => /^#\/([\w-]+)$/.exec(url ?? "")?.[1] ?? null;

/* hands the browser a file to save */
export function download(name, text, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

/* drag to reorder: marks the drop side on hover, calls onDrop(fromKey, toKey, after); one drag at a time */
let dragging = null; // { group, key }

export const isDragging = (group) => dragging?.group === group;

export function sortable(node, { group, key, vertical = false, onDrop, onEnd }) {
  const unmark = (n) => n.classList.remove("drop-before", "drop-after");
  node.addEventListener("dragstart", (e) => {
    dragging = { group, key };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(key));
  });
  node.addEventListener("dragend", () => {
    dragging = null;
    node.parentElement?.querySelectorAll(".drop-before, .drop-after").forEach(unmark);
    onEnd?.();
  });
  node.addEventListener("dragover", (e) => {
    if (!isDragging(group) || dragging.key === key) return;
    e.preventDefault();
    const r = node.getBoundingClientRect();
    const after = vertical ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
    node.classList.toggle("drop-after", after);
    node.classList.toggle("drop-before", !after);
  });
  node.addEventListener("dragleave", () => unmark(node));
  node.addEventListener("drop", (e) => {
    if (!isDragging(group)) return;
    e.preventDefault();
    const after = node.classList.contains("drop-after");
    const from = dragging.key;
    dragging = null;
    unmark(node);
    onDrop(from, key, after);
  });
}

/* 45s, 12m 05s, 3h 07m 09s */
export function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${pad(m)}m ${pad(s % 60)}s`;
  if (m) return `${m}m ${pad(s % 60)}s`;
  return `${s}s`;
}
