/* tiny IndexedDB key-value store; chrome.storage can't hold FileSystemDirectoryHandle, IndexedDB can */

let db = null;

function open() {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("newtab", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return db;
}

async function tx(mode, fn) {
  const store = (await open()).transaction("kv", mode).objectStore("kv");
  return new Promise((resolve, reject) => {
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const idbGet = (key) => tx("readonly", (s) => s.get(key));
export const idbSet = (key, value) => tx("readwrite", (s) => s.put(value, key));
