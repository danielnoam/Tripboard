// Shared trips: the sharing server (server/worker.js) holds a trip that
// its owner shares, and every device on it syncs that one trip with it.
// It works beside GitHub sync, which still keeps your own copy of every
// trip; a trip's share keeps its own agreed copy and version.
//
// Each device on a shared trip has a key for it, kept in IndexedDB
// ("meta:shares", never in the doc). GitHub sync copies the keys to your
// own sync repo's shares.json, so your other devices open the trip as you:
//   { [trip id]: { key, version, base, role, hidden, files: { id: true }, cover } }
// A section someone doesn't see never reaches their device, so applying the
// server's copy drops it here too.
//
//   Tripboard.share.start({ getDoc, adopt, version, store, filesChanged, coverChanged, unshared })
//   .invite(trip) -> link    .join(tripId, code)    .leave(id)    .stop(id)
//   .shared(id) -> { role, hidden } or null    .onChange = () => …
(function () {
  const T = window.Tripboard;
  const G = T.merge;
  // The server, once it's deployed (server/README.md). Empty: no sharing.
  const SERVER = "";
  const APP_URL = "https://danielnoam.github.io/Tripboard/";
  const server = () => { try { return localStorage.getItem("tripboard.shareServer") || SERVER; } catch (e) { return SERVER; } };

  let ctx = null, state = {}, loaded = null, timer = null, running = null, again = false;
  const S = { onChange: null, status: { state: "idle" } };
  S.enabled = () => !!server();
  S.shared = (id) => (state[id] ? { role: state[id].role, hidden: state[id].hidden || [] } : null);

  // Keys this device let go of (left, removed, stopped), so a copy of them
  // in the sync repo isn't taken up again.
  let dropped = [];
  async function load() {
    if (!loaded) loaded = Promise.all([ctx.store.meta("shares"), ctx.store.meta("sharesDropped")])
      .then(([s, d]) => { state = s || {}; dropped = d || []; });
    return loaded;
  }
  const keep = () => Promise.all([ctx.store.setMeta("shares", state), ctx.store.setMeta("sharesDropped", dropped.slice(-200))]);

  // Your other devices: GitHub sync keeps each shared trip's key in your
  // sync repo (shares.json), so every device of yours opens the trip as you.
  S.keys = async () => { await load(); return Object.fromEntries(Object.entries(state).map(([id, st]) => [id, st.key]).sort()); };
  S.adoptKeys = async (keys) => {
    await load();
    let added = false;
    for (const [id, key] of Object.entries(keys || {})) {
      if (state[id] || typeof key !== "string" || dropped.includes(key) || !/^[\w-]{1,40}$/.test(id)) continue;
      state[id] = { key, version: 0, base: null, role: "editor", hidden: [], files: {}, cover: "" };
      added = true;
    }
    if (added) { await keep(); changed(); S.soon(0); }
  };
  const changed = () => { if (S.onChange) S.onChange(); };

  async function call(method, path, { key, body, raw } = {}) {
    const headers = {};
    if (key) headers.Authorization = "Bearer " + key;
    if (body) headers["Content-Type"] = "application/json";
    let r;
    try { r = await fetch(server().replace(/\/$/, "") + path, { method, headers, body: raw || (body ? JSON.stringify(body) : undefined) }); }
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
      const r = await call("POST", "/trips", { body: { bundle, person: { id: me().id, name: me().name } } });
      state[trip.id] = { key: r.data.key, version: 0, base: null, role: "owner", hidden: [], files: {}, cover: "" };
      await keep();
    }
    const r = await call("POST", "/trips/" + trip.id + "/invite", { key: state[trip.id].key });
    S.soon(0);
    changed();
    const base = /^(localhost|127\.)/.test(location.hostname) ? location.origin + location.pathname : APP_URL;
    return { link: base + "#/join/" + trip.id + "/" + r.data.code, expires: r.data.expires };
  };
  // A shared Google Maps list's places, read by the server (server/googlelist.js).
  S.googleList = async (url) => (await call("POST", "/google-list", { body: { url } })).data;
  S.stopLink = async (id) => { await call("DELETE", "/trips/" + id + "/invite", { key: state[id].key }); };

  // Joins a trip from an invite link; the trip comes to this device.
  S.join = async (tripId, code) => {
    await load();
    if (state[tripId]) return;
    const r = await call("POST", "/trips/" + tripId + "/join", { body: { code, person: { id: me().id, name: me().name } } });
    state[tripId] = { key: r.data.key, version: r.data.version, base: r.data.bundle, role: r.data.role, hidden: r.data.hidden, files: {}, cover: "" };
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
    await call("DELETE", "/trips/" + id + "/me", { key: state[id].key }).catch((e) => { if (e.status !== 401 && e.status !== 404) throw e; });
    await drop(id, "left");
  };
  S.stop = async (id) => {
    await call("DELETE", "/trips/" + id, { key: state[id].key }).catch((e) => { if (e.status !== 401 && e.status !== 404) throw e; });
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

  // One shared trip, synced with the server.
  async function once(id) {
    const st = state[id];
    const startVersion = ctx.version();
    let got;
    try { got = await call("GET", "/trips/" + id + (st.base ? "?v=" + st.version : ""), { key: st.key }); }
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
        const put = await call("PUT", "/trips/" + id, { key: st.key, body: { version, bundle: merged } });
        if (put.status === 409) { got = put.data.bundle ? { data: put.data } : await call("GET", "/trips/" + id, { key: st.key }); continue; }
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
        if (st.files[f.id]) continue;
        const blob = await ctx.store.file(f.id);
        if (blob) {
          if (st.role !== "viewer") await call("PUT", "/trips/" + id + "/files/" + f.id, { key: st.key, raw: blob });
          st.files[f.id] = true;
        } else {
          const r = await call("GET", "/trips/" + id + "/files/" + f.id, { key: st.key }).catch((e) => { if (e.status === 404) return null; throw e; });
          if (r) { await ctx.store.setFile(f.id, new Blob([r.data], { type: f.type })); st.files[f.id] = true; pulled = true; }
        }
      }
    }
    const t = merged.trip;
    if (t.cover && t.coverAt && st.cover !== t.coverAt) {
      const ours = mine.trip && mine.trip.cover && mine.trip.coverAt === t.coverAt;
      const blob = ours && await ctx.store.cover(id);
      if (blob && st.role !== "viewer") { await call("PUT", "/trips/" + id + "/cover", { key: st.key, raw: blob }); st.cover = t.coverAt; }
      else {
        const r = await call("GET", "/trips/" + id + "/cover", { key: st.key }).catch((e) => { if (e.status === 404) return null; throw e; });
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
      try {
        for (const id of Object.keys(state)) {
          const r = await once(id);
          if (r.again) again = true;
        }
        S.status = { state: "idle", at: new Date().toISOString() };
      } catch (e) {
        S.status = { state: "error", error: e };
        if (window.Keel && Keel.errlog) Keel.errlog.note("share", String(e.message || e));
      } finally {
        running = null;
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
    load().then(changed);
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
