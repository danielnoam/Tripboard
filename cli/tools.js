// Every command the CLI and the MCP server offer, in one list, so the two
// can't drift apart: cli/tripboard.js and cli/mcp.js are both made from it,
// and test/coverage.test.js checks it against what the app can do
// (cli/coverage.js). Each entry:
//   tool   the MCP tool's name: added, never renamed or removed
//   cmd    the CLI command's name: the same promise
//   kind   "read" (on a snapshot) or "write" (one commit)
//   args   [name, JSON schema, { req, pos, cli: false, mcp: false }]
//          pos: the CLI takes it in that place instead of --name
//   op / query   the function in core.js that does it
//   input  "bytes": a file's contents, from --path (CLI) or content /
//          text (MCP); an MCP chat can't make the server read a path
//   print  how the CLI shows the answer (JSON with --json, or by default
//          when there's no print)
// fs and path load only when the CLI reads or writes a file, so the MCP
// side runs where there's no file system (the sharing server's Worker).
const fs = () => require("fs");
const path = () => require("path");
const core = require("./core");
const PL = require("../src/places.js");
const WX = require("../src/weather.js");
const M = core.M;

const day = { type: "string", description: "A date, YYYY-MM-DD." };
const tripArg = ["trip", { type: "string", description: "The trip's id or name (or part of it)." }, { req: true, pos: 0 }];
const placeArg = (req) => ["place", { type: "string", description: "The place's id or name in this trip." }, { req, pos: 1 }];
const clears = " An empty string clears it.";
const placeFields = [
  ["name", { type: "string" }],
  ["category", { type: "string", description: "A category id: " + M.CATEGORIES.map((c) => c[0]).join(", ") + ", or one of your own (list_categories)." }],
  ["importance", { type: "string", enum: M.IMPORTANCE.map((c) => c[0]), description: "must (must see), want (want to), maybe." }],
  ["day", { ...day, description: "YYYY-MM-DD, the day it's planned for." + clears }],
  ["endDay", { type: "string", description: "YYYY-MM-DD, the last day of a place that lasts several days (a stay); after day." }],
  ["time", { type: "string", description: "HH:MM, needs a day; the same on each of its days. For a stay (category stay, with an endDay) it is the check-in time, on its first day only." }],
  ["endTime", { type: "string", description: "HH:MM, after time. For a stay it is the check-out time, on its endDay only, and can be earlier than time." }],
  ["note", { type: "string" }],
  ["lat", { type: "number" }], ["lng", { type: "number" }],
  ["address", { type: "string" }],
  ["placeId", { type: "string", description: "Google's place id, if it came from Google." }],
  ["visited", { type: "boolean", description: "Been there (the Today view's tick)." }],
  ["rating", { type: "number", description: "Your own rating, 1 to 5 whole stars." + clears }],
  ["dest", { type: "string", description: "The trip destination it belongs to, picked by hand; without one it goes with the nearest destination that has a location." + clears }],
  ["kind", { type: "string", enum: ["place", "journey"], description: "journey: a flight, train, bus or ferry leg. Then name, lat, lng and address are where it leaves from, day and time when; the to* fields where it arrives. place (or empty) turns it back into a plain place and drops the journey fields." }],
  ["mode", { type: "string", enum: M.MODES.map((m) => m[0]), description: "A journey's transport." }],
  ["toName", { type: "string", description: "Where a journey arrives, like \"Tokyo Narita (NRT)\". Use find_location for its toLat and toLng." + clears }],
  ["toLat", { type: "number" }], ["toLng", { type: "number" }],
  ["toAddress", { type: "string" }],
  ["toPlaceId", { type: "string", description: "Google's place id for where it arrives, if it came from Google." }],
  ["arriveDay", { type: "string", description: "YYYY-MM-DD, when a journey lands on a later day than it leaves (an overnight flight), up to 3 days after." + clears }],
  ["arriveTime", { type: "string", description: "HH:MM, the local time where it arrives (each end keeps its own clock, so it can be before time)." + clears }],
  ["number", { type: "string", description: "A flight or train number, like LX 160." + clears }],
  ["order", { type: "number", description: "Its place in its day's plan, from 1. Places with a time go by time first; order sorts those at the same time and those without one. Moving it to another day clears it unless given again. order_day sets a whole day at once." + clears }],
];
const expenseFields = [
  ["title", { type: "string" }], ["amount", { type: "number" }],
  ["currency", { type: "string", description: "ISO 4217 code, like EUR or JPY." }],
  ["category", { type: "string", enum: M.EXPENSE_CATEGORIES.map((c) => c[0]) }],
  ["day", day], ["place", { type: "string", description: "A place's id or name in this trip." }], ["note", { type: "string" }],
  ["paidBy", { type: "string", description: "Who paid: a person's id on a shared trip." }],
];
const tripFields = [["name", { type: "string" }], ["start", day], ["end", day], ["destinations", { type: "array", items: { type: "string" }, description: "Place names; the CLI takes them comma-separated." }],
  ["destInfo", { type: "array", items: { type: "object", properties: { name: { type: "string" }, start: day, end: day, lat: { type: "number" }, lng: { type: "number" }, in: { type: ["string", "null"] } }, required: ["name"] },
    description: "Dates and a location for destinations, merged into what they have (a new name joins destinations). With dates, the plan goes by destination: each day with the dated destination covering it (the one starting last), and an \"Any day in …\" list of its places that have no day. A place goes with the destination picked for it (add_place/update_place dest), or else the nearest one with lat and lng within " + M.REACH_KM + " km: find_location finds them. start \"\" clears the dates. in: where it sits in get_board sort area: another destination's name puts it inside that one (a day trip from it, dates or not), \"\" on its own, null back to by its dates. The CLI takes JSON." }]];
