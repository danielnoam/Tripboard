# Tripboard v1 scope

A travel planner in the spirit of Wanderlog: a trip is a board of places,
seen by time, by category or on a map. Written 2026-11-15 from Daniel's
wireframe. "Tripboard" is a working name; the app id `com.danielnoam.trips`
is permanent and doesn't carry it.

The repo also holds LifeLog's old Travel tab under `from-lifelog/`
(trips, places, By time / By area / Map, Google list import, Places
details). It is the reference to build from, not code that runs here.

## Screens

**Home.** New trip, and My trips (cover, name, dates). Community trips
come later.

**New trip.** Name, dates (optional), destinations, cover image.

**Trip board.** The trip's places as cards, with + to add one. Sort by:

- **Time:** the trip's days, each split into time slots, and a "No date"
  bucket for places not planned yet.
- **Distance**
- **Importance**
- **Category:** grouped under each category.

Importance is also a filter (show only the must-sees, say).

**Map.** The trip's places on a map: MapLibre GL with OpenFreeMap tiles,
free and with no key. Credited in About.

**Place.** Search for it (Google Places), then the app's own fields:
importance, time, name, category, description. Nearby picks below it.
External ratings come later.

## Places and Google

- Places come through a provider interface, so the source can change.
  Google Places is the first and only one in v1.
- Only Google's `place_id` is stored, plus the app's own fields. Anything
  else from Google is fetched when it's shown and never kept (Google's
  terms).
- **Keys:**
  - The app ships with a default key, put in at build time from a
    repository secret. It's never committed.
  - Each install has a daily cap on searches, so one install can't spend
    the shared key.
  - Settings has "Use my own key", with steps for setting it up and a Test
    button.
- **With no key, or the cap reached,** everything still works: places are
  typed in by hand and pinned on the map.
- Daniel makes the Google keys himself. A key is never pasted into a chat.

## Open questions

- **The default key is public.** It ships inside the web app and the APK,
  so anyone can read it. Restrictions limit what it can be used for:
  - by HTTP referrer for the web,
  - by package name and signing key for Android,
  - by bundle id for iOS,
  - Places API only.
  The per-install cap only slows down someone who copies the key. A Google
  Cloud budget alert and a quota cap on the project are what actually stop
  the spending.
- **Web and desktop need a different key setup.** Android and iOS keys are
  locked to the app, but a key used from the browser and the desktop app
  has to be referrer-restricted. That likely means two keys, or a small
  proxy.
- **Bringing over existing trips:** whether to import LifeLog's old
  `travel.json` (Daniel's real trips are still in LifeLog's data repo), and
  the Google Maps list import, which mattered most to him in LifeLog.
- **Where trips are kept and synced:** on the device first. Sync would go
  through keel's GitHub sync or Drive backups, like the other apps.
