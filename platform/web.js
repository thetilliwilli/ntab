/*
 * the plain web page platform (the PWA on GitHub Pages): no chrome.*, no favicon cache, no access to other sites
 * beyond what their CORS allows. same exports as extension.js (see its header).
 * on load: links the web app manifest (here, not in newtab.html: the extension has no such file), keeps the data
 * from being evicted and registers the service worker (offline, sw.js); looks for a new version whenever the page
 * comes back to the screen and tells onUpdate listeners when one has taken over.
 */

export const name = "web";

export const canRequestAccess = false;

export const faviconUrl = () => null;

export const hasHostAccess = async () => false;

export const requestHostAccess = async () => {
  throw new Error("a web page can't get access to other sites; requests that need it work in the NTab extension");
};

document.head.append(Object.assign(document.createElement("link"), { rel: "manifest", href: "manifest.webmanifest" }));

// IndexedDB of a web page is "best effort": the browser may clear it under storage pressure unless it is persisted
navigator.storage?.persist?.().catch(() => {});

/* a new version of the app took over (its service worker activated while this page runs): fn() */
const updated = new Set();
export const onUpdate = (fn) => updated.add(fn);

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  const sw = navigator.serviceWorker;
  let controlled = !!sw.controller; // the very first install also "changes" the controller: that is no update
  sw.addEventListener("controllerchange", () => {
    if (controlled) updated.forEach((fn) => fn());
    controlled = true;
  });
  sw.register("sw.js")
    .then((reg) => {
      // an installed app on a phone is resumed, not reloaded, so the browser wouldn't look for a new version: ask
      document.addEventListener("visibilitychange", () => !document.hidden && reg.update().catch(() => {}));
    })
    .catch((e) => console.warn("service worker:", e));
}

/* Settings → "Check for updates": the service worker file is fetched now (sw.js bypasses the HTTP cache for it);
   a changed one installs (its whole file set) and takes over at once (skipWaiting) */
export async function checkUpdate() {
  const sw = navigator.serviceWorker;
  const reg = await sw?.getRegistration();
  if (!reg) throw new Error("no service worker here (opened as a file, or not installed yet)");
  const took = new Promise((resolve) => sw.addEventListener("controllerchange", resolve, { once: true }));
  await reg.update(); // rejects when offline or the server fails
  const next = reg.installing || reg.waiting;
  if (!next) return reg.active && sw.controller ? "latest" : "updated";
  const failed = new Promise((_, reject) =>
    next.addEventListener("statechange", () => next.state === "redundant" && reject(new Error("the new version failed to install (offline?)"))),
  );
  await Promise.race([took, failed]);
  return "updated";
}
