// An in-memory GitHub for the tests: a git with the calls keel's
// github.js makes (refs, trees, commits, blobs, contents), for the CLI
// tests and GitHub sync's. Not a test file itself.
const crypto = require("crypto");

// AI tools may delete in these (the app's switch, ai.json), unless deleting: false.
function fakeGitHub({ deleting = true } = {}) {
  const blobs = new Map(), trees = new Map(), commits = new Map();
  const sha = (s) => crypto.createHash("sha1").update(s).digest("hex");
  const putBlob = (buf) => { const s = sha(Buffer.concat([Buffer.from("blob " + buf.length + "\0"), buf])); blobs.set(s, buf); return s; };
  const putTree = (map) => { const s = sha(JSON.stringify([...map].sort())); trees.set(s, map); return s; };
  const putCommit = (tree, parents) => { const s = sha(tree + parents.join() + Math.random()); commits.set(s, { tree, parents }); return s; };
  const start = new Map([["README.md", putBlob(Buffer.from("# data\n"))]]);
  if (deleting) start.set("ai.json", putBlob(Buffer.from(JSON.stringify({ deleting: true, at: "2026-11-21T00:00:00.000Z" }))));
  const g = { head: putCommit(putTree(start), []), commits: 0, moveBeforeNextPatch: null, refReads: 0, moveOnRefRead: null, treeReads: 0, notModified: 0 };
  g.files = () => trees.get(commits.get(g.head).tree);
  g.read = (path) => JSON.parse(blobs.get(g.files().get(path)).toString());
  g.raw = (path) => blobs.get(g.files().get(path));
  g.put = (path, text) => { const map = new Map(g.files()); map.set(path, putBlob(Buffer.from(text))); g.head = putCommit(putTree(map), [g.head]); };
  const res = (status, body, h = {}) => ({ ok: status < 300, status, headers: { get: (k) => h[k] || "" }, json: async () => body, text: async () => JSON.stringify(body),
    arrayBuffer: async () => body });
  g.fetch = async (url, { method = "GET", body, headers }) => {
    const u = new URL(url);
    const b = body ? JSON.parse(body) : null;
    if (u.hostname === "nominatim.openstreetmap.org") {
      g.lastUserAgent = headers["User-Agent"];
      return res(200, [{ name: "Fushimi Inari Taisha", display_name: "Fushimi Inari Taisha, Kyoto, Japan", lat: "34.9671", lon: "135.7727", category: "amenity", type: "place_of_worship" }]);
    }
    if (u.hostname === "api.open-meteo.com") {
      g.lastWeather = u; g.lastUserAgent = headers["User-Agent"];
      const n = u.searchParams.get("latitude").split(",").length;
      const one = (i) => ({ daily: { time: [u.searchParams.get("start_date")], weather_code: [61 + i], temperature_2m_max: [12.4], temperature_2m_min: [4.6],
        precipitation_probability_max: [70], sunrise: [u.searchParams.get("start_date") + "T06:41"], sunset: [u.searchParams.get("start_date") + "T16:44"] } });
      return res(200, n === 1 ? one(0) : Array.from({ length: n }, (x, i) => one(i)));
    }
    if (headers.Authorization !== "Bearer tok") return res(401, { message: "Bad credentials" });
    if (u.pathname === "/repos/me/data") return res(200, { private: true, default_branch: "main" });
    const p = u.pathname.replace("/repos/me/data/", "");
    let x;
    if (p === "git/ref/heads/main") {
      // moveOnRefRead: { n, fn }, another writer's commit just before the n-th read of the head.
      g.refReads++;
      if (g.moveOnRefRead && g.refReads === g.moveOnRefRead.n) { const f = g.moveOnRefRead.fn; g.moveOnRefRead = null; f(); }
      // Its ETag is the head: asked with it while the head hasn't moved, a 304.
      const etag = '"' + g.head + '"';
      if (headers["If-None-Match"] === etag) { g.notModified++; return res(304, null, { ETag: etag }); }
      return res(200, { object: { sha: g.head } }, { ETag: etag });
    }
    if ((x = /^git\/trees\/(\w+)$/.exec(p)) && method === "GET") return g.treeReads++, res(200, { tree: [...trees.get(commits.get(x[1]).tree)].map(([path, s]) => ({ path, sha: s, type: "blob" })) });
    if ((x = /^git\/commits\/(\w+)$/.exec(p))) return res(200, { tree: { sha: commits.get(x[1]).tree } });
    if (p === "git/trees") {
      const map = new Map(b.base_tree ? trees.get(b.base_tree) : []);
      for (const e of b.tree) { if (e.content != null) map.set(e.path, putBlob(Buffer.from(e.content))); else if (e.sha === null) map.delete(e.path); else map.set(e.path, e.sha); }
      return res(201, { sha: putTree(map) });
    }
    if (p === "git/commits") return res(201, { sha: putCommit(b.tree, b.parents) });
    if (p === "git/blobs") return res(201, { sha: putBlob(Buffer.from(b.content, b.encoding === "base64" ? "base64" : "utf8")) });
    if (p === "git/refs/heads/main") {
      if (g.moveBeforeNextPatch) { const f = g.moveBeforeNextPatch; g.moveBeforeNextPatch = null; f(); }
      if (commits.get(b.sha).parents[0] !== g.head) return res(422, { message: "Update is not a fast forward" });
      g.head = b.sha; g.commits++; return res(200, {});
    }
    if ((x = /^contents\/(.+)$/.exec(p))) {
      const path = x[1].split("/").map(decodeURIComponent).join("/");
      const ref = u.searchParams.get("ref");
      const map = commits.has(ref) ? trees.get(commits.get(ref).tree) : g.files();
      const s = map.get(path);
      if (!s) return res(404, { message: "Not Found" });
      if (headers.Accept === "application/vnd.github.raw") { const buf = blobs.get(s); return res(200, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)); }
      return res(200, { sha: s, size: blobs.get(s).length, content: blobs.get(s).toString("base64") });
    }
    return res(500, { message: "fake: " + method + " " + p });
  };
  return g;
}

module.exports = fakeGitHub;
