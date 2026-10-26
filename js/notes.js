/*
 * open notes, autosave, session and cross-tab sync.
 *
 * every edit:  draft:<name> in storage.local immediately  ->  file write after SAVE_DELAY  ->  draft removed.
 * a draft newer than its file (page closed before the write finished) wins on next load.
 *
 * other new-tab pages:  text/saved/rename/deleted via BroadcastChannel,
 *                       open tab list via the shared "session" key in storage.local.
 */

import * as fs from "./fs.js";
import * as editor from "./editor.js";
import { fmtTime } from "./util.js";

const SAVE_DELAY = 300;
const pageId = crypto.randomUUID();
const bc = new BroadcastChannel("newtab-notes");
const draftKey = (name) => `draft:${name}`;

const notes = new Map(); // name -> note
let order = [];
let active = null;
let views = {}; // name -> { s, e, top, left }
let started = false;
let sessionTimer = 0;
const listeners = new Set();
let statusFn = () => {};

export const getOrder = () => order;
export const getActive = () => active;
export const getNote = (name) => notes.get(name);
export const isOpen = (name) => notes.has(name);
export const subscribe = (fn) => listeners.add(fn);
export const onStatus = (fn) => (statusFn = fn);
export const report = (msg) => statusFn(msg, "err");

const emit = () => listeners.forEach((fn) => fn());

function makeNote(name, text, mtime) {
  return { name, text, mtime, dirty: false, saving: false, error: null, closed: false, timer: 0, chain: Promise.resolve() };
}

async function load(name) {
  let text = null;
  let mtime = 0;
  try {
    ({ text, lastModified: mtime } = await fs.readNote(name));
  } catch (e) {
    if (e.name !== "NotFoundError") throw e;
  }
  const draft = (await chrome.storage.local.get(draftKey(name)))[draftKey(name)];
  if (draft && (text === null || draft.ts > mtime) && draft.text !== text) {
    const n = makeNote(name, draft.text, mtime);
    n.dirty = true;
    scheduleSave(n);
    return n;
  }
  if (draft) chrome.storage.local.remove(draftKey(name));
  return text === null ? null : makeNote(name, text, mtime);
}

/* ---------- lifecycle ---------- */

export async function start({ fresh = false } = {}) {
  for (const n of notes.values()) clearTimeout(n.timer);
  notes.clear();
  order = [];
  active = null;
  started = false;

  const session = fresh ? null : (await chrome.storage.local.get("session")).session;
  views = session?.views || {};
  for (const name of session?.tabs || []) {
    try {
      const n = await load(name);
      if (n) {
        notes.set(name, n);
        order.push(name);
      }
    } catch (e) {
      console.warn("cannot load", name, e);
    }
  }
  started = true;
  if (!order.length) return create();
  activate(order.includes(session?.active) ? session.active : order[0]);
}

export async function create() {
  const name = await fs.nextNewName(new Set(order));
  const mtime = await fs.writeNote(name, "");
  notes.set(name, makeNote(name, "", mtime));
  order.push(name);
  activate(name);
  editor.focus();
}

export function activate(name, persist = true) {
  const n = notes.get(name);
  if (!n) return;
  if (active && active !== name && notes.has(active)) views[active] = editor.getView();
  active = name;
  editor.setText(n.text, views[name]);
  emit();
  reportStatus();
  if (persist) saveSession();
  checkExternal(n);
}

export async function open(name) {
  if (!notes.has(name)) {
    const n = await load(name);
    if (!n) return report(`${name} not found`);
    notes.set(name, n);
    order.push(name);
  }
  activate(name);
  editor.focus();
}

