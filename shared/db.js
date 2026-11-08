/*
 * all data lives in one IndexedDB database, "ntab2" (data model 2; the 2.2 database "ntab" is left as it was).
 * the model, the same rules everywhere:
 *   every record of every store has a uuid `id` and `updatedAt` (ms since the epoch, the last change; set here on
 *   every write); display labels are `name`; other times are ms in fields named …At; the order of a list is a numeric
 *   `rank` (fractional: a move changes one record, see rerank in shared/model.js); what sort of thing a record is, is
 *   `kind`.
 *
 * synced stores (shared/sync.js, backups):
 *   notes           { id, name, text, createdAt, updatedAt }
 *                     name: any string ("todo", "todo.md"…), used as the file name when the note is downloaded
 *   trackerTypes    { id, name, icon, kind: "event" | "activity", rank, archivedAt, createdAt, updatedAt }
 *                     icon: one emoji; archivedAt: null = active, a time = archived (no tile, entries stay)
 *   trackerEntries  { id, typeId, at, endAt?, updatedAt }
 *                     an event has no endAt; an activity has endAt: null while it runs, the end time when finished
 *   tasks           { id, name, description, status: "new" | "planned" | "work" | "hold" | "done", rank, createdAt, updatedAt }
 *   actions         { id, name, icon, rank, kind, options, updatedAt }
 *                     icon: an uploaded image (data URL) or null (automatic). kinds and their options:
 *                     "open" { url, newTab }  url "#/<app id>" opens an app, anything else is a web address
 *                     "request" { url, method, headers: { name: value }, body, render }  render: JS function source
 *                       (w => HTML or text; w.document, w.text, w.json), run in the sandboxed shell/render.html;
 *                       missing = "w => w.text"
 *                     the default actions have fixed ids and updatedAt 0 until changed (shared/model.js)
 *   settings        { id, name, value, updatedAt }  one record per setting (fixed ids: SETTING_IDS), name: theme,
 *                     fontSize, wrap, tabSize; a setting without a record has its default (shared/settings.js)
 * this browser only:
 *   device          { id, name, …, updatedAt }  fixed ids (DEVICE_IDS):
 *                     "session" { tabs, active, views, edited, created }  the notes tabs of the page used last
 *                     "backup"  { lastExportAt, remindAt }
 *                     "sync"    { url, serverId, lastRev, paused }  the sync server (shared/sync.js); url has the token
 *   outbox          { id, store, updatedAt, deleted }  a record changed (or deleted) here that the server hasn't got
 *                     yet; kept only while a sync server is set (device "sync" has a url)
 *
 * every write is one transaction. once it is committed, onChange listeners on this page and on every other page
 * of this browser hear { store, ids, local, remote } (ids: null = anything in the store; remote: the change came from
 * the sync server).
 */

import { SYNCED, DEVICE_IDS, defaultActions, nextRank } from "./model.js";

export const STORES = SYNCED;
const NAME = "ntab2";
const VERSION = 1;
const DAY = 864e5;

const bc = new BroadcastChannel("ntab-db");
const listeners = new Set();
let opening = null;
let frozen = false; // the data is being replaced: no more writes, the page reloads

export const uuid = () => crypto.randomUUID();
export const onChange = (fn) => listeners.add(fn);

/* IDBRequest -> Promise */
const req = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

function open() {
  opening ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      for (const name of [...STORES, "device", "outbox"]) r.result.createObjectStore(name, { keyPath: "id" });
      seed(r.transaction);
    };
    r.onsuccess = () => {
      navigator.storage?.persist?.().catch(() => {}); // ask the browser not to evict the data when disk space runs low
      const db = r.result;
      db.onversionchange = () => {
        db.close();
        location.reload(); // a newer version of the app is upgrading the database
      };
      resolve(db);
    };
    r.onerror = () => reject(r.error);
  });
  return opening;
}

