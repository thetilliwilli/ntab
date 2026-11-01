/* the list of notes ([+] dialog and the no-open-tabs screen), and the non-modal "close tab as…" panel */

import * as notes from "./notes.js";
import { $, el, extStart, fmtTime, fmtSize } from "../../shared/util.js";

/* ---------- note list: [+] dialog and the no-open-tabs screen ---------- */

const openNote = (id) => notes.open(id).catch((e) => notes.report(e.message));

function noteList({ list, filter, onPick }) {
  let files = [];

  function render() {
    const q = filter.value.trim().toLowerCase();
    const shown = files.filter((f) => f.name.toLowerCase().includes(q));
    list.textContent = "";
    if (!shown.length) return list.append(el("div", "empty", files.length ? "nothing matches" : "no notes yet"));

    for (const f of shown) {
      const row = el("div", "file-row");
      row.tabIndex = 0;
      row.classList.toggle("open", notes.isOpen(f.id));
      const del = el("button", "fdel", "×");
      del.title = "Delete note";
      row.append(el("span", "fname", f.name), el("span", "fmeta", fmtTime(f.updatedAt)), el("span", "fmeta", fmtSize(f.size)), del);

      row.addEventListener("click", () => onPick(f.id));
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
          await notes.remove(f.id);
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
        files = (await notes.list()).sort((a, b) => b.updatedAt - a.updatedAt);
        render();
      } catch (e) {
        list.textContent = "";
        list.append(el("div", "empty err", e.message));
      }
    },
  };
}

const dlg = $("files");
const dialogFiles = noteList({
  list: $("files-list"),
  filter: $("files-filter"),
  onPick(id) {
    dlg.close();
    openNote(id);
  },
});
const inlineFiles = noteList({ list: $("nothing-list"), filter: $("nothing-filter"), onPick: openNote });

export function initFilesDialog() {
  $("tab-add").addEventListener("click", openFiles);
  $("files-close").addEventListener("click", () => dlg.close());
  $("nothing-new").addEventListener("click", () => notes.create().catch((e) => notes.report(e.message)));
}

function openFiles() {
  dlg.showModal();
  $("files-filter").focus();
  return dialogFiles.load();
}

/* fills the no-open-tabs screen */
export function showInlineFiles() {
  $("nothing-filter").focus();
  return inlineFiles.load();
}

/* ---------- close panel ---------- */

const panel = $("close-panel");
const input = $("cp-input");
let target = null;

export function initClosePanel() {
  const name = () => notes.getNote(target)?.name ?? "";
  $("cp-first").addEventListener("click", () => {
    if (target) input.value = notes.firstLine(target) + name().slice(extStart(name())); // keep the current extension
    input.focus();
  });
  $("cp-current").addEventListener("click", () => {
    if (target) input.value = name();
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

export function askClose(id) {
  const n = notes.getNote(id);
  if (!n) return;
  const empty = !n.text.trim();
  if (empty || !n.edited) {
    if (target === id) hidePanel();
    // empty new note: delete it; unchanged since opened, or emptied: just close the tab
    return notes.close(id, empty && n.created).catch((e) => notes.report(e.message));
  }
  target = id;
  $("cp-name").textContent = n.name;
  input.value = n.name;
  panel.hidden = false;
  input.focus();
  input.setSelectionRange(0, extStart(n.name));
}

function hidePanel() {
  target = null;
  panel.hidden = true;
}

async function confirmClose() {
  const id = target;
  const wanted = input.value;
  hidePanel();
  if (!id || !notes.isOpen(id)) return;
  try {
    await notes.rename(id, wanted);
    await notes.close(id);
  } catch (e) {
    notes.report(`close failed: ${e.message}`);
  }
}
