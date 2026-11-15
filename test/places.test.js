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
    await assert.rejects(P.providers.osm.search("x", { fetchFn: async () => ({ ok: false, status: 429 }) }), /Too many searches/);
  });

  console.log(passed + " passed");
})();
