// Tripboard: the app's start. keel's files (src/keel/) load before it:
// errlog.js first, then platform.js (where it runs), releases.js and
// update.js (updates) and motion.js (springs and moves); then
// Tripboard's own model.js (the data and the board's sorts), store.js (IndexedDB), icons.js and
// views.js (the screens and sheets).
(function () {
  const APP_VERSION = "0.5.2";
  const K = window.Keel;
  const $ = (id) => document.getElementById(id);
  const T = window.Tripboard;
  // index.html is written in English; its marked words turn once, here.
  if (window.i18n.lang !== "en") window.i18n.apply();


  // The theme: Settings' choice, or the system's light or dark.
  const dark = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const theme = () => {
    const pick = T.settings.get().appearance.theme;
    document.documentElement.dataset.theme = pick === "system" ? (dark && dark.matches ? "dark" : "light") : pick;
  };
  theme();
  if (dark && dark.addEventListener) dark.addEventListener("change", theme);
  T.settings.onChange(theme);

  // The web copy works offline through sw.js. A bundled app (phone,
  // desktop) has its files on the device and no service worker.
  if ("serviceWorker" in navigator && location.protocol === "https:" && !K.platform.bundled) {
    navigator.serviceWorker.register("sw.js").catch((e) => K.errlog.note("sw", String(e)));
  }

  // A newer release on GitHub, for the apps; the web copy updates itself.
  // Its name is the one on the release's assets (Tripboard.apk) and in
  // the test build cache sw.js serves from. On the channel "unreleased"
  // (releases.setChannel(), kept on this device; no switch until the apps
  // are on) the newest build of main is offered too, from the site's
  // unreleased/ (keel's tools/unreleased.js).
  const releases = K.releases.create({ name: "Tripboard", repo: () => (K.platform.build && K.platform.build.repo) || null });
  // The bar's Update downloads and installs it (keel's update.js). A
  // closed bar stays closed for that version until a newer one is out.
  const updater = K.platform.bundled ? K.update.create({ name: "Tripboard" }) : null;
  const mine = (b) => ({ version: APP_VERSION, sha: b && b.sha, at: b && b.builtAt });
  const kind = () => (K.platform.desktopOs === "windows" ? "windows" : K.platform.os === "android" ? "android" : null);
  if (updater) {
    K.platform.ready.then((b) => {
      updater.clearOld(mine(b));
      return releases.check(mine(b), kind());
    }).then((u) => {
      if (u) updater.offer(u, { bar: $("update"), text: $("updateText"), btn: $("updateBtn"), close: $("updateClose") }, i18n.t);
    }).catch(() => { /* offline: ask again next launch */ });
  }

  // Settings › About's Check for updates. The apps ask GitHub and offer
  // the update in About's own bar (a closed bottom bar doesn't hide it).
  // The web copy asks for a new sw.js, which comes with every release;
  // once it's in, a reload runs the new version. Resolves
  // { update, offer(els) } (apps), { reload: true } (web) or { current: true };
  // throws when it couldn't ask.
  async function checkUpdates() {
    if (updater) {
      const u = await releases.check(mine(await K.platform.ready), kind());
      if (!u) return { current: true };
      return { update: u, offer: (els) => { updater.skip(""); return updater.offer(u, els, i18n.t); } };
    }
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (!reg) return { current: true };
    await reg.update();
    const w = reg.installing || reg.waiting;
    if (!w) return { current: true };
    await new Promise((ok, fail) => {
      const done = () => { if (w.state === "activated") ok(); else if (w.state === "redundant") fail(new Error("install")); };
      w.addEventListener("statechange", done);
      done();
    });
    return { reload: true };
  }

  // Motion: keel's moves on this app's springs. Pass touch and desktop
  // springs to create() to give the app its own feel; DESIGN.md (once
  // there is one) says which moves it uses.
  const motion = K.motion.create();

  Object.assign(T, { version: APP_VERSION, releases, motion, checkUpdates });

  // Saves wait a moment, so a burst of changes is one write.
  let timer = null, latest = null;
  const save = (doc) => {
    latest = doc;
    clearTimeout(timer);
    timer = setTimeout(() => T.store.save(latest), 250);
  };
  addEventListener("pagehide", () => { if (timer) { clearTimeout(timer); T.store.save(latest); } });

  // Google's sign-in window comes back to a copy of the app that only
  // hands the token over and closes (src/drive.js).
  if (T.drive && T.drive.closing) return;

  T.store.init()
    .then(() => T.store.load())
    .catch((e) => { K.errlog.note("load", String(e)); return null; })
    .then((doc) => T.views.start({ doc: doc || { trips: [], places: [] }, store: T.store, motion, save }));
})();
