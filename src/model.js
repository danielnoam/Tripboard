// Tripboard's data, and the pure parts of the board: cleaning, days, time
// slots, and how places sort and group. No DOM here, so Node tests it
// (test/model.test.js). Grown from LifeLog's Travel tab
// (from-lifelog/src/travel.js).
//
// A trip: id, name, optional start and end (YYYY-MM-DD), destinations (a
// list of names), cover (true when an image is stored for it).
// A place: id, trip, name, category, importance, and optionally day, time
// and endTime (HH:MM), note, lat and lng, address, placeId (Google's id,
// the only thing kept from Google), visited.
// An expense: id, trip, title, amount (a number, in `currency`, an ISO
// 4217 code), category, and optionally day, place (a place's id), note and
// paidBy (who paid, for when a trip is shared).
// A file: id, trip, name, type (its MIME type), size in bytes, and
// optionally place and note. Its bytes are kept apart (store.js), never in the doc.
(function () {
  const CATEGORIES = [
    ["sight", "Sights"], ["food", "Food & drink"], ["nature", "Nature"], ["museum", "Museums"],
    ["shopping", "Shopping"], ["nightlife", "Nightlife"], ["stay", "Stays"], ["transport", "Getting around"],
    ["other", "Other"],
  ];
  const CATEGORY = new Map(CATEGORIES);
  // Highest first. Importance is both a sort and a filter on the board.
  const IMPORTANCE = [["must", "Must see"], ["want", "Want to"], ["maybe", "Maybe"]];
  const IMPORTANCE_LABEL = new Map(IMPORTANCE);
  const RANK = { must: 0, want: 1, maybe: 2 };
  // A day's time slots. A place with a day and no time is "Any time".
  const SLOTS = [["morning", "Morning", "00:00"], ["afternoon", "Afternoon", "12:00"], ["evening", "Evening", "17:00"]];

  const EXPENSE_CATEGORIES = [
    ["stay", "Stays"], ["transport", "Getting around"], ["food", "Food & drink"], ["activity", "Tickets & activities"],
    ["shopping", "Shopping"], ["other", "Other"],
  ];
  const EXPENSE_CATEGORY = new Map(EXPENSE_CATEGORIES);
  // The currencies offered first; any other ISO code is kept as it comes.
  const CURRENCIES = ["USD", "EUR", "GBP", "ILS", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY", "HKD", "KRW", "SGD", "THB", "VND",
    "IDR", "MYR", "PHP", "INR", "AED", "TRY", "EGP", "MAD", "ZAR", "MXN", "BRL", "ARS", "CLP", "PEN", "COP",
    "SEK", "NOK", "DKK", "ISK", "PLN", "CZK", "HUF", "RON", "GEL"];
  const KNOWN_EXPENSE = new Set(["id", "trip", "title", "amount", "currency", "category", "day", "place", "note", "paidBy", "createdAt", "updatedAt"]);
  const KNOWN_FILE = new Set(["id", "trip", "name", "type", "size", "place", "note", "createdAt", "updatedAt"]);
  const MAX_FILE_MB = 25;
  const KNOWN_TRIP = new Set(["id", "name", "start", "end", "destinations", "cover", "createdAt", "updatedAt"]);
  const KNOWN_PLACE = new Set(["id", "trip", "name", "category", "importance", "day", "time", "endTime", "note",
    "lat", "lng", "address", "placeId", "geoAt", "visited", "createdAt", "updatedAt"]);
  // Fields this build doesn't know are carried through, so a newer build's
  // additions survive an older one saving.
  function keepUnknown(src, out, known) {
    for (const k of Object.keys(src || {})) if (!known.has(k)) out[k] = src[k];
    return out;
  }
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // Round-tripped, because Date.parse reads "2027-02-30" as 2 March.
  const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)
    && !isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
  const isTime = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const text = (v) => String(v == null ? "" : v).trim();
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : (typeof v === "string" && v.trim() && isFinite(+v) ? +v : null));
  const now = () => new Date().toISOString();

  function sanitizeTrip(t) {
    t = t || {};
    const out = { id: text(t.id) || newId(), name: text(t.name) || "Untitled trip", createdAt: t.createdAt || now(), updatedAt: t.updatedAt || t.createdAt || now() };
    if (isDay(t.start)) out.start = t.start;
    if (isDay(t.end)) out.end = t.end;
    // An end before the start is a typo, not a trip that runs backwards.
    if (out.start && out.end && out.end < out.start) [out.start, out.end] = [out.end, out.start];
    const dest = (Array.isArray(t.destinations) ? t.destinations : text(t.destinations).split(","))
      .map(text).filter(Boolean);
    out.destinations = [...new Set(dest)].slice(0, 20);
    if (t.cover) out.cover = true;
    return keepUnknown(t, out, KNOWN_TRIP);
  }

  function sanitizePlace(p) {
    p = p || {};
    const out = {
      id: text(p.id) || newId(), trip: text(p.trip), name: text(p.name) || "Untitled place",
      category: CATEGORY.has(p.category) ? p.category : "other",
      importance: RANK[p.importance] != null ? p.importance : "want",
      createdAt: p.createdAt || now(), updatedAt: p.updatedAt || p.createdAt || now(),
    };
    if (isDay(p.day)) out.day = p.day;
    // A time only means something on a day; an end time only after a start.
    if (out.day && isTime(p.time)) {
      out.time = p.time;
      if (isTime(p.endTime) && p.endTime > p.time) out.endTime = p.endTime;
    }
    const lat = num(p.lat), lng = num(p.lng);
    if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) { out.lat = lat; out.lng = lng; }
    for (const k of ["note", "address", "placeId"]) { const v = text(p[k]); if (v) out[k] = v; }
    // When a Google location was fetched: Google allows keeping it 30 days.
    if (out.lat != null && isDay(p.geoAt)) out.geoAt = p.geoAt;
    if (p.visited) out.visited = true;
    return keepUnknown(p, out, KNOWN_PLACE);
  }

  function sanitizeExpense(e) {
    e = e || {};
    const amount = num(e.amount);
    const category = EXPENSE_CATEGORY.has(e.category) ? e.category : "other";
    const out = {
      id: text(e.id) || newId(), trip: text(e.trip),
      title: text(e.title) || EXPENSE_CATEGORY.get(category),
      amount: amount != null && amount >= 0 ? Math.round(amount * 100) / 100 : 0,
      currency: /^[A-Z]{3}$/.test(text(e.currency).toUpperCase()) ? text(e.currency).toUpperCase() : "USD",
      category, createdAt: e.createdAt || now(), updatedAt: e.updatedAt || e.createdAt || now(),
    };
    if (isDay(e.day)) out.day = e.day;
    for (const k of ["place", "note", "paidBy"]) { const v = text(e[k]); if (v) out[k] = v; }
    return keepUnknown(e, out, KNOWN_EXPENSE);
  }

  function sanitizeFile(f) {
    f = f || {};
    const size = num(f.size);
    const out = {
      id: text(f.id) || newId(), trip: text(f.trip), name: text(f.name).slice(0, 200) || "Untitled file",
      type: /^[\w.+-]+\/[\w.+-]+$/.test(text(f.type)) ? text(f.type) : "application/octet-stream",
      size: size != null && size >= 0 ? Math.round(size) : 0,
      createdAt: f.createdAt || now(), updatedAt: f.updatedAt || f.createdAt || now(),
    };
    for (const k of ["place", "note"]) { const v = text(f[k]); if (v) out[k] = v; }
    return keepUnknown(f, out, KNOWN_FILE);
  }

  // The whole store. A place whose trip is gone is dropped: deleting a trip
  // takes its places with it. `deleted` remembers what was deleted, when,
  // and in which trip, so a sync doesn't bring it back from another device:
  // { id: { at, trip } }, kept 120 days.
  const TOMBSTONE_DAYS = 120;
  function sanitizeDoc(d) {
    const trips = ((d && d.trips) || []).filter((t) => t && typeof t === "object").map(sanitizeTrip);
    const ids = new Set(trips.map((t) => t.id));
    const places = ((d && d.places) || []).filter((p) => p && typeof p === "object").map(sanitizePlace).filter((p) => ids.has(p.trip));
    const expenses = ((d && d.expenses) || []).filter((x) => x && typeof x === "object").map(sanitizeExpense).filter((x) => ids.has(x.trip));
    const files = ((d && d.files) || []).filter((x) => x && typeof x === "object").map(sanitizeFile).filter((x) => ids.has(x.trip));
    const live = new Set(places.concat(expenses, files).map((r) => r.id));
    const deleted = {};
    const cutoff = new Date(Date.now() - TOMBSTONE_DAYS * DAY_MS).toISOString();
    for (const [id, t] of Object.entries((d && d.deleted) || {})) {
      if (t && typeof t.at === "string" && t.at > cutoff && !ids.has(id) && !live.has(id)) deleted[id] = { at: t.at, trip: text(t.trip) };
    }
    return keepUnknown(d, { trips, places, expenses, files, deleted }, new Set(["trips", "places", "expenses", "files", "deleted"]));
  }

  // What changed between two saves: a record that's new or different gets
  // `updatedAt` now, and one that's gone is remembered in `deleted`. Done in
  // one place so no edit can forget it, and a sync can trust both.
  function stamp(prev, next, at) {
    at = at || now();
    const before = new Map();
    for (const t of (prev && prev.trips) || []) before.set(t.id, { r: t, trip: t.id });
    for (const p of ((prev && prev.places) || []).concat((prev && prev.expenses) || [], (prev && prev.files) || [])) before.set(p.id, { r: p, trip: p.trip });
    const same = (a, b) => { const x = { ...a }, y = { ...b }; delete x.updatedAt; delete y.updatedAt; return JSON.stringify(x) === JSON.stringify(y); };
    const seen = new Set();
    for (const r of next.trips.concat(next.places, next.expenses || [], next.files || [])) {
      seen.add(r.id);
      const b = before.get(r.id);
      if (!b || !same(b.r, r)) r.updatedAt = at;
      delete next.deleted[r.id];
    }
    for (const [id, b] of before) if (!seen.has(id)) next.deleted[id] = { at, trip: b.trip };
    return next;
  }

  const DAY_MS = 86400000;
  const dayNum = (day) => Date.parse(day + "T00:00:00Z") / DAY_MS;
  const dayOf = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
  const MAX_TRIP_DAYS = 366;

  // Every day the trip covers, then any day a place sits on outside it.
  function tripDays(trip, places) {
    const days = new Set();
    if (trip.start && trip.end && dayNum(trip.end) - dayNum(trip.start) < MAX_TRIP_DAYS) {
      for (let n = dayNum(trip.start); n <= dayNum(trip.end); n++) days.add(dayOf(n));
    } else {
      if (trip.start) days.add(trip.start);
      if (trip.end) days.add(trip.end);
    }
    for (const p of places) if (p.day) days.add(p.day);
    return [...days].sort();
  }
  const dayIndex = (trip, day) => (trip.start ? dayNum(day) - dayNum(trip.start) + 1 : null);

  // Where a trip stands against today, for Home's order and labels.
  function tripStatus(trip, today) {
    const s = trip.start, e = trip.end || trip.start;
    if (!s) return "undated";
    if (e < today) return "past";
    if (s > today) return "upcoming";
    return "now";
  }
  const STATUS_RANK = { now: 0, upcoming: 1, undated: 2, past: 3 };
  function sortTrips(trips, today) {
    return trips.slice().sort((a, b) => {
      const sa = tripStatus(a, today), sb = tripStatus(b, today);
      if (sa !== sb) return STATUS_RANK[sa] - STATUS_RANK[sb];
      if (sa === "past") return b.start.localeCompare(a.start);
      if (sa === "undated") return String(b.createdAt).localeCompare(String(a.createdAt));
      return a.start.localeCompare(b.start);
    });
  }
  const daysUntil = (day, today) => dayNum(day) - dayNum(today);

  function slotOf(p) {
    if (!p.time) return "any";
    let slot = SLOTS[0][0];
    for (const [id, , from] of SLOTS) if (p.time >= from) slot = id;
    return slot;
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  const byTime = (a, b) => (a.time || "99").localeCompare(b.time || "99") || RANK[a.importance] - RANK[b.importance] || byName(a, b);
  const byImportance = (a, b) => RANK[a.importance] - RANK[b.importance] || byName(a, b);

  function distanceKm(a, b) {
    const r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // The board's groups for one sort. Each group: { id, title, places, day?,
  // slots? }. `only` is the importance levels shown (all when empty).
  //   time        each day of the trip, its places in time slots, then "No date"
  //   category    one group per category that has places
  //   importance  Must see, Want to, Maybe
  //   distance    one list, nearest to `from` first, then "No location"
  function board(trip, places, sort, { only, from } = {}) {
    const shown = only && only.length ? places.filter((p) => only.includes(p.importance)) : places.slice();
    if (sort === "category") {
      return CATEGORIES.map(([id, title]) => ({ id, title, places: shown.filter((p) => p.category === id).sort(byImportance) }))
        .filter((g) => g.places.length);
    }
    if (sort === "importance") {
      return IMPORTANCE.map(([id, title]) => ({ id, title, places: shown.filter((p) => p.importance === id).sort(byTime) }))
        .filter((g) => g.places.length);
    }
    if (sort === "distance") {
      const located = shown.filter((p) => p.lat != null);
      const rest = shown.filter((p) => p.lat == null).sort(byImportance);
      const near = from ? located.map((p) => ({ p, km: distanceKm(from, p) })).sort((a, b) => a.km - b.km) : [];
      const out = [];
      if (from && near.length) out.push({ id: "near", title: "Nearest first", places: near.map((x) => x.p), km: new Map(near.map((x) => [x.p.id, x.km])) });
      else if (located.length) out.push({ id: "located", title: "Located", places: located.sort(byImportance) });
      if (rest.length) out.push({ id: "nowhere", title: "No location", places: rest });
      return out;
    }
    const groups = tripDays(trip, places).map((day) => {
      const list = shown.filter((p) => p.day === day);
      const slots = SLOTS.map(([id, title]) => ({ id, title, places: list.filter((p) => slotOf(p) === id).sort(byTime) }))
        .concat([{ id: "any", title: "Any time", places: list.filter((p) => !p.time).sort(byImportance) }])
        .filter((s) => s.places.length);
      return { id: day, day, title: day, places: list, slots };
    });
    groups.push({ id: "nodate", title: "No date", places: shown.filter((p) => !p.day).sort(byImportance) });
    return groups;
  }

  // A backup file: the trips asked for (all when none), their places, and
  // their covers as data URLs (added by views.js, which can read blobs).
  const BACKUP_FORMAT = 1;
  function backupOf(doc, tripIds) {
    const ids = new Set(tripIds && tripIds.length ? tripIds : doc.trips.map((t) => t.id));
    return { app: "tripboard", format: BACKUP_FORMAT, exportedAt: now(),
      trips: doc.trips.filter((t) => ids.has(t.id)), places: doc.places.filter((p) => ids.has(p.trip)),
      expenses: (doc.expenses || []).filter((x) => ids.has(x.trip)), files: (doc.files || []).filter((x) => ids.has(x.trip)),
      covers: {}, blobs: {} };
  }
  // A backup's trips join the doc. A trip already here (same id) is
  // replaced by the file's copy, places and all. → { doc, added, replaced }
  function mergeBackup(doc, data) {
    if (!data || data.app !== "tripboard" || !Array.isArray(data.trips)) throw new Error("That file isn't a Tripboard backup.");
    if (data.format > BACKUP_FORMAT) throw new Error("That backup is from a newer Tripboard. Update this one first.");
    const incoming = sanitizeDoc({ trips: data.trips, places: data.places || [], expenses: data.expenses || [], files: data.files || [] });
    const ids = new Set(incoming.trips.map((t) => t.id));
    const replaced = doc.trips.filter((t) => ids.has(t.id)).length;
    return {
      doc: { ...doc, trips: doc.trips.filter((t) => !ids.has(t.id)).concat(incoming.trips), places: doc.places.filter((p) => !ids.has(p.trip)).concat(incoming.places),
        expenses: (doc.expenses || []).filter((x) => !ids.has(x.trip)).concat(incoming.expenses),
        files: (doc.files || []).filter((x) => !ids.has(x.trip)).concat(incoming.files) },
      added: incoming.trips.length - replaced, replaced, ids: [...ids],
    };
  }

  // Google's terms allow keeping a location from Google for 30 days. These
  // are the places whose Google location is older than that, or was dropped
  // for it and can be fetched again by its place id.
  const GOOGLE_DAYS = 30;
  function staleGoogle(places, today) {
    return places.filter((p) => p.placeId && (p.lat == null ? !p.address : !p.geoAt || daysUntil(p.geoAt, today) <= -GOOGLE_DAYS));
  }

  // One day's located places in the order they're planned, for the map's route.
  function dayRoute(places, day) {
    return places.filter((p) => p.day === day && p.lat != null).sort(byTime);
  }

  // What a trip's expenses add up to: one total per currency, the biggest
  // first (no exchange rates, so currencies aren't added together).
  function expenseTotals(list) {
    const by = new Map();
    for (const x of list) by.set(x.currency, Math.round(((by.get(x.currency) || 0) + x.amount) * 100) / 100);
    return [...by].map(([currency, total]) => ({ currency, total })).sort((a, b) => b.total - a.total);
  }
  // Per category, in EXPENSE_CATEGORIES' order, each with its totals.
  function expensesByCategory(list) {
    return EXPENSE_CATEGORIES.map(([id, title]) => ({ id, title, totals: expenseTotals(list.filter((x) => x.category === id)) }))
      .filter((g) => g.totals.length);
  }
  // The list by day, oldest first, then the undated; newest added first in each.
  function expenseDays(list) {
    const days = [...new Set(list.filter((x) => x.day).map((x) => x.day))].sort();
    const order = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));
    const out = days.map((day) => ({ day, items: list.filter((x) => x.day === day).sort(order) }));
    const none = list.filter((x) => !x.day).sort(order);
    if (none.length) out.push({ day: null, items: none });
    return out;
  }

  const api = {
    sanitizeFile, MAX_FILE_MB, EXPENSE_CATEGORIES, EXPENSE_CATEGORY, CURRENCIES, sanitizeExpense, expenseTotals, expensesByCategory, expenseDays,
    CATEGORIES, CATEGORY, IMPORTANCE, IMPORTANCE_LABEL, SLOTS, newId, isDay, isTime,
    sanitizeTrip, sanitizePlace, sanitizeDoc, stamp, tripDays, dayIndex, tripStatus, sortTrips, daysUntil,
    slotOf, distanceKm, board, backupOf, mergeBackup, staleGoogle, dayRoute, GOOGLE_DAYS,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { window.Tripboard = window.Tripboard || {}; window.Tripboard.model = api; }
})();
