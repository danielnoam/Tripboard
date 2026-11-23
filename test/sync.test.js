// src/sync.js, GitHub sync, end to end (`node test/sync.test.js`): each
// device is its own vm with the real settings.js, model.js, merge.js and
// keel's github.js, syncing with an in-memory GitHub (fakegithub.js).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const fakeGitHub = require("./fakegithub.js");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + (e.stack || e.message)); }
}

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const J = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const at = (n) => "2026-11-23T10:00:" + String(n).padStart(2, "0") + ".000Z";

// One device: its doc, its IndexedDB (meta, covers, files) and its sync.
function device(g, { connected = true } = {}) {
  const ls = new Map(), meta = new Map(), covers = new Map(), files = new Map();
  const w = {
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
    document: { addEventListener() {}, visibilityState: "visible" },
    navigator: {}, crypto: globalThis.crypto, TextEncoder, TextDecoder, atob, btoa, Blob, URL,
    fetch: (...a) => g.fetch(...a),
    setTimeout: () => 0, clearTimeout() {}, setInterval() {}, addEventListener() {},
    Keel: { errlog: { note() {} } },
  };
  w.window = w;
  w.globalThis = w;
  vm.createContext(w);
  for (const f of ["src/keel/github.js", "src/model.js", "src/settings.js", "src/merge.js", "src/sync.js"]) vm.runInContext(read(f), w, { filename: f });
  const T = w.Tripboard;
  if (connected) T.settings.setSync({ token: "tok", owner: "me", repo: "data", branch: "main" });
  const d = { T, doc: T.model.sanitizeDoc({}), version: 0, came: [], covers, files, meta };
  d.edit = (fn) => { const next = J(d.doc); fn(next); T.model.stamp(d.doc, next); d.doc = T.model.sanitizeDoc(next); d.version++; };
  T.sync.start({
    getDoc: () => d.doc,
    adopt: (next) => { next = T.model.sanitizeDoc(next); d.came.push(T.merge.arrivals(d.doc, next)); d.doc = next; },
    version: () => d.version,
    store: {
      meta: async (k) => J(meta.get(k)), setMeta: async (k, v) => meta.set(k, J(v)),
      cover: async (id) => covers.get(id), setCover: async (id, b) => covers.set(id, b), dropCover: async (id) => covers.delete(id),
      file: async (id) => files.get(id), setFile: async (id, b) => files.set(id, b),
    },
    coverChanged() {},
  });
  d.sync = async () => { await T.sync.now(); return T.sync.status; };
  d.names = () => J(d.doc.trips.map((t) => t.name).sort());
  return d;
}
const tripsIn = (g) => [...g.files().keys()].filter((p) => /^trips\//.test(p));
const names = (list) => J(list.map((t) => t.name));

(async () => {
  await test("a trip made on one device reaches the other, and the other tells what came", async () => {
    const g = fakeGitHub();
    const a = device(g), b = device(g);
    a.edit((doc) => doc.trips.push({ id: "k", name: "Kyoto", start: "2027-04-02", end: "2027-04-05" }));
    assert.strictEqual((await a.sync()).state, "idle");
    assert.deepStrictEqual(tripsIn(g), ["trips/k.json"]);
    assert.ok(g.files().has("me.json"));
    await b.sync();
    assert.deepStrictEqual(b.names(), ["Kyoto"]);
    assert.deepStrictEqual(names(b.came.at(-1).added), ["Kyoto"]);
    // Both on the same person id: b took a's from me.json.
    assert.strictEqual(b.T.settings.get().me.id, a.T.settings.get().me.id);
  });

  await test("a sync with nothing new writes nothing and tells nothing", async () => {
    const g = fakeGitHub();
    const a = device(g);
    a.edit((doc) => doc.trips.push({ id: "k", name: "Kyoto" }));
    await a.sync();
    const commits = g.commits;
    a.came.length = 0;
    await a.sync();
    assert.strictEqual(g.commits, commits);
    assert.deepStrictEqual(a.came.length, 0);
  });

  await test("a trip the AI connector wrote to the repo arrives as new", async () => {
    const g = fakeGitHub();
    const a = device(g);
    await a.sync();
    g.put("trips/j.json", JSON.stringify({ format: 1, trip: { id: "j", name: "Japan 2023", createdAt: at(1), updatedAt: at(1) }, places: [], expenses: [], files: [], deleted: {} }));
    await a.sync();
    assert.deepStrictEqual(a.names(), ["Japan 2023"]);
    assert.deepStrictEqual(names(a.came.at(-1).added), ["Japan 2023"]);
  });

  await test("two devices change different fields of one place: both keep both", async () => {
    const g = fakeGitHub();
    const a = device(g), b = device(g);
    a.edit((doc) => { doc.trips.push({ id: "k", name: "Kyoto" }); doc.places.push({ id: "p", trip: "k", name: "Fushimi Inari" }); });
    await a.sync();
    await b.sync();
    a.edit((doc) => { doc.places[0].note = "Go early"; });
    b.edit((doc) => { doc.places[0].importance = "must"; });
    await a.sync();
    b.came.length = 0;
    await b.sync();
    await a.sync();
    for (const d of [a, b]) assert.deepStrictEqual(J([d.doc.places[0].note, d.doc.places[0].importance]), ["Go early", "must"]);
    assert.deepStrictEqual(names(b.came.at(-1).updated), ["Kyoto"]);
  });

  await test("a trip deleted on one device goes from the other, which tells it", async () => {
    const g = fakeGitHub();
    const a = device(g), b = device(g);
    a.edit((doc) => doc.trips.push({ id: "r", name: "Rome" }, { id: "k", name: "Kyoto" }));
    await a.sync();
    await b.sync();
    a.edit((doc) => { doc.trips = doc.trips.filter((t) => t.id !== "r"); });
    await a.sync();
    await b.sync();
    assert.deepStrictEqual(b.names(), ["Kyoto"]);
    assert.deepStrictEqual(names(b.came.at(-1).removed), ["Rome"]);
    assert.ok(g.read("trips/r.json").trip.deletedAt, "the repo keeps the deletion, so every device drops it");
  });

  await test("the repo moving on mid-sync makes it start over, and nothing is lost", async () => {
    const g = fakeGitHub();
    const a = device(g);
    a.edit((doc) => doc.trips.push({ id: "k", name: "Kyoto" }));
    g.moveBeforeNextPatch = () => g.put("trips/j.json", JSON.stringify({ format: 1, trip: { id: "j", name: "Japan", createdAt: at(1), updatedAt: at(1) }, places: [], expenses: [], files: [], deleted: {} }));
    assert.strictEqual((await a.sync()).state, "idle");
    assert.deepStrictEqual(a.names(), ["Japan", "Kyoto"]);
    assert.deepStrictEqual(tripsIn(g).sort(), ["trips/j.json", "trips/k.json"]);
  });

  await test("an edit made while a sync runs is kept, and synced next time", async () => {
    const g = fakeGitHub();
    const a = device(g);
    a.edit((doc) => doc.trips.push({ id: "k", name: "Kyoto" }));
    await a.sync();
    g.put("trips/j.json", JSON.stringify({ format: 1, trip: { id: "j", name: "Japan", createdAt: at(1), updatedAt: at(1) }, places: [], expenses: [], files: [], deleted: {} }));
    const real = g.fetch;
    let once = true;
    g.fetch = async (url, opt) => {
      if (once && /contents\/trips\/j\.json/.test(url)) { once = false; a.edit((doc) => { doc.trips.find((t) => t.id === "k").name = "Kyoto spring"; }); }
      return real(url, opt);
    };
    await a.sync();
    g.fetch = real;
    assert.deepStrictEqual(a.names(), ["Japan", "Kyoto spring"]);
    await a.sync();
    assert.strictEqual(g.read("trips/k.json").trip.name, "Kyoto spring");
  });

  await test("a cover and a synced file travel; a local file stays put", async () => {
    const g = fakeGitHub();
    const a = device(g), b = device(g);
    a.edit((doc) => {
      doc.trips.push({ id: "k", name: "Kyoto", cover: true, coverAt: at(2) });
      doc.files.push({ id: "f1", trip: "k", name: "ticket.pdf", type: "application/pdf", size: 3 }, { id: "f2", trip: "k", name: "passport.jpg", type: "image/jpeg", size: 3, local: true });
    });
    a.covers.set("k", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }));
    a.files.set("f1", new Blob([new Uint8Array([4, 5, 6])]));
    a.files.set("f2", new Blob([new Uint8Array([7, 8, 9])]));
    await a.sync();
    assert.ok(g.files().has("covers/k.jpg") && g.files().has("files/k/f1"));
    assert.ok(!g.files().has("files/k/f2"));
    await b.sync();
    assert.deepStrictEqual([...new Uint8Array(await b.covers.get("k").arrayBuffer())], [1, 2, 3]);
    assert.deepStrictEqual([...new Uint8Array(await b.files.get("f1").arrayBuffer())], [4, 5, 6]);
    assert.deepStrictEqual(J(b.doc.files.map((f) => f.id)), ["f1"]);
  });

  await test("a link and a note reach the other device in the trip, with no bytes asked for or sent", async () => {
    const g = fakeGitHub();
    const a = device(g), b = device(g);
    a.edit((doc) => {
      doc.trips.push({ id: "k", name: "Kyoto" });
      doc.files.push({ id: "l1", trip: "k", kind: "link", url: "https://www.jreast.co.jp/en/", name: "IC card" }, { id: "n1", trip: "k", kind: "note", name: "Phrasebook", text: "Sumimasen\nArigatou" });
    });
    await a.sync();
    assert.ok(![...g.files().keys()].some((p) => p.startsWith("files/")));
    let asked = 0;
    const read = b.files.get.bind(b.files);
    b.files.get = (id) => { if (id === "l1" || id === "n1") asked++; return read(id); };
    await b.sync();
    assert.deepStrictEqual(J(b.doc.files.map((f) => [f.kind, f.url || f.text])), [["link", "https://www.jreast.co.jp/en/"], ["note", "Sumimasen\nArigatou"]]);
    assert.strictEqual(asked, 0);
  });

  await test("a refused token and no connection end as errors Settings can explain", async () => {
    const g = fakeGitHub();
    const a = device(g);
    a.T.settings.setSync({ token: "wrong" });
    let st = await a.sync();
    assert.deepStrictEqual([st.state, st.error.kind], ["error", "auth"]);
    assert.match(a.T.sync.explain(st.error), /refused the token/);
    a.T.settings.setSync({ token: "tok" });
    const real = g.fetch;
    g.fetch = async () => { throw new TypeError("Failed to fetch"); };
    st = await a.sync();
    assert.deepStrictEqual([st.state, st.error.kind], ["error", "offline"]);
    g.fetch = real;
    st = await a.sync();
    assert.deepStrictEqual([st.state, st.error], ["idle", null]);
  });

  await test("not connected: off, and no call to GitHub", async () => {
    const g = fakeGitHub();
    const a = device(g, { connected: false });
    const real = g.fetch;
    let calls = 0;
    g.fetch = async (...x) => { calls++; return real(...x); };
    assert.strictEqual((await a.sync()).state, "off");
    assert.strictEqual(calls, 0);
  });

  console.log(passed + " passed");
})();
