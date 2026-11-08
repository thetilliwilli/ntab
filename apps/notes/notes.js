/*
 * open notes, autosave, session and cross-tab sync. a note is { id, name, text, createdAt, updatedAt } in the
 * "notes" store (shared/db.js); tabs, sessions and views are keyed by the note id.
 *
 * every edit:   the note is written SAVE_DELAY after the last keystroke, at most MAX_WAIT after the first unsaved
 *               one, and at once when the page is hidden or closed.
 * other pages:  hear about writes through db.onChange (other devices too, through the sync) and take the new name
 *               and text; a note with unsaved edits here keeps its text (it is written next, the last write wins).
 * session:      each page has its own set of open tabs:
 *                 sessionStorage   this browser tab's own session (survives reload / browser restore)
 *                 device "session" the session of the page worked in last, for brand new tabs
 */

import * as db from "../../shared/db.js";
import * as editor from "./editor.js";
import { fmtTime } from "../../shared/util.js";

const SAVE_DELAY = 300;
const MAX_WAIT = 2000;

const notes = new Map(); // id -> note
let order = []; // ids of the open tabs
let active = null;
let views = {}; // id -> { s, e, top, left }
let started = false;
let sessionTimer = 0;
const listeners = new Set();
let statusFn = () => {};

export const getOrder = () => order;
export const getActive = () => active;
export const getNote = (id) => notes.get(id);
export const isOpen = (id) => notes.has(id);
export const subscribe = (fn) => listeners.add(fn);
export const onStatus = (fn) => (statusFn = fn);
export const report = (msg) => statusFn(msg, "err");

const emit = () => listeners.forEach((fn) => fn());
const record = (n) => ({ id: n.id, name: n.name, text: n.text, createdAt: n.createdAt, updatedAt: n.updatedAt });

function makeNote(rec) {
  // edited: changed since the tab was opened; untouched tabs close without asking for a name
  // created: made here as a new note; only such a note is deleted when closed empty
  return { ...rec, dirty: false, edited: false, created: false, saving: false, closed: false, error: null, timer: 0, due: 0, chain: Promise.resolve() };
}

/* all notes without opening them: [{ id, name, updatedAt, size }] */
export async function list() {
  return (await db.all("notes")).map((n) => ({ id: n.id, name: n.name, updatedAt: n.updatedAt, size: new Blob([n.text]).size }));
}

/* ---------- lifecycle ---------- */

export async function start() {
  const session = ownSession() || (await db.getDevice("session"));
  views = session?.views || {};
  for (const id of session?.tabs || []) {
    const rec = await db.get("notes", id);
    if (!rec) continue;
    const n = makeNote(rec);
    n.edited = !!session.edited?.includes(id);
    n.created = !!session.created?.includes(id);
    notes.set(id, n);
    order.push(id);
  }
  started = true;
  if (order.length) activate(order.includes(session?.active) ? session.active : order[0]);
  else showNothing();
}

/* "new1", or the first number no note has */
async function newName() {
  const taken = new Set((await db.all("notes")).map((n) => n.name));
  for (let i = 1; ; i++) if (!taken.has(`new${i}`)) return `new${i}`;
}

export async function create() {
  const now = Date.now();
  const n = makeNote({ id: db.uuid(), name: await newName(), text: "", createdAt: now, updatedAt: now });
  await db.put("notes", record(n));
  n.created = true;
  notes.set(n.id, n);
  order.push(n.id);
  activate(n.id);
  editor.focus();
}

export function activate(id) {
  const n = notes.get(id);
  if (!n) return;
  if (active && active !== id && notes.has(active)) views[active] = editor.getView();
  active = id;
  editor.setText(n.text, views[id]);
  emit();
  reportStatus();
  saveSession();
}

export async function open(id) {
  if (!notes.has(id)) {
    const rec = await db.get("notes", id);
    if (!rec) return report("this note was deleted");
    notes.set(id, makeNote(rec));
    order.push(id);
  }
  activate(id);
  editor.focus();
}

/* closes the tab; the note stays unless del (used for empty new notes and explicit deletes) */
export async function close(id, del = false) {
  const n = notes.get(id);
  if (!n) return;
  if (del) {
    clearTimeout(n.timer);
    n.closed = true;
    await n.chain;
    await db.remove("notes", id);
  } else if (n.dirty) {
    await save(n);
  }
  detach(id);
}

/* deletes a note, closing its tab if open */
export async function remove(id) {
  if (notes.has(id)) return close(id, true);
  await db.remove("notes", id);
}

