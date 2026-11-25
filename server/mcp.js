// Tripboard as a remote MCP server, so an AI app in the cloud (Claude's
// connectors, ChatGPT's developer mode, Gemini, any agent that speaks MCP
// over HTTP) can read and plan your trips. It serves the same tools as the
// local MCP server (cli/mcp.js) on the same GitHub sync repo: the apps pick
// changes up on their next sync. Those that delete, remove or replace work
// only while the app's Settings › AI tools › Let AI tools delete is on
// (ai.json in the sync repo, which cli/core.js never writes).
//
// Sign-in is OAuth 2.1 with PKCE and dynamic client registration, which is
// what the AI apps expect. Behind it, the person signs in with GitHub
// through Tripboard's GitHub App, which only reaches the repos it's
// installed on (the sync repo, Contents read and write). Only the GitHub
// users named in MCP_USERS get in.
//
//   GET  /.well-known/oauth-protected-resource[/mcp]   where to sign in
//   GET  /.well-known/oauth-authorization-server       the endpoints below
//   POST /register     a client's redirect URIs -> a client_id (signed, nothing stored)
//   GET  /authorize    a page asking whether to let that client in
//   POST /authorize    Allow -> GitHub's sign-in
//   GET  /callback     back from GitHub -> a code for the client
//   POST /token        code + PKCE verifier, or a refresh token -> tokens
//   POST /mcp          MCP (JSON-RPC), "Authorization: Bearer <token>"
//
// Kept in KV (env.FILES, keys starting "mcp:", apart from the sharing
// server's "<trip>/<file>"): each sign-in ("grant") with its GitHub tokens
// AES-GCM encrypted under MCP_SECRET and only hashes of Tripboard's own
// tokens; each code for 5 minutes. A client's token is "<grant>.<secret>".
//
// Settings (server/README.md): GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET,
// MCP_SECRET (a long random string) and MCP_USERS ("<GitHub user id>=<owner>/<repo>[@branch]",
// comma-separated). Without them every route here answers 404.

import mcpCli from "./app/cli/mcp.js";
import * as GL from "./googlelist.js";
import * as PUB from "./published.js";

const GH_LOGIN = "https://github.com/login/oauth";
const GH_API = "https://api.github.com";
const ACCESS_TTL = 3600;
const REFRESH_TTL = 30 * 86400;
const CODE_TTL = 300;
const ASK_TTL = 600;
const enc = new TextEncoder();
const dec = new TextDecoder();

const readOnly = (t) => (t.annotations && t.annotations.readOnlyHint) ?? /^(list|get|find|search|show)_/.test(t.name);
export const TOOLS = mcpCli.TOOLS;

export function ready(env) {
  return !!(env.GITHUB_APP_CLIENT_ID && env.GITHUB_APP_CLIENT_SECRET && env.MCP_SECRET && env.MCP_USERS && env.FILES);
}

// "110013928=me/data@main, 42=you/trips" -> { "110013928": { repo, branch } }
export function users(env) {
  const out = {};
  for (const part of String(env.MCP_USERS || "").split(",")) {
    const m = /^\s*(\d+)\s*=\s*([\w.-]+\/[\w.-]+)(?:@([\w./-]+))?\s*$/.exec(part);
    if (m) out[m[1]] = { repo: m[2], branch: m[3] || "" };
  }
  return out;
}

