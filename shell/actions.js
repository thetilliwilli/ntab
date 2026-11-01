/* the action list (links and apps) and uploaded icons: loaded once, kept in sync, drawn by the sidebar and home */

import { loadLinks, onLinksChanged, getIcons, onIconsChanged } from "../shared/settings.js";
import * as platform from "../platform/index.js";
import { appById } from "./apps.js";
import { setView } from "./view.js";
import { el, isApp, iconKey } from "../shared/util.js";

let links = [];
let icons = {};
const subs = new Set();
const notify = () => subs.forEach((fn) => fn());

export const getLinks = () => links;
export const getIconMap = () => icons;
export const subscribeActions = (fn) => subs.add(fn);

/* what can be shown: links and apps this version has (a newer version on another machine may sync other apps) */
export const shownActions = () => links.filter((a) => !isApp(a) || appById(a.type));

export async function initActions() {
  [links, icons] = await Promise.all([loadLinks(), getIcons()]);
  notify();
  onLinksChanged((l) => {
    links = l;
    notify();
  });
  onIconsChanged((i) => {
    icons = i;
    notify();
  });
}

/* a link is a real <a>; an app is a button that switches the screen (class = the app id) */
export function actionEl(link, cls) {
  if (!isApp(link)) {
    const a = el("a", cls);
    a.href = link.url;
    if (link.target) a.target = link.target;
    return a;
  }
  const b = el("button", `${cls} app ${link.type}`);
  b.type = "button";
  b.dataset.app = link.type;
  b.addEventListener("click", () => setView(link.type));
  return b;
}

/* icon: uploaded one > the app's built-in icon / the browser's favicon cache > first letter */
export function iconEl(link, iconMap) {
  const span = el("span", "ico", (link.name.trim()[0] || "?").toUpperCase());
  const key = iconKey(link);
  const app = isApp(link) && appById(link.type);
  if (key && iconMap[key]) setImg(span, iconMap[key]);
  else if (app) {
    span.classList.add("img");
    span.innerHTML = app.icon;
  } else if (key) cachedFavicon(link.url).then((src) => src && setImg(span, src));
  return span;
}

function setImg(span, src) {
  const img = new Image();
  img.alt = "";
  img.src = src;
  span.textContent = "";
  span.classList.add("img");
  span.append(img);
}

export function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = src;
  });
}

/* ---------- the browser's favicon cache (in the extension: chrome-extension://<id>/_favicon/) ---------- */

function signature(img) {
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, 16, 16);
  return ctx.getImageData(0, 0, 16, 16).data.join(",");
}

/* the cache answers unknown pages with a generic globe; detect it so we can show the letter instead */
let defaultSig = null;
const cache = new Map();

function cachedFavicon(url) {
  const src = platform.faviconUrl(url);
  if (!src) return Promise.resolve(null);
  if (!cache.has(url)) {
    defaultSig ??= loadImg(platform.faviconUrl("https://unknown.invalid/")).then(signature).catch(() => "");
    cache.set(
      url,
      Promise.all([loadImg(src), defaultSig])
        .then(([img, def]) => (signature(img) === def ? null : src))
        .catch(() => null),
    );
  }
  return cache.get(url);
}
