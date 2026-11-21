// src/weather.js: where each day's forecast is for, what goes to
// Open-Meteo, and reading its answer (`node test/weather.test.js`).
const assert = require("assert");
const W = require("../src/weather.js");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + (e.stack || e.message)); }
}

const trip = { id: "t", start: "2026-11-20", end: "2026-11-24" };
const at = (name, day, lat, lng, extra) => ({ id: name, trip: "t", name, day, lat, lng, importance: "want", ...extra });
// Kyoto on the 20th and 21st, nothing located on the 22nd, Osaka on the 23rd.
const places = [
  at("Fushimi Inari", "2026-11-20", 34.9671, 135.7727, { time: "08:00" }),
  at("Tofuku-ji", "2026-11-20", 34.9761, 135.7739, { time: "11:00" }),
  at("Kinkaku-ji", "2026-11-21", 35.0394, 135.7292),
  { id: "x", trip: "t", name: "Somewhere", day: "2026-11-22", importance: "want" },
  at("Dotonbori", "2026-11-23", 34.6687, 135.5013),
];

(async () => {
  await test("WMO codes to kinds", () => {
    assert.deepStrictEqual([0, 1, 2, 3, 45, 53, 63, 81, 73, 86, 95, 99].map(W.kindOf),
      ["clear", "clear", "partly", "cloudy", "fog", "drizzle", "rain", "rain", "snow", "snow", "storm", "storm"]);
  });

  await test("each day gets its places' middle, rounded to 2 decimals; a day with none borrows the day before", () => {
    const p = W.points(trip, places);
    assert.deepStrictEqual(Object.keys(p), ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"]);
    assert.deepStrictEqual(p["2026-11-20"], { lat: 34.97, lng: 135.77 });
    assert.deepStrictEqual(p["2026-11-22"], p["2026-11-21"]);
    assert.deepStrictEqual(p["2026-11-24"], { lat: 34.67, lng: 135.5 });
  });

  await test("a day spread over 30 km uses its first place, not a middle nobody visits", () => {
    const drive = [at("Kyoto", "2026-11-20", 35.0116, 135.7681, { time: "09:00" }), at("Hiroshima", "2026-11-20", 34.3853, 132.4553, { time: "17:00" })];
    assert.deepStrictEqual(W.points(trip, drive)["2026-11-20"], { lat: 35.01, lng: 135.77 });
  });

  await test("no located place, no points", () => {
    assert.deepStrictEqual(W.points(trip, [places[3]]), {});
  });

  await test("only today to 15 days on can be forecast", () => {
    const days = ["2026-11-01", "2026-11-21", "2026-12-06", "2026-12-07"];
    assert.deepStrictEqual(W.reachable(days, "2026-11-21"), ["2026-11-21", "2026-12-06"]);
  });

  await test("one request for every distinct spot, and the answer per day", async () => {
    let asked;
    const fetchFn = async (url) => {
      asked = new URL(url);
      const day = (code, max) => ({ daily: { time: ["2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"], weather_code: [code, code, code, code],
        temperature_2m_max: [max, max, max, max], temperature_2m_min: [3.4, 3.4, 3.4, 3.4], precipitation_probability_max: [10, 20, 30, 40],
        sunrise: ["2026-11-21T06:39", "2026-11-22T06:40", "2026-11-23T06:41", "2026-11-24T06:42"], sunset: ["2026-11-21T16:47", "2026-11-22T16:46", "2026-11-23T16:46", "2026-11-24T16:45"] } });
      return { ok: true, json: async () => [day(2, 14.6), day(61, 16.2)] };
    };
    const f = await W.forecast(trip, places, { today: "2026-11-21", fetchFn, now: Date.parse("2026-11-21T08:00:00Z") });
    assert.strictEqual(asked.origin + asked.pathname, W.API);
    assert.strictEqual(asked.searchParams.get("latitude"), "35.04,34.67");
    assert.strictEqual(asked.searchParams.get("longitude"), "135.73,135.50");
    assert.strictEqual(asked.searchParams.get("start_date"), "2026-11-21");
    assert.strictEqual(asked.searchParams.get("end_date"), "2026-11-24");
    assert.strictEqual(asked.searchParams.get("timezone"), "auto");
    assert.deepStrictEqual(Object.keys(f.days), ["2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"]);
    assert.deepStrictEqual(f.days["2026-11-21"], { code: 2, kind: "partly", max: 15, min: 3, rain: 10, sunrise: "06:39", sunset: "16:47", lat: 35.04, lng: 135.73 });
    assert.strictEqual(f.days["2026-11-23"].kind, "rain");
  });

  await test("a fresh kept forecast isn't asked for again; a stale one or a moved place is, and past days stay", async () => {
    let calls = 0;
    const fetchFn = async () => { calls++; return { ok: true, json: async () => ({ daily: { time: ["2026-11-23", "2026-11-24"], weather_code: [0, 0], temperature_2m_max: [20, 20], temperature_2m_min: [10, 10] } }) }; };
    const now = Date.parse("2026-11-23T08:00:00Z");
    const pts = W.points(trip, places);
    const days = W.reachable(Object.keys(pts), "2026-11-23");
    const kept = { at: new Date(now - 3600e3).toISOString(), sig: W.signature(pts, days), days: { "2026-11-20": { kind: "rain", max: 9, min: 2 } } };
    assert.strictEqual(await W.forecast(trip, places, { today: "2026-11-23", fetchFn, cached: kept, now }), kept);
    assert.strictEqual(calls, 0);
    const later = await W.forecast(trip, places, { today: "2026-11-23", fetchFn, cached: kept, now: now + 4 * 3600e3 });
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(Object.keys(later.days), ["2026-11-20", "2026-11-23", "2026-11-24"]);
    const moved = places.map((p) => (p.name === "Dotonbori" ? { ...p, lat: 34.7 } : p));
    await W.forecast(trip, moved, { today: "2026-11-23", fetchFn, cached: kept, now });
    assert.strictEqual(calls, 2);
  });

  await test("Open-Meteo failing throws, so the app keeps what it had", async () => {
    await assert.rejects(W.forecast(trip, places, { today: "2026-11-21", fetchFn: async () => ({ ok: false, status: 429 }) }), /429/);
  });

  await test("°F where it's the usual unit", () => {
    assert.strictEqual(W.degrees(20, "f"), 68);
    assert.strictEqual(W.degrees(20, "c"), 20);
    assert.deepStrictEqual(["en-US", "en-GB", "he-IL", "he", "en"].map(W.localUnit), ["f", "c", "c", "c", "c"]);
  });

  console.log(passed + " passed");
})();
