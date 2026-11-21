// The trips in a GitHub sync repo, read and changed from Node, for the CLI
// (cli/tripboard.js) and the MCP server (cli/mcp.js), whose commands both
// come from cli/tools.js. It acts as one more device: it reads every
// trip's bundle (and me.json, categories.json), changes the doc, stamps
// what changed (updatedAt, by, tombstones) with the app's own model.js,
// and writes what differs in one commit: trip bundles, categories.json,
// covers/<trip>.jpg and files/<trip>/<file>. The apps then merge that like
// any other device's change. No dependencies: Node 18+ and the app's files.
//
//   const tb = require("./core").open({ token, repo: "owner/name", branch });
//   const doc = await tb.read();
//   const out = await tb.change((doc, ctx) => { ...; return result; });
globalThis.window = globalThis.window || globalThis;
require("../src/keel/github.js");
const M = require("../src/model.js");
const G = require("../src/merge.js");
const LI = require("../src/listimport.js");
const K = globalThis.Keel;

const empty = () => ({ trips: [], places: [], expenses: [], files: [], deleted: {} });
const text = (b) => JSON.stringify(b, null, 1);
const clone = (x) => JSON.parse(JSON.stringify(x));

function open({ token, repo, branch, fetch } = {}) {
  const [owner, name] = String(repo || "").split("/");
  if (!token) throw new Error("No token: set TRIPBOARD_TOKEN to a fine-grained token for the sync repo (Contents: read and write).");
  if (!owner || !name) throw new Error("No repo: set TRIPBOARD_REPO to owner/name, the repo GitHub sync uses.");
  const cfg = { token, owner, repo: name, branch: branch || "" };
  const gh = K.github.client(() => cfg, fetch ? { fetch } : {});

  async function whichBranch() {
    if (cfg.branch) return cfg.branch;
    const info = await gh.repoInfo();
    if (!info) { const e = new Error("GitHub can't find " + repo + " with this token."); e.status = 404; throw e; }
    return (cfg.branch = info.default_branch || "main");
  }

  // The repo as one doc, the head it was read at, every path in it, your
  // person id (me.json) and your categories (categories.json).
  async function load() {
    const branch = await whichBranch();
    const head = await gh.json("GET", "git/ref/heads/" + encodeURIComponent(branch));
    if (!head) return { doc: empty(), head: null, bundles: {}, paths: new Map(), me: null, cats: null };
    const tree = await gh.json("GET", "git/trees/" + head.object.sha + "?recursive=1");
    const paths = new Map((tree.tree || []).filter((f) => f.type !== "tree").map((f) => [f.path, f.sha]));
    const ids = [...paths.keys()].map((p) => (/^trips\/([\w-]+)\.json$/.exec(p) || [])[1]).filter(Boolean);
    let doc = empty();
    const bundles = {};
    for (const id of ids) {
      const got = await gh.getJson("trips/" + id + ".json", { ref: head.object.sha });
      if (!got) continue;
      bundles[id] = got.data;
      doc = G.applyBundle(doc, got.data);
    }
    const json = async (p) => (paths.has(p) ? ((await gh.getJson(p, { ref: head.object.sha })) || {}).data : null);
    const meData = await json("me.json");
    const me = meData && M.isCatId(meData.id) ? meData.id : null;
    const c = await json("categories.json");
    const cats = c && Array.isArray(c.list) && typeof c.at === "string" ? c : null;
    return { doc: M.sanitizeDoc(doc), head: head.object.sha, bundles, paths, me, cats };
  }

  async function read() { return (await load()).doc; }
  // Everything a read-only command may want: the doc, your id, your
  // categories, the repo's paths, and a way to fetch a file's bytes.
  async function snapshot() {
    const st = await load();
    return { ...st, raw: (path) => gh.getRaw(path, { ref: st.head, as: "bytes" }) };
  }

  // fn(doc, ctx) changes the doc in place and gives a result. ctx: me,
  // cats, setCats(list), put(path, bytes), drop(path), raw(path). Retried
  // on a fresh read if the repo moved meanwhile.
  async function change(fn, message) {
    for (let n = 1; ; n++) {
      const st = await load();
      const { doc, head, bundles } = st;
      const before = clone(doc);
      const puts = new Map(), drops = new Set();
      const ctx = {
        me: st.me, cats: st.cats, paths: st.paths, catsChanged: false,
        setCats(list) { ctx.cats = { list, at: new Date().toISOString() }; ctx.catsChanged = true; },
        put(path, bytes) { puts.set(path, bytes); drops.delete(path); },
        drop(path) { puts.delete(path); if (st.paths.has(path)) drops.add(path); },
        raw: (path) => gh.getRaw(path, { ref: head, as: "bytes" }),
      };
      const result = await fn(doc, ctx);
      const clean = M.sanitizeDoc(doc);
      // Trip names for your own categories, as the app carries them; never
      // on a trip you may only view.
      const carried = M.carryCats(clean, M.catList(ctx.cats ? ctx.cats.list : null));
      carried.trips = carried.trips.map((t, i) => (mayEdit(before, t.id, st.me) ? t : clean.trips[i]));
      const next = M.stamp(before, carried, undefined, st.me);
      const writes = [];
      for (const id of new Set(G.tripIds(next).concat(Object.keys(bundles)))) {
        const b = G.bundleOf(next, id);
        if (!b || JSON.stringify(b) === JSON.stringify(bundles[id])) continue;
        guard(before, next, id, st.me);
        writes.push({ path: "trips/" + id + ".json", text: text(b) });
      }
      // What a deletion leaves behind in the repo goes with it.
      for (const [id, t] of Object.entries(next.deleted)) {
        if (before.deleted[id]) continue;
        if (t.trip === id) { ctx.drop("covers/" + id + ".jpg"); for (const p of st.paths.keys()) if (p.startsWith("files/" + id + "/")) ctx.drop(p); }
        else ctx.drop("files/" + t.trip + "/" + id);
      }
      if (ctx.catsChanged) writes.push({ path: "categories.json", text: text(ctx.cats) });
      for (const p of drops) writes.push({ path: p, sha: null });
      if (!writes.length && !puts.size) return result;
      try {
        for (const [p, bytes] of puts) writes.push({ path: p, sha: await gh.createBlob(new Uint8Array(bytes)) });
        await gh.commitFiles(writes, message || "Tripboard CLI: " + writes.length + (writes.length === 1 ? " file" : " files"), {
          branch: cfg.branch,
          root: async () => [],
          tries: 1,
          beforeTry: async () => {
            const now = await gh.json("GET", "git/ref/heads/" + encodeURIComponent(cfg.branch));
            if ((now && now.object.sha) !== head) { const e = new Error("moved"); e.moved = true; throw e; }
          },
        });
        return result;
      } catch (e) {
        if (!(e.moved || e.status === 422) || n >= 4) throw e;
      }
    }
  }

  return { read, snapshot, change, gh };
}

