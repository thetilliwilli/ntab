/*
 * the data folder: one folder the user picks (File System Access API); its handle is persisted in IndexedDB.
 *
 *   <folder>/
 *     ntab.json   { "format": 1 }: marks a folder in this layout; the root holds only what the whole extension needs
 *     notes/      Notes: one plain text file per note
 *
 * every app keeps its files in its own subfolder (subdir()). up to 2.1.0 the notes were the files in the root;
 * such a folder (files in the root, no ntab.json) is upgraded by moving them into notes/, after the user agrees.
 */

import { idbGet, idbSet } from "./idb.js";

const MARKER = "ntab.json";
const FORMAT = 1;

let dir = null;
let dirId = ""; // random id of the chosen folder: drafts and cross-page messages are scoped to it

export const getDir = () => dir;
export const getDirId = () => dirId;

export async function restoreDir() {
  [dir, dirId] = await Promise.all([idbGet("dir"), idbGet("dirId")]);
  dir ||= null;
  if (dir && !dirId) await idbSet("dirId", (dirId = crypto.randomUUID()));
  return dir;
}

export async function pickDir() {
  const handle = await window.showDirectoryPicker({ id: "newtab-notes", mode: "readwrite" });
  if (!dir || !(await handle.isSameEntry(dir))) await idbSet("dirId", (dirId = crypto.randomUUID()));
  dir = handle;
  await idbSet("dir", handle);
  return handle;
}

export async function hasPermission() {
  return !!dir && (await dir.queryPermission({ mode: "readwrite" })) === "granted";
}

/* must run inside a user gesture */
export async function requestPermission() {
  return (await dir.requestPermission({ mode: "readwrite" })) === "granted";
}

/* an app's own folder, created on first use */
export const subdir = (name) => dir.getDirectoryHandle(name, { create: true });

/* ---------- files in any folder: text and JSON ---------- */

/* returns the new lastModified */
export async function writeText(parent, name, text) {
  const h = await parent.getFileHandle(name, { create: true });
  const w = await h.createWritable();
  await w.write(text);
  await w.close();
  return (await h.getFile()).lastModified;
}

/* { text, lastModified }, or null if there is no such file */
export async function readText(parent, name) {
  try {
    const f = await (await parent.getFileHandle(name)).getFile();
    return { text: await f.text(), lastModified: f.lastModified };
  } catch (e) {
    if (e.name === "NotFoundError") return null;
    throw e;
  }
}

export async function readJson(parent, name) {
  const file = await readText(parent, name);
  return file && JSON.parse(file.text);
}

export const writeJson = (parent, name, value) => writeText(parent, name, JSON.stringify(value, null, 2) + "\n");

/* ---------- layout ---------- */

/* names of the notes an older version kept in the root; empty if the folder is in the current layout */
export async function legacyNotes() {
  if (await readText(dir, MARKER)) return [];
  const names = [];
  for await (const h of dir.values()) if (h.kind === "file" && !h.name.startsWith(".")) names.push(h.name);
  return names.sort();
}

/* marks the folder as being in the current layout (call when legacyNotes() is empty or after upgrade()) */
export async function markLayout() {
  if (!(await readText(dir, MARKER))) await writeJson(dir, MARKER, { format: FORMAT });
}

/* moves the given root files into notes/ (a free name if one is taken there), then marks the folder */
export async function upgrade(names) {
  const notes = await subdir("notes");
  for (const name of names) {
    let target = name;
    for (let n = 2; await exists(notes, target); n++) target = withSuffix(name, n);
    const h = await dir.getFileHandle(name);
    try {
      await h.move(notes, target); // keeps the file's date; not available everywhere
    } catch {
      const file = await h.getFile();
      const w = await (await notes.getFileHandle(target, { create: true })).createWritable();
      await w.write(file);
      await w.close();
      await dir.removeEntry(name);
    }
  }
  await markLayout();
}

async function exists(parent, name) {
  try {
    await parent.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/* "a.txt", 2 -> "a (2).txt" */
function withSuffix(name, n) {
  const i = name.lastIndexOf(".");
  return i > 0 ? `${name.slice(0, i)} (${n})${name.slice(i)}` : `${name} (${n})`;
}
