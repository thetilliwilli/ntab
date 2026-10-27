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

/* false once the extension is reloaded/updated while this page stays open ("Extension context invalidated") */
export const extensionAlive = () => !!globalThis.chrome?.runtime?.id;

export function hostOf(url) {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/* an action is a link ({ name, url, target? }) or the notepad ({ type: "notes", name }) */
export const isNotes = (action) => action.type === "notes";

/* key of an action's uploaded icon: the hostname for links, "notes" for the notepad */
export const iconKey = (action) => (isNotes(action) ? "notes" : hostOf(action.url));

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
