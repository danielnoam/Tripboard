// Copies the files the sharing server's bundle takes in from the app into
// server/app/, so server/ stands on its own: Cloudflare's Deploy button
// takes only that folder (server/README.md, "Running your own").
//
//   node tools/server-copy.js           write the copies
//   node tools/server-copy.js --check   list the ones that differ (test/server.test.js)
//
// The cloud connector (server/mcp.js) serves cli/'s tools, which load
// src/'s model, merge, list import, places and weather and keel's
// github.js. The copies keep the same paths under server/app/, so their
// require("../src/…") still works. Change the originals, then run this.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "server", "app");
const FILES = [
  "cli/mcp.js", "cli/core.js", "cli/tools.js",
  "src/model.js", "src/merge.js", "src/listimport.js", "src/places.js", "src/weather.js",
  "src/keel/github.js",
];
// server/package.json makes its .js files modules; these are CommonJS.
const PKG = JSON.stringify({ type: "commonjs", private: true }) + "\n";

const wanted = () => [["package.json", PKG], ...FILES.map((f) => [f, fs.readFileSync(path.join(ROOT, f), "utf8")])];
function stale() {
  const out = wanted().filter(([f, text]) => { try { return fs.readFileSync(path.join(OUT, f), "utf8") !== text; } catch (e) { return true; } }).map(([f]) => f);
  const listed = new Set(wanted().map(([f]) => f));
  const walk = (d, rel = "") => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name), rel + e.name + "/") : [rel + e.name]) : [];
  return out.concat(walk(OUT).filter((f) => !listed.has(f)).map((f) => f + " (not the app's)"));
}
function write() {
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const [f, text] of wanted()) {
    fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true });
    fs.writeFileSync(path.join(OUT, f), text);
  }
}

if (require.main === module) {
  if (process.argv.includes("--check")) {
    const s = stale();
    if (s.length) { console.log("server/app/ is out of date: " + s.join(", ") + ". Run node tools/server-copy.js."); process.exitCode = 1; }
  } else { write(); console.log("server/app/: " + (FILES.length + 1) + " files"); }
}
module.exports = { FILES, stale, write };
