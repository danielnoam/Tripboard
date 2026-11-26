# Tripboard architecture

The map of the code. A file added, removed or renamed, or a flow changed,
is updated here in the same change.

## Files

```
index.html           the page: its Content-Security-Policy first, then the scripts in load order
manifest.json        the web app manifest; its share_target lets the installed web app (Android Chrome) take a share, as ?sharetext=&sharetitle=&shareurl=
icon.svg             the app icon
assets/covers/       the ready-made covers, flat SVG drawings; a trip names its own as `art`, and a photo shows instead when it has one
sw.js                the web copy's service worker: offline, test builds (keel's sw-preview.js), and the CSP's extra sharing servers
src/app.js           the start: APP_VERSION, loads the data, saves (debounced)
src/model.js         trips, places (a journey is one with kind "journey": its arrival, the change between legs), expenses and files' records: cleaning, days, time slots, the Plan's two groupings (time, destination) and its filters (importance, category, rating: filterPlaces), destinations with dates (which destination a place and a day go with, the plan headed by destination), a day's order (time, then a place's `order`, then importance; a stay's time is check-in on its first day and check-out on its last) and the guessed time between places, what counts as a swipe, a trip's copy (duplicateTrip: yours alone, with or without locations, dates moved to a new start, and attachments; never ratings, been there, expenses or sharing) (Node-tested)
src/store.js         IndexedDB on this device: the data ("doc"), each trip's cover photo and each file's bytes
src/merge.js         a trip as a bundle (one file), and how two copies of it merge three ways (Node-tested)
src/drive.js         Google Drive backups: keel's drive.js set up for Tripboard (its OAuth client IDs, docs/DRIVE.md); what a backup holds and when it runs are in views.js
src/sync.js          GitHub sync: the trips in a private repo of yours, one commit per sync (keel's github.js makes the calls)
src/csp.js           the phone and desktop apps' CSP with this device's own sharing servers in connect-src (sw.js does it for the web app)
src/share.js         shared trips: each device on one syncs that trip with its sharing server (server/: Tripboard's, or one the person runs), beside GitHub sync; invite links, joining, leaving; publishing a trip (Sharing › Publish: a read-only snapshot of model.publishedOf, its key in "meta:published" and published.json) and opening a published one (#/p/<id>[/<host>], views.js renderPublished; Copy to my trips is the Duplicate sheet on model.publishedDoc)
src/settings.js      Settings on this device (your categories too, synced as categories.json): each provider's setup (key, style) and each service's main and fallback (Node-tested)
src/listimport.js    a Google Maps list from Google's exports (Takeout CSV, My Maps KML, Saved Places.json) and its name, and a pasted list (pasted: a name or Google Maps place link a line), what another app shared (shared: a name, an address, a link); New trip can start from one, Edit trip imports into the trip (Node-tested)
src/weather.js       the forecast per trip day from Open-Meteo: where each day's weather is for (its places' middle, rounded), one request for all of them, its answer read, when it's stale (Node-tested)
src/places.js        finding a place by name: OpenStreetMap, Google Places or MapTiler, tried in Settings' order (Node-tested)
src/offline.js       a trip saved for no signal: OpenFreeMap's map around its places in the Cache API, the plan of tiles, and the tbo:// protocol the map reads it through (Node-tested)
src/map.js           the trip's map: MapLibre on OpenFreeMap, Google's 2D tiles or MapTiler, in Settings' order, loaded on first use; pins, fit, taps; its credit chip (the styles' credits, kept to text and https links); zoom and where-am-I for views.js's own map buttons (MapLibre's are hidden)
src/vendor/          MapLibre GL 6.16.0 (BSD-3, MapLibre-LICENSE.txt): its module, worker and CSS
src/vendor/rtl-text/ MapLibre's right-to-left text plugin: @mapbox/mapbox-gl-rtl-text 1.0.0 (BSD-2, LICENSE.md), rtl.js and its .wasm, loaded by plugin.mjs in the map's worker when a label needs it
src/icons.js         the Lucide icons used, as SVG paths
src/views.js         Home, a trip's Today, board and map, the trip and place sheets (the place sheet: the Place / Journey switch (adding and editing), Enter in a new place's name searches and the answers show under it (#placeFoundSlot), Add another, Paste a list (its own sheet; bulk lookups in locateImported mark a place `check`, the Plan's To check filter, until its location is set or Looks right), the name as its header beside the category or mode icon, then cards for Where (Route for a journey), When, Details and Attachments; one name input and one start time are moved between a place's and a journey's slots in paintKind, a stay's check-out gets its own row in paintTimes, and Until waits behind "Lasts more than one day" unless set), Settings and its pages, the #/, #/settings[/<page>] and #/trip/<id>[/today|/map] routing (each open sheet is a history step of its own on top of its screen, so Back and Forward close and reopen sheets as well as screens: stepIn/stepOut, d.again; every step's state keeps the screens before it, `trail`, so the app's back arrow goes back in history with goUp instead of adding a step; go() holds a move until a sheet's step is taken off; the phone's Back button is the same history.back()), swiping between a trip's tabs, the moves between tabs and screens (tabBefore/tabAfter by depthOf: a tab slides, a deeper screen pushes in, Back pops; slideBubble; slideSheet for full-screen editors on a phone; pressBounce for the top buttons and trip cards: Web Animations on keel's spring(), a short cross-fade under reduced motion); on a computer (1100 px and wider, `desk`) a trip gets the side bar (paintSide) in place of the bottom bar, the map beside the Plan, Today, Expenses and Files unless folded away (`view.deskMap`, kept in localStorage `tripboard.view` with the page's share of the width, `view.split`, set by dragging #deskSplit), its own scrolling page, and tabs that fade over in place (deskFade) instead of sliding; a phone on its side (landscape, 500 px tall or less, `land`) gets the trip's tabs and + in a rail at the start (the bar's circle slides down it), the Plan's Time | Destination switch and filters moved into the top bar, no cover, and the Plan in columns with no folding, as on a computer
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
test/merge.test.js   src/merge.js (and arrivals(), what a sync brought) and the model's stamp()
test/places.test.js  src/places.js
test/weather.test.js src/weather.js
test/offline.test.js src/offline.js's tile plan, keys and style rewrite
test/listimport.test.js  src/listimport.js
test/settings.test.js  src/settings.js
test/sync.test.js    src/sync.js end to end: two devices in vms syncing through the fake GitHub (merges, deletions, covers and files, a repo that moves mid-sync, errors)
test/fakegithub.js   an in-memory GitHub for cli.test.js and sync.test.js
test/share.test.js   src/share.js's sharing servers and invite links, and sw.js (web) and src/csp.js (phone and desktop apps) adding them to the CSP
test/i18n.test.js    every language table has every word the code uses, nothing stale or broken (keel's check)
test/csp.test.js     the policy and the code under it (keel's check)
test/contrast.test.js  every theme's colour pairs pass WCAG AA (keel's check)
test/keel.test.js    keel's files weren't edited here (from keel)
cli/                 the CLI (tripboard.js) and MCP server (mcp.js) on the sync repo, both made from one list of commands (tools.js); core.js reads and writes the repo and does each edit and query, reusing model.js, merge.js, listimport.js, places.js and keel's github.js in Node. Each write is one commit; batch_update runs many write tools' steps on one doc in one commit, all or nothing, without the deleting ones
cli/coverage.js      every part of the app (record fields, sheets, Settings pages, undoable actions, repo files, model.js's API) and the tool that covers it, or why a chat can't
test/cli.test.js     cli/, against a fake GitHub
test/coverage.test.js  the drift guard: reads the app and fails when something in it has no CLI/MCP tool or reason in cli/coverage.js
server/              the sharing server: a Cloudflare Worker (worker.js) with D1 and KV, Google Maps list links (googlelist.js), published trips (published.js); not deployed yet (server/README.md)
test/server.test.js  server/, in Node against SQLite (as D1) and an in-memory KV
server/app/          copies of cli/'s tools and the src/ files they load (tools/server-copy.js), so server/ stands alone for the Deploy to Cloudflare button
server/mcp.js        the cloud connector: the same Worker as a remote MCP server for AI apps (Claude, ChatGPT, …), OAuth 2.1 sign-in with GitHub behind it, serving cli/mcp.js's tools minus deleting
test/cloud-mcp.test.js  server/mcp.js's sign-in and MCP over HTTP, against a fake GitHub and KV
docs/                SCOPE.md (v1), SHARING.md, DRIVE.md (turning on Drive backups), mockup/ (the first screens)
from-lifelog/        LifeLog's old Travel tab, for reference only; not loaded
changes/             notes for the next release (changes/README.md)
server.js            the local server: this computer only (from keel)
tools/               release.js, keel-sync.js, keel-checks.js, android-version.js (from keel)
tools/server-copy.js copies the app files the sharing server's bundle takes in to server/app/ (test/server.test.js checks they match)
tools/build-www.js   copies sw.js's ASSETS into www/ (phones) or www-desktop/ (desktop), with app-build.json
tools/android-manifest.js  what the app adds to Capacitor's AndroidManifest.xml, and the MainActivity it writes for Share → Tripboard (a SEND of text becomes a tripboard-share: address the App plugin passes on; views.js takeShares → the Add to a trip sheet → Add a place, the link attached once it's saved)
tools/ios-project.js the iOS project's Info.plist keys and version
tools/sign-apk.sh    signs the APK with the release key, or a throwaway one
tools/test-build.sh  a pull request's build on the test-<branch> pre-release
tools/desktop-files.js  the desktop files under fixed names, and the updater's latest.json
package.json         the native builds' tools only (Capacitor, Tauri)
capacitor.config.json  the phone apps: id, name, colours
src-tauri/           the desktop app: one window on the same files, single instance, updater
assets/logo.svg      the phone apps' icon and splash (@capacitor/assets)
.github/workflows/   tests, Pages, android (on its own only for a merge to main with a new APP_VERSION), ios, desktop, test-builds, server (deploys server/ once its secrets are set, also after a change to cli/ or the src/ files it loads)
```

