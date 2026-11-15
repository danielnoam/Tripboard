// Finding a place by name, one provider per source, all answering alike:
//   providers.<id>.search(query, { near, key, fetchFn }) →
//     [{ name, address, lat, lng, category, placeId?, source }]
//   search(query, { chain, keys, near }) tries the chain's providers in
//   order (Settings' main, then fallback) and says which one answered.
// - osm: OpenStreetMap's Nominatim. Free, no key, about one search a
//   second (its usage policy), so a search runs when asked, never as you
//   type. Its address and location are kept with the place (ODbL, credited).
// - google: Places API (New) Text Search, with the person's key. Google's
//   terms allow keeping its place id for good and its location for 30
//   days, and not its address: views.js keeps the id and the location
//   with the day it was fetched (geoAt), and no address.
// - maptiler: MapTiler's geocoding, with the person's key.
(function () {
  const NOMINATIM = "https://nominatim.openstreetmap.org/search";

  // OpenStreetMap's own kinds of place, to Tripboard's categories.
  function categoryOf(cls, type) {
    const t = cls + "/" + type;
    if (/^tourism\/museum|^amenity\/arts_centre|gallery$/.test(t)) return "museum";
    if (/^amenity\/(restaurant|cafe|fast_food|food_court|ice_cream|bar|biergarten)|^shop\/(bakery|confectionery|deli|tea|coffee)/.test(t)) return "food";
    if (/^amenity\/(pub|nightclub)/.test(t)) return "nightlife";
    if (/^tourism\/(hotel|hostel|guest_house|motel|apartment|camp_site)/.test(t)) return "stay";
    if (/^(railway|aeroway|public_transport)\/|^amenity\/(bus_station|ferry_terminal)/.test(t)) return "transport";
    if (/^(natural|leisure\/(park|garden|nature_reserve)|boundary\/national_park)/.test(t) || cls === "natural") return "nature";
    if (cls === "shop") return "shopping";
    if (/^(tourism|historic|amenity\/place_of_worship|man_made\/tower)/.test(t)) return "sight";
    return null;
  }

  function fromNominatim(r) {
    const name = r.name || String(r.display_name || "").split(",")[0];
    const address = String(r.display_name || "").split(",").map((s) => s.trim()).filter((s, i) => !(i === 0 && s === name)).join(", ");
    return { name, address, lat: +r.lat, lng: +r.lon, category: categoryOf(r.category || r.class || "", r.type || "") };
  }

  // `near` is the trip's places with a location: results around them come first.
  async function osmSearch(query, { near = [], fetchFn = fetch } = {}) {
    const q = String(query || "").trim();
    if (!q) return [];
    const u = new URL(NOMINATIM);
    u.searchParams.set("format", "jsonv2");
    u.searchParams.set("limit", "6");
    u.searchParams.set("q", q);
    if (near.length) {
      const lats = near.map((p) => p.lat), lngs = near.map((p) => p.lng), pad = 0.5;
      u.searchParams.set("viewbox", [Math.min(...lngs) - pad, Math.max(...lats) + pad, Math.max(...lngs) + pad, Math.min(...lats) - pad].join(","));
    }
    const res = await fetchFn(u.href, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(res.status === 429 ? "OpenStreetMap: too many searches at once. Wait a moment and try again." : "OpenStreetMap didn't answer (" + res.status + ").");
    const list = await res.json();
    return (Array.isArray(list) ? list : []).map(fromNominatim).filter((r) => isFinite(r.lat) && isFinite(r.lng));
  }

  // Google's place types, to Tripboard's categories.
  function googleCategory(types) {
    const t = (types || []).join(" ");
    if (/museum|art_gallery/.test(t)) return "museum";
    if (/night_club|\bbar\b|pub\b/.test(t)) return "nightlife";
    if (/restaurant|cafe|bakery|food|coffee|meal_/.test(t)) return "food";
    if (/lodging|hotel|hostel|campground/.test(t)) return "stay";
    if (/station|airport|transit|bus_|ferry/.test(t)) return "transport";
    if (/park|natural_feature|beach|hiking|garden|national_park/.test(t)) return "nature";
    if (/store|shopping|market/.test(t)) return "shopping";
    if (/tourist_attraction|place_of_worship|church|temple|shrine|landmark|historical|monument|point_of_interest/.test(t)) return "sight";
    return null;
  }
  const box = (near, pad) => {
    const lats = near.map((p) => p.lat), lngs = near.map((p) => p.lng);
    return { s: Math.min(...lats) - pad, n: Math.max(...lats) + pad, w: Math.min(...lngs) - pad, e: Math.max(...lngs) + pad };
  };
  async function failure(res, who) {
    let msg = "";
    try { const j = await res.json(); msg = (j.error && (j.error.message || j.error.status)) || j.message || ""; } catch (e) { /* no body */ }
    if (res.status === 429) return new Error(who + ": too many searches, or the quota is used up.");
    if (res.status === 400 || res.status === 401 || res.status === 403) return new Error(who + " refused the key" + (msg ? ": " + msg : "."));
    return new Error(who + " didn't answer (" + res.status + ").");
  }

  async function googleSearch(query, { near = [], key, fetchFn = fetch } = {}) {
    const q = String(query || "").trim();
    if (!q) return [];
    if (!key) throw new Error("Google needs a key (Settings).");
    const body = { textQuery: q, pageSize: 6 };
    if (near.length) { const b = box(near, 0.3); body.locationBias = { rectangle: { low: { latitude: b.s, longitude: b.w }, high: { latitude: b.n, longitude: b.e } } }; }
    const res = await fetchFn("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.types" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await failure(res, "Google");
    const j = await res.json();
    return (j.places || []).filter((p) => p.location).map((p) => ({
      name: (p.displayName && p.displayName.text) || q, address: p.formattedAddress || "",
      lat: p.location.latitude, lng: p.location.longitude, category: googleCategory(p.types), placeId: p.id, source: "google",
    }));
  }

  async function maptilerSearch(query, { near = [], key, fetchFn = fetch } = {}) {
    const q = String(query || "").trim();
    if (!q) return [];
    if (!key) throw new Error("MapTiler needs a key (Settings).");
    const u = new URL("https://api.maptiler.com/geocoding/" + encodeURIComponent(q) + ".json");
    u.searchParams.set("key", key);
    u.searchParams.set("limit", "6");
    if (near.length) { const b = box(near, 0.3); u.searchParams.set("proximity", ((b.w + b.e) / 2).toFixed(4) + "," + ((b.s + b.n) / 2).toFixed(4)); }
    const res = await fetchFn(u.href);
    if (!res.ok) throw await failure(res, "MapTiler");
    const j = await res.json();
    return (j.features || []).filter((f) => Array.isArray(f.center)).map((f) => ({
      name: f.text || String(f.place_name || "").split(",")[0], address: String(f.place_name || "").split(",").slice(1).join(",").trim(),
      lat: f.center[1], lng: f.center[0], category: null, source: "maptiler",
    }));
  }

  const providers = {
    osm: { name: "OpenStreetMap", search: async (q, o = {}) => (await osmSearch(q, o)).map((r) => ({ ...r, source: "osm" })) },
    google: { name: "Google", search: googleSearch },
    maptiler: { name: "MapTiler", search: maptilerSearch },
  };
  // The chain's providers in order: the first that answers wins, even with
  // no results (no results isn't a failure). `skipped` says why any before
  // it didn't answer.
  async function search(query, { chain = ["osm"], keys = {}, near = [], fetchFn } = {}) {
    const skipped = [];
    let last = null;
    for (const id of chain) {
      if (!providers[id]) continue;
      try {
        const results = await providers[id].search(query, { near, key: keys[id], fetchFn });
        return { results, by: id, skipped };
      } catch (e) { last = e; skipped.push({ id, reason: e.message }); }
    }
    throw last || new Error("No search is set up.");
  }

  const api = { providers, search, categoryOf, googleCategory, fromNominatim };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { window.Tripboard = window.Tripboard || {}; window.Tripboard.places = api; }
})();
