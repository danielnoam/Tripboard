// How a trip travels and how two copies of it come together, for sync (and
// later for sharing a trip). No DOM and no network, so Node tests it
// (test/merge.test.js).
//
// A trip travels as a bundle, one file per trip:
//   { format, trip, places, expenses, files, deleted }
// (a file here is its record; its bytes travel as files/<trip>/<id>). A
// file marked local stays out of the bundle, and applyBundle keeps it.
// `deleted` is the trip's tombstones ({ id: { at, trip } }). A deleted trip
// travels as { format, trip: { id, deletedAt } } so other devices drop it.
//
// Two copies merge three ways, against `base`, the copy both last agreed
// on: a field one side changed and the other didn't takes the change; a
// field both changed takes the newer record's value. A record one side
// added stays. A record deleted on one side goes, unless the other side
// changed it after the deletion.
(function () {
  const FORMAT = 1;

  function bundleOf(doc, tripId) {
    const trip = doc.trips.find((t) => t.id === tripId);
    if (!trip) {
      const gone = doc.deleted && doc.deleted[tripId];
      return gone ? { format: FORMAT, trip: { id: tripId, deletedAt: gone.at } } : null;
    }
    const deleted = {};
    for (const [id, t] of Object.entries(doc.deleted || {})) if (t.trip === tripId && id !== tripId) deleted[id] = t;
    return { format: FORMAT, trip, places: doc.places.filter((p) => p.trip === tripId), expenses: (doc.expenses || []).filter((x) => x.trip === tripId),
      files: (doc.files || []).filter((x) => x.trip === tripId && !x.local), deleted };
  }

  // The doc with one trip's records swapped for the bundle's.
  function applyBundle(doc, b) {
    const id = b.trip.id;
    const out = {
      ...doc,
      trips: doc.trips.filter((t) => t.id !== id),
      places: doc.places.filter((p) => p.trip !== id),
      expenses: (doc.expenses || []).filter((x) => x.trip !== id),
      files: (doc.files || []).filter((x) => x.trip !== id || x.local),
      deleted: Object.fromEntries(Object.entries(doc.deleted || {}).filter(([k, t]) => t.trip !== id || k === id)),
    };
    if (b.trip.deletedAt) { out.deleted[id] = { at: b.trip.deletedAt, trip: id }; return out; }
    delete out.deleted[id];
    out.trips.push(b.trip);
    out.places = out.places.concat(b.places || []);
    out.expenses = out.expenses.concat(b.expenses || []);
    const mineOnly = new Set(out.files.filter((x) => x.local).map((x) => x.id));
    out.files = out.files.concat((b.files || []).filter((x) => !mineOnly.has(x.id)));
    Object.assign(out.deleted, b.deleted || {});
    return out;
  }

  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const newer = (a, b) => String(a.updatedAt || "") >= String(b.updatedAt || "");

  // One record, three ways. Fields compared one by one, `updatedAt` the newest.
  function mergeRecord(base, mine, theirs) {
    if (!base) return newer(mine, theirs) ? mine : theirs;
    const out = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)]);
    for (const k of keys) {
      if (k === "updatedAt" || k === "by") continue;
      const m = mine[k], t = theirs[k], b = base[k];
      const v = eq(m, b) ? t : eq(t, b) ? m : newer(mine, theirs) ? m : t;
      if (v !== undefined) out[k] = v;
    }
    const last = newer(mine, theirs) ? mine : theirs;
    out.updatedAt = last.updatedAt;
    if (last.by) out.by = last.by;
    return out;
  }

  // One collection of records (by id), three ways, with both sides' tombstones.
  function mergeList(base, mine, theirs, gone) {
    const B = new Map((base || []).map((r) => [r.id, r]));
    const M = new Map((mine || []).map((r) => [r.id, r]));
    const T = new Map((theirs || []).map((r) => [r.id, r]));
    const out = [];
    for (const id of new Set([...M.keys(), ...T.keys()])) {
      const m = M.get(id), t = T.get(id), b = B.get(id);
      const dead = gone[id];
      let r;
      if (m && t) r = mergeRecord(b, m, t);
      else {
        const only = m || t;
        // Missing on the other side: deleted there if both had it before,
        // kept if it changed after that.
        if (b && eq(only, b)) continue;
        r = only;
      }
      if (dead && String(dead.at) >= String(r.updatedAt || "")) continue;
      out.push(r);
    }
    return out;
  }

  // Two bundles of the same trip, against the last one both agreed on.
  function mergeBundles(base, mine, theirs) {
    if (!mine) return theirs;
    if (!theirs) return mine;
    const tripGone = mine.trip.deletedAt || theirs.trip.deletedAt;
    if (tripGone) {
      const alive = mine.trip.deletedAt ? theirs : mine;
      const at = mine.trip.deletedAt && theirs.trip.deletedAt ? (mine.trip.deletedAt > theirs.trip.deletedAt ? mine.trip.deletedAt : theirs.trip.deletedAt) : tripGone;
      // A trip deleted on one side and changed on the other after it stays.
      if (alive.trip.deletedAt || String(at) >= String(alive.trip.updatedAt || "")) return { format: FORMAT, trip: { id: mine.trip.id, deletedAt: at } };
      return alive;
    }
    const b = base && !base.trip.deletedAt ? base : null;
    const gone = {};
    for (const src of [mine.deleted, theirs.deleted]) {
      for (const [id, t] of Object.entries(src || {})) if (!gone[id] || t.at > gone[id].at) gone[id] = t;
    }
    const places = mergeList(b && b.places, mine.places, theirs.places, gone);
    const expenses = mergeList(b && b.expenses, mine.expenses, theirs.expenses, gone);
    const files = mergeList(b && b.files, mine.files, theirs.files, gone);
    const kept = new Set(places.concat(expenses, files).map((p) => p.id));
    for (const id of Object.keys(gone)) if (kept.has(id)) delete gone[id];
    return { format: FORMAT, trip: mergeRecord(b && b.trip, mine.trip, theirs.trip), places, expenses, files, deleted: gone };
  }

  // The trips a doc has, alive or deleted (so a deletion is sent too).
  const tripIds = (doc) => [...new Set(doc.trips.map((t) => t.id).concat(
    Object.entries(doc.deleted || {}).filter(([id, t]) => t.trip === id).map(([id]) => id)))];

  // What a sync brought to this device: the trips that came, changed or
  // went between two docs. Order, key order and a trip's coverAt (stamped
  // on a first sync) don't count as a change; tombstones show in what they removed.
  const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
    : v && typeof v === "object" ? "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}"
    : JSON.stringify(v);
  const byId = (list) => (list || []).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sameTrip = (a, b) => canon([{ ...a.trip, coverAt: undefined }, byId(a.places), byId(a.expenses), byId(a.files)])
    === canon([{ ...b.trip, coverAt: undefined }, byId(b.places), byId(b.expenses), byId(b.files)]);
  function arrivals(before, after) {
    const was = new Map(before.trips.map((t) => [t.id, t]));
    const is = new Set(after.trips.map((t) => t.id));
    const out = { added: [], updated: [], removed: [] };
    for (const t of after.trips) {
      if (!was.has(t.id)) out.added.push(t);
      else if (!sameTrip(bundleOf(before, t.id), bundleOf(after, t.id))) out.updated.push(t);
    }
    for (const t of before.trips) if (!is.has(t.id)) out.removed.push(t);
    return out;
  }

  const api = { FORMAT, bundleOf, applyBundle, mergeRecord, mergeBundles, tripIds, arrivals };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { window.Tripboard = window.Tripboard || {}; window.Tripboard.merge = api; }
})();