/* the first start: the default actions; the first backup reminder comes in a week */
function seed(t) {
  for (const a of defaultActions()) t.objectStore("actions").put(a);
  const now = Date.now();
  t.objectStore("device").put({ id: DEVICE_IDS.backup, name: "backup", lastExportAt: null, remindAt: now + 7 * DAY, updatedAt: now });
}

/* runs fn({ <store name>: IDBObjectStore }) in one transaction; resolves with fn's result once it is committed.
   fn may await requests (wrapped with req) but nothing else, or the transaction closes under it */
async function run(names, mode, fn) {
  if (frozen) return new Promise(() => {});
  names = [...new Set([names].flat())];
  const t = (await open()).transaction(names, mode);
  const done = new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onabort = t.onerror = () => reject(t.error || new Error("the transaction was aborted"));
  });
  let result;
  try {
    result = await fn(Object.fromEntries(names.map((n) => [n, t.objectStore(n)])));
  } catch (e) {
    done.catch(() => {}); // the abort below rejects it; fn's error is the one to report
    try {
      t.abort();
    } catch {}
    throw e;
  }
  try {
    t.commit();
  } catch {} // already committed by itself
  await done;
  return result;
}

/* a write transaction over `store`; fn gets w = { s: stores, put(record), del(id) }: changes of synced stores are
   also written to the outbox (in the same transaction) while a sync server is set */
async function write(store, fn) {
  const synced = STORES.includes(store);
  return run(synced ? [store, "device", "outbox"] : [store], "readwrite", async (s) => {
    const track = synced && !!(await req(s.device.get(DEVICE_IDS.sync)))?.url;
    const w = {
      s,
      put(r) {
        s[store].put(r);
        if (track) s.outbox.put({ id: r.id, store, updatedAt: r.updatedAt, deleted: false });
      },
      del(id, at) {
        s[store].delete(id);
        if (track) s.outbox.put({ id, store, updatedAt: at, deleted: true });
      },
    };
    return fn(w, s[store]);
  });
}

function changed(store, ids, remote = false) {
  bc.postMessage({ store, ids, remote });
  for (const fn of listeners) fn({ store, ids, local: true, remote });
}

bc.onmessage = ({ data }) => {
  if (data.reset) {
    frozen = true; // unsaved edits of this page must not land in the replaced data
    return location.reload();
  }
  for (const fn of listeners) fn({ ...data, local: false });
};

const stamp = (r, now) => ({ ...r, updatedAt: now });
/* the same record but for when it was changed */
const same = (a, b) => !!a && !!b && JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 });

/* ---------- reading ---------- */

export const get = (store, id) => run(store, "readonly", (s) => req(s[store].get(id)));
export const all = (store) => run(store, "readonly", (s) => req(s[store].getAll()));
export const count = (store) => run(store, "readonly", (s) => req(s[store].count()));

/* ---------- writing (every record written gets updatedAt = now) ---------- */

export async function put(store, records) {
  const now = Date.now();
  const list = [records].flat().map((r) => stamp(r, now));
  await write(store, (w) => list.forEach((r) => w.put(r)));
  changed(store, list.map((r) => r.id));
  return list;
}

export async function remove(store, ids) {
  const list = [ids].flat();
  const now = Date.now();
  await write(store, (w) => list.forEach((id) => w.del(id, now)));
  changed(store, list);
}

/* read-modify-write of one record: fn(record or undefined) returns the new record, or undefined for no change */
export async function update(store, id, fn) {
  const out = await write(store, async (w, s) => {
    const next = fn(await req(s.get(id)));
    if (!next) return next;
    const r = stamp(next, Date.now());
    w.put(r);
    return r;
  });
  if (out) changed(store, [id]);
  return out;
}

/* read-modify-write of a whole store: fn(all records) returns the records to put */
export async function change(store, fn) {
  const out = await write(store, async (w, s) => {
    const now = Date.now();
    const next = fn(await req(s.getAll())).map((r) => stamp(r, now));
    next.forEach((r) => w.put(r));
    return next;
  });
  if (out.length) changed(store, out.map((r) => r.id));
}

/* the store gets exactly these records: the changed and new ones are written, the missing ones deleted (records
   that are the same keep their updatedAt) */
