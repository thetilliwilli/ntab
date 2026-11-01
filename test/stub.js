// test stub for the chrome.* APIs the extension uses (the data is in IndexedDB, which the test page has itself)
window.chrome = {
  runtime: { id: "test", getURL: (p) => "/nonexistent" + p },
  permissions: {
    granted: new Set(),
    async contains({ origins }) { return origins.every((o) => this.granted.has(o)); },
    async request({ origins }) { origins.forEach((o) => this.granted.add(o)); return true; },
  },
};
