// The trips in a GitHub sync repo, read and changed from Node, for the CLI
// (cli/tripboard.js) and the MCP server (cli/mcp.js). It acts as one more
// device: it reads every trip's bundle, changes the doc, stamps what
// changed (updatedAt, tombstones) with the app's own model.js, and writes
// the trips that differ in one commit. The apps then merge that like any
// other device's change. No dependencies: Node 18+ and the app's files.
//
//   const tb = require("./core").open({ token, repo: "owner/name", branch });
//   const doc = await tb.read();
//   const out = await tb.change((doc) => { ...; return result; });
globalThis.window = globalThis.window || globalThis;
require("../src/keel/github.js");
const M = require("../src/model.js");
const G = require("../src/merge.js");
const K = globalThis.Keel;

const empty = () => ({ trips: [], places: [], expenses: [], files: [], deleted: {} });
const text = (b) => JSON.stringify(b, null, 1);

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

  // The repo as one doc, and the head it was read at.
  async function load() {
    const branch = await whichBranch();
    const head = await gh.json("GET", "git/ref/heads/" + encodeURIComponent(branch));
    if (!head) return { doc: empty(), head: null, bundles: {} };
    const tree = await gh.json("GET", "git/trees/" + head.object.sha + "?recursive=1");
    const ids = (tree.tree || []).map((f) => (/^trips\/([\w-]+)\.json$/.exec(f.path) || [])[1]).filter(Boolean);
    let doc = empty();
    const bundles = {};
    for (const id of ids) {
      const got = await gh.getJson("trips/" + id + ".json", { ref: head.object.sha });
      if (!got) continue;
      bundles[id] = got.data;
      doc = G.applyBundle(doc, got.data);
    }
    return { doc: M.sanitizeDoc(doc), head: head.object.sha, bundles };
  }

  async function read() { return (await load()).doc; }

  // fn(doc) changes the doc in place and gives a result. Retried on a
  // fresh read if the repo moved meanwhile.
  async function change(fn, message) {
    for (let n = 1; ; n++) {
      const { doc, head, bundles } = await load();
      const before = JSON.parse(JSON.stringify(doc));
      const result = await fn(doc);
      const next = M.stamp(before, M.sanitizeDoc(doc));
      const writes = [];
      for (const id of new Set(G.tripIds(next).concat(Object.keys(bundles)))) {
        const b = G.bundleOf(next, id);
        if (b && JSON.stringify(b) !== JSON.stringify(bundles[id])) writes.push({ path: "trips/" + id + ".json", text: text(b) });
      }
      if (!writes.length) return result;
      try {
        await gh.commitFiles(writes, message || "Tripboard CLI: " + writes.length + (writes.length === 1 ? " trip" : " trips"), {
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

  return { read, change, gh };
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

// What a trip looks like to a person or a model: the trip, its places by
// day, its expenses with totals, and its files (names only).
function tripView(doc, trip) {
  const places = doc.places.filter((p) => p.trip === trip.id);
  const expenses = (doc.expenses || []).filter((x) => x.trip === trip.id);
  return {
    trip,
    places: places.slice().sort((a, b) => String(a.day || "9999").localeCompare(String(b.day || "9999")) || String(a.time || "").localeCompare(String(b.time || ""))),
    expenses, totals: M.expenseTotals(expenses),
    people: (trip.members || []).map((m) => { const a = M.access(trip, m.id); return { id: m.id, name: m.name, role: a.role, hidden: a.hide, own: a.own }; }),
    files: (doc.files || []).filter((f) => f.trip === trip.id).map(({ id, name, type, size, place, note }) => ({ id, name, type, size, place, note })),
  };
}

// The edits both front ends offer, on a doc. Each gives the record it made
// or changed. Fields are the app's own (see src/model.js); unknown ones
// are kept, as the app keeps them.
const PLACE_FIELDS = ["name", "category", "importance", "day", "time", "endTime", "note", "lat", "lng", "address", "visited"];
const EXPENSE_FIELDS = ["title", "amount", "currency", "category", "day", "place", "note", "paidBy"];
const TRIP_FIELDS = ["name", "start", "end", "destinations"];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const now = () => new Date().toISOString();

const ops = {
  createTrip(doc, a) {
    const t = M.sanitizeTrip({ id: M.newId(), createdAt: now(), ...pick(a, TRIP_FIELDS) });
    doc.trips.push(t);
    return t;
  },
  updateTrip(doc, a) {
    const t = findTrip(doc, a.trip);
    Object.assign(t, pick(a, TRIP_FIELDS));
    return t;
  },
  deleteTrip(doc, a) {
    const t = findTrip(doc, a.trip);
    doc.trips = doc.trips.filter((x) => x !== t);
    return { deleted: t.name };
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
    const p = findIn(doc.places.filter((x) => x.trip === t.id), a.place, "place");
    Object.assign(p, pick(a, PLACE_FIELDS));
    for (const k of PLACE_FIELDS) if (a[k] === null || a[k] === "") delete p[k];
    return p;
  },
  deletePlace(doc, a) {
    const t = findTrip(doc, a.trip);
    const p = findIn(doc.places.filter((x) => x.trip === t.id), a.place, "place");
    doc.places = doc.places.filter((x) => x !== p);
    return { deleted: p.name };
  },
  addExpense(doc, a) {
    const t = findTrip(doc, a.trip);
    if (a.amount == null || isNaN(+a.amount)) throw new Error("An expense needs an amount.");
    if (a.place) a = { ...a, place: findIn(doc.places.filter((x) => x.trip === t.id), a.place, "place").id };
    const x = M.sanitizeExpense({ id: M.newId(), trip: t.id, createdAt: now(), ...pick(a, EXPENSE_FIELDS), amount: +a.amount });
    doc.expenses = (doc.expenses || []).concat(x);
    return x;
  },
  updateExpense(doc, a) {
    const t = findTrip(doc, a.trip);
    const x = findIn((doc.expenses || []).filter((e) => e.trip === t.id), a.expense, "expense");
    if (a.place) a = { ...a, place: findIn(doc.places.filter((p) => p.trip === t.id), a.place, "place").id };
    Object.assign(x, pick(a, EXPENSE_FIELDS));
    if (a.amount != null) x.amount = +a.amount;
    return x;
  },
  // Who may do what: with no person, what everyone gets; with one, that
  // person's own (role "default" or hide "default" go back to everyone's).
  updateSharing(doc, a) {
    const t = findTrip(doc, a.trip);
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
  deleteExpense(doc, a) {
    const t = findTrip(doc, a.trip);
    const x = findIn((doc.expenses || []).filter((e) => e.trip === t.id), a.expense, "expense");
    doc.expenses = doc.expenses.filter((e) => e !== x);
    return { deleted: x.title };
  },
};

module.exports = { open, findTrip, tripView, ops, M, G, PLACE_FIELDS, EXPENSE_FIELDS, TRIP_FIELDS };
