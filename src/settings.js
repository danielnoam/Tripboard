// Tripboard's settings, on this device only (localStorage). Two parts:
//   providers  each map or search provider's own setup (a key, a style),
//              and for a key, how it last went: check { ok, at }, set by
//              Test or by the map or search being refused, and cleared
//              when the key changes
//   map, search  which provider each service uses, and its fallback
//   appearance  the theme: system, light or dark
//   display     the clock ("" this device's, "12" or "24") and, in English,
//               the date order ("" the language's, "md" Nov 21, "dm" 21 Nov)
//   view        how place cards show their category ("icon", "both" or
//               "label") and importance ("color", "both" or "label"), and
//               when the map names its pins ("hover": pointed at or
//               selected, or "always"); ratings on cards ("show" or "hide")
//   sync        GitHub sync's token and repo
//   me          who you are on shared trips: an id (made once, or taken from
//               the sync repo so all your devices share it), and your name
//   weather     the forecast on Today and each day: on (true), off (false)
//               or not asked yet (null), and the unit ("c", "f", or "" for
//               this device's usual one)
//   categories  your own list of place categories, once you change the
//               defaults: { list: [{ id, name? }], at }. GitHub sync keeps it
//               in categories.json, and the newer list wins.
//   keySync     whether the map and search keys travel in the sync repo's
//               keys.json: { on, at }. The newer change wins, and while
//               it's on each key's newer change (providers[id].keyAt) wins.
//   ai          whether AI tools (the CLI, the MCP and the cloud connector)
//               may delete: { deleting, at }. Off until you turn it on.
//               GitHub sync keeps it in ai.json, the newer change wins, and
//               those tools read it but never write it.
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
      options: { style: [["light", i18n.t("Light (dark in dark mode)")], ["positron", i18n.t("Light")], ["dark", i18n.t("Dark")], ["liberty", "Liberty"], ["bright", "Bright"]] } },
    osm: { name: "OpenStreetMap", services: ["search"], key: false, note: i18n.t("Free search, no key, about one search a second.") },
    google: { name: "Google", services: ["map", "search"], key: true, note: i18n.t("Google's map and Places search, with your own key."),
      options: { mapType: [["roadmap", i18n.t("Map")], ["satellite", i18n.t("Satellite")], ["terrain", i18n.t("Terrain")]] } },
    maptiler: { name: "MapTiler", services: ["map", "search"], key: true, note: i18n.t("Maps and search with a free MapTiler key (a monthly allowance)."),
      options: { style: [["streets", i18n.t("Streets")], ["outdoor", i18n.t("Outdoor")], ["satellite", i18n.t("Satellite")]] } },
  };
  const DEFAULTS = {
    providers: { openfreemap: { style: "light" }, osm: {}, google: { key: "", mapType: "roadmap" }, maptiler: { key: "", style: "streets" } },
    map: { main: "openfreemap", fallback: "" },
    search: { main: "osm", fallback: "" },
    appearance: { theme: "system" },
    display: { clock: "", dates: "" },
    view: { cat: "both", imp: "both", labels: "hover", ratings: "show" },
    // GitHub sync: a fine-grained token for one private repo of yours.
    sync: { token: "", owner: "", repo: "tripboard-data", branch: "" },
    me: { id: "", name: "" },
    weather: { on: null, unit: "" },
    categories: null,
    ai: { deleting: false, at: "" },
    keySync: { on: false, at: "" },
  };
  const aiOf = (c) => (c && typeof c.deleting === "boolean" && typeof c.at === "string" ? { deleting: c.deleting, at: c.at } : null);
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
    for (const id of Object.keys(out.providers)) {
      Object.assign(out.providers[id], (saved.providers || {})[id]);
      const ck = out.providers[id].check;
      if (ck !== undefined && !(ck && typeof ck.ok === "boolean" && typeof ck.at === "string")) delete out.providers[id].check;
    }
    for (const svc of ["map", "search"]) {
      const s = saved[svc] || {};
      const ok = (p) => PROVIDERS[p] && PROVIDERS[p].services.includes(svc);
      if (ok(s.main)) out[svc].main = s.main;
      if (s.fallback === "" || ok(s.fallback)) out[svc].fallback = s.fallback || "";
    }
    const w = saved.weather || {};
    if (typeof w.on === "boolean") out.weather.on = w.on;
    if (["c", "f"].includes(w.unit)) out.weather.unit = w.unit;
    const dp = saved.display || {};
    if (["12", "24"].includes(dp.clock)) out.display.clock = dp.clock;
    if (["md", "dm"].includes(dp.dates)) out.display.dates = dp.dates;
    const vw = saved.view || {};
    if (["icon", "both", "label"].includes(vw.cat)) out.view.cat = vw.cat;
    if (["color", "both", "label"].includes(vw.imp)) out.view.imp = vw.imp;
    if (["hover", "always"].includes(vw.labels)) out.view.labels = vw.labels;
    if (["show", "hide"].includes(vw.ratings)) out.view.ratings = vw.ratings;
    const th = saved.appearance && saved.appearance.theme;
    if (["system", "light", "dark"].includes(th)) out.appearance.theme = th;
    for (const k of Object.keys(out.sync)) if (saved.sync && typeof saved.sync[k] === "string") out.sync[k] = saved.sync[k];
    const me = saved.me || {};
    if (typeof me.id === "string" && /^[\w-]{4,40}$/.test(me.id)) out.me.id = me.id;
    if (typeof me.name === "string") out.me.name = me.name.trim().slice(0, 60);
    out.categories = catsOf(saved.categories);
    out.ai = aiOf(saved.ai) || out.ai;
    const ks = saved.keySync || {};
    if (typeof ks.on === "boolean" && typeof ks.at === "string") out.keySync = { on: ks.on, at: ks.at };
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
    setProvider(id, patch) {
      const was = cur.providers[id] || {};
      cur.providers[id] = { ...was, ...patch };
      if ("key" in patch && patch.key !== was.key) { delete cur.providers[id].check; cur.providers[id].keyAt = new Date().toISOString(); }
      S.save();
    },
    // How a key last went: true (it worked) or false (refused). Saved
    // without telling listeners, since a map or search reports it as it
    // runs and shouldn't make itself run again.
    setCheck(id, ok) {
      const p = cur.providers[id];
      if (!p || !PROVIDERS[id].key || !String(p.key || "").trim()) return;
      if (p.check && p.check.ok === !!ok) return;
      p.check = { ok: !!ok, at: new Date().toISOString() };
      try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch (e) { /* kept for this visit */ }
    },
    setKeySync(on) { cur.keySync = { on: !!on, at: new Date().toISOString() }; S.save(); },
    // What keys.json holds: the switch, and while it's on, each key.
    keysFile() {
      const out = { on: cur.keySync.on, at: cur.keySync.at };
      if (out.on) {
        out.keys = {};
        for (const id of Object.keys(PROVIDERS)) if (PROVIDERS[id].key) out.keys[id] = { key: String(cur.providers[id].key || ""), at: cur.providers[id].keyAt || "" };
      }
      return out;
    },
    // Another device's keys.json: a newer switch wins, then (while on) each
    // newer key. True if anything changed here.
    adoptKeys(f) {
      if (!f || typeof f !== "object") return false;
      let changed = false;
      if (typeof f.on === "boolean" && typeof f.at === "string" && f.at > cur.keySync.at) { cur.keySync = { on: f.on, at: f.at }; changed = true; }
      if (cur.keySync.on && f.keys && typeof f.keys === "object") {
        for (const id of Object.keys(PROVIDERS)) {
          const k = f.keys[id];
          if (!PROVIDERS[id].key || !k || typeof k.key !== "string" || typeof k.at !== "string" || k.key.length > 400) continue;
          const p = cur.providers[id];
          if (k.at <= (p.keyAt || "")) continue;
          if (k.key !== p.key) delete p.check;
          p.key = k.key.trim();
          p.keyAt = k.at;
          changed = true;
        }
      }
      if (changed) S.save();
      return changed;
    },
    // A key's state: "none", "unchecked", "ok" or "refused".
    keyState(id) {
      const p = cur.providers[id] || {};
      if (!PROVIDERS[id] || !PROVIDERS[id].key || !String(p.key || "").trim()) return "none";
      return !p.check ? "unchecked" : p.check.ok ? "ok" : "refused";
    },
    setWeather(patch) { cur.weather = { ...cur.weather, ...patch }; S.save(); },
    setDisplay(patch) { cur.display = { ...cur.display, ...patch }; S.save(); },
    setView(patch) { cur.view = { ...cur.view, ...patch }; S.save(); },
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
    setAi(deleting) { cur.ai = { deleting: !!deleting, at: new Date().toISOString() }; S.save(); },
    // Another device's choice (sync's ai.json), if it's newer than this one's.
    adoptAi(c) {
      const got = aiOf(c);
      if (!got || (cur.ai.at && cur.ai.at >= got.at)) return false;
      cur.ai = got;
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
