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

test("a key's state: none, not checked, works or refused; a new key starts over", () => {
  S.setProvider("maptiler", { key: "" });
  assert.strictEqual(S.keyState("maptiler"), "none");
  assert.strictEqual(S.keyState("osm"), "none");
  S.setCheck("maptiler", true);
  assert.strictEqual(S.keyState("maptiler"), "none");
  S.setProvider("maptiler", { key: "M" });
  assert.strictEqual(S.keyState("maptiler"), "unchecked");
  S.setCheck("maptiler", false);
  assert.strictEqual(S.keyState("maptiler"), "refused");
  S.setProvider("maptiler", { style: "outdoor" });
  assert.strictEqual(S.keyState("maptiler"), "refused");
  S.setCheck("maptiler", true);
  assert.strictEqual(S.keyState("maptiler"), "ok");
  S.setProvider("maptiler", { key: "M2" });
  assert.strictEqual(S.keyState("maptiler"), "unchecked");
  assert.strictEqual(S.merge({ providers: { maptiler: { key: "M", check: { ok: "x" } } } }).providers.maptiler.check, undefined);
  assert.deepStrictEqual(S.merge({ providers: { maptiler: { key: "M", check: { ok: false, at: "t" } } } }).providers.maptiler.check, { ok: false, at: "t" });
});

test("AI tools may not delete until turned on; another device's newer choice wins", () => {
  assert.deepStrictEqual(S.merge(null).ai, { deleting: false, at: "" });
  assert.deepStrictEqual(S.merge({ ai: { deleting: "yes", at: "x" } }).ai, { deleting: false, at: "" });
  assert.strictEqual(S.get().ai.deleting, false);
  S.setAi(true);
  const at = S.get().ai.at;
  assert.ok(S.get().ai.deleting && at);
  assert.strictEqual(S.adoptAi({ deleting: false, at: "2000-01-01T00:00:00.000Z" }), false);
  assert.strictEqual(S.adoptAi({ deleting: false, at: "2999-01-01T00:00:00.000Z" }), true);
  assert.deepStrictEqual(S.get().ai, { deleting: false, at: "2999-01-01T00:00:00.000Z" });
});

test("the clock and date order follow the device until picked; nothing else is kept", () => {
  assert.deepStrictEqual(S.merge(null).display, { clock: "", dates: "" });
  assert.deepStrictEqual(S.merge({ display: { clock: "12", dates: "dm" } }).display, { clock: "12", dates: "dm" });
  assert.deepStrictEqual(S.merge({ display: { clock: "13", dates: "ymd" } }).display, { clock: "", dates: "" });
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

test("adoptId takes another device's id and remembers the old one", () => {
  const old = S.get().me.id;
  S.adoptId("ushared123");
  assert.deepStrictEqual([S.get().me.id, S.get().me.was], ["ushared123", [old]]);
  S.adoptId("ushared123");
  S.adoptId("<bad>");
  assert.deepStrictEqual(S.get().me.was, [old]);
  S.setMe({ name: "D" });
  assert.strictEqual(S.get().me.id, "ushared123");
  assert.deepStrictEqual(S.merge({ me: { id: "ushared123", was: ["uold1234", 5, "<x>"] } }).me.was, ["uold1234"]);
});

console.log(passed + " passed");
