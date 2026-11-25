// The phone and desktop apps' Content-Security-Policy, with this device's
// own sharing servers (src/share.js) in connect-src. The web app gets them
// from sw.js; the bundled apps have no service worker, so
// tools/build-www.js gives their index.html two things instead:
//   - the page's own policy with "https:" added to connect-src, so that
//     if this file never ran, everything but connect-src stays as strict;
//   - <meta name="tripboard-csp">, the page's policy as it is, which this
//     file (the first script) writes as a second policy with the servers
//     share.js keeps in localStorage "tripboard.servers" (https origins
//     only). Two policies both apply, so connect-src is this one's list.
(function () {
  const base = document.querySelector('meta[name="tripboard-csp"]');
  if (!base) return;
  const ORIGIN = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/;
  let origins = [];
  try { origins = JSON.parse(localStorage.getItem("tripboard.servers") || "[]"); } catch (e) { /* none */ }
  const ok = (Array.isArray(origins) ? origins : []).filter((o) => typeof o === "string" && ORIGIN.test(o));
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = ok.length ? base.content.replace(/connect-src 'self'/, "$& " + ok.join(" ")) : base.content;
  base.after(meta);
})();
