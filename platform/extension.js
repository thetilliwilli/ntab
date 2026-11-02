/*
 * the Chrome extension platform: every chrome.* call lives here (and nowhere else).
 * platform/index.js picks it; a plain web page (PWA) will provide the same exports from web.js.
 * data is not platform specific: it is in IndexedDB everywhere (shared/db.js).
 *
 *   faviconUrl         URL of the browser's cached favicon of a page, or null if the platform has none
 *   hasHostAccess      whether requests to the site of `url` may ignore CORS (an optional host permission)
 *   requestHostAccess  asks the user for that, for this one site (call it from a click); resolves to true/false,
 *                      rejects when the browser refuses to ask (the message says why).
 *                      a web page can't have it: there hasHostAccess is false and requestHostAccess rejects
 */

export const faviconUrl = (pageUrl) => chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=64`);

/* "https://example.com:8080/x" -> "https://example.com/*" (match patterns have no ports) */
const origins = (url) => {
  const u = new URL(url);
  return [`${u.protocol}//${u.hostname}/*`];
};

export const hasHostAccess = (url) => chrome.permissions.contains({ origins: origins(url) }).catch(() => false);

export const requestHostAccess = (url) => chrome.permissions.request({ origins: origins(url) });
