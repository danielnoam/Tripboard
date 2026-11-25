// Places from a Google Maps list, through Google's own exports (Google has
// no API for saved lists, and a list's share link can't be read here):
//   - Google Takeout → Saved: one CSV per list (Title, Note, URL, …).
//     Its links rarely carry a location, so views.js finds each place
//     again by name with Find by name.
//   - My Maps → Export to KML/KMZ (KML only): placemarks with a location.
//   - Takeout → Maps (your places): Saved Places.json (GeoJSON).
//   parse(text, fileName) -> [{ name, note?, lat?, lng?, url? }]
//   title(text, fileName) -> the list's name, or "" when the file has none:
//     KML's Document name, else a Takeout CSV's file name (one per list).
// No DOM here, so Node tests it (test/listimport.test.js).
(function () {
  const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const located = (lat, lng) => lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

  // RFC 4180: quoted fields, doubled quotes, line breaks inside quotes.
  function csvRows(text) {
    const rows = [];
    let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
        else if (c === '"') q = false;
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(f); rows.push(row); row = []; f = "";
      } else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim()));
  }

  // A location in a Google Maps link, when it has one.
  function fromUrl(url) {
    const u = String(url || "");
    const m = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(u) || /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(u)
      || /\/search\/(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)/.exec(decodeSafe(u)) || /[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)/.exec(decodeSafe(u));
    if (!m) return {};
    const lat = num(m[1]), lng = num(m[2]);
    return located(lat, lng) ? { lat, lng } : {};
  }
  function decodeSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  // The name in a /maps/place/<name>/ link.
  function nameFromUrl(url) {
    const m = /\/maps\/place\/([^/?@]+)/.exec(String(url || ""));
    return m ? clean(decodeSafe(m[1].replace(/\+/g, " "))) : "";
  }

  function fromCsv(text) {
    const rows = csvRows(text);
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const col = (names) => head.findIndex((h) => names.includes(h));
    const ti = col(["title", "name"]), ni = col(["note", "comment", "description"]), ui = col(["url", "link", "google maps url"]);
    if (ti < 0 && ui < 0) return [];
    return rows.slice(1).map((r) => {
      const url = ui >= 0 ? clean(r[ui]) : "";
      const name = (ti >= 0 && clean(r[ti])) || nameFromUrl(url);
      const out = { name, ...fromUrl(url) };
      if (ni >= 0 && clean(r[ni])) out.note = clean(r[ni]);
      if (url) out.url = url;
      return out;
    }).filter((p) => p.name);
  }

  // KML: each Placemark's name, description and Point.
  function fromKml(text) {
    const tag = (s, t) => { const m = new RegExp("<" + t + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + t + ">", "i").exec(s); return m ? m[1] : ""; };
    const unwrap = (s) => clean(s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&"));
    const out = [];
    for (const m of text.matchAll(/<Placemark[\s>][\s\S]*?<\/Placemark>/gi)) {
      const pm = m[0];
      const name = unwrap(tag(pm, "name"));
      if (!name) continue;
      const p = { name };
      const note = unwrap(tag(pm, "description"));
      if (note) p.note = note;
      const coords = clean(tag(tag(pm, "Point"), "coordinates")).split(/[\s]+/)[0].split(",");
      const lng = num(coords[0]), lat = num(coords[1]);
      if (located(lat, lng)) Object.assign(p, { lat, lng });
      out.push(p);
    }
    return out;
  }

  // GeoJSON (Takeout's Saved Places.json): Point features.
  function fromGeoJson(data) {
    const feats = Array.isArray(data && data.features) ? data.features : [];
    return feats.map((f) => {
      const pr = f.properties || {};
      const loc = pr.location || {};
      const url = clean(pr.google_maps_url || pr["Google Maps URL"] || "");
      const name = clean(loc.name || pr.Title || pr.title || pr.name || "") || nameFromUrl(url);
      const c = f.geometry && f.geometry.type === "Point" && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : [];
      const lng = num(c[0]), lat = num(c[1]);
      const p = { name };
      if (located(lat, lng)) Object.assign(p, { lat, lng }); else Object.assign(p, fromUrl(url));
      const note = clean(pr.Comment || pr.comment || pr.note || "");
      if (note) p.note = note;
      if (url) p.url = url;
      return p;
    }).filter((p) => p.name);
  }

  function parse(text, fileName) {
    const t = String(text || "").replace(/^﻿/, "");
    const ext = (/\.(\w+)$/.exec(String(fileName || "").toLowerCase()) || [])[1] || "";
    if (ext === "kml" || /^\s*<\?xml|<kml[\s>]/i.test(t)) return fromKml(t);
    if (ext === "json" || ext === "geojson" || /^\s*\{/.test(t)) { try { return fromGeoJson(JSON.parse(t)); } catch (e) { return []; } }
    return fromCsv(t);
  }

  function title(text, fileName) {
    const t = String(text || "");
    const ext = (/\.(\w+)$/.exec(String(fileName || "").toLowerCase()) || [])[1] || "";
    if (ext === "kml" || /^\s*<\?xml|<kml[\s>]/i.test(t)) {
      const m = /<Document[\s>][\s\S]*?<name>([\s\S]*?)<\/name>/i.exec(t.split(/<Placemark[\s>]/i)[0]);
      return m ? clean(m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&")) : "";
    }
    if (ext !== "csv") return "";
    // A browser may add " (1)" to a file downloaded twice.
    return clean(String(fileName).replace(/\.csv$/i, "").replace(/\s*\(\d+\)$/, ""));
  }

  // A pasted list: one place a line, a name or a Google Maps place link
  // (/maps/place/<name>/…, often with its location). Bullets and numbers
  // at the start go, and a name already given is skipped. A short link
  // (maps.app.goo.gl) can't be read without opening it: on a line of its
  // own it's counted in `short`, unless it follows a name, as Google Maps'
  // Share writes "Name" and then its link (that name is the place).
  // → { places: [{ name, lat?, lng?, url?, from: "name" | "link" }], short }
  const SHORT = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\//i;
  function pasted(text) {
    const places = [], seen = new Set();
    let short = 0, afterName = false;
    for (const raw of String(text || "").replace(/^\uFEFF/, "").split(/\r\n?|\n/)) {
      const line = clean(raw.replace(/^\s*(?:[-*•·–—>]+|\d{1,3}[.)])\s+/, ""));
      if (!line) { afterName = false; continue; }
      const url = (/https?:\/\/\S+/.exec(line) || [])[0] || "";
      const rest = clean(line.replace(url, "").replace(/[\s:,–—-]+$/, ""));
      let p = null;
      if (url && SHORT.test(url)) {
        if (rest) p = { name: rest, from: "name" };
        else if (!afterName) short++;
      } else if (url) {
        const name = nameFromUrl(url) || rest;
        if (name) p = { name, ...fromUrl(url), url, from: "link" };
      } else p = { name: line, from: "name" };
      afterName = !!p && !url;
      if (!p) continue;
      p.name = p.name.slice(0, 160);
      const key = p.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      places.push(p);
    }
    return { places, short };
  }

  const api = { parse, title, fromUrl, csvRows, pasted };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { window.Tripboard = window.Tripboard || {}; window.Tripboard.listImport = api; }
})();
