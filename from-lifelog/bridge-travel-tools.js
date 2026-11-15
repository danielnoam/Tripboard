// Extracted from LifeLog's bridge/tools.js (main at eca2dac, 2026-11-15) before Travel was removed.
// It ran inside LifeLog's bridge: L = LifeLog's modules loaded in Node, S = its input-schema helpers,
// change()/fail()/pickByText()/replaceItem()/cut() are bridge helpers. See removal.diff for the context.

// ---- reading travel.json (a sibling file beside lifelog.json) ----
const SIBLINGS = {
  boards: { name: "boards.json", empty: { boards: [] }, keys: ["boards"] },
  travel: { name: "travel.json", empty: { trips: [], places: [] }, keys: ["trips", "places"] },
  // The Ledger's watchlist and its date pins (investments.json).
  invest: { name: "investments.json", empty: { watchlist: [], pins: [] }, keys: ["watchlist", "pins"] },
};
async function readTravel() { return Travel.sanitizeDoc((await storeOf("travel").read()).data); }

// ---- helpers ----
function findTrip(list, ident) {
  const want = String(ident == null ? "" : ident).trim();
  if (!want) fail("Say which trip (its id or name).");
  return list.find((t) => t.id === want) || pickByText(list, want, (t) => t.name, "trip");
}
function findPlace(doc, ident, trip) {
  const want = String(ident == null ? "" : ident).trim();
  if (!want) fail("Say which place (its id or name).");
  const byId = doc.places.find((p) => p.id === want);
  if (byId) return byId;
  const list = trip ? doc.places.filter((p) => p.trip === findTrip(doc.trips, trip).id) : doc.places;
  return pickByText(list, want, (p) => p.name, "place");
}
// One place as a line of a trip's plan.
function placeLine(p) {
  const when = p.time ? Travel.timeLabel(p) + " " : "";
  const extra = [p.address, p.note].filter(Boolean).join(" · ");
  return `- ${when}${p.name}${p.visited ? " ✓ visited" : ""}${extra ? " — " + cut(extra, 160) : ""}  (${p.id})`;
}
// A Google Maps link's places, read the way the app reads them
// (Travel.fetchGoogle) but straight from Google: Node isn't a browser, so
// there's no CORS and no proxy. The short link's redirect is read, not
// followed, the way proxy/worker.js does it.
async function googleGet(kind, arg) {
  try {
    if (kind === "resolve") {
      let at = "https://maps.app.goo.gl/" + arg;
      for (let hop = 0; hop < 4; hop++) {
        const res = await fetch(at, { redirect: "manual" });
        const next = res.headers.get("location");
        if (!next) break;
        at = new URL(next, at).toString();
        if (!/^https:\/\/(maps\.app\.goo\.gl|goo\.gl)\//.test(at)) return at;
      }
      fail("That link didn't lead anywhere. Copy it again from Share in Google Maps.");
    }
    const res = await fetch(Travel.googleListUrl(arg));
    if (!res.ok) fail(`Google Maps didn't send that list (HTTP ${res.status}). Is it shared?`);
    return await res.text();
  } catch (e) {
    if (e instanceof InputError) throw e;
    fail("Couldn't reach Google Maps: " + ((e && e.message) || e));
  }
}
async function readGoogle(link) {
  try { return await Travel.fetchGoogle(link, googleGet); }
  catch (e) { if (e instanceof InputError) throw e; fail(String((e && e.message) || e) + "."); }
}

// The fields a place takes from a tool's arguments; an empty string clears.
const PLACE_FIELDS = ["name", "day", "time", "endTime", "address", "note", "url", "lat", "lng", "visited"];
function placeFields(a, into) {
  for (const k of PLACE_FIELDS) {
    if (a[k] == null) continue;
    if (a[k] === "") delete into[k]; else into[k] = a[k];
  }
  if (a.day != null && a.day !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(a.day)) fail("day is a date, YYYY-MM-DD.");
  for (const k of ["time", "endTime"]) if (a[k] && !/^\d{2}:\d{2}$/.test(a[k])) fail(`${k} is a time, HH:MM (24-hour).`);
  if (into.time && !into.day) fail("A time needs a day: give day too.");
  return into;
}


// ---- lifelog_search's trip part ----
      if (plain("trips")) try {
        const tr = await readTravel();
        for (const t of tr.trips) if (hit(t.name)) hits.push(`- trip: ${t.name} (${t.id})`);
        for (const p of tr.places) if (hit([p.name, p.address, p.note].join(" "))) {
          const t = tr.trips.find((x) => x.id === p.trip);
          hits.push(`- place in ${t ? t.name : "a trip"}: ${p.name} (${p.id})`);
        }
      } catch (e) { /* so are trips */ }

// ---- the tools ----
const TOOLS = [
  {
    name: "lifelog_trips",
    description: "Trips (the Travel tab): each trip's dates and places. Give trip for its plan day by day: scheduled places by time, then the day's other places, then the places with no day yet.",
    readOnly: true,
    input: { trip: S.str("One trip's id or name") },
    async run(a) {
      const doc = await readTravel();
      if (!a.trip) {
        if (!doc.trips.length) return "No trips yet.";
        const t0 = today();
        return [`${doc.trips.length} trip${doc.trips.length === 1 ? "" : "s"}`, ...Travel.sortTrips(doc.trips, t0).map((t) => {
          const n = doc.places.filter((p) => p.trip === t.id).length;
          return `- ${t.name}: ${Travel.rangeLabel(t.start, t.end) || "no dates"}, ${n} place${n === 1 ? "" : "s"} [${Travel.tripStatus(t, t0)}]  (${t.id})`;
        })].join("\n");
      }
      const t = findTrip(doc.trips, a.trip);
      const places = doc.places.filter((p) => p.trip === t.id);
      const out = [`${t.name}: ${Travel.rangeLabel(t.start, t.end) || "no dates"}, ${places.length} places  (${t.id})`];
      for (const day of Travel.tripDays(t, places)) {
        const list = Travel.sortDay(places.filter((p) => p.day === day));
        out.push(`${Travel.dayLabel(day)} (${day})${list.length ? "" : ": nothing planned"}`, ...list.map(placeLine));
      }
      const loose = Travel.sortDay(places.filter((p) => !p.day));
      if (loose.length) out.push("No day yet", ...loose.map(placeLine));
      return out.join("\n");
    },
  },

  {
    name: "lifelog_add_trip",
    description: "Start a trip in the Travel tab. Dates are optional; with them every day of the trip shows in its plan.",
    input: { name: S.str("What to call it"), start: S.date("First day"), end: S.date("Last day") },
    required: ["name"],
    async run(a) {
      return change(`add trip "${a.name}"`, (doc) => {
        const now = changeNow || nowIso();
        const t = Travel.sanitizeTrip({ id: L.uid(), name: a.name, start: a.start, end: a.end || a.start, createdAt: now, updatedAt: now });
        (doc.trips = doc.trips || []).push(t);
        return { text: `Added the trip "${t.name}"${t.start ? ", " + Travel.rangeLabel(t.start, t.end) : ""} (${t.id}).`, touched: [["trips", t.id]] };
      }, { file: "travel" });
    },
  },
  {
    name: "lifelog_update_trip",
    description: "Rename a trip or change its dates. An empty date clears it.",
    input: { trip: S.str("Its id or name"), name: S.str("New name"), start: S.date("First day"), end: S.date("Last day") },
    required: ["trip"],
    async run(a) {
      if (a.name == null && a.start == null && a.end == null) fail("Nothing to change: give name, start or end.");
      return change(`edit trip "${a.trip}"`, (doc) => {
        const t = findTrip(Travel.sanitizeDoc(doc).trips, a.trip);
        const next = { ...(doc.trips.find((x) => x.id === t.id)) };
        if (a.name != null) { if (!String(a.name).trim()) fail("A trip needs a name."); next.name = a.name; }
        for (const k of ["start", "end"]) if (a[k] != null) { if (a[k] === "") delete next[k]; else next[k] = a[k]; }
        const clean = Travel.sanitizeTrip(next);
        replaceItem(doc, "trips", clean);
        return { text: `Updated the trip "${clean.name}": ${Travel.rangeLabel(clean.start, clean.end) || "no dates"}.`, touched: [["trips", t.id]] };
      }, { file: "travel" });
    },
  },
  {
    name: "lifelog_delete_trip",
    description: "Delete a trip and every place in it. Undoable with lifelog_undo.",
    destructive: true,
    input: { trip: S.str("Its id or name") },
    required: ["trip"],
    async run(a) {
      return change(`delete trip "${a.trip}"`, (doc) => {
        const t = findTrip(Travel.sanitizeDoc(doc).trips, a.trip);
        const gone = (doc.places || []).filter((p) => p.trip === t.id);
        doc.trips = doc.trips.filter((x) => x.id !== t.id);
        doc.places = (doc.places || []).filter((p) => p.trip !== t.id);
        return { text: `Deleted the trip "${t.name}" and its ${gone.length} place${gone.length === 1 ? "" : "s"}.`, touched: [["trips", t.id], ...gone.map((p) => ["places", p.id])] };
      }, { file: "travel" });
    },
  },
  {
    name: "lifelog_add_place",
    description: "Add a place to a trip. Give day to plan it for that day, and time (and endTime) to schedule it; with neither it's somewhere to get to sometime during the trip.",
    input: {
      trip: S.str("The trip's id or name"), name: S.str("The place"), day: S.date("The day to go"),
      time: S.str("Start time, HH:MM (needs day)"), endTime: S.str("End time, HH:MM"),
      address: S.str("Address"), note: S.str("A note"), url: S.str("A Google Maps link"),
      lat: S.num("Latitude"), lng: S.num("Longitude"),
    },
    required: ["trip", "name"],
    async run(a) {
      return change(`add place "${a.name}"`, (doc) => {
        const t = findTrip(Travel.sanitizeDoc(doc).trips, a.trip);
        const now = changeNow || nowIso();
        const same = (doc.places || []).filter((p) => p.trip === t.id && (p.day || "") === (a.day || "") && typeof p.order === "number");
        const raw = placeFields(a, { id: L.uid(), trip: t.id, createdAt: now, updatedAt: now, order: same.length ? Math.max(...same.map((p) => p.order)) + 1 : 0 });
        const p = Travel.sanitizePlace(raw);
        (doc.places = doc.places || []).push(p);
        return { text: `Added "${p.name}" to ${t.name}${p.day ? " on " + Travel.dayLabel(p.day) + (p.time ? " at " + Travel.timeLabel(p) : "") : ", no day yet"} (${p.id}).`, touched: [["places", p.id]] };
      }, { file: "travel" });
    },
  },
  {
    name: "lifelog_update_place",
    description: "Change a place in a trip: move it to a day (empty day for no day), schedule or unschedule it (empty time), edit its details, or mark it visited.",
    input: {
      place: S.str("Its id, or its name"), trip: S.str("The trip, when the name alone is ambiguous"),
      name: S.str("New name"), day: S.date("The day; empty for no day"),
      time: S.str("Start time, HH:MM; empty to unschedule"), endTime: S.str("End time, HH:MM; empty to clear"),
      address: S.str("Address"), note: S.str("A note"), url: S.str("A Google Maps link"),
      lat: S.num("Latitude"), lng: S.num("Longitude"), visited: S.bool("Been there"),
    },
    required: ["place"],
    async run(a) {
      if (PLACE_FIELDS.every((k) => a[k] == null)) fail("Nothing to change.");
      return change(`edit place "${a.place}"`, (doc) => {
        const found = findPlace(Travel.sanitizeDoc(doc), a.place, a.trip);
        const next = { ...(doc.places.find((x) => x.id === found.id)) };
        if (a.day === "") { delete next.time; delete next.endTime; }
        if (a.time === "") delete next.endTime;
        placeFields({ ...a, visited: a.visited === false ? "" : a.visited }, next);
        const p = Travel.sanitizePlace(next);
        replaceItem(doc, "places", p);
        return { text: `Updated "${p.name}": ${p.day ? Travel.dayLabel(p.day) + (p.time ? " at " + Travel.timeLabel(p) : "") : "no day yet"}${p.visited ? ", visited" : ""}.`, touched: [["places", p.id]] };
      }, { file: "travel" });
    },
  },
  {
    name: "lifelog_delete_place",
    description: "Remove a place from a trip. Undoable with lifelog_undo.",
    destructive: true,
    input: { place: S.str("Its id, or its name"), trip: S.str("The trip, when the name alone is ambiguous") },
    required: ["place"],
    async run(a) {
      return change(`delete place "${a.place}"`, (doc) => {
        const p = findPlace(Travel.sanitizeDoc(doc), a.place, a.trip);
        doc.places = doc.places.filter((x) => x.id !== p.id);
        return { text: `Removed "${p.name}".`, touched: [["places", p.id]] };
      }, { file: "travel" });
    },
  },
  {
    name: "lifelog_google_list",
    description: "Read a Google Maps link: a shared saved list (maps.app.goo.gl/…) gives every place in it, grouped by area; a shared place gives that one. Nothing is changed; lifelog_import_google_list adds them to a trip.",
    readOnly: true,
    input: { link: S.str("The link from Share in Google Maps") },
    required: ["link"],
    async run(a) {
      const got = await readGoogle(a.link);
      const lines = [`${got.name}: ${got.places.length} place${got.places.length === 1 ? "" : "s"}`];
      for (const area of Travel.areas(got.places)) {
        lines.push("", area.name);
        for (const p of area.places) lines.push(`- ${p.name}${[p.address, p.note].filter(Boolean).length ? " — " + cut([p.address, p.note].filter(Boolean).join(" · "), 160) : ""}`);
      }
      return lines.join("\n");
    },
  },
  {
    name: "lifelog_import_google_list",
    description: "Add places from a Google Maps link (a shared saved list, or one place) to a trip, with no day yet. A list often spans several trips: give only to take just the places whose names (or towns, as lifelog_google_list groups them) contain one of its comma-separated words. Places already in the trip are skipped.",
    input: {
      trip: S.str("The trip's id or name"), link: S.str("The link from Share in Google Maps"),
      only: S.str("Comma-separated: keep only places whose name or town contains one of these"),
    },
    required: ["trip", "link"],
    async run(a) {
      const got = await readGoogle(a.link);
      const words = String(a.only || "").split(",").map(lower).filter(Boolean);
      const town = new Map();
      for (const area of Travel.areas(got.places)) for (const p of area.places) town.set(p, area.name);
      const wanted = got.places.filter((p) => !words.length || words.some((w) => lower(p.name).includes(w) || lower(town.get(p)).includes(w)));
      if (!wanted.length) fail(`None of the ${got.places.length} places in "${got.name}" matches "${a.only}".`);
      const before = await readTravel();
      const t0 = findTrip(before.trips, a.trip);
      if (wanted.every((g) => before.places.some((h) => h.trip === t0.id && Travel.samePlace(h, g)))) {
        return `Nothing to add: ${wanted.length === 1 ? "that place is" : `all ${wanted.length} places are`} already in ${t0.name}.`;
      }
      return change(`import ${wanted.length} places from "${got.name}"`, (doc) => {
        const t = findTrip(Travel.sanitizeDoc(doc).trips, a.trip);
        doc.places = doc.places || [];
        const have = doc.places.filter((p) => p.trip === t.id);
        const fresh = wanted.filter((g) => !have.some((h) => Travel.samePlace(h, g)));
        const now = changeNow || nowIso();
        const loose = have.filter((p) => !p.day && typeof p.order === "number");
        let order = loose.length ? Math.max(...loose.map((p) => p.order)) + 1 : 0;
        const added = fresh.map((g) => Travel.sanitizePlace({
          ...g, id: L.uid(), trip: t.id, order: order++, createdAt: now, updatedAt: now,
          source: got.source || undefined, url: got.url || undefined,
        }));
        doc.places.push(...added);
        const skipped = wanted.length - fresh.length;
        return {
          text: `Added ${added.length} place${added.length === 1 ? "" : "s"} from "${got.name}" to ${t.name}, no day yet${skipped ? `; ${skipped} already there` : ""}.` + (added.length ? "\n" + added.map((p) => `- ${p.name}  (${p.id})`).join("\n") : ""),
          touched: added.map((p) => ["places", p.id]),
        };
      }, { file: "travel" });
    },
  },
];