const fileFields = [["name", { type: "string" }], ["place", { type: "string", description: "A place's id or name in this trip it belongs to." + clears }], ["note", { type: "string" }]];
const bytesArgs = [
  ["path", { type: "string", description: "A file on this computer." }, { mcp: false }],
  ["content", { type: "string", description: "The file's bytes, base64." }, { cli: false }],
  ["text", { type: "string", description: "Or the file's text, for a text file." }, { cli: false }],
];
const people = { type: "string", description: "A person's id or name on the trip." };
const MAX_STEPS = 100;
const filesOk = (env) => env.TRIPBOARD_MCP_FILES === "1";
const FILES_OFF = "File contents stay out of the chat unless the person turns them on: TRIPBOARD_MCP_FILES=1 in this server's env.";

// A shared Google Maps list's places, read by Tripboard's server
// (server/googlelist.js); the cloud connector passes its own reader.
const SERVER = "https://tripboard.danielnoam1999.workers.dev";
async function googleList(url, env) {
  if (env.googleList) return env.googleList(String(url));
  const r = await (env.fetch || globalThis.fetch)((env.TRIPBOARD_SERVER || SERVER) + "/google-list", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: String(url) }) });
  let body = null;
  try { body = await r.json(); } catch (e) { /* not JSON */ }
  if (!r.ok) throw new Error((body && body.error) || "Tripboard's server didn't read that list (" + r.status + ").");
  return body;
}

const money = (n, cur) => { try { return new Intl.NumberFormat("en", { style: "currency", currency: cur }).format(n); } catch (e) { return n + " " + cur; } };
const placeLine = (p) => [p.day || "no date", p.time || "", M.isJourney(p) ? p.mode + " " + (p.number ? p.number + " " : "") + p.name + " → " + (p.toName || "?") + (p.arriveTime ? " " + p.arriveTime + (p.arriveDay ? " (" + p.arriveDay + ")" : "") : "") : p.name, M.isJourney(p) ? "" : "[" + p.importance + ", " + p.category + "]", p.visited ? "visited" : "", p.rating ? "★" + p.rating : "", p.km != null ? p.km + " km" : ""].filter(Boolean).join("  ") + "  (" + p.id + ")";

