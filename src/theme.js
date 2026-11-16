// The theme before the page draws (in <head>), so a reload doesn't show
// the light one first: Settings' choice, or the system's. app.js keeps it
// right after that, when Settings or the system change.
(function () {
  let pick = "system";
  try { pick = ((JSON.parse(localStorage.getItem("tripboard.settings") || "null") || {}).appearance || {}).theme || "system"; } catch (e) { /* the system's */ }
  const dark = pick === "dark" || (pick !== "light" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
