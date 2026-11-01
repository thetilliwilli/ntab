// test stub for the chrome.* APIs the extension uses (the data is in IndexedDB, which the test page has itself)
window.chrome = { runtime: { id: "test", getURL: (p) => "/nonexistent" + p } };
