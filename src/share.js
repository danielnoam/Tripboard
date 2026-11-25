// Shared trips: the sharing server (server/worker.js) holds a trip that
// its owner shares, and every device on it syncs that one trip with it.
// It works beside GitHub sync, which still keeps your own copy of every
// trip; a trip's share keeps its own agreed copy and version.
//
// Each device on a shared trip has a key for it, kept in IndexedDB
// ("meta:shares", never in the doc). GitHub sync copies the keys to your
// own sync repo's shares.json, so your other devices open the trip as you:
//   { [trip id]: { key, version, base, role, hidden, files: { id: true }, cover, server } }
// server is the trip's sharing server when it isn't Tripboard's (SERVER).
// A section someone doesn't see never reaches their device, so applying the
// server's copy drops it here too.
//
//   Tripboard.share.start({ getDoc, adopt, version, store, filesChanged, coverChanged, unshared })
//   .invite(trip) -> link    .join(tripId, code)    .leave(id)    .stop(id)
//   .shared(id) -> { role, hidden } or null    .onChange = () => …
//
// Which server: Tripboard's (SERVER), or one the person runs themselves
// (Settings › Sharing server, server/README.md). A trip stays on the server
// it was shared on, and its invite link names that server. index.html's
// CSP lets the app reach only SERVER, so sw.js adds the other servers this
// device uses (kept in the "tripboard-servers" cache) to the page's
// connect-src as it serves it; a new one works after a reload.
(function () {
  const T = window.Tripboard;
  const G = T.merge;
  // The server (server/README.md). Empty: no sharing.
  const SERVER = "https://tripboard.danielnoam1999.workers.dev";
  // The web copy shared links open: index.html's keel-site.
  const APP_URL = window.Keel.releases.metaSite();
  let ctx = null, state = {}, loaded = null, timer = null, running = null, again = false;
  const S = { onChange: null, status: { state: "idle" } };
  S.enabled = () => !!server();
  S.shared = (id) => (state[id] ? { role: state[id].role, hidden: state[id].hidden || [] } : null);

  const OWN = "tripboard.shareServer", JOINING = "tripboard.joinServer";
  const i18n = { t: (s, v) => window.i18n ? window.i18n.t(s, v) : s.replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m)) };
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* private window */ } return null; };

  // An address as the app keeps it: https://host[:port], lower case, or null.
  S.origin = (text) => {
    let t = String(text || "").trim();
    if (!t) return null;
    if (!/^[a-z]+:\/\//i.test(t)) t = "https://" + t;
    let u;
    try { u = new URL(t); } catch (e) { return null; }
    if (u.protocol !== "https:" || u.username || u.password || (u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) return null;
    return /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/.test(u.origin) ? u.origin : null;
  };
  // What a server's address looks like in a link and on screen.
  S.host = (origin) => String(origin || SERVER).replace(/^https:\/\//, "");
  S.DEFAULT = SERVER;
  // The server new shares and Google Maps list links go to.
  const server = () => S.origin(ls(OWN)) || SERVER;
  S.server = server;
  const at = (id) => (state[id] && state[id].server) || SERVER;

  // The servers this page's CSP lets it reach (sw.js adds the picked ones).
  S.allowed = (origin) => {
    if (origin === SERVER) return true;
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    const m = meta && /(?:^|;)\s*connect-src([^;]*)/.exec(meta.content);
    return !!m && m[1].trim().split(/\s+/).includes(origin);
  };
  // Own servers need sw.js to reach them: the web app, over https.
  S.canUseOwn = () => !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  // The servers sw.js should allow: your own, every shared trip's, and
  // one an invite link is about to join through.
  S.servers = () => [...new Set([ls(OWN), ls(JOINING), ...Object.values(state).map((st) => st.server)].map(S.origin).filter((o) => o && o !== SERVER))].sort();
  async function writeServers() {
    if (typeof caches === "undefined" || !ctx) return;
    await load();
    try { await (await caches.open("tripboard-servers")).put("servers", new Response(JSON.stringify(S.servers()), { headers: { "Content-Type": "application/json" } })); }
    catch (e) { /* private window */ }
  }
  // Picks the server new shares go to (null: Tripboard's). Gives whether
  // the app needs a reload to reach it.
  S.setServer = async (text) => {
    const o = text ? S.origin(text) : null;
    if (text && !o) throw new Error(i18n.t("That isn't a server address. It looks like https://tripboard.you.workers.dev."));
    ls(OWN, o && o !== SERVER ? o : null);
    await writeServers();
    changed();
    return { reload: !!o && !S.allowed(o) };
  };
  // An invite link to a trip on a server this page can't reach yet: allow
  // it, then reload. Cleared once the trip is joined.
  S.allowJoin = async (origin) => { ls(JOINING, origin ? S.origin(origin) : null); await writeServers(); };
  // Asks a server whether it's a Tripboard server.
  S.check = async (origin) => {
    try {
      const r = await fetch(origin + "/", { headers: { Accept: "application/json" } });
      const d = await r.json();
      return d && d.tripboard === "sharing";
    } catch (e) { return false; }
  };


  // Keys this device let go of (left, removed, stopped), so a copy of them
  // in the sync repo isn't taken up again.
  let dropped = [];
  async function load() {
    if (!loaded) loaded = Promise.all([ctx.store.meta("shares"), ctx.store.meta("sharesDropped")])
      .then(([s, d]) => { state = s || {}; dropped = d || []; });
    return loaded;
  }
  const keep = () => Promise.all([ctx.store.setMeta("shares", state), ctx.store.setMeta("sharesDropped", dropped.slice(-200)), writeServers()]);

  // Your other devices: GitHub sync keeps each shared trip's key in your
  // sync repo (shares.json), so every device of yours opens the trip as you.
  // A trip on Tripboard's server is just its key (as before); one on
  // another server is { key, server }, which older copies of the app skip.
  S.keys = async () => { await load(); return Object.fromEntries(Object.entries(state).map(([id, st]) => [id, st.server ? { key: st.key, server: st.server } : st.key]).sort()); };
  S.adoptKeys = async (keys) => {
    await load();
    let added = false;
    for (const [id, v] of Object.entries(keys || {})) {
      const key = typeof v === "string" ? v : v && v.key;
      const srv = v && typeof v === "object" ? S.origin(v.server) : null;
      if (state[id] || typeof key !== "string" || dropped.includes(key) || !/^[\w-]{1,40}$/.test(id)) continue;
      if (v && typeof v === "object" && !srv) continue;
      state[id] = { key, version: 0, base: null, role: "editor", hidden: [], files: {}, cover: "" };
      if (srv && srv !== SERVER) state[id].server = srv;
      added = true;
    }
    if (added) { await keep(); changed(); S.soon(0); }
  };
  const changed = () => { if (S.onChange) S.onChange(); };

  async function call(method, path, { key, body, raw, to } = {}) {
    const base = to || server();
    if (!S.allowed(base)) throw Object.assign(new Error(i18n.t("Open Tripboard again to reach {host}.", { host: S.host(base) })), { kind: "reload" });
    const headers = {};
    if (key) headers.Authorization = "Bearer " + key;
    if (body) headers["Content-Type"] = "application/json";
    let r;
    try { r = await fetch(base + path, { method, headers, body: raw || (body ? JSON.stringify(body) : undefined) }); }
    catch (e) { throw Object.assign(new Error("No connection."), { kind: "offline" }); }
    const isJson = (r.headers.get("Content-Type") || "").includes("json");
    const data = isJson ? await r.json().catch(() => ({})) : r.ok ? await r.blob() : null;
    if (!r.ok && r.status !== 409) throw Object.assign(new Error((data && data.error) || "The sharing server said no (" + r.status + ")."), { status: r.status, data });
    return { status: r.status, data };
  }

  const me = () => T.settings.get().me;
  // A bundle as it travels for this person: without the sections they don't see.
  function strip(b, hidden) {
    if (!b) return b;
    const out = { ...b };
    for (const s of hidden || []) delete out[s];
    return out;
  }

  // Shares a trip (the first time) and makes a new invite link for it.
  S.invite = async (trip) => {
    await load();
    if (!state[trip.id]) {
      const bundle = G.bundleOf(ctx.getDoc(), trip.id);
      const to = server();
      const r = await call("POST", "/trips", { to, body: { bundle, person: { id: me().id, name: me().name } } });
      state[trip.id] = { key: r.data.key, version: 0, base: null, role: "owner", hidden: [], files: {}, cover: "" };
      if (to !== SERVER) state[trip.id].server = to;
      await keep();
    }
    const r = await call("POST", "/trips/" + trip.id + "/invite", { key: state[trip.id].key, to: at(trip.id) });
    S.soon(0);
    changed();
    const base = /^(localhost|127\.)/.test(location.hostname) ? location.origin + location.pathname : APP_URL;
    return { link: base + "#/join/" + trip.id + "/" + r.data.code + (state[trip.id].server ? "/" + S.host(state[trip.id].server) : ""), expires: r.data.expires };
  };
  // A shared Google Maps list's places, read by the server (server/googlelist.js).
  S.googleList = async (url) => (await call("POST", "/google-list", { body: { url } })).data;
  S.stopLink = async (id) => { await call("DELETE", "/trips/" + id + "/invite", { key: state[id].key, to: at(id) }); };

  // Joins a trip from an invite link; the trip comes to this device.
  // host: the server the link names (none: Tripboard's).
  S.join = async (tripId, code, host) => {
    await load();
    if (state[tripId]) return;
    const to = host ? S.origin(host) : SERVER;
    if (!to) throw new Error(i18n.t("This invite link is broken."));
    const r = await call("POST", "/trips/" + tripId + "/join", { to, body: { code, person: { id: me().id, name: me().name } } });
    state[tripId] = { key: r.data.key, version: r.data.version, base: r.data.bundle, role: r.data.role, hidden: r.data.hidden, files: {}, cover: "" };
    if (to !== SERVER) state[tripId].server = to;
    ls(JOINING, null);
    await keep();
    ctx.adopt(G.applyBundle(ctx.getDoc(), r.data.bundle));
    changed();
    S.soon(0);
  };

  // Leaving (someone else's trip) or stopping (your own): the server
  // forgets the key. Either way, and when you're taken off a trip, the
  // copy on this device stays, as your own trip that no longer syncs with
  // the others.
  S.leave = async (id) => {
    await call("DELETE", "/trips/" + id + "/me", { key: state[id].key, to: at(id) }).catch((e) => { if (e.status !== 401 && e.status !== 404) throw e; });
    await drop(id, "left");
  };
  S.stop = async (id) => {
    await call("DELETE", "/trips/" + id, { key: state[id].key, to: at(id) }).catch((e) => { if (e.status !== 401 && e.status !== 404) throw e; });
    await drop(id, "stopped");
  };
  async function drop(id, why) {
    const st = state[id];
    delete state[id];
    if (st) dropped.push(st.key);
    await keep();
    if (ctx.unshared) ctx.unshared(id, st && st.role === "owner" ? "stopped" : why);
    changed();
  }

  // ---------- Publishing ----------
  // A trip published for anyone with its link to open and copy
  // (server/published.js): a snapshot of its plan (model.publishedOf),
  // sent again by Publish again. Each one's key, which updates or removes
  // it, is kept in IndexedDB ("meta:published") and, through GitHub sync,
  // in your sync repo's published.json, so your other devices can update
  // or stop it too: { [trip id]: { id, key, at, dates, notes, server } },
  // or { stopped: true, at } once stopped. The newer `at` wins a merge.
  let pubs = null;
  const pubLoad = async () => (pubs = pubs || (await ctx.store.meta("published")) || {});
  const pubKeep = () => ctx.store.setMeta("published", pubs);
  const pubAt = (st) => (st && st.server) || SERVER;
  S.published = (tripId) => (pubs && pubs[tripId] && !pubs[tripId].stopped ? pubs[tripId] : null);
  S.publishedLink = (st) => {
    const base = /^(localhost|127\.)/.test(location.hostname) ? location.origin + location.pathname : APP_URL;
    return base + "#/p/" + st.id + (st.server ? "/" + S.host(st.server) : "");
  };
  S.publish = async (trip, opts) => {
    await pubLoad();
    const o = { dates: opts.dates !== false, notes: opts.notes !== false };
    const body = { bundle: T.model.publishedOf(ctx.getDoc(), trip, o), by: me().name || "", dates: o.dates };
    const was = S.published(trip.id);
    let st;
    if (was) {
      const r = await call("PUT", "/published/" + was.id, { key: was.key, body, to: pubAt(was) }).catch((e) => { if (e.status === 404 || e.status === 401) return null; throw e; });
      if (r) st = { ...was, ...o, at: r.data.at };
    }
    if (!st) {
      const to = server();
      const r = await call("POST", "/published", { body, to });
      st = { id: r.data.id, key: r.data.key, at: r.data.at, ...o };
      if (to !== SERVER) st.server = to;
    }
    pubs[trip.id] = st;
    await pubKeep();
    changed();
    return S.publishedLink(st);
  };
  S.unpublish = async (tripId) => {
    await pubLoad();
    const st = S.published(tripId);
    if (st) await call("DELETE", "/published/" + st.id, { key: st.key, to: pubAt(st) }).catch((e) => { if (e.status !== 401 && e.status !== 404) throw e; });
    pubs[tripId] = { stopped: true, at: new Date().toISOString() };
    await pubKeep();
    changed();
  };
  // A published trip, from its link's id and host: { bundle, by, dates, at, copies }.
  S.openPublished = async (id, host) => {
    const to = host ? S.origin(host) : SERVER;
    if (!to) throw new Error(i18n.t("This link is broken."));
    return (await call("GET", "/published/" + id, { to })).data;
  };
  S.copiedPublished = (id, host) => call("POST", "/published/" + id + "/copied", { to: host ? S.origin(host) : SERVER }).catch(() => null);
  S.pubKeys = async () => { await pubLoad(); return Object.fromEntries(Object.entries(pubs).sort()); };
  S.adoptPubKeys = async (theirs) => {
    await pubLoad();
    let hit = false;
    for (const [id, v] of Object.entries(theirs || {})) {
      if (!/^[\w-]{1,40}$/.test(id) || !v || typeof v.at !== "string") continue;
      if (!v.stopped && (typeof v.key !== "string" || !/^[\w-]{1,40}$/.test(v.id || "") || (v.server && !S.origin(v.server)))) continue;
      if (pubs[id] && pubs[id].at >= v.at) continue;
      pubs[id] = v.stopped ? { stopped: true, at: v.at } : { id: v.id, key: v.key, at: v.at, dates: v.dates !== false, notes: v.notes !== false, ...(v.server ? { server: S.origin(v.server) } : {}) };
      hit = true;
    }
    if (hit) { await pubKeep(); changed(); }
  };

  // One shared trip, synced with the server.
  async function once(id) {
    const st = state[id];
    const startVersion = ctx.version();
    let got;
    try { got = await call("GET", "/trips/" + id + (st.base ? "?v=" + st.version : ""), { key: st.key, to: at(id) }); }
    catch (e) {
      // Taken off the trip, or its sharing stopped: this copy becomes yours.
      if (e.status === 401 || e.status === 404) { await drop(id, e.status === 401 ? "removed" : "ended"); return { gone: true }; }
      throw e;
    }
    for (let tries = 0; tries < 4; tries++) {
      const r = got.data;
      if (!r.same) Object.assign(st, { role: r.role, hidden: r.hidden || [] });
      const theirs = r.same ? st.base : r.bundle;
      const doc = ctx.getDoc();
      const mineFull = G.bundleOf(doc, id);
      if (!mineFull) return {};
      if (mineFull.trip.deletedAt) {
        if (st.role === "owner") await S.stop(id); else await S.leave(id);
        return { gone: true };
      }
      const mine = strip(mineFull, st.hidden);
      const base = strip(st.base, st.hidden);
      const merged = st.role === "viewer" ? theirs : strip(base ? G.mergeBundles(base, mine, theirs) : G.mergeBundles(theirs, mine, theirs), st.hidden);
      let version = r.same ? st.version : r.version;
      if (st.role !== "viewer" && JSON.stringify(merged) !== JSON.stringify(theirs)) {
        if (ctx.version() !== startVersion) return { again: true };
        const put = await call("PUT", "/trips/" + id, { key: st.key, to: at(id), body: { version, bundle: merged } });
        if (put.status === 409) { got = put.data.bundle ? { data: put.data } : await call("GET", "/trips/" + id, { key: st.key, to: at(id) }); continue; }
        if (put.data.deleted) { await drop(id, "stopped"); return {}; }
        version = put.data.version;
      }
      if (ctx.version() !== startVersion) return { again: true };
      st.base = merged;
      st.version = version;
      const next = G.applyBundle(doc, merged);
      if (JSON.stringify(G.bundleOf(next, id)) !== JSON.stringify(mineFull)) ctx.adopt(next);
      await files(id, st, merged, mine);
      await keep();
      return {};
    }
    return { again: true };
  }

  // File bytes go up once and come down once, as in GitHub sync; the cover
  // goes whichever way its coverAt says.
  async function files(id, st, merged, mine) {
    let pulled = false;
    if (!(st.hidden || []).includes("files")) {
      for (const f of merged.files || []) {
        if (st.files[f.id] || f.kind === "link" || f.kind === "note") continue;
        const blob = await ctx.store.file(f.id);
        if (blob) {
          if (st.role !== "viewer") await call("PUT", "/trips/" + id + "/files/" + f.id, { key: st.key, to: at(id), raw: blob });
          st.files[f.id] = true;
        } else {
          const r = await call("GET", "/trips/" + id + "/files/" + f.id, { key: st.key, to: at(id) }).catch((e) => { if (e.status === 404) return null; throw e; });
          if (r) { await ctx.store.setFile(f.id, new Blob([r.data], { type: f.type })); st.files[f.id] = true; pulled = true; }
        }
      }
    }
    const t = merged.trip;
    if (t.cover && t.coverAt && st.cover !== t.coverAt) {
      const ours = mine.trip && mine.trip.cover && mine.trip.coverAt === t.coverAt;
      const blob = ours && await ctx.store.cover(id);
      if (blob && st.role !== "viewer") { await call("PUT", "/trips/" + id + "/cover", { key: st.key, to: at(id), raw: blob }); st.cover = t.coverAt; }
      else {
        const r = await call("GET", "/trips/" + id + "/cover", { key: st.key, to: at(id) }).catch((e) => { if (e.status === 404) return null; throw e; });
        if (r) { await ctx.store.setCover(id, new Blob([r.data], { type: "image/jpeg" })); st.cover = t.coverAt; if (ctx.coverChanged) ctx.coverChanged(id); }
      }
    }
    if (pulled && ctx.filesChanged) ctx.filesChanged();
  }

  async function run() {
    if (!ctx || !S.enabled()) return;
    if (running) { again = true; return running; }
    running = (async () => {
      await load();
      S.busy = true;
      if (S.onStatus) S.onStatus();
      try {
        for (const id of Object.keys(state)) {
          // A trip on a server this page can't reach until it's opened again.
          if (!S.allowed(at(id))) continue;
          const r = await once(id);
          if (r.again) again = true;
        }
        S.status = { state: "idle", at: new Date().toISOString() };
      } catch (e) {
        S.status = { state: "error", error: e };
        if (window.Keel && Keel.errlog) Keel.errlog.note("share", String(e.message || e));
      } finally {
        running = null;
        S.busy = false;
        if (S.onStatus) S.onStatus();
        changed();
        if (again) { again = false; S.soon(); }
      }
    })();
    return running;
  }
  S.soon = (ms = 2000) => { if (!ctx || !S.enabled()) return; clearTimeout(timer); timer = setTimeout(run, ms); };
  S.now = run;
  let wired = false;
  S.start = (c) => {
    ctx = c;
    if (!S.enabled()) return;
    Promise.all([load(), pubLoad()]).then(changed);
    if (!wired) {
      wired = true;
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") S.soon(500); });
      window.addEventListener("online", () => S.soon());
      setInterval(() => { if (document.visibilityState === "visible" && Object.keys(state).length) run(); }, 60000);
    }
    S.soon(1500);
  };

  T.share = S;
})();
