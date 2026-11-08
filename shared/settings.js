/* settings (the "settings" store in shared/db.js, one record per setting): kept here, the changed ones are written
   400 ms after the last change; subscribers get every change, made here, on another page or on another device */

import * as db from "./db.js";
import { SETTING_IDS } from "./model.js";

export const DEFAULT_SETTINGS = {
  theme: "auto",
  fontSize: 14,
  wrap: false,
  tabSize: 4,
};

let cfg = DEFAULT_SETTINGS;
let pending = 0;
const dirty = new Set(); // names changed here and not written yet
const subs = new Set();

const notify = () => subs.forEach((fn) => fn(cfg));

export const getSettings = () => cfg;
export const subscribeSettings = (fn) => subs.add(fn);

export async function loadSettings() {
  const stored = Object.fromEntries((await db.all("settings")).filter((r) => r.name in DEFAULT_SETTINGS).map((r) => [r.name, r.value]));
  const ours = Object.fromEntries([...dirty].map((name) => [name, cfg[name]])); // not written yet: they stand
  cfg = { ...DEFAULT_SETTINGS, ...stored, ...ours };
  notify();
}

function flush() {
  if (!pending) return;
  clearTimeout(pending);
  pending = 0;
  const records = [...dirty].map((name) => ({ id: SETTING_IDS[name], name, value: cfg[name] }));
  dirty.clear();
  db.put("settings", records).catch(console.error);
}

export function updateSettings(patch) {
  cfg = { ...cfg, ...patch };
  for (const name of Object.keys(patch)) if (name in SETTING_IDS) dirty.add(name);
  notify();
  clearTimeout(pending);
  pending = setTimeout(flush, 400);
}

window.addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => document.hidden && flush());

/* any change: from another page, another device, an import (our own writes read back the same values) */
db.onChange(({ store }) => store === "settings" && loadSettings().catch(console.error));
