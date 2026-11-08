/* tracker state and rules over the stores "trackerTypes" and "trackerEntries" (see shared/db.js). the state is
   read again whenever they change, here or on another page */

import * as db from "../../shared/db.js";
import { rerank, nextRank } from "../../shared/model.js";

const subs = new Set();
let types = []; // by rank
let entries = []; // by start time
let started = false;

export const getTypes = () => types;
export const activeTypes = () => types.filter((t) => t.archivedAt == null);
export const typeById = (id) => types.find((t) => t.id === id);
export const subscribe = (fn) => subs.add(fn);

const emit = () => subs.forEach((fn) => fn());

export async function start() {
  await reload();
  started = true;
}

async function reload() {
  const [t, e] = await Promise.all([db.all("trackerTypes"), db.all("trackerEntries")]);
  types = t.sort((a, b) => a.rank - b.rank);
  entries = e.sort((a, b) => a.at - b.at);
  emit();
}

db.onChange(({ store }) => started && (store === "trackerTypes" || store === "trackerEntries") && reload().catch(console.error));

/* ---------- derived ---------- */

/* activities that run now, oldest first */
export const entryCount = () => entries.length;
export const running = () => entries.filter((e) => e.endAt === null);
export const isRunning = (typeId) => entries.some((e) => e.typeId === typeId && e.endAt === null);

const startOfDay = (time) => new Date(time).setHours(0, 0, 0, 0);

/* how many times and when last the type happened today (an activity counts when it starts) */
export function todayStat(typeId) {
  const from = startOfDay(Date.now());
  let count = 0;
  let last = 0;
  for (const e of entries) {
    if (e.typeId !== typeId || e.at < from) continue;
    count++;
    last = e.at;
  }
  return { count, last };
}

/* entries that started on the day that begins at `day` */
export const dayEntries = (day) => entries.filter((e) => e.at >= day && e.at < day + 864e5);

/* ---------- changes ---------- */

/* an event, or a running activity; returns the entry (null if that activity runs already) */
export async function log(typeId) {
  const type = typeById(typeId);
  if (!type || (type.kind === "activity" && isRunning(typeId))) return null;
  const e = { id: db.uuid(), typeId, at: Date.now() };
  if (type.kind === "activity") e.endAt = null;
  await db.put("trackerEntries", e);
  return e;
}

/* finishes a running activity now; returns the entry */
export const finish = (id) => db.update("trackerEntries", id, (e) => (e?.endAt === null ? { ...e, endAt: Date.now() } : undefined));

/* undoes finish(): the activity runs again */
export const resume = (id) => db.update("trackerEntries", id, (e) => (e?.endAt != null ? { ...e, endAt: null } : undefined));

/* deletes an entry; returns it (for undo) */
export async function remove(id) {
  const e = entries.find((x) => x.id === id);
  if (e) await db.remove("trackerEntries", id);
  return e ?? null;
}

export const restore = (entry) => db.put("trackerEntries", entry);

/* deletes every entry (the types stay); returns them (for undo: restore(list)) */
export async function clearEntries() {
  const gone = entries;
  await db.replace("trackerEntries", []);
  return gone;
}

/* changes when an entry started (field "at") or ended ("endAt") */
export function setTime(id, field, time) {
  if (!Number.isFinite(time)) return Promise.resolve();
  return db.update("trackerEntries", id, (e) => {
    if (!e) return undefined;
    const next = { ...e, [field]: time };
    if (next.endAt != null && next.endAt < next.at) throw new Error("an activity can't end before it starts");
    return next;
  });
}

/* ---------- types ---------- */

export function addType({ name, icon, kind }) {
  const now = Date.now();
  return db.put("trackerTypes", { id: db.uuid(), name, icon, kind, rank: nextRank(types), archivedAt: null, createdAt: now, updatedAt: now });
}

/* the edited list, in its order: ranks follow it (a moved type gets a rank between its neighbours); only the types
   that changed are written */
export function saveTypes(list) {
  const same = (a, b) => JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 });
  const out = rerank(list).filter((t) => !same(t, typeById(t.id)));
  return out.length ? db.put("trackerTypes", out) : Promise.resolve([]);
}
