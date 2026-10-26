/* notes folder listing ([+] dialog and no-open-tabs screen), and the non-modal "close tab as…" panel */

import * as notes from "./notes.js";
import * as fs from "./fs.js";
import { $, el, extStart, fmtTime, fmtSize } from "./util.js";

/* ---------- file browser: [+] dialog and the no-open-tabs screen ---------- */

const openNote = (name) => notes.open(name).catch((e) => notes.report(e.message));

function fileBrowser({ list, filter, onPick }) {
  let files = [];

  function render() {
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
      row.append(el("span", "fname", f.name), el("span", "fmeta", fmtTime(f.lastModified)), el("span", "fmeta", fmtSize(f.size)), del);

      row.addEventListener("click", () => onPick(f.name));
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
          render();
        } catch (err) {
          alert(err.message);
        }
      });
      list.append(row);
    }
  }

  filter.addEventListener("input", render);
  filter.addEventListener("keydown", (e) => {
    if (e.key === "Enter") list.querySelector(".file-row")?.click();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      list.querySelector(".file-row")?.focus();
    }
  });

  return {
    async load() {
      filter.value = "";
      list.textContent = "";
      list.append(el("div", "empty", "loading…"));
      try {
        files = (await fs.listNotes()).sort((a, b) => b.lastModified - a.lastModified);
        render();
      } catch (e) {
        list.textContent = "";
        list.append(el("div", "empty err", e.message));
      }
    },
  };
}

const dlg = $("files");
const dialogFiles = fileBrowser({
  list: $("files-list"),
  filter: $("files-filter"),
  onPick(name) {
    dlg.close();
    openNote(name);
  },
});
const inlineFiles = fileBrowser({ list: $("nothing-list"), filter: $("nothing-filter"), onPick: openNote });

export function initFilesDialog({ onChangeFolder }) {
  $("tab-add").addEventListener("click", openFiles);
  $("files-close").addEventListener("click", () => dlg.close());
  $("files-change").addEventListener("click", () => {
    dlg.close();
    onChangeFolder();
  });
  $("nothing-new").addEventListener("click", () => notes.create().catch((e) => notes.report(e.message)));
  $("nothing-change").addEventListener("click", onChangeFolder);
}

export function openFiles() {
  $("files-dir").textContent = fs.getDir()?.name || "";
  dlg.showModal();
  $("files-filter").focus();
  return dialogFiles.load();
}

/* fills the no-open-tabs screen */
export function showInlineFiles() {
  $("nothing-dir").textContent = fs.getDir()?.name || "";
  $("nothing-filter").focus();
  return inlineFiles.load();
}

/* ---------- close panel ---------- */

const panel = $("close-panel");
const input = $("cp-input");
let target = null;

export function initClosePanel() {
  $("cp-first").addEventListener("click", () => {
    if (target) input.value = notes.firstLine(target) + target.slice(extStart(target)); // keep the current extension
    input.focus();
  });
  $("cp-current").addEventListener("click", () => {
    if (target) input.value = target;
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
  $("cp-name").textContent = name;
  input.value = name;
  panel.hidden = false;
  input.focus();
  input.setSelectionRange(0, extStart(name));
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