// ---- small crypto ----
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const random = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const sha = async (text) => b64u(await crypto.subtle.digest("SHA-256", enc.encode(text)));
async function keys(env) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("tripboard-mcp\n" + env.MCP_SECRET));
  const mac = await crypto.subtle.digest("SHA-256", enc.encode("tripboard-mcp-sign\n" + env.MCP_SECRET));
  return {
    aes: await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]),
    hmac: await crypto.subtle.importKey("raw", mac, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]),
  };
}
async function seal(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, (await keys(env)).aes, enc.encode(JSON.stringify(obj)));
  return b64u(iv) + "." + b64u(ct);
}
async function unseal(env, s) {
  const [iv, ct] = String(s).split(".");
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) }, (await keys(env)).aes, unb64u(ct))));
}
// A signed value: readable by anyone, changed by no one.
async function sign(env, obj) {
  const body = b64u(enc.encode(JSON.stringify(obj)));
  return body + "." + b64u(await crypto.subtle.sign("HMAC", (await keys(env)).hmac, enc.encode(body)));
}
async function verify(env, s) {
  try {
    const [body, mac] = String(s || "").split(".");
    if (!body || !mac) return null;
    if (!(await crypto.subtle.verify("HMAC", (await keys(env)).hmac, unb64u(mac), enc.encode(body)))) return null;
    const obj = JSON.parse(dec.decode(unb64u(body)));
    return obj.exp && obj.exp < Date.now() / 1000 ? null : obj;
  } catch (e) { return null; }
}
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && [...a].reduce((d, c, i) => d | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

// ---- responses ----
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id", "Access-Control-Expose-Headers": "WWW-Authenticate" };
const json = (body, status = 200, extra) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });
const oauthError = (error, description, status = 400) => json({ error, error_description: description }, status);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
// formAction lists where the page's form may lead. Browsers check it on every
// redirect after the submit too, so the Allow form names GitHub and the AI
// app it hands back to, or the browser stops at the first redirect.
function page(title, body, extra, formAction = "'self'") {
  const nonce = random(12);
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style nonce="${nonce}">body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1d1d1f;background:#fff}@media(prefers-color-scheme:dark){body{color:#f2f2f2;background:#1c1c1e}}code{word-break:break-all}button{font:inherit;padding:.7rem 1.4rem;border-radius:.6rem;border:0;background:#0b63ce;color:#fff;min-height:44px}</style></head><body>${body}</body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`, "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", ...extra } });
}
const cookieOf = (req, name) => ((req.headers.get("Cookie") || "").split(/;\s*/).find((c) => c.startsWith(name + "=")) || "").slice(name.length + 1);
async function form(req) {
  const t = await req.text();
  if (t.length > 2e4) throw Object.assign(new Error("Too big."), { status: 413 });
  return (req.headers.get("Content-Type") || "").includes("json") ? JSON.parse(t || "{}") : Object.fromEntries(new URLSearchParams(t));
}

// A redirect URI a client may register: https, a loopback http (agents on
// a computer), or an app's own scheme; never script or data.
export function okRedirect(uri) {
  let u;
  try { u = new URL(uri); } catch (e) { return false; }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && !["javascript:", "data:", "file:", "vbscript:", "blob:", "about:", "ftp:", "ws:", "wss:"].includes(u.protocol);
}

// The CSP source for a redirect URI: its origin, or an app scheme like "claude:".
function formTarget(uri) {
  const u = new URL(uri);
  return u.protocol === "https:" || u.protocol === "http:" ? u.origin : u.protocol;
}

// ---- the routes ----
export async function handleMcp(req, env) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const routes = ["/mcp", "/register", "/authorize", "/callback", "/token"];
  if (!routes.includes(p) && !p.startsWith("/.well-known/oauth-")) return null;
  if (!ready(env)) return json({ error: "The cloud connector isn't set up on this server." }, 404);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const origin = url.origin;
  try {
    if (p.startsWith("/.well-known/oauth-protected-resource")) return json({ resource: origin + "/mcp", authorization_servers: [origin], bearer_methods_supported: ["header"], resource_name: "Tripboard" });
    if (p === "/.well-known/oauth-authorization-server") return json({
      issuer: origin, authorization_endpoint: origin + "/authorize", token_endpoint: origin + "/token", registration_endpoint: origin + "/register",
      response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["trips"],
    });
    if (p === "/register" && req.method === "POST") return await register(req, env);
    if (p === "/authorize" && req.method === "GET") return await ask(url.searchParams, env);
    if (p === "/authorize" && req.method === "POST") return await allow(req, env);
    if (p === "/callback" && req.method === "GET") return await callback(req, url, env, origin);
    if (p === "/token" && req.method === "POST") return await token(req, env);
    if (p === "/mcp" && req.method === "POST") return await mcp(req, env, origin);
    if (p === "/mcp") return json({ error: "POST JSON-RPC here." }, 405, { Allow: "POST, OPTIONS" });
    return json({ error: "Not here." }, 404);
  } catch (e) {
    if (e.status) return json({ error: e.message }, e.status);
    return json({ error: "Something went wrong on the server." }, 500);
  }
}

