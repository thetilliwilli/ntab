/* tracker state and rules: event types, the event log, running activities; saved through store.js */

import * as store from "./store.js";
import * as folder from "../../shared/folder.js";

const bc = new BroadcastChannel("newtab-tracker");
const subs = new Set();
let types = [];
let events = []; // sorted by time
let started = false;

export const getTypes = () => types;
export const activeTypes = () => types.filter((t) => !t.archived);
export const getEvents = () => events;
export const typeById = (id) => types.find((t) => t.id === id);
export const subscribe = (fn) => subs.add(fn);

const emit = () => subs.forEach((fn) => fn());
const uuid = () => crypto.randomUUID();
const insert = (e) => {
  events.push(e);
  events.sort((a, b) => a.time - b.time);
};

export async function start() {
  started = false;
  await store.openDir();
  await reload();
  started = true;
}

async function reload() {
  ({ types, events } = await store.load());
  emit();
}

/* other pages and programs (a sync tool) change the files too */
export const refresh = () => started && reload().catch((e) => console.warn("tracker:", e));
bc.onmessage = ({ data }) => data.dir === folder.getDirId() && refresh();
const announce = () => bc.postMessage({ dir: folder.getDirId() });

/* applies a change to the state, then to the files; a failed write puts the state back and rethrows */
async function change(apply, write) {
  const before = [types, events.slice()];
  apply();
  emit();
  try {
    await write();
    announce();
  } catch (e) {
    [types, events] = before;
    emit();
    throw e;
  }
}

/* ---------- derived ---------- */

const isEnd = (e) => e.phase === "end";
const endOf = (activity) => events.find((e) => e.activity === activity && isEnd(e));

/* [{ start, type }] of activities that are not finished, oldest first */
export const runningSpans = () => events.filter((e) => e.phase === "start" && !endOf(e.activity));
export const isRunning = (typeId) => runningSpans().some((e) => e.type === typeId);

const startOfDay = (time) => new Date(time).setHours(0, 0, 0, 0);

/* how many times and when last the type happened today (an activity counts when it starts) */
export function todayStat(typeId) {
  const from = startOfDay(Date.now());
  let count = 0;
  let last = 0;
  for (const e of events) {
    if (e.type !== typeId || isEnd(e) || e.time < from) continue;
    count++;
    last = e.time;
  }
  return { count, last };
}

export const dayEvents = (day) => events.filter((e) => e.time >= day && e.time < day + 864e5);

/* length of a finished activity, null if it is still running */
export function spanLength(startEvent) {
  const end = endOf(startEvent.activity);
  return end ? end.time - startEvent.time : null;
}

/* ---------- actions ---------- */

/* a one-shot event, or the start of an activity; returns the created event (null if the activity already runs) */
export async function log(typeId) {
  const type = typeById(typeId);
  if (!type || (type.span && isRunning(typeId))) return null;
  const e = { id: uuid(), type: typeId, time: Date.now() };
  if (type.span) Object.assign(e, { activity: uuid(), phase: "start" });
  await change(() => insert(e), () => store.append(e));
  return e;
}

export async function finish(activity) {
  const s = events.find((e) => e.activity === activity && e.phase === "start");
  if (!s || endOf(activity)) return null;
  const e = { id: uuid(), type: s.type, time: Date.now(), activity, phase: "end" };
  await change(() => insert(e), () => store.append(e));
  return e;
}

/* deleting a start takes its end with it; returns what was removed (for undo) */
export async function remove(id) {
  const e = events.find((x) => x.id === id);
  if (!e) return [];
  const gone = e.phase === "start" ? events.filter((x) => x.activity === e.activity) : [e];
  await change(() => (events = events.filter((x) => !gone.includes(x))), () => store.remove(gone));
  return gone;
}

export async function restore(list) {
  await change(() => list.forEach(insert), async () => {
    for (const e of list) await store.append(e);
  });
}

export async function setTime(id, time) {
  const e = events.find((x) => x.id === id);
  if (!e || !Number.isFinite(time)) return;
  const pair = e.activity && events.find((x) => x.activity === e.activity && x !== e);
  if (e.phase === "end" && pair && time < pair.time) throw new Error("an activity can't end before it starts");
  if (e.phase === "start" && pair && time > pair.time) throw new Error("an activity can't start after it ended");
  const moved = { ...e, time };
  await change(
    () => {
      events = events.map((x) => (x === e ? moved : x));
      events.sort((a, b) => a.time - b.time);
    },
    () => store.retime(e, time),
  );
}

export async function saveTypes(next) {
  await change(() => (types = next), () => store.saveTypes(next));
}

/* id of a new type: its name as a slug, unique among the types, archived ones too ("smoked", "smoked-2"…);
   never changes afterwards */
export function newTypeId(name) {
  const base = name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "type";
  let id = base;
  for (let n = 2; typeById(id); n++) id = `${base}-${n}`;
  return id;
}
