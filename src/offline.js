// A trip saved for no signal: OpenFreeMap's map around its places, kept
// on this device. Places, covers and synced files are already here
// (store.js); this adds the map. Google's tiles can't be kept (its terms),
// and MapTiler's terms weren't checked, so only OpenFreeMap is saved.
//
// What's kept: the map's styles, sprites and the common glyph ranges, and
// tiles at three rings: the whole trip's area up to zoom 8 (the world to 2), 15 km around
// each place to zoom 11, and 4 km around each place down to zoom 14,
// OpenFreeMap's street level (closer in is drawn from those).
// They're in the Cache API ("tripboard-offline"), which works in a browser,
// the phone apps and the desktop app alike; what each trip saved is in
// localStorage ("tripboard.offline"), on this device only, never synced.
//
// The map reads them through a "tbo://" protocol MapLibre is given
// (map.js), used only once a trip is saved: tiles, glyphs and sprites from
// the kept copy first, styles and the tile index from the network first.
//   offline.plan(points) → ["z/x/y", …]
//   offline.save(trip, points, { force }), .stop(), .remove(id), .sweep(ids)
//   offline.status(id) → null | { state, done, total, bytes, at, … }
//   offline.onChange(fn)
(function () {
  const i18n = (typeof window === "object" && window.i18n) || { t: (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m)) };
  const CACHE = "tripboard-offline", KEY = "tripboard.offline";
  const OFM = "https://tiles.openfreemap.org/";
  const RINGS = [{ upTo: 8, km: null }, { upTo: 11, km: 15 }, { upTo: 14, km: 4 }];
  const MAX_TILES = 6000;
  // A guess for the size before saving, from OpenFreeMap's city tiles.
  const GUESS_BYTES = 80000;
  // Latin, Greek, Cyrillic, Hebrew and Arabic. Chinese, Japanese and
  // Korean are drawn from the device's own fonts and never fetched.
  const RANGES = ["0-255", "256-511", "512-767", "768-1023", "1024-1279", "1280-1535", "1536-1791", "8192-8447"];
  const FONTS = ["Noto Sans Regular", "Noto Sans Bold", "Noto Sans Italic"];

  // ---------- Which tiles (Node-tested) ----------
  const tileX = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z);
  function tileY(lat, z) {
    const r = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
  }
  function box(set, z, s, w, n, e) {
    const max = 2 ** z - 1, clamp = (v) => Math.max(0, Math.min(max, v));
    const x0 = clamp(tileX(w, z)), x1 = clamp(tileX(e, z)), y0 = clamp(tileY(n, z)), y1 = clamp(tileY(s, z));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) set.add(z + "/" + x + "/" + y);
  }
  // The tiles for a trip's places ([[lat, lng], …]), widest first.
  function plan(points, maxzoom = 14) {
    const set = new Set();
    if (!points.length) return [];
    const lats = points.map((p) => p[0]), lngs = points.map((p) => p[1]);
    const pad = 0.5;
    let z = 0;
    for (const ring of RINGS) {
      for (; z <= Math.min(ring.upTo, maxzoom); z++) {
        // The whole world's first three zooms (21 tiles), so zooming out isn't blank.
        if (z <= 2) { box(set, z, -85, -180, 85, 179.999); continue; }
        if (ring.km == null) {
          // The trip's whole area, until a zoom would need too many tiles.
          const before = set.size;
          box(set, z, Math.min(...lats) - pad, Math.min(...lngs) - pad, Math.max(...lats) + pad, Math.max(...lngs) + pad);
          if (set.size - before > 256) { for (const k of [...set]) if (k.startsWith(z + "/")) set.delete(k); z = ring.upTo; }
          continue;
        }
        for (const [lat, lng] of points) {
          const dLat = ring.km / 111.32, dLng = ring.km / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
          box(set, z, lat - dLat, lng - dLng, lat + dLat, lng + dLng);
        }
      }
    }
    return [...set];
  }
  // How many of these places ([[lat, lng], …]) are off the saved map: their
  // street-level tile isn't kept.
  function missing(saved, points) {
    const z = 14, have = new Set(plan(saved).filter((k) => k.startsWith(z + "/")));
    return points.filter(([lat, lng]) => !have.has(z + "/" + tileX(lng, z) + "/" + tileY(lat, z))).length;
  }
  const pointsOf = (places) => places.filter((p) => p.lat != null && p.lng != null)
    .map((p) => [Math.round(p.lat * 1e4) / 1e4, Math.round(p.lng * 1e4) / 1e4]);
  const estimate = (points) => plan(points).length * GUESS_BYTES;

  // One key per tile whatever OpenFreeMap's weekly version in its address,
  // so a newer index still finds the tiles kept with an older one.
  function keyOf(url) {
    const m = /^https:\/\/tiles\.openfreemap\.org\/planet\/[^/]+\/(\d+\/\d+\/\d+\.pbf)$/.exec(url);
    if (m) return OFM + "planet/_/" + m[1];
    try { return decodeURIComponent(url); } catch (e) { return url; }
  }
  const tileUrl = (tpl, k) => { const [z, x, y] = k.split("/"); return tpl.replace("{z}", z).replace("{x}", x).replace("{y}", y); };
  const toTbo = (u) => (typeof u === "string" && u.startsWith(OFM) ? "tbo://" + u.slice(8) : u);
  const fromTbo = (u) => "https://" + u.slice(6);

  // A style with OpenFreeMap's addresses turned to tbo://, so the map
  // reads them through the kept copy.
  function rewrite(style) {
    const s = JSON.parse(JSON.stringify(style));
    for (const src of Object.values(s.sources || {})) {
      if (src.url) src.url = toTbo(src.url);
      if (Array.isArray(src.tiles)) src.tiles = src.tiles.map(toTbo);
    }
    if (s.glyphs) s.glyphs = toTbo(s.glyphs);
    if (typeof s.sprite === "string") s.sprite = toTbo(s.sprite);
    else if (Array.isArray(s.sprite)) s.sprite = s.sprite.map((x) => ({ ...x, url: toTbo(x.url) }));
    return s;
  }
  // Every font stack a style's labels use.
  function fontsOf(style) {
    const out = new Set();
    for (const l of style.layers || []) {
      const f = l.layout && l.layout["text-font"];
      if (Array.isArray(f) && f.every((x) => typeof x === "string")) out.add(f.join(","));
    }
    return out.size ? [...out] : FONTS;
  }
  const spritesOf = (style) => (typeof style.sprite === "string" ? [style.sprite] : Array.isArray(style.sprite) ? style.sprite.map((x) => x.url) : [])
    .filter((u) => u.startsWith(OFM)).flatMap((u) => [u + ".json", u + ".png", u + "@2x.json", u + "@2x.png"]);

  const api = { plan, missing, pointsOf, estimate, keyOf, rewrite, fontsOf, spritesOf, MAX_TILES };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }

  // ---------- On the device ----------
  let meta;
  try { meta = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { meta = null; }
  if (!meta || typeof meta !== "object" || !meta.trips) meta = { wifiOnly: true, trips: {} };
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(meta)); } catch (e) { /* kept for the visit */ } };
  const listeners = new Set();
  const changed = () => { for (const fn of listeners) try { fn(); } catch (e) { /* a view went away */ } };
  let job = null;
  const hasCaches = typeof caches === "object" && !!caches;

  const any = () => Object.values(meta.trips).some((t) => t.done);
  function status(id) {
    if (job && job.id === id) return { ...meta.trips[id], ...job.view };
    const t = meta.trips[id];
    return t ? { state: t.done ? "saved" : "partial", ...t } : null;
  }

  // What the style picked in Settings needs: positron and dark follow the
  // theme, so both are kept; liberty and bright are one each.
  const stylesFor = (pick) => (pick === "liberty" || pick === "bright" ? [pick] : ["positron", "dark"]);

  async function put(cache, key, res) {
    const buf = res.status === 204 || res.status === 404 ? new ArrayBuffer(0) : await res.arrayBuffer();
    await cache.put(key, new Response(buf, { headers: { "Content-Type": res.headers.get("Content-Type") || "application/octet-stream", "X-Size": String(buf.byteLength) } }));
    return buf.byteLength;
  }
  const cellular = () => navigator.connection && navigator.connection.type === "cellular";
  // Waits while there's no connection, or only mobile data with Only on Wi-Fi.
  function gate(signal) {
    const blocked = () => navigator.onLine === false ? "offline" : meta.wifiOnly && cellular() ? "wifi" : null;
    if (!blocked()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const check = () => {
        if (signal.aborted) { done(); reject(new DOMException("stopped", "AbortError")); return; }
        const why = blocked();
        if (job) { job.view.waiting = why; changed(); }
        if (!why) { done(); resolve(); }
      };
      const done = () => { removeEventListener("online", check); if (navigator.connection) navigator.connection.removeEventListener("change", check); clearInterval(timer); };
      addEventListener("online", check);
      if (navigator.connection) navigator.connection.addEventListener("change", check);
      const timer = setInterval(check, 5000);
      check();
    });
  }

  // Saves a trip's map. Already-kept files are skipped unless force (Update).
  async function save(trip, points, { style, force } = {}) {
    if (job) throw new Error(i18n.t("Another trip is being saved for offline. Try again when it's done."));
    if (!hasCaches) throw new Error(i18n.t("This browser can't keep the map for offline."));
    if (!points.length) throw new Error(i18n.t("Add places with a location first. The map is saved around them."));
    const before = meta.trips[trip.id];
    const ctl = new AbortController();
    job = { id: trip.id, ctl, view: { state: "saving", done: 0, total: 0, bytes: 0, waiting: null } };
    meta.trips[trip.id] = { points, done: false, at: before && before.at, bytes: 0, tiles: 0, styles: stylesFor(style) };
    keep();
    changed();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    const cache = await caches.open(CACHE);
    const v = job.view;
    try {
      // The styles, then what they point at.
      const extras = new Set(), tiles = [];
      for (const name of meta.trips[trip.id].styles) {
        await gate(ctl.signal);
        const res = await fetch(OFM + "styles/" + name, { signal: ctl.signal });
        if (!res.ok) throw new Error(i18n.t("OpenFreeMap didn't answer ({status}).", { status: res.status }));
        const style = await res.clone().json();
        v.bytes += await put(cache, OFM + "styles/" + name, res);
        for (const u of spritesOf(style)) extras.add(u);
        if (style.glyphs && style.glyphs.startsWith(OFM)) for (const f of fontsOf(style)) for (const r of RANGES) extras.add(style.glyphs.replace("{fontstack}", f).replace("{range}", r));
        for (const src of Object.values(style.sources || {})) {
          let tj = src;
          if (src.url && src.url.startsWith(OFM)) {
            const r2 = await fetch(src.url, { signal: ctl.signal });
            if (!r2.ok) throw new Error(i18n.t("OpenFreeMap didn't answer ({status}).", { status: r2.status }));
            tj = await r2.clone().json();
            v.bytes += await put(cache, src.url, r2);
          }
          const tpl = (tj.tiles || [])[0];
          if (!tpl || !tpl.startsWith(OFM)) continue;
          for (const k of plan(points, Math.min(14, tj.maxzoom == null ? 14 : tj.maxzoom))) tiles.push(tileUrl(tpl, k));
        }
      }
      const urls = [...extras, ...new Set(tiles)];
      if (urls.length > MAX_TILES) throw new Error(i18n.t("This trip's places cover too much ground to save at street level."));
      v.total = urls.length;
      changed();
      let next = 0;
      const worker = async () => {
        while (next < urls.length) {
          const url = urls[next++];
          await gate(ctl.signal);
          const key = keyOf(url);
          const kept = !force && await cache.match(key);
          if (kept) v.bytes += Number(kept.headers.get("X-Size")) || 0;
          else {
            const res = await fetch(url, { signal: ctl.signal });
            if (!res.ok && res.status !== 404 && res.status !== 204) throw new Error(i18n.t("OpenFreeMap didn't answer ({status}).", { status: res.status }));
            v.bytes += await put(cache, key, res);
          }
          v.done++;
          if (v.done % 20 === 0 || v.done === v.total) changed();
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      Object.assign(meta.trips[trip.id], { done: true, at: new Date().toISOString(), bytes: v.bytes, tiles: tiles.length });
      keep();
      // An update leaves out what the old places needed and the new don't.
      if (before && before.points) await release(before.points);
    } catch (e) {
      const t = meta.trips[trip.id];
      Object.assign(t, { saved: v.done, total: v.total, bytes: v.bytes,
        error: e.name === "AbortError" ? "" : e.name === "QuotaExceededError" ? i18n.t("This device is out of room for the map.") : navigator.onLine === false ? i18n.t("The connection dropped.") : e.message });
      keep();
    } finally {
      job = null;
      changed();
    }
  }
  const stop = () => { if (job) job.ctl.abort(); };

  // Deletes the tiles of these points that no saved trip uses now; with
  // no trip left, the whole kept map.
  async function release(points) {
    const left = Object.values(meta.trips);
    if (!left.length) { await caches.delete(CACHE); return; }
    const used = new Set(left.flatMap((t) => plan(t.points || [])));
    const cache = await caches.open(CACHE);
    await Promise.all(plan(points).filter((k) => !used.has(k)).map((k) => cache.delete(OFM + "planet/_/" + k + ".pbf")));
  }
  async function remove(id) {
    if (job && job.id === id) { job.ctl.abort(); while (job) await new Promise((r) => setTimeout(r, 50)); }
    const t = meta.trips[id];
    if (!t) return;
    delete meta.trips[id];
    keep();
    changed();
    if (hasCaches) await release(t.points || []);
  }
  // Trips that are gone from this device take their map with them.
  function sweep(ids) {
    const have = new Set(ids);
    for (const id of Object.keys(meta.trips)) if (!have.has(id)) remove(id);
  }

  // ---------- The map's side ----------
  function timed(url, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    return fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(t));
  }
  // A style: the network's (with a short wait when a copy is kept), else
  // the kept one, else any kept OpenFreeMap style. Turned to tbo://.
  async function style(name) {
    const url = OFM + "styles/" + name;
    let res = null;
    if (navigator.onLine !== false) try { res = await timed(url, 8000); } catch (e) { res = null; }
    if (!res || !res.ok) {
      const cache = await caches.open(CACHE);
      res = await cache.match(url);
      for (const other of ["positron", "dark", "liberty", "bright"]) if (!res) res = await cache.match(OFM + "styles/" + other);
    }
    if (!res) throw new Error(i18n.t("OpenFreeMap's map isn't saved on this device."));
    return rewrite(await res.json());
  }
  // MapLibre's tbo:// requests.
  async function protocol(params, abort) {
    const url = fromTbo(params.url), key = keyOf(url);
    const cache = await caches.open(CACHE);
    const index = /\/planet$/.test(url);
    let res = index ? null : await cache.match(key);
    if (!res) {
      try {
        res = await fetch(url, { signal: abort && abort.signal });
        if (index && !res.ok) throw new Error(String(res.status));
        if (res.ok && url.includes("/fonts/")) put(cache, key, res.clone()).catch(() => {});
      } catch (e) {
        res = await cache.match(key);
        if (!res) throw e;
      }
    }
    if (params.type === "json") {
      const j = await res.json();
      if (index && Array.isArray(j.tiles)) j.tiles = j.tiles.map(toTbo);
      return { data: j };
    }
    return { data: res.status === 204 || res.status === 404 ? new ArrayBuffer(0) : await res.arrayBuffer() };
  }

  Object.assign(api, {
    any, status, save, stop, remove, sweep, style, protocol, stylesFor,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    get wifiOnly() { return meta.wifiOnly !== false; },
    set wifiOnly(on) { meta.wifiOnly = !!on; keep(); changed(); },
    get canTellWifi() { return !!(navigator.connection && "type" in navigator.connection); },
  });
  window.Tripboard = window.Tripboard || {};
  window.Tripboard.offline = api;
})();
