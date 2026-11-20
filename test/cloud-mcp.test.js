// server/mcp.js: the cloud connector's sign-in (OAuth 2.1, PKCE, GitHub
// behind it) and its MCP over HTTP, against a fake GitHub and an in-memory
// KV (`node test/cloud-mcp.test.js`).
const assert = require("assert");
const crypto = require("crypto");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + (e.stack || e.message)); }
}

// GitHub: the sign-in, /user, and an in-memory git with the calls cli/core.js makes.
function fakeGitHub() {
  const blobs = new Map(), trees = new Map(), commits = new Map();
  const sha = (s) => crypto.createHash("sha1").update(s).digest("hex");
  const putBlob = (buf) => { const s = sha(Buffer.concat([Buffer.from("blob " + buf.length + "\0"), buf])); blobs.set(s, buf); return s; };
  const putTree = (map) => { const s = sha(JSON.stringify([...map].sort())); trees.set(s, map); return s; };
  const putCommit = (tree, parents) => { const s = sha(tree + parents.join() + Math.random()); commits.set(s, { tree, parents }); return s; };
  const g = { head: putCommit(putTree(new Map([["README.md", putBlob(Buffer.from("# data\n"))]])), []), userId: 110013928, tokenLife: 28800, exchanges: [], calls: [] };
  g.files = () => trees.get(commits.get(g.head).tree);
  g.read = (path) => JSON.parse(blobs.get(g.files().get(path)).toString());
  const res = (status, body) => ({ ok: status < 300, status, headers: { get: () => "" }, json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => body });
  g.fetch = async (url, { method = "GET", body, headers = {} } = {}) => {
    const u = new URL(url);
    g.calls.push({ host: u.host, auth: headers.Authorization, ua: headers["User-Agent"] });
    if (u.href === "https://github.com/login/oauth/access_token") {
      const f = Object.fromEntries(new URLSearchParams(body));
      g.exchanges.push(f);
      if (f.client_secret !== "app-secret") return res(200, { error: "incorrect_client_credentials" });
      if (f.code === "good" || (f.grant_type === "refresh_token" && f.refresh_token === "ghr")) return res(200, { access_token: "tok", expires_in: g.tokenLife, refresh_token: "ghr" });
      return res(200, { error: "bad_verification_code" });
    }
    if (headers.Authorization !== "Bearer tok") return res(401, { message: "Bad credentials" });
    if (u.pathname === "/user") return res(200, { id: g.userId, login: "me" });
    if (u.pathname === "/repos/me/data") return res(200, { private: true, default_branch: "main" });
    const p = u.pathname.replace("/repos/me/data/", "");
    const b = body ? JSON.parse(body) : null;
    let x;
    if (p === "git/ref/heads/main") return res(200, { object: { sha: g.head } });
    if ((x = /^git\/trees\/(\w+)$/.exec(p)) && method === "GET") return res(200, { tree: [...trees.get(commits.get(x[1]).tree)].map(([path, s]) => ({ path, sha: s, type: "blob" })) });
    if ((x = /^git\/commits\/(\w+)$/.exec(p))) return res(200, { tree: { sha: commits.get(x[1]).tree } });
    if (p === "git/trees") {
      const map = new Map(b.base_tree ? trees.get(b.base_tree) : []);
      for (const e of b.tree) { if (e.content != null) map.set(e.path, putBlob(Buffer.from(e.content))); else if (e.sha === null) map.delete(e.path); else map.set(e.path, e.sha); }
      return res(201, { sha: putTree(map) });
    }
    if (p === "git/commits") return res(201, { sha: putCommit(b.tree, b.parents) });
    if (p === "git/refs/heads/main") {
      if (commits.get(b.sha).parents[0] !== g.head) return res(422, { message: "Update is not a fast forward" });
      g.head = b.sha; return res(200, {});
    }
    if ((x = /^contents\/(.+)$/.exec(p))) {
      const path = x[1].split("/").map(decodeURIComponent).join("/");
      const ref = u.searchParams.get("ref");
      const map = commits.has(ref) ? trees.get(commits.get(ref).tree) : g.files();
      const s = map.get(path);
      if (!s) return res(404, { message: "Not Found" });
      return res(200, { sha: s, size: blobs.get(s).length, content: blobs.get(s).toString("base64") });
    }
    return res(500, { message: "fake: " + method + " " + p });
  };
  return g;
}

function fakeEnv(g, extra) {
  const kv = new Map();
  return {
    GITHUB_APP_CLIENT_ID: "Iv1.app", GITHUB_APP_CLIENT_SECRET: "app-secret", MCP_SECRET: "a long random test secret", MCP_USERS: "110013928=me/data",
    FILES: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } },
    FETCH: g.fetch, kv, ...extra,
  };
}

