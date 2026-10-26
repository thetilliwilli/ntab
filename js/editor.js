/*
 * plain textarea + line-number gutter.
 * wrap off: one line of numbers per line. wrap on: line heights are measured on a hidden mirror (cached per line
 * text) and only the numbers in view are drawn.
 */

import { $ } from "./util.js";

const box = $("editor");
const ta = $("text");
const inner = $("gutter-inner");
const gutter = $("gutter");
const mirror = $("mirror");

let wrap = false;
let tabSize = 4;
let value = ""; // ta.value, kept here: reading it from a big textarea is not free
let frame = 0;
let shownCount = -1; // line count the wrap-off gutter shows
let tops = []; // wrap on: top of every line, then the total height
let width = 0;
const heights = new Map(); // wrap on: line text -> height at the current width and font
let handlers = { onInput() {}, onView() {}, onCursor() {} };

export function init(h) {
  handlers = { ...handlers, ...h };

  ta.addEventListener("input", () => {
    value = ta.value;
    handlers.onInput(value);
    scheduleGutter();
    cursor(); // length changes even when the caret doesn't move (Delete)
  });
  ta.addEventListener("scroll", () => {
    syncScroll();
    handlers.onView();
  });
  ta.addEventListener("keydown", onKey);
  // caret moves by keyboard and mouse
  document.addEventListener("selectionchange", () => {
    if (document.activeElement !== ta) return;
    cursor();
    handlers.onView();
  });
  new ResizeObserver(() => wrap && scheduleGutter()).observe(ta);
}

export function configure({ fontSize, wrap: w, tabSize: t }) {
  box.style.setProperty("--fs", `${fontSize}px`);
  box.style.setProperty("--tab", t);
  tabSize = t;
  wrap = w;
  box.classList.toggle("wrap", w);
  ta.wrap = w ? "soft" : "off";
  shownCount = -1;
  heights.clear();
  renderGutter();
}

export function setText(text, view) {
  ta.value = value = text;
  renderGutter();
  ta.setSelectionRange(view?.s ?? 0, view?.e ?? 0);
  ta.scrollTop = view?.top ?? 0;
  ta.scrollLeft = view?.left ?? 0;
  syncScroll();
  cursor();
}

/* swap the text in place (remote / external change), keeping cursor and scroll */
export function replaceText(text) {
  const { selectionStart: s, selectionEnd: e, scrollTop, scrollLeft } = ta;
  ta.value = value = text;
  ta.setSelectionRange(Math.min(s, text.length), Math.min(e, text.length));
  ta.scrollTop = scrollTop;
  ta.scrollLeft = scrollLeft;
  renderGutter();
  cursor();
}

export function getView() {
  return { s: ta.selectionStart, e: ta.selectionEnd, top: ta.scrollTop, left: ta.scrollLeft };
}

export const focus = () => ta.focus();

/* gutter */

function scheduleGutter() {
  if (!frame) frame = requestAnimationFrame(renderGutter);
}

function renderGutter() {
  cancelAnimationFrame(frame);
  frame = 0;
  let count = 1;
  for (let i = value.indexOf("\n"); i !== -1; i = value.indexOf("\n", i + 1)) count++;
  gutter.style.width = `calc(${Math.max(2, String(count).length)}ch + 18px)`;

  if (wrap) measure();
  else if (count !== shownCount) {
    let s = "";
    for (let i = 1; i <= count; i++) s += `${i}\n`;
    inner.textContent = s;
  }
  shownCount = wrap ? -1 : count;
  syncScroll();
}

/* wrap on: heights of lines not seen at this width yet, in one layout pass */
function measure() {
  if (ta.clientWidth !== width) {
    width = ta.clientWidth;
    heights.clear();
  }
  const lines = value.split("\n");
  const todo = [...new Set(lines.filter((l) => !heights.has(l)))];
  if (todo.length) {
    const cs = getComputedStyle(ta);
    mirror.style.width = `${width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)}px`;
    const divs = todo.map((l) => Object.assign(document.createElement("div"), { textContent: l || "​" }));
    const frag = document.createDocumentFragment();
    for (const d of divs) frag.append(d); // not append(...divs): too many arguments on huge files
    mirror.append(frag);
    divs.forEach((d, i) => heights.set(todo[i], d.getBoundingClientRect().height));
    mirror.textContent = "";
  }
  if (heights.size > 2 * lines.length + 1000) {
    // forget lines that are gone
    const keep = new Set(lines);
    for (const l of heights.keys()) if (!keep.has(l)) heights.delete(l);
  }
  tops = new Array(lines.length + 1);
  let y = 0;
  lines.forEach((l, i) => {
    tops[i] = y;
    y += heights.get(l);
  });
  tops[lines.length] = y;
}

/* wrap on: draws the numbers of the lines in view (the gutter content is shifted by -scrollTop) */
function drawVisible() {
  const pad = parseFloat(getComputedStyle(inner).paddingTop);
  const from = ta.scrollTop - pad;
  const to = from + ta.clientHeight;
  let lo = 0;
  let hi = tops.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid] <= from) lo = mid;
    else hi = mid - 1;
  }
  const out = [];
  for (let i = lo; i < tops.length - 1 && tops[i] < to; i++) {
    const d = document.createElement("div");
    d.textContent = i + 1;
    d.style.top = `${pad + tops[i]}px`;
    d.style.height = `${tops[i + 1] - tops[i]}px`;
    out.push(d);
  }
  inner.replaceChildren(...out);
}

function syncScroll() {
  inner.style.transform = `translateY(${-ta.scrollTop}px)`;
  if (wrap) drawVisible();
}

/* cursor */

const lineStart = (v, pos) => (pos === 0 ? 0 : v.lastIndexOf("\n", pos - 1) + 1);

function cursor() {
  const s = ta.selectionStart;
  let ln = 1;
  for (let i = value.indexOf("\n"); i !== -1 && i < s; i = value.indexOf("\n", i + 1)) ln++;
  handlers.onCursor({ ln, col: s - lineStart(value, s) + 1, len: value.length, sel: ta.selectionEnd - s });
}

/* Tab / Shift+Tab: insert spaces, (un)indent selected lines; goes through execCommand so Ctrl+Z works */

function insert(text) {
  if (!document.execCommand("insertText", false, text)) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function onKey(e) {
  if (e.key !== "Tab" || e.ctrlKey || e.altKey || e.metaKey) return;
  e.preventDefault();

  const v = value;
  const s = ta.selectionStart;
  const en = ta.selectionEnd;
  const multi = v.slice(s, en).includes("\n");
  const indent = " ".repeat(tabSize);
  if (!e.shiftKey && !multi) return insert(indent);

  const ls = lineStart(v, s);
  const last = en > s && v[en - 1] === "\n" ? en - 1 : en;
  let le = v.indexOf("\n", last);
  if (le === -1) le = v.length;

  const lines = v.slice(ls, le).split("\n");
  const strip = new RegExp(`^(\\t| {1,${tabSize}})`);
  const out = lines.map((l) => (e.shiftKey ? l.replace(strip, "") : indent + l));
  const block = out.join("\n");
  if (block === lines.join("\n")) return;

  const d0 = out[0].length - lines[0].length;
  ta.setSelectionRange(ls, le);
  insert(block);

  if (multi) ta.setSelectionRange(ls, ls + block.length + (last !== en ? 1 : 0));
  else ta.setSelectionRange(Math.max(ls, s + d0), Math.max(ls, en + d0));
}
