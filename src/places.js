// Finding a place by name, behind one interface so the source can change:
//   providers.osm.search(query, { near }) → [{ name, address, lat, lng, category }]
// OpenStreetMap's Nominatim first: free, no key, about one search a second
// (its usage policy), so a search runs when asked, never as you type.
// Google Places joins later as another provider (docs/SCOPE.md).
// What a result gives is the place's name, address and location; the
// address and location are kept with the place (OpenStreetMap's data,
// credited in README.md).
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
    if (!res.ok) throw new Error(res.status === 429 ? "Too many searches at once. Wait a moment and try again." : "The search didn't answer (" + res.status + ").");
    const list = await res.json();
    return (Array.isArray(list) ? list : []).map(fromNominatim).filter((r) => isFinite(r.lat) && isFinite(r.lng));
  }

  const api = { providers: { osm: { name: "OpenStreetMap", search: osmSearch } }, categoryOf, fromNominatim };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { window.Tripboard = window.Tripboard || {}; window.Tripboard.places = api; }
})();
