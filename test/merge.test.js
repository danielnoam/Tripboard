// src/merge.js and the model's stamp(): how two devices' copies of a trip
// come together (`node test/merge.test.js`).
const assert = require("assert");
const M = require("../src/model.js");
const G = require("../src/merge.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + e.message); }
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const at = (n) => "2026-11-15T10:00:0" + n + ".000Z";

const start = M.sanitizeDoc({
  trips: [{ id: "t", name: "Kyoto", createdAt: at(0), updatedAt: at(0) }],
  places: [
    { id: "a", trip: "t", name: "Fushimi", importance: "want", createdAt: at(0), updatedAt: at(0) },
    { id: "b", trip: "t", name: "Nishiki", createdAt: at(0), updatedAt: at(0) },
  ],
});

test("stamp: a changed record gets updatedAt, a removed one a tombstone", () => {
  const next = clone(start);
  next.places[0].note = "Early";
  next.places = next.places.filter((p) => p.id !== "b");
  M.stamp(start, next, at(5));
  assert.strictEqual(next.places[0].updatedAt, at(5));
  assert.strictEqual(next.trips[0].updatedAt, at(0));
  assert.deepStrictEqual(next.deleted.b, { at: at(5), trip: "t" });
});

test("a bundle round-trips through applyBundle", () => {
  const b = G.bundleOf(start, "t");
  const back = G.applyBundle({ trips: [], places: [], deleted: {} }, clone(b));
  assert.deepStrictEqual(back.trips, start.trips);
  assert.deepStrictEqual(back.places, start.places);
});

test("different fields changed on each device both survive", () => {
  const base = G.bundleOf(start, "t");
  const mine = clone(base), theirs = clone(base);
  Object.assign(mine.places[0], { note: "Go early", updatedAt: at(2) });
  Object.assign(theirs.places[0], { importance: "must", updatedAt: at(3) });
  const out = G.mergeBundles(base, mine, theirs);
  assert.strictEqual(out.places.find((p) => p.id === "a").note, "Go early");
  assert.strictEqual(out.places.find((p) => p.id === "a").importance, "must");
});

test("the same field changed on both: the newer change wins", () => {
  const base = G.bundleOf(start, "t");
  const mine = clone(base), theirs = clone(base);
  Object.assign(mine.trip, { name: "Kyoto A", updatedAt: at(4) });
  Object.assign(theirs.trip, { name: "Kyoto B", updatedAt: at(3) });
  assert.strictEqual(G.mergeBundles(base, mine, theirs).trip.name, "Kyoto A");
});

test("places added on each device both stay; a deleted one stays deleted", () => {
  const base = G.bundleOf(start, "t");
  const mine = clone(base), theirs = clone(base);
  mine.places.push({ id: "c", trip: "t", name: "Gion", updatedAt: at(2) });
  theirs.places.push({ id: "d", trip: "t", name: "Nara", updatedAt: at(2) });
  theirs.places = theirs.places.filter((p) => p.id !== "b");
  theirs.deleted.b = { at: at(3), trip: "t" };
  const out = G.mergeBundles(base, mine, theirs);
  assert.deepStrictEqual(out.places.map((p) => p.id).sort(), ["a", "c", "d"]);
  assert.ok(out.deleted.b);
});

test("a place changed after another device deleted it comes back", () => {
  const base = G.bundleOf(start, "t");
  const mine = clone(base), theirs = clone(base);
  theirs.places = theirs.places.filter((p) => p.id !== "b");
  theirs.deleted.b = { at: at(3), trip: "t" };
  Object.assign(mine.places[1], { note: "Lunch here", updatedAt: at(6) });
  const out = G.mergeBundles(base, mine, theirs);
  assert.ok(out.places.some((p) => p.id === "b"));
  assert.ok(!out.deleted.b);
});

test("a deleted trip stays deleted unless the other side changed it after", () => {
  const base = G.bundleOf(start, "t");
  const gone = { format: 1, trip: { id: "t", deletedAt: at(5) } };
  assert.ok(G.mergeBundles(base, clone(base), gone).trip.deletedAt);
  const later = clone(base);
  later.trip.updatedAt = at(7);
  assert.ok(!G.mergeBundles(base, later, gone).trip.deletedAt);
});

test("tripIds lists live trips and deleted ones", () => {
  const d = M.sanitizeDoc({ trips: [{ id: "t", name: "K" }], deleted: { u: { at: new Date().toISOString(), trip: "u" } } });
  assert.deepStrictEqual(G.tripIds(d).sort(), ["t", "u"]);
});

test("expenses travel in the bundle and merge like places", () => {
  const d = clone(start);
  d.expenses = [{ id: "x", trip: "t", title: "Ryokan", amount: 300, currency: "JPY", category: "stay", createdAt: at(0), updatedAt: at(0) }];
  const base = G.bundleOf(M.sanitizeDoc(d), "t");
  assert.strictEqual(base.expenses.length, 1);
  const mine = clone(base), theirs = clone(base);
  Object.assign(mine.expenses[0], { amount: 320, updatedAt: at(2) });
  theirs.expenses.push({ id: "y", trip: "t", title: "Train", amount: 14, currency: "EUR", category: "transport", updatedAt: at(3) });
  const out = G.mergeBundles(base, mine, theirs);
  assert.deepStrictEqual(out.expenses.map((x) => x.id + ":" + x.amount).sort(), ["x:320", "y:14"]);
  const back = G.applyBundle({ trips: [], places: [], expenses: [], deleted: {} }, out);
  assert.strictEqual(back.expenses.length, 2);
});

test("a bundle from before expenses merges with one that has them", () => {
  const base = G.bundleOf(start, "t");
  delete base.expenses;
  const mine = clone(base);
  mine.expenses = [{ id: "x", trip: "t", title: "Taxi", amount: 9, currency: "EUR", category: "transport", updatedAt: at(4) }];
  assert.strictEqual(G.mergeBundles(base, mine, clone(base)).expenses.length, 1);
});

test("file records travel in the bundle; one deleted on one side goes", () => {
  const d = clone(start);
  d.files = [{ id: "f", trip: "t", name: "ticket.pdf", type: "application/pdf", size: 10, createdAt: at(0), updatedAt: at(0) }];
  const base = G.bundleOf(M.sanitizeDoc(d), "t");
  const mine = clone(base), theirs = clone(base);
  theirs.files = [];
  theirs.deleted.f = { at: at(3), trip: "t" };
  mine.files.push({ id: "g", trip: "t", name: "hotel.pdf", type: "application/pdf", size: 5, updatedAt: at(2) });
  const out = G.mergeBundles(base, mine, theirs);
  assert.deepStrictEqual(out.files.map((f) => f.id), ["g"]);
  assert.ok(out.deleted.f);
});

test("who changed a record goes with the newer side", () => {
  const base = G.bundleOf(start, "t");
  const mine = clone(base), theirs = clone(base);
  Object.assign(mine.places[0], { note: "Go early", updatedAt: at(2), by: "ana" });
  Object.assign(theirs.places[0], { importance: "must", updatedAt: at(3), by: "ben" });
  const out = G.mergeBundles(base, mine, theirs).places.find((p) => p.id === "a");
  assert.deepStrictEqual([out.note, out.importance, out.by], ["Go early", "must", "ben"]);
});

test("a local file never goes in the bundle, and a merge keeps it on its device", () => {
  const d = clone(start);
  d.files = [{ id: "l", trip: "t", name: "passport.jpg", type: "image/jpeg", size: 9, local: true, updatedAt: at(1) },
    { id: "s", trip: "t", name: "ticket.pdf", type: "application/pdf", size: 9, updatedAt: at(1) }];
  const doc = M.sanitizeDoc(d);
  const b = G.bundleOf(doc, "t");
  assert.deepStrictEqual(b.files.map((f) => f.id), ["s"]);
  const theirs = clone(b);
  theirs.files[0].note = "Car 7";
  const out = G.applyBundle(doc, G.mergeBundles(b, b, theirs));
  assert.deepStrictEqual(out.files.map((f) => f.id + (f.local ? ":local" : "") + (f.note ? ":" + f.note : "")).sort(), ["l:local", "s:Car 7"]);
});

test("a synced file made local leaves other devices; a local file made synced reaches them", () => {
  const d = clone(start);
  d.files = [{ id: "s", trip: "t", name: "ticket.pdf", type: "application/pdf", size: 9, updatedAt: at(1) }];
  const base = G.bundleOf(M.sanitizeDoc(d), "t");
  const mine = clone(d);
  mine.files[0].local = true;
  const sent = G.bundleOf(M.sanitizeDoc(mine), "t");
  assert.deepStrictEqual(G.mergeBundles(base, clone(base), sent).files, []);
  const none = clone(base);
  none.files = [];
  const back = clone(base);
  assert.deepStrictEqual(G.mergeBundles(none, none, back).files.map((f) => f.id), ["s"]);
});

test("deleting a local file leaves no tombstone to travel", () => {
  const prev = M.sanitizeDoc({ trips: [{ id: "t", name: "K" }], files: [{ id: "l", trip: "t", name: "x", local: true }] });
  const next = clone(prev);
  next.files = [];
  M.stamp(prev, next);
  assert.strictEqual(next.deleted.l, undefined);
});

test("arrivals: a trip that came, one that changed, one that went, by name", () => {
  const before = M.sanitizeDoc({ trips: [{ id: "t", name: "Kyoto", updatedAt: at(0) }, { id: "r", name: "Rome", updatedAt: at(0) }, { id: "q", name: "Quiet", updatedAt: at(0) }],
    places: [{ id: "a", trip: "t", name: "Fushimi", updatedAt: at(0) }] });
  const after = clone(before);
  after.trips = after.trips.filter((t) => t.id !== "r").concat({ id: "j", name: "Japan 2023", updatedAt: at(1) });
  after.places[0].note = "Early";
  const got = G.arrivals(before, M.sanitizeDoc(after));
  assert.deepStrictEqual([got.added.map((t) => t.name), got.updated.map((t) => t.name), got.removed.map((t) => t.name)], [["Japan 2023"], ["Kyoto"], ["Rome"]]);
});

test("arrivals: a merge that only reorders records and keys, or stamps coverAt, brings nothing", () => {
  const before = M.sanitizeDoc({ trips: [{ id: "t", name: "Kyoto", cover: true, updatedAt: at(0) }],
    places: [{ id: "a", trip: "t", name: "A", updatedAt: at(0) }, { id: "b", trip: "t", name: "B", updatedAt: at(0) }] });
  const after = G.applyBundle(before, G.bundleOf(before, "t"));
  after.places.reverse();
  after.trips[0] = { coverAt: at(3), ...after.trips[0] };
  const p = after.places[0];
  after.places[0] = Object.fromEntries(Object.entries(p).reverse());
  assert.deepStrictEqual(G.arrivals(before, after), { added: [], updated: [], removed: [] });
});

test("arrivals: a sync that pulls another device's edit to a shared place counts it", () => {
  const base = G.bundleOf(start, "t");
  const theirs = clone(base);
  theirs.places = theirs.places.filter((p) => p.id !== "b");
  theirs.deleted = { b: { at: at(4), trip: "t" } };
  const next = G.applyBundle(start, G.mergeBundles(base, base, theirs));
  assert.deepStrictEqual(G.arrivals(start, next).updated.map((t) => t.id), ["t"]);
});

console.log(passed + " passed");
