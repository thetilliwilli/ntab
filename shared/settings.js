/*
 * browser storage layout (the data folder is described in folder.js)
 *   sync   settings            theme and notepad settings (font, wrap, tab size), small, shared across machines
 *   sync   links.n, links.<i>  actions (links and apps), one per item (sync has an 8 KB per-item limit)
 *   local  icons               { hostname | app id: dataURL } user-uploaded icons (this machine only)
 *   local  session, draft:*:*  see apps/notes/notes.js
 */

import * as platform from "../platform/index.js";

export const DEFAULT_SETTINGS = {
  fontSize: 14,
  wrap: false,
  tabSize: 4,
  theme: "auto",
};

const DEFAULT_LINKS = [
  { type: "notes", name: "Notes" },
  { name: "Gmail", url: "https://mail.google.com" },
  { name: "YouTube", url: "https://youtube.com" },
];

/* settings: kept here, saved 400 ms after the last change; subscribers get every change, local or from elsewhere */

let cfg = DEFAULT_SETTINGS;
let pending = null;
let lastWritten = null;
const subs = new Set();

const notify = () => subs.forEach((fn) => fn(cfg));

export const getSettings = () => cfg;
export const subscribeSettings = (fn) => subs.add(fn);

export async function loadSettings() {
  const { settings } = await platform.sync.get("settings");
  cfg = { ...DEFAULT_SETTINGS, ...settings };
  notify();
}

function flush() {
  if (!pending || !platform.alive()) return;
  clearTimeout(pending);
  pending = null;
  lastWritten = JSON.stringify(cfg);
  platform.sync.set({ settings: cfg }).catch(console.error);
}

export function updateSettings(patch) {
  cfg = { ...cfg, ...patch };
  notify();
  clearTimeout(pending);
  pending = setTimeout(flush, 400);
}

window.addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => document.hidden && flush());

platform.onChanged((area, changes) => {
  const value = area === "sync" && changes.settings?.newValue;
  if (!value || pending || JSON.stringify(value) === lastWritten) return;
  cfg = { ...DEFAULT_SETTINGS, ...value };
  notify();
});

/* actions */

export async function loadLinks() {
  const data = await platform.sync.get(null);
  const n = data["links.n"];
  if (typeof n !== "number") return DEFAULT_LINKS;
  return Array.from({ length: n }, (_, i) => data[`links.${i}`]).filter(Boolean);
}

export async function saveLinks(links) {
  const old = (await platform.sync.get("links.n"))["links.n"] || 0;
  const items = { "links.n": links.length };
  links.forEach((link, i) => (items[`links.${i}`] = link));
  await platform.sync.set(items);
  const stale = [];
  for (let i = links.length; i < old; i++) stale.push(`links.${i}`);
  if (stale.length) await platform.sync.remove(stale);
}

export function onLinksChanged(cb) {
  platform.onChanged((area, changes) => {
    if (area === "sync" && Object.keys(changes).some((k) => k.startsWith("links."))) loadLinks().then(cb);
  });
}

/* user-uploaded icons */

export async function getIcons() {
  return (await platform.local.get("icons")).icons || {};
}

export const setIcons = (icons) => platform.local.set({ icons });

export function onIconsChanged(cb) {
  platform.onChanged((area, changes) => {
    if (area === "local" && changes.icons) cb(changes.icons.newValue || {});
  });
}
