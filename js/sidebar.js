import { loadLinks, onLinksChanged, getIcons, onIconsChanged } from "./settings.js";
import { $, el, hostOf } from "./util.js";

const box = $("links");
let links = [];
let icons = {};

/* hover flyout over the sidebar: icon + full name + url; it is a real link itself */
const fly = el("a", "flyout");
fly.hidden = true;
document.body.append(fly);
fly.addEventListener("mouseleave", () => (fly.hidden = true));
box.addEventListener("scroll", () => (fly.hidden = true));
window.addEventListener("blur", () => (fly.hidden = true));

function showFlyout(a, link) {
  fly.href = link.url;
  if (link.target) fly.target = link.target;
  else fly.removeAttribute("target");
  fly.textContent = "";
  fly.append(a.querySelector(".ico").cloneNode(true), el("span", "fly-name", link.name), el("span", "fly-url", link.url));
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
}

function render() {
  box.textContent = "";
  for (const link of links) {
    const a = el("a", "link");
    a.href = link.url;
    if (link.target) a.target = link.target;
    a.append(iconEl(link, icons), el("span", "label", link.name));
    a.addEventListener("mouseenter", () => showFlyout(a, link));
    box.append(a);
  }
}

/* icon: uploaded one > Chrome's favicon cache > first letter */
export function iconEl(link, iconMap) {
  const span = el("span", "ico", (link.name.trim()[0] || "?").toUpperCase());
  const host = hostOf(link.url);
  if (host && iconMap[host]) setImg(span, iconMap[host]);
  else if (host) cachedFavicon(link.url).then((src) => src && setImg(span, src));
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

const faviconUrl = (pageUrl) => chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`);

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
