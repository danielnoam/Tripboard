// src/model.js: cleaning, days, slots and the board's sorts (`node test/model.test.js`).
const assert = require("assert");
const M = require("../src/model.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + e.message); }
}

const trip = M.sanitizeTrip({ id: "t", name: "Kyoto", start: "2026-11-17", end: "2026-11-19", destinations: "Kyoto, Nara, Kyoto" });
const P = (o) => M.sanitizePlace({ trip: "t", ...o });

test("a trip is cleaned: swapped dates, destinations from text, no duplicates", () => {
  const t = M.sanitizeTrip({ name: "  ", start: "2026-12-05", end: "2026-12-01", destinations: ["A", " ", "A", "B"] });
  assert.deepStrictEqual([t.name, t.start, t.end, t.destinations], ["Untitled trip", "2026-12-01", "2026-12-05", ["A", "B"]]);
  assert.deepStrictEqual(trip.destinations, ["Kyoto", "Nara"]);
  assert.strictEqual(M.sanitizeTrip({ start: "2027-02-30" }).start, undefined);
});

test("a place is cleaned: known category and importance, a time only with a day, an end only after it", () => {
  const p = P({ name: "x", category: "spaceport", importance: "urgent", time: "09:00" });
  assert.deepStrictEqual([p.category, p.importance, p.time], ["other", "want", undefined]);
  const q = P({ name: "y", day: "2026-11-17", time: "10:00", endTime: "09:00", lat: "35", lng: 135, extra: 1 });
  assert.deepStrictEqual([q.time, q.endTime, q.lat, q.lng, q.extra], ["10:00", undefined, 35, 135, 1]);
});

test("a place whose trip is gone is dropped", () => {
  const d = M.sanitizeDoc({ trips: [trip], places: [P({ name: "a" }), { trip: "gone", name: "b" }] });
  assert.deepStrictEqual(d.places.map((p) => p.name), ["a"]);
});

test("time slots: morning, afternoon from 12:00, evening from 17:00, any time without one", () => {
  assert.deepStrictEqual(["07:30", "12:00", "16:59", "17:00"].map((time) => M.slotOf({ time })), ["morning", "afternoon", "afternoon", "evening"]);
  assert.strictEqual(M.slotOf({}), "any");
});

const places = [
  P({ id: "a", name: "Fushimi Inari", day: "2026-11-17", time: "07:30", importance: "must", category: "sight", lat: 34.967, lng: 135.773 }),
  P({ id: "b", name: "Nishiki Market", day: "2026-11-17", time: "12:00", category: "food", lat: 35.005, lng: 135.765 }),
  P({ id: "c", name: "Gion walk", day: "2026-11-17", importance: "maybe" }),
  P({ id: "d", name: "Nara deer", day: "2026-11-21", category: "nature" }),
  P({ id: "e", name: "Tea house", category: "food", importance: "must" }),
];