android/, ios/, www/ and www-desktop/ are made in CI, never committed.

The files listed in `keel.lock.json` come from keel and are never edited
here: fix them in keel, release it, then `node tools/keel-sync.js v<x.y.z>`.

## Trade-offs

What the app gives up on purpose, said plainly. A change that adds one
adds a line here.

- Any app can share text into Tripboard (Android's Share, or the web
  app's share target). It only fills the Add to a trip sheet: nothing is
  kept until the person picks a trip and leaves Add a place with a name,
  and a link is kept only if it's http or https. The shared name is then
  searched for with the place search the person set up, as Enter in the
  name does; a short Google Maps link is never opened.
- Picking a map style that needs a key (Map style on the map) makes that
  provider the map and OpenFreeMap its fallback, so a refused key still
  shows a map; the style is sent nowhere else. The Street View link, like
  the Google Maps one, tells Google the place's location only when tapped.

- A journey's two ends are places like any other: where it arrives,
  found by name, follows Google's rule (its id kept, its location 30 days,
  its address never), refreshed or dropped with the places' own. Times are
  each end's local clock; there are no time zones, so a flight's length
  isn't shown, only the wait between two legs at the same place. An older
  build shows a journey as a place named after where it leaves.
- Google Drive backups hold every trip, with its covers and files, as
  plain JSON in the person's own Drive (a Tripboard folder): anyone who can
  read that Drive can read them. The scope is drive.file, so Tripboard
  sees only the files it made. In a browser the sign-in token lasts an
  hour and is kept in localStorage for that hour; connect-src allows
  www.googleapis.com and oauth2.googleapis.com for it.
