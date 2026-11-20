// Tripboard's sharing server: a Cloudflare Worker that holds the trips
// people share, and checks who may do what. A shared trip is the same
// bundle GitHub sync uses (src/merge.js); the apps merge it the same way.
//
//   D1 (env.DB)     trips (the bundle and its version), keys, invites
//   KV (env.FILES)  file bytes, "<trip>/<file id>", and covers, "<trip>/cover"
//
// Nobody has an account. Each device that joins a trip gets its own key,
// kept only as a SHA-256 hash here, and the key says who it is. What a
// person may do comes from the trip itself: trip.share (what everyone
// gets) and their own entry in trip.members (see access() below, the same
// rule as src/model.js). The server enforces it:
//   - a viewer can't write; only the owner changes owner, members or share,
//     invites, or deletes the trip;
//   - a section someone doesn't see (expenses, files) is never sent to
//     them, and what they send for it is ignored;
//   - someone taken off trip.members loses their keys.
//
// API (JSON; "Authorization: Bearer <key>" where a key is needed):
//   POST   /trips                     { bundle, person }  -> { key, version }
//   GET    /trips/:id[?v=N]           -> { version, bundle, hidden, role } or { same: true }
//   PUT    /trips/:id                 { version, bundle } -> { version } or 409 with the current copy
//   DELETE /trips/:id                 owner: the trip, its keys and its files go
//   POST   /trips/:id/invite          owner -> { code, expires } (a new code; the old one stops)
//   DELETE /trips/:id/invite          owner: the link stops working
//   POST   /trips/:id/join            { code, person } -> { key, version, bundle, hidden, role }
//   DELETE /trips/:id/me               leave the trip
//   GET|PUT /trips/:id/files/:fileId  the bytes of a file in the trip
//   GET|PUT /trips/:id/cover          the cover photo
//   POST   /google-list               { url } -> { title, places } (googlelist.js;
//                                     unofficial, 60 a day per address)
//   /mcp, /authorize, /token, …        the cloud connector for AI apps (mcp.js)

import * as GL from "./googlelist.js";
import { handleMcp } from "./mcp.js";

const SECTIONS = ["expenses", "files"];
const MAX_BUNDLE = 2e6;
const MAX_FILE = 25e6;
const INVITE_DAYS = 14;
const CREATES_PER_DAY = 30;
const LISTS_PER_DAY = 60;
const isId = (v) => typeof v === "string" && /^[\w-]{1,40}$/.test(v);

// What a person gets on a trip: the owner everything; anyone else their
// own role and hidden sections, or else everyone's (trip.share).
export function access(trip, personId) {
  if (trip.owner === personId) return { role: "owner", hide: [] };
  const m = (trip.members || []).find((x) => x.id === personId);
  if (!m) return null;
  const d = trip.share || {};
  const role = ["editor", "viewer"].includes(m.role) ? m.role : d.role === "viewer" ? "viewer" : "editor";
  const hide = (Array.isArray(m.hide) ? m.hide : Array.isArray(d.hide) ? d.hide : []).filter((x) => SECTIONS.includes(x));
  return { role, hide };
}

const enc = new TextEncoder();
async function sha(text) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function secret() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const now = () => new Date().toISOString();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const fail = (status, message) => json({ error: message }, status);

// The bundle as one person may see it: hidden sections left out.
function view(bundle, hide) {
  const out = { ...bundle };
  for (const s of hide) delete out[s];
  return out;
}

async function readBody(req, max) {
  const len = +(req.headers.get("Content-Length") || 0);
  if (len > max) throw Object.assign(new Error("Too big."), { status: 413 });
  const buf = await req.arrayBuffer();
  if (buf.byteLength > max) throw Object.assign(new Error("Too big."), { status: 413 });
  return buf;
}
async function readJson(req) {
  try { return JSON.parse(new TextDecoder().decode(await readBody(req, MAX_BUNDLE + 1e5))); }
  catch (e) { if (e.status) throw e; throw Object.assign(new Error("Not JSON."), { status: 400 }); }
}