// The app's roles, kept here too: with your id known (me.json), a trip
// shared with you as a viewer can't be changed, and only its owner deletes
// it or changes who's on it. Without me.json there's no one to check.
function mayEdit(doc, tripId, me) {
  const t = doc.trips.find((x) => x.id === tripId);
  return !me || !t || M.can(t, me, "edit");
}
function guard(before, next, id, me) {
  if (!me) return;
  const was = before.trips.find((x) => x.id === id);
  if (!was || !was.members || !was.members.length) return;
  const now = next.trips.find((x) => x.id === id);
  if (!M.can(was, me, "edit")) throw new Error("You can only view " + was.name + ", so it can't be changed.");
  const people = (t) => JSON.stringify([t.owner, t.members, t.share]);
  if ((!now || people(now) !== people(was)) && !M.can(was, me, "manage")) throw new Error("Only the owner of " + was.name + " can " + (now ? "change who's on it." : "delete it."));
}

// A trip by id, or by name (whole name first, then a part of it), any case.
function findTrip(doc, key) {
  const k = String(key || "").trim().toLowerCase();
  const t = doc.trips.find((x) => x.id === key) || doc.trips.find((x) => x.name.toLowerCase() === k)
    || doc.trips.filter((x) => x.name.toLowerCase().includes(k)).sort((a, b) => a.name.length - b.name.length)[0];
  if (!k || !t) throw new Error("No trip " + JSON.stringify(key) + ". Trips: " + (doc.trips.map((x) => x.name).join(", ") || "none"));
  return t;
}
function findIn(list, key, what) {
  const k = String(key || "").trim().toLowerCase();
  const r = list.find((x) => x.id === key) || list.find((x) => (x.name || x.title || "").toLowerCase() === k)
    || list.find((x) => (x.name || x.title || "").toLowerCase().includes(k));
  if (!k || !r) throw new Error("No " + what + " " + JSON.stringify(key) + " in this trip.");
  return r;
}
const placesOf = (doc, t) => doc.places.filter((p) => p.trip === t.id);
const findPlace = (doc, t, key) => findIn(placesOf(doc, t), key, "place");

