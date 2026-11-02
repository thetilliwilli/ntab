/*
 * the Chrome extension platform: every chrome.* call lives here (and nowhere else).
 * platform/index.js picks it at runtime; a plain web page (the PWA) gets the same exports from web.js.
 * data is not platform specific: it is in IndexedDB everywhere (shared/db.js).
 *
 *   name               "extension" | "web"
 *   faviconUrl         URL of the browser's cached favicon of a page, or null if the platform has none
 *   onUpdate(fn)       fn() when a new version of the app has taken over while the page runs (the web version;
 *                      the extension's pages are reloaded by Chrome itself)
 *   canRequestAccess   whether the platform can grant access to a site at all (false on the web)
 *   hasHostAccess      whether requests to the site of `url` may ignore CORS (an optional host permission)
 *   requestHostAccess  asks the user for that, for this one site (call it from a click); resolves to true/false,
 *                      rejects when the browser refuses to ask (the message says why).
 *                      a web page can't have it: there hasHostAccess is false and requestHostAccess rejects
 */

export const name = "extension";

export const canRequestAccess = true;

export const onUpdate = () => {};

export const faviconUrl = (pageUrl) => chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=64`);

/* "https://example.com:8080/x" -> "https://example.com/*" (match patterns have no ports) */
const origins = (url) => {
  const u = new URL(url);
  return [`${u.protocol}//${u.hostname}/*`];
};

export const hasHostAccess = (url) => chrome.permissions.contains({ origins: origins(url) }).catch(() => false);

export const requestHostAccess = (url) => chrome.permissions.request({ origins: origins(url) });
