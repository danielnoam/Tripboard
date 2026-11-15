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
    map: ["M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z", "M15 5.764v15", "M9 3.236v15"],
    list: ["M3 12h.01", "M3 18h.01", "M3 6h.01", "M8 12h13", "M8 18h13", "M8 6h13"],
    search: ["c11 11 8", "m21 21-4.3-4.3"],
    sliders: ["M21 4h-7", "M10 4H3", "M21 12h-9", "M8 12H3", "M21 20h-5", "M12 20H3", "M14 2v4", "M8 10v4", "M16 18v4"],
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