// Your categories as [[id, name]], and one by id or name.
const catsOf = (cats) => M.catList(cats ? cats.list : null);
function findCat(cats, key) {
  const k = String(key || "").trim().toLowerCase();
  const c = cats.find(([id]) => id === key) || cats.find(([, n]) => n.toLowerCase() === k) || cats.find(([id]) => id.toLowerCase() === k);
  if (!k || !c) throw new Error("No category " + JSON.stringify(key) + ". Categories: " + cats.map(([id, n]) => n + " (" + id + ")").join(", ") + ".");
  return c;
}
const asSaved = (l) => l.map(([id, name]) => (M.CATEGORY.get(id) === name ? { id } : { id, name }));

// What a trip looks like to a person or a model: the trip, its places by
// day, its expenses with totals, its people and its files (names only).
function tripView(doc, trip, cats) {
  const places = placesOf(doc, trip);
  const expenses = (doc.expenses || []).filter((x) => x.trip === trip.id);
  const list = catsOf(cats);
  const used = [...new Set(places.map((p) => p.category))];
  return {
    trip,
    places: places.slice().sort((a, b) => String(a.day || "9999").localeCompare(String(b.day || "9999")) || String(a.time || "").localeCompare(String(b.time || ""))),
    categories: Object.fromEntries(used.map((id) => [id, M.catName(list, trip, id)])),
    days: M.tripDays(trip, places),
    expenses, totals: M.expenseTotals(expenses),
    byCategory: M.expensesByCategory(expenses).map(({ id, totals }) => ({ category: id, totals })),
    people: (trip.members || []).map((m) => { const a = M.access(trip, m.id); return { id: m.id, name: m.name, role: a.role, hidden: a.hide, own: a.own }; }),
    files: (doc.files || []).filter((f) => f.trip === trip.id).map(({ id, name, type, size, place, note }) => ({ id, name, type, size, place, note })),
  };
}

// The edits both front ends offer, on a doc. Each gives the record it made
// or changed. Fields are the app's own (see src/model.js); unknown ones
// are kept, as the app keeps them.
const PLACE_FIELDS = ["name", "category", "importance", "day", "endDay", "time", "endTime", "note", "lat", "lng", "address", "placeId", "visited"];
const EXPENSE_FIELDS = ["title", "amount", "currency", "category", "day", "place", "note", "paidBy"];
const TRIP_FIELDS = ["name", "start", "end", "destinations"];
const FILE_FIELDS = ["name", "place", "note"];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const clear = (r, a, keys) => { for (const k of keys) if (a[k] === null || a[k] === "") delete r[k]; };
const now = () => new Date().toISOString();
const MB = 1024 * 1024;
const MAX_COVER_MB = 5;

