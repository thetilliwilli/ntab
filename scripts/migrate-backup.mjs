/* turns backups of NTab 2.2 (format 1, one per device) into one backup of data model 2 (format 2) to import.
   run: node scripts/migrate-backup.mjs laptop.json phone.json … -o merged.json

   - records with the same id in several files (they came from one device to another by a backup) become one: the newer
     updatedAt wins; with none to compare (actions had none), the file named first wins
   - every record gets updatedAt (tracker entries: their end or start; actions: when their file was exported)
   - the order of ranked lists (actions, tracker types, tasks) is the first file's, then what only later files have;
     ranks 1, 2, 3…
   - the default actions (Notes, Tracker, Board, Gmail, YouTube with their original addresses) get the fixed ids of
     data model 2, so a fresh device doesn't show them twice
   - settings: one record per setting; the first file that has a setting wins */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { SYNCED, DEFAULT_ACTIONS, SETTING_IDS } from "../shared/model.js";

const { values, positionals } = parseArgs({ options: { out: { type: "string", short: "o" } }, allowPositionals: true });
if (!positionals.length || !values.out) {
  console.error("usage: node scripts/migrate-backup.mjs <backup.json>… -o <out.json>");
  process.exit(2);
}

const STORES = ["notes", "trackerTypes", "trackerEntries", "tasks", "actions"];
const RANKED = new Set(["trackerTypes", "tasks", "actions"]);
const SEEDS = new Map(DEFAULT_ACTIONS.map((a) => [a.url, a.id]));

const files = positionals.map((file) => {
  const backup = JSON.parse(fs.readFileSync(file, "utf8"));
  if (backup?.app !== "ntab" || backup.format !== 1) throw new Error(`${file}: not an NTab 2.2 backup (format 1)`);
  for (const store of STORES) if (!Array.isArray(backup.data?.[store])) throw new Error(`${file}: "${store}" must be an array`);
  return { file: path.basename(file), exportedAt: backup.exportedAt || Date.now(), data: backup.data };
});

const out = {};
const report = [];
for (const store of STORES) {
  const merged = new Map(); // id -> { record, at (updatedAt it came with, or -1), file }
  let same = 0;
  let conflicts = 0;
  for (const f of files) {
    let list = f.data[store].map((r) => ({ ...r }));
    if (RANKED.has(store)) list.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    if (store === "actions") {
      const taken = new Set();
      for (const a of list) {
        const seed = a.kind === "open" && SEEDS.get(a.options?.url);
        if (seed && !taken.has(seed)) {
          taken.add(seed);
          a.id = seed;
        }
      }
    }
    for (const r of list) {
      const at = Number.isFinite(r.updatedAt) ? r.updatedAt : -1;
      const was = merged.get(r.id);
      if (!was) {
        merged.set(r.id, { record: r, at, file: f });
        continue;
      }
      const differs = JSON.stringify({ ...was.record, rank: 0 }) !== JSON.stringify({ ...r, rank: 0 });
      if (differs) conflicts++;
      else same++;
      if (at > was.at) Object.assign(was, { record: r, at, file: f }); // the place in the list stays the first one's
    }
  }
  const records = [...merged.values()].map(({ record: r, file: f }, i) => {
    const updatedAt =
      Number.isFinite(r.updatedAt) ? r.updatedAt
      : store === "trackerEntries" ? Math.max(r.at, r.endAt ?? 0)
      : Number.isFinite(r.createdAt) ? r.createdAt
      : f.exportedAt;
    return { ...r, ...(RANKED.has(store) ? { rank: i + 1 } : {}), updatedAt };
  });
  out[store] = records;
  report.push([store, records.length, files.map((f) => f.data[store].length).join(" + "), same, conflicts]);
}

out.settings = [];
for (const [name, id] of Object.entries(SETTING_IDS)) {
  const f = files.find((f) => f.data.settings && name in f.data.settings);
  if (f) out.settings.push({ id, name, value: f.data.settings[name], updatedAt: f.exportedAt });
}
report.push(["settings", out.settings.length, files.map((f) => Object.keys(f.data.settings ?? {}).length).join(" + "), "", ""]);

const data = Object.fromEntries(SYNCED.map((s) => [s, out[s]]));
fs.writeFileSync(values.out, JSON.stringify({ app: "ntab", format: 2, exportedAt: Date.now(), data }, null, 1));

console.log(`files: ${files.map((f) => f.file).join(", ")}\n`);
console.log("store            result   from the files       same in several   different in several (newer, else the first file, won)");
for (const [store, n, from, same, diff] of report)
  console.log(`${store.padEnd(16)} ${String(n).padStart(6)}   ${from.padEnd(20)} ${String(same).padStart(15)}   ${String(diff).padStart(13)}`);
const running = out.trackerEntries.filter((e) => e.endAt === null).length;
console.log(`\nrunning activities: ${running}; default actions with fixed ids: ${out.actions.filter((a) => DEFAULT_ACTIONS.some((d) => d.id === a.id)).map((a) => a.name).join(", ") || "none"}`);
console.log(`settings: ${out.settings.map((s) => `${s.name}=${JSON.stringify(s.value)}`).join(", ") || "defaults"}`);
console.log(`\nwritten: ${values.out} (format 2): import it in Data → Import backup`);
