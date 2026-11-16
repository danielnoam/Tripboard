// Tripboard's settings, on this device only (localStorage). Two parts:
//   providers  each map or search provider's own setup (a key, a style)
//   map, search  which provider each service uses, and its fallback
//   appearance  the theme: system, light or dark
//   sync        GitHub sync's token and repo
//   me          who you are on shared trips: an id (made once, or taken from
//               the sync repo so all your devices share it), and your name
//   categories  your own list of place categories, once you change the
//               defaults: { list: [{ id, name? }], at }. GitHub sync keeps it
//               in categories.json, and the newer list wins.
// A service tries its main provider; if that fails (no key, an error, a
// quota used up) it uses the fallback and says so. Keys are sent only to
// their own provider, when it's used.
(function () {
  // In the browser i18n comes from src/language.js; in Node (tests, the CLI) the English stays.
  const i18n = (typeof window === "object" && window.i18n) || { t: (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m)), tn: (n, one, other, v) => (n === 1 ? one : other).replace(/\{(\w+)\}/g, (m, k) => (k === "n" ? n : v && k in v ? v[k] : m)) };
  const KEY = "tripboard.settings";
  // What each provider offers, and what it needs set up.
  const PROVIDERS = {
    openfreemap: { name: "OpenFreeMap", services: ["map"], key: false, note: i18n.t("Free map, no key."),
      options: { style: [["light", i18n.t("Light (dark in dark mode)")], ["liberty", "Liberty"], ["bright", "Bright"]] } },
    osm: { name: "OpenStreetMap", services: ["search"], key: false, note: i18n.t("Free search, no key, about one search a second.") },
    google: { name: "Google", services: ["map", "search"], key: true, note: i18n.t("Google's map and Places search, with your own key."),
      options: { mapType: [["roadmap", i18n.t("Map")], ["satellite", i18n.t("Satellite")]] } },
    maptiler: { name: "MapTiler", services: ["map", "search"], key: true, note: i18n.t("Maps and search with a free MapTiler key (a monthly allowance)."),
      options: { style: [["streets", i18n.t("Streets")], ["outdoor", i18n.t("Outdoor")], ["satellite", i18n.t("Satellite")]] } },
  };
  const DEFAULTS = {
    providers: { openfreemap: { style: "light" }, osm: {}, google: { key: "", mapType: "roadmap" }, maptiler: { key: "", style: "streets" } },
    map: { main: "openfreemap", fallback: "" },
    search: { main: "osm", fallback: "" },
    appearance: { theme: "system" },
    // GitHub sync: a fine-grained token for one private repo of yours.
    sync: { token: "", owner: "", repo: "tripboard-data", branch: "" },
    me: { id: "", name: "" },
    categories: null,
  };
  const catsOf = (c) => {
    if (!c || !Array.isArray(c.list) || typeof c.at !== "string") return null;
    const list = c.list.filter((x) => x && typeof x.id === "string" && /^[\w-]{1,40}$/.test(x.id)).slice(0, 60)
      .map((x) => (typeof x.name === "string" && x.name.trim() ? { id: x.id, name: x.name.trim().slice(0, 40) } : { id: x.id }));
    return list.length ? { list, at: c.at } : null;
  };
  const newPersonId = () => "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const merge = (saved) => {
    const out = JSON.parse(JSON.stringify(DEFAULTS));
    if (!saved || typeof saved !== "object") return out;
    for (const id of Object.keys(out.providers)) Object.assign(out.providers[id], (saved.providers || {})[id]);
    for (const svc of ["map", "search"]) {
      const s = saved[svc] || {};
      const ok = (p) => PROVIDERS[p] && PROVIDERS[p].services.includes(svc);
      if (ok(s.main)) out[svc].main = s.main;
      if (s.fallback === "" || ok(s.fallback)) out[svc].fallback = s.fallback || "";
    }
    const th = saved.appearance && saved.appearance.theme;
    if (["system", "light", "dark"].includes(th)) out.appearance.theme = th;
    for (const k of Object.keys(out.sync)) if (saved.sync && typeof saved.sync[k] === "string") out.sync[k] = saved.sync[k];
    const me = saved.me || {};
    if (typeof me.id === "string" && /^[\w-]{4,40}$/.test(me.id)) out.me.id = me.id;
    if (typeof me.name === "string") out.me.name = me.name.trim().slice(0, 60);
    out.categories = catsOf(saved.categories);
    if (Array.isArray(me.was)) out.me.was = me.was.filter((x) => typeof x === "string" && /^[\w-]{4,40}$/.test(x)).slice(-5);
    return out;
  };
  let cur;
  try { cur = merge(JSON.parse(localStorage.getItem(KEY) || "null")); } catch (e) { cur = merge(null); }
  // An id for you, made once on this device; it marks what you change.
  if (!cur.me.id) { cur.me.id = newPersonId(); try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch (e) { /* this visit */ } }
  const listeners = [];
  const S = {
    PROVIDERS,
    get: () => JSON.parse(JSON.stringify(cur)),
    provider: (id) => ({ ...cur.providers[id] }),
    setProvider(id, patch) { cur.providers[id] = { ...cur.providers[id], ...patch }; S.save(); },
    setTheme(theme) { cur.appearance = { theme }; S.save(); },
    setMe(patch) { cur.me = { ...cur.me, ...patch, id: cur.me.id }; cur.me.name = String(cur.me.name || "").trim().slice(0, 60); S.save(); },
    // Takes the id your other devices use (sync's me.json), remembering the
    // old one so trips that named it can be moved over.
    adoptId(id) {
      if (!/^[\w-]{4,40}$/.test(id) || id === cur.me.id) return;
      cur.me = { ...cur.me, was: (cur.me.was || []).concat(cur.me.id).filter((x) => x !== id).slice(-5), id };
      S.save();
    },
    setCategories(list) { cur.categories = catsOf({ list, at: new Date().toISOString() }); S.save(); },
    // Another device's list (sync's categories.json), if it's newer than this one's.
    adoptCategories(c) {
      const got = catsOf(c);
      if (!got || (cur.categories && cur.categories.at >= got.at)) return false;
      cur.categories = got;
      S.save();
      return true;
    },
    setSync(patch) { cur.sync = { ...cur.sync, ...patch }; S.save(); },
    setService(svc, patch) { cur[svc] = { ...cur[svc], ...patch }; if (cur[svc].fallback === cur[svc].main) cur[svc].fallback = ""; S.save(); },
    save() {
      try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch (e) { /* kept for this visit */ }
      for (const f of listeners) f(S.get());
    },
    onChange: (f) => listeners.push(f),
    // A provider is ready when it needs no key or has one.
    ready: (id) => !!PROVIDERS[id] && (!PROVIDERS[id].key || !!String(cur.providers[id].key || "").trim()),
    // The providers a service will try, in order.
    chain: (svc) => [cur[svc].main, cur[svc].fallback].filter(Boolean),
    merge,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = S;
  else { window.Tripboard = window.Tripboard || {}; window.Tripboard.settings = S; }
})();
