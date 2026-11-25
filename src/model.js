// Tripboard's data, and the pure parts of the board: cleaning, days, time
// slots, and how places sort and group. No DOM here, so Node tests it
// (test/model.test.js). Grown from LifeLog's Travel tab
// (from-lifelog/src/travel.js).
//
// A trip: id, name, optional start and end (YYYY-MM-DD), destinations (a
// list of names), cover (true when an image is stored for it), and
// destInfo: { name: { start, end, lat, lng } } for destinations that have
// dates or a location. It sits beside destinations, which stays a plain
// list of names, so builds from before it read the trip as they always did.
// A place: id, trip, name, category, importance, and optionally day (and
// endDay, when it lasts several days: a stay, a festival), time and endTime
// (HH:MM, the same on each of its days; a stay's are check-in and check-out), note, lat and lng, address, placeId (Google's id,
// the only thing kept from Google), visited, rating (your own, 1 to 5 stars),
// and dest: the trip destination it was put in by hand (without one it goes
// with the nearest; destOf()).
// A journey (a flight, a train) is a place with kind "journey": its name,
// lat, lng and address are where it leaves from, day and time when; mode
// (flight, train, bus, ferry, other), toName, toLat, toLng and toAddress
// where it goes, arriveDay (when it lands on a later day) and arriveTime
// when, and number (LX 160). Times are each end's own local clock. An
// older build shows a journey as a plain place named after where it leaves.
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
// A link or a note lives in Files too, as a file with kind "link" (and
// url, http or https only) or kind "note" (and text). They have no bytes
// (hasBytes), so they travel in the trip's bundle like any other record.
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
  // Ready-made covers (assets/covers/<name>.svg): a trip keeps the name, as
  // art. A photo, when there is one, shows instead.
  const COVER_ART = ["mountains", "beach", "city", "desert", "forest", "snow", "lake", "countryside"];
  const RANK = { must: 0, want: 1, maybe: 2 };
  // Your own rating of a place, in whole stars, best first; unrated last.
  const RATINGS = [5, 4, 3, 2, 1].map((n) => [String(n), "★".repeat(n)]);
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
  const KNOWN_FILE = new Set(["id", "trip", "name", "type", "size", "place", "note", "local", "by", "createdAt", "updatedAt", "kind", "url", "text"]);
  const MAX_FILE_MB = 25;
  const MAX_NOTE = 50000;
  const MAX_ORDER = 999;
  const KNOWN_TRIP = new Set(["id", "name", "start", "end", "destinations", "destInfo", "cover", "art", "owner", "members", "share", "cats", "by", "createdAt", "updatedAt"]);
  const KNOWN_PLACE = new Set(["id", "trip", "name", "category", "importance", "day", "endDay", "time", "endTime", "note",
    "lat", "lng", "address", "placeId", "geoAt", "visited", "dest", "rating", "order", "by", "createdAt", "updatedAt",
    "kind", "mode", "toName", "toLat", "toLng", "toAddress", "toPlaceId", "toGeoAt", "arriveDay", "arriveTime", "number"]);
  // A journey's kinds of transport, as [id, name].
  const MODES = [["flight", i18n.t("Flight")], ["train", i18n.t("Train")], ["bus", i18n.t("Bus")], ["ferry", i18n.t("Ferry")], ["other", i18n.t("Other")]];
  const MODE = new Map(MODES);
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
    // Dates and a location for some destinations, keyed by name.
    const info = {};
    const src = t.destInfo && typeof t.destInfo === "object" ? t.destInfo : {};
    for (const name of out.destinations) {
      const v = src[name];
      if (!v || typeof v !== "object") continue;
      const r = {};
      if (isDay(v.start)) { r.start = v.start; r.end = isDay(v.end) ? v.end : v.start; }
      if (r.end < r.start) [r.start, r.end] = [r.end, r.start];
      if (r.start && dayNum(r.end) - dayNum(r.start) >= MAX_TRIP_DAYS) r.end = dayOf(dayNum(r.start) + MAX_TRIP_DAYS - 1);
      const lat = num(v.lat), lng = num(v.lng);
      if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) { r.lat = lat; r.lng = lng; }
      // Where it sits in Plan › Destination: inside another ("in" its
      // name), on its own (""), or, left out, by its dates.
      if (typeof v.in === "string" && (v.in === "" || (v.in !== name && out.destinations.includes(v.in)))) r.in = v.in;
      if (Object.keys(r).length) info[name] = r;
    }
    if (Object.keys(info).length) out.destInfo = info;
    if (t.cover) out.cover = true;
    if (COVER_ART.includes(t.art)) out.art = t.art;
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

  // A copy of a trip, yours alone (no people, no sharing). Its places come
  // with their name, category, importance, description and destination;
  // never their rating or "been there", and never the trip's expenses.
  //   opts.locations: each place's (and journey's) location
  //   opts.dates: the trip's days and each place's day and time, moved to
  //     opts.start when the trip has a start (Day 2 stays Day 2)
  //   opts.attachments: links, notes and files, on their copied places
  // → { trip, places, files, fileIds: [[from, to]] } — a file's bytes and
  // the cover photo are the caller's to copy (fileIds, trip.cover).
  const PLACE_WHERE = ["lat", "lng", "address", "placeId", "geoAt", "toLat", "toLng", "toAddress", "toPlaceId", "toGeoAt"];
  const PLACE_WHEN = ["day", "endDay", "time", "endTime", "order", "arriveDay", "arriveTime"];
  function duplicateTrip(doc, trip, opts = {}, me) {
    const at = now();
    const o = { locations: opts.locations !== false, dates: opts.dates !== false, attachments: opts.attachments !== false };
    const shift = o.dates && trip.start && isDay(opts.start) ? dayNum(opts.start) - dayNum(trip.start) : 0;
    const move = (d) => (isDay(d) ? addDays(d, shift) : d);
    const t = { id: newId(), name: text(opts.name) || trip.name, destinations: [...trip.destinations], createdAt: at, updatedAt: at };
    if (o.dates && trip.start) { t.start = move(trip.start); if (trip.end) t.end = move(trip.end); }
    const info = {};
    for (const [name, v] of Object.entries(trip.destInfo || {})) {
      const r = { ...v };
      if (o.dates && r.start) { r.start = move(r.start); r.end = move(r.end); } else { delete r.start; delete r.end; }
      if (Object.keys(r).length) info[name] = r;
    }
    if (Object.keys(info).length) t.destInfo = info;
    if (trip.cats) t.cats = { ...trip.cats };
    if (trip.art) t.art = trip.art;
    if (trip.cover) { t.cover = true; t.coverAt = at; }
    ownTrip(t, me);
    const ids = new Map();
    const places = (doc.places || []).filter((p) => p.trip === trip.id).map((p) => {
      const c = { ...p, id: newId(), trip: t.id, createdAt: at, updatedAt: at };
      ids.set(p.id, c.id);
      for (const k of ["rating", "visited", "by"]) delete c[k];
      if (!o.locations) for (const k of PLACE_WHERE) delete c[k];
      if (!o.dates) for (const k of PLACE_WHEN) delete c[k];
      else for (const k of ["day", "endDay", "arriveDay"]) if (c[k]) c[k] = move(c[k]);
      return sanitizePlace(c);
    });
    const fileIds = [];
    const files = !o.attachments ? [] : (doc.files || []).filter((f) => f.trip === trip.id && (!f.place || ids.has(f.place))).map((f) => {
      const c = { ...f, id: newId(), trip: t.id, createdAt: at, updatedAt: at };
      delete c.by;
      if (f.place) c.place = ids.get(f.place);
      if (hasBytes(f)) fileIds.push([f.id, c.id]);
      return sanitizeFile(c);
    });
    return { trip: sanitizeTrip(t), places, files, fileIds };
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
    // A stay's are check-in, on its first day, and check-out, on its last,
    // so check-out can be earlier than check-in, or the only one known.
    if (out.day && isTime(p.time)) out.time = p.time;
    if (out.day && isTime(p.endTime) && (isStay(out) || (out.time && p.endTime > out.time))) out.endTime = p.endTime;
    // Its place in the day's plan, from 1, among places at the same time
    // (or with none); set by an AI tool, and dropped when it moves day.
    const order = num(p.order);
    if (out.day && order != null && order >= 1 && order <= MAX_ORDER) out.order = Math.round(order);
    const lat = num(p.lat), lng = num(p.lng);
    if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) { out.lat = lat; out.lng = lng; }
    for (const k of ["note", "address", "placeId"]) { const v = text(p[k]); if (v) out[k] = v; }
    // When a Google location was fetched: Google allows keeping it 30 days.
    if (out.lat != null && isDay(p.geoAt)) out.geoAt = p.geoAt;
    if (p.visited) out.visited = true;
    const dest = text(p.dest).slice(0, 80);
    if (dest) out.dest = dest;
    const rating = num(p.rating);
    if (rating != null && rating >= 1 && rating <= 5) out.rating = Math.round(rating);
    if (p.kind === "journey") journeyFields(p, out);
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

  // A web address as typed: "example.com/x" gets https://; anything but
  // http and https (javascript:, data:, file:) is refused, as "".
  function linkUrl(v) {
    let s = text(v);
    if (!s) return "";
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
    try {
      const u = new URL(s);
      return (u.protocol === "https:" || u.protocol === "http:") && u.hostname ? u.href.slice(0, 2000) : "";
    } catch (e) { return ""; }
  }
  const linkHost = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
  const hasBytes = (f) => !!f && f.kind !== "link" && f.kind !== "note";
  function sanitizeFile(f) {
    f = f || {};
    const size = num(f.size);
    const kind = f.kind === "link" || f.kind === "note" ? f.kind : "";
    const url = kind === "link" ? linkUrl(f.url) : "";
    const out = {
      id: text(f.id) || newId(), trip: text(f.trip),
      name: text(f.name).slice(0, 200) || (kind === "link" ? linkHost(url) || "Link" : kind === "note" ? "Note" : "Untitled file"),
      type: /^[\w.+-]+\/[\w.+-]+$/.test(text(f.type)) ? text(f.type) : "application/octet-stream",
      size: size != null && size >= 0 ? Math.round(size) : 0,
      createdAt: f.createdAt || now(), updatedAt: f.updatedAt || f.createdAt || now(),
    };
    for (const k of ["place", "note"]) { const v = text(f[k]); if (v) out[k] = v; }
    if (isPersonId(f.by)) out.by = f.by;
    if (f.local) out.local = true;
    if (kind) {
      out.kind = kind;
      out.size = 0;
      out.type = kind === "link" ? "text/uri-list" : "text/plain";
      if (kind === "link") out.url = url;
      else out.text = String(f.text == null ? "" : f.text).replace(/\r\n?/g, "\n").replace(/\s+$/, "").slice(0, MAX_NOTE);
    }
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

  // A stay (a place in Stays over several nights) has its check-in time
  // (time) on its first day, its check-out time (endTime) on its last, and
  // no time on the nights between. Anything else has its time on each day.
  const isStay = (p) => p.category === "stay" && !!p.endDay;
  function timeOn(p, day) {
    if (!day || !isStay(p)) return p.time || null;
    return (day === p.day ? p.time : day === p.endDay ? p.endTime : null) || null;
  }
  // "in", "night" or "out" on one of a stay's days; null for anything else.
  function stayPart(p, day) {
    if (!isStay(p) || !onDay(p, day)) return null;
    return day === p.day ? "in" : day === p.endDay ? "out" : "night";
  }
  function slotOf(p, day) {
    const time = timeOn(p, day);
    if (!time) return "any";
    let slot = SLOTS[0][0];
    for (const [id, , from] of SLOTS) if (time >= from) slot = id;
    return slot;
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  const byTime = (a, b) => (a.time || "99").localeCompare(b.time || "99") || RANK[a.importance] - RANK[b.importance] || byName(a, b);
  const byImportance = (a, b) => RANK[a.importance] - RANK[b.importance] || byName(a, b);
  // A day's order: by time (untimed last), then the order given, then importance.
  const inDay = (day) => (a, b) => (timeOn(a, day) || "99").localeCompare(timeOn(b, day) || "99") || (a.order || Infinity) - (b.order || Infinity) || byImportance(a, b);

  function distanceKm(a, b) {
    const r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // ---------- Destinations ----------
  // A place goes with the destination it was put in by hand, or else the
  // nearest located one within REACH_KM. A day goes with the dated
  // destination that covers it and starts last, so a travel day is the
  // arrival's and a stay inside another (Hakone in Tokyo's dates) wins.
  const REACH_KM = 60;
  const destsOf = (trip) => (trip.destinations || []).map((name) => ({ name, ...((trip.destInfo || {})[name] || {}) }));
  const hasDestDates = (trip) => destsOf(trip).some((d) => d.start);
  function destOf(trip, p) {
    if (p.dest && (trip.destinations || []).includes(p.dest)) return p.dest;
    if (p.lat == null) return null;
    let best = null, km = REACH_KM;
    for (const d of destsOf(trip)) {
      if (d.lat == null) continue;
      const k = distanceKm(d, p);
      if (k <= km) { best = d.name; km = k; }
    }
    return best;
  }
  function dayDest(trip, day) {
    let best = null;
    for (const d of destsOf(trip)) if (d.start && d.start <= day && day <= d.end && (!best || d.start >= best.start)) best = d;
    return best ? best.name : null;
  }
  // A stay kept on while you sleep somewhere else (a night of the Tokyo
  // hotel on a Hakone day): booked, but not where the day happens, so the
  // day lists it apart and leaves it out of the way between places.
  function awayStay(trip, p, day) {
    if (stayPart(p, day) !== "night") return false;
    const here = dayDest(trip, day), at = destOf(trip, p);
    return !!here && !!at && at !== here;
  }
  // Puts a place in a destination (null: none chosen, the nearest): by
  // hand only when the nearest isn't already it.
  function setDest(trip, p, name) {
    delete p.dest;
    if (name && destOf(trip, p) !== name) p.dest = name;
  }
  // Each destination's dates from the trip's stays near it: the first
  // stay's day to the last one's end. → { name: { start, end } }
  function datesFromStays(trip, places) {
    const out = {};
    for (const p of places) {
      if (p.category !== "stay" || !p.day) continue;
      const name = destOf(trip, p);
      if (!name) continue;
      const end = p.endDay || p.day, r = out[name];
      out[name] = r ? { start: p.day < r.start ? p.day : r.start, end: end > r.end ? end : r.end } : { start: p.day, end };
    }
    return out;
  }

  // The board's groups for one sort. Each group: { id, title, places, day?,
  // slots? }. Filters, each showing all when left out: `only` the
  // importance levels, `categories` the category ids, `stars` STAR_FILTERS.
  //   time        each day of the trip, its places in time slots, then "No date".
  //               Once a destination has dates, each run of its days is
  //               headed by { kind: "dest", dest, start, end, again } and,
  //               the first time, { kind: "any", dest, places }: its places
  //               with no day. No date then has parts: [{ dest, places }],
  //               a destination's (one without dates) and then none.
  //   area        one group a destination, in date order, like a sheet with a
  //               block for each city: { kind: "area", dest, start, end,
  //               stays, places, side: [same, for each trip out of it] }.
  //               A destination whose dates sit inside a longer one's is a
  //               trip out of it (Hiroshima from Osaka), unless destInfo's
  //               "in" puts it inside another or ("") on its own. Destinations with
  //               no dates follow, then { kind: "travel" } for journeys
  //               outside every destination's dates, and "No destination".
  function journeyFields(p, out) {
    out.kind = "journey";
    out.mode = MODE.has(p.mode) ? p.mode : "other";
    // A journey is one leg: it has no end day of its own, only an arrival.
    delete out.endDay; delete out.endTime;
    const toName = text(p.toName);
    if (toName) out.toName = toName.slice(0, 160);
    const lat = num(p.toLat), lng = num(p.toLng);
    if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) { out.toLat = lat; out.toLng = lng; }
    for (const [k, v] of [["toAddress", p.toAddress], ["toPlaceId", p.toPlaceId]]) { const t = text(v); if (t) out[k] = t; }
    // Where it goes, from Google: kept 30 days like a place's own location.
    if (out.toLat != null && isDay(p.toGeoAt)) out.toGeoAt = p.toGeoAt;
    if (out.day && isDay(p.arriveDay) && p.arriveDay > out.day && dayNum(p.arriveDay) - dayNum(out.day) <= 3) out.arriveDay = p.arriveDay;
    if (out.day && isTime(p.arriveTime)) out.arriveTime = p.arriveTime;
    const n = text(p.number);
    if (n) out.number = n.slice(0, 40);
  }
  const isJourney = (p) => !!p && p.kind === "journey";
  // The day a journey lands: its arriveDay, or the day it leaves.
  const landsOn = (j) => j.arriveDay || j.day;
  // Where a place or journey ends up: a journey's arrival, when it has one.
  const endOf = (p) => (isJourney(p) ? (p.toLat != null ? { lat: p.toLat, lng: p.toLng } : null) : p);
  // Journeys that land on `day` after leaving on an earlier one (an
  // overnight flight), by arrival time.
  function arrivals(places, day) {
    return places.filter((p) => isJourney(p) && p.arriveDay === day)
      .sort((a, b) => (a.arriveTime || "99").localeCompare(b.arriveTime || "99"));
  }
  const sameSpot = (a, b) => {
    const n = (s) => String(s || "").trim().toLowerCase();
    if (n(a.toName) && n(a.toName) === n(b.name)) return true;
    return a.toLat != null && b.lat != null && distanceKm({ lat: a.toLat, lng: a.toLng }, b) <= 3;
  };
  const minuteOf = (day, time) => dayNum(day) * 1440 + +time.slice(0, 2) * 60 + +time.slice(3);
  // A change between two journeys: b leaves from where a lands, within a
  // day. Both times are that place's clock, so the wait is right across
  // time zones. → { at, min } or null.
  function connection(a, b) {
    if (!isJourney(a) || !isJourney(b) || !a.day || !b.day || !a.arriveTime || !b.time || !sameSpot(a, b)) return null;
    const min = minuteOf(b.day, b.time) - minuteOf(landsOn(a), a.arriveTime);
    return min > 0 && min <= 1440 ? { at: a.toName || b.name, min } : null;
  }
  // The journey that carries on from `a`, if any.
  function nextLeg(places, a) {
    return places.filter((b) => b !== a && b.trip === a.trip && connection(a, b))
      .sort((x, y) => (x.day + x.time).localeCompare(y.day + y.time))[0] || null;
  }

  // The board by destination (sort "area"). A place goes to the
  // destination it was put in or is near; one with a day outside that
  // destination's dates, or near none, to the destination of its day. A
  // journey goes to the destination of the day it leaves. In each: stays
  // first, then places with a day by day and time, then the rest by
  // importance.
  function areas(trip, places) {
    const dests = destsOf(trip);
    const dated = dests.filter((d) => d.start && d.end);
    const span = (d) => dayNum(d.end) - dayNum(d.start);
    const byDate = (d) => (d.start && d.end ? dated.filter((o) => o !== d && o.start <= d.start && d.end <= o.end && span(o) > span(d))
      .sort((a, b) => span(a) - span(b))[0] || null : null);
    const named = (n) => dests.find((x) => x.name === n) || null;
    const direct = (d) => (typeof d.in === "string" ? named(d.in) : byDate(d));
    // One level deep: a destination inside one that is itself inside
    // another goes in the outer one; a loop puts it on its own.
    const parentOf = (d) => {
      let up = direct(d);
      const seen = new Set([d]);
      while (up && direct(up)) { if (seen.has(up)) return null; seen.add(up); up = direct(up); }
      return up === d ? null : up;
    };
    const home = (p) => {
      if (isJourney(p)) return p.day ? dayDest(trip, p.day) : null;
      const near = destOf(trip, p);
      if (!p.day) return near;
      const d = near && dests.find((x) => x.name === near);
      if (d && (!d.start || (p.day <= d.end && (p.endDay || p.day) >= d.start))) return near;
      return dayDest(trip, p.day) || near;
    };
    const byWhen = (a, b) => (a.day ? 0 : 1) - (b.day ? 0 : 1) || (a.day || "").localeCompare(b.day || "") || byTime(a, b);
    const of = new Map(dests.map((d) => [d.name, { kind: "area", id: "area:" + d.name, title: d.name, dest: d.name, start: d.start || null, end: d.end || null, stays: [], places: [], side: [] }]));
    const travel = [], none = [];
    for (const p of places) {
      const g = of.get(home(p));
      if (!g) (isJourney(p) && p.day ? travel : none).push(p);
      else if (isStay(p) && p.day) g.stays.push(p);
      else g.places.push(p);
    }
    for (const g of of.values()) { g.stays.sort(byWhen); g.places.sort(byWhen); }
    const ups = new Map(dests.map((d) => [d.name, parentOf(d)]));
    for (const d of dests) if (ups.get(d.name)) of.get(ups.get(d.name).name).side.push(of.get(d.name));
    const top = dests.filter((d) => !ups.get(d.name)).map((d) => of.get(d.name))
      .filter((g) => g.start || g.places.length || g.stays.length || g.side.length);
    for (const g of of.values()) g.side.sort((a, b) => (a.start ? 0 : 1) - (b.start ? 0 : 1) || (a.start || "").localeCompare(b.start || ""));
    // Journeys outside every destination's dates, in runs of days in a row.
    travel.sort(byWhen);
    const runs = [];
    for (const j of travel) {
      const last = runs[runs.length - 1];
      if (last && dayNum(j.day) - dayNum(last.end) <= 1) { last.places.push(j); last.end = j.day; }
      else runs.push({ kind: "travel", id: "travel:" + j.day, title: i18n.t("On the way"), start: j.day, end: j.day, places: [j] });
    }
    const out = top.concat(runs).sort((a, b) => (a.start ? 0 : 1) - (b.start ? 0 : 1) || (a.start || "").localeCompare(b.start || ""));
    if (none.length) out.push({ id: "nodest", title: i18n.t("No destination"), places: none.sort(byWhen) });
    return out;
  }

  // The Plan's rating filter: "5", "4" or "3" (that many stars and up) or
  // "none" (not rated yet). Journeys have no rating and always stay.
  const STAR_FILTERS = ["5", "4", "3", "none"];
  const rated = (p, stars) => isJourney(p) || (stars === "none" ? !p.rating : (p.rating || 0) >= +stars);
  // The places the Plan's and the map's filters keep.
  function filterPlaces(places, { only, categories, stars } = {}) {
    let shown = only && only.length ? places.filter((p) => only.includes(p.importance) || isJourney(p)) : places.slice();
    if (categories && categories.length) shown = shown.filter((p) => categories.includes(p.category));
    if (STAR_FILTERS.includes(String(stars))) shown = shown.filter((p) => rated(p, String(stars)));
    return shown;
  }
  function board(trip, places, sort, filters) {
    const shown = filterPlaces(places, filters);
    if (sort === "area") return areas(trip, shown);
    const groups = tripDays(trip, places).map((day) => {
      const list = shown.filter((p) => onDay(p, day));
      const slots = SLOTS.map(([id, title]) => ({ id, title, places: list.filter((p) => slotOf(p, day) === id).sort(inDay(day)) }))
        .concat([{ id: "any", title: i18n.t("Any time"), places: list.filter((p) => !timeOn(p, day)).sort(inDay(day)) }])
        .filter((s) => s.places.length);
      return { id: day, day, title: day, places: list, slots };
    });
    const undated = shown.filter((p) => !p.day).sort(byImportance);
    if (!hasDestDates(trip)) {
      groups.push({ id: "nodate", title: i18n.t("No date"), places: undated });
      return groups;
    }
    const where = new Map(undated.map((p) => [p.id, destOf(trip, p)]));
    const out = [], seen = new Set();
    let cur = null;
    for (const g of groups) {
      const name = dayDest(trip, g.day);
      if (name && name !== cur) {
        const d = destsOf(trip).find((x) => x.name === name);
        out.push({ id: "dest:" + g.day, kind: "dest", title: name, dest: name, start: d.start, end: d.end, again: seen.has(name), places: [] });
        if (!seen.has(name)) out.push({ id: "any:" + name, kind: "any", title: i18n.t("Any day in {name}", { name }), dest: name, places: undated.filter((p) => where.get(p.id) === name) });
        seen.add(name);
      }
      cur = name;
      g.dest = name;
      out.push(g);
    }
    const rest = undated.filter((p) => !seen.has(where.get(p.id)));
    const parts = (trip.destinations || []).filter((n) => !seen.has(n)).map((dest) => ({ dest, places: rest.filter((p) => where.get(p.id) === dest) }))
      .concat([{ dest: null, places: rest.filter((p) => !where.get(p.id)) }]).filter((x) => x.places.length);
    out.push({ id: "nodate", title: i18n.t("No date"), places: rest, parts });
    return out;
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
  // The same for where journeys go.
  function staleGoogleTo(places, today) {
    return places.filter((p) => isJourney(p) && p.toPlaceId && (p.toLat == null ? !p.toAddress : !p.toGeoAt || daysUntil(p.toGeoAt, today) <= -GOOGLE_DAYS));
  }

  // One day's located places in the order they're planned, for the map's route.
  function dayRoute(places, day) {
    return places.filter((p) => onDay(p, day) && p.lat != null && !isJourney(p)).sort(inDay(day));
  }

  // Today's places in the order they're planned: timed ones by time, then
  // the rest; each by their order, then importance. Multi-day places (a stay)
  // are on each of their days.
  function dayPlan(places, day) {
    return places.filter((p) => onDay(p, day)).sort(inDay(day));
  }
  // A guess at getting from a to b, from the straight line between them (no
  // routing service): streets add about a third, walking is 5 km/h, and past
  // 2 km it's a drive in town at 25 km/h. Minutes round to 5. → { km, mode, min }
  // or null when either has no location.
  const WALK_KM = 2;
  function leg(a, b) {
    a = a && endOf(a);
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
    sanitizeFile, MAX_FILE_MB, MAX_NOTE, hasBytes, linkUrl, linkHost, ROLES, SECTIONS, access, can, join, renamePerson, ownTrip, duplicateTrip, EXPENSE_CATEGORIES, EXPENSE_CATEGORY, CURRENCIES, sanitizeExpense, expenseTotals, expensesByCategory, expenseDays,
    placeDays, onDay, addDays, MODES, MODE, isJourney, landsOn, endOf, arrivals, connection, nextLeg, daySpan, catList, catName, carryCats, isCatId, CATEGORIES, CATEGORY, IMPORTANCE, IMPORTANCE_LABEL, RATINGS, STAR_FILTERS, filterPlaces, COVER_ART, SLOTS, newId, isDay, isTime,
    sanitizeTrip, sanitizePlace, sanitizeDoc, stamp, tripDays, dayIndex, tripStatus, sortTrips, daysUntil,
    slotOf, isStay, timeOn, stayPart, distanceKm, board, areas, REACH_KM, destsOf, hasDestDates, destOf, dayDest, awayStay, setDest, datesFromStays, backupOf, mergeBackup, staleGoogle, staleGoogleTo, dayRoute, dayPlan, leg, nextOf, GOOGLE_DAYS, swipeStep,
    // Every field each record can hold, for cli/coverage.js's drift check.
    KNOWN: { trip: KNOWN_TRIP, place: KNOWN_PLACE, expense: KNOWN_EXPENSE, file: KNOWN_FILE },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { window.Tripboard = window.Tripboard || {}; window.Tripboard.model = api; }
})();
