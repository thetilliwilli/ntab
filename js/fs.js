/* notes folder access via the File System Access API; the directory handle is persisted in IndexedDB */

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

export async function listNotes() {
  const out = [];
  for await (const h of dir.values()) {
    if (h.kind !== "file" || h.name.startsWith(".")) continue;
    const f = await h.getFile();
    out.push({ name: h.name, lastModified: f.lastModified, size: f.size });
  }
  return out;
}

export async function readNote(name) {
  const f = await (await dir.getFileHandle(name)).getFile();
  return { text: await f.text(), lastModified: f.lastModified };
}

export async function statNote(name) {
  return (await (await dir.getFileHandle(name)).getFile()).lastModified;
}

/* returns the new lastModified */
export async function writeNote(name, text) {
  const h = await dir.getFileHandle(name, { create: true });
  const w = await h.createWritable();
  await w.write(text);
  await w.close();
  return (await h.getFile()).lastModified;
}

export async function removeNote(name) {
  try {
    await dir.removeEntry(name);
  } catch (e) {
    if (e.name !== "NotFoundError") throw e;
  }
}

export async function exists(name) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/* user text -> safe file name; the extension is whatever the user typed */
export function sanitize(text) {
  const s = text
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, "_")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 100)
    .trim();
  return s || "untitled.txt";
}

/* "note.md", or "note (2).md", "note (3).md"... if taken */
export async function freeName(wanted) {
  const i = wanted.lastIndexOf(".");
  const [stem, ext] = i > 0 ? [wanted.slice(0, i), wanted.slice(i)] : [wanted, ""];
  let name = wanted;
  for (let n = 2; await exists(name); n++) name = `${stem} (${n})${ext}`;
  return name;
}

/* first unused newN.txt */
export async function nextNewName(taken) {
  for (let i = 1; ; i++) {
    const name = `new${i}.txt`;
    if (!taken.has(name) && !(await exists(name))) return name;
  }
}
