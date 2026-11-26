// src/share.js syncing shared trips end to end: devices in vms (merge.js
// and share.js as the app runs them) against server/worker.js on SQLite
// (`node test/share-sync.test.js`).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
process.removeAllListeners("warning");
const { DatabaseSync } = require("node:sqlite");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + (e.stack || e.message)); }
}

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const J = (x) => JSON.parse(JSON.stringify(x));
const SERVER = "https://tripboard.danielnoam1999.workers.dev";

function fakeEnv() {
  const sql = new DatabaseSync(":memory:");
  const dir = path.join(ROOT, "server/migrations");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) sql.exec(fs.readFileSync(path.join(dir, f), "utf8"));
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    first: async () => sql.prepare(q).get(...args) || null,
    run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; },
  });
  const kv = new Map();
  return {
    DB: { prepare: (q) => stmt(q), batch: async (list) => { sql.exec("BEGIN"); try { for (const s of list) await s.run(); sql.exec("COMMIT"); } catch (e) { sql.exec("ROLLBACK"); throw e; } } },
    FILES: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } },
  };
}

// One device: its doc, its IndexedDB notes, and share.js talking to the Worker.
function device(W, env, me, doc) {
  const meta = new Map();
  let version = 0;
  const w = {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    navigator: {},
    location: { hostname: "danielnoam.github.io", origin: "https://danielnoam.github.io", pathname: "/Tripboard/" },
    fetch: (url, opt = {}) => W.handle(new Request(url, opt), env),
    URL, Blob, Response, setTimeout: () => 0, clearTimeout() {}, setInterval() {}, addEventListener() {},
    Keel: { releases: { metaSite: () => "https://danielnoam.github.io/Tripboard/" } },
  };
  w.window = w;
  w.Tripboard = { settings: { get: () => ({ me }) } };
  vm.createContext(w);
  vm.runInContext(read("src/merge.js"), w);
  vm.runInContext(read("src/share.js"), w);
  const d = { doc, S: w.Tripboard.share, meta, unshared: [] };
  d.S.start({
    getDoc: () => d.doc, adopt: (x) => { d.doc = J(x); version++; }, version: () => version,
    store: { meta: async (k) => meta.get(k), setMeta: async (k, v) => meta.set(k, J(v)), file: async () => null, cover: async () => null },
    unshared: (id, why) => d.unshared.push([id, why]),
  });
  d.edit = (fn) => { fn(d.doc); version++; };
  return d;
}

const tripDoc = () => ({
  trips: [{ id: "kyoto", name: "Kyoto", owner: "ana", members: [{ id: "ana", name: "Ana", role: "owner" }], updatedAt: "2026-11-01T00:00:00.000Z" }],
  places: [{ id: "p1", trip: "kyoto", name: "Fushimi Inari", updatedAt: "2026-11-01T00:00:00.000Z" }],
  expenses: [], files: [], deleted: {},
});

(async () => {
  const W = await import("../server/worker.js");

  await test("a device that takes a trip's key from shares.json keeps what others added and changed", async () => {
    const env = fakeEnv();
    const ana = device(W, env, { id: "ana", name: "Ana" }, tripDoc());
    // Ana's other device has the trip from GitHub sync, as it was when shared.
    const ana2 = device(W, env, { id: "ana", name: "Ana" }, tripDoc());
    const { link } = await ana.S.invite(ana.doc.trips[0]);
    const code = /#\/join\/kyoto\/([\w-]+)/.exec(link)[1];
    const ben = device(W, env, { id: "ben", name: "Ben" }, { trips: [], places: [], expenses: [], files: [], deleted: {} });
    await ben.S.join("kyoto", code);
    ben.edit((doc) => {
      doc.places.push({ id: "p2", trip: "kyoto", name: "Kinkaku-ji", updatedAt: "2026-11-02T00:00:00.000Z" });
      Object.assign(doc.places.find((p) => p.id === "p1"), { note: "go early", updatedAt: "2026-11-02T00:00:00.000Z" });
    });
    await ben.S.now();
    await ana2.S.adoptKeys(await ana.S.keys());
    await ana2.S.now();
    await ben.S.now();
    const names = ben.doc.places.filter((p) => p.trip === "kyoto").map((p) => p.name).sort();
    assert.deepStrictEqual(names, ["Fushimi Inari", "Kinkaku-ji"]);
    assert.strictEqual(ben.doc.places.find((p) => p.id === "p1").note, "go early");
    assert.ok(ana2.doc.places.some((p) => p.id === "p2"), "Ana's other device gets Ben's place");
  });

  await test("a join the server refuses keeps no key and throws its reason", async () => {
    const env = fakeEnv();
    const ana = device(W, env, { id: "ana", name: "Ana" }, tripDoc());
    const { link } = await ana.S.invite(ana.doc.trips[0]);
    const code = /#\/join\/kyoto\/([\w-]+)/.exec(link)[1];
    // Ana's own id joining through her own link: the server says 409.
    const ana2 = device(W, env, { id: "ana", name: "Ana" }, { trips: [], places: [], expenses: [], files: [], deleted: {} });
    await assert.rejects(() => ana2.S.join("kyoto", code), /already on the trip/);
    assert.strictEqual(ana2.S.shared("kyoto"), null);
    assert.strictEqual(JSON.stringify(await ana2.S.keys()), "{}");
  });

  await test("sharing a trip the server already has throws, and keeps no key", async () => {
    const env = fakeEnv();
    const ana = device(W, env, { id: "ana", name: "Ana" }, tripDoc());
    await ana.S.invite(ana.doc.trips[0]);
    const ana2 = device(W, env, { id: "ana", name: "Ana" }, tripDoc());
    await assert.rejects(() => ana2.S.invite(ana2.doc.trips[0]), /already shared/);
    assert.strictEqual(ana2.S.shared("kyoto"), null);
  });

  await test("two editors' changes to the same trip both land", async () => {
    const env = fakeEnv();
    const ana = device(W, env, { id: "ana", name: "Ana" }, tripDoc());
    const { link } = await ana.S.invite(ana.doc.trips[0]);
    const code = /#\/join\/kyoto\/([\w-]+)/.exec(link)[1];
    await ana.S.now();
    const ben = device(W, env, { id: "ben", name: "Ben" }, { trips: [], places: [], expenses: [], files: [], deleted: {} });
    await ben.S.join("kyoto", code);
    await ana.S.now();
    ana.edit((doc) => doc.places.push({ id: "pa", trip: "kyoto", name: "Nishiki", updatedAt: "2026-11-03T00:00:00.000Z" }));
    ben.edit((doc) => doc.places.push({ id: "pb", trip: "kyoto", name: "Gion", updatedAt: "2026-11-03T00:00:00.000Z" }));
    await ana.S.now();
    await ben.S.now();
    await ana.S.now();
    for (const d of [ana, ben]) assert.deepStrictEqual(d.doc.places.map((p) => p.id).sort(), ["p1", "pa", "pb"]);
  });

  console.log(passed + " passed");
})();
