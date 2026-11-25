// GitHub sync: your trips in a private repo of yours, so every device you
// connect sees the same trips. keel's github.js makes the calls; what goes
// in the repo and how two copies merge are Tripboard's (src/merge.js).
//
// The repo holds one file per trip, trips/<id>.json (a bundle), and its
// cover photo, covers/<id>.jpg, and each file kept with a trip,
// files/<trip id>/<file id> (named by id only; its name is in the bundle),
// me.json, the person id all your devices use, categories.json, your own
// place categories (the newer list wins), ai.json, whether AI tools may
// delete (the newer change wins; only the app writes it), keys.json, the map
// and search keys while Settings › Services › Sync keys is on (each newer
// change wins; nothing but the app reads it), shares.json, the keys
// of the shared trips you're on, and published.json, the keys of the trips
// you published (both src/share.js). A sync reads the repo's tree in one call,
// fetches only the trips whose file changed since the last sync, merges
// them three ways against the copy both sides last agreed on (kept in
// IndexedDB as "meta:sync"), and writes everything that differs in one
// commit. If the repo moved on meanwhile, it starts over.
//
//   Tripboard.sync.start({ getDoc, adopt, version, store })
//   .soon()   after a change     .now()   from Settings
//   .status   { state: "off"|"idle"|"syncing"|"error", at, error }
//   .onStatus = (status) => …
(function () {
  // In the browser i18n comes from src/language.js; in Node (tests, the CLI) the English stays.
  const i18n = (typeof window === "object" && window.i18n) || { t: (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m)), tn: (n, one, other, v) => (n === 1 ? one : other).replace(/\{(\w+)\}/g, (m, k) => (k === "n" ? n : v && k in v ? v[k] : m)) };
  const K = window.Keel;
  const T = window.Tripboard;
  const G = T.merge;
  let ctx = null, timer = null, running = null, again = false;
  const S = { status: { state: "off" }, onStatus: null };

  const cfg = () => T.settings.get().sync;
  S.connected = () => { const c = cfg(); return !!(c.token && c.owner && c.repo); };
  const gh = K.github.client(() => ({ ...cfg(), branch: cfg().branch || "main" }));

  function setStatus(s) {
    S.status = { ...S.status, ...s };
    if (S.onStatus) S.onStatus(S.status);
  }
  // What a failure means, in words for Settings.
  S.explain = (e) => !e ? "" : e.kind === "offline" ? i18n.t("No connection. It syncs when you're back online.")
    : e.kind === "auth" ? i18n.t("GitHub refused the token. Check it can read and write the repo's contents.")
    : e.kind === "ratelimit" ? i18n.t("GitHub asks to wait a little. It tries again soon.")
    : e.empty ? i18n.t("The repo is empty. On GitHub, add a README to it, then sync again.")
    : e.status === 404 ? i18n.t("GitHub can't find that repo with this token.")
    : i18n.t("Sync didn't finish: {why}", { why: e.detail || e.message });

  const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
  const text = (b) => JSON.stringify(b, null, 1);

  async function once() {
    const store = ctx.store;
    const branch = cfg().branch || "main";
    const state = (await store.meta("sync")) || { shas: {}, base: {}, cover: {} };
    if (state.repo !== cfg().owner + "/" + cfg().repo) Object.assign(state, { repo: cfg().owner + "/" + cfg().repo, shas: {}, base: {}, cover: {}, files: {} });
    state.files = state.files || {};
    const startVersion = ctx.version();
    const startText = JSON.stringify(ctx.getDoc());
    const startDoc = JSON.parse(startText);
    // A cover from before sync has no coverAt yet; it gets one so it travels.
    for (const t of startDoc.trips) if (t.cover && !t.coverAt) t.coverAt = t.createdAt || "2000-01-01T00:00:00.000Z";

    // The repo as it is: one call for every path and its sha.
    const head = await gh.json("GET", "git/ref/heads/" + encodeURIComponent(branch)).catch((e) => { if (e.status === 409) e.empty = true; throw e; });
    const tree = head ? await gh.json("GET", "git/trees/" + head.object.sha + "?recursive=1") : { tree: [] };
    const remote = new Map((tree.tree || []).filter((f) => f.type === "blob").map((f) => [f.path, f.sha]));

    // Pull and merge the trips whose file changed.
    let doc = startDoc;
    const theirs = {};
    const remoteIds = [...remote.keys()].map((p) => (/^trips\/([\w-]+)\.json$/.exec(p) || [])[1]).filter(Boolean);
    for (const id of remoteIds) {
      const path = "trips/" + id + ".json";
      if (state.shas[path] === remote.get(path) && state.base[id]) { theirs[id] = state.base[id]; continue; }
      const got = await gh.getJson(path);
      if (!got) continue;
      theirs[id] = got.data;
      const merged = G.mergeBundles(state.base[id], G.bundleOf(doc, id), got.data);
      doc = G.applyBundle(doc, merged);
    }
    // One id for you on all your devices: the first to sync keeps it in
    // me.json, and the others take it. Trips that named an old id move over.
    const writes = [], sent = {};
    let me = T.settings.get().me;
    if (remote.has("me.json")) {
      if (state.me !== remote.get("me.json")) {
        const got = await gh.getJson("me.json");
        const id = got && got.data && got.data.id;
        if (typeof id === "string" && id !== me.id) { T.settings.adoptId(id); me = T.settings.get().me; }
        state.me = remote.get("me.json");
      }
    } else writes.push({ path: "me.json", text: text({ id: me.id }) });
    for (const old of me.was || []) doc = T.model.renamePerson(doc, old, me.id);

    // Your categories: the newer list wins, whichever device it's on.
    const myCats = () => T.settings.get().categories;
    if (remote.has("categories.json") && state.catsSha !== remote.get("categories.json")) {
      const got = await gh.getJson("categories.json");
      if (got && got.data && T.settings.adoptCategories(got.data) && T.views) T.views.render();
      state.catsSha = remote.get("categories.json");
      state.catsAt = (got && got.data && got.data.at) || "";
    }
    if (myCats() && myCats().at !== state.catsAt && (!state.catsAt || myCats().at > state.catsAt)) {
      writes.push({ path: "categories.json", text: text(myCats()) });
      state.catsAt = myCats().at;
    }
    // Whether AI tools may delete: the newer change wins, as with categories.
    const myAi = () => T.settings.get().ai;
    if (remote.has("ai.json") && state.aiSha !== remote.get("ai.json")) {
      const got = await gh.getJson("ai.json");
      if (got && got.data && T.settings.adoptAi(got.data) && T.views) T.views.render();
      state.aiSha = remote.get("ai.json");
      state.aiAt = (got && got.data && got.data.at) || "";
    }
    if (myAi().at && myAi().at !== state.aiAt && (!state.aiAt || myAi().at > state.aiAt)) {
      writes.push({ path: "ai.json", text: text(myAi()) });
      state.aiAt = myAi().at;
    }

    // The map and search keys, once Sync keys has been touched on any
    // device: the newer switch, then each newer key, wins.
    if (remote.has("keys.json") && state.keysSha !== remote.get("keys.json")) {
      const got = await gh.getJson("keys.json");
      if (got && got.data && T.settings.adoptKeys(got.data) && T.views) T.views.render();
      state.keysSha = remote.get("keys.json");
      state.keysSeen = got && got.data ? text(got.data) : "";
    }
    const myKeyFile = T.settings.keysFile();
    if (myKeyFile.at && text(myKeyFile) !== (remote.has("keys.json") ? state.keysSeen : "")) {
      writes.push({ path: "keys.json", text: text(myKeyFile) });
      state.keysSeen = text(myKeyFile);
    }

    // Shared trips' keys travel to your other devices in shares.json, so
    // each opens them as you (src/share.js). Your own repo only.
    if (T.share && T.share.enabled()) {
      let theirKeys = state.sharesSeen || {};
      if (remote.has("shares.json") && state.sharesSha !== remote.get("shares.json")) {
        const got = await gh.getJson("shares.json");
        theirKeys = (got && got.data) || {};
        state.sharesSha = remote.get("shares.json");
        state.sharesSeen = theirKeys;
      }
      await T.share.adoptKeys(theirKeys);
      const myKeys = await T.share.keys();
      if (JSON.stringify(myKeys) !== JSON.stringify(remote.has("shares.json") ? theirKeys : {})) writes.push({ path: "shares.json", text: text(myKeys) });
    }
    // Published trips' keys, so any of your devices can publish one again
    // or stop it (src/share.js). The newer change to each wins.
    if (T.share && T.share.enabled()) {
      let theirPubs = state.pubsSeen || {};
      if (remote.has("published.json") && state.pubsSha !== remote.get("published.json")) {
        const got = await gh.getJson("published.json");
        theirPubs = (got && got.data) || {};
        state.pubsSha = remote.get("published.json");
        state.pubsSeen = theirPubs;
      }
      await T.share.adoptPubKeys(theirPubs);
      const myPubs = await T.share.pubKeys();
      if (JSON.stringify(myPubs) !== JSON.stringify(remote.has("published.json") ? theirPubs : {})) writes.push({ path: "published.json", text: text(myPubs) });
    }
    doc = T.model.sanitizeDoc(doc);

    // What to write: every trip that differs from the repo's copy.
    for (const id of new Set(G.tripIds(doc).concat(remoteIds))) {
      const mine = G.bundleOf(doc, id);
      if (!mine) continue;
      if (theirs[id] && JSON.stringify(mine) === JSON.stringify(theirs[id])) { sent[id] = mine; continue; }
      writes.push({ path: "trips/" + id + ".json", text: text(mine) });
      sent[id] = mine;
    }

    // Covers: the copy whose coverAt won the merge. Ours goes up when it
    // won and isn't there yet; theirs comes down when it won.
    const coverPulls = [], coverDrops = [];
    for (const t of doc.trips) {
      const path = "covers/" + t.id + ".jpg";
      const mine = (startDoc.trips.find((x) => x.id === t.id) || {}).coverAt || "";
      const have = state.cover[t.id] || "";
      if (t.cover && t.coverAt && t.coverAt === mine && have !== t.coverAt) {
        const blob = await store.cover(t.id);
        if (blob) {
          const sha = await gh.createBlob(await bytesOf(blob));
          writes.push({ path, sha });
          state.cover[t.id] = t.coverAt;
        }
      } else if (t.cover && t.coverAt && t.coverAt !== mine && remote.has(path)) {
        coverPulls.push(t);
      } else if (!t.cover && (t.coverAt || "") === mine) {
        if (remote.has(path)) writes.push({ path, sha: null });
        delete state.cover[t.id];
      } else if (!t.cover && t.coverAt && t.coverAt !== mine) {
        coverDrops.push(t);
      }
    }
    for (const id of Object.keys(doc.deleted || {})) {
      if (doc.deleted[id].trip === id && remote.has("covers/" + id + ".jpg")) writes.push({ path: "covers/" + id + ".jpg", sha: null });
    }

    // Files: their bytes never change (a new version is a new file), so
    // each goes up once, comes down once, and goes when its record does.
    const filePulls = [];
    const fileIds = new Set((doc.files || []).filter((f) => !f.local).map((f) => f.id));
    const localIds = new Set((doc.files || []).filter((f) => f.local).map((f) => f.id));
    // Links and notes have no bytes; their record is all there is.
    // Only ids a file could really have, so one like "../keys.json" never
    // turns into a path outside files/.
    for (const f of (doc.files || []).filter((x) => !x.local && x.kind !== "link" && x.kind !== "note" && /^[\w-]{1,80}$/.test(x.id) && /^[\w-]{1,80}$/.test(x.trip))) {
      const path = "files/" + f.trip + "/" + f.id;
      if (state.files[f.id] && remote.has(path)) continue;
      const blob = await store.file(f.id);
      if (blob && !remote.has(path)) {
        writes.push({ path, sha: await gh.createBlob(await bytesOf(blob)) });
        state.files[f.id] = true;
      } else if (!blob && remote.has(path)) filePulls.push(f);
      else if (blob) state.files[f.id] = true;
    }
    for (const path of remote.keys()) {
      const m = /^files\/([\w-]+)\/([\w-]+)$/.exec(path);
      if (!m || fileIds.has(m[2])) continue;
      const gone = doc.deleted || {};
      // Deleted, or made this-device-only: its bytes leave the repo.
      if (gone[m[2]] || gone[m[1]] || localIds.has(m[2])) { writes.push({ path, sha: null }); delete state.files[m[2]]; }
    }

    if (ctx.version() !== startVersion) return "again";

    if (writes.length) {
      await gh.commitFiles(writes, "Tripboard: sync " + writes.length + (writes.length === 1 ? " file" : " files"), {
        branch,
        root: async () => [],
        beforeTry: async () => {
          const now = await gh.json("GET", "git/ref/heads/" + encodeURIComponent(branch));
          if ((now && now.object.sha) !== (head && head.object.sha)) { const e = new Error("moved"); e.moved = true; throw e; }
        },
      });
    }
    for (const t of coverPulls) {
      const bytes = await gh.getRaw("covers/" + t.id + ".jpg", { as: "bytes" });
      if (bytes) { await store.setCover(t.id, new Blob([bytes], { type: "image/jpeg" })); state.cover[t.id] = t.coverAt; ctx.coverChanged(t.id); }
    }
    for (const f of filePulls) {
      const bytes = await gh.getRaw("files/" + f.trip + "/" + f.id, { as: "bytes" });
      if (bytes) { await store.setFile(f.id, new Blob([bytes], { type: f.type })); state.files[f.id] = true; }
    }
    for (const t of coverDrops) { await store.dropCover(t.id); delete state.cover[t.id]; ctx.coverChanged(t.id); }

    // The new agreed copy, and each file's sha as GitHub will name it.
    for (const [id, b] of Object.entries(sent)) {
      state.base[id] = b;
      state.shas["trips/" + id + ".json"] = (await K.github.blobSha(text(b))) || remote.get("trips/" + id + ".json");
    }
    await store.setMeta("sync", state);

    // Edits made while this ran are merged onto the result, not lost.
    let final = doc;
    if (ctx.version() !== startVersion) {
      const cur = ctx.getDoc();
      for (const id of new Set(G.tripIds(cur).concat(G.tripIds(doc)))) {
        final = G.applyBundle(final, G.mergeBundles(G.bundleOf(startDoc, id), G.bundleOf(cur, id), G.bundleOf(doc, id)));
      }
      again = true;
    }
    if (JSON.stringify(final) !== startText) ctx.adopt(final);
    if (filePulls.length && ctx.filesChanged) ctx.filesChanged();
    return "done";
  }

  async function run() {
    if (!S.connected()) { setStatus({ state: "off" }); return; }
    if (running) { again = true; return running; }
    running = (async () => {
      setStatus({ state: "syncing" });
      try {
        let tries = 0, r;
        do { r = await once().catch((e) => { if (e.moved && tries < 3) return "again"; throw e; }); } while (r === "again" && ++tries < 4);
        setStatus({ state: "idle", at: new Date().toISOString(), error: null });
      } catch (e) {
        K.errlog.note("sync", String(e));
        setStatus({ state: "error", error: e });
      } finally {
        running = null;
        if (again) { again = false; S.soon(); }
      }
    })();
    return running;
  }

  S.soon = () => { if (!ctx || !S.connected()) return; clearTimeout(timer); timer = setTimeout(run, 3000); };
  S.now = () => run();
  let wired = false;
  S.start = (c) => {
    ctx = c;
    if (!wired) {
      wired = true;
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") S.soon(); });
      window.addEventListener("online", () => S.soon());
      setInterval(() => { if (document.visibilityState === "visible" && S.connected()) run(); }, 5 * 60000);
    }
    if (S.connected()) setTimeout(run, 1000);
  };

  // Checks a token and repo before they're kept: who the token is, and
  // that it can see the repo. → { login, private } or throws.
  S.check = async ({ token, owner, repo }) => {
    const c = K.github.client({ token, owner, repo, branch: "main" });
    const info = await c.repoInfo(owner, repo);
    if (!info) { const e = new Error("no repo"); e.status = 404; throw e; }
    return { private: !!info.private, branch: info.default_branch || "main", permissions: info.permissions || {} };
  };
  // Forgets this device's sync notes (Disconnect).
  S.forget = async () => { if (ctx) await ctx.store.setMeta("sync", null); setStatus({ state: "off", at: null, error: null }); };

  T.sync = S;
})();
