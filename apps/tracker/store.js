/*
 * tracker files, in the "tracker" subfolder of the data folder:
 *
 *   types.json            { "types": [ { id, name, icon, span, archived } ] }
 *                           id never changes (renaming keeps the history); icon = an emoji; span = lasts a while
 *                           (an activity); archived = hidden from the tiles, its events keep their name and icon
 *   events-YYYY-MM.jsonl  one JSON event per line, the file of the month the event happened in (local time):
 *                           { id, type, time }                          a one-shot event
 *                           { id, type, time, activity, phase: "start" } starts an activity
 *                           { id, type, time, activity, phase: "end" }   finishes it (same activity id)
 *                         time = Date.now() in ms. new events are appended; fixing or deleting one rewrites its month.
 *
 * every write runs under a Web Lock, so several new-tab pages never overwrite each other's lines.
 */

import * as folder from "../../shared/folder.js";

const LOCK = "ntab-tracker";
const FILE = /^events-(\d{4})-(\d{2})\.jsonl$/;

let dir = null;

export async function openDir() {
  dir = await folder.subdir("tracker");
}

const locked = (fn) => navigator.locks.request(LOCK, fn);

const pad = (n) => String(n).padStart(2, "0");

export function monthFile(time) {
  const d = new Date(time);
  return `events-${d.getFullYear()}-${pad(d.getMonth() + 1)}.jsonl`;
}

function parse(text, file) {
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      console.warn(`tracker: skipped a broken line in ${file}`);
    }
  }
  return out;
}

const dump = (events) => events.map((e) => JSON.stringify(e) + "\n").join("");

/* { types, events } with events sorted by time */
export async function load() {
  const types = (await folder.readJson(dir, "types.json"))?.types || [];
  const events = [];
  for await (const h of dir.values()) {
    if (h.kind !== "file" || !FILE.test(h.name)) continue;
    events.push(...parse(await (await h.getFile()).text(), h.name));
  }
  return { types, events: events.sort((a, b) => a.time - b.time) };
}

export const saveTypes = (types) => locked(() => folder.writeJson(dir, "types.json", { types }));

/* adds one line to the end of its month file without rewriting the file */
async function appendLine(event) {
  const h = await dir.getFileHandle(monthFile(event.time), { create: true });
  const size = (await h.getFile()).size;
  let line = JSON.stringify(event) + "\n";
  if (size && (await (await h.getFile()).slice(size - 1).text()) !== "\n") line = "\n" + line; // a torn last line
  const w = await h.createWritable({ keepExistingData: true });
  await w.seek(size);
  await w.write(line);
  await w.close();
}

export const append = (event) => locked(() => appendLine(event));

/* rewrites the month file of `time` with fn(events of that file) */
async function rewrite(time, fn) {
  const name = monthFile(time);
  const file = await folder.readText(dir, name);
  if (!file) return;
  await folder.writeText(dir, name, dump(fn(parse(file.text, name))));
}

export const remove = (events) =>
  locked(async () => {
    const byFile = new Map();
    for (const e of events) byFile.set(monthFile(e.time), [...(byFile.get(monthFile(e.time)) || []), e]);
    for (const list of byFile.values()) {
      const ids = new Set(list.map((e) => e.id));
      await rewrite(list[0].time, (all) => all.filter((e) => !ids.has(e.id)));
    }
  });

/* changes the time of an event, moving it to another month file if needed */
export const retime = (event, time) =>
  locked(async () => {
    const moved = { ...event, time };
    if (monthFile(time) === monthFile(event.time)) return rewrite(event.time, (all) => all.map((e) => (e.id === event.id ? moved : e)));
    await appendLine(moved);
    await rewrite(event.time, (all) => all.filter((e) => e.id !== event.id));
  });
