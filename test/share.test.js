// src/share.js's sharing servers, and sw.js adding the ones a device uses
// to the page's CSP (`node test/share.test.js`). share.js runs in a vm with
// a stand-in browser: localStorage, the Cache API, the page's CSP meta
// and a fake server.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + (e.stack || e.message)); }
}

const ROOT = path.join(__dirname, "..");
const J = (x) => JSON.parse(JSON.stringify(x));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const MAIN = "https://tripboard.danielnoam1999.workers.dev";
const OWN = "https://tripboard.maya.workers.dev";
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(read("index.html"))[1];

// bundled: the phone and desktop apps' page (tools/build-www.js): a policy
// with "https:" in connect-src, and src/csp.js's with the allowed servers.
function browser({ allowed = [], bundled = false } = {}) {
  const store = new Map(), cache = new Map(), calls = [];
  const meta = { content: csp.replace("connect-src 'self'", "connect-src 'self' " + allowed.join(" ")) };
  const metas = bundled ? [{ content: csp.replace("connect-src 'self'", "connect-src 'self' https:") }, meta] : [meta];
  const metaDb = new Map();
  const w = {
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    caches: { open: async () => ({ put: async (k, r) => cache.set(k, await r.text()), match: async (k) => cache.get(k) }) },
    document: {
      querySelector: (sel) => (sel.includes("tripboard-csp") ? (bundled ? { content: csp } : null) : metas[0]),
      querySelectorAll: () => metas, addEventListener() {},
    },
    navigator: {},
    location: { hostname: "danielnoam.github.io", origin: "https://danielnoam.github.io", pathname: "/Tripboard/" },
    fetch: async (url, opt = {}) => {
      calls.push([opt.method || "GET", url]);
      const body = { key: "k-" + calls.length, version: 1, code: "c0de", expires: "2026-12-01T00:00:00Z", bundle: { trip: { id: "t1", name: "Lisbon" } }, role: "editor", hidden: [] };
      return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => body };
    },
    Response: class { constructor(t) { this.t = t; } async text() { return this.t; } },
    URL, setTimeout: () => 0, clearTimeout() {}, setInterval() {}, addEventListener() {},
    Keel: { releases: { metaSite: () => "https://danielnoam.github.io/Tripboard/" } },
  };
  w.window = w;
  w.Tripboard = {
    merge: { bundleOf: () => ({ trip: { id: "t1", name: "Lisbon" } }), applyBundle: (d) => d },
    settings: { get: () => ({ me: { id: "me1", name: "Dana" } }) },
  };
  vm.createContext(w);
  vm.runInContext(read("src/share.js"), w);
  const S = w.Tripboard.share;
  S.start({ getDoc: () => ({}), adopt() {}, version: () => 1, store: { meta: async (k) => metaDb.get(k), setMeta: async (k, v) => metaDb.set(k, v) } });
  return { S, store, cache, calls, w };
}