// Dynamic client registration. The client_id carries its own redirect URIs,
// signed, so registering writes nothing and can't fill the KV.
async function register(req, env) {
  const b = await form(req);
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 5 || !uris.every(okRedirect)) return oauthError("invalid_redirect_uri", "Give https, loopback or app-scheme redirect URIs.");
  const name = String(b.client_name || "An AI app").slice(0, 80);
  const client_id = await sign(env, { k: "client", uris, name });
  return json({ client_id, client_name: name, redirect_uris: uris, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", client_id_issued_at: Math.floor(Date.now() / 1000) }, 201);
}

async function client(env, id, redirect) {
  const c = await verify(env, id);
  if (!c || c.k !== "client") return null;
  if (redirect !== undefined && !c.uris.includes(redirect)) return null;
  return c;
}

// The consent page. Without it, a client someone else registered could
// send you a link that signs you in to *their* app with no click, since
// GitHub doesn't ask twice. The cookie ties the Allow to this browser, so
// another site can't press it for you.
async function ask(q, env) {
  const redirect = q.get("redirect_uri") || "";
  const c = await client(env, q.get("client_id"), redirect);
  if (!c) return page("Tripboard", "<h1>This sign-in link doesn't work</h1><p>The app that sent you here isn't registered for this address. Add the connector again from the app.</p>");
  const back = (err) => Response.redirect(redirect + (redirect.includes("?") ? "&" : "?") + new URLSearchParams({ error: err, ...(q.get("state") ? { state: q.get("state") } : {}) }), 302);
  if (q.get("response_type") !== "code") return back("unsupported_response_type");
  if (!q.get("code_challenge") || q.get("code_challenge_method") !== "S256") return back("invalid_request");
  const nonce = random(16);
  const askToken = await sign(env, { k: "ask", nonce, client_id: q.get("client_id"), redirect, challenge: q.get("code_challenge"), state: q.get("state") || "", exp: Math.floor(Date.now() / 1000) + ASK_TTL });
  const host = new URL(redirect).host || new URL(redirect).protocol;
  return page("Connect to Tripboard", `<h1>Let ${esc(c.name)} use your trips?</h1>
<p>It will be able to read your trips and add and change trips, places and expenses in your GitHub sync repo. It can delete only while Let AI tools delete is on in the app (Settings › AI tools), which it can't turn on itself.</p>
<p>After you allow it, Tripboard sends you back to <strong>${esc(host)}</strong>. If you didn't just add Tripboard to an AI app there, close this page.</p>
<form method="post" action="/authorize"><input type="hidden" name="ask" value="${esc(askToken)}"><button type="submit">Allow and sign in with GitHub</button></form>`,
    { "Set-Cookie": `tb_mcp=${nonce}; Path=/; Max-Age=${ASK_TTL}; HttpOnly; Secure; SameSite=Lax` },
    `'self' https://github.com ${formTarget(redirect)}`);
}

async function allow(req, env) {
  const a = await verify(env, (await form(req)).ask);
  if (!a || a.k !== "ask" || !same(a.nonce, cookieOf(req, "tb_mcp"))) return page("Tripboard", "<h1>That didn't work</h1><p>The page timed out or was opened elsewhere. Start again from the AI app.</p>");
  const state = await sign(env, { ...a, k: "gh" });
  const to = GH_LOGIN + "/authorize?" + new URLSearchParams({ client_id: env.GITHUB_APP_CLIENT_ID, redirect_uri: new URL(req.url).origin + "/callback", state });
  return new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
}

async function gh(env, path, init) {
  const r = await (env.FETCH || fetch)(path.startsWith("http") ? path : GH_API + path, {
    ...init, headers: { Accept: "application/json", "User-Agent": "Tripboard-MCP", ...(init && init.headers) },
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function githubToken(env, params) {
  const r = await gh(env, GH_LOGIN + "/access_token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GITHUB_APP_CLIENT_ID, client_secret: env.GITHUB_APP_CLIENT_SECRET, ...params }) });
  if (r.status !== 200 || !r.body.access_token) return null;
  const t = Math.floor(Date.now() / 1000);
  return { token: r.body.access_token, exp: r.body.expires_in ? t + r.body.expires_in - 60 : 0, refresh: r.body.refresh_token || "" };
}

async function callback(req, url, env, origin) {
  const s = await verify(env, url.searchParams.get("state"));
  if (!s || s.k !== "gh" || !same(s.nonce, cookieOf(req, "tb_mcp"))) return page("Tripboard", "<h1>That didn't work</h1><p>The sign-in timed out or was started in another browser. Start again from the AI app.</p>");
  const back = (params) => new Response(null, { status: 302, headers: { Location: s.redirect + (s.redirect.includes("?") ? "&" : "?") + new URLSearchParams({ ...params, ...(s.state ? { state: s.state } : {}) }), "Set-Cookie": "tb_mcp=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax", "Cache-Control": "no-store" } });
  if (!url.searchParams.get("code")) return back({ error: "access_denied" });
  const g = await githubToken(env, { code: url.searchParams.get("code"), redirect_uri: origin + "/callback" });
  if (!g) return back({ error: "access_denied", error_description: "GitHub didn't sign you in." });
  const me = await gh(env, "/user", { headers: { Authorization: "Bearer " + g.token } });
  const who = me.status === 200 && users(env)[String(me.body.id)];
  if (!who) return page("Tripboard", "<h1>Not on the list</h1><p>This Tripboard server only lets in the GitHub accounts its owner named. Nothing was connected.</p>");
  const grant = random(16);
  await putGrant(env, grant, { user: String(me.body.id), client: s.client_id, gh: await seal(env, g) });
  const code = random(32);
  await env.FILES.put("mcp:code:" + (await sha(code)), JSON.stringify({ grant, client: s.client_id, redirect: s.redirect, challenge: s.challenge }), { expirationTtl: CODE_TTL });
  return back({ code });
}

const putGrant = (env, id, g) => env.FILES.put("mcp:grant:" + id, JSON.stringify(g), { expirationTtl: REFRESH_TTL });
async function getGrant(env, id) {
  if (!/^[\w-]{10,40}$/.test(id || "")) return null;
  const raw = await env.FILES.get("mcp:grant:" + id);
  return raw ? JSON.parse(typeof raw === "string" ? raw : dec.decode(raw)) : null;
}
async function issue(env, id, g) {
  const access = random(32), refresh = random(32), t = Math.floor(Date.now() / 1000);
  Object.assign(g, { access: await sha(access), accessExp: t + ACCESS_TTL, refresh: await sha(refresh) });
  await putGrant(env, id, g);
  return json({ access_token: id + "." + access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: id + "." + refresh, scope: "trips" });
}

async function token(req, env) {
  const b = await form(req);
  if (b.grant_type === "authorization_code") {
    const key = "mcp:code:" + (await sha(String(b.code || "")));
    const raw = await env.FILES.get(key);
    if (!raw) return oauthError("invalid_grant", "That code is unknown, used or too old.");
    await env.FILES.delete(key);
    const c = JSON.parse(typeof raw === "string" ? raw : dec.decode(raw));
    if (c.client !== b.client_id || c.redirect !== b.redirect_uri) return oauthError("invalid_grant", "The code was given to another client.");
    if (!b.code_verifier || !same(await sha(String(b.code_verifier)), c.challenge)) return oauthError("invalid_grant", "The PKCE verifier doesn't match.");
    const g = await getGrant(env, c.grant);
    if (!g) return oauthError("invalid_grant", "The sign-in has gone. Sign in again.");
    return issue(env, c.grant, g);
  }
  if (b.grant_type === "refresh_token") {
    const [id, secret] = String(b.refresh_token || "").split(".");
    const g = await getGrant(env, id);
    if (!g || !secret || !same(await sha(secret), g.refresh) || (b.client_id && b.client_id !== g.client)) return oauthError("invalid_grant", "That refresh token is unknown or was replaced.");
    if (!users(env)[g.user]) return oauthError("invalid_grant", "This GitHub account isn't allowed any more.");
    return issue(env, id, g);
  }
  return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
}

// The person's GitHub token for this grant, refreshed when it's old (GitHub
// App user tokens last 8 hours).
async function githubFor(env, id, g) {
  let t = await unseal(env, g.gh);
  if (t.exp && t.exp < Date.now() / 1000) {
    const n = t.refresh && (await githubToken(env, { grant_type: "refresh_token", refresh_token: t.refresh }));
    if (!n) return null;
    t = n;
    g.gh = await seal(env, t);
    await putGrant(env, id, g);
  }
  return t.token;
}

// Shared Google Maps lists read for one person, at most LISTS_PER_DAY a day.
const LISTS_PER_DAY = 60;
async function listFor(env, user, url) {
  const k = "mcp:lists:" + user + ":" + new Date().toISOString().slice(0, 10);
  const n = +((await env.FILES.get(k)) || 0);
  if (n >= LISTS_PER_DAY) throw new Error("Too many lists today. Try tomorrow.");
  await env.FILES.put(k, String(n + 1), { expirationTtl: 2 * 86400 });
  return GL.places(url, env.FETCH || fetch);
}

async function mcp(req, env, origin) {
  const unauthorized = (why) => json({ error: "invalid_token", error_description: why }, 401, { "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", error="invalid_token"` });
  const m = /^Bearer ([\w-]+)\.([\w-]+)$/.exec(req.headers.get("Authorization") || "");
  if (!m) return unauthorized("Sign in first.");
  const g = await getGrant(env, m[1]);
  if (!g || !same(await sha(m[2]), g.access) || g.accessExp < Date.now() / 1000) return unauthorized("The token is unknown or expired.");
  const who = users(env)[g.user];
  if (!who) return unauthorized("This GitHub account isn't allowed any more.");
  let body;
  try { body = JSON.parse(await req.text()); } catch (e) { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
  const ghToken = { value: null };
  const out = [];
  const s = mcpCli.server({
    env: { TRIPBOARD_TOKEN: "lazy", TRIPBOARD_REPO: who.repo, TRIPBOARD_BRANCH: who.branch },
    // GitHub wants a User-Agent, which a Worker's fetch doesn't send. The
    // GitHub token goes only to GitHub (a tool may also look a place up on
    // OpenStreetMap), fetched and refreshed only when a tool calls it.
    fetch: async (u, init) => {
      if (new URL(u).host !== "api.github.com") return (env.FETCH || fetch)(u, { ...init, headers: { ...(init && init.headers), "User-Agent": "Tripboard-MCP" } });
      if (!ghToken.value) ghToken.value = await githubFor(env, m[1], g);
      if (!ghToken.value) throw Object.assign(new Error("GitHub signed this connector out. Remove the connector and add it again."), { status: 401 });
      const headers = { ...(init && init.headers), Authorization: "Bearer " + ghToken.value, "User-Agent": "Tripboard-MCP" };
      return (env.FETCH || fetch)(u, { ...init, headers });
    },
    write: (line) => out.push(JSON.parse(line)),
    // A list's link is read here, as the app's /google-list does, so the
    // Worker doesn't call itself.
    googleList: (url) => listFor(env, g.user, url),
    // Publishing works on this Worker's own tables (published.js), counted
    // by connector user; a link naming another server is fetched from it.
    published: (() => {
      const P = PUB.api(env);
      const away = (host) => host && host !== new URL(origin).host;
      const other = async (method, p, host) => {
        const r = await (env.FETCH || fetch)("https://" + host + p, { method, headers: { "User-Agent": "Tripboard-MCP" } });
        const out = await r.json().catch(() => null);
        if (!r.ok) throw Object.assign(new Error((out && out.error) || host + " said no (" + r.status + ")."), { status: r.status });
        return out;
      };
      return {
        create: (body) => P.create(body, "mcp:" + g.user), update: P.update, remove: P.remove,
        get: (id, host) => (away(host) ? other("GET", "/published/" + id, host) : P.get(id)),
        copied: (id, host) => (away(host) ? other("POST", "/published/" + id + "/copied", host) : P.copied(id)),
      };
    })(),
  });
  const one = async (msg) => {
    if (!msg || typeof msg !== "object") return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } };
    const n = out.length;
    await s.handle(msg);
    const r = out.slice(n).find((x) => x.id === msg.id);
    if (r && msg.method === "tools/list" && r.result) {
      r.result.tools = TOOLS.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema,
        annotations: { openWorldHint: false, ...annotations, readOnlyHint: readOnly({ name, annotations }), destructiveHint: !!(annotations && annotations.destructiveHint) } }));
    }
    if (r && msg.method === "initialize" && r.result) r.result.instructions = "Tripboard's trips, places and expenses, from the person's GitHub sync repo. Changes reach their devices on the next sync. Deleting works only while the person has turned on Settings › AI tools › Let AI tools delete in the app; it can't be turned on from here.";
    return r;
  };
  if (Array.isArray(body)) {
    const rs = (await Promise.all(body.map(one))).filter(Boolean);
    return rs.length ? json(rs) : new Response(null, { status: 202, headers: CORS });
  }
  const r = await one(body);
  return r ? json(r) : new Response(null, { status: 202, headers: CORS });
}
