// The trip's map: MapLibre GL (src/vendor/, BSD-3) on OpenFreeMap's free
// tiles, loaded the first time a map is opened. One map, kept for the
// visit; views.js gives it the places to show and hears taps.
//   TripMap.open(container) → resolves once the map is there (or throws)
//   TripMap.places(list, selectedId)   pins, by importance
//   TripMap.fit(list)                  frames them
//   TripMap.onPin = (id) => …, TripMap.onTap = ({ lat, lng }) => …
(function () {
  const STYLES = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };
  let lib = null, map = null, styleOf = null;
  const pins = new Map();
  const T = {
    onPin: null, onTap: null,
    get ready() { return !!map; },
  };

  function css() {
    if (document.getElementById("maplibreCss")) return;
    const l = document.createElement("link");
    l.id = "maplibreCss";
    l.rel = "stylesheet";
    l.href = "src/vendor/maplibre-gl.css";
    document.head.append(l);
  }
  const theme = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

  T.open = async function (container) {
    if (map) { map.resize(); syncTheme(); return; }
    css();
    lib = lib || await import("./vendor/maplibre-gl.mjs");
    styleOf = theme();
    map = new lib.Map({
      container, style: STYLES[styleOf], center: [10, 25], zoom: 1.2,
      attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new lib.GeolocateControl({ positionOptions: { enableHighAccuracy: false } }), "top-right");
    // OpenFreeMap's dark style, if it's ever missing, falls back to the light one.
    map.on("error", (e) => {
      if (styleOf === "dark" && /style/i.test(String(e && e.error && e.error.message))) { styleOf = "light"; map.setStyle(STYLES.light); }
    });
    map.on("click", (e) => { if (T.onTap) T.onTap({ lat: e.lngLat.lat, lng: e.lngLat.lng }); });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("The map took too long to load.")), 20000);
      map.once("load", () => { clearTimeout(t); resolve(); });
    });
  };
  function syncTheme() {
    if (styleOf !== theme()) { styleOf = theme(); map.setStyle(STYLES[styleOf]); }
  }

  T.places = function (list, selected) {
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
      el.className = "pin imp-" + p.importance + (p.visited ? " visited" : "") + (p.id === selected ? " selected" : "");
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
    map.fitBounds(b, { padding: { top: 60, bottom: 160, left: 40, right: 40 }, maxZoom: 15, duration: 0 });
  };
  T.flyTo = (p) => map && p.lat != null && map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 13) });
  T.resize = () => map && map.resize();

  window.Tripboard = window.Tripboard || {};
  window.Tripboard.map = T;
})();
