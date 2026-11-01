/* note files: plain text files in the "notes" subfolder of the data folder (see shared/folder.js) */

import * as folder from "../../shared/folder.js";

let dir = null;

/* called each time the app starts (the folder may have changed) */
export async function openDir() {
  dir = await folder.subdir("notes");
}

/* "my-folder/notes", for display */
export const dirLabel = () => (folder.getDir() ? `${folder.getDir().name}/notes` : "");

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
export const writeNote = (name, text) => folder.writeText(dir, name, text);

export async function removeNote(name) {
  try {
    await dir.removeEntry(name);
  } catch (e) {
    if (e.name !== "NotFoundError") throw e;
  }
}

async function exists(name) {
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
