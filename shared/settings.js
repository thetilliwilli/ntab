/* settings (meta "settings" in shared/db.js): kept here, written 400 ms after the last change; subscribers get every
   change, made here or on another page */

import * as db from "./db.js";

export const DEFAULT_SETTINGS = {
  theme: "auto",
  fontSize: 14,
  wrap: false,
  tabSize: 4,
};

let cfg = DEFAULT_SETTINGS;
let pending = 0;
const subs = new Set();

const notify = () => subs.forEach((fn) => fn(cfg));

export const getSettings = () => cfg;
export const subscribeSettings = (fn) => subs.add(fn);

export async function loadSettings() {
  cfg = { ...DEFAULT_SETTINGS, ...(await db.getMeta("settings")) };
  notify();
}

function flush() {
  if (!pending) return;
  clearTimeout(pending);
  pending = 0;
  db.setMeta("settings", cfg).catch(console.error);
}

export function updateSettings(patch) {
  cfg = { ...cfg, ...patch };
  notify();
  clearTimeout(pending);
  pending = setTimeout(flush, 400);
}

window.addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => document.hidden && flush());

db.onChange(({ store, ids, local }) => {
  if (local || pending || store !== "meta" || !ids.includes("settings")) return;
  loadSettings().catch(console.error);
});
