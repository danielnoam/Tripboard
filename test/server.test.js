// server/: the sharing Worker against a real SQLite (node:sqlite, as D1 is
// SQLite) and an in-memory KV (`node test/server.test.js`).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
process.removeAllListeners("warning");
const { DatabaseSync } = require("node:sqlite");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + (e.stack || e.message)); }
}

function fakeEnv() {
  const sql = new DatabaseSync(":memory:");
  const dir = path.join(__dirname, "../server/migrations");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) sql.exec(fs.readFileSync(path.join(dir, f), "utf8"));
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    first: async () => sql.prepare(q).get(...args) || null,
    all: async () => ({ results: sql.prepare(q).all(...args) }),
    run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; },
  });
  const kv = new Map();
  return {
    DB: { prepare: (q) => stmt(q), batch: async (list) => { sql.exec("BEGIN"); try { for (const s of list) await s.run(); sql.exec("COMMIT"); } catch (e) { sql.exec("ROLLBACK"); throw e; } } },
    FILES: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } },
    kv,
  };
}

(async () => {
  const W = await import("../server/worker.js");
  const env = fakeEnv();
  const call = async (method, p, body, key, raw) => {
    const headers = {};
    if (key) headers.Authorization = "Bearer " + key;
    const r = await W.handle(new Request("https://share.test" + p, { method, headers, body: raw || (body ? JSON.stringify(body) : undefined) }), env);
    const ct = r.headers.get("Content-Type") || "";
    return { status: r.status, body: ct.includes("json") ? await r.json() : new Uint8Array(await r.arrayBuffer()) };
  };
  const bundle = () => ({ format: 1, trip: { id: "kyoto", name: "Kyoto", owner: "ana", members: [{ id: "ana", name: "Ana", role: "owner" }], updatedAt: "2026-11-01" },
    places: [{ id: "p1", trip: "kyoto", name: "Fushimi Inari" }], expenses: [{ id: "x1", trip: "kyoto", amount: 100, currency: "JPY" }],
    files: [{ id: "f1", trip: "kyoto", name: "pass.pdf", type: "application/pdf", size: 3 }], deleted: {} });
  let ana, ben, cy, code;

  await test("the server says it's a Tripboard sharing server, for the app's address check", async () => {
    const r = await call("GET", "/");
    assert.deepStrictEqual([r.status, r.body], [200, { tripboard: "sharing" }]);
  });

  await test("sharing a trip makes its owner a key; a second share of it is refused", async () => {
    const r = await call("POST", "/trips", { bundle: bundle(), person: { id: "ana", name: "Ana" } });
    assert.strictEqual(r.status, 201);
    ana = r.body.key;
    assert.ok(ana.length >= 40);
    assert.strictEqual((await call("POST", "/trips", { bundle: bundle(), person: { id: "eve" } })).status, 409);
    assert.strictEqual((await call("GET", "/trips/kyoto")).status, 401);
    assert.strictEqual((await call("GET", "/trips/kyoto", null, "wrong")).status, 401);
    const g = await call("GET", "/trips/kyoto", null, ana);
    assert.deepStrictEqual([g.body.role, g.body.version, g.body.bundle.places.length], ["owner", 1, 1]);
    assert.deepStrictEqual((await call("GET", "/trips/kyoto?v=1", null, ana)).body, { same: true, version: 1 });
  });

  await test("an invite link lets people join; it can't be used to become the owner or someone already in", async () => {
    const inv = await call("POST", "/trips/kyoto/invite", null, ana);
    code = inv.body.code;
    assert.ok(code && inv.body.expires);
    assert.strictEqual((await call("POST", "/trips/kyoto/join", { code: "nope", person: { id: "ben" } })).status, 403);
    assert.strictEqual((await call("POST", "/trips/kyoto/join", { code, person: { id: "ana", name: "Fake" } })).status, 409);
    const j = await call("POST", "/trips/kyoto/join", { code, person: { id: "ben", name: "Ben" } });
    assert.strictEqual(j.status, 200);
    ben = j.body.key;
    assert.deepStrictEqual([j.body.role, j.body.version], ["editor", 2]);
    assert.strictEqual((await call("POST", "/trips/kyoto/join", { code, person: { id: "ben", name: "Ben again" } })).status, 409);
    cy = (await call("POST", "/trips/kyoto/join", { code, person: { id: "cy", name: "Cy" } })).body.key;
    const members = (await call("GET", "/trips/kyoto", null, ana)).body.bundle.trip.members;
    assert.deepStrictEqual(members.map((m) => m.id), ["ana", "ben", "cy"]);
    // only the owner invites
    assert.strictEqual((await call("POST", "/trips/kyoto/invite", null, ben)).status, 403);
  });

  await test("a write needs the latest version; an editor can't change who's on the trip", async () => {
    let g = (await call("GET", "/trips/kyoto", null, ben)).body;
    const b = g.bundle;
    b.places.push({ id: "p2", trip: "kyoto", name: "Nishiki" });
    b.trip.members = [{ id: "ben", role: "owner" }];
    b.trip.share = { role: "viewer", hide: [] };
    b.trip.owner = "ben";
    const stale = await call("PUT", "/trips/kyoto", { version: g.version - 1, bundle: b }, ben);
    assert.strictEqual(stale.status, 409);
    assert.strictEqual(stale.body.version, g.version);
    const ok = await call("PUT", "/trips/kyoto", { version: g.version, bundle: b }, ben);
    assert.strictEqual(ok.status, 200);
    g = (await call("GET", "/trips/kyoto", null, ana)).body;
    assert.deepStrictEqual(g.bundle.places.map((p) => p.name), ["Fushimi Inari", "Nishiki"]);
    assert.deepStrictEqual([g.bundle.trip.owner, g.bundle.trip.members.map((m) => m.id), g.bundle.trip.share], ["ana", ["ana", "ben", "cy"], undefined]);
  });

  await test("a viewer can't write, and a hidden section is never sent or overwritten", async () => {
    let g = (await call("GET", "/trips/kyoto", null, ana)).body;
    const b = g.bundle;
    b.trip.share = { role: "viewer", hide: [] };
    b.trip.members.find((m) => m.id === "ben").role = "editor";
    b.trip.members.find((m) => m.id === "ben").hide = ["expenses"];
    assert.strictEqual((await call("PUT", "/trips/kyoto", { version: g.version, bundle: b }, ana)).status, 200);
    const asCy = (await call("GET", "/trips/kyoto", null, cy)).body;
    assert.strictEqual(asCy.role, "viewer");
    asCy.bundle.places = [];
    assert.strictEqual((await call("PUT", "/trips/kyoto", { version: asCy.version, bundle: asCy.bundle }, cy)).status, 403);
    assert.strictEqual((await call("PUT", "/trips/kyoto/files/f1", null, cy, new Uint8Array([1]))).status, 403);
    const asBen = (await call("GET", "/trips/kyoto", null, ben)).body;
    assert.deepStrictEqual([asBen.role, asBen.hidden, "expenses" in asBen.bundle, asBen.bundle.files.length], ["editor", ["expenses"], false, 1]);
    asBen.bundle.expenses = [];
    asBen.bundle.trip.name = "Kyoto and Nara";
    assert.strictEqual((await call("PUT", "/trips/kyoto", { version: asBen.version, bundle: asBen.bundle }, ben)).status, 200);
    g = (await call("GET", "/trips/kyoto", null, ana)).body;
    assert.deepStrictEqual([g.bundle.trip.name, g.bundle.expenses.length], ["Kyoto and Nara", 1]);
  });

  await test("file bytes: only for those who see files, and only for a file the trip has", async () => {
    assert.strictEqual((await call("PUT", "/trips/kyoto/files/f1", null, ana, new Uint8Array([7, 8, 9]))).status, 200);
    assert.strictEqual((await call("PUT", "/trips/kyoto/files/zz", null, ana, new Uint8Array([1]))).status, 409);
    assert.deepStrictEqual([...(await call("GET", "/trips/kyoto/files/f1", null, cy)).body], [7, 8, 9]);
    let g = (await call("GET", "/trips/kyoto", null, ana)).body;
    g.bundle.trip.members.find((m) => m.id === "cy").hide = ["files"];
    await call("PUT", "/trips/kyoto", { version: g.version, bundle: g.bundle }, ana);
    assert.strictEqual((await call("GET", "/trips/kyoto/files/f1", null, cy)).status, 403);
    assert.strictEqual("files" in (await call("GET", "/trips/kyoto", null, cy)).body.bundle, false);
    // a file deleted from the trip loses its bytes
    g = (await call("GET", "/trips/kyoto", null, ana)).body;
    g.bundle.files = [];
    await call("PUT", "/trips/kyoto", { version: g.version, bundle: g.bundle }, ana);
    assert.strictEqual(env.kv.has("kyoto/f1"), false);
  });

  await test("taking someone off the trip ends their key; leaving does too; the owner can't leave", async () => {
    let g = (await call("GET", "/trips/kyoto", null, ana)).body;
    g.bundle.trip.members = g.bundle.trip.members.filter((m) => m.id !== "cy");
    await call("PUT", "/trips/kyoto", { version: g.version, bundle: g.bundle }, ana);
    assert.strictEqual((await call("GET", "/trips/kyoto", null, cy)).status, 401);
    assert.strictEqual((await call("DELETE", "/trips/kyoto/me", null, ana)).status, 403);
    assert.strictEqual((await call("DELETE", "/trips/kyoto/me", null, ben)).status, 200);
    assert.strictEqual((await call("GET", "/trips/kyoto", null, ben)).status, 401);
    g = (await call("GET", "/trips/kyoto", null, ana)).body;
    assert.deepStrictEqual(g.bundle.trip.members.map((m) => m.id), ["ana"]);
  });

  await test("a stopped invite link no longer works; deleting the trip removes everything", async () => {
    await call("DELETE", "/trips/kyoto/invite", null, ana);
    assert.strictEqual((await call("POST", "/trips/kyoto/join", { code, person: { id: "dee" } })).status, 403);
    await call("PUT", "/trips/kyoto/cover", null, ana, new Uint8Array([1]));
    assert.strictEqual((await call("DELETE", "/trips/kyoto", null, ana)).status, 200);
    assert.strictEqual((await call("GET", "/trips/kyoto", null, ana)).status, 404);
    assert.strictEqual(env.kv.size, 0);
  });

  await test("the server's access rule matches the app's (src/model.js)", async () => {
    global.window = {};
    const M = require("../src/model.js");
    const trip = M.sanitizeTrip({ id: "t", name: "T", owner: "a", share: { role: "viewer", hide: ["files"] },
      members: [{ id: "a" }, { id: "b", role: "editor" }, { id: "c", hide: [] }, { id: "d", role: "viewer", hide: ["expenses", "files"] }] });
    for (const id of ["a", "b", "c", "d"]) {
      const s = W.access(trip, id), m = M.access(trip, id);
      assert.deepStrictEqual([s.role, s.hide], [m.role, m.hide], id);
    }
    assert.strictEqual(W.access(trip, "stranger"), null);
  });

  await test("too many shares from one address in a day are refused", async () => {
    for (let i = 0; i < 30; i++) await call("POST", "/trips", { bundle: { ...bundle(), trip: { ...bundle().trip, id: "t" + i } }, person: { id: "ana" } });
    assert.strictEqual((await call("POST", "/trips", { bundle: { ...bundle(), trip: { ...bundle().trip, id: "t99" } }, person: { id: "ana" } })).status, 429);
  });

  await test("a Google Maps list from its share link: the short link followed, the places read, other hosts refused", async () => {
    const GL = await import("../server/googlelist.js");
    const answer = ")]}'\n" + JSON.stringify([[null, null, null, null, "Lisbon eats", null, null, null, [
      [null, [null, null, null, null, "R. da Bica 1", [null, null, 38.7101, -9.1463]], "Time Out Market", "Go hungry"],
      [null, [null, null, null, null, "", [null, null, 38.7139, -9.1334]], "Feira da Ladra", ""],
      [null, null, "", ""],
    ]]]);
    const seen = [];
    env.FETCH = async (u) => {
      seen.push(u);
      if (u.startsWith("https://maps.app.goo.gl/")) return new Response(null, { status: 302, headers: { Location: "https://www.google.com/maps/@/data=!3m1!4b1!4m3!11m2!2sAbCdEfGh12345!3e3" } });
      if (u.includes("entitylist/getlist")) return new Response(answer);
      return new Response("no", { status: 404 });
    };
    const r = await W.handle(new Request("https://share.test/google-list", { method: "POST", body: JSON.stringify({ url: "https://maps.app.goo.gl/xyz123" }) }), env);
    const got = await r.json();
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(got, { title: "Lisbon eats", places: [
      { name: "Time Out Market", lat: 38.7101, lng: -9.1463, note: "Go hungry" }, { name: "Feira da Ladra", lat: 38.7139, lng: -9.1334 }] });
    assert.ok(seen[1].includes(encodeURIComponent("!1sAbCdEfGh12345")));
    const bad = await W.handle(new Request("https://share.test/google-list", { method: "POST", body: JSON.stringify({ url: "https://evil.example/maps" }) }), env);
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(GL.listId("https://www.google.com/maps/placelists/list/ZZ99yyXX11"), "ZZ99yyXX11");
    delete env.FETCH;
  });

  await test("publishing: anyone with the link reads it; only the key changes or removes it; only the plan is kept", async () => {
    const b = bundle();
    b.trip.share = { role: "viewer" };
    b.places[0].rating = 5; b.places[0].visited = true; b.places[0].secret = "x";
    b.files.push({ id: "l1", trip: "kyoto", kind: "link", url: "https://example.com", name: "Guide" });
    const r = await call("POST", "/published", { bundle: b, by: "Ana", dates: false });
    assert.strictEqual(r.status, 201);
    const { id, key } = r.body;
    assert.ok(id.length >= 16 && key.length >= 40);
    const g = await call("GET", "/published/" + id);
    assert.deepStrictEqual([g.status, g.body.by, g.body.dates, g.body.copies], [200, "Ana", false, 0]);
    assert.deepStrictEqual(Object.keys(g.body.bundle.trip).sort(), ["id", "name", "updatedAt"]);
    assert.deepStrictEqual(g.body.bundle.places, [{ id: "p1", trip: "kyoto", name: "Fushimi Inari" }]);
    assert.deepStrictEqual([g.body.bundle.expenses, g.body.bundle.files.map((f) => f.id)], [[], ["l1"]]);
    assert.strictEqual((await call("PUT", "/published/" + id, { bundle: b, by: "Eve" })).status, 401);
    assert.strictEqual((await call("PUT", "/published/" + id, { bundle: b, by: "Eve" }, "wrong")).status, 401);
    assert.strictEqual((await call("DELETE", "/published/" + id, null, "wrong")).status, 401);
    b.trip.name = "Kyoto again";
    assert.strictEqual((await call("PUT", "/published/" + id, { bundle: b, by: "Ana", dates: true }, key)).status, 200);
    const g2 = (await call("GET", "/published/" + id)).body;
    assert.deepStrictEqual([g2.bundle.trip.name, g2.dates], ["Kyoto again", true]);
    assert.deepStrictEqual((await call("POST", "/published/" + id + "/copied")).body, { copies: 1 });
    assert.strictEqual((await call("POST", "/published", { bundle: { trip: { id: "../x" } } })).status, 400);
    assert.strictEqual((await call("DELETE", "/published/" + id, null, key)).status, 200);
    assert.strictEqual((await call("GET", "/published/" + id)).status, 404);
    assert.strictEqual((await call("POST", "/published/" + id + "/copied")).status, 404);
  });

  await test("server/ stands on its own: server/app/ holds the app files the bundle takes in, as they are", async () => {
    const { stale } = require("../tools/server-copy.js");
    assert.deepStrictEqual(stale(), [], "server/app/ is out of date. Run node tools/server-copy.js.");
    for (const f of fs.readdirSync(path.join(__dirname, "..", "server")).filter((n) => n.endsWith(".js"))) {
      const text = fs.readFileSync(path.join(__dirname, "..", "server", f), "utf8");
      assert.ok(!/from "\.\.\//.test(text) && !/require\("\.\.\//.test(text), "server/" + f + " reaches outside server/");
    }
  });

  console.log(passed + " passed");
})();
