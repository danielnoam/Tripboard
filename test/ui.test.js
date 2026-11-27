// The app itself, in a browser (`node test/ui.test.js`). Starts server.js
// on a spare port, gives the app a demo trip, and opens Home, the trip's
// tabs and every Settings page at phone and desktop width, in English and
// Hebrew, failing on any error the page logs or throws. Other sites can't
// be reached from a test machine (map tiles, weather), so a failed
// request to another origin isn't an error here. Needs Playwright with a
// Chromium; where there is none it says so and passes, since the app has
// no dependencies and this is a check for a machine that has it.
const assert = require("assert");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + (e && e.message || e)); }
}

function playwright() {
  try { return require("playwright"); } catch (e) { return null; }
}

const today = new Date();
const day = (n) => new Date(today.getTime() + n * 864e5).toISOString().slice(0, 10);
const DEMO = {
  trips: [{ id: "t1", name: "Kyoto", start: day(-1), end: day(3), destinations: ["Kyoto"] }],
  places: [
    { id: "p1", trip: "t1", name: "Fushimi Inari", category: "sights", importance: "must", day: day(0), time: "08:00", lat: 34.9671, lng: 135.7727 },
    { id: "p2", trip: "t1", name: "Nishiki Market", category: "food", importance: "want", day: day(1), lat: 35.005, lng: 135.7649, rating: 4 },
    { id: "p3", trip: "t1", name: "Somewhere later", category: "sights", importance: "maybe" },
  ],
  expenses: [{ id: "e1", trip: "t1", title: "Train", amount: 1200, currency: "JPY", day: day(0) }],
  files: [],
  deleted: {},
};
const SCREENS = ["#/", "#/trip/t1", "#/trip/t1/today", "#/trip/t1/map", "#/trip/t1/expenses", "#/trip/t1/files",
  "#/settings", "#/settings/appearance", "#/settings/categories", "#/settings/services", "#/settings/map", "#/settings/search",
  "#/settings/weather", "#/settings/ai", "#/settings/sharing", "#/settings/server", "#/settings/data", "#/settings/about", "#/settings/p/maptiler"];

(async () => {
  const pw = playwright();
  if (!pw) {
    // CI installs it (tests.yml), so a skip there would hide a broken install.
    if (process.env.REQUIRE_UI) { process.exitCode = 1; console.log("  FAIL - REQUIRE_UI is set but Playwright isn't installed"); return; }
    console.log("  skip - no Playwright here, so the app wasn't opened in a browser");
    return;
  }
  const port = 5300 + Math.floor(Math.random() * 500);
  const server = spawn(process.execPath, [path.join(ROOT, "server.js")], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: "pipe" });
  await new Promise((ok) => server.stdout.on("data", (d) => { if (String(d).includes("running")) ok(); }));
  const base = "http://localhost:" + port + "/";
  let browser;
  try {
    browser = await pw.chromium.launch();
    for (const [w, h, size] of [[390, 844, "phone"], [1280, 820, "desktop"]]) {
      for (const lang of ["en", "he"]) {
        await test(size + ", " + (lang === "en" ? "English" : "Hebrew") + ": every screen opens with no errors", async () => {
          const ctx = await browser.newContext({ viewport: { width: w, height: h } });
          await ctx.addInitScript((l) => { localStorage.setItem("tripboard.lang", l); }, lang);
          const page = await ctx.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR_/.test(m.text())) errors.push(m.text()); });
          await page.goto(base);
          await page.waitForFunction(() => window.Tripboard && window.Tripboard.views && window.Tripboard.views.doc);
          await page.evaluate((d) => window.Tripboard.views.adopt(d), DEMO);
          if (lang === "he") assert.strictEqual(await page.evaluate(() => document.documentElement.dir), "rtl");
          for (const hash of SCREENS) {
            await page.evaluate((h) => { location.hash = h; }, hash);
            await page.waitForFunction((h) => location.hash === h.replace(/^#\/$/, "#/"), hash);
            await page.waitForTimeout(150);
            assert.ok(await page.evaluate(() => document.body.innerText.trim().length > 0), hash + " is blank");
          }
          await page.evaluate(() => { location.hash = "#/trip/t1"; });
          await page.waitForTimeout(150);
          assert.ok(await page.getByText("Fushimi Inari").first().isVisible(), "the demo place isn't on the Plan");
          await ctx.close();
          assert.deepStrictEqual(errors, []);
        });
      }
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
  console.log("\n" + passed + " passed");
})();
