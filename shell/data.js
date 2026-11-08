/*
 * the Data dialog (sidebar button): the sync server, backup export / import, text files as notes; and the backup
 * reminder on home.
 *
 * a backup is one JSON file: { app: "ntab", format: 2, exportedAt, data: { notes, trackerTypes, trackerEntries, tasks,
 * actions, settings } } with the records as they are in shared/db.js (format 1 was NTab 2.2: scripts/migrate-backup.mjs
 * converts it). importing it only adds what this browser doesn't have (by id): nothing is ever deleted or changed by
 * an import (untouched default actions give way).
 * the reminder shows on home once device "backup".remindAt has passed and there is something to lose.
 */

import * as db from "../shared/db.js";
import * as sync from "../shared/sync.js";
import { DEVICE_IDS } from "../shared/model.js";
import { $, fmtTime, download } from "../shared/util.js";

const FORMAT = 2;
const DAY = 864e5;
const REMIND_EVERY = 7 * DAY;
const SNOOZE = 3 * DAY;

/* what a record of each store must have (besides id and updatedAt), to tell a backup from a random JSON file */
const REQUIRED = {
  notes: { name: "string", text: "string" },
  trackerTypes: { name: "string", icon: "string", kind: "string" },
  trackerEntries: { typeId: "string", at: "number" },
  tasks: { name: "string", status: "string" },
  actions: { name: "string", kind: "string" },
  settings: { name: "string" },
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

const backupInfo = async () => (await db.getDevice("backup")) ?? { lastExportAt: null, remindAt: 0 };

/* ---------- export ---------- */

async function exportAll() {
  await flushApps();
  const now = Date.now();
  const file = { app: "ntab", format: FORMAT, exportedAt: now, data: await db.dump() };
  download(`ntab-backup-${day(now)}.json`, JSON.stringify(file, null, 1), "application/json");
  await db.setDevice("backup", { lastExportAt: now, remindAt: now + REMIND_EVERY });
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
  if (file.format === 1) throw new Error("a backup of NTab 2.2 (format 1): convert it with scripts/migrate-backup.mjs (see README)");
  if (file.format !== FORMAT) throw new Error(`backup format ${file.format} is not supported by this version (${FORMAT})`);
  const { data } = file;
  for (const [store, fields] of Object.entries(REQUIRED)) {
    if (!Array.isArray(data[store])) throw new Error(`"${store}" must be an array`);
    data[store].forEach((r, i) => {
      if (typeof r?.id !== "string") throw new Error(`${store}[${i}]: "id" must be a string`);
      if (typeof r.updatedAt !== "number") throw new Error(`${store}[${i}]: "updatedAt" must be a number`);
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
  await flushApps();
  const r = await db.merge(data);
  const LABELS = { notes: "notes", trackerTypes: "tracker types", trackerEntries: "tracker entries", tasks: "tasks", actions: "actions", settings: "settings" };
  const parts = Object.entries(LABELS).filter(([k]) => r[k].added).map(([k, label]) => `${r[k].added} ${label}`);
  const kept = Object.values(r).reduce((n, x) => n + x.kept, 0);
  msg(`${file.name}: ${parts.length ? `added ${parts.join(", ")}` : "nothing new"}${kept ? `; ${kept} already here, kept as they are` : ""}.`, "ok");
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
  const where = sync.getStatus().state === "off" ? "Your data lives only in this browser: export" : "Export";
  $("backup-text").textContent = `${lastExportAt ? `Last backup ${ago(lastExportAt)}` : "No backup yet"}. ${where} a backup now and then.`;
}

/* everything goes: back to a fresh start (other NTab tabs reload) */
async function wipeAll() {
  const where = location.protocol.startsWith("http") ? location.host : "this browser";
  const server = sync.getStatus().state === "off" ? "" : "\nThe sync server keeps its data; this browser stops syncing.";
  if (!confirm(`Delete ALL NTab data in ${where}: notes, tracker, board, actions and settings?${server}\n\nThis can't be undone; export a backup first if you may need it. Other NTab tabs reload.`)) return;
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
    const { lastExportAt = null } = (await db.getDevice("backup")) ?? {};
    await db.setDevice("backup", { lastExportAt, remindAt: Date.now() + SNOOZE });
  });
  db.onChange(({ store, ids }) => store === "device" && (!ids || ids.includes(DEVICE_IDS.backup)) && refresh());
  refresh();
  initSync();
}

/* ---------- the sync server ---------- */

const STATES = {
  off: () => "Not set: the data stays in this browser.",
  paused: (s) => `Paused (${s.host}).`,
  connecting: (s) => `Connecting to ${s.host}…`,
  online: (s) => `Synced with ${s.host}${s.at ? ` · ${fmtTime(s.at)}` : ""}.`,
  offline: (s) => `Offline: ${s.error}. Retrying…`,
};

function showSync(s) {
  const waiting = s.pending ? ` ${s.pending} ${s.pending === 1 ? "change waits" : "changes wait"} here.` : "";
  $("sync-status").textContent = STATES[s.state](s) + waiting;
  $("sync-status").className = `muted sync-${s.state}`;
  $("sync-disconnect").hidden = s.state === "off" || s.state === "paused";
  $("data-btn").dataset.sync = s.state;
  $("data-btn").title = `Data: backup, import, sync (${s.state === "off" ? "no sync server" : STATES[s.state](s).replace(/\.$/, "")})`;
}

async function initSync() {
  sync.onStatus(showSync);
  showSync(sync.getStatus());
  const url = (await db.getDevice("sync"))?.url;
  if (url) $("sync-url").value = url;
  const choice = $("sync-choice");
  const go = async (mode) => {
    choice.hidden = true;
    msg("Connecting…");
    const r = await sync.connect($("sync-url").value, mode);
    if (r.choose) {
      msg("");
      choice.hidden = false;
      return;
    }
    msg("Connected: the data syncs now.", "ok");
  };
  $("sync-form").addEventListener("submit", (e) => {
    e.preventDefault();
    guard(() => go(null))();
  });
  $("sync-merge").addEventListener("click", guard(() => go("merge")));
  $("sync-replace").addEventListener("click", guard(() => go("replace")));
  $("sync-cancel").addEventListener("click", () => (choice.hidden = true));
  $("sync-disconnect").addEventListener("click", guard(async () => {
    await sync.disconnect();
    msg("Disconnected: changes wait here until you connect again.", "ok");
  }));
}

/* home came to the front: the reminder may be due by now */
export const checkReminder = () => refresh().catch(console.error);
