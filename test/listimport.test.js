// src/listimport.js: places from Google Maps' exports (`node test/listimport.test.js`).
const assert = require("assert");
const L = require("../src/listimport.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + e.message); }
}

test("Takeout's CSV: titles, notes, quoted commas, a location when the link has one", () => {
  const csv = "\uFEFFTitle,Note,URL,Tags,Comment\n" +
    "Time Out Market,\"Go hungry, early\",https://www.google.com/maps/place/Time+Out+Market/data=!4m2!3m1!1s0x0:0x1,,\n" +
    "Miradouro,,\"https://www.google.com/maps/search/38.7139,+-9.1334\",,\n" +
    ",,\"https://www.google.com/maps/place/Feira+da+Ladra/@38.71,-9.12,17z\",,\n" +
    ",,,,\n";
  assert.deepStrictEqual(L.parse(csv, "Lisbon.csv"), [
    { name: "Time Out Market", note: "Go hungry, early", url: "https://www.google.com/maps/place/Time+Out+Market/data=!4m2!3m1!1s0x0:0x1" },
    { name: "Miradouro", lat: 38.7139, lng: -9.1334, url: "https://www.google.com/maps/search/38.7139,+-9.1334" },
    { name: "Feira da Ladra", lat: 38.71, lng: -9.12, url: "https://www.google.com/maps/place/Feira+da+Ladra/@38.71,-9.12,17z" },
  ]);
});

test("My Maps' KML: names, descriptions without markup, points", () => {
  const kml = `<?xml version="1.0"?><kml><Document><Placemark><name>Bel&amp;m Tower</name><description><![CDATA[Open <b>10-6</b>]]></description>
    <Point><coordinates>-9.2160,38.6916,0</coordinates></Point></Placemark><Placemark><name>No point</name></Placemark></Document></kml>`;
  assert.deepStrictEqual(L.parse(kml, "trip.kml"), [{ name: "Bel&m Tower", note: "Open 10-6", lat: 38.6916, lng: -9.216 }, { name: "No point" }]);
});

test("Takeout's Saved Places.json: GeoJSON points, the place's name, 0,0 isn't a location", () => {
  const gj = JSON.stringify({ type: "FeatureCollection", features: [
    { geometry: { type: "Point", coordinates: [-9.14, 38.71] }, properties: { location: { name: "Rossio" }, google_maps_url: "http://maps.google.com/?cid=1" } },
    { geometry: { type: "Point", coordinates: [0, 0] }, properties: { Title: "Somewhere", Comment: "Ask Ana" } },
  ] });
  assert.deepStrictEqual(L.parse(gj, "Saved Places.json"), [
    { name: "Rossio", lat: 38.71, lng: -9.14, url: "http://maps.google.com/?cid=1" }, { name: "Somewhere", note: "Ask Ana" }]);
});

test("not a list: nothing", () => {
  assert.deepStrictEqual(L.parse("just some text", "x.txt"), []);
  assert.deepStrictEqual(L.parse("{ broken", "x.json"), []);
});

console.log(passed + " passed");
