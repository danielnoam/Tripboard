// cli/: the CLI and the MCP server against a fake GitHub (an in-memory
// git with the calls they make) (`node test/cli.test.js`).
const assert = require("assert");
const crypto = require("crypto");
const core = require("../cli/core.js");
const cli = require("../cli/tripboard.js");
const mcp = require("../cli/mcp.js");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + (e.stack || e.message)); }
}

function fakeGitHub() {
  const blobs = new Map(), trees = new Map(), commits = new Map();
  const sha = (s) => crypto.createHash("sha1").update(s).digest("hex");
  const putBlob = (buf) => { const s = sha(Buffer.concat([Buffer.from("blob " + buf.length + "\0"), buf])); blobs.set(s, buf); return s; };
  const putTree = (map) => { const s = sha(JSON.stringify([...map].sort())); trees.set(s, map); return s; };
  const putCommit = (tree, parents) => { const s = sha(tree + parents.join() + Math.random()); commits.set(s, { tree, parents }); return s; };
  const g = { head: putCommit(putTree(new Map([["README.md", putBlob(Buffer.from("# data\n"))]])), []), commits: 0, moveBeforeNextPatch: null };
  g.files = () => trees.get(commits.get(g.head).tree);
  g.read = (path) => JSON.parse(blobs.get(g.files().get(path)).toString());
  g.put = (path, text) => { const map = new Map(g.files()); map.set(path, putBlob(Buffer.from(text))); g.head = putCommit(putTree(map), [g.head]); };
  const res = (status, body) => ({ ok: status < 300, status, headers: { get: () => "" }, json: async () => body, text: async () => JSON.stringify(body),
    arrayBuffer: async () => body });
  g.fetch = async (url, { method = "GET", body, headers }) => {
    const u = new URL(url);
    const b = body ? JSON.parse(body) : null;
    if (headers.Authorization !== "Bearer tok") return res(401, { message: "Bad credentials" });
    if (u.pathname === "/repos/me/data") return res(200, { private: true, default_branch: "main" });
    const p = u.pathname.replace("/repos/me/data/", "");
    let x;
    if (p === "git/ref/heads/main") return res(200, { object: { sha: g.head } });
    if ((x = /^git\/trees\/(\w+)$/.exec(p)) && method === "GET") return res(200, { tree: [...trees.get(commits.get(x[1]).tree)].map(([path, s]) => ({ path, sha: s, type: "blob" })) });
    if ((x = /^git\/commits\/(\w+)$/.exec(p))) return res(200, { tree: { sha: commits.get(x[1]).tree } });
    if (p === "git/trees") {
      const map = new Map(b.base_tree ? trees.get(b.base_tree) : []);
      for (const e of b.tree) { if (e.content != null) map.set(e.path, putBlob(Buffer.from(e.content))); else if (e.sha === null) map.delete(e.path); else map.set(e.path, e.sha); }
      return res(201, { sha: putTree(map) });
    }
    if (p === "git/commits") return res(201, { sha: putCommit(b.tree, b.parents) });
    if (p === "git/refs/heads/main") {
      if (g.moveBeforeNextPatch) { const f = g.moveBeforeNextPatch; g.moveBeforeNextPatch = null; f(); }
      if (commits.get(b.sha).parents[0] !== g.head) return res(422, { message: "Update is not a fast forward" });
      g.head = b.sha; g.commits++; return res(200, {});
    }
    if ((x = /^contents\/(.+)$/.exec(p))) {
      const path = x[1].split("/").map(decodeURIComponent).join("/");
      const ref = u.searchParams.get("ref");
      const map = commits.has(ref) ? trees.get(commits.get(ref).tree) : g.files();
      const s = map.get(path);
      if (!s) return res(404, { message: "Not Found" });
      return res(200, { sha: s, size: blobs.get(s).length, content: blobs.get(s).toString("base64") });
    }
    return res(500, { message: "fake: " + method + " " + p });
  };
  return g;
}

const env = { TRIPBOARD_TOKEN: "tok", TRIPBOARD_REPO: "me/data" };

