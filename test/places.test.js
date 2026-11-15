// src/places.js: finding a place by name (`node test/places.test.js`).
const assert = require("assert");
const P = require("../src/places.js");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + e.message); }
}

(async () => {
  await test("OpenStreetMap's kinds of place become categories", () => {
    assert.deepStrictEqual([["tourism", "museum"], ["amenity", "cafe"], ["amenity", "pub"], ["tourism", "hotel"], ["railway", "station"],
      ["leisure", "park"], ["shop", "clothes"], ["amenity", "place_of_worship"], ["highway", "residential"]].map(([c, t]) => P.categoryOf(c, t)),
      ["museum", "food", "nightlife", "stay", "transport", "nature", "shopping", "sight", null]);
  });

  await test("a result: its name, the rest of its address, its location", () => {
    const r = P.fromNominatim({ name: "Fushimi Inari-taisha", display_name: "Fushimi Inari-taisha, 68, Fukakusa Yabunouchicho, Fushimi Ward, Kyoto, Japan", lat: "34.967", lon: "135.772", category: "amenity", type: "place_of_worship" });
    assert.deepStrictEqual(r, { name: "Fushimi Inari-taisha", address: "68, Fukakusa Yabunouchicho, Fushimi Ward, Kyoto, Japan", lat: 34.967, lng: 135.772, category: "sight" });
  });

  await test("a search asks Nominatim, near the trip's places, and drops results with no location", async () => {
    let asked;
    const fetchFn = async (u) => { asked = new URL(u); return { ok: true, json: async () => [{ name: "A", display_name: "A, B", lat: "1", lon: "2" }, { name: "C", lat: "x" }] }; };
    const out = await P.providers.osm.search("tea house", { near: [{ lat: 35, lng: 135 }], fetchFn });
    assert.strictEqual(asked.origin + asked.pathname, "https://nominatim.openstreetmap.org/search");
    assert.deepStrictEqual([asked.searchParams.get("q"), asked.searchParams.get("viewbox")], ["tea house", "134.5,35.5,135.5,34.5"]);
    assert.deepStrictEqual(out.map((r) => r.name), ["A"]);
    assert.deepStrictEqual(await P.providers.osm.search("  ", { fetchFn }), []);
  });

  await test("too many searches says so", async () => {
    await assert.rejects(P.providers.osm.search("x", { fetchFn: async () => ({ ok: false, status: 429 }) }), /too many searches/);
  });

  await test("Google: a key is needed, the field mask and key go in headers, the id comes back", async () => {
    await assert.rejects(P.providers.google.search("x", {}), /needs a key/);
    let init;
    const fetchFn = async (u, i) => { init = i; return { ok: true, json: async () => ({ places: [{ id: "ChIJ1", displayName: { text: "Louvre" }, formattedAddress: "Paris", location: { latitude: 48.86, longitude: 2.33 }, types: ["museum"] }] }) }; };
    const r = await P.providers.google.search("louvre", { key: "K", fetchFn });
    assert.strictEqual(init.headers["X-Goog-Api-Key"], "K");
    assert.ok(/places\.id/.test(init.headers["X-Goog-FieldMask"]));
    assert.deepStrictEqual(r[0], { name: "Louvre", address: "Paris", lat: 48.86, lng: 2.33, category: "museum", placeId: "ChIJ1", source: "google" });
  });

  await test("the chain falls back when the main provider fails, and says why", async () => {
    const fetchFn = async (u) => (/googleapis/.test(u) ? { ok: false, status: 403, json: async () => ({ error: { message: "API not enabled" } }) }
      : { ok: true, json: async () => [{ name: "A", display_name: "A", lat: "1", lon: "2" }] });
    const got = await P.search("a", { chain: ["google", "osm"], keys: { google: "K" }, fetchFn });
    assert.strictEqual(got.by, "osm");
    assert.deepStrictEqual(got.skipped, [{ id: "google", reason: "Google refused the key: API not enabled" }]);
    const none = await P.search("a", { chain: ["maptiler", "osm"], keys: {}, fetchFn });
    assert.ok(/MapTiler needs a key/.test(none.skipped[0].reason));
    await assert.rejects(P.search("a", { chain: ["google"], keys: {}, fetchFn }), /needs a key/);
  });

  await test("a Google location is fetched again by its place id", async () => {
    let seen;
    const fetchFn = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ location: { latitude: 35.1, longitude: 135.7 } }) }; };
    assert.deepStrictEqual(await P.googleLocation("ChIJ x", { key: "K", fetchFn }), { lat: 35.1, lng: 135.7 });
    assert.strictEqual(seen.url, "https://places.googleapis.com/v1/places/ChIJ%20x");
    assert.strictEqual(seen.init.headers["X-Goog-FieldMask"], "location");
    await assert.rejects(P.googleLocation("x", {}), /needs a key/);
  });

  console.log(passed + " passed");
})();
