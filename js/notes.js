/*
 * open notes, autosave, session and cross-tab sync.
 *
 * every edit:  file write SAVE_DELAY after the last keystroke, at most MAX_WAIT after the first unsaved one.
 * drafts:      draft:<folder id>:<name> in storage.local holds text that hasn't reached the file yet. it is written
 *              when the page is hidden or closed with unsaved edits and when a file write fails, and removed after
 *              the next successful write. a draft newer than its file wins on load; on start, old drafts are written
 *              into their files.
 *
 * other new-tab pages:  saved content, renames and deletes via BroadcastChannel (same folder only).
 *                       each page has its own set of open tabs (session):
 *                         sessionStorage  this browser tab's own session (survives reload / browser restore)
 *                         storage.local   session of the page worked in last, for brand new tabs
 */

import * as fs from "./fs.js";
import * as editor from "./editor.js";
import { fmtTime, extensionAlive } from "./util.js";

const SAVE_DELAY = 300;
const MAX_WAIT = 2000;
const OLD_DRAFT = 60_000; // younger drafts may belong to a page that is still open
const bc = new BroadcastChannel("newtab-notes");
const draftKey = (name) => `draft:${fs.getDirId()}:${name}`;
const post = (m) => bc.postMessage({ ...m, dir: fs.getDirId() });

/* storage.local that turns into a no-op on a stale page and logs failures (quota) instead of throwing */
const warn = (e) => console.warn("storage.local:", e?.message || e);
const local = {
  get: (key) => (extensionAlive() ? chrome.storage.local.get(key).catch((e) => (warn(e), {})) : Promise.resolve({})),
  set: (items) => (extensionAlive() ? chrome.storage.local.set(items).catch(warn) : Promise.resolve()),
  remove: (keys) => (extensionAlive() ? chrome.storage.local.remove(keys).catch(warn) : Promise.resolve()),
};

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
  // edited: changed since the tab was opened; untouched tabs close without asking for a name
  // created: made here as newN.txt; only such a note is deleted when closed empty
  return {
    name, text, mtime,
    dirty: false, edited: false, created: false, drafted: false, saving: false, closed: false,
    error: null, timer: 0, due: 0, chain: Promise.resolve(),
  };
}

async function readFile(name) {
  try {
    return await fs.readNote(name);
  } catch (e) {
    if (e.name === "NotFoundError") return null;
    throw e;
  }
}

async function load(name) {
  const file = await readFile(name);
  const draft = (await local.get(draftKey(name)))[draftKey(name)];
  if (draft && (!file || draft.ts > file.lastModified) && draft.text !== file?.text) {
    const n = makeNote(name, draft.text, file?.lastModified || 0);
    n.dirty = n.edited = n.drafted = true;
    scheduleSave(n);
    return n;
  }
  if (draft) local.remove(draftKey(name));
  return file && makeNote(name, file.text, file.lastModified);
}

/* drafts left behind (page closed while the folder was unwritable, …): put their text into the files */
async function rescueDrafts() {
  const prefix = draftKey("");
  for (const [key, draft] of Object.entries(await local.get(null))) {
    if (!key.startsWith(prefix) || Date.now() - draft.ts < OLD_DRAFT) continue;
    const name = key.slice(prefix.length);
    try {
      const file = await readFile(name);
      if (!file || (draft.ts > file.lastModified && draft.text !== file.text)) await fs.writeNote(name, draft.text);
      await local.remove(key);
    } catch (e) {
      console.warn("cannot restore draft of", name, e);
    }
  }
}

/* ---------- lifecycle ---------- */

export async function start({ fresh = false } = {}) {
  for (const n of notes.values()) clearTimeout(n.timer);
  notes.clear();
  order = [];
  active = null;
  started = false;

  if (fresh) {
    try {
      sessionStorage.removeItem("session");
    } catch {}
  }
  await rescueDrafts();
  const session = fresh ? null : ownSession() || (await local.get("session")).session;
  views = session?.views || {};
  for (const name of session?.tabs || []) {
    try {
      const n = await load(name);
      if (n) {
        if (session.edited?.includes(name)) n.edited = true;
        if (session.created?.includes(name)) n.created = true;
        notes.set(name, n);
        order.push(name);
      }
    } catch (e) {
      console.warn("cannot load", name, e);
    }
  }
  started = true;
  if (order.length) activate(order.includes(session?.active) ? session.active : order[0]);
  else showNothing();
}

export async function create() {
  const name = await fs.nextNewName(new Set(order));
  const n = makeNote(name, "", await fs.writeNote(name, ""));
  n.created = true;
  notes.set(name, n);
  order.push(name);
  activate(name);
  editor.focus();
}

