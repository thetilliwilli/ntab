/*
 * storage layout
 *   sync   settings            editor/ui settings (small, shared across machines)
 *   sync   links.n, links.<i>  shortcuts, one item per link (sync has an 8 KB per-item limit)
 *   local  icons               { hostname: dataURL } user-uploaded icons (this machine only)
 *   local  session, draft:*    see notes.js
 */

import { extensionAlive } from "./util.js";

export const DEFAULT_SETTINGS = {
  fontSize: 14,
  wrap: false,
  tabSize: 4,
  theme: "auto",
  sidebarCollapsed: false,
};

export const DEFAULT_LINKS = [
  { name: "Gmail", url: "https://mail.google.com" },
  { name: "GitHub", url: "https://github.com" },
  { name: "YouTube", url: "https://youtube.com" },
  { name: "Calendar", url: "https://calendar.google.com" },
  { name: "Claude", url: "https://claude.ai" },
];

/* settings */

let pending = null;
let pendingValue = null;
let lastWritten = null;

export async function loadSettings() {
  const { settings } = await chrome.storage.sync.get("settings");
  return { ...DEFAULT_SETTINGS, ...settings };
}

function flushSettings() {
  if (!pending || !extensionAlive()) return;
  clearTimeout(pending);
  pending = null;
  lastWritten = JSON.stringify(pendingValue);
  chrome.storage.sync.set({ settings: pendingValue }).catch(console.error);
}

export function saveSettings(settings) {
  clearTimeout(pending);
  pendingValue = settings;
  pending = setTimeout(flushSettings, 400);
}

window.addEventListener("pagehide", flushSettings);
document.addEventListener("visibilitychange", () => document.hidden && flushSettings());

export function onSettingsChanged(cb) {
  chrome.storage.onChanged.addListener((changes, area) => {
    const value = area === "sync" && changes.settings?.newValue;
    if (!value || pending || JSON.stringify(value) === lastWritten) return;
    cb({ ...DEFAULT_SETTINGS, ...value });
  });
}

/* shortcuts */

export async function loadLinks() {
  const data = await chrome.storage.sync.get(null);
  const n = data["links.n"];
  if (typeof n === "number") {
    return Array.from({ length: n }, (_, i) => data[`links.${i}`]).filter(Boolean);
  }
  // first run of v2: migrate links kept in storage.local by v1
  const { links } = await chrome.storage.local.get("links");
  const result = Array.isArray(links) ? links : DEFAULT_LINKS;
  await saveLinks(result);
  return result;
}

export async function saveLinks(links) {
  const old = (await chrome.storage.sync.get("links.n"))["links.n"] || 0;
  const items = { "links.n": links.length };
  links.forEach((link, i) => (items[`links.${i}`] = link));
  await chrome.storage.sync.set(items);
  const stale = [];
  for (let i = links.length; i < old; i++) stale.push(`links.${i}`);
  if (stale.length) await chrome.storage.sync.remove(stale);
}

export function onLinksChanged(cb) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && Object.keys(changes).some((k) => k.startsWith("links."))) loadLinks().then(cb);
  });
}

/* user-uploaded icons */

export async function getIcons() {
  return (await chrome.storage.local.get("icons")).icons || {};
}

export const setIcons = (icons) => chrome.storage.local.set({ icons });

export function onIconsChanged(cb) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.icons) cb(changes.icons.newValue || {});
  });
}
