// Tripboard's settings, on this device only (localStorage). Two parts:
//   providers  each map or search provider's own setup (a key, a style)
//   map, search  which provider each service uses, and its fallback
//   appearance  the theme: system, light or dark
//   sync        GitHub sync's token and repo
// A service tries its main provider; if that fails (no key, an error, a
// quota used up) it uses the fallback and says so. Keys are sent only to
// their own provider, when it's used.
(function () {
  const KEY = "tripboard.settings";
  // What each provider offers, and what it needs set up.
  const PROVIDERS = {
    openfreemap: { name: "OpenFreeMap", services: ["map"], key: false, note: "Free map, no key.",
      options: { style: [["light", "Light (dark in dark mode)"], ["liberty", "Liberty"], ["bright", "Bright"]] } },
    osm: { name: "OpenStreetMap", services: ["search"], key: false, note: "Free search, no key, about one search a second." },
    google: { name: "Google", services: ["map", "search"], key: true, note: "Google's map and Places search, with your own key.",
      options: { mapType: [["roadmap", "Map"], ["satellite", "Satellite"]] } },
    maptiler: { name: "MapTiler", services: ["map", "search"], key: true, note: "Maps and search with a free MapTiler key (a monthly allowance).",
      options: { style: [["streets", "Streets"], ["outdoor", "Outdoor"], ["satellite", "Satellite"]] } },
  };
  const DEFAULTS = {
    providers: { openfreemap: { style: "light" }, osm: {}, google: { key: "", mapType: "roadmap" }, maptiler: { key: "", style: "streets" } },
    map: { main: "openfreemap", fallback: "" },
    search: { main: "osm", fallback: "" },
    appearance: { theme: "system" },
    // GitHub sync: a fine-grained token for one private repo of yours.
    sync: { token: "", owner: "", repo: "tripboard-data", branch: "" },
  };
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
    return out;
  };
  let cur;
  try { cur = merge(JSON.parse(localStorage.getItem(KEY) || "null")); } catch (e) { cur = merge(null); }
  const listeners = [];
  const S = {
    PROVIDERS,
    get: () => JSON.parse(JSON.stringify(cur)),
    provider: (id) => ({ ...cur.providers[id] }),
    setProvider(id, patch) { cur.providers[id] = { ...cur.providers[id], ...patch }; S.save(); },
    setTheme(theme) { cur.appearance = { theme }; S.save(); },
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