(async () => {
  await test("an address becomes an https origin, or nothing", async () => {
    const { S } = browser();
    assert.strictEqual(S.origin("tripboard.maya.workers.dev"), OWN);
    assert.strictEqual(S.origin(" https://Tripboard.Maya.workers.dev/ "), OWN);
    assert.strictEqual(S.origin("https://share.example.com:8443"), "https://share.example.com:8443");
    for (const bad of ["http://tripboard.maya.workers.dev", "https://x.dev/path", "https://u:p@x.dev", "javascript:alert(1)", "https://localhost", "https://x.dev?q=1", "", "not a url"]) assert.strictEqual(S.origin(bad), null, bad);
  });

  await test("Tripboard's server is the default; your own goes to the list sw.js reads", async () => {
    const { S, cache } = browser();
    assert.strictEqual(S.server(), MAIN);
    const r = await S.setServer("tripboard.maya.workers.dev");
    assert.deepStrictEqual([S.server(), r.reload], [OWN, true]);
    assert.deepStrictEqual(JSON.parse(cache.get("servers")), [OWN]);
    await S.setServer(null);
    assert.strictEqual(S.server(), MAIN);
    assert.deepStrictEqual(JSON.parse(cache.get("servers")), []);
    await assert.rejects(S.setServer("http://plain.example.com"), /isn't a server address/);
  });

  await test("a server the page's CSP doesn't allow yet isn't called: open the app again", async () => {
    const { S, calls } = browser();
    await S.setServer(OWN);
    await assert.rejects(S.invite({ id: "t1" }), (e) => e.kind === "reload");
    assert.deepStrictEqual(calls, []);
  });

  await test("a trip shared on your own server stays there, and its invite link names it", async () => {
    const { S, calls, cache } = browser({ allowed: [OWN] });
    await S.setServer(OWN);
    const inv = await S.invite({ id: "t1" });
    assert.strictEqual(inv.link, "https://danielnoam.github.io/Tripboard/#/join/t1/c0de/tripboard.maya.workers.dev");
    assert.ok(calls.every(([, url]) => url.startsWith(OWN + "/")));
    await S.setServer(null);
    assert.deepStrictEqual(JSON.parse(cache.get("servers")), [OWN], "the shared trip still needs its server");
    calls.length = 0;
    await S.stopLink("t1");
    assert.deepStrictEqual(J(calls), [["DELETE", OWN + "/trips/t1/invite"]]);
    assert.deepStrictEqual(J(await S.keys()), { t1: { key: "k-1", server: OWN } });
  });

  await test("a link without a server joins on Tripboard's; with one, on that one", async () => {
    let b = browser();
    await b.S.join("t1", "c0de");
    assert.deepStrictEqual(J(b.calls[0]), ["POST", MAIN + "/trips/t1/join"]);
    assert.deepStrictEqual(J(await b.S.keys()), { t1: "k-1" });
    b = browser({ allowed: [OWN] });
    await b.S.allowJoin(OWN);
    await b.S.join("t1", "c0de", "tripboard.maya.workers.dev");
    assert.deepStrictEqual(J(b.calls[0]), ["POST", OWN + "/trips/t1/join"]);
    assert.strictEqual(b.store.get("tripboard.joinServer"), undefined);
    await assert.rejects(browser().S.join("t2", "c0de", "evil host"), /broken/);
  });

  await test("keys from the sync repo keep their server; older copies' plain keys are Tripboard's", async () => {
    const { S, cache } = browser();
    await S.adoptKeys({ a: "k1", b: { key: "k2", server: OWN }, c: { key: "k3", server: "http://bad.example.com" }, d: { key: 5 } });
    assert.deepStrictEqual(J(await S.keys()), { a: "k1", b: { key: "k2", server: OWN } });
    assert.deepStrictEqual(JSON.parse(cache.get("servers")), [OWN]);
  });

  await test("sw.js adds only https origins to connect-src, and nothing when there are none", async () => {
    const ctx = { self: { addEventListener() {}, location: { origin: "https://danielnoam.github.io" }, KeelPreview: { create: () => ({}) } }, importScripts() {} };
    vm.createContext(ctx);
    vm.runInContext(read("sw.js"), ctx);
    const html = read("index.html");
    assert.strictEqual(ctx.allowServers(html, []), html);
    const out = ctx.allowServers(html, [OWN, "https://a.example.com:8443", "http://plain.example.com", "https://x.dev; script-src *", "*", 5]);
    const got = /content="([^"]*)"/.exec(out.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)[0])[1];
    assert.strictEqual(got, csp.replace("connect-src 'self'", "connect-src 'self' " + OWN + " https://a.example.com:8443"));
  });

  await test("the phone and desktop apps can use your own server: share.js keeps the list src/csp.js reads", async () => {
    assert.strictEqual(browser().S.canUseOwn(), false);
    const { S, store } = browser({ bundled: true });
    assert.strictEqual(S.canUseOwn(), true);
    assert.strictEqual(S.allowed(OWN), false, "the wide policy alone doesn't let it through");
    const r = await S.setServer(OWN);
    assert.strictEqual(r.reload, true);
    assert.deepStrictEqual(JSON.parse(store.get("tripboard.servers")), [OWN]);
    await S.setServer(null);
    assert.strictEqual(store.get("tripboard.servers"), undefined);
    assert.strictEqual(browser({ bundled: true, allowed: [OWN] }).S.allowed(OWN), true);
  });

  await test("the apps' index.html: the policy with https: added, then csp.js writing the exact one first", async () => {
    const { bundledIndexHtml, appIndexHtml, desktopIndexHtml } = require("../tools/build-www.js");
    const html = read("index.html");
    for (const page of [appIndexHtml(html), desktopIndexHtml(html)]) {
      const out = bundledIndexHtml(page);
      const own = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(page)[1];
      const wide = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(out)[1];
      assert.ok(/connect-src [^;]* https:;/.test(wide));
      assert.strictEqual(wide.replace(" https:;", ";"), own, "nothing else in the policy changes");
      assert.strictEqual(/<meta name="tripboard-csp" content="([^"]*)">/.exec(out)[1], own);
      assert.ok(out.indexOf('<script src="src/csp.js">') < out.indexOf("<script src=\"src/keel/errlog.js"), "csp.js is the first script");
    }
  });

  await test("src/csp.js writes the page's policy with this device's https servers, and only those", async () => {
    const run = (saved) => {
      const added = [];
      const base = { content: csp, after: (m) => added.push(m) };
      const ctx = {
        document: { querySelector: () => base, createElement: () => ({}) },
        localStorage: { getItem: () => saved },
      };
      vm.createContext(ctx);
      vm.runInContext(read("src/csp.js"), ctx);
      return added;
    };
    assert.strictEqual(run(null)[0].content, csp);
    assert.strictEqual(run("not json")[0].content, csp, "a broken list still writes the policy");
    const [m] = run(JSON.stringify([OWN, "http://plain.example.com", "https://x.dev; script-src *", "*", 5]));
    assert.deepStrictEqual([m.httpEquiv, m.content], ["Content-Security-Policy", csp.replace("connect-src 'self'", "connect-src 'self' " + OWN)]);
  });

  console.log(passed + " passed");
})();
