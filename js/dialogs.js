/* [new] dialog with the notes folder listing, and the non-modal "close tab as…" panel */

import * as notes from "./notes.js";
import * as fs from "./fs.js";
import { $, el, base, fmtTime, fmtSize } from "./util.js";

/* ---------- files dialog ---------- */

const dlg = $("files");
const list = $("files-list");
const filter = $("files-filter");
let files = [];

export function initFilesDialog({ onChangeFolder }) {
  $("tab-open").addEventListener("click", openFiles);
  $("files-close").addEventListener("click", () => dlg.close());
  $("files-change").addEventListener("click", () => {
    dlg.close();
    onChangeFolder();
  });
  filter.addEventListener("input", renderFiles);
  filter.addEventListener("keydown", (e) => {
    if (e.key === "Enter") list.querySelector(".file-row")?.click();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      list.querySelector(".file-row")?.focus();
    }
  });
}

async function openFiles() {
  $("files-dir").textContent = fs.getDir()?.name || "";
  filter.value = "";
  list.textContent = "";
  list.append(el("div", "empty", "loading…"));
  dlg.showModal();
  filter.focus();
  try {
    files = (await fs.listNotes()).sort((a, b) => b.lastModified - a.lastModified);
    renderFiles();
  } catch (e) {
    list.textContent = "";
    list.append(el("div", "empty err", e.message));
  }
}

function renderFiles() {
  const q = filter.value.trim().toLowerCase();
  const shown = files.filter((f) => f.name.toLowerCase().includes(q));
  list.textContent = "";
  if (!shown.length) return list.append(el("div", "empty", files.length ? "nothing matches" : "no notes yet"));

  for (const f of shown) {
    const row = el("div", "file-row");
    row.tabIndex = 0;
    row.classList.toggle("open", notes.isOpen(f.name));
    const del = el("button", "fdel", "×");
    del.title = "Delete file";
    row.append(el("span", "fname", base(f.name)), el("span", "fmeta", fmtTime(f.lastModified)), el("span", "fmeta", fmtSize(f.size)), del);

    row.addEventListener("click", () => {
      dlg.close();
      notes.open(f.name).catch((e) => notes.report(e.message));
    });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter") row.click();
      if (e.key === "ArrowDown") (row.nextElementSibling || row).focus();
      if (e.key === "ArrowUp") (row.previousElementSibling || filter).focus();
      if (e.key === "Delete") del.click();
    });
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${f.name}" permanently?`)) return;
      try {
        await notes.remove(f.name);
        files = files.filter((x) => x !== f);
        renderFiles();
      } catch (err) {
        alert(err.message);
      }
    });
    list.append(row);
  }
}

/* ---------- close panel ---------- */

const panel = $("close-panel");
const input = $("cp-input");
let target = null;

export function initClosePanel() {
  $("cp-first").addEventListener("click", () => {
    if (target) input.value = notes.firstLine(target);
    input.focus();
  });
  $("cp-current").addEventListener("click", () => {
    if (target) input.value = base(target);
    input.focus();
  });
  $("cp-save").addEventListener("click", confirmClose);
  $("cp-cancel").addEventListener("click", hidePanel);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmClose();
    if (e.key === "Escape") hidePanel();
  });
  notes.subscribe(() => target && !notes.isOpen(target) && hidePanel());
}

export function askClose(name) {
  const n = notes.getNote(name);
  if (!n) return;
  if (!n.text.trim()) {
    if (target === name) hidePanel();
    return notes.close(name, true).catch((e) => notes.report(e.message));
  }
  target = name;
  $("cp-name").textContent = base(name);
  input.value = base(name);
  panel.hidden = false;
  input.focus();
  input.select();
}

function hidePanel() {
  target = null;
  panel.hidden = true;
}

async function confirmClose() {
  const name = target;
  const wanted = input.value.trim();
  hidePanel();
  if (!name || !notes.isOpen(name)) return;
  try {
    const final = wanted ? await notes.rename(name, wanted) : name;
    await notes.close(final);
  } catch (e) {
    notes.report(`close failed: ${e.message}`);
  }
}
