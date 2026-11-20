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
src/model.js         trips, places, expenses and files' records: cleaning, days, time slots, the board's sorts and filter, Today's order and the guessed time between places, what counts as a swipe (Node-tested)
src/store.js         IndexedDB on this device: the data ("doc"), each trip's cover photo and each file's bytes
src/merge.js         a trip as a bundle (one file), and how two copies of it merge three ways (Node-tested)
src/drive.js         Google Drive backups: keel's drive.js set up for Tripboard (its OAuth client IDs, docs/DRIVE.md); what a backup holds and when it runs are in views.js
src/sync.js          GitHub sync: the trips in a private repo of yours, one commit per sync (keel's github.js makes the calls)
src/share.js         shared trips: each device on one syncs that trip with the sharing server (server/), beside GitHub sync; invite links, joining, leaving
src/settings.js      Settings on this device (your categories too, synced as categories.json): each provider's setup (key, style) and each service's main and fallback (Node-tested)
src/listimport.js    a Google Maps list from Google's exports (Takeout CSV, My Maps KML, Saved Places.json) and its name; New trip can start from one, Edit trip imports into the trip (Node-tested)
src/places.js        finding a place by name: OpenStreetMap, Google Places or MapTiler, tried in Settings' order (Node-tested)
src/offline.js       a trip saved for no signal: OpenFreeMap's map around its places in the Cache API, the plan of tiles, and the tbo:// protocol the map reads it through (Node-tested)
src/map.js           the trip's map: MapLibre on OpenFreeMap, Google's 2D tiles or MapTiler, in Settings' order, loaded on first use; pins, fit, taps
src/vendor/          MapLibre GL 6.16.0 (BSD-3, MapLibre-LICENSE.txt): its module, worker and CSS
src/vendor/rtl-text/ MapLibre's right-to-left text plugin: @mapbox/mapbox-gl-rtl-text 1.0.0 (BSD-2, LICENSE.md), rtl.js and its .wasm, loaded by plugin.mjs in the map's worker when a label needs it
src/icons.js         the Lucide icons used, as SVG paths
src/views.js         Home, a trip's Today, board and map, the trip and place sheets, Settings and its pages, the #/, #/settings[/<page>] and #/trip/<id>[/today|/map] routing, and swiping between a trip's tabs
src/styles.css       the tokens per theme, then the styles
src/keel/drive.js    Google Drive: sign-in, upload in pieces, keeping the newest three, restore (from keel)
src/keel/github.js   GitHub's API: files, trees, one-commit writes (from keel)
src/keel/errlog.js   the errors this device hit (from keel, loaded first)
src/keel/platform.js where it runs: browser, phone or desktop (from keel)
src/keel/releases.js the update check and test builds (from keel)
src/keel/motion.js   springs and moves, made in app.js (from keel)
src/keel/sw-preview.js  the service worker's half of a test build (from keel)
src/keel/i18n.js     languages: t()/tn() keyed by the English text, data-t in index.html, Intl dates and numbers (from keel)
src/keel/qr.js       a QR encoder (from keel); synced but not loaded or cached yet
src/theme.js         the theme set in <head>, before the page draws
src/language.js      the app's i18n, made in <head>; loads src/lang/<code>.js when the language isn't English
src/lang/he.js       the Hebrew words, keyed by the English
test/run-all.js      runs every test/*.test.js
test/app.test.js     index.html, sw.js's ASSETS and the version agree
test/model.test.js   src/model.js
test/merge.test.js   src/merge.js and the model's stamp()
test/places.test.js  src/places.js
test/offline.test.js src/offline.js's tile plan, keys and style rewrite
test/listimport.test.js  src/listimport.js
test/settings.test.js  src/settings.js
test/i18n.test.js    every language table has every word the code uses, nothing stale or broken (keel's check)
test/csp.test.js     the policy and the code under it (keel's check)
test/contrast.test.js  every theme's colour pairs pass WCAG AA (keel's check)
test/keel.test.js    keel's files weren't edited here (from keel)
cli/                 the CLI (tripboard.js) and MCP server (mcp.js) on the sync repo, both made from one list of commands (tools.js); core.js reads and writes the repo and does each edit and query, reusing model.js, merge.js, listimport.js, places.js and keel's github.js in Node
cli/coverage.js      every part of the app (record fields, sheets, Settings pages, undoable actions, repo files, model.js's API) and the tool that covers it, or why a chat can't
test/cli.test.js     cli/, against a fake GitHub
test/coverage.test.js  the drift guard: reads the app and fails when something in it has no CLI/MCP tool or reason in cli/coverage.js
server/              the sharing server: a Cloudflare Worker (worker.js) with D1 and KV, Google Maps list links (googlelist.js); not deployed yet (server/README.md)
test/server.test.js  server/, in Node against SQLite (as D1) and an in-memory KV
docs/                SCOPE.md (v1), SHARING.md, DRIVE.md (turning on Drive backups), mockup/ (the first screens)
from-lifelog/        LifeLog's old Travel tab, for reference only; not loaded
changes/             notes for the next release (changes/README.md)
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
.github/workflows/   tests, Pages, android, ios, desktop, test-builds, server (deploys server/ once its secrets are set)
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
- Importing a Google Maps list by its link goes through the sharing
  server (server/googlelist.js), which reads the undocumented data Google
  Maps' own page loads. It isn't allowed by Google's terms for automated
  use and can stop working whenever Google changes it; the file import is
  the steady route. The server sees the link and the list's places, and
  allows 60 lists a day per address. Imported locations are kept like a
  pin; places looked up afterwards follow Find by name's rules.
- Shared trips live on the sharing server (server/), readable by whoever
  runs its Cloudflare account; they aren't end-to-end encrypted. The
  server enforces who may edit and who sees expenses and files, but the
  owner's own sync repo still holds the whole trip.
- A shared trip's key is kept in its member's own sync repo
  (shares.json), so their devices share it; anyone who can read that
  repo could use the key until the person is taken off the trip.

- Without GitHub sync (or a backup file), trips live on this device only
  (IndexedDB): a cleared browser or a new phone starts empty.
- Today's times between places are guesses from the straight line (a
  third added for streets, walking at 5 km/h, past 2 km a drive at
  25 km/h), not a route: a river, a hill or a one-way street can make the
  real way much longer. A routing service would fix it but sends every
  place to it, and Google's costs money. Navigate opens Google Maps with
  the place's location (or name) and Google id, only when tapped.
- Distance sorting needs places with a location (Find by name, or a pin);
  places without one sort under "No location".
- The map is MapLibre, about 1.7 MB in src/vendor/, cached with the app.
  The policy's connect-src allows tiles.openfreemap.org (the map's tiles,
  style and fonts) and nominatim.openstreetmap.org (Find by name). Opening
  the map tells OpenFreeMap which area is shown; a search sends the typed
  name (and the trip's area) to OpenStreetMap. Nothing else leaves.
- Saving a trip for offline downloads OpenFreeMap's tiles around each of
  its places (zoom 14 within 4 km, zoom 11 within 15 km, the trip's area to
  zoom 8, the world to zoom 2), so OpenFreeMap learns those areas at once,
  as it would by browsing them. They're kept in the Cache API
  ("tripboard-offline") on this device only, never synced, and what was
  saved per trip is in localStorage ("tripboard.offline"). The app asks the
  browser to keep it (navigator.storage.persist), but a browser can still
  clear it: Safari clears a website's storage after about 7 days unused
  unless it's on the home screen. Between the saved rings the map is drawn
  from coarser tiles. The size shown before saving is a guess (80 KB a
  tile). "Only on Wi-Fi" can only tell mobile data where the browser says
  so (Chrome on Android); elsewhere it saves on any connection. Once a trip
  is saved, the map reads OpenFreeMap through the tbo:// protocol: tiles,
  glyphs and sprites come from the kept copy first, so a saved area shows
  its saved tiles until Update now. Google's tiles aren't saved (its
  terms); MapTiler's terms weren't checked, so it isn't either. With no
  connection and a saved trip, OpenFreeMap is used whatever Settings picks.
- MapLibre's worker holds an eval for a right-to-left text plugin given
  as a classic script. Tripboard's plugin (src/vendor/rtl-text/plugin.mjs)
  is a module, which the worker import()s, so the eval never runs;
  test/csp.test.js names it.
- The page's policy is a meta tag, which doesn't reach the map's worker: a
  worker gets its policy from its own response headers, and GitHub Pages
  sends none. So connect-src doesn't limit the worker's requests. It
  fetches only what the chosen provider's style names (tiles, glyphs,
  sprites) and the right-to-left plugin's .wasm from Tripboard itself.
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
  server can change and delete everything the app can: trips, places,
  expenses, files, covers, categories, people on a shared trip, and
  restore a backup over trips. The tools tell it to ask before deleting
  (and mark those tools destructiveHint), but nothing enforces that, and
  git history is the way back.
- What a chat reads goes to its AI provider: trips, places, notes,
  expenses and people's names. Files' contents are the exception, off
  unless the person sets TRIPBOARD_MCP_FILES=1 (tickets and passports are
  the kind of file people keep there). A chat can always add a file and
  see file names. A chat never gives the server a path, only bytes, so it
  can't make it read other files on the computer; the CLI's --path is
  for the person at the terminal.
- find_location (CLI `locate`) sends the name searched for, and the
  trip's area, to OpenStreetMap's Nominatim, as the app's Find by name
  does, with a Tripboard-CLI user agent.
- The CLI's role checks (a viewer can't edit, only the owner changes
  who's on a trip or deletes it) need me.json and are only a courtesy,
  like the app's: the token can write anything in the repo.
- A cover set from the CLI or a chat is kept as given (up to 5 MB, JPEG,
  PNG or WebP), not shrunk as the app does, so each device downloads it
  whole.
- Your person id is made per device until sharing can link a person's
  devices, so `by` on records names a device's id, not a person's; GitHub
  sync gives a person's synced devices one id (me.json). Trip roles are
  enforced by the sharing server for a shared trip; on a device they only
  set what the screens let you do, and the owner's own sync repo always
  holds the whole trip (docs/SHARING.md).
- Cover photos sync whole (covers/<id>.jpg); the trip's `coverAt` says
  which copy is newer.

- **Setup link and code for another device** (Settings › GitHub sync). The link carries the sync token, owner and repo after the `#` (`#t=…&o=…&r=…`), which browsers never send to a server, and keel's qr.js draws the code on the device, so the token never goes to a QR service. The trade-off is that anyone who sees the code or gets the link can use the token. The page says to use them only on your own devices. Opening a link takes the token out of the address bar first, then asks before connecting, so a link someone else sends can't quietly point this device at their repo.

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