function printTrip(v) {
  const t = v.trip;
  const lines = [t.name + (t.start ? "  " + t.start + (t.end && t.end !== t.start ? " to " + t.end : "") : "") + "  (" + t.id + ")"];
  if (t.destinations.length) lines.push("  " + t.destinations.map((d) => { const i = (t.destInfo || {})[d]; return i && i.start ? d + " " + i.start + (i.end !== i.start ? " to " + i.end : "") : d; }).join(", "));
  if (v.server) lines.push("  Shared through " + v.server);
  lines.push("", "Places (" + v.places.length + ")");
  for (const p of v.places) lines.push("  " + placeLine(p));
  lines.push("", "Expenses (" + v.expenses.length + ")" + (v.totals.length ? ": " + v.totals.map((x) => money(x.total, x.currency)).join(" + ") : ""));
  for (const x of v.expenses) lines.push("  " + [x.day || "no date", money(x.amount, x.currency), x.title, "[" + x.category + "]"].join("  ") + "  (" + x.id + ")");
  if (v.people.length) {
    lines.push("", "People (" + v.people.length + ")" + (t.share ? ": everyone " + (t.share.role === "viewer" ? "can view" : "can edit") + (t.share.hide.length ? ", doesn't see " + t.share.hide.join(", ") : "") : ""));
    for (const p of v.people) lines.push("  " + (p.name || "Someone") + "  " + p.role + (p.hidden.length ? ", doesn't see " + p.hidden.join(", ") : "") + "  (" + p.id + ")");
  }
  lines.push("", "Attachments (" + v.files.length + ")");
  for (const f of v.files) lines.push("  " + f.name + "  " + (f.kind === "link" ? f.url : f.kind === "note" ? "note, " + f.text.length + " characters" : Math.max(1, Math.round(f.size / 1000)) + " KB") + "  (" + f.id + ")");
  return lines.join("\n");
}
const done = (x) => (x.deleted ? "Deleted " + x.deleted + "." + (x.movedToOther ? " " + x.movedToOther + " places are in Other now." : "")
  : x.everyone ? x.trip + ": everyone " + (x.everyone.role === "viewer" ? "can view" : "can edit") + (x.everyone.hide.length ? ", doesn't see " + x.everyone.hide.join(", ") : "")
  : x.access ? x.trip + ": " + x.person + " " + x.access.role + (x.access.hide.length ? ", doesn't see " + x.access.hide.join(", ") : "")
  : x.removed ? "Removed " + x.removed + " from " + x.trip + "."
  : x.added != null && x.tripId ? "Added " + x.added + " places to " + x.trip + (x.skipped ? " (" + x.skipped + " already there)" : "") + "."
  : x.added != null ? "Restored " + (x.added + x.replaced) + " trips (" + x.replaced + " replaced): " + x.trips.join(", ") + "."
  : x.cover !== undefined ? x.trip + ": " + (x.cover ? "cover set." : "cover removed.")
  : x.categories ? "Categories are back to the defaults." + (x.movedToOther ? " " + x.movedToOther + " places are in Other now." : "")
  : "Done: " + (x.name || x.title) + " (" + x.id + ")");

