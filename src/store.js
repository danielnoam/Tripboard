// Where Tripboard keeps trips, places and covers: IndexedDB on this device,
// nothing sent anywhere. One store, "kv": "doc" holds { trips, places },
// "cover:<trip id>" a trip's cover image as a Blob. Without IndexedDB (a
// private window in some browsers) it keeps them in memory for the visit
// and says so through `persistent`.
(function () {
  const DB = "tripboard", STORE = "kv";
  let db = null;
  const mem = new Map();

  function open() {
    return new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(DB, 1); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }
  function tx(mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  const get = (k) => (db ? tx("readonly", (s) => s.get(k)) : Promise.resolve(mem.get(k)));
  const put = (k, v) => (db ? tx("readwrite", (s) => s.put(v, k)) : Promise.resolve(void mem.set(k, v)));
  const del = (k) => (db ? tx("readwrite", (s) => s.delete(k)) : Promise.resolve(void mem.delete(k)));

  // Saves are queued one after another, so an older save never lands last.
  let chain = Promise.resolve();
  const store = {
    persistent: false,
    async init() { db = await open(); store.persistent = !!db; },
    load: () => get("doc"),
    save(doc) { chain = chain.then(() => put("doc", doc)).catch((e) => window.Keel.errlog.note("save", String(e))); return chain; },
    cover: (id) => get("cover:" + id),
    setCover: (id, blob) => put("cover:" + id, blob),
    dropCover: (id) => del("cover:" + id),
  };
  window.Tripboard = window.Tripboard || {};
  window.Tripboard.store = store;
})();
