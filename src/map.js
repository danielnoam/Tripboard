// The trip's map: MapLibre GL (src/vendor/, BSD-3), loaded the first time
// a map is opened, on the map provider Settings picks (OpenFreeMap,
// Google's 2D tiles or MapTiler), or its fallback when that one fails.
// One map, kept for the visit; views.js gives it the places and hears taps.
//   TripMap.open(container, { chain, providers }) → { by, skipped }
//   TripMap.places(list, selectedId)   pins, by importance
//   TripMap.fit(list)                  frames them
//   TripMap.route(list)                a line through them in order (a day's plan)
//   TripMap.onPin = (id) => …, TripMap.onTap = ({ lat, lng }) => …
(function () {
  // In the browser i18n comes from src/language.js; in Node (tests, the CLI) the English stays.
  const i18n = (typeof window === "object" && window.i18n) || { t: (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m)), tn: (n, one, other, v) => (n === 1 ? one : other).replace(/\{(\w+)\}/g, (m, k) => (k === "n" ? n : v && k in v ? v[k] : m)) };
  const OFM = "https://tiles.openfreemap.org/styles/";
  const MAPTILER = { streets: ["streets-v2", "streets-v2-dark"], outdoor: ["outdoor-v2", "outdoor-v2-dark"], satellite: ["hybrid", "hybrid"] };
  // Google's dark map, in its own styling rules (Map Tiles API `styles`).
  const NIGHT = [
    { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#9a9184" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
    { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#263c3f" }] },
  ];
  let lib = null, map = null, applied = "", google = null;
  const pins = new Map();
  const T = { onPin: null, onTap: null, get ready() { return !!map; } };

  async function getJson(url, who, init) {
    const res = await fetch(url, init);
    if (!res.ok) {
      let msg = "";
      try { const j = await res.json(); msg = (j.error && j.error.message) || j.message || ""; } catch (e) { /* no body */ }
      throw new Error(res.status === 401 || res.status === 403 || res.status === 400 ? (msg ? i18n.t("{who} refused the key: {msg}", { who, msg }) : i18n.t("{who} refused the key.", { who }))
        : res.status === 429 ? i18n.t("{who}'s quota is used up for now.", { who }) : i18n.t("{who}'s map didn't load ({status}).", { who, status: res.status }));
    }
    return res.json();
  }

  // Google's 2D tiles need a session, good for about two weeks; it's kept
  // on the device per key, map type, theme and language.
  async function googleSession(key, mapType, dark) {
    const lang = navigator.language || "en-US";
    const id = [key.slice(-6), mapType, dark && mapType === "roadmap" ? "dark" : "", lang].join("|");
    try {
      const c = JSON.parse(localStorage.getItem("tripboard.gsession") || "null");
      if (c && c.id === id && Number(c.expiry) * 1000 > Date.now() + 3600000) return c.session;
    } catch (e) { /* none kept */ }
    const hi = (window.devicePixelRatio || 1) > 1;
    const body = { mapType, language: lang, region: (lang.split("-")[1] || "US").toUpperCase(), scale: hi ? "scaleFactor2x" : "scaleFactor1x", highDpi: hi };
    if (mapType === "satellite") body.layerTypes = ["layerRoadmap"];
    if (dark && mapType === "roadmap") body.styles = NIGHT;
    const j = await getJson("https://tile.googleapis.com/v1/createSession?key=" + encodeURIComponent(key), "Google",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    try { localStorage.setItem("tripboard.gsession", JSON.stringify({ id, session: j.session, expiry: j.expiry })); } catch (e) { /* asks again next time */ }
    return j.session;
  }

  // Each provider's map as a MapLibre style object.
  const SOURCES = {
    async openfreemap(o, dark) {
      const name = o.style === "liberty" || o.style === "bright" ? o.style : dark ? "dark" : "positron";
      return getJson(OFM + name, "OpenFreeMap");
    },
    async maptiler(o, dark) {
      if (!o.key) throw new Error(i18n.t("{who} needs a key (Settings).", { who: "MapTiler" }));
      const pair = MAPTILER[o.style] || MAPTILER.streets;
      return getJson("https://api.maptiler.com/maps/" + pair[dark ? 1 : 0] + "/style.json?key=" + encodeURIComponent(o.key), "MapTiler");
    },
    async google(o, dark) {
      if (!o.key) throw new Error(i18n.t("{who} needs a key (Settings).", { who: "Google" }));
      const type = o.mapType === "satellite" ? "satellite" : "roadmap";
      const session = await googleSession(o.key, type, dark);
      return {
        version: 8,
        sources: { google: { type: "raster", tileSize: 256, maxzoom: 22,
          tiles: ["https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=" + session + "&key=" + encodeURIComponent(o.key)] } },
        layers: [{ id: "google", type: "raster", source: "google" }],
        __google: { session, key: o.key },
      };
    },
  };

  function css() {
    if (document.getElementById("maplibreCss")) return;
    const l = document.createElement("link");
    l.id = "maplibreCss";
    l.rel = "stylesheet";
    l.href = "src/vendor/maplibre-gl.css";
    document.head.append(l);
  }
  const dark = () => document.documentElement.dataset.theme === "dark";

  // The first provider in the chain whose map loads. → { by, skipped }
  async function resolve(cfg) {
    const skipped = [];
    for (const id of cfg.chain) {
      if (!SOURCES[id]) continue;
      try { return { style: await SOURCES[id](cfg.providers[id] || {}, dark()), by: id, skipped }; }
      catch (e) { skipped.push({ id, reason: e.message }); }
    }
    const err = new Error(skipped.map((x) => x.reason).join(" ") || i18n.t("No map is set up."));
    err.skipped = skipped;
    throw err;
  }

  // Google asks that its map shows its name and the copyright for the area
  // in view, which its viewport call gives.
  let attribTimer = null;
  function googleAttribution() {
    const box = document.getElementById("mapAttrib");
    if (!box) return;
    box.hidden = !google;
    if (!google) return;
    clearTimeout(attribTimer);
    attribTimer = setTimeout(async () => {
      const b = map.getBounds();
      const u = new URL("https://tile.googleapis.com/tile/v1/viewport");
      for (const [k, v] of Object.entries({ session: google.session, key: google.key, zoom: Math.round(map.getZoom()),
        north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() })) u.searchParams.set(k, v);
      try { const j = await getJson(u.href, "Google"); box.textContent = "Google" + (j.copyright ? " · " + j.copyright : ""); }
      catch (e) { box.textContent = "Google"; }
    }, 400);
  }

  // Opens the map, or brings it up to date with Settings and the theme.
  // One at a time, so quick re-renders don't make two maps.
  let queue = Promise.resolve();
  T.open = (container, cfg) => (queue = queue.catch(() => {}).then(() => open(container, cfg)));
  async function open(container, cfg) {
    const want = JSON.stringify([cfg, dark()]);
    if (map && want === applied) { map.resize(); return T.last; }
    css();
    if (!lib) {
      lib = await import("./vendor/maplibre-gl.mjs");
      // Hebrew and Arabic labels in the right order; fetched only when a
      // label needs it, and kept offline with the app.
      try { lib.setRTLTextPlugin(new URL("src/vendor/rtl-text/plugin.mjs", location.href).href, true); } catch (e) { /* already set */ }
    }
    const r = await resolve(cfg);
    google = r.style.__google || null;
    delete r.style.__google;
    applied = want;
    T.last = { by: r.by, skipped: r.skipped };
    if (map) { map.setStyle(r.style); map.once("style.load", drawRoute); googleAttribution(); return T.last; }
    map = new lib.Map({
      container, style: r.style, center: [10, 25], zoom: 1.2,
      attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new lib.GeolocateControl({ positionOptions: { enableHighAccuracy: false } }), "top-right");
    map.on("click", (e) => { if (T.onTap) T.onTap({ lat: e.lngLat.lat, lng: e.lngLat.lng }); });
    map.on("moveend", googleAttribution);
    map.on("style.load", () => { if (map.getLayer && !map.getLayer("tb-route")) drawRoute(); });
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(i18n.t("The map took too long to load."))), 20000);
      map.once("load", () => { clearTimeout(t); res(); });
    });
    googleAttribution();
    drawRoute();
    return T.last;
  }

  // A day's route: a dashed line through its places in planned order. Kept
  // here, since a new map style (Settings, the theme) clears the map's layers.
  let route = [];
  function drawRoute() {
    if (!map || !map.isStyleLoaded()) return;
    const data = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route.length > 1 ? route : [] } };
    const src = map.getSource("tb-route");
    if (src) { src.setData(data); return; }
    const color = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2F5D50";
    map.addSource("tb-route", { type: "geojson", data });
    map.addLayer({ id: "tb-route", type: "line", source: "tb-route", layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": color, "line-width": 3, "line-dasharray": [1.5, 1.5] } });
  }
  T.route = function (list) {
    route = list.filter((p) => p.lat != null).map((p) => [p.lng, p.lat]);
    drawRoute();
  };

  T.places = function (list, selected, order) {
    if (!map) return;
    const keep = new Set();
    for (const p of list) {
      if (p.lat == null) continue;
      keep.add(p.id);
      let m = pins.get(p.id);
      if (!m) {
        const el = document.createElement("button");
        el.type = "button";
        el.addEventListener("click", (e) => { e.stopPropagation(); if (T.onPin) T.onPin(el.dataset.id); });
        m = new lib.Marker({ element: el, anchor: "center" }).setLngLat([p.lng, p.lat]).addTo(map);
        pins.set(p.id, m);
      }
      const el = m.getElement();
      el.dataset.id = p.id;
      const n = order && order.get(p.id);
      // MapLibre's own classes on the element place it; only ours change.
      for (const c of [...el.classList]) if (c === "pin" || c.startsWith("imp-") || ["visited", "selected", "numbered"].includes(c)) el.classList.remove(c);
      el.classList.add("pin", "imp-" + p.importance);
      if (p.visited) el.classList.add("visited");
      if (p.id === selected) el.classList.add("selected");
      if (n) el.classList.add("numbered");
      el.textContent = n ? String(n) : "";
      el.setAttribute("aria-label", p.name);
      m.setLngLat([p.lng, p.lat]);
    }
    for (const [id, m] of pins) if (!keep.has(id)) { m.remove(); pins.delete(id); }
  };

  T.fit = function (list) {
    if (!map) return;
    const at = list.filter((p) => p.lat != null);
    if (!at.length) return;
    if (at.length === 1) { map.jumpTo({ center: [at[0].lng, at[0].lat], zoom: 14 }); return; }
    const b = new lib.LngLatBounds();
    for (const p of at) b.extend([p.lng, p.lat]);
    map.fitBounds(b, { padding: { top: 110, bottom: 160, left: 40, right: 40 }, maxZoom: 15, duration: 0 });
  };
  T.flyTo = (p) => map && p.lat != null && map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 13), ...(document.documentElement.dataset.motion === "off" ? { duration: 0 } : {}) });
  T.resize = () => map && map.resize();

  window.Tripboard = window.Tripboard || {};
  T.SOURCES = SOURCES;
  window.Tripboard.map = T;
})();
