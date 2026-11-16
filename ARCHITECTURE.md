# Tripboard architecture

The map of the code. A file added, removed or renamed, or a flow changed,
is updated here in the same change.

## Files

```
index.html           the page: its Content-Security-Policy first, then the scripts in load order
manifest.json        the web app manifest
icon.svg             the app icon
sw.js                the web copy's service worker: offline, test builds (keel's sw-preview.js)
src/app.js           the start: APP_VERSION, loads the data, saves (debounced)
src/model.js         trips, places, expenses and files' records: cleaning, days, time slots, the board's sorts and filter (Node-tested)
src/store.js         IndexedDB on this device: the data ("doc"), each trip's cover photo and each file's bytes
src/merge.js         a trip as a bundle (one file), and how two copies of it merge three ways (Node-tested)
src/drive.js         Google Drive backups: keel's drive.js set up for Tripboard (its OAuth client IDs, docs/DRIVE.md); what a backup holds and when it runs are in views.js
src/sync.js          GitHub sync: the trips in a private repo of yours, one commit per sync (keel's github.js makes the calls)
src/settings.js      Settings on this device (your categories too, synced as categories.json): each provider's setup (key, style) and each service's main and fallback (Node-tested)
src/places.js        finding a place by name: OpenStreetMap, Google Places or MapTiler, tried in Settings' order (Node-tested)
src/map.js           the trip's map: MapLibre on OpenFreeMap, Google's 2D tiles or MapTiler, in Settings' order, loaded on first use; pins, fit, taps
src/vendor/          MapLibre GL 6.16.0 (BSD-3, MapLibre-LICENSE.txt): its module, worker and CSS
src/vendor/rtl-text/ MapLibre's right-to-left text plugin: @mapbox/mapbox-gl-rtl-text 1.0.0 (BSD-2, LICENSE.md), rtl.js and its .wasm, loaded by plugin.mjs in the map's worker when a label needs it
src/icons.js         the Lucide icons used, as SVG paths
src/views.js         Home, a trip's board and map, the trip and place sheets, Settings and its pages, the #/, #/settings[/<page>] and #/trip/<id>[/map] routing
src/styles.css       the tokens per theme, then the styles
src/keel/drive.js    Google Drive: sign-in, upload in pieces, keeping the newest three, restore (from keel)
src/keel/github.js   GitHub's API: files, trees, one-commit writes (from keel)
src/keel/errlog.js   the errors this device hit (from keel, loaded first)
src/keel/platform.js where it runs: browser, phone or desktop (from keel)
src/keel/releases.js the update check and test builds (from keel)
src/keel/motion.js   springs and moves, made in app.js (from keel)
src/keel/sw-preview.js  the service worker's half of a test build (from keel)
src/keel/i18n.js     languages: t()/tn() keyed by the English text, data-t in index.html, Intl dates and numbers (from keel)
src/language.js      the app's i18n, made in <head>; loads src/lang/<code>.js when the language isn't English
src/lang/he.js       the Hebrew words, keyed by the English
test/run-all.js      runs every test/*.test.js
test/app.test.js     index.html, sw.js's ASSETS and the version agree
test/model.test.js   src/model.js
test/merge.test.js   src/merge.js and the model's stamp()
test/places.test.js  src/places.js
test/settings.test.js  src/settings.js
test/i18n.test.js    every language table has every word the code uses, nothing stale or broken (keel's check)
test/csp.test.js     the policy and the code under it (keel's check)
test/contrast.test.js  every theme's colour pairs pass WCAG AA (keel's check)
test/keel.test.js    keel's files weren't edited here (from keel)
cli/                 the CLI (tripboard.js) and MCP server (mcp.js) on the sync repo; core.js reuses model.js, merge.js and keel's github.js in Node
test/cli.test.js     cli/, against a fake GitHub
server.js            the local server: this computer only (from keel)
tools/               release.js, keel-sync.js, keel-checks.js, android-version.js (from keel)
tools/build-www.js   copies sw.js's ASSETS into www/ (phones) or www-desktop/ (desktop), with app-build.json
tools/android-manifest.js  what the app adds to Capacitor's AndroidManifest.xml
tools/ios-project.js the iOS project's Info.plist keys and version
tools/sign-apk.sh    signs the APK with the release key, or a throwaway one
tools/test-build.sh  a pull request's build on the test-<branch> pre-release
tools/desktop-files.js  the desktop files under fixed names, and the updater's latest.json
package.json         the native builds' tools only (Capacitor, Tauri)
capacitor.config.json  the phone apps: id, name, colours
src-tauri/           the desktop app: one window on the same files, single instance, updater
assets/logo.svg      the phone apps' icon and splash (@capacitor/assets)
.github/workflows/   tests, Pages, android, ios, desktop, test-builds
```

android/, ios/, www/ and www-desktop/ are made in CI, never committed.

The files listed in `keel.lock.json` come from keel and are never edited
here: fix them in keel, release it, then `node tools/keel-sync.js v<x.y.z>`.

## Trade-offs

What the app gives up on purpose, said plainly. A change that adds one
adds a line here.