export async function replace(store, records) {
  const ids = await write(store, async (w, s) => {
    const now = Date.now();
    const have = new Map((await req(s.getAll())).map((r) => [r.id, r]));
    const touched = [];
    for (const r of records) {
      if (!same(have.get(r.id), r)) {
        w.put(stamp(r, now));
        touched.push(r.id);
      }
      have.delete(r.id);
    }
    for (const id of have.keys()) {
      w.del(id, now);
      touched.push(id);
    }
    return touched;
  });
  if (ids.length) changed(store, ids);
}

/* ---------- this device: the "device" store by name ---------- */

export const getDevice = (name) => get("device", DEVICE_IDS[name]);

/* writes the record `name` with these fields (the others go) */
export async function setDevice(name, fields) {
  await put("device", { ...fields, id: DEVICE_IDS[name], name });
}

/* read-modify-write: fn(the record's fields or undefined) returns the new fields, or undefined for no change */
export const updateDevice = (name, fn) =>
  update("device", DEVICE_IDS[name], (r) => {
    const next = fn(r);
    return next && { ...next, id: DEVICE_IDS[name], name };
  });

/* ---------- everything at once (backups) ---------- */

/* { <store>: [records] } of the synced stores */
export const dump = () =>
  run(STORES, "readonly", async (s) => {
    const out = {};
    for (const name of STORES) out[name] = await req(s[name].getAll());
    return out;
  });

/* adds the records of `data` (the shape dump() returns) that this browser doesn't have (by id); a record that exists
   here stays as it is, except untouched default actions (updatedAt 0): they give way (when the backup has actions,
   the ones it doesn't have go). added records of ranked stores go after the ones here, in their order. the records
   keep their updatedAt. returns { <store>: { added, kept } } */
export async function merge(data) {
  const out = {};
  const touched = {};
  await run([...STORES, "device", "outbox"], "readwrite", async (s) => {
    const track = !!(await req(s.device.get(DEVICE_IDS.sync)))?.url;
    const now = Date.now();
    for (const name of STORES) {
      const incoming = data[name] ?? [];
      const have = new Map((await req(s[name].getAll())).map((r) => [r.id, r]));
      touched[name] = [];
      if (name === "actions" && incoming.length)
        for (const r of [...have.values()])
          if (r.updatedAt === 0) {
            have.delete(r.id);
            s[name].delete(r.id);
            if (track) s.outbox.put({ id: r.id, store: name, updatedAt: now, deleted: true });
            touched[name].push(r.id);
          }
      const fresh = incoming.filter((r) => !have.has(r.id)).map((r) => ({ ...r }));
      if (fresh.some((r) => "rank" in r)) {
        const top = nextRank([...have.values()]);
        fresh.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)).forEach((r, i) => (r.rank = top + i));
      }
      for (const r of fresh) {
        s[name].put(r);
        if (track) s.outbox.put({ id: r.id, store: name, updatedAt: r.updatedAt, deleted: false });
        touched[name].push(r.id);
      }
      out[name] = { added: fresh.length, kept: incoming.length - fresh.length };
    }
  });
  for (const name of STORES) if (touched[name].length) changed(name, touched[name]);
  return out;
}

/* deletes everything of NTab in this browser (the databases of 2.2 and now, the cached theme), then reloads: a fresh
   start with the default actions. the sync server keeps its data. other pages reload too (a deleted database also
   closes their connections: onversionchange) */
export async function wipe() {
  frozen = true;
  bc.postMessage({ reset: true });
  if (opening) (await opening.catch(() => null))?.close();
  for (const name of [NAME, "ntab"])
    await new Promise((resolve) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = r.onerror = r.onblocked = resolve; // blocked: it completes once the other pages have closed theirs
    });
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {}
  location.reload();
}

/* ---------- for the sync (shared/sync.js) ---------- */

/* records from the server [{ store, id, updatedAt, deleted, data }]: each one that is newer than the one here (and
   than a change of it waiting in the outbox) is written or deleted; a waiting change that is older is dropped.
   sync: fields to write into device "sync" in the same transaction (lastRev…). returns how many records changed */