(async () => {
  await test("the CLI makes a trip, adds a place and an expense, and shows them", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    const lines = [];
    const out = (s) => lines.push(s);
    await cli.main(["new-trip", "--name", "Kyoto", "--start", "2026-12-01", "--end", "2026-12-04"], env, out);
    await cli.main(["add-place", "kyoto", "--name", "Fushimi Inari", "--day", "2026-12-01", "--time", "07:00", "--importance", "must"], env, out);
    await cli.main(["add-expense", "Kyoto", "--amount", "48000", "--currency", "jpy", "--title", "Ryokan", "--category", "stay", "--place", "fushimi"], env, out);
    lines.length = 0;
    await cli.main(["show", "kyo"], env, out);
    assert.match(lines[0], /^Kyoto {2}2026-12-01 to 2026-12-04/);
    assert.match(lines[0], /Fushimi Inari {2}\[must, sight\]/);
    assert.match(lines[0], /Expenses \(1\): ¥48,000/);
    const id = Object.keys(Object.fromEntries(g.files())).find((p) => p.startsWith("trips/"));
    const b = g.read(id);
    assert.strictEqual(b.places[0].name, "Fushimi Inari");
    assert.strictEqual(b.expenses[0].place, b.places[0].id);
    assert.ok(b.places[0].updatedAt && b.expenses[0].updatedAt);
    assert.strictEqual(g.commits, 3);
  });

  await test("deleting through the CLI leaves a tombstone the apps merge", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    const out = () => {};
    await cli.main(["new-trip", "--name", "Lisbon"], env, out);
    await cli.main(["add-place", "Lisbon", "--name", "Belém"], env, out);
    await cli.main(["delete-place", "Lisbon", "belém"], env, out);
    const path = [...g.files().keys()].find((p) => p.startsWith("trips/"));
    const b = g.read(path);
    assert.strictEqual(b.places.length, 0);
    const [pid] = Object.keys(b.deleted);
    assert.strictEqual(b.deleted[pid].trip, b.trip.id);
  });

  await test("a write retries when another device committed meanwhile, keeping both", async () => {
    const g = fakeGitHub();
    const tb = core.open({ token: "tok", repo: "me/data", fetch: g.fetch });
    const trip = await tb.change((d) => core.ops.createTrip(d, { name: "Oslo" }));
    // another device adds a place between this read and this write
    g.moveBeforeNextPatch = () => {
      const b = g.read("trips/" + trip.id + ".json");
      b.places.push({ id: "other", trip: trip.id, name: "Opera", category: "sight", importance: "want", updatedAt: "2026-11-15T00:00:00.000Z" });
      g.put("trips/" + trip.id + ".json", JSON.stringify(b));
    };
    await tb.change((d) => core.ops.addPlace(d, { trip: "Oslo", name: "Fram Museum" }));
    const names = g.read("trips/" + trip.id + ".json").places.map((p) => p.name).sort();
    assert.deepStrictEqual(names, ["Fram Museum", "Opera"]);
  });

  await test("no token or repo says what to set", async () => {
    await assert.rejects(cli.main(["trips"], {}, () => {}), /TRIPBOARD_TOKEN/);
    await assert.rejects(cli.main(["trips"], { TRIPBOARD_TOKEN: "x" }, () => {}), /TRIPBOARD_REPO/);
  });

  await test("MCP: initialize, tools/list, and tool calls that read and write", async () => {
    const g = fakeGitHub();
    const sent = [];
    const s = mcp.server({ env, fetch: g.fetch, write: (line) => sent.push(JSON.parse(line)) });
    await s.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
    assert.strictEqual(sent[0].result.serverInfo.name, "tripboard");
    await s.handle({ jsonrpc: "2.0", method: "notifications/initialized" });
    await s.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = sent[1].result.tools.map((t) => t.name);
    for (const n of ["list_trips", "get_trip", "create_trip", "add_place", "update_place", "add_expense", "delete_place"]) assert.ok(names.includes(n), n);
    for (const t of sent[1].result.tools) assert.strictEqual(t.inputSchema.type, "object");
    await s.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "create_trip", arguments: { name: "Tokyo", destinations: ["Tokyo"] } } });
    await s.handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "add_place", arguments: { trip: "tokyo", name: "Senso-ji", category: "sight" } } });
    await s.handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_trip", arguments: { trip: "Tokyo" } } });
    const view = JSON.parse(sent[4].result.content[0].text);
    assert.strictEqual(view.trip.name, "Tokyo");
    assert.deepStrictEqual(view.places.map((p) => p.name), ["Senso-ji"]);
    await s.handle({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "get_trip", arguments: { trip: "Paris" } } });
    assert.strictEqual(sent[5].result.isError, true);
    assert.match(sent[5].result.content[0].text, /No trip "Paris"/);
    await s.handle({ jsonrpc: "2.0", id: 7, method: "nope" });
    assert.strictEqual(sent[6].error.code, -32601);
  });

  console.log(passed + " passed");
})();
