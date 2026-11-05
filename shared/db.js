/*
 * all data lives in one IndexedDB database, "ntab". the model, the same rules everywhere:
 *   every record has a random uuid `id`; display labels are `name`; times are ms since the epoch in fields named
 *   …At; the order of a list is a numeric `rank`; what sort of thing a record is, is `kind`.
 *
 *   notes           { id, name, text, createdAt, updatedAt }
 *                     name: any string ("todo", "todo.md"…), used as the file name when the note is downloaded
 *   trackerTypes    { id, name, icon, kind: "event" | "activity", rank, archivedAt, createdAt, updatedAt }
 *                     icon: one emoji; archivedAt: null = active, a time = archived (no tile, entries stay)
 *   trackerEntries  { id, typeId, at, endAt? }
 *                     an event has no endAt; an activity has endAt: null while it runs, the end time when finished
 *   tasks           { id, name, description, status: "new" | "planned" | "work" | "hold" | "done", rank, createdAt, updatedAt }
 *   actions         { id, name, icon, rank, kind, options }
 *                     icon: an uploaded image (data URL) or null (automatic). kinds and their options:
 *                     "open" { url, newTab }  url "#/<app id>" opens an app, anything else is a web address
 *                     "request" { url, method, headers: { name: value }, body, render }  render: JS function source
 *                       (w => HTML or text; w.document, w.text, w.json), run in the sandboxed shell/render.html;
 *                       missing = "w => w.text"
 *   meta            key -> value (not exported, except settings):
 *                     settings { theme, fontSize, wrap, tabSize }
 *                     session  { tabs, active, views, edited, created }  the notes tabs of the page used last
 *                     backup   { lastExportAt, remindAt }
 *
 * every write is one transaction. once it is committed, onChange listeners on this page and on every other page
 * of this browser hear { store, ids, local } (ids: null = anything in the store).
 */

export const STORES = ["notes", "trackerTypes", "trackerEntries", "tasks", "actions"];
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
    const r = indexedDB.open("ntab", VERSION);
    r.onupgradeneeded = () => {
      for (const name of STORES) r.result.createObjectStore(name, { keyPath: "id" });
      r.result.createObjectStore("meta");
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
  const apps = [["Notes", "#/notes"], ["Tracker", "#/tracker"], ["Board", "#/board"]];
  const sites = [["Gmail", "https://mail.google.com"], ["YouTube", "https://www.youtube.com"]];
  [...apps, ...sites].forEach(([name, url], rank) =>
    t.objectStore("actions").put({ id: uuid(), name, icon: null, rank, kind: "open", options: { url, newTab: false } }),
  );
  t.objectStore("meta").put({ lastExportAt: null, remindAt: Date.now() + 7 * DAY }, "backup");
}

/* runs fn({ <store name>: IDBObjectStore }) in one transaction; resolves with fn's result once it is committed.
   fn may await requests (wrapped with req) but nothing else, or the transaction closes under it */
async function run(names, mode, fn) {
  if (frozen) return new Promise(() => {});
  const t = (await open()).transaction(names, mode);
  const done = new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onabort = t.onerror = () => reject(t.error || new Error("the transaction was aborted"));
  });
  let result;
  try {
    result = await fn(Object.fromEntries([names].flat().map((n) => [n, t.objectStore(n)])));
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

function changed(store, ids) {
  bc.postMessage({ store, ids });
  for (const fn of listeners) fn({ store, ids, local: true });
}

bc.onmessage = ({ data }) => {
  if (data.reset) {
    frozen = true; // unsaved edits of this page must not land in the replaced data
    return location.reload();
  }
  for (const fn of listeners) fn({ ...data, local: false });
};

/* ---------- reading ---------- */

export const get = (store, id) => run(store, "readonly", (s) => req(s[store].get(id)));
export const all = (store) => run(store, "readonly", (s) => req(s[store].getAll()));
export const count = (store) => run(store, "readonly", (s) => req(s[store].count()));
export const getMeta = (key) => run("meta", "readonly", (s) => req(s.meta.get(key)));

/* ---------- writing ---------- */

export async function put(store, records) {
  const list = [records].flat();
  await run(store, "readwrite", (s) => list.forEach((r) => s[store].put(r)));
  changed(store, list.map((r) => r.id));
}

export async function remove(store, ids) {
  const list = [ids].flat();
  await run(store, "readwrite", (s) => list.forEach((id) => s[store].delete(id)));
  changed(store, list);
}

/* read-modify-write of one record: fn(record or undefined) returns the new record, or undefined for no change */
export async function update(store, id, fn) {
  const out = await run(store, "readwrite", async (s) => {
    const next = fn(await req(s[store].get(id)));
    if (next) s[store].put(next);
    return next;
  });
  if (out) changed(store, [id]);
  return out;
}

/* read-modify-write of a whole store: fn(all records) returns the records to put */
export async function change(store, fn) {
  const out = await run(store, "readwrite", async (s) => {
    const next = fn(await req(s[store].getAll()));
    next.forEach((r) => s[store].put(r));
    return next;
  });
  if (out.length) changed(store, out.map((r) => r.id));
}

/* the store gets exactly these records */
export async function replace(store, records) {
  await run(store, "readwrite", (s) => {
    s[store].clear();
    records.forEach((r) => s[store].put(r));
  });
  changed(store, null);
}

export async function setMeta(key, value) {
  await run("meta", "readwrite", (s) => s.meta.put(value, key));
  changed("meta", [key]);
}

/* ---------- everything at once (backups) ---------- */

/* { settings, <store>: [records] } */
export const dump = () =>
  run([...STORES, "meta"], "readonly", async (s) => {
    const out = { settings: (await req(s.meta.get("settings"))) ?? {} };
    for (const name of STORES) out[name] = await req(s[name].getAll());
    return out;
  });

/* adds the records of `data` (the shape dump() returns) that this browser doesn't have (by id); nothing is deleted or
   changed, a record that exists here stays as it is (settings too). added records of ranked stores go after the
   ones here, in their order. returns { <store>: { added, kept } } */
export async function merge(data) {
  const out = {};
  const added = {};
  await run(STORES, "readwrite", async (s) => {
    for (const name of STORES) {
      const have = new Set(await req(s[name].getAllKeys()));
      const fresh = data[name].filter((r) => !have.has(r.id));
      if (fresh.length && fresh.some((r) => "rank" in r)) {
        const top = Math.max(-1, ...(await req(s[name].getAll())).map((r) => r.rank ?? -1));
        fresh.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)).forEach((r, i) => (r.rank = top + 1 + i));
      }
      fresh.forEach((r) => s[name].put(r));
      out[name] = { added: fresh.length, kept: data[name].length - fresh.length };
      added[name] = fresh.map((r) => r.id);
    }
  });
  for (const name of STORES) if (added[name].length) changed(name, added[name]);
  return out;
}

/* deletes everything of NTab in this browser (the database, the cached theme), then reloads: a fresh start with the
   default actions. other pages reload too (a deleted database also closes their connections: onversionchange) */
export async function wipe() {
  frozen = true;
  bc.postMessage({ reset: true });
  if (opening) (await opening.catch(() => null))?.close();
  await new Promise((resolve) => {
    const r = indexedDB.deleteDatabase("ntab");
    r.onsuccess = r.onerror = r.onblocked = resolve; // blocked: it completes once the other pages have closed theirs
  });
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {}
  location.reload();
}
