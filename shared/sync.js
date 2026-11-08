/*
 * the sync with the user's own server (server/ntab-server.mjs). offline first: the data is in this browser
 * (shared/db.js) and works without a server; the server is where devices meet.
 *
 * device "sync" { url, serverId, lastRev, paused, mode }: url "https://TOKEN@host:port" (the token goes as basic auth;
 * fetch takes no credentials in a URL), serverId/lastRev: how far this browser has read that server; mode: what to do
 * on the first connect ("merge" | "replace"). while a url is set, every local change also goes to the outbox (db.js).
 *
 * one page per browser syncs (the Web Lock "ntab-sync"; another page takes over when it closes); the others hear the
 * status on the BroadcastChannel "ntab-sync" and the data through db.onChange as usual. the syncing page:
 *   pull    /pull?since=lastRev, page by page: records newer than the ones here are written (db.applyRemote)
 *   push    the outbox to /push; a change the server has a newer version of is refused: that version is written here
 *   listen  /events (a stream read with fetch): every change on the server -> pull; a local change -> push (300 ms)
 *   a new server (or one whose database was replaced: another serverId): everything from rev 0, then everything here
 *   is sent ("merge"), or this browser's data is dropped first ("replace"). untouched default actions are dropped when
 *   the server has actions.
 * the newer updatedAt wins, always. no network, a stopped server: retried (1 s … 30 s, at once when the network or
 * the page comes back); the changes wait in the outbox meanwhile.
 */

import * as db from "./db.js";
import { SYNCED, DEVICE_IDS } from "./model.js";

const PUSH_DELAY = 300;
const BATCH = 200;
const SILENCE = 70_000; // the server pings every 25 s: this long without a byte = the connection is dead
const NEVER = Number.MAX_SAFE_INTEGER;

/* ---------- status (shared by all pages of this browser) ---------- */

/* state: off (no server) | paused | connecting | online | offline; host; error; at: the last good sync; pending: changes
   waiting in the outbox */
let status = { state: "off", host: "", error: "", at: 0, pending: 0 };
const subs = new Set();
const bc = new BroadcastChannel("ntab-sync");
let leading = false;

export const getStatus = () => status;
export const onStatus = (fn) => subs.add(fn);

function setStatus(patch) {
  status = { ...status, ...patch };
  subs.forEach((fn) => fn(status));
  if (leading) bc.postMessage({ status });
}

bc.onmessage = ({ data }) => {
  if (data.ask && leading) bc.postMessage({ status });
  if (data.status && !leading) {
    status = data.status;
    subs.forEach((fn) => fn(status));
  }
};

/* ---------- the server ---------- */

class SyncError extends Error {}

/* "https://TOKEN@host:8443" (or https://user:TOKEN@…) -> { base, auth, host }; throws with what is wrong */
export function parseUrl(text) {
  let u;
  try {
    u = new URL(String(text).trim());
  } catch {
    throw new SyncError("not an address: https://TOKEN@host:port");
  }
  if (u.protocol !== "https:") throw new SyncError("the address must start with https://");
  const user = decodeURIComponent(u.username);
  const pass = decodeURIComponent(u.password);
  if (!user && !pass) throw new SyncError("the address has no token: https://TOKEN@host:port");
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  return { base: u.origin, host: u.host, auth: `Basic ${btoa(String.fromCharCode(...bytes))}` };
}

