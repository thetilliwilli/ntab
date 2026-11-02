// test stub for the chrome.* APIs the extension uses (the data is in IndexedDB, which the test page has itself)
window.chrome = {
  // the favicon cache: /fav/HOST.png (test/run.sh puts one there for s1.test); anything else fails to load
  runtime: {
    id: "test",
    getURL: (p) =>
      p.startsWith("/_favicon/") ? `/fav/${new URL(new URLSearchParams(p.split("?")[1]).get("pageUrl")).hostname}.png` : "/nonexistent" + p,
  },
  permissions: {
    granted: new Set(),
    async contains({ origins }) { return origins.every((o) => this.granted.has(o)); },
    async request({ origins }) { origins.forEach((o) => this.granted.add(o)); return true; },
  },
};