export async function handle(req, env) {
  const cloud = await handleMcp(req, env);
  if (cloud) return cloud;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const db = env.DB;
  try {
    if (parts[0] === "google-list" && req.method === "POST") return await googleList(req, env);
    if (parts[0] !== "trips") return fail(404, "Not here.");
    const tripId = parts[1];
    const sub = parts[2] || "";
    const m = req.method;

    if (!tripId && m === "POST") return await create(req, env);
    if (!isId(tripId)) return fail(404, "No such trip.");
    const row = await db.prepare("SELECT bundle, version, owner FROM trips WHERE id = ?").bind(tripId).first();
    if (!row) return fail(404, "No such trip.");
    const bundle = JSON.parse(row.bundle);

    if (sub === "join" && m === "POST") return await join(req, env, tripId, row, bundle);

    // Everything else needs a key for this trip.
    const auth = /^Bearer (.+)$/.exec(req.headers.get("Authorization") || "");
    const k = auth && await db.prepare("SELECT person FROM keys WHERE hash = ? AND trip = ?").bind(await sha(auth[1]), tripId).first();
    if (!k) return fail(401, "This key doesn't open this trip.");
    const who = k.person;
    const a = access(bundle.trip, who);
    if (!a) return fail(401, "You're no longer on this trip.");
    const owner = a.role === "owner";

    if (!sub && m === "GET") {
      if (url.searchParams.get("v") === String(row.version)) return json({ same: true, version: row.version });
      return json({ version: row.version, bundle: view(bundle, a.hide), hidden: a.hide, role: a.role });
    }
    if (!sub && m === "PUT") return await put(req, env, tripId, row, bundle, who, a);
    if (!sub && m === "DELETE") {
      if (!owner) return fail(403, "Only the trip's owner can delete it.");
      await dropTrip(env, tripId, bundle);
      return json({ deleted: true });
    }
    if (sub === "invite" && (m === "POST" || m === "DELETE")) {
      if (!owner) return fail(403, "Only the trip's owner can invite people.");
      await db.prepare("DELETE FROM invites WHERE trip = ?").bind(tripId).run();
      if (m === "DELETE") return json({ stopped: true });
      const code = secret().slice(0, 22);
      const expires = new Date(Date.now() + INVITE_DAYS * 864e5).toISOString();
      await db.prepare("INSERT INTO invites (trip, hash, expires) VALUES (?, ?, ?)").bind(tripId, await sha(code), expires).run();
      return json({ code, expires });
    }
    if (sub === "me" && m === "DELETE") {
      if (owner) return fail(403, "The owner can't leave; delete the trip instead.");
      bundle.trip.members = (bundle.trip.members || []).filter((x) => x.id !== who);
      bundle.trip.updatedAt = now();
      await save(env, tripId, row.version, bundle);
      await db.prepare("DELETE FROM keys WHERE trip = ? AND person = ?").bind(tripId, who).run();
      return json({ left: true });
    }
    if ((sub === "files" && isId(parts[3])) || sub === "cover") {
      const fileId = sub === "cover" ? "cover" : parts[3];
      if (sub === "files" && a.hide.includes("files")) return fail(403, "Files aren't shared with you on this trip.");
      const key = tripId + "/" + fileId;
      if (m === "GET") {
        const bytes = await env.FILES.get(key, "arrayBuffer");
        if (!bytes) return fail(404, "Not uploaded yet.");
        return new Response(bytes, { headers: { ...CORS, "Content-Type": "application/octet-stream", "Cache-Control": "private, max-age=31536000, immutable" } });
      }
      if (m === "PUT") {
        if (a.role === "viewer") return fail(403, "You can only view this trip.");
        if (sub === "files" && !(bundle.files || []).some((f) => f.id === fileId)) return fail(409, "Send the file's record first.");
        await env.FILES.put(key, await readBody(req, MAX_FILE));
        return json({ ok: true });
      }
    }
    return fail(404, "Not here.");
  } catch (e) {
    if (e.status) return fail(e.status, e.message);
    return fail(500, "Something went wrong on the server.");
  }
}

async function googleList(req, env) {
  const { url } = await readJson(req);
  const ip = "list:" + (req.headers.get("CF-Connecting-IP") || "?");
  const day = now().slice(0, 10);
  const c = await env.DB.prepare("SELECT n FROM creates WHERE ip = ? AND day = ?").bind(ip, day).first();
  if (c && c.n >= LISTS_PER_DAY) return fail(429, "Too many lists today. Try tomorrow.");
  await env.DB.prepare("INSERT INTO creates (ip, day, n) VALUES (?, ?, 1) ON CONFLICT (ip, day) DO UPDATE SET n = n + 1").bind(ip, day).run();
  return json(await GL.places(String(url || ""), env.FETCH || fetch));
}

async function create(req, env) {
  const { bundle, person } = await readJson(req);
  if (!bundle || !bundle.trip || !isId(bundle.trip.id) || !person || !isId(person.id)) return fail(400, "A trip and a person are needed.");
  if (JSON.stringify(bundle).length > MAX_BUNDLE) return fail(413, "This trip is too big to share.");
  const ip = req.headers.get("CF-Connecting-IP") || "?";
  const day = now().slice(0, 10);
  const c = await env.DB.prepare("SELECT n FROM creates WHERE ip = ? AND day = ?").bind(ip, day).first();
  if (c && c.n >= CREATES_PER_DAY) return fail(429, "Too many trips shared today. Try tomorrow.");
  await env.DB.prepare("INSERT INTO creates (ip, day, n) VALUES (?, ?, 1) ON CONFLICT (ip, day) DO UPDATE SET n = n + 1").bind(ip, day).run();
  if (await env.DB.prepare("SELECT 1 AS x FROM trips WHERE id = ?").bind(bundle.trip.id).first()) return fail(409, "This trip is already shared.");
  // Whoever shares it owns the shared copy.
  const trip = bundle.trip;
  trip.owner = person.id;
  trip.members = [{ id: person.id, name: String(person.name || "").slice(0, 60), role: "owner" }]
    .concat((trip.members || []).filter((x) => x && isId(x.id) && x.id !== person.id));
  const key = secret();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO trips (id, bundle, version, owner, updated_at) VALUES (?, ?, 1, ?, ?)").bind(trip.id, JSON.stringify(bundle), person.id, now()),
    env.DB.prepare("INSERT INTO keys (hash, trip, person, created_at) VALUES (?, ?, ?, ?)").bind(await sha(key), trip.id, person.id, now()),
  ]);
  return json({ key, version: 1 }, 201);
}

