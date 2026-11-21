// The drift guard: everything the app can do has a CLI command and an MCP
// tool, or a stated reason it can't (`node test/coverage.test.js`). It
// reads the app itself (model.js, index.html, views.js, sync.js) and
// checks cli/coverage.js and cli/tools.js against it, so a new field,
// sheet, Settings page, undoable action, repo file or model function
// fails here until a tool covers it (CONTRIBUTING.md, "Every change works
// from the CLI and MCP").
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const M = require("../src/model.js");
const core = require("../cli/core.js");
const { TOOLS } = require("../cli/tools.js");
const mcp = require("../cli/mcp.js");
const C = require("../cli/coverage.js");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + (e.message || e)); }
}

const toolNames = new Set(TOOLS.map((t) => t.tool));
// Each entry is a list of real tools or a reason; nothing listed that the app doesn't have.
function covers(what, found, table) {
  const missing = [...found].filter((k) => !(k in table));
  assert.deepStrictEqual(missing, [], what + " the CLI/MCP doesn't cover yet: " + missing.join(", ") + ". Add a tool (cli/tools.js) and list it in cli/coverage.js, or say there why a chat can't do it.");
  const stale = Object.keys(table).filter((k) => !found.has(k));
  assert.deepStrictEqual(stale, [], "cli/coverage.js lists " + what + " the app no longer has: " + stale.join(", "));
  for (const [k, v] of Object.entries(table)) {
    if (typeof v === "string") { assert.match(v, /^(device|auto|cli|app)\b/, what + " " + k + ": a reason starts with device:, auto: or app:"); continue; }
    assert.ok(Array.isArray(v) && v.length, what + " " + k + ": give the tools, or a reason");
    for (const t of v) assert.ok(toolNames.has(t), what + " " + k + ": no tool " + t);
  }
}

test("every field of every record has a tool that writes it, or a reason", () => {
  for (const [kind, known] of Object.entries(M.KNOWN)) covers(kind + " fields", known, C.fields[kind] || {});
  assert.deepStrictEqual(Object.keys(C.fields).sort(), Object.keys(M.KNOWN).sort());
});

test("a field a write tool lists is one its tool takes", () => {
  for (const [kind, table] of Object.entries(C.fields)) {
    for (const [field, tools] of Object.entries(table)) {
      if (!Array.isArray(tools)) continue;
      for (const name of tools) {
        const t = TOOLS.find((x) => x.tool === name);
        if (!["add_", "create_", "update_"].some((v) => name === v + kind)) continue;
        assert.ok(t.args.some(([k]) => k === field), name + " is listed for " + kind + "." + field + " but doesn't take " + field);
      }
    }
  }
});

test("every collection of the data", () => {
  covers("collections", new Set(Object.keys(M.sanitizeDoc({}))), C.collections);
});

test("every sheet in index.html", () => {
  const html = read("index.html");
  covers("sheets", new Set([...html.matchAll(/<dialog[^>]*\bid="(\w+)"/g)].map((m) => m[1])), C.sheets);
});

test("every Settings page", () => {
  covers("Settings pages", new Set([...read("src/views.js").matchAll(/#\/settings\/([a-z]+)/g)].map((m) => m[1])), C.settings);
});

test("everything the app can undo", () => {
  const lines = read("src/views.js").split("\n").filter((l) => /\bundoable\(/.test(l) && !/function undoable/.test(l));
  const found = new Set(lines.flatMap((l) => [...l.matchAll(/i18n\.tn?\((?:[^,"()]+, )?"([^"]+)"/g)].map((m) => m[1])));
  assert.ok(found.size >= 6, "found only " + found.size + " undoable actions; has views.js's undoable() changed shape? Update this test's pattern.");
  covers("undoable actions", found, C.actions);
});

test("every file sync.js keeps in the repo", () => {
  const found = new Set([...read("src/sync.js").matchAll(/"((?:trips|covers|files)\/|[a-z]+\.json)"/g)].map((m) => m[1]));
  covers("repo files", found, C.repo);
});

test("every function and list model.js gives: used by cli/, or why not", () => {
  covers("model.js exports", new Set(Object.keys(M)), C.model);
  const src = fs.readdirSync(path.join(root, "cli")).filter((f) => f.endsWith(".js") && f !== "coverage.js").map((f) => read("cli/" + f)).join("\n");
  for (const [k, v] of Object.entries(C.model)) if (v === "cli") assert.ok(new RegExp("\\bM\\." + k + "\\b").test(src), "coverage.js says cli/ uses M." + k + ", but it doesn't");
});

test("CLI and MCP are the same list: every tool has both names, all unique, each backed by core.js", () => {
  const tools = TOOLS.map((t) => t.tool), cmds = TOOLS.map((t) => t.cmd);
  assert.strictEqual(new Set(tools).size, tools.length, "a tool name is used twice");
  assert.strictEqual(new Set(cmds).size, cmds.length, "a command name is used twice");
  for (const t of TOOLS) {
    assert.match(t.tool, /^[a-z]+(_[a-z]+)+$/, t.tool);
    assert.match(t.cmd, /^[a-z]+(-[a-z]+)*$/, t.cmd);
    assert.ok(t.description && t.description.length > 20, t.tool + " needs a description");
    if (t.kind === "write") assert.strictEqual(typeof core.ops[t.op], "function", t.tool + ": no core.ops." + t.op);
    else assert.ok(t.run || typeof core.queries[t.query] === "function", t.tool + ": no core.queries." + t.query);
    for (const [k, s, o = {}] of t.args) {
      assert.ok(s && s.type, t.tool + "." + k + " needs a type");
      if (o.req) assert.ok(o.mcp !== false && o.cli !== false, t.tool + "." + k + " is required, so both sides take it");
    }
  }
  assert.deepStrictEqual(mcp.TOOLS.map((t) => t.name), tools);
});

test("published tools are never renamed or removed, and new ones are added to the published list", () => {
  const gone = C.PUBLISHED.filter((n) => !toolNames.has(n));
  assert.deepStrictEqual(gone, [], "a chat may use these: keep them");
  const fresh = [...toolNames].filter((n) => !C.PUBLISHED.includes(n));
  assert.deepStrictEqual(fresh, [], "add new tools to PUBLISHED in cli/coverage.js");
});

test("cli/README.md names every command and tool", () => {
  const md = read("cli/README.md");
  const missing = TOOLS.filter((t) => !md.includes("`" + t.cmd + "`") || !md.includes("`" + t.tool + "`")).map((t) => t.cmd + " / " + t.tool);
  assert.deepStrictEqual(missing, [], "cli/README.md's table is missing these");
});

console.log(passed + " passed");
