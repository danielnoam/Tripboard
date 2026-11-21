// Weather for a trip's days, from Open-Meteo (open-meteo.com): free, no
// key, browser requests allowed, data under CC BY 4.0 (credited on Today,
// in Settings › Services › Weather and in About). Its forecast reaches 16 days (today
// and 15 more), so a day further off has none yet.
//   points(trip, places)   where each day's weather is for
//   forecast(trip, places, { today, fetchFn, cached })  →  { at, sig, days }
// What goes to Open-Meteo: one location per day, rounded to about a
// kilometre, and the dates. Nothing else about the trip.
(function () {
  const M = typeof module !== "undefined" && module.exports ? require("./model.js") : window.Tripboard.model;
  const API = "https://api.open-meteo.com/v1/forecast";
  const AHEAD = 16;
  const FRESH_HOURS = 3;
  const MAX_SPOTS = 20;
  const NEAR_KM = 30;

  // WMO weather codes, as Open-Meteo gives them, to a few kinds.
  const KINDS = ["clear", "partly", "cloudy", "fog", "drizzle", "rain", "snow", "storm"];
  function kindOf(code) {
    if (code <= 1) return "clear";
    if (code === 2) return "partly";
    if (code === 3) return "cloudy";
    if (code === 45 || code === 48) return "fog";
    if (code >= 51 && code <= 57) return "drizzle";
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
    if (code >= 95) return "storm";
    return "cloudy";
  }

  const round2 = (n) => Math.round(n * 100) / 100;
  const spot = (a) => ({ lat: round2(a.lat), lng: round2(a.lng) });
  const middle = (list) => ({ lat: list.reduce((s, p) => s + p.lat, 0) / list.length, lng: list.reduce((s, p) => s + p.lng, 0) / list.length });

  // One point per day: the middle of that day's located places, or the
  // first of them (in the day's order) when they spread wider than 30 km,
  // as on a day of driving. A day with none takes the closest day before
  // it that has one, then after it; a trip with no located day at all
  // uses the middle of all its located places.
  function points(trip, places) {
    const located = places.filter((p) => p.lat != null && p.lng != null);
    if (!located.length) return {};
    const days = M.tripDays(trip, places);
    const own = {};
    for (const day of days) {
      const here = M.dayPlan(located, day);
      if (!here.length) continue;
      const mid = middle(here);
      own[day] = here.every((p) => M.distanceKm(mid, p) <= NEAR_KM) ? mid : here[0];
    }
    const all = middle(located);
    const out = {};
    days.forEach((day, i) => {
      let at = own[day];
      for (let k = i - 1; !at && k >= 0; k--) at = own[days[k]];
      for (let k = i + 1; !at && k < days.length; k++) at = own[days[k]];
      out[day] = spot(at || all);
    });
    return out;
  }

  // The trip's days Open-Meteo can forecast now: today to 15 days on.
  function reachable(days, today) {
    const last = M.addDays(today, AHEAD - 1);
    return days.filter((d) => d >= today && d <= last);
  }

  const keyOf = (p) => p.lat.toFixed(2) + "," + p.lng.toFixed(2);
  // What was asked for, so a moved place or new dates fetch again.
  function signature(pts, days) { return days.map((d) => d + "@" + keyOf(pts[d])).join(";"); }

  // One request for every spot (Open-Meteo takes several at once), from
  // the first day wanted to the last. Times are each spot's own.
  function url(spots, from, to) {
    const q = new URLSearchParams({
      latitude: spots.map((s) => s.lat.toFixed(2)).join(","),
      longitude: spots.map((s) => s.lng.toFixed(2)).join(","),
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
      timezone: "auto", start_date: from, end_date: to,
    });
    return API + "?" + q;
  }

  // Open-Meteo's answer (one object, or a list for several spots) to
  // { "<lat,lng>": { "<day>": weather } }.
  function parse(json, spots) {
    const list = Array.isArray(json) ? json : [json];
    const out = {};
    spots.forEach((s, i) => {
      const d = list[i] && list[i].daily;
      if (!d || !Array.isArray(d.time)) return;
      const byDay = (out[keyOf(s)] = {});
      d.time.forEach((day, j) => {
        const code = d.weather_code && d.weather_code[j];
        const max = d.temperature_2m_max && d.temperature_2m_max[j];
        const min = d.temperature_2m_min && d.temperature_2m_min[j];
        if (code == null || max == null || min == null) return;
        const rain = d.precipitation_probability_max && d.precipitation_probability_max[j];
        const sr = d.sunrise && d.sunrise[j], ss = d.sunset && d.sunset[j];
        byDay[day] = { code, kind: kindOf(code), max: Math.round(max), min: Math.round(min),
          ...(rain != null ? { rain: Math.round(rain) } : {}),
          ...(typeof sr === "string" ? { sunrise: sr.slice(11, 16) } : {}), ...(typeof ss === "string" ? { sunset: ss.slice(11, 16) } : {}) };
      });
    });
    return out;
  }

  // Is the kept forecast still good? Younger than 3 hours, asked for the
  // same places and days.
  function fresh(cached, sig, now = Date.now()) {
    return !!cached && cached.sig === sig && now - Date.parse(cached.at) < FRESH_HOURS * 3600e3;
  }

  // The forecast for the trip's reachable days, merged over what was kept
  // (days already past keep their last forecast). Gives the kept copy
  // untouched when it's fresh, and null when there's nothing to ask for.
  async function forecast(trip, places, { today, fetchFn = fetch, cached = null, now = Date.now(), force = false } = {}) {
    const pts = points(trip, places);
    const days = reachable(Object.keys(pts), today);
    if (!days.length) return cached || null;
    const sig = signature(pts, days);
    if (!force && fresh(cached, sig, now)) return cached;
    const spots = [...new Map(days.map((d) => [keyOf(pts[d]), pts[d]])).values()].slice(0, MAX_SPOTS);
    const res = await fetchFn(url(spots, days[0], days[days.length - 1]));
    if (!res.ok) throw new Error("Open-Meteo answered " + res.status);
    const got = parse(await res.json(), spots);
    const out = { at: new Date(now).toISOString(), sig, days: { ...((cached && cached.days) || {}) } };
    for (const d of days) {
      const w = got[keyOf(pts[d])] && got[keyOf(pts[d])][d];
      if (w) out.days[d] = { ...w, lat: pts[d].lat, lng: pts[d].lng };
    }
    // Only the trip's own days are kept.
    const own = new Set(Object.keys(pts));
    for (const d of Object.keys(out.days)) if (!own.has(d)) delete out.days[d];
    return out;
  }

  // °C as Open-Meteo gives it, or °F.
  const degrees = (c, unit) => (unit === "f" ? Math.round(c * 9 / 5 + 32) : c);
  // Fahrenheit where it's the everyday unit: the US and a few others.
  const localUnit = (locale) => (/-(US|LR|MM|BS|BZ|KY|PW|FM|MH)\b/i.test(String(locale || "")) ? "f" : "c");

  const api = { API, AHEAD, KINDS, kindOf, points, reachable, signature, url, parse, fresh, forecast, degrees, localUnit };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { window.Tripboard = window.Tripboard || {}; window.Tripboard.weather = api; }
})();