const TOOLS = [
  // ---------- Reading ----------
  { tool: "list_trips", cmd: "trips", kind: "read", query: "listTrips", args: [],
    description: "Every trip, in Home's order (under way, upcoming, undated, past): id, name, dates, destinations, status and how many places.",
    print: (l) => l.map((t) => t.name + (t.start ? "  " + t.start : "") + "  " + t.places + " places  (" + t.id + ")").join("\n") || "No trips yet." },
  { tool: "get_trip", cmd: "show", kind: "read", query: "getTrip", args: [tripArg],
    description: "One trip in full: its places (by day), the names of the categories they use, its days, expenses with totals per currency and per category, its people (and, when it is shared, which sharing server it is on) and Attachments: files (names only), links (with their address) and notes (with their text).",
    print: printTrip },
  { tool: "find_places", cmd: "places", kind: "read", query: "findPlaces",
    description: "A trip's places that match every filter given. With near, nearest first, with km.",
    args: [tripArg,
      ["day", { type: "string", description: "YYYY-MM-DD (places on that day, multi-day ones too), or \"none\" for undated." }],
      ["category", { type: "string", description: "A category's id or name." }],
      ["importance", { type: "array", items: { type: "string", enum: M.IMPORTANCE.map((c) => c[0]) } }],
      ["visited", { type: "boolean" }],
      ["kind", { type: "string", enum: ["place", "journey"], description: "Only journeys (flights, trains) or only places." }],
      ["rating", { type: "array", items: { type: "number", enum: [0, 1, 2, 3, 4, 5] }, description: "Only places with one of these ratings; 0 in the list means not rated." }],
      ["located", { type: "boolean", description: "true: only places with a location; false: only those without." }],
      ["text", { type: "string", description: "In the name, note or address." }],
      ["near", { type: "string", description: "\"lat,lng\", or a place's name or id." }],
      ["limit", { type: "number" }]],
    print: (l) => l.map(placeLine).join("\n") || "No places match." },
  { tool: "get_board", cmd: "board", kind: "read", query: "getBoard",
    description: "The trip's board as the app groups it: sort time (each day by morning, afternoon, evening, any time, then No date; once a destination has dates, each run of its days starts with a destination heading and, the first time, an anyDay group of its places with no day, and No date has parts by destination), category, importance, rating (5 stars down to 1, then Not rated), distance (from near), or area: one group a destination in date order (kind area: dest, start, end, stays, places, and side, the destinations whose dates sit inside it, like a day trip from a city), destinations without dates after, kind travel for journeys outside every destination's dates, then No destination.",
    args: [tripArg, ["sort", { type: "string", enum: ["time", "area", "category", "importance", "rating", "distance"] }],
      ["only", { type: "array", items: { type: "string", enum: M.IMPORTANCE.map((c) => c[0]) }, description: "The importance levels shown; all when empty." }],
      ["near", { type: "string", description: "For distance: \"lat,lng\", or a place's name or id." }]],
    print: (gs) => gs.map((g) => g.kind === "destination" ? "== " + g.title + (g.again ? " (again)" : "") + "  " + g.start + (g.end !== g.start ? " to " + g.end : "")
      : g.title + (g.dayNumber ? "  (day " + g.dayNumber + ")" : "") + "\n" + (g.slots ? g.slots.map((s) => "  " + s.title + "\n" + s.places.map((p) => "    " + placeLine(p)).join("\n")).join("\n")
        : g.parts ? g.parts.map((x) => "  " + (x.destination || "No destination") + "\n" + x.places.map((p) => "    " + placeLine(p)).join("\n")).join("\n")
        : g.places.map((p) => "  " + placeLine(p)).join("\n"))).join("\n\n") },
  { tool: "get_day", cmd: "day", kind: "read", query: "getDay",
    description: "One day as the Today view shows it: the plan in order, a guessed time from the place before (straight line, not a route; after a journey, from where it arrives), a change between two journeys (change: where and how many minutes), overnight journeys landing that day (arrivals), the next place not yet visited, and that day's expenses. The day defaults to today. status is the trip's against today (now, upcoming, past, undated); when is the day's (past, today, upcoming).",
    args: [tripArg, ["day", day, { pos: 1 }]],
    print: (d) => [d.trip + "  " + d.day + (d.dayNumber ? "  day " + d.dayNumber : "") + (d.destination ? "  in " + d.destination : ""), ...d.arrivals.map((j) => "  lands " + (j.arriveTime || "") + "  " + j.mode + " " + (j.number || "") + " " + j.name + " → " + (j.toName || "?")),
      ...d.plan.map((p) => (p.change ? "    change at " + p.change.at + ", " + p.change.min + " min\n" : "") + (p.fromPrevious ? "    ~" + p.fromPrevious.min + " min " + p.fromPrevious.mode + "\n" : "") + "  " + (d.next && d.next.id === p.id ? "> " : "  ") + placeLine(p)), d.plan.length ? "" : "  Nothing planned.",
      ...(d.totals.length ? ["Spent: " + d.totals.map((x) => money(x.total, x.currency)).join(" + ")] : [])].filter((x) => x !== "").join("\n") },
  { tool: "get_weather", cmd: "weather", kind: "read",
    description: "The weather forecast for a trip's days, as the app shows it on Today and the Plan, from Open-Meteo: per day the kind (clear, partly, cloudy, fog, drizzle, rain, snow, storm), high and low in °C, chance of rain in %, sunrise and sunset (local time). Only today to 15 days ahead has a forecast; other days are listed under noForecast. Sends each day's rough location (2 decimals, about 1 km) and the dates to Open-Meteo.",
    args: [tripArg, ["day", { ...day, description: "Only this day (YYYY-MM-DD)." }, { pos: 1 }]],
    run: async (st, a, env) => {
      const t = core.findTrip(st.doc, a.trip);
      if (a.day && !M.isDay(a.day)) throw new Error("A day is YYYY-MM-DD.");
      const places = st.doc.places.filter((p) => p.trip === t.id);
      const fetchFn = (url, init) => (env.fetch || globalThis.fetch)(url, { ...init, headers: { ...(init && init.headers), "User-Agent": "Tripboard-CLI (https://github.com/danielnoam/Tripboard)" } });
      const f = await WX.forecast(t, places, { today: core.today(), fetchFn, force: true });
      const days = Object.keys(WX.points(t, places)).filter((d) => !a.day || d === a.day);
      const got = (f && f.days) || {};
      return { trip: t.name, source: "Open-Meteo.com (CC BY 4.0)", unit: "celsius",
        days: days.filter((d) => got[d]).map((d) => ({ day: d, dayNumber: M.dayIndex(t, d), ...got[d] })),
        noForecast: days.filter((d) => !got[d]),
        ...(days.length ? {} : { note: a.day ? "That day isn't one of the trip's days, or no place in the trip has a location." : "No place in this trip has a location yet, so there's nowhere to forecast." }) };
    },
    print: (r) => [r.trip + "  weather from " + r.source,
      ...r.days.map((w) => "  " + w.day + (w.dayNumber ? "  day " + w.dayNumber : "") + "  " + w.kind + "  " + w.max + "°/" + w.min + "°C" + (w.rain != null ? "  rain " + w.rain + "%" : "") + (w.sunrise ? "  sun " + w.sunrise + "–" + w.sunset : "")),
      r.noForecast.length ? "  No forecast yet (more than 15 days off, or past): " + r.noForecast.join(", ") : "", r.note ? "  " + r.note : ""].filter(Boolean).join("\n") },
  { tool: "list_categories", cmd: "categories", kind: "read", query: "listCategories", args: [],
    description: "Your place categories, in order, one list for all trips: id, name, whether it's built in, and how many places use it.",
    print: (l) => l.map((c) => c.position + ". " + c.name + "  " + c.places + " places  (" + c.id + ")").join("\n") },
  { tool: "get_file", cmd: "file", kind: "read", query: "getFile",
    description: "A file kept with a trip: its record and contents (text, or base64 for other kinds). " + FILES_OFF + " A link's or note's record (with its address or text) always comes.",
    args: [tripArg, ["file", { type: "string", description: "The file's id or name." }, { req: true, pos: 1 }],
      ["out", { type: "string", description: "Where to save it; without it a text file is printed." }, { mcp: false }]],
    mcp: (r, a, env) => {
      if (!M.hasBytes(r.file)) return { file: r.file };
      if (!filesOk(env)) throw new Error(FILES_OFF);
      if (!r.bytes) return { file: r.file, missing: "Its bytes aren't in the sync repo yet (the device that added it hasn't synced)." };
      const b = Buffer.from(r.bytes);
      if (b.length > 5 * 1024 * 1024) throw new Error("That file is over 5 MB; save it with the CLI instead.");
      return core.isText(r.file.type) ? { file: r.file, text: b.toString("utf8") } : { file: r.file, base64: b.toString("base64") };
    },
    cli: (r, a) => {
      if (r.file.kind === "link") return r.file.name + "\n" + r.file.url + (r.file.note ? "\n\n" + r.file.note : "");
      if (r.file.kind === "note") return r.file.name + "\n\n" + r.file.text;
      if (!r.bytes) return "Its bytes aren't in the sync repo yet.";
      if (a.out) { fs().writeFileSync(a.out, r.bytes); return "Saved " + r.file.name + " to " + a.out + "."; }
      if (core.isText(r.file.type)) return Buffer.from(r.bytes).toString("utf8");
      throw new Error(r.file.name + " isn't text. Give --out to save it.");
    } },
  { tool: "export_backup", cmd: "export", kind: "read", query: "exportBackup",
    description: "A backup like the app's Save a backup (Settings › Data), which Restore takes back. All trips, or the ones named. Over MCP its covers and files' bytes come only with withBytes and TRIPBOARD_MCP_FILES=1.",
    args: [["trips", { type: "array", items: { type: "string" }, description: "Trip ids or names; all when left out. The CLI takes them comma-separated." }],
      ["withBytes", { type: "boolean" }, { cli: false }],
      ["out", { type: "string", description: "The file to write; tripboard-<date>.json by default." }, { mcp: false }]],
    before: (a, via, env) => ({ ...a, bytes: via === "cli" ? true : !!a.withBytes && filesOk(env) }),
    cli: (data, a) => {
      const out = a.out || (data.trips.length === 1 ? data.trips[0].name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "trips" : "tripboard") + "-" + core.today() + ".json";
      fs().writeFileSync(out, JSON.stringify(data, null, 1));
      return "Saved " + data.trips.length + " trips to " + out + ".";
    } },
  { tool: "find_location", cmd: "locate", kind: "read",
    description: "Where a place is, by name, from OpenStreetMap (as the app's Find by name): up to 6 matches with address, lat, lng and a category guess. Sends the name (and the trip's area) to OpenStreetMap. Then set lat, lng and address with update_place.",
    args: [["query", { type: "string", description: "The place's name, with the city helps." }, { req: true, pos: 0 }],
      ["trip", { type: "string", description: "A trip whose located places say which area to look in." }]],
    run: async (st, a, env) => {
      const near = a.trip ? st.doc.places.filter((p) => p.trip === core.findTrip(st.doc, a.trip).id && p.lat != null) : [];
      const fetchFn = (url, init) => (env.fetch || globalThis.fetch)(url, { ...init, headers: { ...(init && init.headers), "User-Agent": "Tripboard-CLI (https://github.com/danielnoam/Tripboard)" } });
      return PL.providers.osm.search(a.query, { near, fetchFn });
    },
    print: (l) => l.map((r) => r.name + "  " + r.lat.toFixed(5) + ", " + r.lng.toFixed(5) + (r.category ? "  [" + r.category + "]" : "") + "\n  " + (r.address || "")).join("\n") || "Nothing found." },

  // ---------- Trips ----------
  { tool: "create_trip", cmd: "new-trip", kind: "write", op: "createTrip", args: tripFields.map((f, i) => (i ? f : [f[0], f[1], { req: true }])),
    description: "Make a trip. You're its owner." },
  { tool: "update_trip", cmd: "edit-trip", kind: "write", op: "updateTrip", args: [tripArg, ...tripFields,
    ["datesFromStays", { type: "boolean", description: "Give each destination the dates of the stays near it (first stay's day to the last one's end), as the app's Dates from your stays. Destinations need lat and lng." }]],
    description: "Change a trip's name, dates or destinations, and each destination's own dates and location (destInfo, or datesFromStays); an empty date clears it." },
  { tool: "delete_trip", cmd: "delete-trip", kind: "write", op: "deleteTrip", args: [tripArg],
    description: "Delete a trip with its places, expenses, files and cover. Ask the person first." },
  { tool: "set_trip_cover", cmd: "cover", kind: "write", op: "setCover", input: "bytes",
    description: "Set a trip's cover: a photo (JPEG, PNG or WebP, up to 5 MB; the app shrinks its own, this keeps it as given), or one of the app's drawings by name (art), or remove it.",
    args: [tripArg, ...bytesArgs.filter(([n]) => n !== "text"), ["art", { type: "string", enum: M.COVER_ART, description: "A drawn cover instead of a photo." }], ["remove", { type: "boolean" }]] },

  // ---------- Places ----------
  { tool: "add_place", cmd: "add-place", kind: "write", op: "addPlace", args: [tripArg, ...placeFields.map((f, i) => (i ? f : [f[0], f[1], { req: true }]))],
    description: "Add a place to a trip. Give a day (and time) to plan it, or leave it undated. find_location finds lat and lng." },
  { tool: "update_place", cmd: "edit-place", kind: "write", op: "updatePlace", args: [tripArg, placeArg(true), ...placeFields],
    description: "Change a place's fields (including visited); an empty string clears one." },
  { tool: "order_day", cmd: "order-day", kind: "write", op: "orderDay",
    description: "Put a day's places in order, as the Today view and the map's route follow it: the places given get order 1, 2, 3…, and the day's other places follow in their current order. Places with a time still go by their time first. A place over several days (a stay) has one order on all its days.",
    args: [tripArg, ["day", { ...day }, { req: true, pos: 1 }],
      ["places", { type: "array", items: { type: "string" }, description: "The places' ids or names, first to last. The CLI takes them comma-separated." }, { req: true }]],
    print: (r) => [r.trip + "  " + r.day, ...r.plan.map((p) => "  " + p.order + ". " + (p.time ? p.time + "  " : "") + p.name), r.note ? r.note : ""].filter(Boolean).join("\n") },
  { tool: "delete_place", cmd: "delete-place", kind: "write", op: "deletePlace", args: [tripArg, placeArg(true)],
    description: "Delete a place from a trip." },
  { tool: "import_places", cmd: "import", kind: "write", op: "importPlaces", input: "bytes",
    description: "Import a Google Maps list into a trip, or with no trip into a new one named after the list: its shared link (maps.app.goo.gl/…), or a file (Takeout CSV, My Maps KML, Saved Places JSON). Names already in the trip are skipped. Places without a location stay unlocated: find_location finds them. A link is read through Tripboard's server, which sees the link and the list's places; Google can change what it reads at any time, and then the file is the way.",
    args: [["trip", { type: "string", description: "The trip's id or name; leave out to make a new trip." }, { pos: 0 }],
      ["link", { type: "string", description: "A shared Google Maps list's link, instead of a file." }], ...bytesArgs,
      ["fileName", { type: "string", description: "The export's file name (its ending says the format; a CSV's name is the list's)." }, { mcp: true, cli: false }],
      ["name", { type: "string", description: "The new trip's name, instead of the list's." }]],
    before: async (a, via, env) => {
      if (!a.link) return a;
      if (a.bytes) throw new Error("Give a link or a file, not both.");
      return { ...a, list: await googleList(a.link, env) };
    } },

  // ---------- Expenses ----------
  { tool: "add_expense", cmd: "add-expense", kind: "write", op: "addExpense", args: [tripArg, ...expenseFields.map((f) => (f[0] === "amount" || f[0] === "currency" ? [f[0], f[1], { req: true }] : f))],
    description: "Add an expense to a trip." },
  { tool: "update_expense", cmd: "edit-expense", kind: "write", op: "updateExpense", args: [tripArg, ["expense", { type: "string", description: "The expense's id or title." }, { req: true, pos: 1 }], ...expenseFields],
    description: "Change an expense; an empty string clears day, place, note or paidBy." },
  { tool: "delete_expense", cmd: "delete-expense", kind: "write", op: "deleteExpense", args: [tripArg, ["expense", { type: "string" }, { req: true, pos: 1 }]],
    description: "Delete an expense from a trip." },

  // ---------- Files ----------
  { tool: "add_file", cmd: "add-file", kind: "write", op: "addFile", input: "bytes",
    description: "Keep a file with a trip (a ticket, a booking), up to " + M.MAX_FILE_MB + " MB. It syncs to the person's devices like one added in the app.",
    args: [tripArg, ...bytesArgs, ...fileFields, ["type", { type: "string", description: "Its MIME type; guessed from its name when left out." }]] },
  { tool: "add_link", cmd: "add-link", kind: "write", op: "addLink",
    description: "Keep a link in a trip's Attachments (an IC card guide, a pass calculator, a booking page). http and https only; a bare address gets https://. Its name is the site's when left out.",
    args: [tripArg, ["url", { type: "string", description: "The web address." }, { req: true, pos: 1 }], ...fileFields] },
  { tool: "add_note", cmd: "add-note", kind: "write", op: "addNote",
    description: "Keep a note in a trip's Attachments: a title and plain text, up to " + M.MAX_NOTE + " characters (a phrasebook, directions, door codes).",
    args: [tripArg, ["name", { type: "string", description: "The note's title." }], ["text", { type: "string", description: "The note itself; new lines are kept." }, { req: true }],
      ["place", fileFields[1][1]]] },
  { tool: "update_file", cmd: "edit-file", kind: "write", op: "updateFile", args: [tripArg, ["file", { type: "string", description: "The file's, link's or note's id or name." }, { req: true, pos: 1 }], ...fileFields,
    ["url", { type: "string", description: "A link's new web address." }], ["text", { type: "string", description: "A note's new text (all of it)." }]],
    description: "Rename a file, link or note, change its note, the place it belongs to, a link's address or a note's text." },
  { tool: "delete_file", cmd: "delete-file", kind: "write", op: "deleteFile", args: [tripArg, ["file", { type: "string" }, { req: true, pos: 1 }]],
    description: "Delete a file, link or note from a trip, and a file's bytes from the sync repo (git history keeps them)." },

  // ---------- People ----------
  { tool: "update_sharing", cmd: "share", kind: "write", op: "updateSharing",
    description: "Who on a shared trip may edit, and who doesn't see expenses or files. With no person it sets what everyone gets; with a person, their own setting (\"default\" goes back to everyone's). The app follows these; they aren't a lock, since the sync repo holds the whole trip. get_trip lists the people.",
    args: [tripArg, ["person", { type: "string", description: "A person's id or name on the trip. Leave out for everyone." }, { pos: 1 }],
      ["role", { type: "string", enum: ["editor", "viewer", "default"] }],
      ["hide", { type: "array", items: { type: "string", enum: M.SECTIONS }, description: "The sections they don't see; [] shows all. The CLI takes them comma-separated, \"\" for none, or default." }],
      ["sameAsEveryone", { type: "boolean", description: "With a person: what they see goes back to everyone's." }, { cli: false }]],
    before: (a) => ({ ...a, hide: a.sameAsEveryone ? "default" : a.hide }) },
  { tool: "remove_person", cmd: "remove-person", kind: "write", op: "removePerson", args: [tripArg, ["person", people, { req: true, pos: 1 }]],
    description: "Take someone off a shared trip (owner only). The sharing server ends their access at the next sync. Ask the person first." },

  // ---------- Categories ----------
  { tool: "add_category", cmd: "add-category", kind: "write", op: "addCategory", args: [["name", { type: "string" }, { req: true, pos: 0 }]],
    description: "Add a place category to your list (before Other). It syncs to your devices." },
  { tool: "update_category", cmd: "edit-category", kind: "write", op: "updateCategory",
    args: [["category", { type: "string", description: "Its id or name." }, { req: true, pos: 0 }], ["name", { type: "string" }], ["position", { type: "number", description: "Its place in the list, from 1." }]],
    description: "Rename a category or move it in the list." },
  { tool: "delete_category", cmd: "delete-category", kind: "write", op: "deleteCategory", args: [["category", { type: "string", description: "Its id or name." }, { req: true, pos: 0 }]],
    description: "Remove a category; its places in every trip move to Other. Ask the person first." },
  { tool: "reset_categories", cmd: "reset-categories", kind: "write", op: "resetCategories", args: [],
    description: "Back to the built-in categories; places in your own ones move to Other. Ask the person first." },

  // ---------- Several at once ----------
  { tool: "batch_update", cmd: "batch", kind: "write", op: "batch",
    description: "Make many changes in one go (one commit, one round trip): up to " + MAX_STEPS + " steps, each a write tool's name and its arguments, run in order, so a step can name a place an earlier step added. If any step fails, nothing is changed. Takes the write tools that add or change (add_place, update_place, order_day, create_trip, add_expense, …), not the ones that delete, remove or restore. With trip, every step that takes a trip and doesn't give one uses it. Gives back each step's answer in order.",
    args: [["steps", { type: "array", items: { type: "object", properties: { tool: { type: "string", description: "A write tool's name, like update_place." }, args: { type: "object", description: "That tool's arguments." } }, required: ["tool"] },
      description: "The changes, in order. The CLI takes them as JSON." }],
      ["trip", { type: "string", description: "The trip for every step that doesn't name one." }],
      ["path", { type: "string", description: "A JSON file with the steps, instead of --steps." }, { mcp: false }]],
    before: async (a, via, env) => {
      let steps = a.steps;
      if (via === "cli" && a.path) steps = JSON.parse(fs().readFileSync(a.path, "utf8"));
      if (!Array.isArray(steps) || !steps.length) throw new Error("batch needs steps: a list of { tool, args }.");
      if (steps.length > MAX_STEPS) throw new Error("Up to " + MAX_STEPS + " steps in one batch; split it.");
      const out = [];
      for (const [i, s] of steps.entries()) {
        const name = s && (s.tool || s.cmd);
        const t = TOOLS.find((x) => x.tool === name || x.cmd === name);
        const fail = (why) => { throw new Error("Step " + (i + 1) + " (" + name + "): " + why + " Nothing was changed."); };
        if (!t) fail("no such tool.");
        if (t.kind !== "write" || t.op === "batch") fail("only tools that add or change can be in a batch.");
        if (destructive(t)) fail("deleting, removing and restoring aren't done in a batch; use " + t.tool + " by itself.");
        const args = { ...(s.args || {}) };
        if (a.trip && args.trip === undefined && t.args.some(([k]) => k === "trip")) args.trip = a.trip;
        try { out.push({ tool: t.tool, op: t.op, args: await prep(t, args, "mcp", env) }); } catch (e) { fail(e.message || String(e)); }
      }
      return { steps: out };
    },
    print: (r) => "Done: " + r.changes + (r.changes === 1 ? " change" : " changes") + " in one commit." },

  // ---------- Backups ----------
  { tool: "import_backup", cmd: "restore", kind: "write", op: "importBackup", input: "bytes",
    description: "Restore a Tripboard backup file (from the app's Save a backup or export_backup): its trips join, replacing ones with the same id, with their covers and files. Ask the person first.",
    args: [["backup", { type: "object", description: "The backup's JSON." }, { cli: false }], ["path", bytesArgs[0][1], { mcp: false }]] },
];

