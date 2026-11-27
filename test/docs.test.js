// ARCHITECTURE.md is the map of the code, and a map with a file missing
// sends people the wrong way: `node test/docs.test.js` fails when a file
// in src/, tools/, cli/, test/ or a workflow isn't named there. src/ files go by
// their path; the others by their name, since ARCHITECTURE.md lists some
// of them together on one line (tools/ … (from keel), the workflows).
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.log("  FAIL - " + name + "\n    " + e.message); process.exitCode = 1; }
}

const doc = fs.readFileSync(path.join(ROOT, "ARCHITECTURE.md"), "utf8");
const lower = doc.toLowerCase();
const list = (dir, keep) => fs.readdirSync(path.join(ROOT, dir)).filter(keep).map((f) => dir + "/" + f);

test("ARCHITECTURE.md names every file in src/ and src/keel/ by its path", () => {
  const files = [...list("src", (f) => /\.(js|css)$/.test(f)), ...list("src/keel", (f) => f.endsWith(".js"))];
  assert.deepStrictEqual(files.filter((f) => !doc.includes(f)), []);
});

test("ARCHITECTURE.md names every tool, CLI file and test", () => {
  const files = [...list("tools", () => true), ...list("cli", (f) => f.endsWith(".js")), ...list("test", (f) => f.endsWith(".js"))];
  assert.deepStrictEqual(files.filter((f) => !doc.includes(path.basename(f))), []);
});

test("ARCHITECTURE.md names every workflow", () => {
  const files = list(".github/workflows", (f) => f.endsWith(".yml"));
  assert.deepStrictEqual(files.filter((f) => !lower.includes(path.basename(f, ".yml"))), []);
});

console.log("\n" + passed + " passed");
