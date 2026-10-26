/* plain textarea + line-number gutter; with wrap on, logical line heights are measured on a hidden mirror */

import { $ } from "./util.js";

const box = $("editor");
const ta = $("text");
const inner = $("gutter-inner");
const gutter = $("gutter");
const mirror = $("mirror");

let wrap = false;
let tabSize = 4;
let lastCount = -1;
let frame = 0;
let handlers = { onInput() {}, onView() {}, onCursor() {} };

export function init(h) {
  handlers = { ...handlers, ...h };

  ta.addEventListener("input", () => {
    handlers.onInput(ta.value);
    scheduleGutter();
    cursor();
  });
  ta.addEventListener("scroll", () => {
    syncScroll();
    handlers.onView();
  });
  ta.addEventListener("keydown", onKey);
  ta.addEventListener("keyup", cursor);
  ta.addEventListener("mouseup", cursor);
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
  lastCount = -1;
  renderGutter();
}

export function setText(text, view) {
  ta.value = text;
  lastCount = -1;
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
  ta.value = text;
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
  const v = ta.value;
  let count = 1;
  for (let i = v.indexOf("\n"); i !== -1; i = v.indexOf("\n", i + 1)) count++;
  gutter.style.width = `calc(${Math.max(2, String(count).length)}ch + 18px)`;

  if (!wrap) {
    if (count !== lastCount) {
      let s = "";
      for (let i = 1; i <= count; i++) s += `${i}\n`;
      inner.textContent = s;
    }
  } else {
    const cs = getComputedStyle(ta);
    mirror.style.width = `${ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)}px`;
    const lines = v.split("\n");
    mirror.textContent = "";
    for (const line of lines) mirror.append(Object.assign(document.createElement("div"), { textContent: line || "​" }));
    const out = document.createDocumentFragment();
    let i = 0;
    for (const d of mirror.children) {
      const g = document.createElement("div");
      g.textContent = ++i;
      g.style.height = `${d.getBoundingClientRect().height}px`;
      out.append(g);
    }
    mirror.textContent = "";
    inner.textContent = "";
    inner.append(out);
  }
  lastCount = count;
  syncScroll();
}

function syncScroll() {
  inner.style.transform = `translateY(${-ta.scrollTop}px)`;
}

/* cursor */

const lineStart = (v, pos) => (pos === 0 ? 0 : v.lastIndexOf("\n", pos - 1) + 1);

function cursor() {
  const v = ta.value;
  const s = ta.selectionStart;
  let ln = 1;
  for (let i = v.indexOf("\n"); i !== -1 && i < s; i = v.indexOf("\n", i + 1)) ln++;
  handlers.onCursor({ ln, col: s - lineStart(v, s) + 1, len: v.length, sel: ta.selectionEnd - s });
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

  const v = ta.value;
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
