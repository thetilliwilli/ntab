/*
 * the board: tasks in board/tasks.json, { "tasks": [ { id, name, description, status, created, updated } ] }
 * status is one of STATUSES; the order of the array is the order of the cards inside a column (and of moves).
 *
 * every change is read-modify-write of the file under a Web Lock: the file is read again, the change is applied to
 * what is there now, and the result is written, so changes made on other pages in the meantime are not lost.
 */

import * as folder from "../../shared/folder.js";

export const STATUSES = ["new", "work", "hold", "done"];
export const STATUS_NAMES = { new: "New", work: "Work", hold: "Hold", done: "Done" };

const FILE = "tasks.json";
const bc = new BroadcastChannel("newtab-board");
const subs = new Set();
let dir = null;
let tasks = [];
let started = false;

export const getTasks = () => tasks;
export const inColumn = (status) => tasks.filter((t) => t.status === status);
export const subscribe = (fn) => subs.add(fn);
const emit = () => subs.forEach((fn) => fn());

async function read() {
  return (await folder.readJson(dir, FILE))?.tasks || [];
}

export async function start() {
  started = false;
  dir = await folder.subdir("board");
  tasks = await read();
  started = true;
  emit();
}

/* other pages and programs (a sync tool) change the file too */
export async function refresh() {
  if (!started) return;
  try {
    tasks = await read();
    emit();
  } catch (e) {
    console.warn("board:", e);
  }
}

bc.onmessage = ({ data }) => data.dir === folder.getDirId() && refresh();

/* applies fn(tasks) -> tasks to the file as it is now */
function mutate(fn) {
  return navigator.locks.request("ntab-board", async () => {
    const next = fn(await read());
    await folder.writeJson(dir, FILE, { tasks: next });
    tasks = next;
    emit();
    bc.postMessage({ dir: folder.getDirId() });
  });
}

export function add({ name, description = "", status = "new" }) {
  const now = Date.now();
  const task = { id: crypto.randomUUID(), name, description, status, created: now, updated: now };
  return mutate((all) => [...all, task]).then(() => task);
}

export const update = (id, patch) =>
  mutate((all) => all.map((t) => (t.id === id ? { ...t, ...patch, updated: Date.now() } : t)));

export const remove = (id) => mutate((all) => all.filter((t) => t.id !== id));

/* puts the task into a column before another task (null = at the end of the column) */
export const move = (id, status, beforeId = null) =>
  mutate((all) => {
    const task = all.find((t) => t.id === id);
    if (!task || id === beforeId) return all;
    const rest = all.filter((t) => t !== task);
    const moved = { ...task, status, updated: status === task.status ? task.updated : Date.now() };
    let at = beforeId ? rest.findIndex((t) => t.id === beforeId) : -1;
    if (at === -1) {
      const last = rest.findLastIndex((t) => t.status === status);
      at = last === -1 ? rest.length : last + 1;
    }
    rest.splice(at, 0, moved);
    return rest;
  });
