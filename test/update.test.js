// src/update.js: the update bar's download and install, with the phone's
// plugins faked (`node test/update.test.js`).
const assert = require("assert");
const U = require("../src/update.js");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + (e.stack || e.message)); }
}

const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
const t = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k]);
const els = () => ({ bar: { hidden: true }, text: { textContent: "" }, btn: { textContent: "", disabled: false }, close: {} });

function phone({ failDownload, failOpen, files = [] } = {}) {
  const calls = [];
  let progress = null;
  const Filesystem = {
    async addListener(ev, fn) { progress = fn; return { remove() { progress = null; } }; },
    async downloadFile(o) { calls.push(["download", o.url, o.path]); if (progress) progress({ bytes: 50, contentLength: 100 }); if (failDownload) throw new Error("net"); },
    async getUri(o) { return { uri: "file:///cache/" + o.path }; },
    async readdir() { return { files: files.map((name) => ({ name })) }; },
    async deleteFile(o) { calls.push(["delete", o.path]); },
  };
  const FileOpener = { async openFile(o) { calls.push(["open", o.path, o.mimeType]); if (failOpen) throw new Error("no"); } };
  const opened = [];
  const P = { native: true, os: "android", cap: { Plugins: { Filesystem, FileOpener } }, build: { repo: "danielnoam/Tripboard" }, openOutside: (u) => opened.push(u) };
  return { P, calls, opened };
}

(async () => {
  await test("a release's APK is the release's Tripboard.apk; an unreleased build's is its own url", () => {
    assert.strictEqual(U.apkUrl("danielnoam/Tripboard", { channel: "release", version: "0.3.2" }),
      "https://github.com/danielnoam/Tripboard/releases/download/app-v0.3.2/Tripboard.apk");
    assert.strictEqual(U.apkUrl("o/r", { channel: "unreleased", sha: "abc", url: "https://x/unreleased/Tripboard.apk" }), "https://x/unreleased/Tripboard.apk");
    assert.strictEqual(U.fileName({ channel: "unreleased", sha: "0123456789abcdef" }), "Tripboard-unreleased-0123456.apk");
  });

  await test("Update downloads with progress, then opens Android's installer; Install reopens it without downloading", async () => {
    const { P, calls } = phone();
    const e = els();
    U.create(P, newer).offer({ channel: "release", version: "0.3.2" }, e, t);
    assert.strictEqual(e.bar.hidden, false);
    assert.strictEqual(e.text.textContent, "Version 0.3.2 is out.");
    assert.strictEqual(e.btn.textContent, "Update");
    await e.btn.onclick();
    assert.deepStrictEqual(calls, [
      ["download", "https://github.com/danielnoam/Tripboard/releases/download/app-v0.3.2/Tripboard.apk", "Tripboard-0.3.2.apk"],
      ["open", "file:///cache/Tripboard-0.3.2.apk", "application/vnd.android.package-archive"],
    ]);
    assert.strictEqual(e.btn.textContent, "Install");
    assert.strictEqual(e.btn.disabled, false);
    await e.btn.onclick();
    assert.strictEqual(calls.filter((c) => c[0] === "download").length, 1);
    assert.strictEqual(calls.filter((c) => c[0] === "open").length, 2);
  });

  await test("a failed download offers Try again, and Try again downloads again", async () => {
    const p = phone({ failDownload: true });
    const e = els();
    U.create(p.P, newer).offer({ channel: "release", version: "0.3.2" }, e, t);
    await e.btn.onclick();
    assert.strictEqual(e.text.textContent, "The download didn't finish.");
    assert.strictEqual(e.btn.textContent, "Try again");
    await e.btn.onclick();
    assert.strictEqual(p.calls.filter((c) => c[0] === "download").length, 2);
  });

  await test("an installer that won't open says so", async () => {
    const { P } = phone({ failOpen: true });
    const e = els();
    U.create(P, newer).offer({ channel: "release", version: "0.3.2" }, e, t);
    await e.btn.onclick();
    assert.strictEqual(e.text.textContent, "Couldn't open the installer.");
  });

  await test("without the plugins, the APK opens in the phone's browser; on a computer, the release page", () => {
    const { P, opened } = phone();
    P.cap.Plugins = {};
    const e = els();
    U.create(P, newer).offer({ channel: "release", version: "0.3.2" }, e, t);
    assert.strictEqual(e.btn.textContent, "Download");
    e.btn.onclick();
    assert.deepStrictEqual(opened, ["https://github.com/danielnoam/Tripboard/releases/download/app-v0.3.2/Tripboard.apk"]);
    const d = { native: false, os: "windows", desktop: true, build: { repo: "o/r" }, openOutside: (u) => opened.push(u) };
    const e2 = els();
    U.create(d, newer).offer({ channel: "release", version: "0.3.2" }, e2, t);
    e2.btn.onclick();
    assert.strictEqual(opened[1], "https://github.com/o/r/releases/tag/app-v0.3.2");
  });

  await test("closing the bar hides it and remembers that version", () => {
    const { P } = phone();
    const e = els();
    let kept = null;
    U.create(P, newer).offer({ channel: "unreleased", sha: "0123456789", url: "https://x/a.apk" }, e, t, (k) => { kept = k; });
    assert.strictEqual(e.text.textContent, "A newer unreleased build is ready (0123456).");
    e.close.onclick();
    assert.strictEqual(e.bar.hidden, true);
    assert.strictEqual(kept, "0123456789");
  });

  await test("installed and unreleased APKs are cleared at launch; a newer release's is kept", async () => {
    const { P, calls } = phone({ files: ["Tripboard-0.3.1.apk", "Tripboard-0.3.2.apk", "Tripboard-0.3.0.apk", "Tripboard-unreleased-abc1234.apk", "other.json"] });
    await U.create(P, newer).clearOld("0.3.1");
    assert.deepStrictEqual(calls.map((c) => c[1]), ["Tripboard-0.3.1.apk", "Tripboard-0.3.0.apk", "Tripboard-unreleased-abc1234.apk"]);
  });

  console.log(passed + " passed");
})();
