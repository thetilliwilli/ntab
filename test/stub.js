// test stub for chrome.* APIs + showDirectoryPicker -> OPFS
(() => {
  const listeners = [];
  const area = (name) => {
    const key = "stub:" + name;
    const read = () => JSON.parse(localStorage.getItem(key) || "{}");
    const write = (d) => localStorage.setItem(key, JSON.stringify(d));
    const fire = (changes) => Object.keys(changes).length && listeners.forEach((l) => l(changes, name));
    return {
      async get(k) {
        const d = read();
        if (k == null) return d;
        if (typeof k === "string") return k in d ? { [k]: d[k] } : {};
        if (Array.isArray(k)) return Object.fromEntries(k.filter((x) => x in d).map((x) => [x, d[x]]));
        return Object.fromEntries(Object.entries(k).map(([x, def]) => [x, x in d ? d[x] : def]));
      },
      async set(obj) { const d = read(); const ch = {}; for (const [k, v] of Object.entries(obj)) { ch[k] = { oldValue: d[k], newValue: v }; d[k] = v; } write(d); setTimeout(() => fire(ch)); },
      async remove(ks) { const d = read(); const ch = {}; for (const k of [].concat(ks)) if (k in d) { ch[k] = { oldValue: d[k] }; delete d[k]; } write(d); setTimeout(() => fire(ch)); },
    };
  };
  window.chrome = {
    storage: { local: area("local"), sync: area("sync"), onChanged: { addListener: (f) => listeners.push(f) } },
    runtime: { id: "test", getURL: (p) => "/nonexistent" + p },
    permissions: { request: async () => true },
  };
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("notes", { create: true });
})();
