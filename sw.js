// The service worker for Tripboard's web copy: installable and usable
// offline. Stale-while-revalidate for the app's own files: a launch paints
// from cache while a fresh copy is fetched for the next one, and the
// ?v=x.y.z on every tag in index.html makes a release's files new URLs.
// Other sites' requests are never touched.
//
// CACHE goes up with every release (tools/release.js). A file added to or
// removed from the app goes in or out of ASSETS (test/app.test.js checks);
// src/vendor/maplibre-gl.* is the map, loaded when a map first opens.
const CACHE = "tripboard-v2";
const ASSETS = [
  "./", "./index.html", "./manifest.json", "./icon.svg",
  "./src/styles.css", "./src/model.js", "./src/store.js", "./src/settings.js", "./src/merge.js", "./src/sync.js", "./src/share.js", "./src/drive.js", "./src/places.js", "./src/listimport.js", "./src/offline.js", "./src/map.js", "./src/icons.js", "./src/views.js", "./src/app.js",
  "./src/keel/errlog.js", "./src/keel/i18n.js", "./src/language.js", "./src/theme.js", "./src/lang/he.js", "./src/keel/github.js", "./src/keel/drive.js", "./src/keel/platform.js", "./src/keel/releases.js", "./src/keel/motion.js", "./src/keel/sw-preview.js",
  "./src/vendor/maplibre-gl.mjs", "./src/vendor/maplibre-gl-worker.mjs", "./src/vendor/maplibre-gl.css", "./src/vendor/rtl-text/plugin.mjs", "./src/vendor/rtl-text/rtl.js", "./src/vendor/rtl-text/mapbox-gl-rtl-text.wasm",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== "tripboard-offline" && !k.startsWith(PREVIEW)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// A test build in the browser: keel's sw-preview.js serves the picked
// commit's files while one is open, with a Back to the release bar.
importScripts("src/keel/sw-preview.js");
// The name keel's releases.js opens a test build into: its `name`, lower case.
const PREVIEW = "Tripboard".toLowerCase() + "-preview";
const preview = self.KeelPreview.create(PREVIEW);

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(preview.respond(e, fromRelease));
});

function fromRelease(e) {
  return caches.open(CACHE).then((cache) =>
    cache.match(e.request).then((cached) => {
      const fetching = fetch(e.request)
        .then((res) => { if (res && res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => null);
      return cached || fetching.then((res) =>
        res || caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("./index.html")));
    })
  );
}
