/* the tracker's log from a backup (Data → Export backup, format 2) as a CSV file, one row per entry, for a BI system.
   run: node scripts/tracker-csv.mjs ntab-backup.json -o tracker.csv
   times are in the local time zone of this machine (another one: TZ=Europe/Berlin node scripts/…)

   columns:
     entry_id, type_id     uuids
     type_name, type_icon  the type as it is now (a renamed type shows its new name on old entries)
     kind                  event | activity
     type_archived         true when the type is archived
     date                  the local day of the start, YYYY-MM-DD
     start, end            local ISO 8601 with the offset (2026-11-08T09:15:00+03:00); end is empty for an event and
                           for an activity that is still running
     duration_min          minutes, activities that have finished only
     running               true for an activity that runs now
   rows are sorted by start; entries of a type that is not in the backup get an empty name */

import fs from "node:fs";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({ options: { out: { type: "string", short: "o" } }, allowPositionals: true });
if (positionals.length !== 1 || !values.out) {
  console.error("usage: node scripts/tracker-csv.mjs <backup.json> -o <out.csv>");
  process.exit(2);
}

const backup = JSON.parse(fs.readFileSync(positionals[0], "utf8"));
if (backup?.app !== "ntab") throw new Error("not an NTab backup");
if (backup.format !== 2) throw new Error(`backup format ${backup.format}: only format 2 is read (convert 2.2 backups with scripts/migrate-backup.mjs)`);
const { trackerTypes = [], trackerEntries = [] } = backup.data ?? {};

const pad = (n) => String(n).padStart(2, "0");
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function local(time) {
  const d = new Date(time);
  const off = -d.getTimezoneOffset();
  const zone = `${off < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
  return `${day(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${zone}`;
}
const cell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

const types = new Map(trackerTypes.map((t) => [t.id, t]));
const header = ["entry_id", "type_id", "type_name", "type_icon", "kind", "type_archived", "date", "start", "end", "duration_min", "running"];
const rows = [...trackerEntries]
  .sort((a, b) => a.at - b.at)
  .map((e) => {
    const t = types.get(e.typeId);
    const done = typeof e.endAt === "number";
    return [
      e.id,
      e.typeId,
      t?.name,
      t?.icon,
      t?.kind ?? (e.endAt === undefined ? "event" : "activity"),
      t ? t.archivedAt != null : "",
      day(new Date(e.at)),
      local(e.at),
      done ? local(e.endAt) : "",
      done ? ((e.endAt - e.at) / 60000).toFixed(2) : "",
      e.endAt === null,
    ];
  });

fs.writeFileSync(values.out, [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n");
const missing = rows.filter((r) => r[2] == null).length;
console.log(`written: ${values.out}: ${rows.length} entries, ${trackerTypes.length} types${missing ? `, ${missing} entries of unknown types` : ""}`);
