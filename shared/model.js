/* the parts of the data model shared by the app (shared/db.js), the sync and scripts/migrate-backup.mjs:
   fixed ids, the default actions and ranks. no browser APIs here (node imports it too) */

/* the stores that are synced and go into backups (the others: "device", "outbox" stay in this browser) */
export const SYNCED = ["notes", "trackerTypes", "trackerEntries", "tasks", "actions", "settings"];

/* the actions of a first start. fixed ids: every device has the same records, so they never come twice.
   updatedAt 0 = untouched: they give way to the actions of a server or a backup (shared/db.js merge) */
export const DEFAULT_ACTIONS = [
  { id: "2a83fa35-86d2-403c-8ff8-4ee7f8445958", name: "Notes", url: "#/notes" },
  { id: "500845be-5790-42fa-95e6-c23f81c08207", name: "Tracker", url: "#/tracker" },
  { id: "62978d54-09a1-4c8b-9cda-25db0ec9060e", name: "Board", url: "#/board" },
  { id: "a2824a87-c877-40e7-9dbe-cec1c2722790", name: "Gmail", url: "https://mail.google.com" },
  { id: "24fd736d-0684-456a-b25f-eee02d8fa04a", name: "YouTube", url: "https://www.youtube.com" },
];

export const defaultActions = () =>
  DEFAULT_ACTIONS.map(({ id, name, url }, i) => ({ id, name, icon: null, rank: i + 1, kind: "open", options: { url, newTab: false }, updatedAt: 0 }));

/* one record per setting { id, name: <setting>, value, updatedAt }: settings changed on two devices both stay */
export const SETTING_IDS = {
  theme: "2f389033-4033-4a9f-b7d4-4e62d13dc1ba",
  fontSize: "3f5ea29e-8724-4e6d-856c-42626f763ce5",
  wrap: "8f7c8369-14b9-4d68-bdfa-6a6ac2348608",
  tabSize: "484bbad7-4715-4169-9f3a-007f29fcf7f3",
};

/* the records of the "device" store { id, name, …, updatedAt } */
export const DEVICE_IDS = {
  session: "254e82a0-c80e-4a18-8f4e-172c2598533c",
  backup: "3a5add83-bf91-4fa2-bbb4-4952c23cd93b",
  sync: "b73a518a-ce08-4ebe-83fa-45692c84f147",
};

/* ---------- ranks ---------- */

/* the records in this order get ranks that grow along the list; a record keeps its rank whenever it can (the longest
   run of ranks already in order stays), the others get ranks between their neighbours, so moving one record changes
   one record. returns new objects ({ ...r, rank }) */
export function rerank(list) {
  const ranks = list.map((r) => (Number.isFinite(r?.rank) ? r.rank : null));
  const keep = longestRun(ranks);
  const out = list.map((r, i) => ({ ...r, rank: keep.has(i) ? ranks[i] : null }));
  for (let i = 0; i < out.length; ) {
    if (out[i].rank !== null) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && out[j].rank === null) j++; // [i, j) have no rank
    const lo = i > 0 ? out[i - 1].rank : null;
    const hi = j < out.length ? out[j].rank : null;
    const n = j - i;
    for (let k = 0; k < n; k++)
      out[i + k].rank = lo !== null && hi !== null ? lo + ((hi - lo) * (k + 1)) / (n + 1) : lo !== null ? lo + k + 1 : hi !== null ? hi - (n - k) : k + 1;
    i = j;
  }
  // numbers ran out of room between two neighbours (many moves into one gap): all over again, 1, 2, 3…
  if (out.some((r, i) => i && !(r.rank > out[i - 1].rank))) out.forEach((r, i) => (r.rank = i + 1));
  return out;
}

/* indexes of the longest strictly growing run of non-null numbers (patience sorting) */
function longestRun(nums) {
  const tails = []; // index of the smallest end of a run of each length
  const prev = new Array(nums.length).fill(-1);
  nums.forEach((x, i) => {
    if (x === null) return;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (nums[tails[mid]] < x) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo ? tails[lo - 1] : -1;
    tails[lo] = i;
  });
  const keep = new Set();
  for (let i = tails.at(-1) ?? -1; i !== -1; i = prev[i]) keep.add(i);
  return keep;
}

/* a rank after all of these records */
export const nextRank = (records) => Math.floor(Math.max(0, ...records.map((r) => r.rank ?? 0))) + 1;
