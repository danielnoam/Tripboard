// Tripboard's data, and the pure parts of the board: cleaning, days, time
// slots, and how places sort and group. No DOM here, so Node tests it
// (test/model.test.js). Grown from LifeLog's Travel tab
// (from-lifelog/src/travel.js).
//
// A trip: id, name, optional start and end (YYYY-MM-DD), destinations (a
// list of names), cover (true when an image is stored for it).
// A place: id, trip, name, category, importance, and optionally day (and
// endDay, when it lasts several days: a stay, a festival), time and endTime
// (HH:MM, the same on each of its days), note, lat and lng, address, placeId (Google's id,
// the only thing kept from Google), visited.
// An expense: id, trip, title, amount (a number, in `currency`, an ISO
// 4217 code), category, and optionally day, place (a place's id), note and
// paidBy (who paid, for when a trip is shared).
// Every record can carry `by`: the id of the person who changed it last.
// A trip can carry owner (a person id), members: [{ id, name, role?, hide? }]
// and share: { role, hide }, what everyone gets unless their own entry says
// otherwise. role is owner, editor or viewer; hide lists the sections a
// person doesn't see (expenses, files). The app follows these for whoever
// uses it; they aren't a lock, since the sync repo holds the whole trip.
// A file: id, trip, name, type (its MIME type), size in bytes, and
// optionally place, note and local (true: kept on this device only, never
// synced or shared). Its bytes are kept apart (store.js), never in the doc.
(function () {
  // In the browser i18n comes from src/language.js; in Node (tests, the CLI) the English stays.
  const i18n = (typeof window === "object" && window.i18n) || { t: (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m)), tn: (n, one, other, v) => (n === 1 ? one : other).replace(/\{(\w+)\}/g, (m, k) => (k === "n" ? n : v && k in v ? v[k] : m)) };
  const CATEGORIES = [
    ["sight", i18n.t("Sights")], ["food", i18n.t("Food & drink")], ["nature", i18n.t("Nature")], ["museum", i18n.t("Museums")],
    ["shopping", i18n.t("Shopping")], ["nightlife", i18n.t("Nightlife")], ["stay", i18n.t("Stays")], ["transport", i18n.t("Getting around")],
    ["other", i18n.t("Other")],
  ];
  const CATEGORY = new Map(CATEGORIES);
  const isCatId = (s) => typeof s === "string" && /^[\w-]{1,40}$/.test(s);
  // Your categories (Settings), as [[id, name]]: the defaults until you
  // change them. A default you haven't renamed keeps its translated name;
  // "other" is always there, last unless you moved it.
  function catList(custom) {
    if (!Array.isArray(custom) || !custom.length) return CATEGORIES.slice();
    const seen = new Set();
    const out = [];
    for (const c of custom) {
      if (!c || !isCatId(c.id) || seen.has(c.id)) continue;
      const name = text(c.name).slice(0, 40) || CATEGORY.get(c.id);
      if (!name) continue;
      seen.add(c.id);
      out.push([c.id, name]);
    }
    if (!seen.has("other")) out.push(["other", CATEGORY.get("other")]);
    return out;
  }
  // A category's name: yours, then the one the trip carries, then Other.
  const catName = (cats, trip, id) => (cats.find(([x]) => x === id) || [])[1] || (trip && trip.cats && trip.cats[id]) || CATEGORY.get(id) || CATEGORY.get("other");
  // Each trip carries the names of the categories its places use that
  // aren't the untouched defaults. Returns the doc, with only the trips
  // whose names changed copied.
  function carryCats(doc, cats) {
    const trips = doc.trips.map((t) => {
      const used = new Set(doc.places.filter((p) => p.trip === t.id).map((p) => p.category));
      const want = {};
      for (const id of [...used].sort()) {
        const mine = cats.find(([x]) => x === id);
        const name = mine ? mine[1] : t.cats && t.cats[id];
        if (name && name !== CATEGORY.get(id)) want[id] = name;
      }
      if (JSON.stringify(want) === JSON.stringify(t.cats || {})) return t;
      const next = { ...t };
      if (Object.keys(want).length) next.cats = want; else delete next.cats;
      return next;
    });
    return trips.some((t, i) => t !== doc.trips[i]) ? { ...doc, trips } : doc;
  }
  // Highest first. Importance is both a sort and a filter on the board.
  const IMPORTANCE = [["must", i18n.t("Must see")], ["want", i18n.t("Want to")], ["maybe", i18n.t("Maybe")]];
  const IMPORTANCE_LABEL = new Map(IMPORTANCE);
  const RANK = { must: 0, want: 1, maybe: 2 };
  // A day's time slots. A place with a day and no time is "Any time".
  const SLOTS = [["morning", i18n.t("Morning"), "00:00"], ["afternoon", i18n.t("Afternoon"), "12:00"], ["evening", i18n.t("Evening"), "17:00"]];

  const EXPENSE_CATEGORIES = [
    ["stay", i18n.t("Stays")], ["transport", i18n.t("Getting around")], ["food", i18n.t("Food & drink")], ["activity", i18n.t("Tickets & activities")],
    ["shopping", i18n.t("Shopping")], ["other", i18n.t("Other")],
  ];
  const EXPENSE_CATEGORY = new Map(EXPENSE_CATEGORIES);
  // The currencies offered first; any other ISO code is kept as it comes.
  const CURRENCIES = ["USD", "EUR", "GBP", "ILS", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY", "HKD", "KRW", "SGD", "THB", "VND",
    "IDR", "MYR", "PHP", "INR", "AED", "TRY", "EGP", "MAD", "ZAR", "MXN", "BRL", "ARS", "CLP", "PEN", "COP",
    "SEK", "NOK", "DKK", "ISK", "PLN", "CZK", "HUF", "RON", "GEL"];
  const KNOWN_EXPENSE = new Set(["id", "trip", "title", "amount", "currency", "category", "day", "place", "note", "paidBy", "by", "createdAt", "updatedAt"]);
  const KNOWN_FILE = new Set(["id", "trip", "name", "type", "size", "place", "note", "local", "by", "createdAt", "updatedAt"]);
  const MAX_FILE_MB = 25;
  const KNOWN_TRIP = new Set(["id", "name", "start", "end", "destinations", "cover", "owner", "members", "share", "cats", "by", "createdAt", "updatedAt"]);
  const KNOWN_PLACE = new Set(["id", "trip", "name", "category", "importance", "day", "endDay", "time", "endTime", "note",
    "lat", "lng", "address", "placeId", "geoAt", "visited", "by", "createdAt", "updatedAt"]);
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
    const members = (Array.isArray(t.members) ? t.members : []).filter((m) => m && isPersonId(m.id))
      .map((m) => {
        const r = { id: m.id, name: text(m.name).slice(0, 60) };
        if (ROLES.includes(m.role)) r.role = m.role;
        if (Array.isArray(m.hide)) r.hide = SECTIONS.filter((x) => m.hide.includes(x));
        return r;
      });
    const seen = new Set();
    out.members = members.filter((m) => !seen.has(m.id) && seen.add(m.id));
    if (isPersonId(t.owner)) out.owner = t.owner;
    else if (out.members.some((m) => m.role === "owner")) out.owner = out.members.find((m) => m.role === "owner").id;
    // The owner is always a member, and the only one with that role.
    for (const m of out.members) if (m.role === "owner" && m.id !== out.owner) m.role = "editor";
    if (out.owner && !out.members.some((m) => m.id === out.owner)) out.members.unshift({ id: out.owner, name: "", role: "owner" });
    const om = out.members.find((m) => m.id === out.owner);
    if (om) om.role = "owner";
    if (om) delete om.hide;
    if (!out.members.length) delete out.members;
    const sh = t.share && typeof t.share === "object" ? t.share : null;
    if (sh && (sh.role === "viewer" || (Array.isArray(sh.hide) && sh.hide.length))) {
      out.share = { role: sh.role === "viewer" ? "viewer" : "editor", hide: SECTIONS.filter((x) => (sh.hide || []).includes(x)) };
    }
    if (isPersonId(t.by)) out.by = t.by;
    // The names of your own categories its places use, so a trip you share
    // (or restore) shows them by name where that list isn't.
    const cats = {};
    if (t.cats && typeof t.cats === "object") for (const [id, name] of Object.entries(t.cats)) if (isCatId(id) && text(name)) cats[id] = text(name).slice(0, 40);
    if (Object.keys(cats).length) out.cats = cats;
    return keepUnknown(t, out, KNOWN_TRIP);
  }

  const ROLES = ["owner", "editor", "viewer"];
  const isPersonId = (v) => typeof v === "string" && /^[\w-]{1,40}$/.test(v);
  // What a person may do with a trip: "read", "edit" or "manage" (members,
  // deleting the trip). A trip with no members yet is its device's own.
  // Someone not on the list yet gets what everyone gets.
  const SECTIONS = ["expenses", "files"];
  const DEFAULT_SHARE = { role: "editor", hide: [] };
  function access(trip, personId) {
    if (!trip.members || !trip.members.length || trip.owner === personId) return { role: "owner", hide: [], own: { role: false, hide: false } };
    const m = trip.members.find((x) => x.id === personId) || {};
    const d = trip.share || DEFAULT_SHARE;
    return { role: m.role || d.role, hide: (m.hide || d.hide).slice(), own: { role: !!m.role, hide: !!m.hide } };
  }
  function can(trip, personId, what) {
    const a = access(trip, personId);
    if (what === "manage") return a.role === "owner";
    if (what === "edit") return a.role !== "viewer";
    if (SECTIONS.includes(what)) return !a.hide.includes(what);
    return true;
  }
  // You on a shared trip: added to its people when you aren't there yet,
  // and your name kept current. Gives true when it changed the trip.
  function join(trip, me) {
    if (!trip.members || !trip.members.length || !me || !isPersonId(me.id)) return false;
    const m = trip.members.find((x) => x.id === me.id);
    const name = text(me.name).slice(0, 60);
    if (!m) { trip.members.push({ id: me.id, name }); return true; }
    if (name && m.name !== name) { m.name = name; return true; }
    return false;
  }
  // One person's id becomes another's: a second device takes the id the
  // first one keeps in the sync repo. Trips and expenses that named the old
  // id name the new one, stamped now so the change wins a merge.
  function renamePerson(doc, from, to) {
    if (!isPersonId(from) || !isPersonId(to) || from === to) return doc;
    const at = now();
    for (const t of doc.trips) {
      let hit = false;
      if (t.owner === from) { t.owner = to; hit = true; }
      for (const m of t.members || []) if (m.id === from) { m.id = to; hit = true; }
      if (hit && t.members) {
        const seen = new Set();
        t.members = t.members.filter((m) => !seen.has(m.id) && seen.add(m.id));
        t.updatedAt = at;
      }
    }
    for (const x of doc.expenses || []) if (x.paidBy === from) { x.paidBy = to; x.updatedAt = at; }
    return doc;
  }
  // A trip made by `me` starts with them as its owner.
  function ownTrip(trip, me) {
    if (!me || !isPersonId(me.id) || trip.owner) return trip;
    return Object.assign(trip, { owner: me.id, members: [{ id: me.id, name: text(me.name), role: "owner" }] });
  }

  function sanitizePlace(p) {
    p = p || {};
    const out = {
      id: text(p.id) || newId(), trip: text(p.trip), name: text(p.name) || "Untitled place",
      category: isCatId(p.category) ? p.category : "other",
      importance: RANK[p.importance] != null ? p.importance : "want",
      createdAt: p.createdAt || now(), updatedAt: p.updatedAt || p.createdAt || now(),
    };
    if (isDay(p.day)) out.day = p.day;
    if (out.day && isDay(p.endDay) && p.endDay > out.day && dayNum(p.endDay) - dayNum(out.day) < MAX_TRIP_DAYS) out.endDay = p.endDay;
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
    if (isPersonId(p.by)) out.by = p.by;
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
    if (isPersonId(e.by)) out.by = e.by;
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
    if (isPersonId(f.by)) out.by = f.by;
    if (f.local) out.local = true;
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
      if (t && typeof t.at === "string" && t.at > cutoff && !ids.has(id) && !live.has(id)) deleted[id] = isPersonId(t.by) ? { at: t.at, trip: text(t.trip), by: t.by } : { at: t.at, trip: text(t.trip) };
    }
    return keepUnknown(d, { trips, places, expenses, files, deleted }, new Set(["trips", "places", "expenses", "files", "deleted"]));
  }

  // What changed between two saves: a record that's new or different gets
  // `updatedAt` now, and one that's gone is remembered in `deleted`. Done in
  // one place so no edit can forget it, and a sync can trust both.
  function stamp(prev, next, at, by) {
    at = at || now();
    const before = new Map();
    for (const t of (prev && prev.trips) || []) before.set(t.id, { r: t, trip: t.id });
    for (const p of ((prev && prev.places) || []).concat((prev && prev.expenses) || [], (prev && prev.files) || [])) before.set(p.id, { r: p, trip: p.trip });
    const same = (a, b) => { const x = { ...a }, y = { ...b }; delete x.updatedAt; delete y.updatedAt; delete x.by; delete y.by; return JSON.stringify(x) === JSON.stringify(y); };
    const seen = new Set();
    for (const r of next.trips.concat(next.places, next.expenses || [], next.files || [])) {
      seen.add(r.id);
      const b = before.get(r.id);
      if (!b || !same(b.r, r)) { r.updatedAt = at; if (isPersonId(by)) r.by = by; }
      delete next.deleted[r.id];
    }
    for (const [id, b] of before) if (!seen.has(id) && !b.r.local) next.deleted[id] = isPersonId(by) ? { at, trip: b.trip, by } : { at, trip: b.trip };
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
    for (const p of places) for (const d of placeDays(p)) days.add(d);
    return [...days].sort();
  }
  // The days a place is on: none, its day, or its day to its endDay.
  function placeDays(p) {
    if (!p.day) return [];
    if (!p.endDay) return [p.day];
    const out = [];
    for (let n = dayNum(p.day); n <= dayNum(p.endDay) && out.length < MAX_TRIP_DAYS; n++) out.push(dayOf(n));
    return out;
  }
  const onDay = (p, day) => !!p.day && day >= p.day && day <= (p.endDay || p.day);
  // A day moved by n days.
  const addDays = (day, n) => dayOf(dayNum(day) + n);
  const daySpan = (p) => (p.day && p.endDay ? dayNum(p.endDay) - dayNum(p.day) : 0);
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
  function board(trip, places, sort, { only, from, cats } = {}) {
    const shown = only && only.length ? places.filter((p) => only.includes(p.importance)) : places.slice();
    if (sort === "category") {
      const list = cats || CATEGORIES;
      // A category that isn't in your list (someone else's, on a shared
      // trip) gets its own group, under the name the trip carries.
      const extra = [...new Set(shown.map((p) => p.category))].filter((id) => !list.some(([x]) => x === id))
        .map((id) => [id, catName(list, trip, id)]);
      return list.concat(extra).map(([id, title]) => ({ id, title, places: shown.filter((p) => p.category === id).sort(byImportance) }))
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
      if (from && near.length) out.push({ id: "near", title: i18n.t("Nearest first"), places: near.map((x) => x.p), km: new Map(near.map((x) => [x.p.id, x.km])) });
      else if (located.length) out.push({ id: "located", title: i18n.t("Located"), places: located.sort(byImportance) });
      if (rest.length) out.push({ id: "nowhere", title: i18n.t("No location"), places: rest });
      return out;
    }
    const groups = tripDays(trip, places).map((day) => {
      const list = shown.filter((p) => onDay(p, day));
      const slots = SLOTS.map(([id, title]) => ({ id, title, places: list.filter((p) => slotOf(p) === id).sort(byTime) }))
        .concat([{ id: "any", title: i18n.t("Any time"), places: list.filter((p) => !p.time).sort(byImportance) }])
        .filter((s) => s.places.length);
      return { id: day, day, title: day, places: list, slots };
    });
    groups.push({ id: "nodate", title: i18n.t("No date"), places: shown.filter((p) => !p.day).sort(byImportance) });
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
    if (!data || data.app !== "tripboard" || !Array.isArray(data.trips)) throw new Error(i18n.t("That file isn't a Tripboard backup."));
    if (data.format > BACKUP_FORMAT) throw new Error(i18n.t("That backup is from a newer Tripboard. Update this one first."));
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
    return places.filter((p) => onDay(p, day) && p.lat != null).sort(byTime);
  }

  // Today's places in the order they're planned: timed ones by time, then
  // the rest by importance. Multi-day places (a stay) are on each of their days.
  function dayPlan(places, day) {
    const list = places.filter((p) => onDay(p, day));
    return list.filter((p) => p.time).sort(byTime).concat(list.filter((p) => !p.time).sort(byImportance));
  }
  // A guess at getting from a to b, from the straight line between them (no
  // routing service): streets add about a third, walking is 5 km/h, and past
  // 2 km it's a drive in town at 25 km/h. Minutes round to 5. → { km, mode, min }
  // or null when either has no location.
  const WALK_KM = 2;
  function leg(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    const km = distanceKm(a, b);
    const mode = km <= WALK_KM ? "walk" : "drive";
    const min = Math.max(5, Math.round((km * 1.3) / (mode === "walk" ? 5 : 25) * 60 / 5) * 5);
    return { km, mode, min };
  }
  // The first place of the day not yet marked as been to.
  const nextOf = (plan) => plan.find((p) => !p.visited) || null;

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

  // A finger's move from (0,0) to (dx,dy) in ms: a swipe to the next tab
  // (+1), the one before (-1), or neither (0). Mostly sideways, far enough
  // and quick; in a right-to-left language the tabs run the other way.
  function swipeStep(dx, dy, ms, rtl) {
    if (Math.abs(dx) < 60 || Math.abs(dx) < 2 * Math.abs(dy) || ms > 700) return 0;
    return (dx < 0) !== !!rtl ? 1 : -1;
  }

  const api = {
    sanitizeFile, MAX_FILE_MB, ROLES, SECTIONS, access, can, join, renamePerson, ownTrip, EXPENSE_CATEGORIES, EXPENSE_CATEGORY, CURRENCIES, sanitizeExpense, expenseTotals, expensesByCategory, expenseDays,
    placeDays, onDay, addDays, daySpan, catList, catName, carryCats, isCatId, CATEGORIES, CATEGORY, IMPORTANCE, IMPORTANCE_LABEL, SLOTS, newId, isDay, isTime,
    sanitizeTrip, sanitizePlace, sanitizeDoc, stamp, tripDays, dayIndex, tripStatus, sortTrips, daysUntil,
    slotOf, distanceKm, board, backupOf, mergeBackup, staleGoogle, dayRoute, dayPlan, leg, nextOf, GOOGLE_DAYS, swipeStep,
    // Every field each record can hold, for cli/coverage.js's drift check.
    KNOWN: { trip: KNOWN_TRIP, place: KNOWN_PLACE, expense: KNOWN_EXPENSE, file: KNOWN_FILE },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { window.Tripboard = window.Tripboard || {}; window.Tripboard.model = api; }
})();
