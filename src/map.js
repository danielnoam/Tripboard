// The trip's map: MapLibre GL (src/vendor/, BSD-3), loaded the first time
// a map is opened, on the map provider Settings picks (OpenFreeMap,
// Google's 2D tiles or MapTiler), or its fallback when that one fails.
// One map, kept for the visit; views.js gives it the places and hears taps.
//   TripMap.open(container, { chain, providers }) → { by, skipped }
//   TripMap.places(list, selectedId)   pins, by importance
//   TripMap.fit(list)                  frames them
//   TripMap.route(list)                a line through them in order (a day's plan)
//   TripMap.journeys(list)             each journey as a line between its two ends (a flight as an arc)
//   TripMap.zoom(±1), TripMap.locate()  the map's own buttons (views.js draws them)
//   TripMap.hover(id, on)              a pin stands out while its card is pointed at
//   TripMap.drag(id, onDrop)           that place's pin can be dragged; onDrop({ lat, lng }) when let go
//   TripMap.onPin = (id) => …, TripMap.onFocus = (id) => … (a pin pressed twice), TripMap.onTap = ({ lat, lng }) => …, TripMap.onLocateFail = () => …
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
  let lib = null, map = null, applied = "", google = null, geo = null;
  const still = () => document.documentElement.dataset.motion === "off";
  const pins = new Map();
  const T = { onPin: null, onTap: null, get ready() { return !!map; } };

  async function getJson(url, who, init) {
    const res = await fetch(url, init);
    if (!res.ok) {
      let msg = "";
      try { const j = await res.json(); msg = (j.error && j.error.message) || j.message || ""; } catch (e) { /* no body */ }
      const refused = res.status === 401 || res.status === 403 || res.status === 400;
      throw Object.assign(new Error(refused ? (msg ? i18n.t("{who} refused the key: {msg}", { who, msg }) : i18n.t("{who} refused the key.", { who }))
        : res.status === 429 ? i18n.t("{who}'s quota is used up for now.", { who }) : i18n.t("{who}'s map didn't load ({status}).", { who, status: res.status })), { refused });
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
    if (mapType === "satellite" || mapType === "terrain") body.layerTypes = ["layerRoadmap"];
    if (dark && mapType === "roadmap") body.styles = NIGHT;
    const j = await getJson("https://tile.googleapis.com/v1/createSession?key=" + encodeURIComponent(key), "Google",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    try { localStorage.setItem("tripboard.gsession", JSON.stringify({ id, session: j.session, expiry: j.expiry })); } catch (e) { /* asks again next time */ }
    return j.session;
  }

  // Each provider's map as a MapLibre style object.
  const SOURCES = {
    async openfreemap(o, dark) {
      // "light" follows the app's theme; the others stay as picked.
      const name = ["liberty", "bright", "positron", "dark"].includes(o.style) ? o.style : dark ? "dark" : "positron";
      // With a trip saved for offline, the map reads through its kept copy (offline.js).
      const off = window.Tripboard && window.Tripboard.offline;
      if (off && off.any()) return off.style(name);
      return getJson(OFM + name, "OpenFreeMap");
    },
    async maptiler(o, dark) {
      if (!o.key) throw new Error(i18n.t("{who} needs a key (Settings).", { who: "MapTiler" }));
      const pair = MAPTILER[o.style] || MAPTILER.streets;
      return getJson("https://api.maptiler.com/maps/" + pair[dark ? 1 : 0] + "/style.json?key=" + encodeURIComponent(o.key), "MapTiler");
    },
    async google(o, dark) {
      if (!o.key) throw new Error(i18n.t("{who} needs a key (Settings).", { who: "Google" }));
      const type = ["satellite", "terrain"].includes(o.mapType) ? o.mapType : "roadmap";
      const session = await googleSession(o.key, type, dark);
      return {
        version: 8,
        sources: { google: { type: "raster", tileSize: 256, maxzoom: 22,
          tiles: ["https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=" + session + "&key=" + encodeURIComponent(o.key)] } },
        layers: [{ id: "google", type: "raster", source: "google", ...(still() ? { paint: { "raster-fade-duration": 0 } } : {}) }],
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
  // With no connection and a trip saved for offline, OpenFreeMap goes first:
  // it's the map that's kept.
  async function resolve(cfg) {
    const skipped = [];
    const off = window.Tripboard && window.Tripboard.offline;
    const chain = navigator.onLine === false && off && off.any() ? ["openfreemap", ...cfg.chain.filter((x) => x !== "openfreemap")] : cfg.chain;
    for (const id of chain) {
      if (!SOURCES[id]) continue;
      try { return { style: await SOURCES[id](cfg.providers[id] || {}, dark()), by: id, skipped }; }
      catch (e) { skipped.push({ id, reason: e.message, refused: !!e.refused }); }
    }
    const err = new Error(skipped.map((x) => x.reason).join(" ") || i18n.t("No map is set up."));
    err.skipped = skipped;
    throw err;
  }

  // The map's credit: a short line that's always on the map (OpenStreetMap's
  // licence and Google's terms ask for one), and the full credits under it
  // when it's tapped. Google's names the copyright for the area in view,
  // which its viewport call gives. The styles' credits are HTML from the
  // provider: only their text and https links are kept.
  let attribTimer = null;
  const SHORT = { openfreemap: "© OpenStreetMap", maptiler: "© MapTiler © OpenStreetMap" };
  function credits() {
    const out = [];
    const style = map && map.getStyle && map.getStyle();
    const seen = new Set();
    for (const src of Object.values((style && style.sources) || {})) {
      if (!src.attribution || seen.has(src.attribution)) continue;
      seen.add(src.attribution);
      const doc = new DOMParser().parseFromString(src.attribution, "text/html");
      const p = document.createElement("span");
      for (const n of doc.body.childNodes) {
        const href = n.nodeName === "A" ? n.getAttribute("href") || "" : "";
        if (/^https:\/\//.test(href)) {
          const a = document.createElement("a");
          Object.assign(a, { href, target: "_blank", rel: "noopener noreferrer", textContent: n.textContent });
          p.append(a);
        } else p.append(n.textContent);
      }
      if (out.length) out.push(" · ");
      out.push(p);
    }
    return out;
  }
  function paintCredit() {
    const box = document.getElementById("mapCredit"), full = document.getElementById("mapCredits");
    if (!box || !map) return;
    const label = box.querySelector(".map-credit-text");
    full.hidden = true;
    box.setAttribute("aria-expanded", "false");
    box.hidden = false;
    if (!google) {
      label.textContent = SHORT[T.last && T.last.by] || "© OpenStreetMap";
      full.replaceChildren(...credits());
      return;
    }
    label.textContent = "Google";
    full.replaceChildren("Google");
    clearTimeout(attribTimer);
    attribTimer = setTimeout(async () => {
      const b = map.getBounds();
      const u = new URL("https://tile.googleapis.com/tile/v1/viewport");
      for (const [k, v] of Object.entries({ session: google.session, key: google.key, zoom: Math.round(map.getZoom()),
        north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() })) u.searchParams.set(k, v);
      let text = "Google";
      try { const j = await getJson(u.href, "Google"); if (j.copyright) text += " · " + j.copyright; }
      catch (e) { /* the name alone */ }
      label.textContent = text;
      full.replaceChildren(text);
    }, 400);
  }
  T.toggleCredits = function () {
    const box = document.getElementById("mapCredit"), full = document.getElementById("mapCredits");
    if (!box || !full.childNodes.length) return;
    full.hidden = !full.hidden;
    box.setAttribute("aria-expanded", String(!full.hidden));
  };

  // Opens the map, or brings it up to date with Settings and the theme.
  // One at a time, so quick re-renders don't make two maps.
  let queue = Promise.resolve();
  T.open = (container, cfg) => (queue = queue.catch(() => {}).then(() => open(container, cfg)));
  async function open(container, cfg) {
    const off = window.Tripboard.offline;
    const want = JSON.stringify([cfg, dark(), navigator.onLine, !!(off && off.any())]);
    if (map && want === applied) { map.resize(); return T.last; }
    css();
    if (!lib) {
      lib = await import("./vendor/maplibre-gl.mjs");
      // Hebrew and Arabic labels in the right order; fetched only when a
      // label needs it, and kept offline with the app.
      try { lib.setRTLTextPlugin(new URL("src/vendor/rtl-text/plugin.mjs", location.href).href, true); } catch (e) { /* already set */ }
      if (window.Tripboard.offline) lib.addProtocol("tbo", window.Tripboard.offline.protocol);
    }
    const r = await resolve(cfg);
    google = r.style.__google || null;
    delete r.style.__google;
    applied = want;
    T.last = { by: r.by, skipped: r.skipped };
    if (map) { map.setStyle(r.style); map.once("style.load", () => { drawRoute(); drawLegs(); paintCredit(); }); return T.last; }
    map = new lib.Map({
      container, style: r.style, center: [10, 25], zoom: 1.2,
      attributionControl: false, dragRotate: false, pitchWithRotate: false,
      // With motion off: zooms and moves jump, a flick doesn't glide on, labels don't fade in.
      ...(still() ? { reduceMotion: true, fadeDuration: 0 } : {}),
    });
    map.touchZoomRotate.disableRotation();
    // Where am I: MapLibre's own, with its button hidden (styles.css); the
    // map's buttons are views.js's.
    geo = new lib.GeolocateControl({ positionOptions: { enableHighAccuracy: false } });
    geo.on("error", () => T.onLocateFail && T.onLocateFail());
    map.addControl(geo, "top-right");
    map.on("click", (e) => {
      const full = document.getElementById("mapCredits");
      if (full && !full.hidden) T.toggleCredits();
      if (T.onTap) T.onTap({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    map.on("moveend", () => google && paintCredit());
    map.on("style.load", () => { if (map.getLayer && !map.getLayer("tb-route")) drawRoute(); if (map.getLayer && !map.getLayer("tb-legs-ground")) drawLegs(); });
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(i18n.t("The map took too long to load."))), 20000);
      map.once("load", () => { clearTimeout(t); res(); });
    });
    paintCredit();
    drawRoute();
    drawLegs();
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
  // Journeys: a solid line for the ground, a dotted arc for a flight, and a
  // ring at each end. Kept like the route, for a new style.
  let legs = [];
  function arc(a, b) {
    // A flight bends to one side, so it reads as a flight and two legs
    // between the same airports don't sit on each other.
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const c = [(a[0] + b[0]) / 2 - dy * 0.2, (a[1] + b[1]) / 2 + dx * 0.2];
    const out = [];
    for (let i = 0; i <= 32; i++) {
      const t = i / 32;
      out.push([0, 1].map((k) => (1 - t) * (1 - t) * a[k] + 2 * (1 - t) * t * c[k] + t * t * b[k]));
    }
    return out;
  }
  let legsWaiting = false;
  function drawLegs() {
    if (!map) return;
    // While a source is still loading the style doesn't count as loaded:
    // try again once the map has settled, so a change isn't lost.
    if (!map.getSource("tb-legs") && !map.isStyleLoaded()) {
      if (!legsWaiting) { legsWaiting = true; map.once("idle", () => { legsWaiting = false; drawLegs(); }); }
      return;
    }
    const lines = [], ends = [];
    for (const j of legs) {
      const a = j.lat != null ? [j.lng, j.lat] : null, b = j.toLat != null ? [j.toLng, j.toLat] : null;
      for (const p of [a, b]) if (p) ends.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: p } });
      if (a && b) lines.push({ type: "Feature", properties: { air: j.mode === "flight" }, geometry: { type: "LineString", coordinates: j.mode === "flight" ? arc(a, b) : [a, b] } });
    }
    const data = { line: { type: "FeatureCollection", features: lines }, end: { type: "FeatureCollection", features: ends } };
    if (map.getSource("tb-legs")) { map.getSource("tb-legs").setData(data.line); map.getSource("tb-ends").setData(data.end); return; }
    const css = getComputedStyle(document.documentElement);
    const color = css.getPropertyValue("--accent").trim() || "#2F5D50";
    const surface = css.getPropertyValue("--surface").trim() || "#FFFFFF";
    map.addSource("tb-legs", { type: "geojson", data: data.line });
    map.addSource("tb-ends", { type: "geojson", data: data.end });
    const layout = { "line-join": "round", "line-cap": "round" };
    map.addLayer({ id: "tb-legs-ground", type: "line", source: "tb-legs", filter: ["!", ["get", "air"]], layout, paint: { "line-color": color, "line-width": 4 } });
    map.addLayer({ id: "tb-legs-air", type: "line", source: "tb-legs", filter: ["get", "air"], layout, paint: { "line-color": color, "line-width": 3, "line-dasharray": [0.1, 2.5] } });
    map.addLayer({ id: "tb-ends", type: "circle", source: "tb-ends", paint: { "circle-radius": 6, "circle-color": surface, "circle-stroke-color": color, "circle-stroke-width": 3 } });
  }
  T.journeys = function (list) {
    legs = list;
    drawLegs();
  };

  T.route = function (list) {
    route = list.filter((p) => p.lat != null).map((p) => [p.lng, p.lat]);
    drawRoute();
  };

  const lastPin = { id: null, at: 0 };
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
        // A second press soon after on the same pin focuses it (zooms in on it).
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          const now = Date.now(), twice = lastPin.id === el.dataset.id && now - lastPin.at < 400;
          lastPin.id = twice ? null : el.dataset.id; lastPin.at = now;
          if (twice) { if (T.onFocus) T.onFocus(el.dataset.id); } else if (T.onPin) T.onPin(el.dataset.id);
        });
        el.addEventListener("dblclick", (e) => { e.stopPropagation(); e.preventDefault(); });
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
      // A day's route shows its order; otherwise the category's icon.
      const T2 = window.Tripboard;
      if (n) el.textContent = String(n);
      else if (T2 && T2.icon) el.replaceChildren(T2.icon(T2.catIcon(p.category)));
      else el.textContent = "";
      // Its name, shown by styles.css on hover and when selected, or always (View sheet).
      const label = document.createElement("span");
      label.className = "pin-label";
      label.textContent = p.name;
      el.append(label);
      el.setAttribute("aria-label", p.name);
      m.setLngLat([p.lng, p.lat]);
    }
    for (const [id, m] of pins) if (!keep.has(id)) { m.remove(); pins.delete(id); if (dragging === id) dragging = null; }
  };

  // One pin that can be dragged (moving a place): onDrop gets where it was let go.
  // T.drag(null) makes every pin still again.
  let dragging = null;
  T.drag = function (id, onDrop) {
    if (dragging && dragging !== id) {
      const m = pins.get(dragging);
      if (m) { m.setDraggable(false); m.off("dragend", m._tbDrop); m.getElement().classList.remove("draggable"); }
    }
    dragging = id && pins.has(id) ? id : null;
    if (!dragging) return;
    const m = pins.get(dragging);
    if (m._tbDrop) m.off("dragend", m._tbDrop);
    m._tbDrop = () => { const at = m.getLngLat(); onDrop({ lat: at.lat, lng: at.lng }); };
    m.setDraggable(true);
    m.on("dragend", m._tbDrop);
    m.getElement().classList.add("draggable");
  };

  T.fit = function (list, animate) {
    if (!map) return;
    const at = list.filter((p) => p.lat != null);
    if (!at.length) return;
    const move = animate && !still() ? {} : { duration: 0 };
    if (at.length === 1) { map.easeTo({ center: [at[0].lng, at[0].lat], zoom: 14, ...move }); return; }
    const b = new lib.LngLatBounds();
    for (const p of at) b.extend([p.lng, p.lat]);
    map.fitBounds(b, { padding: { top: 110, bottom: 160, left: 70, right: 70 }, maxZoom: 15, ...move });
  };
  T.flyTo = (p) => map && p.lat != null && map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 13), ...(still() ? { duration: 0 } : {}) });
  // Redrawn at once: resizing clears the canvas, and a frame left blank flashes while the split is dragged.
  T.focus = (p) => map && p.lat != null && map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom() + 2, 16), ...(still() ? { duration: 0 } : {}) });
  T.resize = () => { if (!map) return; map.resize(); if (map.redraw) map.redraw(); };
  // A place's pin stands out while its card is under the pointer.
  T.hover = (id, on) => { const m = pins.get(id); if (m) m.getElement().classList.toggle("hot", !!on); };
  T.zoom = (d) => map && (d > 0 ? map.zoomIn(still() ? { duration: 0 } : {}) : map.zoomOut(still() ? { duration: 0 } : {}));
  T.locate = () => {
    if (!geo) return;
    try { geo.trigger(); } catch (e) { if (T.onLocateFail) T.onLocateFail(); }
  };

  window.Tripboard = window.Tripboard || {};
  T.SOURCES = SOURCES;
  window.Tripboard.map = T;
})();
