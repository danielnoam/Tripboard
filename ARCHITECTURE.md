# Tripboard architecture

The map of the code. A file added, removed or renamed, or a flow changed,
is updated here in the same change.

## Files

```
index.html           the page: its Content-Security-Policy first, then the scripts in load order
manifest.json        the web app manifest
icon.svg             the app icon
sw.js                the web copy's service worker: offline, test builds (keel's sw-preview.js), and the CSP's extra sharing servers
src/app.js           the start: APP_VERSION, loads the data, saves (debounced)
src/model.js         trips, places, expenses and files' records: cleaning, days, time slots, the board's sorts and filter, a day's order (time, then a place's `order`, then importance) and the guessed time between places, what counts as a swipe (Node-tested)
src/store.js         IndexedDB on this device: the data ("doc"), each trip's cover photo and each file's bytes
src/merge.js         a trip as a bundle (one file), and how two copies of it merge three ways (Node-tested)
src/drive.js         Google Drive backups: keel's drive.js set up for Tripboard (its OAuth client IDs, docs/DRIVE.md); what a backup holds and when it runs are in views.js
src/sync.js          GitHub sync: the trips in a private repo of yours, one commit per sync (keel's github.js makes the calls)
src/share.js         shared trips: each device on one syncs that trip with its sharing server (server/: Tripboard's, or one the person runs), beside GitHub sync; invite links, joining, leaving
src/settings.js      Settings on this device (your categories too, synced as categories.json): each provider's setup (key, style) and each service's main and fallback (Node-tested)
src/listimport.js    a Google Maps list from Google's exports (Takeout CSV, My Maps KML, Saved Places.json) and its name; New trip can start from one, Edit trip imports into the trip (Node-tested)
src/weather.js       the forecast per trip day from Open-Meteo: where each day's weather is for (its places' middle, rounded), one request for all of them, its answer read, when it's stale (Node-tested)
src/places.js        finding a place by name: OpenStreetMap, Google Places or MapTiler, tried in Settings' order (Node-tested)
src/offline.js       a trip saved for no signal: OpenFreeMap's map around its places in the Cache API, the plan of tiles, and the tbo:// protocol the map reads it through (Node-tested)
src/map.js           the trip's map: MapLibre on OpenFreeMap, Google's 2D tiles or MapTiler, in Settings' order, loaded on first use; pins, fit, taps
src/vendor/          MapLibre GL 6.16.0 (BSD-3, MapLibre-LICENSE.txt): its module, worker and CSS
src/vendor/rtl-text/ MapLibre's right-to-left text plugin: @mapbox/mapbox-gl-rtl-text 1.0.0 (BSD-2, LICENSE.md), rtl.js and its .wasm, loaded by plugin.mjs in the map's worker when a label needs it
src/icons.js         the Lucide icons used, as SVG paths
src/views.js         Home, a trip's Today, board and map, the trip and place sheets, Settings and its pages, the #/, #/settings[/<page>] and #/trip/<id>[/today|/map] routing, swiping between a trip's tabs, the moves between tabs and screens (tabBefore/tabAfter by depthOf: a tab slides, a deeper screen pushes in, Back pops; slideBubble; slideSheet for full-screen editors on a phone; pressBounce for the top buttons and trip cards: Web Animations on keel's spring(), a short cross-fade under reduced motion)
src/styles.css       the tokens per theme, then the styles
src/keel/drive.js    Google Drive: sign-in, upload in pieces, keeping the newest three, restore (from keel)
src/keel/github.js   GitHub's API: files, trees, one-commit writes (from keel)
src/keel/errlog.js   the errors this device hit (from keel, loaded first)
src/keel/platform.js where it runs: browser, phone or desktop (from keel)
src/keel/releases.js the update check and test builds (from keel)
src/keel/update.js   the update bar: on Android, Update downloads the release's APK into the app's cache (Capacitor Filesystem) and opens Android's installer (FileOpener); elsewhere the browser has it (from keel)
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
test/weather.test.js src/weather.js
test/offline.test.js src/offline.js's tile plan, keys and style rewrite
test/listimport.test.js  src/listimport.js
test/settings.test.js  src/settings.js
test/share.test.js   src/share.js's sharing servers and invite links, and sw.js adding them to the CSP
test/i18n.test.js    every language table has every word the code uses, nothing stale or broken (keel's check)
test/csp.test.js     the policy and the code under it (keel's check)
test/contrast.test.js  every theme's colour pairs pass WCAG AA (keel's check)
test/keel.test.js    keel's files weren't edited here (from keel)
cli/                 the CLI (tripboard.js) and MCP server (mcp.js) on the sync repo, both made from one list of commands (tools.js); core.js reads and writes the repo and does each edit and query, reusing model.js, merge.js, listimport.js, places.js and keel's github.js in Node. Each write is one commit; batch_update runs many write tools' steps on one doc in one commit, all or nothing, without the deleting ones
cli/coverage.js      every part of the app (record fields, sheets, Settings pages, undoable actions, repo files, model.js's API) and the tool that covers it, or why a chat can't
test/cli.test.js     cli/, against a fake GitHub
test/coverage.test.js  the drift guard: reads the app and fails when something in it has no CLI/MCP tool or reason in cli/coverage.js
server/              the sharing server: a Cloudflare Worker (worker.js) with D1 and KV, Google Maps list links (googlelist.js); not deployed yet (server/README.md)
test/server.test.js  server/, in Node against SQLite (as D1) and an in-memory KV
server/mcp.js        the cloud connector: the same Worker as a remote MCP server for AI apps (Claude, ChatGPT, …), OAuth 2.1 sign-in with GitHub behind it, serving cli/mcp.js's tools minus deleting
test/cloud-mcp.test.js  server/mcp.js's sign-in and MCP over HTTP, against a fake GitHub and KV
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
.github/workflows/   tests, Pages, android (on its own only for a merge to main with a new APP_VERSION), ios, desktop, test-builds, server (deploys server/ once its secrets are set)
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
  allows 60 lists a day per address. The CLI and local MCP send a link
  to the same server; the cloud connector reads it in the Worker itself
  (60 a day per person). Imported locations are kept like a
  pin; places looked up afterwards follow Find by name's rules.
- Shared trips live on the sharing server (server/), readable by whoever
  runs its Cloudflare account; they aren't end-to-end encrypted. The
  server enforces who may edit and who sees expenses and files, but the
  owner's own sync repo still holds the whole trip. The server is
  https://tripboard.danielnoam1999.workers.dev (Daniel's Cloudflare
  account, free plan), the one extra host in connect-src for it; the
  app sends it nothing until someone shares or joins a trip, or imports
  a Google Maps list by its link.
- Sharing servers people run themselves (Settings › Sharing server,
  server/README.md "Running your own"). index.html's CSP names only
  Tripboard's server, and a meta CSP can't change while the page runs, so
  sw.js adds this device's other servers to connect-src as it serves the
  page: the address picked in Settings, each shared trip's server, and
  one an invite link is joining through (src/share.js keeps the list in
  the "tripboard-servers" cache; only https origins, checked in both
  files). The policy stays strict for everyone else, and a new address
  works after one reload. The trade-off: a script that got into the page
  could write a server to that list and keep it allowed across reloads;
  with a static CSP it couldn't. Before that, it would need a way in
  (strict script-src still blocks inline and outside scripts). Allowing
  every *.workers.dev instead was turned down (2026-11-21): anyone can
  make one for free, so it would let such a script send trips anywhere.
  Works only with the service worker (the web app over https), not in
  the bundled phone and desktop apps yet.
- Whoever runs a sharing server reads the trips shared through it.
  Joining from an invite link to a server that isn't Tripboard's asks
  first and says so. A trip's server travels in shares.json next to its
  key ({ key, server }); older copies of the app skip those entries.
  The CLI and MCP read shares.json only to say which server a shared trip
  is on (get_trip); the keys never leave core.js.
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
- Weather (src/weather.js) comes from Open-Meteo (api.open-meteo.com, in
  connect-src), off until the person says yes on Today or the Plan, or in
  Settings › Services › Weather. Once on, opening a trip within 16 days of its dates
  sends Open-Meteo one point per day (the middle of that day's located
  places, or its first when they spread over 30 km, rounded to 2 decimals,
  about a kilometre) and the dates; never names, notes or anything else.
  Open-Meteo sees the requesting IP, so it can tell where someone plans to
  be and when. It's asked again after 3 hours, or when a place moves. The
  last forecast is kept in localStorage ("tripboard.weather") on this
  device only, never synced, so an offline trip shows it; turning weather
  off deletes it. A day without located places borrows the nearest day's
  point, so its weather can be for the wrong town. Further than 16 days
  off there's nothing (no climate averages: they'd take a second service
  and years of history per point). get_weather (CLI `weather`) sends the
  same points, with a Tripboard-CLI user agent.
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
  restore a backup over trips, once Settings › AI tools › Let AI tools
  delete is on (off at first). That switch is ai.json in the sync repo:
  the app writes it, and core.js reads it before every tool that deletes,
  removes or replaces, and refuses any write to it, so a chat with only
  Tripboard's tools (CLI, local MCP, cloud connector) can't turn it on.
  It is a safety catch, not a lock: anything that holds the token itself
  (a shell, git, a chat that can run commands) can edit ai.json or the
  trips directly. It's one setting for all your devices, because the
  tools only see the repo. Even off, update tools can blank fields.
  The tools also say to ask before deleting (and are destructiveHint),
  and git history is the way back.
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
- The cloud connector (server/mcp.js) lets an AI app read and change
  trips from its own cloud. Each call passes the trip through the Worker
  (whoever runs its Cloudflare account) and into the chat, where the AI
  company keeps it under its own rules. The Worker holds each sign-in's
  GitHub token, AES-GCM encrypted in KV under TRIPBOARD_MCP_SECRET, so
  whoever controls the Cloudflare account and that secret could use it;
  the GitHub App limits it to the repos it's installed on, Contents only.
  The AI app holds Tripboard's own bearer token (an hour, refreshed for
  up to 30 days): anyone who gets it can act as you until then. It has
  the delete tools, which work only while Let AI tools delete is on (as
  above); off, it can still change or blank anything, and a
  place note or an imported list could carry text that steers it; git
  history is the way back. Sharing roles don't apply, as with the local
  MCP. Only the GitHub ids in TRIPBOARD_MCP_USERS get in, and a consent
  page with a browser-bound cookie stops another site from signing you
  in to its own registered client. Each call reads every trip, so on
  Cloudflare's free plan (about 50 outside calls a request) it fails past
  roughly 40 trips.
- Your person id is made per device until sharing can link a person's
  devices, so `by` on records names a device's id, not a person's; GitHub
  sync gives a person's synced devices one id (me.json). Trip roles are
  enforced by the sharing server for a shared trip; on a device they only
  set what the screens let you do, and the owner's own sync repo always
  holds the whole trip (docs/SHARING.md).
- Cover photos sync whole (covers/<id>.jpg); the trip's `coverAt` says
  which copy is newer.

- **Setup link and code for another device** (Settings › GitHub sync). The link carries the sync token, owner and repo after the `#` (`#t=…&o=…&r=…`), which browsers never send to a server, and keel's qr.js draws the code on the device, so the token never goes to a QR service. The trade-off is that anyone who sees the code or gets the link can use the token. The page says to use them only on your own devices. Opening a link takes the token out of the address bar first, then asks before connecting, so a link someone else sends can't quietly point this device at their repo.
- **The app installs its own updates** (keel's src/keel/update.js). The Android app has REQUEST_INSTALL_PACKAGES and downloads the APK from the repo's public GitHub release over HTTPS, then hands it to Android's installer. Android shows its own install screen every time and only installs over the app if the APK is signed with the same key, so a swapped file can't replace Tripboard; what this trusts is the GitHub account that publishes releases and the signing key. The APK sits in the app's cache until a later launch clears it.

## Traps

Things that broke once and would again.

- The app's web address is index.html's `keel-site` meta (and its repo
  `keel-repo`); share links and setup links read it. Moving the repo or
  adding a custom domain: change both first, ship a release, then move.
  GitHub redirects the repo, not its Pages address (keel README, "Moving
  an app").
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