/* takes the tab out of this page and shows a neighbour or the empty state */
function detach(id) {
  const n = notes.get(id);
  if (!n) return;
  clearTimeout(n.timer);
  n.closed = true;
  const i = order.indexOf(id);
  notes.delete(id);
  order = order.filter((x) => x !== id);
  delete views[id];
  saveSession();
  if (active !== id) return emit();
  active = null;
  if (order.length) activate(order[Math.min(i, order.length - 1)]);
  else showNothing();
}

/* any string is a name; an empty one keeps the old name */
export async function rename(id, wanted) {
  const n = notes.get(id);
  const name = wanted.trim();
  if (!n || !name || name === n.name) return;
  n.name = name;
  n.dirty = true;
  emit();
  await save(n);
}

/* moves tab `id` before tab `before` (null = to the end) */
export function move(id, before) {
  if (id === before) return;
  order = order.filter((x) => x !== id);
  const i = before ? order.indexOf(before) : -1;
  if (i < 0) order.push(id);
  else order.splice(i, 0, id);
  saveSession();
  emit();
}

export function firstLine(id) {
  const line = notes.get(id)?.text.split("\n").find((l) => l.trim()) || "";
  return line.trim().slice(0, 100);
}

/* ---------- editing & saving ---------- */

export function onEdit(text) {
  const n = notes.get(active);
  if (!n) return;
  const was = n.dirty;
  n.text = text;
  n.dirty = true;
  if (!n.edited) {
    n.edited = true;
    saveSession();
  }
  scheduleSave(n);
  if (!was) {
    reportStatus();
    emit();
  }
}

export const onScroll = () => saveSession(600);

function scheduleSave(n) {
  clearTimeout(n.timer);
  n.due ||= Date.now() + MAX_WAIT; // non-stop typing is still written every MAX_WAIT
  n.timer = setTimeout(() => save(n), Math.min(SAVE_DELAY, n.due - Date.now()));
}

function save(n) {
  clearTimeout(n.timer);
  n.timer = 0;
  n.due = 0;
  n.chain = n.chain.then(async () => {
    if (!n.dirty || n.closed) return;
    const { text, name } = n;
    n.saving = true;
    reportStatus();
    try {
      n.updatedAt = Date.now();
      await db.put("notes", record(n));
      n.error = null;
      if (n.text === text && n.name === name) n.dirty = false;
    } catch (e) {
      n.error = e.message || String(e);
      scheduleSave(n); // try again
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
  statusFn(`saved ${fmtTime(n.updatedAt)}`, "ok");
}

/* ---------- session ---------- */

function ownSession() {
  try {
    return JSON.parse(sessionStorage.getItem("session"));
  } catch {
    return null;
  }
}

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
  for (const id of order) if (views[id]) kept[id] = views[id];
  views = kept;
  const flagged = (flag) => order.filter((id) => notes.get(id)[flag]);
  const session = { tabs: order, active, views, edited: flagged("edited"), created: flagged("created") };
  try {
    sessionStorage.setItem("session", JSON.stringify(session));
  } catch {}
  // only the page in front becomes the template for new tabs
  if (!document.hidden) db.setDevice("session", session).catch(console.error);
}

/* no open tabs: the page shows the empty state instead of the editor */
function showNothing() {
  active = null;
  editor.setText("", null);
  emit();
  reportStatus();
}

/* ---------- events ---------- */

/* another page or another device (the sync) wrote or deleted notes: open ones follow */
db.onChange(async ({ store, ids, local, remote }) => {
  if (!started || (local && !remote) || store !== "notes") return;
  for (const id of ids ?? [...notes.keys()]) {
    const n = notes.get(id);
    if (!n) continue;
    const rec = await db.get("notes", id);
    if (!rec) {
      detach(id);
      continue;
    }
    n.name = rec.name;
    if (!n.dirty && rec.text !== n.text) {
      n.text = rec.text;
      if (active === id) editor.replaceText(rec.text);
    }
    n.updatedAt = Math.max(n.updatedAt, rec.updatedAt);
    if (active === id) reportStatus();
    emit();
  }
});

function leaving() {
  if (!started) return;
  flushAll();
  writeSession();
}

function returning() {
  if (started) saveSession(); // this page is in front now: new tabs should open with its set
}

document.addEventListener("visibilitychange", () => (document.hidden ? leaving() : returning()));
window.addEventListener("pagehide", leaving);
window.addEventListener("focus", returning);