// A file's type from its first bytes or its name's ending.
const TYPES = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic",
  txt: "text/plain", md: "text/markdown", html: "text/html", csv: "text/csv", json: "application/json", kml: "application/vnd.google-earth.kml+xml",
  ics: "text/calendar", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pkpass: "application/vnd.apple.pkpass", zip: "application/zip" };
const typeOf = (name) => TYPES[(/\.(\w+)$/.exec(String(name).toLowerCase()) || [])[1]] || "application/octet-stream";
function imageType(b) {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return "";
}
const isText = (type) => /^text\/|json|xml|csv|calendar/.test(type);
const dataUrl = (type, bytes) => "data:" + type + ";base64," + Buffer.from(bytes).toString("base64");
const fromDataUrl = (url) => { const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(String(url || "")); return m ? (m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]))) : null; };

// Today on this computer, YYYY-MM-DD.
const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

const ops = {
  createTrip(doc, a, ctx) {
    const t = M.sanitizeTrip({ id: M.newId(), createdAt: now(), ...pick(a, TRIP_FIELDS) });
    if (ctx && ctx.me) M.ownTrip(t, { id: ctx.me, name: "" });
    doc.trips.push(t);
    return t;
  },
  updateTrip(doc, a) {
    const t = findTrip(doc, a.trip);
    Object.assign(t, pick(a, TRIP_FIELDS));
    clear(t, a, ["start", "end"]);
    return t;
  },
  deleteTrip(doc, a) {
    const t = findTrip(doc, a.trip);
    doc.trips = doc.trips.filter((x) => x !== t);
    return { deleted: t.name };
  },
  // A cover photo (JPEG, PNG or WebP bytes), or none.
  setCover(doc, a, ctx) {
    const t = findTrip(doc, a.trip);
    if (a.remove) {
      t.cover = false;
      t.coverAt = now();
      ctx.drop("covers/" + t.id + ".jpg");
      return { trip: t.name, cover: false };
    }
    const b = a.bytes;
    if (!b || !b.length) throw new Error("A cover needs an image, or remove.");
    if (!imageType(b)) throw new Error("A cover is a JPEG, PNG or WebP image.");
    if (b.length > MAX_COVER_MB * MB) throw new Error("A cover can be up to " + MAX_COVER_MB + " MB.");
    t.cover = true;
    t.coverAt = now();
    ctx.put("covers/" + t.id + ".jpg", b);
    return { trip: t.name, cover: true, size: b.length };
  },
  addPlace(doc, a) {
    const t = findTrip(doc, a.trip);
    if (!a.name) throw new Error("A place needs a name.");
    const p = M.sanitizePlace({ id: M.newId(), trip: t.id, createdAt: now(), category: "sight", ...pick(a, PLACE_FIELDS) });
    doc.places.push(p);
    return p;
  },
  updatePlace(doc, a) {
    const t = findTrip(doc, a.trip);
    const p = findPlace(doc, t, a.place);
    Object.assign(p, pick(a, PLACE_FIELDS));
    clear(p, a, PLACE_FIELDS);
    // A new location from anywhere but Google's id isn't Google's.
    if ((a.lat !== undefined || a.lng !== undefined) && a.placeId === undefined) delete p.geoAt;
    return p;
  },
  deletePlace(doc, a) {
    const t = findTrip(doc, a.trip);
    const p = findPlace(doc, t, a.place);
    doc.places = doc.places.filter((x) => x !== p);
    return { deleted: p.name };
  },
  // A Google Maps list (Takeout CSV, My Maps KML, Saved Places JSON, or
  // a.list: one already read from a shared link) into a trip, or into a new
  // one named after the list. Names already in the trip are skipped, as in the app.
  importPlaces(doc, a, ctx) {
    const src = a.bytes ? Buffer.from(a.bytes).toString("utf8") : "";
    const items = a.list ? (a.list.places || []).filter((p) => p && typeof p.name === "string" && p.name.trim()) : LI.parse(src, a.fileName || "");
    if (!items.length) throw new Error("No places found in that.");
    const title = a.list ? String(a.list.title || "") : LI.title(src, a.fileName || "");
    const t = a.trip ? findTrip(doc, a.trip) : ops.createTrip(doc, { name: a.name || title || "Imported places" }, ctx);
    const have = new Set(placesOf(doc, t).map((p) => p.name.toLowerCase()));
    const added = [];
    for (const it of items) {
      if (have.has(it.name.toLowerCase())) continue;
      have.add(it.name.toLowerCase());
      const p = { id: M.newId(), trip: t.id, name: it.name, category: "other", importance: "want", createdAt: now() };
      if (it.note) p.note = it.note;
      if (typeof it.lat === "number" && typeof it.lng === "number") Object.assign(p, { lat: it.lat, lng: it.lng });
      added.push(M.sanitizePlace(p));
    }
    doc.places.push(...added);
    return { trip: t.name, tripId: t.id, added: added.length, skipped: items.length - added.length, places: added.map((p) => ({ id: p.id, name: p.name, located: p.lat != null })) };
  },
  addExpense(doc, a) {
    const t = findTrip(doc, a.trip);
    if (a.amount == null || isNaN(+a.amount)) throw new Error("An expense needs an amount.");
    if (a.place) a = { ...a, place: findPlace(doc, t, a.place).id };
    const x = M.sanitizeExpense({ id: M.newId(), trip: t.id, createdAt: now(), ...pick(a, EXPENSE_FIELDS), amount: +a.amount });
    doc.expenses = (doc.expenses || []).concat(x);
    return x;
  },
  updateExpense(doc, a) {
    const t = findTrip(doc, a.trip);
    const x = findIn((doc.expenses || []).filter((e) => e.trip === t.id), a.expense, "expense");
    if (a.place) a = { ...a, place: findPlace(doc, t, a.place).id };
    Object.assign(x, pick(a, EXPENSE_FIELDS));
    clear(x, a, ["day", "place", "note", "paidBy"]);
    if (a.amount != null && a.amount !== "") x.amount = +a.amount;
    return x;
  },
  deleteExpense(doc, a) {
    const t = findTrip(doc, a.trip);
    const x = findIn((doc.expenses || []).filter((e) => e.trip === t.id), a.expense, "expense");
    doc.expenses = doc.expenses.filter((e) => e !== x);
    return { deleted: x.title };
  },
  // A file kept with the trip (a ticket, a booking), synced like the app's.
  addFile(doc, a, ctx) {
    const t = findTrip(doc, a.trip);
    const b = a.bytes;
    if (!b || !b.length) throw new Error("A file needs its contents.");
    if (b.length > M.MAX_FILE_MB * MB) throw new Error("A file can be up to " + M.MAX_FILE_MB + " MB.");
    const name = a.name || "Untitled file";
    const f = M.sanitizeFile({ id: M.newId(), trip: t.id, name, type: a.type || imageType(b) || typeOf(name), size: b.length, createdAt: now(),
      place: a.place ? findPlace(doc, t, a.place).id : undefined, note: a.note });
    doc.files = (doc.files || []).concat(f);
    ctx.put("files/" + t.id + "/" + f.id, b);
    return f;
  },
  updateFile(doc, a) {
    const t = findTrip(doc, a.trip);
    const f = findIn((doc.files || []).filter((x) => x.trip === t.id), a.file, "file");
    if (a.place) a = { ...a, place: findPlace(doc, t, a.place).id };
    Object.assign(f, pick(a, FILE_FIELDS));
    clear(f, a, ["place", "note"]);
    return f;
  },
  deleteFile(doc, a) {
    const t = findTrip(doc, a.trip);
    const f = findIn((doc.files || []).filter((x) => x.trip === t.id), a.file, "file");
    doc.files = doc.files.filter((x) => x !== f);
    return { deleted: f.name };
  },
  // Who may do what: with no person, what everyone gets; with one, that
  // person's own (role "default" or hide "default" go back to everyone's).
  updateSharing(doc, a) {
    const t = findTrip(doc, a.trip);
    if (Array.isArray(a.hide) && a.hide.length === 1 && a.hide[0] === "default") a = { ...a, hide: "default" };
    const hide = (v) => (Array.isArray(v) ? v : String(v).split(",")).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
    for (const x of a.hide && a.hide !== "default" ? hide(a.hide) : []) if (!M.SECTIONS.includes(x)) throw new Error("No section " + JSON.stringify(x) + ". Sections: " + M.SECTIONS.join(", ") + ".");
    if (a.role !== undefined && !["editor", "viewer", "default"].includes(a.role)) throw new Error("A role is editor or viewer" + (a.person ? ", or default." : "."));
    if (!a.person) {
      if (a.role === "default") throw new Error("Everyone's role is editor or viewer.");
      const d = t.share || { role: "editor", hide: [] };
      t.share = { role: a.role || d.role, hide: a.hide !== undefined && a.hide !== "default" ? hide(a.hide) : a.hide === "default" ? [] : d.hide };
      return { trip: t.name, everyone: t.share };
    }
    const m = findIn(t.members || [], a.person, "person");
    if (m.id === t.owner) throw new Error("The owner always has everything.");
    if (a.role === "default") delete m.role; else if (a.role) m.role = a.role;
    if (a.hide === "default") delete m.hide; else if (a.hide !== undefined) m.hide = hide(a.hide);
    return { trip: t.name, person: m.name || m.id, access: M.access(t, m.id) };
  },
  // Someone off a shared trip; the sharing server ends their key at the
  // owner's next sync, as when the app removes them.
  removePerson(doc, a) {
    const t = findTrip(doc, a.trip);
    const m = findIn(t.members || [], a.person, "person");
    if (m.id === t.owner) throw new Error("The owner can't be removed. Delete the trip, or stop sharing it in the app.");
    t.members = t.members.filter((x) => x !== m);
    return { trip: t.name, removed: m.name || m.id };
  },
  // Your categories, one list for all trips (categories.json).
  addCategory(doc, a, ctx) {
    const name = String(a.name || "").trim().slice(0, 40);
    if (!name) throw new Error("A category needs a name.");
    const l = catsOf(ctx.cats);
    if (l.some(([, n]) => n.toLowerCase() === name.toLowerCase())) throw new Error("There's already a category called " + name + ".");
    const id = "c" + M.newId();
    const at = l.findIndex(([x]) => x === "other");
    l.splice(at < 0 ? l.length : at, 0, [id, name]);
    ctx.setCats(asSaved(l));
    return { id, name };
  },
  updateCategory(doc, a, ctx) {
    const l = catsOf(ctx.cats);
    const [id] = findCat(l, a.category);
    let i = l.findIndex(([x]) => x === id);
    if (a.name) {
      const name = String(a.name).trim().slice(0, 40);
      if (l.some(([x, n]) => x !== id && n.toLowerCase() === name.toLowerCase())) throw new Error("There's already a category called " + name + ".");
      l[i] = [id, name];
    }
    if (a.position != null && a.position !== "") {
      const to = Math.max(0, Math.min(l.length - 1, Math.round(+a.position) - 1));
      const [c] = l.splice(i, 1);
      l.splice(to, 0, c);
      i = to;
    }
    ctx.setCats(asSaved(l));
    return { id, name: l[i][1], position: i + 1 };
  },
  // Its places, in every trip you may edit, move to Other, as in the app.
  deleteCategory(doc, a, ctx) {
    const l = catsOf(ctx.cats);
    const [id, name] = findCat(l, a.category);
    if (id === "other") throw new Error("Other is always there.");
    let moved = 0;
    for (const p of doc.places) if (p.category === id && mayEdit(doc, p.trip, ctx.me)) { p.category = "other"; moved++; }
    ctx.setCats(asSaved(l.filter(([x]) => x !== id)));
    return { deleted: name, movedToOther: moved };
  },
  resetCategories(doc, a, ctx) {
    const keep = new Set(M.CATEGORIES.map(([id]) => id));
    let moved = 0;
    for (const p of doc.places) if (!keep.has(p.category) && mayEdit(doc, p.trip, ctx.me)) { p.category = "other"; moved++; }
    ctx.setCats(M.CATEGORIES.map(([id]) => ({ id })));
    return { categories: M.CATEGORIES.map(([id, name]) => ({ id, name })), movedToOther: moved };
  },
  // A backup file's trips join the repo, replacing ones with the same id,
  // with their covers and files when the backup holds them.
  async importBackup(doc, a, ctx) {
    let data = a.backup;
    if (typeof data === "string") { try { data = JSON.parse(data); } catch (e) { throw new Error("That file isn't a Tripboard backup."); } }
    if (!data && a.bytes) { try { data = JSON.parse(Buffer.from(a.bytes).toString("utf8")); } catch (e) { throw new Error("That file isn't a Tripboard backup."); } }
    const r = M.mergeBackup(doc, data);
    Object.assign(doc, r.doc);
    let covers = 0, files = 0;
    for (const id of r.ids) {
      const b = fromDataUrl(data.covers && data.covers[id]);
      const t = doc.trips.find((x) => x.id === id);
      if (b && t) { ctx.put("covers/" + id + ".jpg", b); t.cover = true; t.coverAt = now(); covers++; }
    }
    for (const f of doc.files || []) {
      const b = r.ids.includes(f.trip) && fromDataUrl(data.blobs && data.blobs[f.id]);
      if (b) { ctx.put("files/" + f.trip + "/" + f.id, b); files++; }
    }
    return { added: r.added, replaced: r.replaced, trips: doc.trips.filter((t) => r.ids.includes(t.id)).map((t) => t.name), covers, files };
  },
};

