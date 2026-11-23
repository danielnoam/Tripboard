// cli/: the CLI and the MCP server against a fake GitHub (an in-memory
// git with the calls they make) (`node test/cli.test.js`).
const assert = require("assert");
const core = require("../cli/core.js");
const cli = require("../cli/tripboard.js");
const mcp = require("../cli/mcp.js");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + (e.stack || e.message)); }
}

const fakeGitHub = require("./fakegithub.js");

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

  await test("show says which sharing server a shared trip is on, never its key", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    const lines = [];
    const out = (s) => lines.push(s);
    await cli.main(["new-trip", "--name", "Lisbon"], env, out);
    await cli.main(["new-trip", "--name", "Porto"], env, out);
    const ids = [...g.files().keys()].map((p) => (/^trips\/(.+)\.json$/.exec(p) || [])[1]).filter(Boolean);
    const lisbon = ids.find((id) => g.read("trips/" + id + ".json").trip.name === "Lisbon");
    const porto = ids.find((id) => id !== lisbon);
    g.put("shares.json", JSON.stringify({ [lisbon]: { key: "secret-own", server: "https://tripboard.maya.workers.dev" }, [porto]: "secret-main" }));
    lines.length = 0;
    await cli.main(["show", "lisbon"], env, out);
    await cli.main(["show", "porto"], env, out);
    const text = lines.join("\n");
    assert.match(lines[0], /Shared through tripboard\.maya\.workers\.dev/);
    assert.match(lines[1], /Shared through Tripboard's server/);
    assert.ok(!/secret/.test(text));
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
    // a file id can't climb out of files/ to read keys.json
    g.put("keys.json", JSON.stringify({ on: true, at: "x", keys: { google: { key: "SECRET", at: "x" } } }));
    const tp = [...g.files().keys()].find((p) => p.startsWith("trips/"));
    const tb = g.read(tp);
    tb.files.push({ ...tb.files[0], id: "../../keys.json", name: "sneaky.txt" });
    g.put(tp, JSON.stringify(tb));
    const sneaky = await mcpCall(s, sent, "get_file", { trip: "Kyoto", file: "sneaky" });
    assert.ok(!JSON.stringify(sneaky).includes("SECRET"));
    await cli.main(["delete-file", "Kyoto", "ticket.pdf"], env, out);
    assert.ok(!g.files().has("files/" + f.trip + "/" + pdf.value.id));
    assert.ok(bundle(g).deleted[pdf.value.id]);
    assert.ok(g.files().has("files/" + f.trip + "/" + f.id));
  });

  await test("links and notes: added, listed, edited, read without the files switch, deleted; no bytes in the repo", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    const lines = [];
    const out = (x) => lines.push(x);
    await cli.main(["new-trip", "--name", "Japan"], env, out);
    await cli.main(["add-place", "Japan", "--name", "Narita Airport"], env, out);
    await cli.main(["add-link", "Japan", "www.jreast.co.jp/en/", "--place", "narita"], env, out);
    await assert.rejects(cli.main(["add-link", "Japan", "javascript:alert(1)"], env, out), /http/);
    const sent = [];
    const s = mcp.server({ env, fetch: g.fetch, write: (l) => sent.push(JSON.parse(l)) });
    const note = await mcpCall(s, sent, "add_note", { trip: "Japan", name: "Phrasebook", text: "Sumimasen\nArigatou" });
    assert.strictEqual(note.value.kind, "note");
    assert.match((await mcpCall(s, sent, "add_note", { trip: "Japan", text: "  " })).error, /needs its text/);
    const b = bundle(g);
    const link = b.files.find((f) => f.kind === "link");
    assert.deepStrictEqual([link.url, link.name, link.place], ["https://www.jreast.co.jp/en/", "jreast.co.jp", b.places[0].id]);
    assert.ok(![...g.files().keys()].some((p) => p.startsWith("files/")), "links and notes have no bytes");
    await cli.main(["edit-file", "Japan", "jreast", "--name", "IC card: info", "--url", "https://www.jreast.co.jp/en/multi/pass/suica.html"], env, out);
    await cli.main(["edit-file", "Japan", "phrasebook", "--text", "Sumimasen\nArigatou\nOnegaishimasu"], env, out);
    await assert.rejects(cli.main(["edit-file", "Japan", "phrasebook", "--url", "https://x.com"], env, out), /isn't a link/);
    const trip = (await mcpCall(s, sent, "get_trip", { trip: "Japan" })).value;
    const kinds = Object.fromEntries(trip.files.map((f) => [f.kind, f]));
    assert.strictEqual(kinds.link.name, "IC card: info");
    assert.strictEqual(kinds.link.url, "https://www.jreast.co.jp/en/multi/pass/suica.html");
    assert.strictEqual(kinds.note.text, "Sumimasen\nArigatou\nOnegaishimasu");
    assert.strictEqual((await mcpCall(s, sent, "get_file", { trip: "Japan", file: "phrasebook" })).value.file.text, "Sumimasen\nArigatou\nOnegaishimasu");
    lines.length = 0;
    await cli.main(["show", "Japan"], env, out);
    assert.match(lines.join("\n"), /IC card: info {2}https:\/\/www\.jreast/);
    await cli.main(["delete-file", "Japan", "phrasebook"], env, out);
    assert.ok(bundle(g).deleted[note.value.id]);
    assert.strictEqual(bundle(g).files.length, 1);
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

  await test("covers: a drawing by name takes the photo's place, and a photo takes the drawing's", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    const out = () => {};
    await cli.main(["new-trip", "--name", "Oslo"], env, out);
    await cli.main(["cover", "Oslo", "--path", at("c.jpg", JPEG)], env, out);
    const id = bundle(g).trip.id;
    await cli.main(["cover", "Oslo", "--art", "snow"], env, out);
    assert.strictEqual(bundle(g).trip.art, "snow");
    assert.strictEqual(bundle(g).trip.cover, undefined);
    assert.ok(!g.files().has("covers/" + id + ".jpg"));
    await assert.rejects(cli.main(["cover", "Oslo", "--art", "moon"], env, out), /one of: mountains/);
    await cli.main(["cover", "Oslo", "--path", at("c.jpg", JPEG)], env, out);
    assert.strictEqual(bundle(g).trip.art, undefined);
    assert.strictEqual(bundle(g).trip.cover, true);
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

  await test("journeys: an overnight flight lands the next day, a train on from where it lands, back to a place", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    const out = () => {};
    await cli.main(["new-trip", "--name", "Japan", "--start", "2026-11-30", "--end", "2026-12-03"], env, out);
    await cli.main(["add-place", "Japan", "--name", "Hotel", "--day", "2026-12-01", "--time", "15:00", "--lat", "34.9871", "--lng", "135.7590"], env, out);
    await cli.main(["add-place", "Japan", "--kind", "journey", "--mode", "flight", "--name", "Zurich (ZRH)", "--day", "2026-11-30", "--time", "13:00",
      "--to-name", "Tokyo Narita (NRT)", "--to-lat", "35.772", "--to-lng", "140.3929", "--arrive-day", "2026-12-01", "--arrive-time", "08:55", "--number", "LX 160"], env, out);
    const tb = core.open({ token: "tok", repo: "me/data", fetch: g.fetch });
    const T = require("../cli/tools.js");
    const q = (n, a) => T.run(tb, T.TOOLS.find((t) => t.tool === n), a, "mcp", env);
    await q("add_place", { trip: "Japan", kind: "journey", mode: "train", name: "Tokyo Narita (NRT)", day: "2026-12-01", time: "06:00", toName: "Kyoto", toLat: 34.9858, toLng: 135.7588, arriveTime: "06:50" });
    const legs = await q("find_places", { trip: "Japan", kind: "journey" });
    assert.deepStrictEqual(legs.map((p) => [p.name, p.category, p.mode]), [["Zurich (ZRH)", "transport", "flight"], ["Tokyo Narita (NRT)", "transport", "train"]]);
    await q("update_place", { trip: "Japan", place: legs[1].id, time: "09:45", arriveTime: "12:30" });
    const day = await q("get_day", { trip: "Japan", day: "2026-12-01" });
    assert.deepStrictEqual(day.arrivals.map((j) => [j.number, j.arriveTime]), [["LX 160", "08:55"]]);
    assert.deepStrictEqual(day.plan.map((p) => p.name), ["Tokyo Narita (NRT)", "Hotel"]);
    assert.ok(day.plan[1].fromPrevious.km < 3, "from Kyoto, where the train arrives");
    assert.deepStrictEqual((await q("find_places", { trip: "Japan", kind: "place" })).map((p) => p.name), ["Hotel"]);
    assert.ok((await q("get_board", { trip: "Japan", sort: "importance" })).every((x) => x.places.every((p) => !p.kind)), "journeys aren't in Importance");
    const board = await q("get_board", { trip: "Japan" });
    assert.strictEqual(board[0].slots[0].places[0].toName, "Tokyo Narita (NRT)");
    await q("update_place", { trip: "Japan", place: legs[0].id, arriveDay: "2026-11-29" });
    assert.strictEqual((await q("find_places", { trip: "Japan", text: "LX 160" }))[0].arriveDay, undefined, "an arrival before it leaves goes");
    await q("update_place", { trip: "Japan", place: legs[1].id, kind: "place" });
    const back = (await q("find_places", { trip: "Japan", text: "Narita" })).find((p) => p.id === legs[1].id);
    assert.deepStrictEqual([back.kind, back.toName, back.mode], [undefined, undefined, undefined]);
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
    await cli.main(["edit-place", "Kyoto", "Tofuku-ji", "--rating", "4"], env, out);
    await q("update_place", { trip: "Kyoto", place: "Kinkaku-ji", rating: 5 });
    const rated = await q("get_board", { trip: "Kyoto", sort: "rating" });
    assert.deepStrictEqual(rated.map((x) => [x.id, x.places.map((p) => p.name)]), [["5", ["Kinkaku-ji"]], ["4", ["Tofuku-ji"]], ["none", ["Fushimi Inari", "Ryokan"]]]);
    assert.strictEqual(rated[0].places[0].rating, 5);
    assert.deepStrictEqual((await q("find_places", { trip: "Kyoto", rating: [4, 5] })).map((p) => p.name).sort(), ["Kinkaku-ji", "Tofuku-ji"]);
    assert.deepStrictEqual((await q("find_places", { trip: "Kyoto", rating: [0] })).map((p) => p.name).sort(), ["Fushimi Inari", "Ryokan"]);
    await cli.main(["edit-place", "Kyoto", "Tofuku-ji", "--rating", ""], env, out);
    assert.strictEqual((await q("find_places", { trip: "Kyoto", text: "Tofuku" }))[0].rating, undefined);
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

  await test("deleting works only while the app's switch (ai.json) is on, and no tool can write ai.json", async () => {
    const g = fakeGitHub({ deleting: false });
    globalThis.fetch = g.fetch;
    const out = () => {};
    await cli.main(["new-trip", "--name", "Bern"], env, out);
    await cli.main(["add-place", "Bern", "--name", "Zytglogge"], env, out);
    const commits = g.commits;
    for (const args of [["delete-place", "Bern", "Zytglogge"], ["delete-trip", "Bern"], ["reset-categories"]]) {
      await assert.rejects(cli.main(args, env, out), /Deleting is off for AI tools.*Settings › AI tools/);
    }
    assert.strictEqual(g.commits, commits);
    assert.strictEqual(bundle(g).places.length, 1);
    // Off when ai.json says anything but deleting: true.
    g.put("ai.json", JSON.stringify({ deleting: "yes", at: "2026-11-21T00:00:00.000Z" }));
    await assert.rejects(cli.main(["delete-place", "Bern", "Zytglogge"], env, out), /Deleting is off/);
    g.put("ai.json", JSON.stringify({ deleting: true, at: "2026-11-21T00:00:00.000Z" }));
    await cli.main(["delete-place", "Bern", "Zytglogge"], env, out);
    assert.strictEqual(bundle(g).places.length, 0);
    // Nothing in cli/ may write or drop ai.json, even an op that tries.
    const tb = core.open({ token: "tok", repo: "me/data" });
    g.put("ai.json", JSON.stringify({ deleting: false, at: "2026-11-21T01:00:00.000Z" }));
    await assert.rejects(tb.change((doc, ctx) => { ctx.put("ai.json", Buffer.from('{"deleting":true}')); }), /Only the app changes ai\.json/);
    await assert.rejects(tb.change((doc, ctx) => { ctx.drop("ai.json"); }), /Only the app changes ai\.json/);
    assert.strictEqual(g.read("ai.json").deleting, false);
  });

  await test("an edit gives back the record as written, with its new updatedAt", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    const tb = core.open({ token: "tok", repo: "me/data" });
    const t = await tb.change((d, c) => core.ops.createTrip(d, { name: "Bern" }, c));
    const p = await tb.change((d, c) => core.ops.addPlace(d, { trip: t.id, name: "Zytglogge" }, c));
    await new Promise((r) => setTimeout(r, 5));
    const r = await tb.change((d, c) => core.ops.updatePlace(d, { trip: t.id, place: p.id, note: "Clock at 11" }, c));
    const saved = g.read("trips/" + t.id + ".json").places[0];
    assert.ok(r.updatedAt > p.updatedAt, r.updatedAt + " vs " + p.updatedAt);
    assert.strictEqual(r.updatedAt, saved.updatedAt);
  });

  await test("order_day orders a day's places without times; moving day clears the order", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    const out = () => {};
    await cli.main(["new-trip", "--name", "Alps", "--start", "2026-09-11", "--end", "2026-09-13"], env, out);
    for (const n of ["Hotel", "Seealpsee", "Lunch", "Ebenalp"]) await cli.main(["add-place", "Alps", "--name", n, "--day", "2026-09-12"], env, out);
    await cli.main(["add-place", "Alps", "--name", "Train", "--day", "2026-09-12", "--time", "08:00"], env, out);
    const lines = [];
    await cli.main(["order-day", "Alps", "2026-09-12", "--places", "Ebenalp,Seealpsee,Lunch"], env, (x) => lines.push(x));
    assert.match(lines[0], /1\. 08:00 {2}Train\n {2}2\. Ebenalp\n {2}3\. Seealpsee\n {2}4\. Lunch\n {2}5\. Hotel/);
    assert.doesNotMatch(lines[0], /time first/);
    const lines2 = [];
    await cli.main(["order-day", "Alps", "2026-09-12", "--places", "Hotel,Train"], env, (x) => lines2.push(x));
    assert.match(lines2[0], /1\. 08:00 {2}Train\n {2}2\. Hotel/);
    assert.match(lines2[0], /time first/);
    await cli.main(["order-day", "Alps", "2026-09-12", "--places", "Ebenalp,Seealpsee,Lunch"], env, out);
    const tb = core.open({ token: "tok", repo: "me/data", fetch: g.fetch });
    const T = require("../cli/tools.js");
    const q = (n, a) => T.run(tb, T.TOOLS.find((t) => t.tool === n), a, "mcp", env);
    assert.deepStrictEqual((await q("get_day", { trip: "Alps", day: "2026-09-12" })).plan.map((p) => p.name), ["Train", "Ebenalp", "Seealpsee", "Lunch", "Hotel"]);
    await assert.rejects(q("order_day", { trip: "Alps", day: "2026-09-13", places: ["Hotel"] }), /isn't on 2026-09-13/);
    const moved = await q("update_place", { trip: "Alps", place: "Lunch", day: "2026-09-13" });
    assert.strictEqual(moved.order, undefined);
    const kept = await q("update_place", { trip: "Alps", place: "Hotel", order: 1 });
    assert.strictEqual(kept.order, 1);
  });

  await test("a stay's check-in and check-out: get_day gives the one on that day", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    await cli.main(["new-trip", "--name", "Osaka", "--start", "2027-02-04", "--end", "2027-02-07"], env, () => {});
    const tb = core.open({ token: "tok", repo: "me/data", fetch: g.fetch });
    const T = require("../cli/tools.js");
    const q = (n, a) => T.run(tb, T.TOOLS.find((t) => t.tool === n), a, "mcp", env);
    const p = await q("add_place", { trip: "Osaka", name: "Hotel", category: "stay", day: "2027-02-04", endDay: "2027-02-06", time: "15:00", endTime: "11:00" });
    assert.strictEqual(p.endTime, "11:00");
    const at = async (day) => (await q("get_day", { trip: "Osaka", day })).plan[0];
    assert.deepStrictEqual([await at("2027-02-04"), await at("2027-02-05"), await at("2027-02-06")].map((x) => [x.stay, x.slot]),
      [["in", "afternoon"], ["night", "any"], ["out", "morning"]]);
  });

  await test("get_day's status is the trip's against today, and when says if the day is past", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    await cli.main(["new-trip", "--name", "Old", "--start", "2020-09-11", "--end", "2020-09-22"], env, () => {});
    const tb = core.open({ token: "tok", repo: "me/data", fetch: g.fetch });
    const T = require("../cli/tools.js");
    const d = await T.run(tb, T.TOOLS.find((t) => t.tool === "get_day"), { trip: "Old", day: "2020-09-12" }, "mcp", env);
    assert.strictEqual(d.status, "past");
    assert.strictEqual(d.when, "past");
    assert.strictEqual(d.dayNumber, 2);
  });

  await test("batch_update makes many changes in one commit, all or nothing", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    await cli.main(["new-trip", "--name", "Ticino", "--start", "2026-09-14", "--end", "2026-09-16"], env, () => {});
    const sent = [];
    const s = mcp.server({ env, fetch: g.fetch, write: (l) => sent.push(JSON.parse(l)) });
    const before = g.commits;
    const r = await mcpCall(s, sent, "batch_update", { trip: "Ticino", steps: [
      { tool: "add_place", args: { name: "Verzasca", day: "2026-09-14" } },
      { tool: "add_place", args: { name: "Lugano", day: "2026-09-14" } },
      { tool: "update_place", args: { place: "Verzasca", note: "Swim" } },
      { tool: "order_day", args: { day: "2026-09-14", places: ["Lugano", "Verzasca"] } },
      { tool: "add_expense", args: { amount: 40, currency: "CHF", title: "Boat", place: "Lugano" } },
    ] });
    assert.ok(!r.error, r.error);
    assert.strictEqual(r.value.changes, 5);
    assert.ok(r.value.results[2].updatedAt && r.value.results[2].note === "Swim");
    assert.strictEqual(g.commits, before + 1);
    const path = [...g.files().keys()].find((p) => p.startsWith("trips/"));
    const b = g.read(path);
    assert.deepStrictEqual(b.places.map((p) => [p.name, p.order]).sort(), [["Lugano", 1], ["Verzasca", 2]]);
    assert.strictEqual(b.expenses[0].place, b.places.find((p) => p.name === "Lugano").id);

    const bad = await mcpCall(s, sent, "batch_update", { trip: "Ticino", steps: [
      { tool: "add_place", args: { name: "Bellinzona" } }, { tool: "update_place", args: { place: "Nowhere", note: "x" } }] });
    assert.match(bad.error, /Step 2 \(update_place\).*Nothing was changed/);
    const del = await mcpCall(s, sent, "batch_update", { steps: [{ tool: "delete_place", args: { trip: "Ticino", place: "Lugano" } }] });
    assert.match(del.error, /aren't done in a batch/);
    assert.strictEqual(g.commits, before + 1);

    const lines = [];
    await cli.main(["batch", "--trip", "Ticino", "--steps", JSON.stringify([{ tool: "edit-place", args: { place: "Lugano", visited: true } }])], env, (x) => lines.push(x));
    assert.strictEqual(lines[0], "Done: 1 change in one commit.");
    assert.strictEqual(g.read(path).places.find((p) => p.name === "Lugano").visited, true);
  });

  await test("destinations with dates: set them, put a place in one, read the plan by destination", async () => {
    const g = fakeGitHub();
    globalThis.fetch = g.fetch;
    const lines = [];
    const out = (s) => lines.push(s);
    await cli.main(["new-trip", "--name", "Japan", "--start", "2026-02-01", "--end", "2026-02-06", "--destinations", "Osaka,Kyoto"], env, out);
    await cli.main(["add-place", "japan", "--name", "Hotel", "--category", "stay", "--day", "2026-02-01", "--end-day", "2026-02-03", "--lat", "34.67", "--lng", "135.5"], env, out);
    await cli.main(["add-place", "japan", "--name", "Gion", "--lat", "35.003", "--lng", "135.775"], env, out);
    await cli.main(["add-place", "japan", "--name", "Picked", "--dest", "Kyoto"], env, out);
    await cli.main(["edit-trip", "japan", "--dest-info", JSON.stringify([{ name: "Osaka", lat: 34.69, lng: 135.5 }, { name: "Kyoto", start: "2026-02-03", end: "2026-02-06", lat: 35.01, lng: 135.77 }, { name: "Nara" }])], env, out);
    await cli.main(["edit-trip", "japan", "--dates-from-stays", "true"], env, out);
    const t = g.read(Object.keys(Object.fromEntries(g.files())).find((p) => p.startsWith("trips/")));
    assert.deepStrictEqual(t.trip.destinations, ["Osaka", "Kyoto", "Nara"]);
    assert.deepStrictEqual(t.trip.destInfo.Osaka, { start: "2026-02-01", end: "2026-02-03", lat: 34.69, lng: 135.5 });
    assert.strictEqual(t.places.find((p) => p.name === "Picked").dest, "Kyoto");
    lines.length = 0;
    await cli.main(["board", "japan"], env, out);
    assert.match(lines[0], /== Osaka {2}2026-02-01 to 2026-02-03/);
    assert.match(lines[0], /Any day in Kyoto\n {2}no date {2}Gion[^\n]*\n {2}no date {2}Picked/);
    lines.length = 0;
    await cli.main(["day", "japan", "2026-02-04"], env, out);
    assert.match(lines[0], /in Kyoto/);
    await assert.rejects(cli.main(["edit-place", "japan", "Gion", "--dest", "Tokyo"], env, out), /no destination "Tokyo"/);
    await cli.main(["edit-trip", "japan", "--destinations", "Osaka,Nara"], env, out);
    const u = g.read(Object.keys(Object.fromEntries(g.files())).find((p) => p.startsWith("trips/")));
    assert.strictEqual(u.trip.destInfo.Kyoto, undefined);
    assert.strictEqual(u.places.find((p) => p.name === "Picked").dest, undefined, "a dropped destination lets go of its places");
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
