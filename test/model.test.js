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

test("a place is cleaned: a category id (yours or a default), known importance, a time only with a day, an end only after it", () => {
  const p = P({ name: "x", category: "space port", importance: "urgent", time: "09:00" });
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

test("by area: a block a destination in date order, trips out of a longer one inside it, then undated and none", () => {
  const tr = M.sanitizeTrip({ id: "j", name: "Japan", start: "2023-02-05", end: "2023-02-20", destinations: ["Osaka", "Hiroshima", "Tokyo", "Nara"],
    destInfo: { Osaka: { start: "2023-02-06", end: "2023-02-13", lat: 34.69, lng: 135.5 }, Hiroshima: { start: "2023-02-08", end: "2023-02-08", lat: 34.39, lng: 132.46 },
      Tokyo: { start: "2023-02-13", end: "2023-02-20", lat: 35.68, lng: 139.77 }, Nara: { lat: 34.69, lng: 135.8 } } });
  const ps = [
    P({ id: "fly", trip: "j", name: "TLV", kind: "journey", mode: "flight", day: "2023-02-05", time: "05:40", toName: "ZRH" }),
    P({ id: "hotel", trip: "j", name: "IAM", category: "stay", day: "2023-02-06", endDay: "2023-02-13", lat: 34.67, lng: 135.5 }),
    P({ id: "castle", trip: "j", name: "Osaka Castle", lat: 34.68, lng: 135.52 }),
    P({ id: "usj", trip: "j", name: "USJ", day: "2023-02-09", lat: 34.66, lng: 135.43 }),
    P({ id: "dome", trip: "j", name: "Peace Park", day: "2023-02-08", lat: 34.39, lng: 132.45 }),
    P({ id: "miya", trip: "j", name: "Miyajima", day: "2023-02-08" }),
    P({ id: "deer", trip: "j", name: "Nara Park", lat: 34.68, lng: 135.84 }),
    P({ id: "crawl", trip: "j", name: "Pub crawl" }),
  ];
  const g = M.board(tr, ps, "area");
  assert.deepStrictEqual(g.map((x) => [x.kind || "none", x.title]), [["travel", "On the way"], ["area", "Osaka"], ["area", "Tokyo"], ["area", "Nara"], ["none", "No destination"]]);
  const osaka = g[1];
  assert.deepStrictEqual(osaka.stays.map((p) => p.id), ["hotel"]);
  assert.deepStrictEqual(osaka.places.map((p) => p.id), ["usj", "castle"]);
  assert.deepStrictEqual(osaka.side.map((x) => [x.dest, x.places.map((p) => p.id)]), [["Hiroshima", ["miya", "dome"]]]);
  assert.deepStrictEqual(g[3].places.map((p) => p.id), ["deer"]);
  assert.deepStrictEqual(g[4].places.map((p) => p.id), ["crawl"]);
  // A place near Osaka but on a Tokyo day goes with Tokyo.
  ps[3].day = "2023-02-15";
  assert.deepStrictEqual(M.board(tr, ps, "area")[2].places.map((p) => p.id), ["usj"]);
});

test("by area: destInfo's in puts a destination inside another, dates or not, or on its own", () => {
  const tr = (info) => M.sanitizeTrip({ id: "j", name: "Japan", destinations: ["Tokyo", "Hakone", "Nara", "Kyoto"],
    destInfo: { Tokyo: { start: "2023-02-17", end: "2023-03-01" }, Hakone: { start: "2023-02-20", end: "2023-02-21" }, ...info } });
  const ps = ["Tokyo", "Hakone", "Nara", "Kyoto"].map((d) => P({ id: d, trip: "j", name: d, dest: d }));
  const shape = (t) => M.board(t, ps, "area").filter((g) => g.dest).map((g) => [g.dest, g.side.map((x) => x.dest)]);
  assert.deepStrictEqual(shape(tr({})), [["Tokyo", ["Hakone"]], ["Nara", []], ["Kyoto", []]]);
  assert.deepStrictEqual(shape(tr({ Nara: { in: "Tokyo" }, Hakone: { start: "2023-02-20", end: "2023-02-21", in: "" } })), [["Tokyo", ["Nara"]], ["Hakone", []], ["Kyoto", []]]);
  // One level deep, and a loop leaves both on their own.
  assert.deepStrictEqual(shape(tr({ Nara: { in: "Kyoto" }, Kyoto: { in: "Tokyo" } })), [["Tokyo", ["Hakone", "Nara", "Kyoto"]]]);
  assert.deepStrictEqual(shape(tr({ Nara: { in: "Kyoto" }, Kyoto: { in: "Nara" } })), [["Tokyo", ["Hakone"]], ["Nara", []], ["Kyoto", []]]);
  // Kept only when it names another of the trip's destinations, or is "".
  assert.strictEqual(tr({ Nara: { in: "Osaka" } }).destInfo.Nara, undefined);
  assert.strictEqual(tr({ Nara: { in: "Nara" } }).destInfo.Nara, undefined);
  assert.deepStrictEqual(tr({ Nara: { in: "" } }).destInfo.Nara, { in: "" });
});

test("a rating is a whole number of stars, 1 to 5; anything else is no rating", () => {
  assert.strictEqual(P({ rating: 4 }).rating, 4);
  assert.strictEqual(P({ rating: "3" }).rating, 3);
  assert.strictEqual(P({ rating: 4.6 }).rating, 5);
  for (const r of [0, 6, -1, "", null, "great"]) assert.ok(!("rating" in P({ rating: r })), String(r));
});

test("the Plan's filters: importance (journeys stay), categories, and stars and up or not rated", () => {
  assert.deepStrictEqual(M.board(trip, places, "time", { only: ["maybe"] })[0].places.map((p) => p.id), ["c"]);
  assert.deepStrictEqual(M.filterPlaces(places, { categories: ["food"] }).map((p) => p.id).sort(), ["b", "e"]);
  const ps = [P({ id: "a", rating: 3 }), P({ id: "b", rating: 5 }), P({ id: "c", rating: 4 }), P({ id: "d" }), P({ id: "j", kind: "journey", mode: "train", day: "2026-11-17" })];
  const ids = (stars) => M.filterPlaces(ps, { stars }).map((p) => p.id).sort();
  assert.deepStrictEqual(ids("5"), ["b", "j"]);
  assert.deepStrictEqual(ids("4"), ["b", "c", "j"]);
  assert.deepStrictEqual(ids("3"), ["a", "b", "c", "j"]);
  assert.deepStrictEqual(ids("none"), ["d", "j"]);
  assert.deepStrictEqual(ids(""), ["a", "b", "c", "d", "j"]);
  assert.deepStrictEqual(ids("2"), ["a", "b", "c", "d", "j"], "not a choice the app has: no filter");
  assert.deepStrictEqual(M.board({ id: "t", name: "T" }, ps, "time", { stars: "4", only: ["must"] }).flatMap((g) => g.places.map((p) => p.id)).sort(), ["j"]);
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

test("today's plan: timed places by time, then the rest by importance, stays included", () => {
  const list = [
    P({ id: "late", day: "2026-11-18", time: "18:00" }),
    P({ id: "maybe", day: "2026-11-18", importance: "maybe" }),
    P({ id: "must", day: "2026-11-18", importance: "must" }),
    P({ id: "early", day: "2026-11-18", time: "08:00" }),
    P({ id: "stay", day: "2026-11-17", endDay: "2026-11-19", time: "15:00" }),
    P({ id: "other", day: "2026-11-19", time: "07:00" }),
  ];
  assert.deepStrictEqual(M.dayPlan(list, "2026-11-18").map((p) => p.id), ["early", "stay", "late", "must", "maybe"]);
  const plan = M.dayPlan(list, "2026-11-18");
  plan[0].visited = true;
  assert.strictEqual(M.nextOf(plan).id, "stay");
  assert.strictEqual(M.nextOf([]), null);
});

test("a stay's times are check-in on its first day and check-out on its last, nothing between", () => {
  const hotel = P({ id: "hotel", category: "stay", day: "2026-11-17", endDay: "2026-11-19", time: "15:00", endTime: "11:00" });
  assert.strictEqual(hotel.endTime, "11:00");
  assert.strictEqual(P({ category: "stay", day: "2026-11-17", endDay: "2026-11-19", endTime: "11:00" }).endTime, "11:00");
  assert.strictEqual(P({ category: "stay", day: "2026-11-17", time: "15:00", endTime: "11:00" }).endTime, undefined);
  assert.strictEqual(P({ category: "sight", day: "2026-11-17", endDay: "2026-11-19", time: "15:00", endTime: "11:00" }).endTime, undefined);
  assert.deepStrictEqual(["2026-11-17", "2026-11-18", "2026-11-19"].map((d) => [M.timeOn(hotel, d), M.slotOf(hotel, d), M.stayPart(hotel, d)]),
    [["15:00", "afternoon", "in"], [null, "any", "night"], ["11:00", "morning", "out"]]);
  assert.strictEqual(M.stayPart(P({ day: "2026-11-17", endDay: "2026-11-19" }), "2026-11-17"), null);
  const festival = P({ category: "other", day: "2026-11-17", endDay: "2026-11-19", time: "10:00" });
  assert.strictEqual(M.timeOn(festival, "2026-11-18"), "10:00");
  const sight = P({ id: "sight", day: "2026-11-19", time: "12:00" });
  assert.deepStrictEqual(M.dayPlan([sight, hotel], "2026-11-19").map((p) => p.id), ["hotel", "sight"]);
  const g = M.board(trip, [hotel], "time");
  assert.deepStrictEqual(g.slice(0, 3).map((d) => d.slots.map((s) => s.id)), [["afternoon"], ["any"], ["morning"]]);
});

test("a day's order: sorts places without a time and ties at a time; times still come first; kept only with a day", () => {
  const list = [
    P({ id: "lunch", day: "2026-11-18", importance: "maybe", order: 2 }),
    P({ id: "hike", day: "2026-11-18", order: 1 }),
    P({ id: "hotel", day: "2026-11-18", importance: "must" }),
    P({ id: "b", day: "2026-11-18", time: "09:00", order: 2 }),
    P({ id: "a", day: "2026-11-18", time: "09:00", order: 1, importance: "maybe" }),
  ];
  assert.deepStrictEqual(M.dayPlan(list, "2026-11-18").map((p) => p.id), ["a", "b", "hike", "lunch", "hotel"]);
  const g = M.board({ start: "2026-11-18", end: "2026-11-18" }, list, "time")[0];
  assert.deepStrictEqual(g.slots.find((s) => s.id === "any").places.map((p) => p.id), ["hike", "lunch", "hotel"]);
  assert.strictEqual(P({ order: 3 }).order, undefined);
  assert.strictEqual(P({ day: "2026-11-18", order: 0 }).order, undefined);
  assert.strictEqual(P({ day: "2026-11-18", order: "2" }).order, 2);
});

test("a leg between two places: a walk up to 2 km, a drive past it, none without a location", () => {
  const a = { lat: 38.7139, lng: -9.1334 };
  const walk = M.leg(a, { lat: 38.7139, lng: -9.1207 });
  assert.strictEqual(walk.mode, "walk");
  assert.ok(walk.km > 1 && walk.km < 1.2, walk.km);
  assert.strictEqual(walk.min, 15);
  const drive = M.leg(a, { lat: 38.7139, lng: -9.0964 });
  assert.strictEqual(drive.mode, "drive");
  assert.strictEqual(drive.min, 10);
  assert.strictEqual(M.leg(a, a).min, 5);
  assert.strictEqual(M.leg(a, { lat: null, lng: null }), null);
  assert.strictEqual(M.leg(null, a), null);
});

test("an expense is cleaned: amount, currency, category, and its trip must exist", () => {
  const d = M.sanitizeDoc({ trips: [{ id: "t", name: "K" }], expenses: [
    { id: "a", trip: "t", amount: "12.345", currency: "eur", category: "food" },
    { id: "b", trip: "t", amount: -5, currency: "euro", category: "spaceship", day: "2026-02-30" },
    { id: "c", trip: "gone", amount: 1 },
  ] });
  assert.deepStrictEqual(d.expenses.map((x) => [x.id, x.amount, x.currency, x.category, x.title, x.day]), [
    ["a", 12.35, "EUR", "food", "Food & drink", undefined],
    ["b", 0, "USD", "other", "Other", undefined],
  ]);
});

test("expense totals are per currency, and by category in order", () => {
  const list = [
    { amount: 10, currency: "EUR", category: "food" }, { amount: 0.1, currency: "EUR", category: "food" },
    { amount: 0.2, currency: "EUR", category: "stay" }, { amount: 3000, currency: "JPY", category: "food" },
  ];
  assert.deepStrictEqual(M.expenseTotals(list), [{ currency: "JPY", total: 3000 }, { currency: "EUR", total: 10.3 }]);
  assert.deepStrictEqual(M.expensesByCategory(list).map((g) => g.id), ["stay", "food"]);
});

test("expenses by day: dated days in order, then the undated", () => {
  const list = [{ id: "n", createdAt: "1" }, { id: "b", day: "2026-12-02", createdAt: "1" }, { id: "a", day: "2026-12-01", createdAt: "1" }];
  assert.deepStrictEqual(M.expenseDays(list).map((g) => g.day), ["2026-12-01", "2026-12-02", null]);
});

test("stamp covers expenses: changed ones get updatedAt, removed ones a tombstone", () => {
  const prev = M.sanitizeDoc({ trips: [{ id: "t", name: "K", updatedAt: "2026-01-01" }], expenses: [
    { id: "a", trip: "t", amount: 1, currency: "EUR", updatedAt: "2026-01-01" }, { id: "b", trip: "t", amount: 2, currency: "EUR", updatedAt: "2026-01-01" }] });
  const next = JSON.parse(JSON.stringify(prev));
  next.expenses[0].amount = 5;
  next.expenses = next.expenses.slice(0, 1);
  M.stamp(prev, next, "2026-11-15T00:00:00.000Z");
  assert.strictEqual(next.expenses[0].updatedAt, "2026-11-15T00:00:00.000Z");
  assert.deepStrictEqual(next.deleted.b, { at: "2026-11-15T00:00:00.000Z", trip: "t" });
});

test("a file record is cleaned, and goes with its trip", () => {
  const d = M.sanitizeDoc({ trips: [{ id: "t", name: "K" }], files: [
    { id: "f", trip: "t", name: " ticket.pdf ", type: "application/pdf", size: "2048.4" },
    { id: "g", trip: "t", type: "<script>", size: -1 },
    { id: "h", trip: "gone", name: "x" },
  ] });
  assert.deepStrictEqual(d.files.map((f) => [f.id, f.name, f.type, f.size]), [
    ["f", "ticket.pdf", "application/pdf", 2048], ["g", "Untitled file", "application/octet-stream", 0]]);
  const next = JSON.parse(JSON.stringify(d));
  next.files = [];
  M.stamp(d, next, "2026-11-15T00:00:00.000Z");
  assert.ok(next.deleted.f && next.deleted.g);
});

test("members: cleaned, one owner who is always a member, and what each role may do", () => {
  const t = M.sanitizeTrip({ id: "t", name: "K", owner: "ana", members: [
    { id: "ana", name: "Ana", role: "editor" }, { id: "ben", name: " Ben ", role: "owner" }, { id: "ben", role: "viewer" },
    { id: "cy", role: "boss" }, { id: "bad id!", role: "editor" }] });
  assert.deepStrictEqual(t.members, [{ id: "ana", name: "Ana", role: "owner" }, { id: "ben", name: "Ben", role: "editor" }, { id: "cy", name: "" }]);
  assert.ok(M.can(t, "ana", "manage") && M.can(t, "ben", "edit") && !M.can(t, "ben", "manage"));
  // no role of their own: what everyone gets (edit, by default)
  assert.ok(M.can(t, "cy", "read") && M.can(t, "cy", "edit") && M.can(t, "zed", "edit") && !M.can(t, "zed", "manage"));
  assert.ok(M.can(M.sanitizeTrip({ name: "Mine" }), "anyone", "manage"));
  assert.strictEqual(M.sanitizeTrip({ name: "Plain" }).members, undefined);
  const own = M.ownTrip({ name: "New" }, { id: "ana", name: "Ana" });
  assert.deepStrictEqual([own.owner, own.members], ["ana", [{ id: "ana", name: "Ana", role: "owner" }]]);
});

test("share: everyone's default, each person's own, and the owner sees all", () => {
  const t = M.sanitizeTrip({ id: "t", name: "K", owner: "ana", share: { role: "viewer", hide: ["files", "nope"] }, members: [
    { id: "ana", hide: ["expenses"] }, { id: "ben", role: "editor" }, { id: "cy", hide: [] }, { id: "dee", role: "viewer", hide: ["expenses"] }] });
  assert.deepStrictEqual(t.share, { role: "viewer", hide: ["files"] });
  assert.strictEqual(t.members[0].hide, undefined);
  assert.ok(M.can(t, "ana", "files") && M.can(t, "ana", "expenses") && M.can(t, "ana", "manage"));
  assert.ok(M.can(t, "ben", "edit") && !M.can(t, "ben", "files") && M.can(t, "ben", "expenses"));
  assert.ok(!M.can(t, "cy", "edit") && M.can(t, "cy", "files"));
  assert.ok(!M.can(t, "dee", "edit") && !M.can(t, "dee", "expenses") && M.can(t, "dee", "files"));
  assert.ok(!M.can(t, "stranger", "edit") && !M.can(t, "stranger", "files"));
  assert.deepStrictEqual(M.access(t, "ben").own, { role: true, hide: false });
  // the default default is no share field at all
  assert.strictEqual(M.sanitizeTrip({ name: "K", share: { role: "editor", hide: [] } }).share, undefined);
});

test("join adds you to a shared trip once and keeps your name; renamePerson moves an old id over", () => {
  const t = M.sanitizeTrip({ id: "t", name: "K", owner: "ana", members: [{ id: "ana", name: "Ana" }] });
  assert.strictEqual(M.join(t, { id: "ben", name: "Ben" }), true);
  assert.strictEqual(M.join(t, { id: "ben", name: "Ben" }), false);
  assert.strictEqual(M.join(t, { id: "ben", name: "Benny" }), true);
  assert.deepStrictEqual(t.members[1], { id: "ben", name: "Benny" });
  assert.strictEqual(M.join(M.sanitizeTrip({ name: "Plain" }), { id: "ben" }), false);
  const doc = M.sanitizeDoc({ trips: [t, { id: "u", name: "U", owner: "old1", members: [{ id: "old1", role: "owner" }], updatedAt: "2026-01-01" }],
    expenses: [{ id: "x", trip: "u", amount: 1, currency: "EUR", paidBy: "old1", updatedAt: "2026-01-01" }] });
  M.renamePerson(doc, "old1", "ana");
  assert.deepStrictEqual([doc.trips[1].owner, doc.trips[1].members[0].id, doc.expenses[0].paidBy], ["ana", "ana", "ana"]);
  assert.ok(doc.trips[1].updatedAt > "2026-01-01");
  assert.ok(doc.expenses[0].updatedAt > "2026-01-01");
});

test("stamp marks who changed a record and who deleted one", () => {
  const prev = M.sanitizeDoc({ trips: [{ id: "t", name: "K", updatedAt: "2026-01-01" }],
    places: [{ id: "a", trip: "t", name: "A", updatedAt: "2026-01-01" }, { id: "b", trip: "t", name: "B", updatedAt: "2026-01-01" }] });
  const next = JSON.parse(JSON.stringify(prev));
  next.places[0].note = "x";
  next.places = next.places.slice(0, 1);
  M.stamp(prev, next, "2026-11-15T00:00:00.000Z", "ana");
  assert.strictEqual(next.places[0].by, "ana");
  assert.strictEqual(next.trips[0].by, undefined);
  assert.strictEqual(M.sanitizeDoc(next).deleted.b.by, "ana");
  // a change of `by` alone isn't a change
  const again = JSON.parse(JSON.stringify(next));
  M.stamp(next, again, "2026-11-16T00:00:00.000Z", "ben");
  assert.strictEqual(again.places[0].by, "ana");
});

test("a place over several days: endDay only after its day, on each of its days, moved as a whole", () => {
  assert.strictEqual(P({ day: "2026-11-17", endDay: "2026-11-16" }).endDay, undefined);
  assert.strictEqual(P({ endDay: "2026-11-19" }).endDay, undefined);
  const hotel = P({ id: "h", name: "Hotel", day: "2026-11-18", endDay: "2026-11-20", lat: 1, lng: 2 });
  assert.deepStrictEqual(M.placeDays(hotel), ["2026-11-18", "2026-11-19", "2026-11-20"]);
  const g = M.board(trip, [hotel, P({ id: "x", day: "2026-11-19" })], "time");
  assert.deepStrictEqual(g.map((d) => [d.id, d.places.map((p) => p.id)]),
    [["2026-11-17", []], ["2026-11-18", ["h"]], ["2026-11-19", ["h", "x"]], ["2026-11-20", ["h"]], ["nodate", []]]);
  assert.deepStrictEqual(M.dayRoute([hotel], "2026-11-19").map((p) => p.id), ["h"]);
  assert.deepStrictEqual([M.daySpan(hotel), M.addDays("2026-11-30", 2)], [2, "2026-12-02"]);
});

test("your categories: defaults until changed, Other always there, unknown ones keep their id and the trip's name", () => {
  assert.deepStrictEqual(M.catList(null), M.CATEGORIES);
  const mine = M.catList([{ id: "food", name: "Eating" }, { id: "cMarkets", name: "Markets" }, { id: "sight" }, { id: "bad id!" }]);
  assert.deepStrictEqual(mine.map((c) => c[0]), ["food", "cMarkets", "sight", "other"]);
  assert.deepStrictEqual(mine[2], ["sight", "Sights"]);
  assert.strictEqual(P({ category: "cMarkets" }).category, "cMarkets");
  assert.strictEqual(P({ category: "no way!" }).category, "other");
  const doc = M.sanitizeDoc({ trips: [{ id: "t", name: "K" }], places: [P({ id: "a", category: "cMarkets" }), P({ id: "b", category: "sight" }), P({ id: "c", category: "food" })] });
  const carried = M.carryCats(doc, mine);
  assert.deepStrictEqual(carried.trips[0].cats, { cMarkets: "Markets", food: "Eating" });
  assert.strictEqual(M.carryCats(carried, mine), carried);
  // Someone else's category on a shared trip goes by the name the trip carries.
  assert.strictEqual(M.catName(M.CATEGORIES, carried.trips[0], "cMarkets"), "Markets");
});

test("a swipe: sideways, far and quick enough; the other way in right to left", () => {
  assert.strictEqual(M.swipeStep(-80, 10, 200, false), 1);
  assert.strictEqual(M.swipeStep(80, 10, 200, false), -1);
  assert.strictEqual(M.swipeStep(-80, 10, 200, true), -1);
  assert.strictEqual(M.swipeStep(80, 10, 200, true), 1);
  assert.strictEqual(M.swipeStep(-40, 0, 200, false), 0, "too short");
  assert.strictEqual(M.swipeStep(-80, 50, 200, false), 0, "too steep: a scroll");
  assert.strictEqual(M.swipeStep(-80, 0, 900, false), 0, "too slow: a long press or a selection");
});

test("a link keeps http(s) only and is named after its site; a note keeps its lines; neither has bytes", () => {
  const l = M.sanitizeFile({ trip: "t", kind: "link", url: "www.jreast.co.jp/en/" });
  assert.deepStrictEqual([l.url, l.name, l.size, l.type, M.hasBytes(l)], ["https://www.jreast.co.jp/en/", "jreast.co.jp", 0, "text/uri-list", false]);
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", ""]) assert.strictEqual(M.linkUrl(bad), "", bad);
  assert.strictEqual(M.sanitizeFile({ kind: "link", url: "javascript:alert(1)" }).url, "");
  const n = M.sanitizeFile({ trip: "t", kind: "note", name: "Phrasebook", text: "Sumimasen\r\nArigatou\n\n" });
  assert.deepStrictEqual([n.text, n.name, M.hasBytes(n)], ["Sumimasen\nArigatou", "Phrasebook", false]);
  assert.strictEqual(M.sanitizeFile({ kind: "note", text: "x".repeat(M.MAX_NOTE + 10) }).text.length, M.MAX_NOTE);
  const f = M.sanitizeFile({ trip: "t", name: "a.pdf", type: "application/pdf", url: "https://x", text: "y" });
  assert.deepStrictEqual([f.kind, f.url, f.text, M.hasBytes(f)], [undefined, undefined, undefined, true]);
});

// Destinations with dates: Osaka, then Kyoto, with Nara a day trip and a
// stay in Uji (inside Kyoto's dates) that wins its night.
const J = M.sanitizeTrip({ id: "j", name: "Japan", start: "2026-02-01", end: "2026-02-08", destinations: ["Osaka", "Kyoto", "Uji", "Nara"],
  destInfo: { Osaka: { start: "2026-02-01", end: "2026-02-04", lat: 34.69, lng: 135.50 }, Kyoto: { start: "2026-02-04", end: "2026-02-08", lat: 35.01, lng: 135.77 },
    Uji: { start: "2026-02-06", end: "2026-02-06", lat: 34.88, lng: 135.80 }, Nara: { lat: 34.68, lng: 135.80 }, Gone: { start: "2026-02-01" } } });
const JP = (o) => M.sanitizePlace({ trip: "j", ...o });

test("destinations: dates and a location beside the list of names; only listed names, end after start", () => {
  assert.deepStrictEqual(J.destinations, ["Osaka", "Kyoto", "Uji", "Nara"]);
  assert.deepStrictEqual(Object.keys(J.destInfo), ["Osaka", "Kyoto", "Uji", "Nara"]);
  const t = M.sanitizeTrip({ destinations: ["A", "B"], destInfo: { A: { start: "2026-03-05", end: "2026-03-01" }, B: { start: "2026-03-02" }, C: { lat: 1, lng: 1 } } });
  assert.deepStrictEqual(t.destInfo, { A: { start: "2026-03-01", end: "2026-03-05" }, B: { start: "2026-03-02", end: "2026-03-02" } });
  assert.strictEqual(M.sanitizeTrip({ destinations: ["A"], destInfo: { A: { start: "nope" } } }).destInfo, undefined);
  assert.strictEqual(JP({ name: "x", dest: " Kyoto " }).dest, "Kyoto");
});

test("a place goes with the destination picked for it, or the nearest within reach", () => {
  assert.strictEqual(M.destOf(J, JP({ name: "Dotonbori", lat: 34.668, lng: 135.501 })), "Osaka");
  assert.strictEqual(M.destOf(J, JP({ name: "Todai-ji", lat: 34.689, lng: 135.84 })), "Nara");
  assert.strictEqual(M.destOf(J, JP({ name: "Nagoya Castle", lat: 35.185, lng: 136.899 })), null);
  assert.strictEqual(M.destOf(J, JP({ name: "Unlocated" })), null);
  assert.strictEqual(M.destOf(J, JP({ name: "Picked", dest: "Kyoto", lat: 34.668, lng: 135.501 })), "Kyoto");
  assert.strictEqual(M.destOf(J, JP({ name: "Stale pick", dest: "Tokyo", lat: 34.668, lng: 135.501 })), "Osaka");
  const p = JP({ name: "Dotonbori", lat: 34.668, lng: 135.501 });
  M.setDest(J, p, "Osaka");
  assert.strictEqual(p.dest, undefined, "the nearest already: nothing to keep");
  M.setDest(J, p, "Kyoto");
  assert.strictEqual(p.dest, "Kyoto");
  M.setDest(J, p, null);
  assert.strictEqual(p.dest, undefined);
});

test("a day goes with the dated destination covering it that starts last", () => {
  assert.deepStrictEqual(["2026-02-01", "2026-02-04", "2026-02-05", "2026-02-06", "2026-02-07", "2026-01-31"].map((d) => M.dayDest(J, d)),
    ["Osaka", "Kyoto", "Kyoto", "Uji", "Kyoto", null]);
});

test("a stay's night on a day spent in another destination is booked elsewhere", () => {
  const hotel = JP({ name: "Kyoto hotel", category: "stay", dest: "Kyoto", day: "2026-02-04", endDay: "2026-02-08" });
  assert.deepStrictEqual(["2026-02-04", "2026-02-05", "2026-02-06", "2026-02-08"].map((d) => M.awayStay(J, hotel, d)), [false, false, true, false]);
  assert.strictEqual(M.awayStay(J, JP({ name: "Somewhere", category: "stay", day: "2026-02-04", endDay: "2026-02-08" }), "2026-02-06"), false, "no destination: not away");
  assert.strictEqual(M.awayStay(J, JP({ name: "Tour", dest: "Kyoto", day: "2026-02-04", endDay: "2026-02-08" }), "2026-02-06"), false, "only stays");
});

test("the plan by time: a heading per run of a destination's days, its places with no day, and No date by destination", () => {
  const places = [
    JP({ name: "Dotonbori", lat: 34.668, lng: 135.501, importance: "maybe" }), JP({ name: "Osaka Castle", lat: 34.687, lng: 135.526, importance: "must" }),
    JP({ name: "Gion", lat: 35.003, lng: 135.775 }), JP({ name: "Todai-ji", lat: 34.689, lng: 135.84 }), JP({ name: "Nowhere" }),
    JP({ name: "Ryokan", category: "stay", day: "2026-02-04", endDay: "2026-02-08", lat: 35.0, lng: 135.76 }),
  ];
  const g = M.board(J, places, "time");
  const heads = g.filter((x) => x.kind).map((x) => x.kind + ":" + x.dest + (x.again ? " again" : "") + (x.kind === "any" ? " " + x.places.map((p) => p.name).join("+") : ""));
  assert.deepStrictEqual(heads, ["dest:Osaka", "any:Osaka Osaka Castle+Dotonbori", "dest:Kyoto", "any:Kyoto Gion", "dest:Uji", "any:Uji ", "dest:Kyoto again"]);
  assert.strictEqual(g.find((x) => x.day === "2026-02-06").dest, "Uji");
  const nd = g[g.length - 1];
  assert.deepStrictEqual(nd.parts.map((x) => [x.dest, x.places.map((p) => p.name)]), [["Nara", ["Todai-ji"]], [null, ["Nowhere"]]]);
  // Without dates the plan is as it always was.
  const plain = M.board({ ...J, destInfo: { Osaka: { lat: 34.69, lng: 135.5 } } }, places, "time");
  assert.ok(!plain.some((x) => x.kind) && !plain[plain.length - 1].parts);
  assert.strictEqual(plain[plain.length - 1].places.length, 5);
});

test("dates from stays: each destination from its first stay's day to the last one's end", () => {
  const t = M.sanitizeTrip({ ...J, destInfo: { Osaka: { lat: 34.69, lng: 135.5 }, Kyoto: { lat: 35.01, lng: 135.77 } } });
  const got = M.datesFromStays(t, [
    JP({ name: "Hotel A", category: "stay", day: "2026-02-01", endDay: "2026-02-03", lat: 34.67, lng: 135.5 }),
    JP({ name: "Hotel B", category: "stay", day: "2026-02-03", endDay: "2026-02-04", lat: 34.70, lng: 135.49 }),
    JP({ name: "Ryokan", category: "stay", day: "2026-02-04", endDay: "2026-02-08", lat: 35.0, lng: 135.76 }),
    JP({ name: "Gion", day: "2026-02-05", lat: 35.003, lng: 135.775 }), JP({ name: "Undated stay", category: "stay", lat: 35.0, lng: 135.76 }),
  ]);
  assert.deepStrictEqual(got, { Osaka: { start: "2026-02-01", end: "2026-02-04" }, Kyoto: { start: "2026-02-04", end: "2026-02-08" } });
});

test("a journey: its fields cleaned, its arrival, a change between legs, left out of importance", () => {
  const j1 = M.sanitizePlace({ id: "j1", trip: "t", kind: "journey", mode: "rocket", name: "Tel Aviv (TLV)", day: "2023-02-05", time: "06:10",
    endDay: "2023-02-06", toName: " Zurich (ZRH) ", toLat: 47.4582, toLng: 8.5555, arriveTime: "09:40", number: "LX 253" });
  assert.deepStrictEqual([j1.kind, j1.mode, j1.toName, j1.arriveTime, j1.endDay, j1.arriveDay, j1.number], ["journey", "other", "Zurich (ZRH)", "09:40", undefined, undefined, "LX 253"]);
  const j2 = M.sanitizePlace({ id: "j2", trip: "t", kind: "journey", mode: "flight", name: "zurich (zrh)", day: "2023-02-05", time: "13:00",
    toName: "Tokyo Narita (NRT)", toLat: 35.772, toLng: 140.3929, arriveDay: "2023-02-06", arriveTime: "08:55" });
  assert.strictEqual(j2.arriveDay, "2023-02-06");
  assert.strictEqual(M.sanitizePlace({ ...j2, arriveDay: "2023-02-04" }).arriveDay, undefined, "lands before it leaves");
  assert.strictEqual(M.sanitizePlace({ name: "x", toName: "y", number: "1" }).toName, undefined, "only a journey keeps them");
  assert.deepStrictEqual(M.connection(j1, j2), { at: "Zurich (ZRH)", min: 200 });
  const j3 = M.sanitizePlace({ id: "j3", trip: "t", kind: "journey", mode: "train", name: "Narita Airport station", lat: 35.764, lng: 140.386, day: "2023-02-06", time: "09:45", toName: "Tokyo", arriveTime: "10:48" });
  assert.deepStrictEqual(M.connection(j2, j3), { at: "Tokyo Narita (NRT)", min: 50 }, "close enough by location, the next day");
  assert.strictEqual(M.connection(j3, j1), null);
  assert.strictEqual(M.nextLeg([j1, j2, j3], j1), j2);
  assert.deepStrictEqual(M.arrivals([j1, j2, j3], "2023-02-06").map((p) => p.id), ["j2"]);
  const hotel = M.sanitizePlace({ id: "h", trip: "t", name: "IAM HOTEL", importance: "must", lat: 35.68, lng: 139.77, day: "2023-02-06" });
  assert.ok(M.leg(j3, hotel) === null, "j3 has no arrival location");
  assert.ok(M.leg(j2, hotel).km > 50, "measured from where j2 lands");
  const trip = { id: "t", start: "2023-02-05", end: "2023-02-06" };
  assert.deepStrictEqual(M.board(trip, [j1, hotel], "time", { only: ["must"] })[0].places.map((p) => p.id), ["j1"], "the importance filter keeps journeys");
  assert.deepStrictEqual(M.dayRoute([j3, hotel], "2023-02-06").map((p) => p.id), ["h"]);
});

test("duplicating a trip: yours alone, dates moved, what's kept is chosen", () => {
  const me = { id: "p_me", name: "Daniel" };
  const src = M.sanitizeTrip({ id: "src", name: "Lisbon", start: "2026-12-10", end: "2026-12-15", destinations: ["Lisbon", "Sintra"], owner: "p_x",
    members: [{ id: "p_x", name: "X", role: "owner" }], share: { role: "viewer" }, art: "city", cover: true, cats: { food: "Eats" },
    destInfo: { Sintra: { start: "2026-12-12", end: "2026-12-12", lat: 38.8, lng: -9.39 } } });
  const doc = { trips: [src], places: [
    M.sanitizePlace({ id: "a", trip: "src", name: "Belém Tower", category: "sight", importance: "must", lat: 38.69, lng: -9.21, day: "2026-12-11", time: "10:00", rating: 5, visited: true, note: "Early", dest: "Lisbon", by: "p_x" }),
    M.sanitizePlace({ id: "j", trip: "src", kind: "journey", mode: "train", name: "Rossio", lat: 38.71, lng: -9.14, day: "2026-12-12", toName: "Sintra", toLat: 38.8, toLng: -9.38, arriveTime: "10:40" }),
    M.sanitizePlace({ id: "other", trip: "elsewhere", name: "Not this trip" }),
  ], files: [
    M.sanitizeFile({ id: "f1", trip: "src", kind: "link", url: "https://example.com", place: "a" }),
    M.sanitizeFile({ id: "f2", trip: "src", name: "ticket.pdf", type: "application/pdf", size: 10 }),
  ], expenses: [M.sanitizeExpense({ id: "x", trip: "src", amount: 5 })] };
  const all = M.duplicateTrip(doc, src, { name: "Lisbon again", start: "2027-04-02" }, me);
  assert.strictEqual(all.trip.name, "Lisbon again");
  assert.notStrictEqual(all.trip.id, "src");
  assert.deepStrictEqual([all.trip.start, all.trip.end], ["2027-04-02", "2027-04-07"]);
  assert.deepStrictEqual(all.trip.destInfo.Sintra, { start: "2027-04-04", end: "2027-04-04", lat: 38.8, lng: -9.39 });
  assert.deepStrictEqual([all.trip.owner, all.trip.members.map((m) => m.id), all.trip.share], ["p_me", ["p_me"], undefined], "yours alone");
  assert.deepStrictEqual([all.trip.art, all.trip.cover, all.trip.cats], ["city", true, { food: "Eats" }]);
  assert.strictEqual(all.places.length, 2);
  const a = all.places.find((p) => p.name === "Belém Tower");
  assert.deepStrictEqual([a.trip, a.day, a.time, a.lat, a.note, a.dest, a.importance], [all.trip.id, "2027-04-03", "10:00", 38.69, "Early", "Lisbon", "must"]);
  assert.deepStrictEqual([a.rating, a.visited, a.by], [undefined, undefined, undefined], "ratings and been there aren't copied");
  const j = all.places.find((p) => p.kind === "journey");
  assert.deepStrictEqual([j.day, j.toLat, j.arriveTime], ["2027-04-04", 38.8, "10:40"]);
  assert.strictEqual(all.files.length, 2);
  assert.strictEqual(all.files.find((f) => f.kind === "link").place, a.id, "an attachment follows its place's copy");
  assert.deepStrictEqual(all.fileIds.map(([from]) => from), ["f2"], "only a file with bytes needs them copied");
  assert.ok(all.files.every((f) => f.trip === all.trip.id));

  const bare = M.duplicateTrip(doc, src, { locations: false, dates: false, attachments: false }, me);
  assert.strictEqual(bare.trip.name, "Lisbon");
  assert.deepStrictEqual([bare.trip.start, bare.trip.end], [undefined, undefined]);
  assert.deepStrictEqual(bare.trip.destInfo, { Sintra: { lat: 38.8, lng: -9.39 } }, "destinations keep where they are, not their dates");
  const b = bare.places.find((p) => p.name === "Belém Tower");
  assert.deepStrictEqual([b.lat, b.day, b.time, b.importance], [undefined, undefined, undefined, "must"]);
  assert.strictEqual(bare.places.find((p) => p.kind === "journey").toLat, undefined);
  assert.deepStrictEqual([bare.files, bare.fileIds], [[], []]);

  const same = M.duplicateTrip(doc, src, {}, me);
  assert.deepStrictEqual([same.trip.start, same.places.find((p) => p.name === "Belém Tower").day], ["2026-12-10", "2026-12-11"], "no new start: the same days");
});

test("To check: kept only as true, and a filter of its own", () => {
  const a = M.sanitizePlace({ id: "a", trip: "t", name: "A", check: true }), b = M.sanitizePlace({ id: "b", trip: "t", name: "B", check: "yes" });
  assert.deepStrictEqual([a.check, b.check], [true, undefined]);
  assert.deepStrictEqual(M.filterPlaces([a, b], { check: true }).map((p) => p.id), ["a"]);
  assert.strictEqual(M.filterPlaces([a, b], {}).length, 2);
});

console.log(passed + " passed");
