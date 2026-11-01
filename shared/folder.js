/*
 * the data folder: one folder the user picks (File System Access API); its handle is persisted in IndexedDB.
 *
 *   <folder>/
 *     ntab.json   { "format": 1 }: marks a folder in this layout; the root holds only what the whole extension needs
 *     notes/      Notes: one plain text file per note
 *
 * every app keeps its files in its own subfolder (subdir()).
 */

import { idbGet, idbSet } from "./idb.js";

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
