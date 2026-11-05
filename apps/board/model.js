/* the board over the "tasks" store (see shared/db.js): status is one of STATUSES, rank orders the cards (inside a
   column and across columns, so a moved card keeps its place). the state is read again whenever the store
   changes, here or on another page; a move is one transaction over the store as it is at that moment */

import * as db from "../../shared/db.js";

export const STATUSES = ["new", "planned", "work", "hold", "done"];
export const STATUS_NAMES = { new: "New", planned: "Planned", work: "Work", hold: "Hold", done: "Done" };

const subs = new Set();
let tasks = []; // by rank
let started = false;

export const getTasks = () => tasks;
export const inColumn = (status) => tasks.filter((t) => t.status === status);
export const subscribe = (fn) => subs.add(fn);
const emit = () => subs.forEach((fn) => fn());

const byRank = (a, b) => a.rank - b.rank;

async function reload() {
  tasks = (await db.all("tasks")).sort(byRank);
  emit();
}

export async function start() {
  await reload();
  started = true;
}

db.onChange(({ store }) => started && store === "tasks" && reload().catch(console.error));

export function add({ name, description = "", status = "new" }) {
  const now = Date.now();
  const rank = Math.max(-1, ...tasks.map((t) => t.rank)) + 1;
  return db.put("tasks", { id: db.uuid(), name, description, status, rank, createdAt: now, updatedAt: now });
}

export const update = (id, patch) => db.update("tasks", id, (t) => t && { ...t, ...patch, updatedAt: Date.now() });

export const remove = (id) => db.remove("tasks", id);

/* puts the task into a column before another task (null = at the end of the column); writes the tasks whose rank
   or status changed */
export const move = (id, status, beforeId = null) =>
  db.change("tasks", (all) => {
    all.sort(byRank);
    const task = all.find((t) => t.id === id);
    if (!task || id === beforeId) return [];
    const rest = all.filter((t) => t !== task);
    const moved = { ...task, status, updatedAt: status === task.status ? task.updatedAt : Date.now() };
    let at = beforeId ? rest.findIndex((t) => t.id === beforeId) : -1;
    if (at === -1) {
      const last = rest.findLastIndex((t) => t.status === status);
      at = last === -1 ? rest.length : last + 1;
    }
    rest.splice(at, 0, moved);
    return rest.map((t, rank) => ({ ...t, rank })).filter((t, i) => t.id === id || all.find((x) => x.id === t.id).rank !== i);
  });
