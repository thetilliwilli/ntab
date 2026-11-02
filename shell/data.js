/*
 * the Data dialog (sidebar button): backup export / import, text files as notes; and the backup reminder on home.
 *
 * a backup is one JSON file: { app: "ntab", format: 1, exportedAt, data: { settings, notes, trackerTypes,
 * trackerEntries, tasks, actions } } with the records as they are in shared/db.js. importing it replaces everything.
 * the reminder shows on home once meta "backup".remindAt has passed and there is something to lose.
 */

import * as db from "../shared/db.js";
import { $, fmtTime, download } from "../shared/util.js";

const FORMAT = 1;
const DAY = 864e5;
const REMIND_EVERY = 7 * DAY;
const SNOOZE = 3 * DAY;

/* what a record of each store must have, to tell a backup from a random JSON file */
const REQUIRED = {
  notes: { name: "string", text: "string" },
  trackerTypes: { name: "string", icon: "string", kind: "string" },
  trackerEntries: { typeId: "string", at: "number" },
  tasks: { name: "string", status: "string" },
  actions: { name: "string", kind: "string" },
};

const dlg = $("data");
let flushApps = async () => {};

const msg = (text, kind = "") => {
  $("data-msg").textContent = text;
  $("data-msg").className = `msg ${kind}`;
};

const pad = (n) => String(n).padStart(2, "0");
const day = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const ago = (t) => {
  const days = Math.floor((Date.now() - t) / DAY);
  return days < 1 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};

const backupInfo = async () => (await db.getMeta("backup")) ?? { lastExportAt: null, remindAt: 0 };

/* ---------- export ---------- */

async function exportAll() {
  await flushApps();
  const now = Date.now();
  const file = { app: "ntab", format: FORMAT, exportedAt: now, data: await db.dump() };
  download(`ntab-backup-${day(now)}.json`, JSON.stringify(file, null, 1), "application/json");
  await db.setMeta("backup", { lastExportAt: now, remindAt: now + REMIND_EVERY });
  refresh();
}

/* ---------- import ---------- */

const picker = (accept, multiple) =>
  new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept, multiple });
    input.onchange = () => resolve([...input.files]);
    input.click();
  });

/* the backup's data, or throws with what is wrong */
function check(file) {
  if (file?.app !== "ntab" || typeof file.data !== "object") throw new Error("not an NTab backup");
  if (file.format !== FORMAT) throw new Error(`backup format ${file.format} is not supported by this version (${FORMAT})`);
  const { data } = file;
  if (typeof data.settings !== "object" || Array.isArray(data.settings)) throw new Error(`"settings" must be an object`);
  for (const [store, fields] of Object.entries(REQUIRED)) {
    if (!Array.isArray(data[store])) throw new Error(`"${store}" must be an array`);
    data[store].forEach((r, i) => {
      if (typeof r?.id !== "string") throw new Error(`${store}[${i}]: "id" must be a string`);
      for (const [f, type] of Object.entries(fields))
        if (typeof r[f] !== type) throw new Error(`${store}[${i}]: "${f}" must be a ${type}`);
    });
  }
  return data;
}

async function importBackup() {
  const [file] = await picker(".json,application/json", false);
  if (!file) return;
  let data;
  try {
    data = check(JSON.parse(await file.text()));
  } catch (e) {
    return msg(`${file.name}: ${e.message}`, "err");
  }
  const n = (store) => data[store].length;
  const summary = `${n("notes")} notes, ${n("trackerTypes")} tracker types, ${n("trackerEntries")} tracker entries, ${n("tasks")} tasks, ${n("actions")} actions`;
  if (!confirm(`Replace all data in NTab with this backup?\n\n${file.name}\n${summary}\n\nEverything NTab has now is deleted. Other NTab tabs reload.`)) return;
  await flushApps();
  await db.restore(data); // reloads the page
}

async function importText() {
  const files = await picker("text/*,.txt,.md,.markdown,.csv,.json,.log", true);
  if (!files.length) return;
  const notes = [];
  for (const f of files) {
    const at = f.lastModified || Date.now();
    notes.push({ id: db.uuid(), name: f.name, text: await f.text(), createdAt: at, updatedAt: at });
  }
  await db.put("notes", notes);
  msg(`${notes.length} ${notes.length === 1 ? "note" : "notes"} added: ${files.map((f) => f.name).join(", ")}. Open them with + in Notes.`, "ok");
}

/* ---------- dialog and reminder ---------- */

async function refresh() {
  const { lastExportAt, remindAt } = await backupInfo();
  $("data-last").textContent = lastExportAt ? `last backup: ${fmtTime(lastExportAt)} (${ago(lastExportAt)})` : "no backup yet";
  const due = Date.now() >= remindAt;
  const bar = $("backup-bar");
  if (!due) return (bar.hidden = true);
  const [notes, entries, tasks] = await Promise.all(["notes", "trackerEntries", "tasks"].map(db.count));
  bar.hidden = !(notes + entries + tasks);
  $("backup-text").textContent = lastExportAt
    ? `Last backup ${ago(lastExportAt)}. Your data lives only in this browser: export a backup now and then.`
    : "No backup yet. Your data lives only in this browser: export a backup now and then.";
}

/* everything goes: back to a fresh start (other NTab tabs reload) */
async function wipeAll() {
  const where = location.protocol.startsWith("http") ? location.host : "this browser";
  if (!confirm(`Delete ALL NTab data in ${where}: notes, tracker, board, actions and settings?\n\nThis can't be undone; export a backup first if you may need it. Other NTab tabs reload.`)) return;
  await db.wipe(); // reloads the page
}

const guard = (fn) => () => fn().catch((e) => msg(e.message || String(e), "err"));

/* flush: writes the apps' pending changes before a backup is taken or replaced */
export function initData({ flush }) {
  flushApps = flush;
  $("data-btn").addEventListener("click", () => {
    msg("");
    refresh();
    dlg.showModal();
  });
  $("data-x").addEventListener("click", () => dlg.close());
  $("data-export").addEventListener("click", guard(exportAll));
  $("data-import").addEventListener("click", guard(importBackup));
  $("data-text").addEventListener("click", guard(importText));
  $("data-wipe").addEventListener("click", guard(wipeAll));
  $("backup-export").addEventListener("click", guard(exportAll));
  $("backup-later").addEventListener("click", async () => {
    $("backup-bar").hidden = true;
    await db.setMeta("backup", { ...(await backupInfo()), remindAt: Date.now() + SNOOZE });
  });
  db.onChange(({ store, ids }) => store === "meta" && ids?.includes("backup") && refresh());
  refresh();
}

/* home came to the front: the reminder may be due by now */
export const checkReminder = () => refresh().catch(console.error);