/* closes the tab; the file stays unless del (used for empty notes and explicit deletes) */
export async function close(name, del = false) {
  const n = notes.get(name);
  if (!n) return;
  if (del) {
    clearTimeout(n.timer);
    n.closed = true;
    await n.chain;
    await fs.removeNote(name);
    await chrome.storage.local.remove(draftKey(name));
    bc.postMessage({ t: "deleted", name });
  } else if (n.dirty) {
    await save(n);
  }
  if (!notes.has(name)) return; // dropped meanwhile by another page
  const i = order.indexOf(name);
  notes.delete(name);
  order = order.filter((x) => x !== name);
  delete views[name];
  if (!order.length) return create();
  if (active === name) {
    active = null;
    activate(order[Math.min(i, order.length - 1)]);
  } else {
    saveSession();
    emit();
  }
}

/* deletes a note file from the folder, closing its tab if open */
export async function remove(name) {
  if (notes.has(name)) return close(name, true);
  await fs.removeNote(name);
  await chrome.storage.local.remove(draftKey(name));
  bc.postMessage({ t: "deleted", name });
}

/* renames note + file; returns the final file name */
export async function rename(name, wanted) {
  const n = notes.get(name);
  if (!n) return name;
  let target = fs.sanitize(wanted);
  if (target === name) return name;
  if (await fs.exists(target)) target = await fs.freeName(target);

  clearTimeout(n.timer);
  const job = n.chain.then(async () => {
    const text = n.text;
    const mtime = await fs.writeNote(target, text);
    await fs.removeNote(name);
    await chrome.storage.local.remove(draftKey(name));
    renameLocal(name, target);
    n.mtime = mtime;
    n.error = null;
    if (n.text === text) n.dirty = false;
    else {
      chrome.storage.local.set({ [draftKey(target)]: { text: n.text, ts: Date.now() } });
      scheduleSave(n);
    }
    bc.postMessage({ t: "rename", from: name, to: target });
  });
  n.chain = job.catch(() => {});
  await job;
  saveSession();
  emit();
  reportStatus();
  return target;
}

function renameLocal(from, to) {
  const n = notes.get(from);
  if (!n) return;
  notes.delete(from);
  n.name = to;
  notes.set(to, n);
  order = order.map((x) => (x === from ? to : x));
  if (views[from]) views[to] = views[from];
  delete views[from];
  if (active === from) active = to;
  emit();
}

/* moves tab `name` before tab `before` (null = to the end) */
export function move(name, before) {
  if (name === before) return;
  order = order.filter((x) => x !== name);
  const i = before ? order.indexOf(before) : -1;
  if (i < 0) order.push(name);
  else order.splice(i, 0, name);
  saveSession();
  emit();
}

export function firstLine(name) {
  const line = notes.get(name)?.text.split("\n").find((l) => l.trim()) || "";
  return line.trim().slice(0, 100);
}

/* ---------- editing & saving ---------- */

export function onEdit(text) {
  const n = notes.get(active);
  if (!n) return;
  const was = n.dirty;
  n.text = text;
  n.dirty = true;
  chrome.storage.local.set({ [draftKey(n.name)]: { text, ts: Date.now() } });
  bc.postMessage({ t: "text", name: n.name, text });
  scheduleSave(n);
  reportStatus();
  if (!was) emit();
}

export const onView = () => saveSession(600);

function scheduleSave(n) {
  clearTimeout(n.timer);
  n.timer = setTimeout(() => save(n), SAVE_DELAY);
}

function save(n) {
  clearTimeout(n.timer);
  n.timer = 0;
  n.chain = n.chain.then(async () => {
    if (!n.dirty || n.closed) return;
    const { text, name } = n;
    n.saving = true;
    reportStatus();
    try {
      n.mtime = await fs.writeNote(name, text);
      n.error = null;
      bc.postMessage({ t: "saved", name, mtime: n.mtime });
      if (n.text === text && n.name === name) {
        n.dirty = false;
        await chrome.storage.local.remove(draftKey(name));
      }
    } catch (e) {
      n.error = e.message || String(e);
    }
    n.saving = false;
    reportStatus();
    emit();
  });
  return n.chain;
}