async function join(req, env, tripId, row, bundle) {
  const { code, person } = await readJson(req);
  if (!code || !person || !isId(person.id)) return fail(400, "An invite code and a person are needed.");
  const inv = await env.DB.prepare("SELECT expires FROM invites WHERE trip = ? AND hash = ?").bind(tripId, await sha(String(code))).first();
  if (!inv || inv.expires < now()) return fail(403, "This invite link doesn't work any more. Ask for a new one.");
  // An id that already holds a key here belongs to someone else (or to
  // another device of theirs), so a link can't be used to become them.
  if (person.id === row.owner || await env.DB.prepare("SELECT 1 AS x FROM keys WHERE trip = ? AND person = ?").bind(tripId, person.id).first()) {
    return fail(409, "Someone with this id is already on the trip.");
  }
  const members = bundle.trip.members || [];
  const name = String(person.name || "").slice(0, 60);
  const m = members.find((x) => x.id === person.id);
  if (m) m.name = name || m.name; else members.push({ id: person.id, name });
  bundle.trip.members = members;
  bundle.trip.updatedAt = now();
  const version = await save(env, tripId, row.version, bundle);
  const key = secret();
  await env.DB.prepare("INSERT INTO keys (hash, trip, person, created_at) VALUES (?, ?, ?, ?)").bind(await sha(key), tripId, person.id, now()).run();
  const a = access(bundle.trip, person.id);
  return json({ key, version, bundle: view(bundle, a.hide), hidden: a.hide, role: a.role });
}

async function put(req, env, tripId, row, bundle, who, a) {
  const body = await readJson(req);
  if (a.role === "viewer") return fail(403, "You can only view this trip.");
  if (body.version !== row.version) return json({ version: row.version, bundle: view(bundle, a.hide), hidden: a.hide, role: a.role }, 409);
  const next = body.bundle;
  if (!next || !next.trip || next.trip.id !== tripId) return fail(400, "That's not this trip.");
  if (JSON.stringify(next).length > MAX_BUNDLE) return fail(413, "This trip is too big to share.");
  if (next.trip.deletedAt) {
    if (a.role !== "owner") return fail(403, "Only the trip's owner can delete it.");
    await dropTrip(env, tripId, bundle);
    return json({ deleted: true });
  }
  // What only the owner may change, and what this person doesn't see,
  // stay as the server has them.
  const t = next.trip;
  t.owner = bundle.trip.owner;
  if (a.role !== "owner") { t.members = bundle.trip.members; t.share = bundle.trip.share; if (t.share === undefined) delete t.share; }
  const ownerEntry = (bundle.trip.members || []).find((x) => x.id === t.owner);
  t.members = Array.isArray(t.members) ? t.members.filter((x) => x && isId(x.id) && x.id !== t.owner) : [];
  if (ownerEntry) t.members.unshift(ownerEntry);
  for (const s of a.hide) next[s] = bundle[s];
  const version = await save(env, tripId, row.version, next);
  // Whoever left the list loses their keys; deleted files lose their bytes.
  const still = new Set(t.members.map((x) => x.id));
  const gone = (bundle.trip.members || []).filter((x) => !still.has(x.id)).map((x) => x.id);
  for (const id of gone) await env.DB.prepare("DELETE FROM keys WHERE trip = ? AND person = ?").bind(tripId, id).run();
  const live = new Set((next.files || []).map((f) => f.id));
  for (const f of bundle.files || []) if (!live.has(f.id)) await env.FILES.delete(tripId + "/" + f.id);
  return json({ version });
}

// Saves only over the version it read, so two writes can't both win.
async function save(env, tripId, version, bundle) {
  const r = await env.DB.prepare("UPDATE trips SET bundle = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
    .bind(JSON.stringify(bundle), now(), tripId, version).run();
  if (!r.meta || !r.meta.changes) throw Object.assign(new Error("Someone changed the trip at the same moment. Try again."), { status: 409 });
  return version + 1;
}

async function dropTrip(env, tripId, bundle) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM trips WHERE id = ?").bind(tripId),
    env.DB.prepare("DELETE FROM keys WHERE trip = ?").bind(tripId),
    env.DB.prepare("DELETE FROM invites WHERE trip = ?").bind(tripId),
  ]);
  for (const f of bundle.files || []) await env.FILES.delete(tripId + "/" + f.id);
  await env.FILES.delete(tripId + "/cover");
}

export default { fetch: (req, env) => handle(req, env) };