- Google Drive backups hold every trip, with its covers and files, as
  plain JSON in the person's own Drive (a Tripboard folder): anyone who can
  read that Drive can read them. The scope is drive.file, so Tripboard
  sees only the files it made. In a browser the sign-in token lasts an
  hour and is kept in localStorage for that hour; connect-src allows
  www.googleapis.com and oauth2.googleapis.com for it.
- Shared trips live on the sharing server (server/), readable by whoever
  runs its Cloudflare account; they aren't end-to-end encrypted. The
  server enforces who may edit and who sees expenses and files, but the
  owner's own sync repo still holds the whole trip.
- A shared trip's key is kept in its member's own sync repo
  (shares.json), so their devices share it; anyone who can read that
  repo could use the key until the person is taken off the trip.

- Trips live on this device only (IndexedDB) until sync is built: a
  cleared browser or a new phone starts empty.
- Distance sorting needs places with a location (Find by name, or a pin);
  places without one sort under "No location".
- The map is MapLibre, about 1.7 MB in src/vendor/, cached with the app.
  The policy's connect-src allows tiles.openfreemap.org (the map's tiles,
  style and fonts) and nominatim.openstreetmap.org (Find by name). Opening
  the map tells OpenFreeMap which area is shown; a search sends the typed
  name (and the trip's area) to OpenStreetMap. Nothing else leaves.
- MapLibre's worker holds an eval for a right-to-left text plugin that
  Tripboard never loads; test/csp.test.js names it, and the policy has no
  unsafe-eval, so it couldn't run anyway.
- Google and MapTiler need the person's own key. It's kept in
  localStorage on this device, in plain text like everything else there,
  and sent only to its own provider. Google's tile URLs carry the key, so
  it shows in the browser's network log; restrict it to the site and to
  Places API (New) and Map Tiles API, and cap its daily quota (the How to
  get a key steps say so). connect-src also allows places.googleapis.com,
  tile.googleapis.com and api.maptiler.com, used only when picked.
- Google's terms: only the place id is kept for good; a place's location
  from Google is kept with the day it came (geoAt), and its address isn't
  kept.
  Google's map shows "Google" and the area's copyright as text, not
  Google's logo image.
- Google's 30-day limit is kept by refreshing: on start, and when Settings
  change or the device comes back online, a Google location older than 30
  days is fetched again by its place id. If Google can't answer (no key, a
  refused key), the location is removed and comes back when Google can.
  Offline, nothing is removed. A trip planned with Google search and no key
  loses those pins after 30 days.
- A backup file holds the trips, places and cover photos as plain JSON:
  anyone with the file can read them. Keys and Settings aren't in it.
- MapTiler's terms on keeping search results weren't checked; its address
  and location are kept like OpenStreetMap's.
- When the main provider fails (no key, refused, quota), the fallback is
  used and the map or search says so; with no fallback set, it fails.

- GitHub sync keeps its token in this browser's localStorage, in plain
  text, like the map keys: anyone who can open this browser's Tripboard
  (or run script in it) can use it. The setup asks for a fine-grained
  token limited to one repo's contents, so that's all it can reach. The
  app refuses a public repo, since anyone could read the trips there.
- Synced trips are in the person's GitHub repo, so GitHub holds them, and
  the repo's history keeps every version, deleted trips included.
- Deletions travel as tombstones (`doc.deleted`), kept 120 days. A device
  that hasn't synced for longer than that can bring a deleted place back.
- Two devices changing the same field of the same record: the record with
  the later `updatedAt` wins, by each device's clock. A device with a
  wrong clock can win or lose when it shouldn't.
- Expenses add up per currency, with no exchange rates (they'd need a
  rates service and a date per expense), so a trip in two currencies
  shows two totals.
- A file can be kept on this device only (`local`): its record stays out
  of the trip's bundle, so other devices and other people never see it,
  not even its name. Making a synced file local removes its bytes from
  the repo but not from git history.
- A trip's synced files are kept whole on every synced device (no
  download-on-demand yet), up to 25 MB each. In the repo they're named
  by id (files/<trip>/<id>); their names are in the trip's bundle.
- A backup file holds each file's bytes as base64, so it grows by about
  a third more than the files themselves.
- The CLI and MCP server need a token in an environment variable or an
  MCP client's config file, in plain text there. A chat with the MCP
  server can change and delete trips. The tools tell it to ask before
  deleting, but nothing enforces that, and git history is the way back.
- Your person id is made per device until sharing can link a person's
  devices, so `by` on records names a device's id, not a person's. Trip
  roles are recorded but not enforced: there's no shared store to
  enforce them in (docs/SHARING.md).
- Cover photos sync whole (covers/<id>.jpg); the trip's `coverAt` says
  which copy is newer.

## Traps

Things that broke once and would again.

- `t` means a trip all through views.js, so words go through
  `i18n.t()` / `i18n.tn()`, never a bare `t()`. Files Node also loads
  (model, settings, places, sync, map) fall back to an English-only
  i18n when there's no window.
- A count goes through `i18n.tn(n, "1 place", "{n} places")`. Building a
  sentence from pieces ("Day " + n) can't be translated: give the whole
  sentence with `{name}` slots.

- maplibre-gl.css gives the map's container `position: relative`, which
  beat `.map`'s absolute fill and left the map 0 px high: the rule is
  `.map-view .map`, one class stronger.
