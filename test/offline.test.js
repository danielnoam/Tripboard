// src/offline.js: which map tiles a trip saves (`node test/offline.test.js`).
const assert = require("assert");
const O = require("../src/offline.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + e.message); }
}

const lisbon = [38.7139, -9.1334], sintra = [38.7976, -9.3906];

test("a place gets the world down to street level, every zoom from 0 to 14", () => {
  const tiles = O.plan([lisbon]);
  const zooms = new Set(tiles.map((k) => Number(k.split("/")[0])));
  assert.deepStrictEqual([...zooms].sort((a, b) => a - b), [...Array(15).keys()]);
  assert.ok(tiles.includes("0/0/0"));
  // Lisbon's street-level tile.
  assert.ok(tiles.includes("14/7776/6278"));
  assert.ok(tiles.length < 300, tiles.length + " tiles for one place");
});

test("two places share their tiles, and nothing is listed twice", () => {
  const one = O.plan([lisbon]).length, two = O.plan([lisbon, sintra]);
  assert.strictEqual(new Set(two).size, two.length);
  assert.ok(two.length > one && two.length < one * 2);
});

test("a trip across a continent stays under the limit", () => {
  const pts = [[35.68, 139.76], [34.99, 135.76], [34.69, 135.5], [48.85, 2.35], [41.9, 12.49], [40.71, -74.0], [-33.86, 151.21]];
  assert.ok(O.plan(pts).length < O.MAX_TILES);
});

test("the tile source's top zoom caps the plan; no places, no tiles", () => {
  assert.ok(O.plan([lisbon], 6).every((k) => Number(k.split("/")[0]) <= 6));
  assert.deepStrictEqual(O.plan([]), []);
});

test("a place added since is spotted when it's off the saved map", () => {
  assert.strictEqual(O.missing([lisbon], [lisbon, [38.715, -9.14]]), 0);
  assert.strictEqual(O.missing([lisbon], [lisbon, sintra]), 1);
});

test("only located places count, rounded", () => {
  assert.deepStrictEqual(O.pointsOf([{ lat: 38.713912, lng: -9.133456 }, { lat: null }, {}]), [[38.7139, -9.1335]]);
});

test("a tile is kept under one key whatever OpenFreeMap's version", () => {
  assert.strictEqual(O.keyOf("https://tiles.openfreemap.org/planet/20251101_001001_pt/14/1/2.pbf"), "https://tiles.openfreemap.org/planet/_/14/1/2.pbf");
  assert.strictEqual(O.keyOf("https://tiles.openfreemap.org/planet/20250101_001001_pt/14/1/2.pbf"), "https://tiles.openfreemap.org/planet/_/14/1/2.pbf");
  assert.strictEqual(O.keyOf("https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf"), "https://tiles.openfreemap.org/fonts/Noto Sans Regular/0-255.pbf");
});

test("a style reads OpenFreeMap through tbo://, and lists its fonts and sprites", () => {
  const style = {
    sources: { openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
      ne: { type: "raster", tiles: ["https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png"] }, other: { type: "geojson", data: {} } },
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sprite: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
    layers: [{ layout: { "text-font": ["Noto Sans Bold"] } }, { layout: { "text-font": ["Noto Sans Regular"] } }, { layout: { "text-font": ["Noto Sans Bold"] } }, { layout: {} }],
  };
  const s = O.rewrite(style);
  assert.strictEqual(s.sources.openmaptiles.url, "tbo://tiles.openfreemap.org/planet");
  assert.strictEqual(s.sources.ne.tiles[0], "tbo://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png");
  assert.strictEqual(s.glyphs, "tbo://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf");
  assert.strictEqual(s.sprite, "tbo://tiles.openfreemap.org/sprites/ofm_f384/ofm");
  assert.strictEqual(style.glyphs.startsWith("https://"), true, "the original is left alone");
  assert.deepStrictEqual(O.fontsOf(style), ["Noto Sans Bold", "Noto Sans Regular"]);
  assert.strictEqual(O.spritesOf(style).length, 4);
});

console.log(passed + " passed");
