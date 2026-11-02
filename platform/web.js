/*
 * the plain web page platform (the PWA on GitHub Pages): no chrome.*, no favicon cache, no access to other sites
 * beyond what their CORS allows. same exports as extension.js (see its header).
 * on load: links the web app manifest (here, not in newtab.html: the extension has no such file), keeps the data
 * from being evicted and registers the service worker (offline, sw.js).
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

if ("serviceWorker" in navigator && location.protocol !== "file:")
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("service worker:", e));
