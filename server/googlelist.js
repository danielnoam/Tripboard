// A Google Maps list's places, from its share link. Google has no API for
// saved lists: this reads the data Google Maps' own page loads
// (maps/preview/entitylist/getlist), which is undocumented and can change
// or stop at any time, and isn't allowed by Google's terms for automated
// use. Tripboard's file import (src/listimport.js) is the steady way.
//   places(url, fetchFn) -> { title, places: [{ name, lat?, lng?, note? }] }

const HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|(www\.)?google\.[a-z.]+)$/;
const MAX_PLACES = 500;

// The list's id in a Google Maps address: ...!11m...!2s<id>...
export function listId(href) {
  const u = decodeURIComponent(String(href || ""));
  const m = /!11m\d+!2s([\w-]{8,})/.exec(u) || /\/placelists\/list\/([\w-]{8,})/.exec(u);
  return m ? m[1] : "";
}

// Follows a short link to the Google Maps address it stands for.
async function resolve(href, fetchFn) {
  let at = href;
  for (let i = 0; i < 5 && !listId(at); i++) {
    const u = new URL(at);
    if (!HOSTS.test(u.hostname)) throw Object.assign(new Error("That isn't a Google Maps link."), { status: 400 });
    const r = await fetchFn(at, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0" } });
    const next = r.headers.get("Location");
    if (!next) break;
    at = new URL(next, at).href;
  }
  return at;
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
// The first [.., .., lat, lng] pair inside an entry.
function coords(x, depth = 0) {
  if (!Array.isArray(x) || depth > 6) return null;
  if (x.length >= 4 && x[0] == null && x[1] == null && isNum(x[2]) && isNum(x[3]) && Math.abs(x[2]) <= 90 && Math.abs(x[3]) <= 180) return [x[2], x[3]];
  for (const y of x) { const c = coords(y, depth + 1); if (c) return c; }
  return null;
}
const str = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

// getlist's answer: ")]}'" then JSON. data[0][4] is the list's name and
// data[0][8] its entries: [.., [.., .., .., .., address?, [null, null, lat, lng]], name, note, ..].
export function parseList(text) {
  const data = JSON.parse(String(text).replace(/^\)\]\}'\s*/, ""));
  const list = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];
  const entries = Array.isArray(list[8]) ? list[8] : [];
  const places = [];
  for (const e of entries.slice(0, MAX_PLACES)) {
    if (!Array.isArray(e)) continue;
    const name = str(e[2]) || str(Array.isArray(e[1]) ? e[1][4] : "");
    if (!name) continue;
    const p = { name };
    const c = coords(e[1]);
    if (c) { p.lat = c[0]; p.lng = c[1]; }
    const note = str(e[3]);
    if (note) p.note = note.slice(0, 2000);
    places.push(p);
  }
  return { title: str(list[4]), places };
}

export async function places(href, fetchFn) {
  let u;
  try { u = new URL(href); } catch (e) { throw Object.assign(new Error("That isn't a link."), { status: 400 }); }
  if (!HOSTS.test(u.hostname)) throw Object.assign(new Error("That isn't a Google Maps link."), { status: 400 });
  const id = listId(await resolve(u.href, fetchFn));
  if (!id) throw Object.assign(new Error("That link isn't a shared Google Maps list."), { status: 400 });
  const pb = "!1m4!1s" + id + "!2e1!3m1!1e1!2e2!3e2!4i" + MAX_PLACES + "!16b1";
  const r = await fetchFn("https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=en&gl=us&pb=" + encodeURIComponent(pb), { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw Object.assign(new Error("Google didn't give the list (" + r.status + "). Is it shared?"), { status: 502 });
  try { return parseList(await r.text()); }
  catch (e) { throw Object.assign(new Error("Google's answer has changed shape; use the file import instead."), { status: 502 }); }
}