export async function applyRemote(records, sync = null) {
  const stores = [...new Set(records.map((r) => r.store))].filter((n) => STORES.includes(n));
  const touched = {};
  await run([...stores, "device", "outbox"], "readwrite", async (s) => {
    for (const r of records) {
      if (!stores.includes(r.store)) continue; // a store of a newer version: not known here
      const here = await req(s[r.store].get(r.id));
      const waiting = await req(s.outbox.get(r.id));
      if (waiting && waiting.updatedAt > r.updatedAt) continue; // ours is newer: it goes to the server next
      if (waiting) s.outbox.delete(r.id);
      if (here ? here.updatedAt >= r.updatedAt : r.deleted) continue; // not newer, or deleted here already
      if (r.deleted) s[r.store].delete(r.id);
      else s[r.store].put(r.data);
      (touched[r.store] ??= []).push(r.id);
    }
    if (sync) {
      const was = await req(s.device.get(DEVICE_IDS.sync));
      if (was) s.device.put({ ...was, ...sync });
    }
  });
  for (const [store, ids] of Object.entries(touched)) changed(store, ids, true);
  return Object.values(touched).reduce((n, ids) => n + ids.length, 0);
}

/* waiting changes, up to `limit` of them and about maxBytes of JSON (at least one):
   { entries (outbox records), changes: [{ store, id, updatedAt, deleted, data }] } */
export const outbox = (limit = 200, maxBytes = 8e6) =>
  run([...STORES, "outbox"], "readonly", async (s) => {
    const entries = [];
    const changes = [];
    let bytes = 0;
    for (const e of await req(s.outbox.getAll(null, limit))) {
      const data = e.deleted ? null : await req(s[e.store].get(e.id));
      const size = data ? JSON.stringify(data).length : 0;
      if (entries.length && bytes + size > maxBytes) break;
      bytes += size;
      entries.push(e);
      if (data) changes.push({ store: e.store, id: e.id, updatedAt: data.updatedAt, deleted: false, data });
      else changes.push({ store: e.store, id: e.id, updatedAt: e.updatedAt, deleted: true, data: null });
    }
    return { entries, changes };
  });

/* the server has these: they leave the outbox, unless they changed again meanwhile */
export const sent = (entries) =>
  run("outbox", "readwrite", async (s) => {
    for (const e of entries) {
      const now = await req(s.outbox.get(e.id));
      if (now && now.updatedAt === e.updatedAt && now.deleted === e.deleted) s.outbox.delete(e.id);
    }
  });

export const outboxSize = () => count("outbox");

/* a new server: every record here waits for it. serverActions: the ids of the server's actions, when it has some:
   then the untouched default actions it doesn't have are dropped here instead */
export async function queueAll(serverActions = null) {
  const dropped = [];
  await run([...STORES, "outbox"], "readwrite", async (s) => {
    s.outbox.clear();
    for (const name of STORES)
      for (const r of await req(s[name].getAll())) {
        if (serverActions && name === "actions" && r.updatedAt === 0 && !serverActions.has(r.id)) {
          s[name].delete(r.id);
          dropped.push(r.id);
        } else s.outbox.put({ id: r.id, store: name, updatedAt: r.updatedAt, deleted: false });
      }
  });
  if (dropped.length) changed("actions", dropped, true);
}

/* "replace this device": the synced stores and the outbox are emptied (the server's data comes next) */
export async function clearSynced() {
  await run([...STORES, "outbox"], "readwrite", (s) => Object.values(s).forEach((store) => store.clear()));
  for (const name of STORES) changed(name, null, true);
}

/* whether this browser has data of its own (anything but untouched default actions) */
export const hasOwnData = () =>
  run(STORES, "readonly", async (s) => {
    for (const name of STORES) {
      const list = await req(s[name].getAll());
      if (list.some((r) => !(name === "actions" && r.updatedAt === 0))) return true;
    }
    return false;
  });
