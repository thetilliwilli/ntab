/* actions (the "actions" store, see shared/db.js): loaded once, kept in sync, drawn by the sidebar and home.
   an action is a button of some kind with its options:
     "open"     { url, newTab }                 "#/<app id>" opens an app on this page, anything else a web address
     "request"  { url, method, headers, body }  sends an HTTP request and shows the response (shell/request.js)
   headers is an object { name: value }; body is a string, not sent with GET and HEAD */

import * as db from "../shared/db.js";
import * as platform from "../platform/index.js";
import { appById } from "./apps.js";
import { setView } from "./view.js";
import { runRequest } from "./request.js";
import { el, routeOf } from "../shared/util.js";

let actions = [];
const subs = new Set();
const notify = () => subs.forEach((fn) => fn());

export const getActions = () => actions;
export const subscribeActions = (fn) => subs.add(fn);

export const KINDS = { open: "open", request: "request" }; // kind -> its name in the editor
export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

export const newAction = (name, url, newTab = false) => ({ id: db.uuid(), name, icon: null, rank: 0, kind: "open", options: { url, newTab } });

/* the options a kind starts with, keeping the url */
export function optionsFor(kind, url = "") {
  if (kind === "request") return { url, method: "GET", headers: {}, body: "" };
  return { url, newTab: false };
}

/* the app an action opens, if it opens one of this version's apps */
export const appOf = (action) => (action.kind === "open" ? appById(routeOf(action.options?.url)) : undefined) ?? null;
export const isRoute = (action) => action.kind === "open" && routeOf(action.options?.url) != null;

/* what this version can show: requests, "open" actions of web addresses and of its own apps (a backup from a newer
   version may have other kinds or apps; they are kept, not shown) */
export const shownActions = () => actions.filter((a) => a.kind === "request" || (a.kind === "open" && (!isRoute(a) || appOf(a))));

/* one line about what it does: the app, "POST https://…", or the address */
export const describe = (action) =>
  appOf(action)?.what ?? (action.kind === "request" ? `${action.options.method} ${action.options.url}` : action.options?.url ?? action.kind);

async function load() {
  actions = (await db.all("actions")).sort((a, b) => a.rank - b.rank);
  notify();
}

export async function initActions() {
  db.onChange(({ store }) => store === "actions" && load().catch(console.error));
  await load();
}

/* the whole list, in this order */
export const saveActions = (list) => db.replace("actions", list.map((a, rank) => ({ ...a, rank })));

export const saveAction = (action) => db.put("actions", action);
export const removeAction = (id) => db.remove("actions", id);

export const addAction = (action) => db.put("actions", { ...action, rank: Math.max(-1, ...actions.map((a) => a.rank)) + 1 });

/* a web address is a real <a>; an app is a button that switches the screen (class "app <app id>"); a request is a
   button that runs it (class "request") */
export function actionEl(action, cls) {
  if (action.kind === "request") {
    const b = el("button", `${cls} request`);
    b.type = "button";
    b.addEventListener("click", () => runRequest(action));
    return b;
  }
  const app = appOf(action);
  if (!app) {
    const a = el("a", cls);
    a.href = action.options.url;
    if (action.options.newTab) a.target = "_blank";
    return a;
  }
  const b = el("button", `${cls} app ${app.id}`);
  b.type = "button";
  b.dataset.app = app.id;
  b.addEventListener("click", () => setView(app.id));
  return b;
}

/* icon: uploaded one > the app's built-in icon / the browser's favicon cache > first letter */
export function iconEl(action) {
  const span = el("span", "ico", (action.name.trim()[0] || "?").toUpperCase());
  const app = appOf(action);
  const url = action.options?.url;
  if (action.icon) setImg(span, action.icon);
  else if (app) {
    span.classList.add("img");
    span.innerHTML = app.icon;
  } else if (!isRoute(action) && /^https?:/i.test(url ?? "")) cachedFavicon(url).then((src) => src && setImg(span, src));
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