- Destinations are found on the map by name (Settings' search provider,
  OpenStreetMap by default) when Edit trip is saved or Dates from your
  stays is tapped, and only once a trip has two or more destinations or
  one with dates: the provider gets each destination's name, nothing
  else, as Find by name does. The location is kept in the trip's
  destInfo, so it's asked once. A place then goes with the nearest
  destination within 60 km, which is a guess: towns close together
  (Osaka, Kobe, Nara) can swap a place, so Edit place can pick one by
  hand. The CLI and MCP don't look destinations up by themselves; a chat
  passes lat and lng (find_location) in destInfo.
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
  The bundled phone and desktop apps have no service worker, so
  tools/build-www.js gives their index.html the policy twice: once with
  `https:` added to connect-src, and once as `<meta name="tripboard-csp">`,
  which src/csp.js, the first script, writes as a second policy with this
  device's servers (localStorage `tripboard.servers`, https only). Both
  policies apply, so connect-src is that exact list. The same trade-off
  as the web app's, plus one: if csp.js never ran, connect-src would be
  any https site (everything else stays strict). It's a file in the app
  itself, so it only fails to run if the app is broken.
- Whoever runs a sharing server reads the trips shared through it.
  Joining from an invite link to a server that isn't Tripboard's asks
  first and says so. A trip's server travels in shares.json next to its
  key ({ key, server }); older copies of the app skip those entries.
  The CLI and MCP read shares.json only to say which server a shared trip
  is on (get_trip); the keys never leave core.js.
