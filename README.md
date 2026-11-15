# Tripboard

A travel planner: a trip is a board of places, seen by time, by category
or on a map. What v1 holds is in [docs/SCOPE.md](docs/SCOPE.md); LifeLog's old
Travel tab, kept as reference, is in [from-lifelog/](from-lifelog/README.md).
"Tripboard" is a working name.

Plain HTML, CSS and JS with **no build step and no dependencies**, served
as static files. The same files ship as the web app (GitHub Pages), the
Android and iOS apps (Capacitor) and the Windows and Linux app (Tauri).
Started from keel's template; the files `keel.lock.json` lists come from
keel.

## Run it

```sh
node server.js          # http://localhost:5173
node test/run-all.js    # the tests
```

## Setting up the builds

Once, when the repo is new:

1. **Pages:** Settings → Pages → Source: GitHub Actions. `pages.yml` then
   deploys `main` once the tests pass.
2. **Android key:** the APK is signed with the same key for life, or an
   update won't install over the last one. Make it once and keep a copy
   somewhere safe:

   ```sh
   keytool -genkeypair -keystore tripboard.jks -alias tripboard -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 tripboard.jks   # → secret ANDROID_KEYSTORE_B64
   ```

   and its password as the secret `ANDROID_KEYSTORE_PASSWORD`. Without
   them the APK is signed with a throwaway key and no release is published.
3. **Desktop updates (optional):** `npx tauri signer generate`, then the
   secrets `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
   and `TAURI_UPDATER_PUBKEY`. Without them the desktop app still builds,
   and updates are a download from the release page.
4. **Labels:** `test`, `test-android`, `test-ios`, `test-desktop` and
   `test-linux`. One on a pull request puts its build on a `test-<branch>`
   pre-release.

The app id is `com.danielnoam.trips` and the repo is assumed to be
`danielnoam/tripboard`: if it's named differently, change `src-tauri/tauri.conf.json`'s
two GitHub addresses and the fallback in `tools/desktop-files.js`.

## Features

One short line per feature, under its own heading, as they ship.

## Credits

- Icons: [Lucide](https://lucide.dev) (ISC licence).
- Map: [MapLibre GL JS](https://maplibre.org) (BSD-3), tiles from [OpenFreeMap](https://openfreemap.org), © [OpenMapTiles](https://www.openmaptiles.org), data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- Find by name: OpenStreetMap's [Nominatim](https://nominatim.org).
- With your own key: Google's [Map Tiles](https://developers.google.com/maps/documentation/tile) and [Places](https://developers.google.com/maps/documentation/places/web-service) APIs, and [MapTiler](https://www.maptiler.com)'s maps and search.
