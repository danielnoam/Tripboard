# TripApp

LifeLog's Travel tab, taken out of LifeLog on 2026-11-15 and kept here
until it becomes its own app. Nothing here runs on its own yet: it is the
code, tests, styles and notes exactly as they were in LifeLog (main at
`eca2dac`), so a new app can start from them.

## What it did

- **Trips**: a name and optional start and end dates. Places belong to a
  trip and can have a day, and a time (and end time) on that day. A place
  with a time is scheduled; one with only a day is "sometime that day"; one
  with neither is "sometime this trip". A visited tick, and long-press to
  drag places between days.
- **Three views** of a trip (LifeLog modes, swipeable): By time (day by
  day), By area (places within 15 km grouped and named after their town)
  and Map (Leaflet with CARTO tiles, pins numbered per day, a dashed route,
  the map and list linked).
- **Google Maps import**: a shared list link or a single place link. The
  list comes from Google's unofficial list endpoint (there is no API for
  saved lists), with a map to pick places from, skipping any already in the
  trip (same Google id, or the same name within 50 m).
- **Google place details**: rating, opening hours and reviews through the
  Places API (New) with the person's own key. Only `placeId` is stored
  (Google's terms); the rest is fetched when a place's sheet opens.
- **Town names** from OpenStreetMap Nominatim for places whose address
  doesn't name one, asked once and cached on the place (`town`).
- **History and backup**: every save kept on the device (IndexedDB), plus
  GitHub's commit history, with a version picker that brings trips back;
  an optional local file backup on desktop Chrome and Edge.
- **Search**: trips and places were in LifeLog's search.
- **Share**: a Google Maps link shared into LifeLog went into a trip.
- **AI bridge tools**: `lifelog_trips`, `lifelog_add_trip`,
  `lifelog_update_trip`, `lifelog_delete_trip`, `lifelog_add_place`,
  `lifelog_update_place`, `lifelog_delete_place`, `lifelog_google_list`,
  `lifelog_import_google_list`.

## What's here

| Path | What |
| --- | --- |
| `src/travel.js` | The whole tab: data cleaning, dates, ordering, areas, the Google list parser, rendering, sheets, import, map, history. Pure parts are exported for Node (`module.exports`). |
| `src/vendor/leaflet.*` | Leaflet 1.9 (BSD 2-Clause), loaded on first use of a map. |
| `tests/travel.test.js` | Node unit tests for the pure parts (runs against LifeLog's `src/` layout: `require("../src/…")`). |
| `tests/browser/travel*.js` | LifeLog's Playwright suites for the tab, the map and import, and the 0.245.0 extras (Nominatim, Places, history). They use LifeLog's `harness.js`. |
| `tests/fixtures/google-list.js` | A captured Google Maps list response, for the parser and the bridge. |
| `from-lifelog/travel.html` | Every piece of markup LifeLog had for Travel (tab, + menu, chips row, trip/place/import sheets, Settings rows, credits). |
| `from-lifelog/travel.css` | Travel's styles, built on LifeLog's tokens (`--space-*`, `--fs-*`, `--accent`…). |
| `from-lifelog/bridge-travel-tools.js` | The AI bridge's travel tools and helpers, cut out of LifeLog's `bridge/tools.js`. |
| `from-lifelog/DATA-trips.md` | The `travel.json` format as the bridge documented it. |
| `from-lifelog/removal.diff` | The full diff of the removal in LifeLog's other files (app.js wiring, storage, merge, settings, search, share, platform's native routes, the proxy routes, Tauri permissions, tests, docs). Read it backwards to see how Travel plugged in. |
| `docs/CHANGELOG-travel.md` | LifeLog's changelog lines about Travel, by release (0.241.0 to 0.248.0 mostly). |
| `docs/HISTORY.md` | The decisions made while it was built (what Daniel asked for, what was dropped). |
| `docs/screenshots/` | The README shots of the tab (demo data). |

## The data

`travel.json`, compact JSON: `{ "trips": [ ... ], "places": [ ... ] }`
(fields in `from-lifelog/DATA-trips.md`). In LifeLog it sat beside
`lifelog.json` in the private GitHub data repo, with its own sha, merge
base (`mergeTravel`: both collections merged item by item) and history.

LifeLog no longer reads or writes it, so Daniel's real trips are still in
that file in the data repo, untouched. A device that had the tab open also
keeps its copy in IndexedDB (`travelCache`, `travelBase`, store
`travelHistory`) until the app's reset. The Google Places key stays in
LifeLog's synced settings as `settings.mediaKeys.googlePlaces`.

## Services it used

- Google Maps shared lists: `https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=en&gl=us&pb=!1m4!1s<LIST_ID>!2e1!3m1!1e1!2e2!3e2!4i500!16b1`
  returns `)]}'` + JSON. Root `[0][4]` is the list name, `[0][8]` the
  places; for a place `p`: `p[2]` name, `p[3]` note, `p[1][4]` address
  (often empty), `p[1][5][2..3]` lat/lng, `p[1][6]` Google's `0x…:0x…` id.
  Short links (`maps.app.goo.gl/…`) redirect to an address carrying
  `!2s<LIST_ID>`; read the redirect, don't load the page.
- In a browser both need a CORS proxy. LifeLog's Cloudflare worker had
  `/gmaps-link/<code>` (answers `{ url }` from the redirect) and
  `/gmaps-list/<id>`; the Android app used native HTTP instead (see
  `platform.js` in the diff). Both routes are in `removal.diff`.
- Places API (New): `places.googleapis.com/v1/places/<id>` with
  `X-Goog-Api-Key` and a field mask; billing on, personal use stays in the
  free allowance.
- OpenStreetMap Nominatim reverse lookups for town names (one request a
  second, cached), CARTO basemap tiles, both credited.

## Known gaps

- The Google list import, Nominatim and Places were never tested against
  the live services from the cloud sandbox (it couldn't reach google.com);
  Daniel's real use was the only test.
- The design discussion is in the Claude Doc "LifeLog travel tab design".

## Getting it back into LifeLog

Everything is also in LifeLog's git history: `git show eca2dac:src/travel.js`
and so on, or revert the pull request that removed it.
