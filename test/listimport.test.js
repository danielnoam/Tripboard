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

test("the list's name: KML's Document name, a Takeout CSV's file name, none for JSON", () => {
  assert.strictEqual(L.title("<kml><Document><name>Porto &amp; Douro</name><Placemark><name>Ribeira</name></Placemark></Document></kml>", "x.kml"), "Porto & Douro");
  assert.strictEqual(L.title("<kml><Document><Placemark><name>Ribeira</name></Placemark></Document></kml>", "x.kml"), "");
  assert.strictEqual(L.title("Title,Note,URL\n", "Tokyo eats (1).csv"), "Tokyo eats");
  assert.strictEqual(L.title("{}", "Saved Places.json"), "");
});

test("a pasted list: names and place links a line, bullets dropped, Share's short link kept with its name", () => {
  const got = L.pasted(["Pastéis de Belém", "https://maps.app.goo.gl/abc", "", "- Castelo de São Jorge", "2. A Cevicheria",
    "https://www.google.com/maps/place/Ocean%C3%A1rio+de+Lisboa/@38.7635,-9.0937,17z", "https://maps.app.goo.gl/xyz",
    "pastéis de belém", "Time Out Market: https://maps.app.goo.gl/q", "https://example.com/blog"].join("\r\n"));
  assert.deepStrictEqual(got.places.map((p) => p.name), ["Pastéis de Belém", "Castelo de São Jorge", "A Cevicheria", "Oceanário de Lisboa", "Time Out Market"]);
  assert.deepStrictEqual([got.places[3].lat, got.places[3].lng, got.places[3].from], [38.7635, -9.0937, "link"]);
  assert.strictEqual(got.short, 1, "a short link on its own line after a link can't be read");
  assert.deepStrictEqual(L.pasted(""), { places: [], short: 0 });
});

console.log(passed + " passed");
