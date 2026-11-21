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
  g.raw = (path) => blobs.get(g.files().get(path));
  g.put = (path, text) => { const map = new Map(g.files()); map.set(path, putBlob(Buffer.from(text))); g.head = putCommit(putTree(map), [g.head]); };
  const res = (status, body) => ({ ok: status < 300, status, headers: { get: () => "" }, json: async () => body, text: async () => JSON.stringify(body),
    arrayBuffer: async () => body });
  g.fetch = async (url, { method = "GET", body, headers }) => {
    const u = new URL(url);
    const b = body ? JSON.parse(body) : null;
    if (u.hostname === "nominatim.openstreetmap.org") {
      g.lastUserAgent = headers["User-Agent"];
      return res(200, [{ name: "Fushimi Inari Taisha", display_name: "Fushimi Inari Taisha, Kyoto, Japan", lat: "34.9671", lon: "135.7727", category: "amenity", type: "place_of_worship" }]);
    }
    if (u.hostname === "api.open-meteo.com") {
      g.lastWeather = u; g.lastUserAgent = headers["User-Agent"];
      const n = u.searchParams.get("latitude").split(",").length;
      const one = (i) => ({ daily: { time: [u.searchParams.get("start_date")], weather_code: [61 + i], temperature_2m_max: [12.4], temperature_2m_min: [4.6],
        precipitation_probability_max: [70], sunrise: [u.searchParams.get("start_date") + "T06:41"], sunset: [u.searchParams.get("start_date") + "T16:44"] } });
      return res(200, n === 1 ? one(0) : Array.from({ length: n }, (x, i) => one(i)));
    }
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
    if (p === "git/blobs") return res(201, { sha: putBlob(Buffer.from(b.content, b.encoding === "base64" ? "base64" : "utf8")) });
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
      if (headers.Accept === "application/vnd.github.raw") { const buf = blobs.get(s); return res(200, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)); }
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

  await test("sharing: everyone's default and one person's own, through the CLI and MCP", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    const out = () => {};
    await cli.main(["new-trip", "--name", "Rome"], env, out);
    const path = [...g.files().keys()].find((p) => p.startsWith("trips/"));
    const b = g.read(path);
    b.trip.owner = "ana";
    b.trip.members = [{ id: "ana", name: "Ana", role: "owner" }, { id: "ben", name: "Ben" }];
    g.put(path, JSON.stringify(b));
    await cli.main(["share", "Rome", "--role", "viewer", "--hide", "files"], env, out);
    assert.deepStrictEqual(g.read(path).trip.share, { role: "viewer", hide: ["files"] });
    await assert.rejects(cli.main(["share", "Rome", "ana", "--role", "viewer"], env, out), /owner/);
    await assert.rejects(cli.main(["share", "Rome", "--hide", "maps"], env, out), /No section/);
    const sent = [];
    const s = mcp.server({ env, fetch: g.fetch, write: (line) => sent.push(JSON.parse(line)) });
    await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "update_sharing", arguments: { trip: "Rome", person: "ben", role: "editor", hide: ["expenses"] } } });
    assert.ok(!sent[0].result.isError, sent[0].result.content[0].text);
    const ben = g.read(path).trip.members.find((m) => m.id === "ben");
    assert.deepStrictEqual([ben.role, ben.hide], ["editor", ["expenses"]]);
    await s.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_trip", arguments: { trip: "Rome" } } });
    const people = JSON.parse(sent[1].result.content[0].text).people;
    assert.deepStrictEqual(people.map((p) => [p.name, p.role, p.hidden]), [["Ana", "owner", []], ["Ben", "editor", ["expenses"]]]);
    await s.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "update_sharing", arguments: { trip: "Rome", person: "Ben", role: "default", sameAsEveryone: true } } });
    const ben2 = g.read(path).trip.members.find((m) => m.id === "ben");
    assert.deepStrictEqual([ben2.role, ben2.hide], [undefined, undefined]);
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


  const os = require("os");
  const fs = require("fs");
  const tmp = fs.mkdtempSync(require("path").join(os.tmpdir(), "tripboard-cli-"));
  const at = (name, data) => { const p = require("path").join(tmp, name); fs.writeFileSync(p, data); return p; };
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
  const mcpCall = async (s, sent, name, args) => {
    await s.handle({ jsonrpc: "2.0", id: sent.length + 1, method: "tools/call", params: { name, arguments: args } });
    const r = sent[sent.length - 1].result;
    return { error: r.isError ? r.content[0].text : null, value: r.isError ? null : JSON.parse(r.content[0].text) };
  };
  const bundle = (g) => g.read([...g.files().keys()].find((p) => p.startsWith("trips/")));

  await test("files: added from a path, read back, renamed, tied to a place, deleted with their bytes", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    const lines = [];
    const out = (x) => lines.push(x);
    await cli.main(["new-trip", "--name", "Kyoto"], env, out);
    await cli.main(["add-place", "Kyoto", "--name", "Ryokan"], env, out);
    await cli.main(["add-file", "Kyoto", "--path", at("booking.txt", "Room 4, two nights"), "--note", "check-in 15:00"], env, out);
    const f = bundle(g).files[0];
    assert.deepStrictEqual([f.name, f.type, f.size, f.note], ["booking.txt", "text/plain", 18, "check-in 15:00"]);
    assert.strictEqual(g.raw("files/" + f.trip + "/" + f.id).toString(), "Room 4, two nights");
    lines.length = 0;
    await cli.main(["file", "Kyoto", "booking"], env, out);
    assert.strictEqual(lines[0], "Room 4, two nights");
    await cli.main(["edit-file", "Kyoto", "booking", "--name", "Ryokan booking.txt", "--place", "ryokan"], env, out);
    const f2 = bundle(g).files[0];
    assert.strictEqual(f2.name, "Ryokan booking.txt");
    assert.strictEqual(f2.place, bundle(g).places[0].id);
    // over MCP the bytes stay out of the chat unless the person turned them on
    const sent = [];
    let s = mcp.server({ env, fetch: g.fetch, write: (l) => sent.push(JSON.parse(l)) });
    assert.match((await mcpCall(s, sent, "get_file", { trip: "Kyoto", file: "ryokan booking" })).error, /TRIPBOARD_MCP_FILES/);
    s = mcp.server({ env: { ...env, TRIPBOARD_MCP_FILES: "1" }, fetch: g.fetch, write: (l) => sent.push(JSON.parse(l)) });
    assert.strictEqual((await mcpCall(s, sent, "get_file", { trip: "Kyoto", file: "ryokan booking" })).value.text, "Room 4, two nights");
    const pdf = await mcpCall(s, sent, "add_file", { trip: "Kyoto", name: "ticket.pdf", content: Buffer.from("%PDF-1.4 x").toString("base64") });
    assert.strictEqual(pdf.value.type, "application/pdf");
    assert.strictEqual((await mcpCall(s, sent, "get_file", { trip: "Kyoto", file: "ticket" })).value.base64, Buffer.from("%PDF-1.4 x").toString("base64"));
    await cli.main(["delete-file", "Kyoto", "ticket.pdf"], env, out);
    assert.ok(!g.files().has("files/" + f.trip + "/" + pdf.value.id));
    assert.ok(bundle(g).deleted[pdf.value.id]);
    assert.ok(g.files().has("files/" + f.trip + "/" + f.id));
  });

  await test("covers: set from an image, refused for anything else, removed", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    const out = () => {};
    await cli.main(["new-trip", "--name", "Oslo"], env, out);
    await cli.main(["cover", "Oslo", "--path", at("c.jpg", JPEG)], env, out);
    const t = bundle(g).trip;
    assert.strictEqual(t.cover, true);
    assert.ok(t.coverAt);
    assert.deepStrictEqual(g.raw("covers/" + t.id + ".jpg"), JPEG);
    await assert.rejects(cli.main(["cover", "Oslo", "--path", at("c.txt", "hello")], env, out), /JPEG, PNG or WebP/);
    await cli.main(["cover", "Oslo", "--remove", "true"], env, out);
    assert.strictEqual(bundle(g).trip.cover, undefined);
    assert.ok(bundle(g).trip.coverAt > t.coverAt || bundle(g).trip.coverAt === t.coverAt);
    assert.ok(!g.files().has("covers/" + t.id + ".jpg"));
  });

  await test("categories: added, renamed, moved, used by a place, then removed to Other", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    const lines = [];
    const out = (x) => lines.push(x);
    await cli.main(["add-category", "Markets"], env, out);
    let cats = g.read("categories.json");
    assert.ok(cats.at);
    const id = cats.list.find((c) => c.name === "Markets").id;
    assert.deepStrictEqual(cats.list.slice(-2).map((c) => c.id), [id, "other"]);
    await cli.main(["edit-category", "markets", "--name", "Night markets", "--position", "1"], env, out);
    cats = g.read("categories.json");
    assert.deepStrictEqual(cats.list[0], { id, name: "Night markets" });
    await assert.rejects(cli.main(["add-category", "night markets"], env, out), /already/);
    await cli.main(["new-trip", "--name", "Taipei"], env, out);
    await cli.main(["add-place", "Taipei", "--name", "Shilin", "--category", id], env, out);
    assert.deepStrictEqual(bundle(g).trip.cats, { [id]: "Night markets" });
    lines.length = 0;
    await cli.main(["categories"], env, out);
    assert.match(lines[0], /^1\. Night markets {2}1 places/);
    await assert.rejects(cli.main(["delete-category", "other"], env, out), /always/);
    await cli.main(["delete-category", "Night markets"], env, out);
    assert.strictEqual(bundle(g).places[0].category, "other");
    assert.ok(!g.read("categories.json").list.some((c) => c.id === id));
    await cli.main(["reset-categories"], env, out);
    assert.deepStrictEqual(g.read("categories.json").list.map((c) => c.id), core.M.CATEGORIES.map((c) => c[0]));
  });

  await test("queries: places by filter and distance, the board, and a day's plan with times between", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    const out = () => {};
    await cli.main(["new-trip", "--name", "Kyoto", "--start", "2026-12-01", "--end", "2026-12-03"], env, out);
    await cli.main(["add-place", "Kyoto", "--name", "Fushimi Inari", "--day", "2026-12-01", "--time", "07:00", "--importance", "must", "--lat", "34.9671", "--lng", "135.7727"], env, out);
    await cli.main(["add-place", "Kyoto", "--name", "Tofuku-ji", "--day", "2026-12-01", "--time", "10:00", "--lat", "34.9769", "--lng", "135.7737"], env, out);
    await cli.main(["add-place", "Kyoto", "--name", "Ryokan", "--day", "2026-12-01", "--end-day", "2026-12-03", "--category", "stay"], env, out);
    await cli.main(["add-place", "Kyoto", "--name", "Kinkaku-ji", "--importance", "maybe", "--note", "golden"], env, out);
    const tb = core.open({ token: "tok", repo: "me/data", fetch: g.fetch });
    const T = require("../cli/tools.js");
    const tool = (n) => T.TOOLS.find((t) => t.tool === n);
    const q = (n, a) => T.run(tb, tool(n), a, "mcp", env);
    assert.deepStrictEqual((await q("find_places", { trip: "Kyoto", day: "2026-12-02" })).map((p) => p.name), ["Ryokan"]);
    assert.deepStrictEqual((await q("find_places", { trip: "Kyoto", day: "none" })).map((p) => p.name), ["Kinkaku-ji"]);
    assert.deepStrictEqual((await q("find_places", { trip: "Kyoto", text: "GOLD" })).map((p) => p.name), ["Kinkaku-ji"]);
    assert.deepStrictEqual((await q("find_places", { trip: "Kyoto", importance: ["must", "maybe"] })).map((p) => p.name).sort(), ["Fushimi Inari", "Kinkaku-ji"]);
    const near = await q("find_places", { trip: "Kyoto", near: "Tofuku-ji", located: true });
    assert.deepStrictEqual(near.map((p) => p.name), ["Tofuku-ji", "Fushimi Inari"]);
    assert.ok(near[1].km > 1 && near[1].km < 1.2, near[1].km);
    const board = await q("get_board", { trip: "Kyoto", sort: "time" });
    assert.deepStrictEqual(board.map((g2) => g2.id), ["2026-12-01", "2026-12-02", "2026-12-03", "nodate"]);
    assert.deepStrictEqual(board[0].slots.map((x) => [x.id, x.places.map((p) => p.name)]), [["morning", ["Fushimi Inari", "Tofuku-ji"]], ["any", ["Ryokan"]]]);
    assert.strictEqual(board[0].dayNumber, 1);
    assert.deepStrictEqual((await q("get_board", { trip: "Kyoto", sort: "importance" })).map((x) => x.id), ["must", "want", "maybe"]);
    const day = await q("get_day", { trip: "Kyoto", day: "2026-12-01" });
    assert.deepStrictEqual(day.plan.map((p) => p.name), ["Fushimi Inari", "Tofuku-ji", "Ryokan"]);
    assert.strictEqual(day.plan[0].fromPrevious, null);
    assert.strictEqual(day.plan[1].fromPrevious.mode, "walk");
    assert.strictEqual(day.next.name, "Fushimi Inari");
    await cli.main(["edit-place", "Kyoto", "Fushimi", "--visited", "true"], env, out);
    assert.strictEqual((await q("get_day", { trip: "Kyoto", day: "2026-12-01" })).next.name, "Tofuku-ji");
    const lines = [];
    await cli.main(["day", "Kyoto", "2026-12-01"], env, (x) => lines.push(x));
    assert.match(lines[0], /~\d+ min walk/);
  });

  await test("importing a Google Maps list: a new trip named by it, then into a trip skipping names it has", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    const kml = '<?xml version="1.0"?><kml><Document><name>Lisbon food</name><Placemark><name>Time Out Market</name><Point><coordinates>-9.1458,38.7068,0</coordinates></Point></Placemark><Placemark><name>Pastéis de Belém</name></Placemark></Document></kml>';
    const sent = [];
    const s = mcp.server({ env, fetch: g.fetch, write: (l) => sent.push(JSON.parse(l)) });
    const r = await mcpCall(s, sent, "import_places", { text: kml, fileName: "list.kml" });
    assert.ok(!r.error, r.error);
    assert.deepStrictEqual([r.value.trip, r.value.added], ["Lisbon food", 2]);
    assert.deepStrictEqual(r.value.places.map((p) => p.located), [true, false]);
    const csv = "Title,Note,URL,Comment\nTime Out Market,,,\nLX Factory,,https://www.google.com/maps/place/LX/@38.703,-9.178,17z,\n";
    const lines = [];
    await cli.main(["import", "lisbon", "--path", at("Lisbon more.csv", csv)], env, (x) => lines.push(x));
    assert.match(lines[0], /Added 1 places to Lisbon food \(1 already there\)/);
    assert.strictEqual(bundle(g).places.length, 3);
  });

  await test("importing a Google Maps list by its link goes through Tripboard's server; its errors come back", async () => {
    const g = fakeGitHub();
    const asked = [];
    const answers = [{ ok: true, status: 200, body: { title: "Rome eats", places: [{ name: "Two Sizes", lat: 41.898, lng: 12.4715 }, { name: "Pizza Florida" }, { name: "" }] } },
      { ok: false, status: 400, body: { error: "That isn't a Google Maps link." } }];
    globalThis.fetch = async (u, init) => {
      if (String(u).endsWith("/google-list")) {
        asked.push(JSON.parse(init.body).url);
        const a = answers.shift();
        return { ok: a.ok, status: a.status, json: async () => a.body };
      }
      return g.fetch(u, init);
    };
    const lines = [];
    await cli.main(["import", "--link", "https://maps.app.goo.gl/rome123"], env, (x) => lines.push(x));
    assert.match(lines[0], /Added 2 places to Rome eats/);
    assert.deepStrictEqual(asked, ["https://maps.app.goo.gl/rome123"]);
    const sent = [];
    const s = mcp.server({ env, fetch: globalThis.fetch, write: (l) => sent.push(JSON.parse(l)) });
    const r = await mcpCall(s, sent, "import_places", { trip: "rome", link: "https://evil.example/x" });
    assert.match(String(r.error), /isn't a Google Maps link/);
    const both = await mcpCall(s, sent, "import_places", { trip: "rome", link: "https://maps.app.goo.gl/x", text: "a,b" });
    assert.match(String(both.error), /link or a file, not both/);
  });

  await test("a backup exported with its cover and files restores after the trip is deleted", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    const out = () => {};
    await cli.main(["new-trip", "--name", "Rome"], env, out);
    await cli.main(["add-place", "Rome", "--name", "Pantheon"], env, out);
    await cli.main(["cover", "Rome", "--path", at("r.jpg", JPEG)], env, out);
    await cli.main(["add-file", "Rome", "--path", at("t.txt", "ticket")], env, out);
    const id = bundle(g).trip.id;
    const file = at("rome.json", "");
    await cli.main(["export", "--trips", "rome", "--out", file], env, out);
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.strictEqual(data.app, "tripboard");
    assert.ok(data.covers[id].startsWith("data:image/jpeg;base64,"));
    assert.strictEqual(Object.keys(data.blobs).length, 1);
    await cli.main(["delete-trip", "Rome"], env, out);
    assert.ok(!g.files().has("covers/" + id + ".jpg"));
    assert.ok(![...g.files().keys()].some((p) => p.startsWith("files/" + id + "/")));
    const lines = [];
    await cli.main(["restore", "--path", file], env, (x) => lines.push(x));
    assert.match(lines[0], /Restored 1 trips \(0 replaced\): Rome/);
    const b = g.read("trips/" + id + ".json");
    assert.deepStrictEqual([b.trip.name, b.trip.cover, b.places[0].name], ["Rome", true, "Pantheon"]);
    assert.deepStrictEqual(g.raw("covers/" + id + ".jpg"), JPEG);
    assert.strictEqual(g.raw("files/" + id + "/" + b.files[0].id).toString(), "ticket");
    // over MCP, no bytes unless asked for and turned on
    const sent = [];
    const s = mcp.server({ env, fetch: g.fetch, write: (l) => sent.push(JSON.parse(l)) });
    const ex = await mcpCall(s, sent, "export_backup", { withBytes: true });
    assert.deepStrictEqual([ex.value.trips.length, ex.value.covers, ex.value.blobs], [1, {}, {}]);
  });

  await test("with me.json: new trips are yours, changes say who, and a viewer or non-owner is stopped", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    g.put("me.json", JSON.stringify({ id: "u-me" }));
    const out = () => {};
    await cli.main(["new-trip", "--name", "Seoul"], env, out);
    let b = bundle(g);
    assert.deepStrictEqual([b.trip.owner, b.trip.members, b.trip.by], ["u-me", [{ id: "u-me", name: "", role: "owner" }], "u-me"]);
    await cli.main(["new-trip", "--name", "Busan"], env, out);
    const path = [...g.files().keys()].find((p) => p.startsWith("trips/") && g.read(p).trip.name === "Busan");
    b = g.read(path);
    b.trip.owner = "ana";
    b.trip.members = [{ id: "ana", name: "Ana", role: "owner" }, { id: "u-me", name: "Me", role: "viewer" }, { id: "ben", name: "Ben" }];
    g.put(path, JSON.stringify(b));
    await assert.rejects(cli.main(["add-place", "Busan", "--name", "Haeundae"], env, out), /only view Busan/);
    b.trip.members[1].role = "editor";
    g.put(path, JSON.stringify(b));
    await cli.main(["add-place", "Busan", "--name", "Haeundae"], env, out);
    assert.strictEqual(g.read(path).places[0].by, "u-me");
    await assert.rejects(cli.main(["remove-person", "Busan", "ben"], env, out), /Only the owner/);
    await assert.rejects(cli.main(["delete-trip", "Busan"], env, out), /Only the owner/);
    await assert.rejects(cli.main(["remove-person", "Seoul", "u-me"], env, out), /owner can't be removed/);
  });

  await test("removing someone from a shared trip", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    await cli.main(["new-trip", "--name", "Rome"], env, () => {});
    const path = [...g.files().keys()].find((p) => p.startsWith("trips/"));
    const b = g.read(path);
    b.trip.owner = "ana";
    b.trip.members = [{ id: "ana", name: "Ana", role: "owner" }, { id: "ben", name: "Ben" }];
    g.put(path, JSON.stringify(b));
    await cli.main(["remove-person", "Rome", "Ben"], env, () => {});
    assert.deepStrictEqual(g.read(path).trip.members.map((m) => m.id), ["ana"]);
  });

  await test("find_location asks OpenStreetMap with Tripboard's user agent", async () => {
    const g = fakeGitHub();
    const sent = [];
    const s = mcp.server({ env, fetch: g.fetch, write: (l) => sent.push(JSON.parse(l)) });
    const r = await mcpCall(s, sent, "find_location", { query: "Fushimi Inari" });
    assert.ok(!r.error, r.error);
    assert.deepStrictEqual([r.value[0].lat, r.value[0].lng, r.value[0].category], [34.9671, 135.7727, "sight"]);
    assert.match(g.lastUserAgent, /^Tripboard-CLI/);
  });

  await test("get_weather asks Open-Meteo for the trip's located days, rounded", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    const day = core.today();
    await cli.main(["new-trip", "--name", "Kyoto", "--start", day, "--end", core.M.addDays(day, 1)], env, () => {});
    await cli.main(["add-place", "kyoto", "--name", "Fushimi Inari", "--day", day, "--lat", "34.96714", "--lng", "135.77271"], env, () => {});
    const sent = [];
    const s = mcp.server({ env, fetch: g.fetch, write: (l) => sent.push(JSON.parse(l)) });
    const r = await mcpCall(s, sent, "get_weather", { trip: "Kyoto" });
    assert.ok(!r.error, r.error);
    assert.strictEqual(g.lastWeather.searchParams.get("latitude"), "34.97");
    assert.strictEqual(g.lastWeather.searchParams.get("longitude"), "135.77");
    assert.match(g.lastUserAgent, /^Tripboard-CLI/);
    assert.deepStrictEqual(r.value.days.map((d) => [d.day, d.kind, d.max, d.min, d.rain, d.sunrise]), [[day, "rain", 12, 5, 70, "06:41"]]);
    assert.deepStrictEqual(r.value.noForecast, [core.M.addDays(day, 1)]);
    const out = [];
    await cli.main(["weather", "kyoto"], env, (l) => out.push(l));
    assert.match(out.join("\n"), /rain  12°\/5°C  rain 70%  sun 06:41–16:44/);
  });

  await test("MCP tools say which only read and which delete", async () => {
    const s = mcp.server({ env, write: () => {} });
    const by = Object.fromEntries(s.TOOLS.map((t) => [t.name, t.annotations]));
    assert.strictEqual(by.get_trip.readOnlyHint, true);
    assert.strictEqual(by.delete_trip.destructiveHint, true);
    assert.strictEqual(by.add_place.readOnlyHint, false);
    for (const t of s.TOOLS) for (const k of t.inputSchema.required) assert.ok(t.inputSchema.properties[k], t.name + " " + k);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(passed + " passed");
})();
