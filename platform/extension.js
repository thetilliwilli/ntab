/*
 * the Chrome extension platform: every chrome.* call lives here (and nowhere else).
 * platform/index.js picks it; a plain web page (PWA) will provide the same exports from web.js.
 * data is not platform specific: it is in IndexedDB everywhere (shared/db.js).
 *
 *   faviconUrl    URL of the browser's cached favicon of a page, or null if the platform has none
 */

export const faviconUrl = (pageUrl) => chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=64`);