async function call(cfg, path, { body, signal } = {}) {
  let res;
  try {
    res = await fetch(cfg.base + path, {
      method: body ? "POST" : "GET",
      headers: { Authorization: cfg.auth, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body && JSON.stringify(body),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new SyncError(`can't reach ${cfg.host} (the network, the server, its certificate or its --origin)`);
  }
  if (res.status === 401) throw new SyncError("the server refused the token");
  if (res.status === 403) throw new SyncError("the server doesn't allow this page (its --origin)");
  if (!res.ok) throw new SyncError(`the server answered ${res.status}: ${(await res.json().catch(() => ({}))).error ?? res.statusText}`);
  return res;
}

const json = async (cfg, path, opts) => (await call(cfg, path, opts)).json();

/* ---------- connecting (from the Data dialog, on any page) ---------- */

/* checks the address and the token. returns { choose: true } when the server has data, this browser has its own and
   mode wasn't given (the user picks "merge" or "replace"), else sets the server and returns {} */
export async function connect(url, mode = null) {
  const cfg = parseUrl(url);
  const info = await json(cfg, `/pull?since=${NEVER}`);
  const was = await db.getDevice("sync");
  const same = was?.serverId === info.serverId; // the same server (maybe at another address): go on where we were
  if (!same && !mode && !info.empty && (await db.hasOwnData())) return { choose: true };
  await db.setDevice("sync", {
    url: String(url).trim(),
    serverId: same ? was.serverId : null,
    lastRev: same ? was.lastRev : 0,
    paused: false,
    mode: same ? null : mode ?? "merge",
  });
  return {};
}

/* stops syncing; the changes made meanwhile wait in the outbox for the next Connect */
export const disconnect = () => db.updateDevice("sync", (s) => s && { ...s, paused: true });

/* ---------- the syncing page ---------- */

let gen = 0; // the running loop's number: a new configuration starts a new one, the old one ends
let cfg = null;
let wake = () => {};
let pushTimer = 0;
let busy = null;
let again = false;
let stream = null; // AbortController of /events

export function startSync() {
  bc.postMessage({ ask: true });
  if (navigator.locks) navigator.locks.request("ntab-sync", lead).catch(console.error);
  else lead();
}

function lead() {
  leading = true;
  db.onChange(({ store, ids, remote }) => {
    if (store === "device") {
      if (!ids || ids.includes(DEVICE_IDS.sync)) configure().catch(console.error);
    } else if (SYNCED.includes(store) && !remote) schedulePush();
  });
  addEventListener("online", () => wake());
  document.addEventListener("visibilitychange", () => !document.hidden && (status.state === "online" ? work() : wake()));
  configure().catch(console.error);
  return new Promise(() => {}); // the lock is held while the page lives
}

async function configure() {
  const s = await db.getDevice("sync");
  const url = s?.url && !s.paused ? s.url : null;
  const pending = await db.outboxSize();
  if (url && cfg?.url === url) return setStatus({ pending });
  gen++;
  stream?.abort();
  wake();
  cfg = null;
  if (!s?.url) return setStatus({ state: "off", host: "", error: "", pending: 0 });
  let host = "";
  try {
    host = parseUrl(s.url).host;
  } catch {}
  if (s.paused) return setStatus({ state: "paused", host, error: "", pending });
  try {
    cfg = { ...parseUrl(url), url };
  } catch (e) {
    return setStatus({ state: "offline", host, error: e.message, pending });
  }
  loop(gen);
}

async function loop(my) {
  let delay = 1000;
  while (my === gen) {
    try {
      setStatus({ state: status.state === "online" ? "online" : "connecting", host: cfg.host });
      await catchUp(my);
      delay = 1000;
      await listen(my);
    } catch (e) {
      if (my !== gen) return;
      setStatus({ state: "offline", error: e instanceof SyncError ? e.message : e.message || String(e), pending: await db.outboxSize() });
      if (!(e instanceof SyncError)) console.warn("sync:", e);
    }
    if (my !== gen) return;
    await new Promise((resolve) => {
      const t = setTimeout(resolve, delay);
      wake = () => (clearTimeout(t), resolve());
    });
    delay = Math.min(delay * 2, 30_000);
  }
}

/* pull, then push; a new server first gets the whole story */
async function catchUp(my) {
  const s = await db.getDevice("sync");
  const first = await json(cfg, `/pull?since=${s.serverId ? s.lastRev : 0}`);
  if (my !== gen) return;
  if (first.serverId !== s.serverId) await firstSync(my, s, first);
  else await pull(my, first, s.lastRev);
  await push(my);
}

/* pages of /pull, from `page` (already fetched) on */
async function pull(my, page, since, onPage = () => {}) {
  for (;;) {
    if (my !== gen) return;
    const rev = page.records.at(-1)?.rev ?? since;
    onPage(page.records);
    await db.applyRemote(page.records, { lastRev: rev });
    if (!page.more) return;
    since = rev;
    page = await json(cfg, `/pull?since=${since}`);
  }
}

async function firstSync(my, s, page) {
  setStatus({ state: "connecting", error: "" });
  if (s.serverId && s.lastRev) page = await json(cfg, "/pull?since=0"); // another server than before: from the start
  if (s.mode === "replace") await db.clearSynced();
  const actions = new Set(); // the server's live actions
  await pull(my, page, 0, (records) => records.forEach((r) => r.store === "actions" && (r.deleted ? actions.delete(r.id) : actions.add(r.id))));
  if (my !== gen) return;
  if (s.mode !== "replace") await db.queueAll(actions.size ? actions : null);
  await db.updateDevice("sync", (now) => now && { ...now, serverId: page.serverId, mode: null });
}

async function push(my) {
  for (;;) {
    if (my !== gen) return;
    const { entries, changes } = await db.outbox(BATCH);
    if (!entries.length) break;
    const res = await json(cfg, "/push", { body: { changes } });
    const newer = res.results.filter((r) => !r.ok).map((r) => r.current);
    if (newer.length) await db.applyRemote(newer);
    await db.sent(entries);
  }
  setStatus({ state: "online", error: "", at: Date.now(), pending: await db.outboxSize() });
}

/* one pull + push at a time; asked again meanwhile = once more after it */
function work() {
  if (!cfg) return;
  if (busy) {
    again = true;
    return;
  }
  const my = gen;
  busy = (async () => {
    do {
      again = false;
      const s = await db.getDevice("sync");
      if (my !== gen || !s?.serverId) return;
      await pull(my, await json(cfg, `/pull?since=${s.lastRev}`), s.lastRev);
      await push(my);
    } while (again && my === gen);
  })()
    .catch(() => stream?.abort()) // the loop sees the stream end and reconnects
    .finally(() => (busy = null));
}

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    if (status.state === "online") work();
    else if (cfg || status.state === "paused") setStatus({ pending: await db.outboxSize() });
  }, PUSH_DELAY);
}

/* the /events stream: every message says the server's head; newer than ours -> pull */
async function listen(my) {
  if (my !== gen) return;
  stream = new AbortController();
  const ctl = stream;
  let silence = setTimeout(() => ctl.abort(), SILENCE);
  try {
    const res = await call(cfg, "/events", { signal: ctl.signal });
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done || my !== gen) throw new SyncError("the server closed the connection");
      clearTimeout(silence);
      silence = setTimeout(() => ctl.abort(), SILENCE);
      buf += value;
      let end;
      while ((end = buf.indexOf("\n\n")) !== -1) {
        const data = buf.slice(0, end).split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("");
        buf = buf.slice(end + 2);
        if (data) work();
      }
    }
  } catch (e) {
    if (ctl.signal.aborted && my === gen) throw new SyncError(`lost the connection to ${cfg?.host}`);
    throw e;
  } finally {
    clearTimeout(silence);
  }
}
