// src/settings.js: providers, and each service's main and fallback (`node test/settings.test.js`).
const assert = require("assert");
const S = require("../src/settings.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + e.message); }
}

test("defaults: OpenFreeMap's map and OpenStreetMap's search, no fallback", () => {
  const d = S.merge(null);
  assert.deepStrictEqual([d.map, d.search], [{ main: "openfreemap", fallback: "" }, { main: "osm", fallback: "" }]);
});

test("a provider that can't do a service is never chosen for it", () => {
  const d = S.merge({ map: { main: "osm", fallback: "google" }, search: { main: "openfreemap", fallback: "nope" } });
  assert.deepStrictEqual([d.map, d.search], [{ main: "openfreemap", fallback: "google" }, { main: "osm", fallback: "" }]);
});

test("keys and options survive, unknown providers don't", () => {
  const d = S.merge({ providers: { google: { key: "K", mapType: "satellite" }, other: { key: "x" } } });
  assert.deepStrictEqual(d.providers.google, { key: "K", mapType: "satellite" });
  assert.strictEqual(d.providers.other, undefined);
});

test("the chain is main then fallback; a fallback the same as main is dropped", () => {
  S.setService("map", { main: "google", fallback: "openfreemap" });
  assert.deepStrictEqual(S.chain("map"), ["google", "openfreemap"]);
  S.setService("map", { fallback: "google" });
  assert.deepStrictEqual(S.chain("map"), ["google"]);
  assert.strictEqual(S.ready("google"), false);
  S.setProvider("google", { key: "K" });
  assert.strictEqual(S.ready("google"), true);
  assert.strictEqual(S.ready("osm"), true);
});

test("the theme is system, light or dark, and system by default", () => {
  assert.strictEqual(S.merge(null).appearance.theme, "system");
  assert.strictEqual(S.merge({ appearance: { theme: "dark" } }).appearance.theme, "dark");
  assert.strictEqual(S.merge({ appearance: { theme: "neon" } }).appearance.theme, "system");
  S.setTheme("light");
  assert.strictEqual(S.get().appearance.theme, "light");
});

test("me: a person id and a name are kept, a bad id isn't", () => {
  assert.deepStrictEqual(S.merge({ me: { id: "u123abc", name: "  Daniel " } }).me, { id: "u123abc", name: "Daniel" });
  assert.strictEqual(S.merge({ me: { id: "<x>" } }).me.id, "");
  assert.ok(/^u\w+$/.test(S.get().me.id));
});

console.log(passed + " passed");
