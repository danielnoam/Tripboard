// The icons Tripboard uses, from Lucide (lucide.dev, ISC licence), as
// their SVG paths: one map, built into <svg> nodes on demand.
(function () {
  const P = {
    back: ["m12 19-7-7 7-7", "M19 12H5"],
    plus: ["M5 12h14", "M12 5v14"],
    check: ["M20 6 9 17l-5-5"],
    pencil: ["M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z", "m15 5 4 4"],
    pin: ["M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0", "c12 10 3"],
    clock: ["c12 12 10", "M12 6v6l4 2"],
    locate: ["M2 12h3", "M19 12h3", "M12 2v3", "M12 19v3", "c12 12 7", "c12 12 3"],
    calendar: ["M8 2v4", "M16 2v4", "r3 4 18 18 2", "M3 10h18"],
  };
  const NS = "http://www.w3.org/2000/svg";
  function svg(name, cls) {
    const s = document.createElementNS(NS, "svg");
    for (const [k, v] of [["viewBox", "0 0 24 24"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "2"],
      ["stroke-linecap", "round"], ["stroke-linejoin", "round"], ["aria-hidden", "true"], ["class", "icon" + (cls ? " " + cls : "")]]) s.setAttribute(k, v);
    for (const d of P[name] || []) {
      let n;
      if (d[0] === "c") { const [cx, cy, r] = d.slice(1).split(" "); n = document.createElementNS(NS, "circle"); n.setAttribute("cx", cx); n.setAttribute("cy", cy); n.setAttribute("r", r); }
      else if (d[0] === "r") { const [x, y, w, h, rx] = d.slice(1).split(" "); n = document.createElementNS(NS, "rect"); for (const [k, v] of [["x", x], ["y", y], ["width", w], ["height", h], ["rx", rx]]) n.setAttribute(k, v); }
      else { n = document.createElementNS(NS, "path"); n.setAttribute("d", d); }
      s.appendChild(n);
    }
    return s;
  }
  window.Tripboard = window.Tripboard || {};
  window.Tripboard.icon = svg;
})();