export function activate(name) {
  const n = notes.get(name);
  if (!n) return;
  if (active && active !== name && notes.has(active)) views[active] = editor.getView();
  active = name;
  editor.setText(n.text, views[name]);
  emit();
  reportStatus();
  saveSession();
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

/* closes the tab; the file stays unless del (used for empty new notes and explicit deletes) */
export async function close(name, del = false) {
  const n = notes.get(name);
  if (!n) return;
  if (del) {
    clearTimeout(n.timer);
    n.closed = true;
    await n.chain;
    await deleteFile(name);
  } else if (n.dirty) {
    await save(n);
  }
  detach(name);
}

/* deletes a note file from the folder, closing its tab if open */
export async function remove(name) {
  if (notes.has(name)) return close(name, true);
  await deleteFile(name);
}

async function deleteFile(name) {
  await fs.removeNote(name);
  await local.remove(draftKey(name));
  post({ t: "deleted", name });
}

/* takes the tab out of this page and shows a neighbour or the empty state */
function detach(name) {
  const n = notes.get(name);
  if (!n) return;
  clearTimeout(n.timer);
  n.closed = true;
  const i = order.indexOf(name);
  notes.delete(name);
  order = order.filter((x) => x !== name);
  delete views[name];
  saveSession();
  if (active !== name) return emit();
  active = null;
  if (order.length) activate(order[Math.min(i, order.length - 1)]);
  else showNothing();
}

/* renames note + file; returns the final file name */
export async function rename(name, wanted) {
  const n = notes.get(name);
  if (!n) return name;
  let target = fs.sanitize(wanted);
  if (target === name) return name;
  target = await fs.freeName(target);

  clearTimeout(n.timer);
  const job = n.chain.then(async () => {
    const text = n.text;
    const mtime = await fs.writeNote(target, text);
    await fs.removeNote(name);
    await local.remove(draftKey(name));
    n.drafted = false;
    renameLocal(name, target);
    n.mtime = mtime;
    n.error = null;
    if (n.text === text) n.dirty = false;
    else scheduleSave(n);
    post({ t: "rename", from: name, to: target });
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
  if (!n.edited) {
    n.edited = true;
    saveSession();
  }
  scheduleSave(n);
  if (!was) {
    reportStatus();
    emit();
  }
  if (!extensionAlive()) recoverStale();
}

export const onScroll = () => saveSession(600);

function scheduleSave(n) {
  clearTimeout(n.timer);
  n.due ||= Date.now() + MAX_WAIT; // non-stop typing still reaches the file every MAX_WAIT
  n.timer = setTimeout(() => save(n), Math.min(SAVE_DELAY, n.due - Date.now()));
}

function writeDraft(n) {
  n.drafted = true;
  local.set({ [draftKey(n.name)]: { text: n.text, ts: Date.now() } });
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
      n.mtime = await fs.writeNote(name, text);
      n.error = null;
      post({ t: "saved", name, mtime: n.mtime, text });
      if (n.text === text && n.name === name) {
        n.dirty = false;
        if (n.drafted) {
          n.drafted = false;
          await local.remove(draftKey(name));
        }
      }
    } catch (e) {
      n.error = e.message || String(e);
      writeDraft(n);
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
  for (const name of order) if (views[name]) kept[name] = views[name];
  views = kept;
  const flagged = (flag) => order.filter((name) => notes.get(name)[flag]);
  const session = { tabs: order, active, views, edited: flagged("edited"), created: flagged("created") };
  try {
    sessionStorage.setItem("session", JSON.stringify(session));
  } catch {}
  // only the page in front becomes the template for new tabs
  if (!document.hidden) local.set({ session });
}

/* no open tabs: the page shows the empty state instead of the editor */
function showNothing() {
  active = null;
  editor.setText("", null);
  emit();
  reportStatus();
}

/* ---------- events ---------- */

bc.onmessage = ({ data: m }) => {
  if (!started || m.dir !== fs.getDirId()) return;
  const n = notes.get(m.name);
  switch (m.t) {
    case "saved":
      if (!n || n.dirty) return; // our own unsaved edits win, they are saved next
      n.mtime = Math.max(n.mtime, m.mtime);
      n.error = null;
      if (m.text !== n.text) {
        n.text = m.text;
        if (active === n.name) editor.replaceText(m.text);
      }
      if (active === n.name) reportStatus();
      break;
    case "rename":
      renameLocal(m.from, m.to);
      saveSession();
      break;
    case "deleted":
      detach(m.name);
      break;
  }
};

function leaving() {
  if (!started) return;
  // the file write below may not finish before the page is gone; the draft (one IPC message) does
  for (const n of notes.values()) if (n.dirty) writeDraft(n);
  flushAll();
  writeSession();
}

function returning() {
  if (!extensionAlive()) return recoverStale();
  if (!started) return;
  saveSession(); // this page is in front now: new tabs should open with its set
  if (active) checkExternal(notes.get(active));
}

/* the extension was reloaded under this page: write everything to the files, then load the new version */
let recovering = false;

async function recoverStale() {
  if (recovering) return;
  recovering = true;
  await flushAll();
  if ([...notes.values()].some((n) => n.dirty || n.error)) {
    return statusFn("extension was reloaded and saving failed — copy your text, then reload this tab", "err");
  }
  location.reload();
}

document.addEventListener("visibilitychange", () => (document.hidden ? leaving() : returning()));
window.addEventListener("pagehide", leaving);
window.addEventListener("focus", returning);