// Read-only answers, on a snapshot (see open().snapshot).
const queries = {
  listTrips(st) {
    const d = st.doc;
    return M.sortTrips(d.trips, today()).map((t) => ({ ...t, status: M.tripStatus(t, today()), places: d.places.filter((p) => p.trip === t.id).length }));
  },
  getTrip(st, a) { return tripView(st.doc, findTrip(st.doc, a.trip), st.cats); },
  // Places that match every filter given; with near, nearest first.
  findPlaces(st, a) {
    const t = findTrip(st.doc, a.trip);
    const cats = catsOf(st.cats);
    let list = placesOf(st.doc, t);
    if (a.day === "none") list = list.filter((p) => !p.day);
    else if (a.day) list = list.filter((p) => M.onDay(p, a.day));
    if (a.category) { const [id] = findCat(cats.concat(Object.entries(t.cats || {})), a.category); list = list.filter((p) => p.category === id); }
    if (a.importance && a.importance.length) list = list.filter((p) => a.importance.includes(p.importance));
    if (a.visited !== undefined) list = list.filter((p) => !!p.visited === !!a.visited);
    if (a.located !== undefined) list = list.filter((p) => (p.lat != null) === !!a.located);
    if (a.text) { const q = String(a.text).toLowerCase(); list = list.filter((p) => [p.name, p.note, p.address].some((v) => v && v.toLowerCase().includes(q))); }
    const from = nearOf(st.doc, t, a.near);
    const out = list.map((p) => ({ ...p, categoryName: M.catName(cats, t, p.category), ...(from && p.lat != null ? { km: Math.round(M.distanceKm(from, p) * 100) / 100 } : {}) }));
    if (from) out.sort((x, y) => (x.km ?? Infinity) - (y.km ?? Infinity));
    return a.limit ? out.slice(0, +a.limit) : out;
  },
  // The board as the app groups it: by day and time slot, category,
  // importance, or distance from a point.
  getBoard(st, a) {
    const t = findTrip(st.doc, a.trip);
    const cats = catsOf(st.cats);
    const brief = (p) => ({ id: p.id, name: p.name, day: p.day, endDay: p.endDay, time: p.time, importance: p.importance, category: p.category, visited: !!p.visited });
    const groups = M.board(t, placesOf(st.doc, t), a.sort || "time", { only: a.only, from: nearOf(st.doc, t, a.near), cats });
    return groups.map((g) => ({ id: g.id, title: g.title, ...(g.day ? { dayNumber: M.dayIndex(t, g.day) } : {}),
      ...(g.slots ? { slots: g.slots.map((s) => ({ id: s.id, title: s.title, places: s.places.map(brief) })) } : { places: g.places.map((p) => ({ ...brief(p), ...(g.km ? { km: Math.round(g.km.get(p.id) * 100) / 100 } : {}) })) }) }));
  },
  // One day as the Today view shows it: the plan in order, the guessed
  // time between places, the next one not yet visited, and that day's
  // expenses.
  getDay(st, a) {
    const t = findTrip(st.doc, a.trip);
    const day = a.day || today();
    if (!M.isDay(day)) throw new Error("A day is YYYY-MM-DD.");
    const plan = M.dayPlan(placesOf(st.doc, t), day);
    const next = M.nextOf(plan);
    const expenses = (st.doc.expenses || []).filter((x) => x.trip === t.id && x.day === day);
    return {
      trip: t.name, day, dayNumber: M.dayIndex(t, day), status: M.tripStatus(t, day),
      plan: plan.map((p, i) => ({ ...p, slot: M.slotOf(p), fromPrevious: i ? M.leg(plan[i - 1], p) : null })),
      next: next ? { id: next.id, name: next.name } : null,
      expenses, totals: M.expenseTotals(expenses),
    };
  },
  listCategories(st) {
    const counts = new Map();
    for (const p of st.doc.places) counts.set(p.category, (counts.get(p.category) || 0) + 1);
    return catsOf(st.cats).map(([id, name], i) => ({ id, name, position: i + 1, builtIn: M.CATEGORY.has(id), places: counts.get(id) || 0 }));
  },
  // A file's record and bytes (null when its bytes aren't in the repo).
  async getFile(st, a) {
    const t = findTrip(st.doc, a.trip);
    const f = findIn((st.doc.files || []).filter((x) => x.trip === t.id), a.file, "file");
    const bytes = await st.raw("files/" + t.id + "/" + f.id);
    return { file: f, bytes };
  },
  // A backup like the app's Save a backup: the trips asked for (all when
  // none), with covers and files' bytes when `bytes` is true.
  async exportBackup(st, a) {
    const ids = (a.trips || []).map((k) => findTrip(st.doc, k).id);
    const data = M.backupOf(st.doc, ids);
    if (a.bytes) {
      for (const t of data.trips) {
        const b = t.cover && (await st.raw("covers/" + t.id + ".jpg"));
        if (b) data.covers[t.id] = dataUrl(imageType(b) || "image/jpeg", b);
      }
      for (const f of data.files) {
        const b = await st.raw("files/" + f.trip + "/" + f.id);
        if (b) data.blobs[f.id] = dataUrl(f.type, b);
      }
    }
    return data;
  },
};

// A point to measure from: "lat,lng", or a place in the trip by name or id.
function nearOf(doc, t, near) {
  if (!near) return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(near));
  if (m) return { lat: +m[1], lng: +m[2] };
  const p = findPlace(doc, t, near);
  if (p.lat == null) throw new Error(p.name + " has no location to measure from.");
  return p;
}

module.exports = { open, findTrip, findIn, findPlace, findCat, catsOf, tripView, ops, queries, today, isText, typeOf, imageType,
  M, G, LI, PLACE_FIELDS, EXPENSE_FIELDS, TRIP_FIELDS, FILE_FIELDS };
