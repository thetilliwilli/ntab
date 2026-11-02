/* picks the platform at runtime: the extension page has chrome.runtime.id, a plain web page (the PWA) doesn't.
   both modules export the same names (see the header of extension.js) */
const p = globalThis.chrome?.runtime?.id ? await import("./extension.js") : await import("./web.js");

export const { name, faviconUrl, canRequestAccess, hasHostAccess, requestHostAccess } = p;
