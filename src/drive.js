// Tripboard: backups in Google Drive, beside GitHub sync rather than
// instead of it, through keel's drive.js (src/keel/drive.js). What goes in
// a backup and when one runs are Tripboard's own (src/views.js); this sets
// keel's Drive up for Tripboard.
//
// A backup is one JSON file, the same shape as Storage → Save a backup
// (every trip, with its covers and files), in a "Tripboard" folder in the
// person's Drive. The scope is drive.file: Tripboard sees only the files it
// made. Drive keeps the newest three (and a week-old one).
//
//   Tripboard.drive.upload(text, device)    .download(id) -> data
//   .connect() .disconnect() .list() .remove(id) .getToken(ask, then)
//   .available .on .email .auto .every .last .due .signedIn .closing .resume
(function () {
  // Tripboard's own Google Cloud OAuth clients (docs/DRIVE.md says how to
  // make them). Neither is a secret. Empty means Drive isn't offered there.
  const WEB_CLIENT = "";
  const DESKTOP_CLIENT = "";
  const DESKTOP_SECRET = "";

  const K = window.Keel;
  if (!K || !K.drive) return;
  const P = () => K.platform || {};
  const drive = K.drive.create({
    name: "Tripboard", tag: "tbdrive", mime: "application/json",
    keys: { cfg: "tripboard.drive", token: "tripboard.drive-token", hand: "tripboard.drive-hand", ask: "tripboard.drive-ask" },
    webClient: WEB_CLIENT, desktopClient: DESKTOP_CLIENT, desktopSecret: DESKTOP_SECRET,
    native: () => !!P().native, desktop: () => !!P().desktop,
    plugin: () => (P().native && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Drive) || null,
    tauri: () => (P().desktop && window.__TAURI__) || null,
    openOutside: (url) => P().openOutside(url),
  });

  window.Tripboard = window.Tripboard || {};
  window.Tripboard.drive = {
    DriveError: K.drive.DriveError,
    EVERY: K.drive.EVERY,
    connect: () => drive.connect(),
    disconnect: () => drive.disconnect(),
    list: () => drive.list(),
    remove: (id) => drive.remove(id),
    getToken: (ask, then) => drive.getToken(ask, then),
    // Sends one backup; it becomes `last`. A blob, so a big one goes up
    // in pieces.
    async upload(text, device) {
      const made = await drive.upload({ blob: new Blob([text], { type: "application/json" }) }, { device });
      const out = { id: made.id, size: made.size || text.length, at: Date.now() };
      drive.last = out;
      return out;
    },
    async download(id) {
      const blob = await drive.download(id);
      try { return JSON.parse(await blob.text()); } catch (e) { throw new K.drive.DriveError("That backup can't be read.", "bad"); }
    },
    get available() { return drive.available; },
    get on() { return drive.on; },
    get email() { return drive.email; },
    get auto() { return drive.auto; },
    set auto(v) { drive.auto = v; },
    get every() { return drive.every; },
    set every(v) { drive.every = v; },
    get last() { const l = drive.last; return l && l.at ? l : null; },
    get due() { return drive.due; },
    get signedIn() { return drive.signedIn; },
    get closing() { return drive.closing; },
    get resume() { return drive.resume; },
  };
})();
