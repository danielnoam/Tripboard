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

  // The whole store. A place whose trip is gone is dropped: deleting a trip
  // takes its places with it.
  function sanitizeDoc(d) {
    const trips = ((d && d.trips) || []).filter((t) => t && typeof t === "object").map(sanitizeTrip);
    const ids = new Set(trips.map((t) => t.id));
    const places = ((d && d.places) || []).filter((p) => p && typeof p === "object").map(sanitizePlace).filter((p) => ids.has(p.trip));
    return { trips, places };
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

  const api = {
    CATEGORIES, CATEGORY, IMPORTANCE, IMPORTANCE_LABEL, SLOTS, newId, isDay, isTime,
    sanitizeTrip, sanitizePlace, sanitizeDoc, tripDays, dayIndex, tripStatus, sortTrips, daysUntil,
    slotOf, distanceKm, board,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { window.Tripboard = window.Tripboard || {}; window.Tripboard.model = api; }
})();