test("by time: every trip day, a day outside it, slots in order, then No date", () => {
  const g = M.board(trip, places, "time");
  assert.deepStrictEqual(g.map((x) => x.id), ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-21", "nodate"]);
  assert.deepStrictEqual(g[0].slots.map((s) => [s.id, s.places.map((p) => p.id)]), [["morning", ["a"]], ["afternoon", ["b"]], ["any", ["c"]]]);
  assert.deepStrictEqual(g[1].slots, []);
  assert.deepStrictEqual(g[4].places.map((p) => p.id), ["e"]);
  assert.strictEqual(M.dayIndex(trip, "2026-11-21"), 5);
});

test("by category and by importance: only groups with places, most important first", () => {
  assert.deepStrictEqual(M.board(trip, places, "category").map((g) => [g.id, g.places.map((p) => p.id)]),
    [["sight", ["a"]], ["food", ["e", "b"]], ["nature", ["d"]], ["other", ["c"]]]);
  assert.deepStrictEqual(M.board(trip, places, "importance").map((g) => [g.id, g.places.map((p) => p.id)]),
    [["must", ["a", "e"]], ["want", ["b", "d"]], ["maybe", ["c"]]]);
});

test("importance filters every sort", () => {
  assert.deepStrictEqual(M.board(trip, places, "category", { only: ["must"] }).flatMap((g) => g.places.map((p) => p.id)), ["a", "e"]);
  assert.deepStrictEqual(M.board(trip, places, "time", { only: ["maybe"] })[0].places.map((p) => p.id), ["c"]);
});

test("by distance: nearest to you first, then the places with no location", () => {
  const g = M.board(trip, places, "distance", { from: { lat: 35.01, lng: 135.76 } });
  assert.deepStrictEqual(g.map((x) => [x.id, x.places.map((p) => p.id)]), [["near", ["b", "a"]], ["nowhere", ["e", "d", "c"]]]);
  assert.ok(g[0].km.get("b") < 1 && g[0].km.get("a") > 4);
  assert.deepStrictEqual(M.board(trip, places, "distance").map((x) => x.id), ["located", "nowhere"]);
});

test("Home's order: under way, upcoming soonest, undated, then past", () => {
  const t = (id, start, end) => M.sanitizeTrip({ id, name: id, start, end, createdAt: "2026-01-01" });
  const out = M.sortTrips([t("past", "2026-01-01", "2026-01-05"), t("later", "2027-03-01"), t("none"), t("now", "2026-11-10", "2026-11-20"), t("soon", "2026-12-01")], "2026-11-15");
  assert.deepStrictEqual(out.map((x) => x.id), ["now", "soon", "later", "none", "past"]);
});

test("a backup holds the asked-for trips and their places, and merges back in", () => {
  const doc = M.sanitizeDoc({ trips: [{ id: "t", name: "Kyoto" }, { id: "u", name: "Lisbon" }],
    places: [{ id: "a", trip: "t", name: "Fushimi" }, { id: "b", trip: "u", name: "Belém" }] });
  const one = M.backupOf(doc, ["u"]);
  assert.deepStrictEqual(one.trips.map((t) => t.id), ["u"]);
  assert.deepStrictEqual(one.places.map((p) => p.id), ["b"]);
  const edited = JSON.parse(JSON.stringify(M.backupOf(doc)));
  edited.trips[0].name = "Kyoto again";
  edited.trips.push({ id: "v", name: "Iceland" });
  const r = M.mergeBackup(doc, edited);
  assert.strictEqual(r.added, 1);
  assert.strictEqual(r.replaced, 2);
  assert.strictEqual(r.doc.trips.find((t) => t.id === "t").name, "Kyoto again");
  assert.strictEqual(r.doc.places.length, 2);
  assert.throws(() => M.mergeBackup(doc, { trips: [] }), /isn't a Tripboard backup/);
  assert.throws(() => M.mergeBackup(doc, { app: "tripboard", format: 99, trips: [] }), /newer/);
});

test("Google locations older than 30 days, or dropped for it, are due a refresh", () => {
  const list = [
    P({ id: "old", day: "", placeId: "g1", lat: 1, lng: 1, geoAt: "2026-10-01" }),
    P({ id: "new", placeId: "g2", lat: 1, lng: 1, geoAt: "2026-11-10" }),
    P({ id: "gone", placeId: "g3" }),
    P({ id: "osm", lat: 1, lng: 1, address: "Somewhere" }),
  ];
  assert.deepStrictEqual(M.staleGoogle(list, "2026-11-15").map((p) => p.id), ["old", "gone"]);
});

test("a day's route: its located places in planned order", () => {
  assert.deepStrictEqual(M.dayRoute([
    P({ id: "late", day: "2026-11-17", time: "18:00", lat: 1, lng: 1 }),
    P({ id: "early", day: "2026-11-17", time: "08:00", lat: 1, lng: 1 }),
    P({ id: "nowhere", day: "2026-11-17", time: "09:00" }),
    P({ id: "other", day: "2026-11-18", lat: 1, lng: 1 }),
  ], "2026-11-17").map((p) => p.id), ["early", "late"]);
});

console.log(passed + " passed");
