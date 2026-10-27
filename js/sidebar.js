/* actions, drawn twice from one list: sidebar icons (with a hover flyout) and home screen tiles */

import { loadLinks, onLinksChanged, getIcons, onIconsChanged } from "./settings.js";
import { getView, setView, onView } from "./view.js";
import { $, el, isNotes, iconKey } from "./util.js";

const side = $("links");
const grid = $("home-grid");
let links = [];
let icons = {};

const NOTES_ICON = `<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M5 3h22v26H5z"/><path stroke="#fff" stroke-width="2.4" d="M10 10h12M10 15.5h12M10 21h7"/></svg>`;

/* hover flyout over the sidebar: icon + full name + url; clicking it does what the icon does */
const fly = el("a", "flyout");
let flyLink = null;
fly.hidden = true;
document.body.append(fly);
fly.addEventListener("mouseleave", () => (fly.hidden = true));
fly.addEventListener("click", (e) => {
  if (flyLink && isNotes(flyLink)) {
    e.preventDefault();
    setView("notes");
  }
  fly.hidden = true;
});
side.addEventListener("scroll", () => (fly.hidden = true));
window.addEventListener("blur", () => (fly.hidden = true));

function showFlyout(a, link) {
  flyLink = link;
  if (isNotes(link)) fly.removeAttribute("href");
  else fly.href = link.url;
  if (link.target) fly.target = link.target;
  else fly.removeAttribute("target");
  fly.textContent = "";
  fly.append(a.querySelector(".ico").cloneNode(true), el("span", "fly-name", link.name), el("span", "fly-url", isNotes(link) ? "notepad" : link.url));
  const r = a.getBoundingClientRect();
  fly.style.top = `${r.top}px`;
  fly.style.left = `${r.left}px`;
  fly.style.height = `${r.height}px`;
  fly.style.minWidth = `${r.width}px`;
  fly.hidden = false;
}

export const getLinks = () => links;
export const getIconMap = () => icons;

export async function initSidebar() {
  [links, icons] = await Promise.all([loadLinks(), getIcons()]);
  render();
  onLinksChanged((l) => {
    links = l;
    render();
  });
  onIconsChanged((i) => {
    icons = i;
    render();
  });
  onView(() => {
    fly.hidden = true;
    markView();
  });
}

/* a link is a real <a>; the notepad is a button that switches the screen */
function actionEl(link, cls) {
  if (!isNotes(link)) {
    const a = el("a", cls);
    a.href = link.url;
    if (link.target) a.target = link.target;
    return a;
  }
  const b = el("button", `${cls} notes`);
  b.type = "button";
  b.addEventListener("click", () => setView("notes"));
  return b;
}

function render() {
  side.textContent = "";
  grid.textContent = "";
  for (const link of links) {
    const item = actionEl(link, "link");
    item.setAttribute("aria-label", link.name);
    item.append(iconEl(link, icons));
    item.addEventListener("mouseenter", () => showFlyout(item, link));
    side.append(item);

    const tile = actionEl(link, "tile");
    tile.title = isNotes(link) ? link.name : link.url;
    tile.append(iconEl(link, icons), el("span", "tile-name", link.name));
    grid.append(tile);
  }
  if (!links.length) grid.append(el("p", "empty", "No actions yet — add some with ✎ at the bottom of the sidebar."));
  markView();
}

function markView() {
  const notes = getView() === "notes";
  $("go-home").classList.toggle("on", !notes);
  side.querySelectorAll(".notes").forEach((n) => n.classList.toggle("on", notes));
}

/* icon: uploaded one > built-in notepad icon / Chrome's favicon cache > first letter */
export function iconEl(link, iconMap) {
  const span = el("span", "ico", (link.name.trim()[0] || "?").toUpperCase());
  const key = iconKey(link);
  if (key && iconMap[key]) setImg(span, iconMap[key]);
  else if (isNotes(link)) {
    span.classList.add("img");
    span.innerHTML = NOTES_ICON;
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

/* ---------- Chrome favicon cache (chrome-extension://<id>/_favicon/, "favicon" permission) ---------- */

const faviconUrl = (pageUrl) => chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=64`);

export function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = src;
  });
}

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
  if (!cache.has(url)) {
    defaultSig ??= loadImg(faviconUrl("https://unknown.invalid/")).then(signature).catch(() => "");
    const src = faviconUrl(url);
    cache.set(
      url,
      Promise.all([loadImg(src), defaultSig])
        .then(([img, def]) => (signature(img) === def ? null : src))
        .catch(() => null),
    );
  }
  return cache.get(url);
}