export function flushAll() {
  return Promise.all([...notes.values()].map((n) => (n.dirty ? save(n) : n.chain)));
}

function reportStatus() {
  const n = notes.get(active);
  if (!n) return statusFn("", "");
  if (n.error) return statusFn(`save error: ${n.error}`, "err");
  if (n.saving) return statusFn("saving…", "busy");
  if (n.dirty) return statusFn("unsaved", "busy");
  statusFn(n.mtime ? `saved ${fmtTime(n.mtime)}` : "", "ok");
}

/* the file was changed by another program: reload it unless we have unsaved edits */
async function checkExternal(n) {
  if (!n || n.dirty || n.saving) return;
  try {
    if ((await fs.statNote(n.name)) <= n.mtime) return;
    const { text, lastModified } = await fs.readNote(n.name);
    if (n.dirty || !notes.has(n.name)) return;
    n.mtime = lastModified;
    if (text !== n.text) {
      n.text = text;
      if (active === n.name) editor.replaceText(text);
    }
    reportStatus();
  } catch {
    // deleted outside: keep the buffer, the next edit recreates the file
  }
}

/* ---------- session ---------- */

function saveSession(delay = 150) {
  if (!started) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(writeSession, delay);
}

function writeSession() {
  clearTimeout(sessionTimer);
  if (!started) return;
  if (active) views[active] = editor.getView();
  const kept = {};
  for (const name of order) if (views[name]) kept[name] = views[name];
  views = kept;
  chrome.storage.local.set({ session: { tabs: order, active, views, by: pageId } });
}

/* another page changed the open tab list: follow it, keep our own active tab if still open */
async function applySession(s) {
  if (!started || s.by === pageId) return;
  for (const [name, v] of Object.entries(s.views || {})) if (name !== active) views[name] = v;
  const tabs = s.tabs || [];
  if (tabs.join("\n") === order.join("\n")) return;

  for (const name of order) if (!tabs.includes(name)) dropLocal(name, false);
  for (const name of tabs) {
    if (notes.has(name)) continue;
    try {
      const n = await load(name);
      if (n) notes.set(name, n);
    } catch {}
  }
  order = tabs.filter((name) => notes.has(name));
  if (!active && order.length) activate(order[0], false);
  else emit();
}

function dropLocal(name, discard) {
  const n = notes.get(name);
  if (!n) return;
  if (discard) {
    clearTimeout(n.timer);
    n.closed = true;
  } else if (n.dirty) {
    save(n);
  }
  const i = order.indexOf(name);
  notes.delete(name);
  order = order.filter((x) => x !== name);
  if (active === name) {
    active = null;
    const next = order[Math.min(i, order.length - 1)];
    if (next) activate(next, false);
    else editor.setText("", null);
  }
  emit();
}

/* ---------- events ---------- */

bc.onmessage = ({ data: m }) => {
  if (!started) return;
  const n = notes.get(m.name);
  switch (m.t) {
    case "text":
      if (!n) return;
      clearTimeout(n.timer);
      n.text = m.text;
      n.dirty = false; // the sending page saves it
      n.error = null;
      if (active === n.name) editor.replaceText(m.text);
      reportStatus();
      emit();
      break;
    case "saved":
      if (n && !n.dirty) n.mtime = Math.max(n.mtime, m.mtime);
      if (n && active === n.name) reportStatus();
      break;
    case "rename":
      renameLocal(m.from, m.to);
      break;
    case "deleted":
      dropLocal(m.name, true);
      break;
  }
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.session?.newValue) applySession(changes.session.newValue);
});

function leaving() {
  if (!started) return;
  flushAll();
  writeSession();
}

function returning() {
  if (started && active) checkExternal(notes.get(active));
}

document.addEventListener("visibilitychange", () => (document.hidden ? leaving() : returning()));
window.addEventListener("pagehide", leaving);
window.addEventListener("focus", returning);
