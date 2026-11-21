// Tripboard: updating the installed app from GitHub. keel's releases.js
// finds the update to offer; this is the bar that offers it and the
// download, as in LifeLog.
//
// Android: "Update" downloads the release's Tripboard.apk into the app's
// cache with its progress on the bar (Capacitor's Filesystem plugin), then
// hands it to Android's installer (FileOpener). Android asks once whether
// Tripboard may install apps, then to install; the APK is signed with the
// same key, so it installs over the top and keeps everything. If the
// installer is dismissed, "Install" reopens it without downloading again.
// An app built before the plugins were in it (0.3.1 and older) has no
// download of its own, so the bar opens the APK in the phone's browser.
//
// Desktop: the bar opens the release page (or the unreleased build's file)
// in the browser.
//
// An unreleased build (the "unreleased" channel) has main's commit instead
// of a new version: the bar names it by that, and its APK comes from the
// site's unreleased/.
(function () {
  const APK = "Tripboard.apk";
  const APK_MIME = "application/vnd.android.package-archive";

  // The update's file: the release's APK, or the unreleased build's.
  function apkUrl(repo, u) {
    if (u.channel === "unreleased") return u.url;
    return repo ? "https://github.com/" + repo + "/releases/download/app-v" + u.version + "/" + APK : null;
  }
  // The name it's kept under in the app's cache.
  const fileName = (u) => "Tripboard-" + (u.channel === "unreleased" ? "unreleased-" + u.sha.slice(0, 7) : u.version) + ".apk";

  // APKs already installed have done their job: everything but a newer
  // release's is cleared at launch.
  function stale(name, mine, newer) {
    const m = /^Tripboard-(\d+\.\d+\.\d+)\.apk$/.exec(name || "");
    return m ? !newer(m[1], mine) : /^Tripboard-unreleased-.+\.apk$/.test(name || "");
  }

  // P: keel's platform (cap, native, os, desktop, build, openOutside).
  function create(P, newer) {
    const plugins = () => (P.native && P.cap && P.cap.Plugins) || {};
    const canInstall = () => P.os === "android" && !!plugins().Filesystem && !!plugins().FileOpener;

    // Resolves to the downloaded file's uri.
    async function download(u, onProgress) {
      const FS = plugins().Filesystem;
      const url = apkUrl(P.build && P.build.repo, u);
      if (!url) throw new Error("no repo in app-build.json");
      const path = fileName(u);
      const listener = await FS.addListener("progress", (p) => {
        if (onProgress && p && p.contentLength > 0) onProgress(Math.min(1, p.bytes / p.contentLength));
      });
      try {
        await FS.downloadFile({ url, path, directory: "CACHE", progress: true });
      } finally {
        if (listener && listener.remove) listener.remove();
      }
      return (await FS.getUri({ path, directory: "CACHE" })).uri;
    }

    const install = (uri) => plugins().FileOpener.openFile({ path: uri, mimeType: APK_MIME });

    async function clearOld(mine) {
      const FS = plugins().Filesystem;
      if (!FS) return;
      try {
        const { files } = await FS.readdir({ path: "", directory: "CACHE" });
        for (const f of files || []) {
          const name = typeof f === "string" ? f : f && f.name;
          if (stale(name, mine, newer)) await FS.deleteFile({ path: name, directory: "CACHE" });
        }
      } catch (e) { /* nothing to tidy */ }
    }

    // Shows update `u` (from releases.check) on the bar: { bar, text, btn, close }.
    // t is i18n.t; dismiss(key) remembers a closed bar.
    function offer(u, els, t, dismiss) {
      const { bar, text, btn, close } = els;
      const unreleased = u.channel === "unreleased";
      const short = unreleased ? u.sha.slice(0, 7) : "";
      const key = unreleased ? u.sha : u.version;
      const say = (msg, label, busy) => {
        text.textContent = msg;
        btn.textContent = label;
        btn.disabled = !!busy;
      };
      const isOut = () => (unreleased ? t("A newer unreleased build is ready ({sha}).", { sha: short }) : t("Version {version} is out.", { version: u.version }));
      close.onclick = () => { bar.hidden = true; if (dismiss) dismiss(key); };
      bar.hidden = false;

      if (!canInstall()) {
        // A computer, or an app without the plugins: the browser has it.
        say(isOut(), P.os === "android" ? t("Download") : t("Get it"));
        const where = P.os === "android" ? apkUrl(P.build && P.build.repo, u)
          : unreleased ? u.url : "https://github.com/" + (P.build && P.build.repo) + "/releases/tag/app-v" + u.version;
        btn.onclick = () => P.openOutside(where);
        return;
      }

      let uri = null;
      const opener = async () => {
        say(t("Opening the installer…"), t("Install"), true);
        try {
          await install(uri);
          say(unreleased ? t("Build {sha} is ready to install.", { sha: short }) : t("Version {version} is ready to install.", { version: u.version }), t("Install"));
        } catch (e) {
          say(t("Couldn't open the installer."), t("Try again"));
        }
      };
      say(isOut(), t("Update"));
      btn.onclick = async () => {
        if (uri) return opener();
        say(unreleased ? t("Downloading build {sha}…", { sha: short }) : t("Downloading version {version}…", { version: u.version }), "0%", true);
        try {
          uri = await download(u, (f) => { btn.textContent = Math.round(f * 100) + "%"; });
        } catch (e) {
          say(t("The download didn't finish."), t("Try again"));
          return;
        }
        return opener();
      };
    }

    return { canInstall, download, install, clearOld, offer };
  }

  const api = { create, apkUrl, fileName, stale, APK };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { window.Tripboard = window.Tripboard || {}; window.Tripboard.update = api; }
})();