const b64u = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

(async () => {
  const W = await import("../server/worker.js");
  const C = await import("../server/mcp.js");
  const call = async (env, method, path, { body, form, headers = {} } = {}) => {
    const h = { ...headers };
    let b;
    if (form) { h["Content-Type"] = "application/x-www-form-urlencoded"; b = new URLSearchParams(form).toString(); }
    else if (body !== undefined) { h["Content-Type"] = "application/json"; b = JSON.stringify(body); }
    const r = await W.handle(new Request("https://tb.test" + path, { method, headers: h, body: b, redirect: "manual" }), env);
    const ct = r.headers.get("Content-Type") || "";
    return { status: r.status, headers: r.headers, body: ct.includes("json") ? await r.json() : await r.text() };
  };
  // The whole sign-in, as an AI app and a person would do it: register,
  // the consent page, Allow, GitHub, back with a code, the token.
  async function signIn(env) {
    const reg = await call(env, "POST", "/register", { body: { client_name: "Claude", redirect_uris: [REDIRECT] } });
    const verifier = b64u(crypto.randomBytes(32));
    const challenge = b64u(crypto.createHash("sha256").update(verifier).digest());
    const q = new URLSearchParams({ response_type: "code", client_id: reg.body.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "xyz" });
    const ask = await call(env, "GET", "/authorize?" + q);
    const cookie = ask.headers.get("Set-Cookie").split(";")[0];
    const askToken = /name="ask" value="([^"]+)"/.exec(ask.body)[1];
    const allow = await call(env, "POST", "/authorize", { form: { ask: askToken }, headers: { Cookie: cookie } });
    const state = new URL(allow.headers.get("Location")).searchParams.get("state");
    const cb = await call(env, "GET", "/callback?" + new URLSearchParams({ code: "good", state }), { headers: { Cookie: cookie } });
    return { reg, verifier, challenge, ask, cookie, askToken, allow, state, cb, code: cb.headers.get("Location") && new URL(cb.headers.get("Location")).searchParams.get("code") };
  }
  const tokens = async (env, s) => (await call(env, "POST", "/token", { form: { grant_type: "authorization_code", code: s.code, redirect_uri: REDIRECT, client_id: s.reg.body.client_id, code_verifier: s.verifier } })).body;
  const rpc = (env, token, method, params, id = 1) => call(env, "POST", "/mcp", { body: { jsonrpc: "2.0", id, method, params }, headers: { Authorization: "Bearer " + token } });

  await test("not set up: its routes answer 404 and the sharing server works as before", async () => {
    const g = fakeGitHub();
    const env = { ...fakeEnv(g), MCP_SECRET: "" };
    assert.strictEqual((await call(env, "POST", "/mcp", { body: {} })).status, 404);
    assert.strictEqual((await call(env, "GET", "/.well-known/oauth-authorization-server")).status, 404);
    assert.deepStrictEqual((await call(env, "GET", "/nothing")).body, { error: "Not here." });
  });

  await test("it says where to sign in, and /mcp without a token points there", async () => {
    const env = fakeEnv(fakeGitHub());
    const pr = await call(env, "GET", "/.well-known/oauth-protected-resource/mcp");
    assert.deepStrictEqual([pr.body.resource, pr.body.authorization_servers], ["https://tb.test/mcp", ["https://tb.test"]]);
    const as = await call(env, "GET", "/.well-known/oauth-authorization-server");
    assert.deepStrictEqual([as.body.registration_endpoint, as.body.code_challenge_methods_supported], ["https://tb.test/register", ["S256"]]);
    const r = await call(env, "POST", "/mcp", { body: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    assert.strictEqual(r.status, 401);
    assert.match(r.headers.get("WWW-Authenticate"), /resource_metadata="https:\/\/tb\.test\/\.well-known\/oauth-protected-resource\/mcp"/);
  });

  await test("registration takes https, loopback and app schemes, never script or plain http", async () => {
    assert.ok(C.okRedirect(REDIRECT) && C.okRedirect("http://127.0.0.1:3334/cb") && C.okRedirect("cursor://anysphere.cursor-retrieval/oauth/cb"));
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "http://evil.test/cb", "https://x.test/cb#frag", "nonsense"]) assert.ok(!C.okRedirect(bad), bad);
    const env = fakeEnv(fakeGitHub());
    assert.strictEqual((await call(env, "POST", "/register", { body: { redirect_uris: ["javascript:alert(1)"] } })).status, 400);
    const r = await call(env, "POST", "/register", { body: { client_name: "Claude", redirect_uris: [REDIRECT] } });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(env.kv.size, 0, "registering stores nothing");
  });

  await test("the consent page names the app and where it goes back to; a changed client or redirect is refused", async () => {
    const env = fakeEnv(fakeGitHub());
    const s = await signIn(env);
    assert.match(s.ask.body, /Let Claude use your trips\?/);
    assert.match(s.ask.body, /claude\.ai/);
    assert.match(s.ask.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
    assert.match(s.ask.headers.get("Set-Cookie"), /HttpOnly; Secure; SameSite=Lax/);
    const other = new URLSearchParams({ response_type: "code", client_id: s.reg.body.client_id, redirect_uri: "https://evil.test/cb", code_challenge: s.challenge, code_challenge_method: "S256" });
    assert.match((await call(env, "GET", "/authorize?" + other)).body, /doesn't work/);
    const forged = s.reg.body.client_id.replace(/^./, (c) => (c === "e" ? "f" : "e"));
    assert.match((await call(env, "GET", "/authorize?" + new URLSearchParams({ response_type: "code", client_id: forged, redirect_uri: REDIRECT, code_challenge: "x", code_challenge_method: "S256" }))).body, /doesn't work/);
    const noPkce = await call(env, "GET", "/authorize?" + new URLSearchParams({ response_type: "code", client_id: s.reg.body.client_id, redirect_uri: REDIRECT }));
    assert.match(noPkce.headers.get("Location"), /error=invalid_request/);
  });

  await test("Allow works only from the browser that saw the page, so another site can't press it", async () => {
    const env = fakeEnv(fakeGitHub());
    const s = await signIn(env);
    const loc = new URL(s.allow.headers.get("Location"));
    assert.strictEqual(s.allow.status, 303);
    assert.deepStrictEqual([loc.origin + loc.pathname, loc.searchParams.get("client_id"), loc.searchParams.get("redirect_uri")], ["https://github.com/login/oauth/authorize", "Iv1.app", "https://tb.test/callback"]);
    assert.match((await call(env, "POST", "/authorize", { form: { ask: s.askToken } })).body, /didn't work/);
    assert.match((await call(env, "POST", "/authorize", { form: { ask: s.askToken }, headers: { Cookie: "tb_mcp=someone-else" } })).body, /didn't work/);
    assert.match((await call(env, "GET", "/callback?" + new URLSearchParams({ code: "good", state: s.state }), { headers: { Cookie: "tb_mcp=x" } })).body, /didn't work/);
  });

  await test("GitHub's sign-in comes back as a code with the app's state; tokens need the right PKCE verifier, once", async () => {
    const g = fakeGitHub();
    const env = fakeEnv(g);
    const s = await signIn(env);
    const back = new URL(s.cb.headers.get("Location"));
    assert.strictEqual(back.origin + back.pathname, REDIRECT);
    assert.strictEqual(back.searchParams.get("state"), "xyz");
    assert.ok(s.code.length >= 40);
    assert.strictEqual(g.exchanges[0].redirect_uri, "https://tb.test/callback");
    const bad = await call(env, "POST", "/token", { form: { grant_type: "authorization_code", code: s.code, redirect_uri: REDIRECT, client_id: s.reg.body.client_id, code_verifier: "wrong" } });
    assert.deepStrictEqual([bad.status, bad.body.error], [400, "invalid_grant"]);
    const s2 = await signIn(env);
    const t = await tokens(env, s2);
    assert.deepStrictEqual([t.token_type, t.expires_in], ["Bearer", 3600]);
    assert.ok(t.access_token && t.refresh_token);
    assert.strictEqual((await call(env, "POST", "/token", { form: { grant_type: "authorization_code", code: s2.code, redirect_uri: REDIRECT, client_id: s2.reg.body.client_id, code_verifier: s2.verifier } })).body.error, "invalid_grant");
    // Nothing secret is kept in the clear: GitHub's token is sealed, Tripboard's are hashes.
    const kept = [...env.kv.values()].join(" ");
    assert.ok(!kept.includes("\"tok\"") && !kept.includes("ghr") && !kept.includes(t.access_token.split(".")[1]));
  });

  await test("a GitHub account that isn't in MCP_USERS gets nothing", async () => {
    const g = fakeGitHub();
    g.userId = 42;
    const env = fakeEnv(g);
    const s = await signIn(env);
    assert.match(s.cb.body, /Not on the list/);
    assert.strictEqual(s.code, null);
    assert.deepStrictEqual(C.users({ MCP_USERS: "1=a/b, 2=c/d@trips, junk" }), { 1: { repo: "a/b", branch: "" }, 2: { repo: "c/d", branch: "trips" } });
  });

  await test("MCP over HTTP: the local MCP's tools without deleting, and changes land in the sync repo", async () => {
    const g = fakeGitHub();
    const env = fakeEnv(g);
    const t = await tokens(env, await signIn(env));
    const init = await rpc(env, t.access_token, "initialize", { protocolVersion: "2025-06-18" });
    assert.strictEqual(init.body.result.serverInfo.name, "tripboard");
    assert.match(init.body.result.instructions, /Deleting isn't offered/);
    assert.strictEqual((await call(env, "POST", "/mcp", { body: { jsonrpc: "2.0", method: "notifications/initialized" }, headers: { Authorization: "Bearer " + t.access_token } })).status, 202);
    const list = (await rpc(env, t.access_token, "tools/list")).body.result.tools;
    const names = list.map((x) => x.name);
    assert.ok(names.includes("add_place") && names.includes("list_trips"));
    assert.ok(!names.some((n) => /^(delete|remove)_/.test(n)), names.join());
    assert.strictEqual(list.find((x) => x.name === "list_trips").annotations.readOnlyHint, true);
    assert.strictEqual(list.find((x) => x.name === "add_place").annotations.readOnlyHint, false);
    const made = await rpc(env, t.access_token, "tools/call", { name: "create_trip", arguments: { name: "Kyoto", start: "2026-12-01", end: "2026-12-04" } });
    assert.ok(!made.body.result.isError, made.body.result.content[0].text);
    await rpc(env, t.access_token, "tools/call", { name: "add_place", arguments: { trip: "kyoto", name: "Fushimi Inari", day: "2026-12-01" } });
    const id = JSON.parse(made.body.result.content[0].text).id;
    const bundle = g.read("trips/" + id + ".json");
    assert.deepStrictEqual([bundle.trip.name, bundle.places.map((p) => p.name)], ["Kyoto", ["Fushimi Inari"]]);
    const del = await rpc(env, t.access_token, "tools/call", { name: "delete_trip", arguments: { trip: "kyoto" } });
    assert.ok(del.body.result.isError);
    assert.match(del.body.result.content[0].text, /isn't offered in the cloud/);
    assert.ok(g.read("trips/" + id + ".json").trip.name === "Kyoto" && !g.read("trips/" + id + ".json").trip.deletedAt);
    // GitHub got a User-Agent and only GitHub got the token.
    assert.ok(g.calls.filter((c) => c.host === "api.github.com").every((c) => c.ua === "Tripboard-MCP"));
  });

  await test("a wrong or expired token is refused, and taking someone off MCP_USERS locks them out", async () => {
    const env = fakeEnv(fakeGitHub());
    const t = await tokens(env, await signIn(env));
    const [grant] = t.access_token.split(".");
    assert.strictEqual((await rpc(env, grant + ".wrong", "tools/list")).status, 401);
    assert.strictEqual((await rpc(env, t.refresh_token, "tools/list")).status, 401, "a refresh token isn't an access token");
    const g = JSON.parse(env.kv.get("mcp:grant:" + grant));
    env.kv.set("mcp:grant:" + grant, JSON.stringify({ ...g, accessExp: 1 }));
    assert.strictEqual((await rpc(env, t.access_token, "tools/list")).status, 401);
    env.kv.set("mcp:grant:" + grant, JSON.stringify(g));
    assert.strictEqual((await rpc(env, t.access_token, "tools/list")).status, 200);
    assert.strictEqual((await rpc({ ...env, MCP_USERS: "1=other/repo" }, t.access_token, "tools/list")).status, 401);
  });

  await test("a refresh token gives new tokens once; the old pair stops working", async () => {
    const env = fakeEnv(fakeGitHub());
    const s = await signIn(env);
    const t = await tokens(env, s);
    const r = await call(env, "POST", "/token", { form: { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: s.reg.body.client_id } });
    assert.strictEqual(r.status, 200);
    assert.notStrictEqual(r.body.access_token, t.access_token);
    assert.strictEqual((await call(env, "POST", "/token", { form: { grant_type: "refresh_token", refresh_token: t.refresh_token } })).body.error, "invalid_grant");
    assert.strictEqual((await rpc(env, t.access_token, "tools/list")).status, 401);
    assert.strictEqual((await rpc(env, r.body.access_token, "tools/list")).status, 200);
  });

  await test("GitHub's 8-hour token is refreshed when a tool needs it", async () => {
    const g = fakeGitHub();
    g.tokenLife = 30;
    const env = fakeEnv(g);
    const t = await tokens(env, await signIn(env));
    const r = await rpc(env, t.access_token, "tools/call", { name: "list_trips", arguments: {} });
    assert.ok(!r.body.result.isError, r.body.result.content[0].text);
    assert.ok(g.exchanges.some((f) => f.grant_type === "refresh_token" && f.refresh_token === "ghr"));
  });

  console.log(passed + " passed");
})();
