// Published trips: a read-only copy of a trip's plan that anyone with its
// link can open and copy into their own trips (the app's Sharing › Publish,
// src/share.js; the copy is model.js's publishedDoc + duplicateTrip). No
// account: publishing gives a key, kept only as a SHA-256 hash here, that
// updates or removes it. The id is random, so only people given the link
// find it; nothing lists published trips.
//
// The app sends model.js's publishedOf, already without ratings, been
// there, expenses, files, a cover photo or who is on the trip. This file
// keeps only the fields it knows again, so an older or changed app can't
// publish more.
//
//   POST   /published            { bundle, by, dates } -> { id, key }
//   GET    /published/:id        -> { bundle, by, dates, at, copies }
//   PUT    /published/:id        key; { bundle, by, dates } -> { at }
//   DELETE /published/:id        key
//   POST   /published/:id/copied -> { copies } (a count, nothing about who)

const MAX_BUNDLE = 2e6;
const PER_DAY = 30;
const TRIP = ["id", "name", "start", "end", "destinations", "destInfo", "art", "cats", "createdAt", "updatedAt"];
const PLACE = ["id", "trip", "name", "category", "importance", "note", "dest", "kind", "mode", "number", "createdAt", "updatedAt",
  "lat", "lng", "address", "placeId", "geoAt", "toLat", "toLng", "toAddress", "toPlaceId", "toGeoAt",
  "day", "endDay", "time", "endTime", "order", "arriveDay", "arriveTime"];
const FILE = ["id", "trip", "place", "name", "kind", "url", "text", "note", "type", "size", "createdAt", "updatedAt"];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));
const isId = (v) => typeof v === "string" && /^[\w-]{1,40}$/.test(v);
const now = () => new Date().toISOString();
const enc = new TextEncoder();
async function sha(text) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function secret(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const no = (status, message) => Object.assign(new Error(message), { status });

// What's kept of what was sent.
export function clean(bundle) {
  const b = bundle && typeof bundle === "object" ? bundle : {};
  if (!b.trip || typeof b.trip !== "object" || !isId(b.trip.id)) throw no(400, "A trip is needed.");
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
  const out = {
    format: 1,
    trip: pick(b.trip, TRIP),
    places: list(b.places).map((p) => pick(p, PLACE)),
    expenses: [],
    files: list(b.files).filter((f) => f.kind === "link" || f.kind === "note").map((f) => ({ ...pick(f, FILE), size: 0 })),
    deleted: {},
  };
  if (JSON.stringify(out).length > MAX_BUNDLE) throw no(413, "This trip is too big to publish.");
  return out;
}
const byName = (v) => String(v || "").trim().slice(0, 60);

// The calls, for the Worker's routes and the cloud connector's tools.
// who: the address (or connector user) a day's new ones are counted by.
export function api(env) {
  const db = env.DB;
  async function row(id) {
    if (!isId(id)) throw no(404, "This trip isn't published.");
    const r = await db.prepare("SELECT key, bundle, by, dates, copies, updated_at FROM published WHERE id = ?").bind(id).first();
    if (!r) throw no(404, "This trip isn't published any more.");
    return r;
  }
  async function owned(id, key) {
    const r = await row(id);
    if (!key || (await sha(String(key))) !== r.key) throw no(401, "This key doesn't change this published trip.");
    return r;
  }
  return {
    async create({ bundle, by, dates }, who) {
      const b = clean(bundle);
      const ip = "pub:" + (who || "?");
      const day = now().slice(0, 10);
      const c = await db.prepare("SELECT n FROM creates WHERE ip = ? AND day = ?").bind(ip, day).first();
      if (c && c.n >= PER_DAY) throw no(429, "Too many trips published today. Try tomorrow.");
      await db.prepare("INSERT INTO creates (ip, day, n) VALUES (?, ?, 1) ON CONFLICT (ip, day) DO UPDATE SET n = n + 1").bind(ip, day).run();
      const id = secret(12), key = secret(32), at = now();
      await db.prepare("INSERT INTO published (id, key, bundle, by, dates, copies, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)")
        .bind(id, await sha(key), JSON.stringify(b), byName(by), dates === false ? 0 : 1, at, at).run();
      return { id, key, at };
    },
    async get(id) {
      const r = await row(id);
      return { bundle: JSON.parse(r.bundle), by: r.by, dates: !!r.dates, at: r.updated_at, copies: r.copies };
    },
    async update(id, key, { bundle, by, dates }) {
      await owned(id, key);
      const b = clean(bundle), at = now();
      await db.prepare("UPDATE published SET bundle = ?, by = ?, dates = ?, updated_at = ? WHERE id = ?")
        .bind(JSON.stringify(b), byName(by), dates === false ? 0 : 1, at, id).run();
      return { at };
    },
    async remove(id, key) {
      await owned(id, key);
      await db.prepare("DELETE FROM published WHERE id = ?").bind(id).run();
      return { removed: true };
    },
    async copied(id) {
      await row(id);
      await db.prepare("UPDATE published SET copies = copies + 1 WHERE id = ?").bind(id).run();
      return { copies: (await row(id)).copies };
    },
  };
}