- A shared trip's key is kept in its member's own sync repo
  (shares.json), so their devices share it; anyone who can read that
  repo could use the key until the person is taken off the trip.
- Publishing a trip (Sharing › Publish, publish_trip) puts a read-only
  snapshot of its plan on the sharing server, readable by anyone who has
  the link, and links get forwarded. The link's id is random (16
  characters) and nothing lists published trips, so it's unlisted, not
  private. What goes is picked field by field (model.publishedOf, and
  server/published.js again, so a newer field stays home until it's
  listed): name, destinations, drawn cover, categories, each place's
  name, category, importance, location, day and time, and optionally
  descriptions and links/notes. Never ratings, been there, expenses,
  files, a cover photo or who is on the trip. It says who published it
  by the name in Settings › Sharing (none if empty). Real dates are
  optional: without them the days are moved to start on 2001-01-01 and
  shown as Day 1, Day 2. The key that updates or removes it is kept in
  the publisher's sync repo (published.json), like shares.json. Opening
  a link sends the server nothing but the id; copying adds one to a
  count the publisher sees, with nothing about who copied it.

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
  Places API (New) and Map Tiles API, and give the project a budget with
  a spend cap (the How to get a key steps say so; Places API (New)
  quotas can't be lowered). Whether each key last worked or was refused
  (by Test, or by the map or a search) is kept beside it, on this device
  only, and cleared when the key changes. connect-src also allows places.googleapis.com,
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
- Sync keys (Settings › Services, off until turned on, Daniel's choice
  2026-11-23) puts the Google and MapTiler keys in the sync repo's
  keys.json, in plain text, so his other devices get them. The switch and
  each key's newer change win across devices; turning it off rewrites
  keys.json without keys. Trade-off: anything that can read the repo can
  read the keys: each device's sync token, the cloud connector's GitHub
  App (its token on the Worker) and GitHub itself, and the repo's history
  keeps every key ever synced, so a leaked key means making a new one; the
  Google project's spend cap bounds the cost. Passphrase encryption was
  turned down as nearly as much typing as pasting the key. core.js never
  reads keys.json, and reads repo bytes only from covers/ and files/
  (a file id like "../../keys.json" is refused, and the app's sync skips
  such ids), so no CLI, MCP or cloud tool returns a key. Backups and
  shared trips never hold it.
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
- Links and notes live in Attachments as file records with `kind` "link" (and
  `url`) or "note" (and `text`), so sync, sharing (including hiding
  Files from someone), backups and places carry them with no new code.
  They have no bytes. A phone on 0.3.5 or older keeps them untouched but
  lists them as a file that isn't on the device yet, until it updates.
  A link must be http or https (no javascript:, data: or file:), and
  opening it opens that site in the browser, which then knows you
  visited. A note is plain text, up to 50,000 characters.
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
  expenses, people's names, and the links and notes in Attachments (their text
  is in the trip's bundle anyway, like a place's description). Files'
  contents are the exception, off
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
- A ready-made cover is only its name (`art` on the trip), so it costs
  nothing to sync or share. Picking one drops the trip's photo, and a
  photo drops the drawing.

- **Setup link and code for another device** (Settings › Data). The link carries the sync token, owner and repo after the `#` (`#t=…&o=…&r=…`), which browsers never send to a server, and keel's qr.js draws the code on the device, so the token never goes to a QR service. The trade-off is that anyone who sees the code or gets the link can use the token. The page says to use them only on your own devices, and keeps the code hidden until Show setup code is tapped, since Data is opened often. Opening a link takes the token out of the address bar first, then asks before connecting, so a link someone else sends can't quietly point this device at their repo.
- **The app installs its own updates** (keel's src/keel/update.js). The Android app has REQUEST_INSTALL_PACKAGES and downloads the APK from the repo's public GitHub release over HTTPS, then hands it to Android's installer. Android shows its own install screen every time and only installs over the app if the APK is signed with the same key, so a swapped file can't replace Tripboard; what this trusts is the GitHub account that publishes releases and the signing key. The APK sits in the app's cache until a later launch clears it. Settings › About's Check for updates (app.js's checkUpdates) runs the same check on demand and offers the update in About even when the bottom bar was closed; on the web it asks the browser for a new sw.js and offers a reload once it's in.

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

