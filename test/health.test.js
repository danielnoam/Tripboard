// What drifts unseen (`node test/health.test.js`), with keel's checks:
// CSS classes and functions nothing uses (RULES.md, "Nothing left
// behind"), the motion rules in the stylesheet (curves are tokens), long
// fixed waits in the tests, and UI text set from an English literal that
// no language table can reach.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { unused, motion, waits, i18n } = require("../tools/keel-checks.js");

const ROOT = path.resolve(__dirname, "..");
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.log("  FAIL - " + name + "\n    " + e.message); process.exitCode = 1; }
}

const at = (dir, keep) => fs.readdirSync(path.join(ROOT, dir)).filter(keep).map((f) => path.join(ROOT, dir, f));
// Ours to keep tidy: not vendored code, not keel's (checked in keel).
const ours = at("src", (f) => f.endsWith(".js"));
const page = [...ours, ...at("src/keel", (f) => f.endsWith(".js")), path.join(ROOT, "index.html"), path.join(ROOT, "sw.js")];
const css = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
const short = (p) => path.relative(ROOT, p);

// Classes the code puts together, so their whole name is written nowhere,
// and MapLibre's own.
const BUILT = [
  "tint-",       // views.js: a trip card's "tint-" + a number from its id
  "imp-",        // map.js and views.js: "imp-" + a place's importance
  "maplibregl-", // MapLibre's controls, restyled
];

test("every class in styles.css is one the code or index.html uses", () => {
  assert.deepStrictEqual(unused.classes(css, page, { built: BUILT }), []);
});

test("every function in src/ is called somewhere", () => {
  assert.deepStrictEqual(unused.functions(ours, page).map((u) => short(u.file) + ":" + u.line + " " + u.name), []);
});

test("styles.css keeps RULES.md's motion rules", () => {
  assert.deepStrictEqual(motion.check(css), []);
});

test("no test waits a second or more on a fixed timer", () => {
  assert.deepStrictEqual(waits.find(at("test", (f) => f.endsWith(".js"))).map((w) => short(w.file) + ":" + w.line + " " + w.ms + "ms"), []);
});

test("no UI text is set from an English literal", () => {
  assert.deepStrictEqual(i18n.literals(ours).map((l) => short(l.file) + ":" + l.line + " " + l.text), []);
});

console.log("\n" + passed + " passed");
