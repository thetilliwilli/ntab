/*
 * the Chrome extension platform: every chrome.* call lives here (and nowhere else).
 * platform/index.js picks it; a plain web page (PWA) will provide the same exports from web.js.
 *
 *   sync, local   storage areas: get / set / remove, promise based
 *   onChanged     cb(area, changes) for changes made anywhere, including other pages
 *   alive         false once the extension was reloaded or updated while this page stays open
 *   faviconUrl    URL of the browser's cached favicon of a page, or null if the platform has none
 */

export const sync = chrome.storage.sync;
export const local = chrome.storage.local;

export const onChanged = (cb) => chrome.storage.onChanged.addListener((changes, area) => cb(area, changes));

export const alive = () => !!globalThis.chrome?.runtime?.id;

export const faviconUrl = (pageUrl) => chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=64`);