// Arguments as the tool wants them: numbers, booleans and lists from the
// CLI's strings, and a file's bytes from --path or content / text.
function prep(t, a, via, env) {
  a = { ...a };
  if (via === "cli") {
    for (const [k, s] of t.args) {
      const v = a[k];
      if (v === undefined || typeof v !== "string") continue;
      if (s.type === "number") a[k] = v === "" ? "" : +v;
      else if (s.type === "boolean") a[k] = v !== "false" && v !== "" && v !== "no";
      else if (s.type === "array" && s.items && s.items.type === "object") a[k] = JSON.parse(v);
      else if (s.type === "array") a[k] = v === "" ? [] : v.split(",").map((x) => x.trim()).filter(Boolean);
    }
  }
  if (t.input === "bytes") {
    if (via === "cli" && a.path) {
      a.bytes = fs().readFileSync(a.path);
      if (a.name === undefined && t.op === "addFile") a.name = path().basename(a.path);
      a.fileName = a.fileName || path().basename(a.path);
    }
    if (via === "mcp" && a.content) a.bytes = Buffer.from(a.content, "base64");
    else if (via === "mcp" && a.text != null) a.bytes = Buffer.from(String(a.text));
  }
  for (const [k, , o = {}] of t.args) if (o.req && (a[k] === undefined || a[k] === "")) throw new Error(t.cmd + " needs " + (o.pos != null ? "<" + k + ">" : "--" + k) + ".");
  return t.before ? t.before(a, via, env) : a;
}

// Tools that delete, take someone off a trip or replace what's there. They
// work only while the app's Settings › AI tools › Let AI tools delete is on
// (ai.json in the sync repo, which no tool can change).
const destructive = (t) => /^(delete|remove|reset|import_backup)/.test(t.tool);
const OFF = "Deleting is off for AI tools. The person can turn it on in the Tripboard app: Settings › AI tools › Let AI tools delete. It can't be turned on from here.";

// Runs a tool on a connection; `via` is "cli" or "mcp". Gives the answer.
async function run(tb, t, args, via, env = {}) {
  const a = await prep(t, args, via, env);
  if (t.kind === "write") return tb.change((doc, ctx) => {
    if (destructive(t) && !(ctx.ai && ctx.ai.deleting)) throw Object.assign(new Error(OFF), { deletingOff: true });
    return core.ops[t.op](doc, a, ctx);
  }, "Tripboard " + via.toUpperCase() + ": " + (via === "cli" ? t.cmd : t.tool));
  const st = await tb.snapshot();
  const r = t.run ? await t.run(st, a, env) : await core.queries[t.query](st, a);
  return t[via] ? t[via](r, a, env) : r;
}

module.exports = { TOOLS, run, prep, printTrip, done, destructive };
