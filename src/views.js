// Tripboard's screens: Home (new trip, my trips) and a trip's board, and
// the trip and place sheets. app.js starts it with the loaded data; every
// change goes through save(), which keeps the store and the screen in step.
(function () {
  const M = window.Tripboard.model;
  const icon = window.Tripboard.icon;
  const $ = (id) => document.getElementById(id);

  // el("div.card", { onclick, text, attrs }, children…)
  function el(spec, props, ...kids) {
    const [tag, ...cls] = spec.split(".");
    const n = document.createElement(tag || "div");
    if (cls.length) n.className = cls.join(" ");
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k in n && k !== "list") n[k] = v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid);
    return n;
  }

  const today = () => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };
  const asDate = (day) => new Date(day + "T12:00:00");
  const fmt = (opts) => new Intl.DateTimeFormat(undefined, opts);
  const dayLabel = (day) => fmt({ weekday: "short", day: "numeric", month: "short" }).format(asDate(day));
  function rangeLabel(t) {
    if (!t.start) return "No dates yet";
    const e = t.end || t.start;
    const f = fmt({ day: "numeric", month: "short", year: "numeric" });
    return f.formatRange ? f.formatRange(asDate(t.start), asDate(e)) : f.format(asDate(t.start)) + " – " + f.format(asDate(e));
  }
  function whenLabel(t) {
    const s = M.tripStatus(t, today());
    if (s === "now") return "Under way";
    if (s === "past") return "Been";
    if (s === "upcoming") { const n = M.daysUntil(t.start, today()); return n === 1 ? "Tomorrow" : "In " + n + " days"; }
    return "";
  }
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const timeLabel = (p) => (p.time ? p.time + (p.endTime ? "–" + p.endTime : "") : "");

  let doc, store, motion, saveDoc;
  const covers = new Map();
  const view = { trip: null, sort: "time", only: [], from: null, mode: "board", pick: null, sel: null };
  try { Object.assign(view, JSON.parse(localStorage.getItem("tripboard.view") || "{}"), { trip: null, from: null }); } catch (e) { /* first visit */ }
  const remember = () => { try { localStorage.setItem("tripboard.view", JSON.stringify({ sort: view.sort, only: view.only })); } catch (e) { /* private window */ } };

  const findTrip = (id) => doc.trips.find((t) => t.id === id);
  const placesOf = (id) => doc.places.filter((p) => p.trip === id);
  function save() {
    doc = M.sanitizeDoc(doc);
    saveDoc(doc);
    render();
  }

  async function coverUrl(trip) {
    if (!trip.cover) return null;
    if (covers.has(trip.id)) return covers.get(trip.id);
    const blob = await store.cover(trip.id);
    const url = blob ? URL.createObjectURL(blob) : null;
    covers.set(trip.id, url);
    return url;
  }
  // A cover with no photo gets one of a few tints, the same each time.
  const tint = (id) => "tint-" + ([...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 5);
  function coverBox(trip, cls) {
    const box = el("div." + cls + "." + tint(trip.id));
    coverUrl(trip).then((url) => { if (url) box.append(el("img", { src: url, alt: "" })); });
    return box;
  }

  // ---------- Home ----------
  function renderHome(main) {
    $("title").textContent = "Tripboard";
    const trips = M.sortTrips(doc.trips, today());
    main.append(el("button.btn.primary.new-trip", { type: "button", onclick: (e) => openTrip(null, e.currentTarget) }, icon("plus"), "New trip"));
    if (!trips.length) {
      main.append(el("div.empty", {}, el("p", { text: "No trips yet." }), el("p.dim", { text: "Make one, then add the places you want to see." })));
    } else {
      main.append(el("h2.section", { text: "My trips" }));
      main.append(el("ul.trips", {}, trips.map((t) => {
        const n = placesOf(t.id).length;
        const when = whenLabel(t);
        return el("li", {}, el("a.trip-card", { href: "#/trip/" + t.id },
          coverBox(t, "trip-cover"),
          el("div.trip-text", {},
            el("strong", { text: t.name }),
            el("span.dim", { text: [rangeLabel(t), plural(n, "place", "places")].join(" · ") }),
            t.destinations.length ? el("span.dim", { text: t.destinations.join(", ") }) : null),
          when ? el("span.badge", { text: when }) : null));
      })));
    }
    if (!store.persistent) main.append(el("p.note", { text: "This browser isn't keeping data: trips last until the tab closes." }));
    main.append(el("p.dim.version", { text: "Version " + window.Tripboard.version }));
  }

  // ---------- A trip's board ----------
  const SORTS = [["time", "Time"], ["category", "Category"], ["importance", "Importance"], ["distance", "Distance"]];
  function renderBoard(main, trip) {
    $("title").textContent = trip.name;
    const places = placesOf(trip.id);
    const hero = coverBox(trip, "hero");
    hero.append(el("div.hero-text", {},
      el("span", { text: rangeLabel(trip) + (whenLabel(trip) ? " · " + whenLabel(trip) : "") }),
      trip.destinations.length ? el("ul.chips", {}, trip.destinations.map((d) => el("li", { text: d }))) : null));
    main.append(hero);

    const controls = el("div.controls", {},
      el("div.seg.sorts", { role: "tablist", "aria-label": "Sort places by" }, SORTS.map(([id, label]) =>
        el("button", { type: "button", role: "tab", "aria-selected": String(view.sort === id), text: label,
          onclick: () => { view.sort = id; remember(); render(); } }))),
      el("div.filters", { role: "group", "aria-label": "Show" }, M.IMPORTANCE.map(([id, label]) => {
        const on = !view.only.length || view.only.includes(id);
        return el("button.chip.imp-" + id, { type: "button", "aria-pressed": String(on), text: label, onclick: () => toggleOnly(id) });
      })));
    main.append(controls);

    if (!places.length) {
      main.append(el("div.empty", {}, el("p", { text: "Nothing planned yet." }), el("p.dim", { text: "Add the first place with +." })));
      return;
    }
    if (view.sort === "distance" && !view.from) {
      main.append(el("div.locate", {},
        el("p.dim", { text: places.some((p) => p.lat != null) ? "Nearest to you first, once you allow your location."
          : "No place has a location yet. Give one with Find by name or Pin on map in its sheet, or on the Map." }),
        el("button.btn", { type: "button", onclick: locate }, icon("locate"), "Use my location")));
    }
    const groups = M.board(trip, places, view.sort, { only: view.only, from: view.from });
    const wrap = el("div.groups");
    for (const g of groups) wrap.append(group(trip, g));
    main.append(wrap);
  }

  function group(trip, g) {
    const isDay = !!g.day;
    const title = isDay ? (trip.start ? "Day " + M.dayIndex(trip, g.day) + " · " : "") + dayLabel(g.day) : g.title;
    const head = el("div.group-head", {},
      el("h2", { text: title }),
      el("span.count", { text: String(g.places.length) }),
      view.sort === "time" ? el("button.icon-btn.small", { type: "button", "aria-label": "Add a place to " + title,
        onclick: (e) => openPlace(null, trip, { day: g.day || "" }, e.currentTarget) }, icon("plus")) : null);
    const box = el("section.group", {}, head);
    if (isDay) {
      if (!g.slots.length) box.append(el("p.dim.slot-empty", { text: "Free day" }));
      for (const s of g.slots) box.append(el("h3.slot", { text: s.title }), cards(trip, s.places, g));
    } else if (g.places.length) {
      box.append(cards(trip, g.places, g));
    } else {
      box.append(el("p.dim.slot-empty", { text: "Places without a day land here." }));
    }
    return box;
  }

  function cards(trip, list, g) {
    return el("ul.cards", {}, list.map((p) => {
      const meta = view.sort === "category" ? [] : [M.CATEGORY.get(p.category)];
      if (view.sort !== "time" && p.day) meta.push(dayLabel(p.day));
      if (p.time) meta.push(timeLabel(p));
      if (g.km && g.km.has(p.id)) meta.push(g.km.get(p.id) < 1 ? Math.round(g.km.get(p.id) * 1000) + " m" : g.km.get(p.id).toFixed(1) + " km");
      return el("li.card.imp-" + p.importance + (p.visited ? ".visited" : ""), {},
        el("button.tick", { type: "button", "aria-pressed": String(!!p.visited), "aria-label": (p.visited ? "Been to " : "Mark as been to ") + p.name,
          onclick: () => { p.visited = !p.visited; p.updatedAt = new Date().toISOString(); save(); } }, icon("check")),
        el("button.card-body", { type: "button", onclick: (e) => openPlace(p, trip, null, e.currentTarget) },
          el("span.card-name", { text: p.name }),
          el("span.card-meta", {}, el("span.imp", { text: M.IMPORTANCE_LABEL.get(p.importance) }), meta.length ? " · " + meta.join(" · ") : ""),
          p.note ? el("span.card-note", { text: p.note }) : null));
    }));
  }

  function toggleOnly(id) {
    const all = M.IMPORTANCE.map(([i]) => i);
    let on = view.only.length ? view.only.slice() : all.slice();
    on = on.includes(id) ? on.filter((x) => x !== id) : on.concat(id);
    view.only = !on.length || on.length === all.length ? [] : all.filter((x) => on.includes(x));
    remember();
    render();
  }

  function locate() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => { view.from = { lat: pos.coords.latitude, lng: pos.coords.longitude }; render(); },
      () => { view.from = null; },
      { maximumAge: 300000, timeout: 15000 });
  }

  // ---------- Sheets ----------
  const narrow = () => !window.matchMedia("(min-width: 720px)").matches;
  let opener = null;
  function openSheet(d, from) {
    opener = from || null;
    d.showModal();
    (narrow() ? motion.rise(d) : motion.dialogIn(d, from && from.getBoundingClientRect()));
    const first = d.querySelector("input:not([type=file]):not([hidden]), select, textarea");
    if (first && !narrow()) first.focus();
  }
  async function closeSheet(d) {
    if (!d.open) return;
    await (narrow() ? motion.sink(d) : motion.dialogOut(d, opener && opener.getBoundingClientRect()));
    d.close();
  }
  for (const d of document.querySelectorAll("dialog.sheet")) {
    d.addEventListener("cancel", (e) => { e.preventDefault(); closeSheet(d); });
    d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-close]")) closeSheet(d); });
  }
  // A delete button asks once more by changing its words, rather than a
  // browser confirm() box.
  function armDelete(btn, label, act) {
    btn.textContent = label;
    btn.onclick = () => {
      if (btn.dataset.armed) { act(); return; }
      btn.dataset.armed = "1";
      btn.textContent = "Tap again to delete";
      setTimeout(() => { delete btn.dataset.armed; btn.textContent = label; }, 3000);
    };
  }

  // Trip sheet
  let editingTrip = null, pendingCover;
  function showCoverPreview(url) {
    const box = $("coverPreview");
    box.replaceChildren(url ? el("img", { src: url, alt: "" }) : el("span.dim", { text: "No photo" }));
    $("coverRemove").hidden = !url;
  }
  async function openTrip(trip, from) {
    editingTrip = trip;
    pendingCover = undefined;
    const f = $("tripForm");
    f.reset();
    $("tripSheetTitle").textContent = trip ? "Edit trip" : "New trip";
    $("tripSave").textContent = trip ? "Save" : "Create trip";
    if (trip) {
      f.name.value = trip.name;
      f.start.value = trip.start || "";
      f.end.value = trip.end || "";
      f.destinations.value = trip.destinations.join(", ");
    }
    showCoverPreview(trip ? await coverUrl(trip) : null);
    $("tripDelete").hidden = !trip;
    if (trip) armDelete($("tripDelete"), "Delete trip", () => deleteTrip(trip));
    openSheet($("tripSheet"), from);
  }
  // A photo is made at most 1600 px wide as a JPEG before it's kept.
  async function shrink(file) {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / img.width);
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
  }
  $("coverFile").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      pendingCover = await shrink(file);
      showCoverPreview(URL.createObjectURL(pendingCover));
    } catch (err) {
      window.Keel.errlog.note("cover", String(err));
      showCoverPreview(null);
      $("coverPreview").replaceChildren(el("span.error", { text: "That file couldn't be read as a photo." }));
    }
  });
  $("coverRemove").addEventListener("click", () => { pendingCover = null; showCoverPreview(null); $("coverFile").value = ""; });
  $("tripForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.name.value.trim()) { f.name.focus(); f.name.setAttribute("aria-invalid", "true"); return; }
    f.name.removeAttribute("aria-invalid");
    const stamp = new Date().toISOString();
    const trip = editingTrip || { id: M.newId(), createdAt: stamp };
    Object.assign(trip, { name: f.name.value, start: f.start.value, end: f.end.value, destinations: f.destinations.value, updatedAt: stamp });
    if (pendingCover !== undefined) {
      if (covers.get(trip.id)) URL.revokeObjectURL(covers.get(trip.id));
      covers.delete(trip.id);
      if (pendingCover) { await store.setCover(trip.id, pendingCover); trip.cover = true; }
      else { await store.dropCover(trip.id); trip.cover = false; }
    }
    if (!editingTrip) doc.trips.push(trip);
    await closeSheet($("tripSheet"));
    save();
    if (!editingTrip) location.hash = "#/trip/" + trip.id;
  });
  function deleteTrip(trip) {
    doc.trips = doc.trips.filter((t) => t !== trip);
    if (trip.cover) store.dropCover(trip.id);
    closeSheet($("tripSheet"));
    location.hash = "#/";
    save();
  }

  // Place sheet
  let editingPlace = null, placeTrip = null, importance = "want", loc, categoryTouched = false;
  // The place's location in the sheet: undefined unchanged, null cleared,
  // or { lat, lng, address } found by name.
  function paintWhere() {
    const p = loc === undefined ? editingPlace : loc;
    const has = p && p.lat != null;
    $("placeWhere").textContent = !has ? "Not set" : p.address || p.lat.toFixed(5) + ", " + p.lng.toFixed(5);
    $("placeWhere").classList.toggle("dim", !has);
    $("placeClear").hidden = !has;
    $("placePin").textContent = has ? "Move on map" : "Pin on map";
  }
  $("categorySelect").addEventListener("change", () => { categoryTouched = true; });
  $("placeClear").addEventListener("click", () => { loc = null; $("placeResults").replaceChildren(); $("placeFindNote").textContent = ""; paintWhere(); });
  let searching = 0;
  $("placeFind").addEventListener("click", async () => {
    const f = $("placeForm");
    const q = f.name.value.trim();
    const note = $("placeFindNote"), out = $("placeResults");
    if (!q) { note.textContent = "Type the place's name first."; f.name.focus(); return; }
    const me = ++searching;
    note.textContent = "Searching…";
    out.replaceChildren();
    const near = placesOf(placeTrip.id).filter((p) => p.lat != null);
    const dest = placeTrip.destinations[0];
    try {
      const osm = window.Tripboard.places.providers.osm;
      let list = await osm.search(q, { near });
      // Nothing for the bare name: try it with the trip's first destination.
      if (!list.length && dest && !q.toLowerCase().includes(dest.toLowerCase())) list = await osm.search(q + ", " + dest, { near });
      if (me !== searching) return;
      note.textContent = list.length ? "Pick the right one:" : "Nothing found. Try another spelling, or pin it on the map.";
      out.replaceChildren(...list.map((r) => el("li", {}, el("button", { type: "button", onclick: () => {
        loc = { lat: r.lat, lng: r.lng, address: r.address };
        if (r.category && !categoryTouched && !editingPlace) f.category.value = r.category;
        out.replaceChildren();
        note.textContent = "From OpenStreetMap.";
        paintWhere();
      } }, el("strong", { text: r.name }), el("span.dim", { text: r.address })))));
    } catch (e) {
      if (me !== searching) return;
      window.Keel.errlog.note("search", String(e));
      note.textContent = navigator.onLine === false ? "Searching needs a connection." : (e.message && /^(Too many|The search)/.test(e.message) ? e.message : "The search didn't work. Try again in a moment.");
    }
  });
  $("placePin").addEventListener("click", async () => {
    const f = $("placeForm");
    if (!f.name.value.trim()) { f.name.focus(); f.name.setAttribute("aria-invalid", "true"); return; }
    const p = await commitPlace();
    view.pick = p.id;
    view.sel = null;
    location.hash = "#/trip/" + placeTrip.id + "/map";
    render();
  });
  function paintImportance() {
    $("importanceSeg").replaceChildren(...M.IMPORTANCE.map(([id, label]) =>
      el("button.imp-" + id, { type: "button", role: "radio", "aria-checked": String(importance === id), text: label,
        onclick: () => { importance = id; paintImportance(); } })));
  }
  $("categorySelect").replaceChildren(...M.CATEGORIES.map(([id, label]) => el("option", { value: id, text: label })));
  function openPlace(place, trip, preset, from) {
    editingPlace = place;
    placeTrip = trip;
    const f = $("placeForm");
    f.reset();
    const p = place || { category: "sight", importance: "want", ...(preset || {}) };
    $("placeSheetTitle").textContent = place ? "Edit place" : "Add a place";
    $("placeSave").textContent = place ? "Save" : "Add place";
    f.name.value = p.name || "";
    f.category.value = p.category;
    importance = p.importance;
    paintImportance();
    // A dated trip offers its days; one without dates takes any date.
    const days = M.tripDays(trip, placesOf(trip.id));
    const dated = !!trip.start;
    $("daySelect").hidden = !dated;
    $("dayInput").hidden = dated;
    $("daySelect").replaceChildren(el("option", { value: "", text: "No date" }),
      ...days.map((d) => el("option", { value: d, text: (trip.start ? "Day " + M.dayIndex(trip, d) + " · " : "") + dayLabel(d) })));
    $("daySelect").value = p.day || "";
    $("dayInput").value = p.day || "";
    f.time.value = p.time || "";
    f.endTime.value = p.endTime || "";
    f.note.value = p.note || "";
    loc = undefined;
    categoryTouched = false;
    searching++;
    $("placeResults").replaceChildren();
    $("placeFindNote").textContent = "";
    paintWhere();
    $("placeDelete").hidden = !place;
    if (place) armDelete($("placeDelete"), "Delete", () => {
      doc.places = doc.places.filter((x) => x !== place);
      closeSheet($("placeSheet"));
      save();
    });
    openSheet($("placeSheet"), from);
  }
  async function commitPlace() {
    const f = $("placeForm");
    f.name.removeAttribute("aria-invalid");
    const stamp = new Date().toISOString();
    const day = placeTrip.start ? $("daySelect").value : $("dayInput").value;
    const p = editingPlace || { id: M.newId(), trip: placeTrip.id, createdAt: stamp };
    Object.assign(p, { name: f.name.value, category: f.category.value, importance, day, time: f.time.value, endTime: f.endTime.value, note: f.note.value, updatedAt: stamp });
    if (loc === null) { delete p.lat; delete p.lng; delete p.address; }
    else if (loc) { Object.assign(p, loc); if (!loc.address) delete p.address; }
    if (!editingPlace) doc.places.push(p);
    await closeSheet($("placeSheet"));
    save();
    return p;
  }
  $("placeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.name.value.trim()) { f.name.focus(); f.name.setAttribute("aria-invalid", "true"); return; }
    await commitPlace();
  });

  // ---------- The map ----------
  const TM = window.Tripboard.map;
  let mapFailed = null;
  function shownPlaces(trip) {
    const all = placesOf(trip.id);
    return view.only.length ? all.filter((p) => view.only.includes(p.importance)) : all;
  }
  async function showMap(trip) {
    const panel = $("mapPanel");
    if (mapFailed) { mapMessage(mapFailed); return; }
    const first = !TM.ready;
    try { await TM.open($("map")); }
    catch (e) {
      window.Keel.errlog.note("map", String(e));
      mapFailed = navigator.onLine === false ? "The map needs a connection the first time it opens." : "The map couldn't load. Check the connection and try again.";
      mapMessage(mapFailed);
      return;
    }
    if (view.mode !== "map" || view.trip !== trip.id) return;
    const list = shownPlaces(trip);
    TM.places(list, view.sel);
    if (first || $("map").dataset.trip !== trip.id) { TM.fit(list); $("map").dataset.trip = trip.id; }
    paintPanel(trip);
    panel.hidden = !panel.childNodes.length;
  }
  function mapMessage(text) {
    $("mapPanel").replaceChildren(el("p", { text }), el("button.btn", { type: "button", text: "Try again", onclick: () => { mapFailed = null; render(); } }));
    $("mapPanel").hidden = false;
  }
  TM.onPin = (id) => {
    if (view.pick) return;
    view.sel = view.sel === id ? null : id;
    render();
  };
  TM.onTap = ({ lat, lng }) => {
    if (view.pick) {
      const p = doc.places.find((x) => x.id === view.pick);
      view.pick = null;
      if (p) { Object.assign(p, { lat, lng, updatedAt: new Date().toISOString() }); delete p.address; view.sel = p.id; }
      save();
      return;
    }
    if (view.sel) { view.sel = null; render(); }
  };
  function paintPanel(trip) {
    const panel = $("mapPanel");
    const all = placesOf(trip.id);
    if (view.pick) {
      const p = all.find((x) => x.id === view.pick);
      panel.replaceChildren(el("p.pick", {}, "Tap the map where ", el("strong", { text: p ? p.name : "it" }), " is."),
        el("button.btn", { type: "button", text: "Cancel", onclick: () => { view.pick = null; render(); } }));
      return;
    }
    const sel = view.sel && all.find((x) => x.id === view.sel);
    if (sel) {
      const meta = [M.IMPORTANCE_LABEL.get(sel.importance), M.CATEGORY.get(sel.category)];
      if (sel.day) meta.push(dayLabel(sel.day));
      if (sel.time) meta.push(timeLabel(sel));
      panel.replaceChildren(el("div.sel", {},
        el("strong", { text: sel.name }), el("span.dim", { text: meta.join(" · ") }),
        sel.address ? el("span.dim.addr", { text: sel.address }) : null),
        el("div.loc-actions", {},
          el("button.btn", { type: "button", text: "Edit", onclick: (e) => openPlace(sel, trip, null, e.currentTarget) }),
          el("button.btn.quiet", { type: "button", text: "Move pin", onclick: () => { view.pick = sel.id; view.sel = null; render(); } })));
      return;
    }
    const nowhere = all.filter((p) => p.lat == null);
    if (!nowhere.length) { panel.replaceChildren(); return; }
    panel.replaceChildren(
      el("p.dim", { text: plural(nowhere.length, "place has", "places have") + " no location yet. Pick one, then tap the map." }),
      el("ul.unplaced", {}, nowhere.map((p) => el("li", {}, el("button.chip.imp-" + p.importance, { type: "button", "aria-pressed": "true", text: p.name,
        onclick: () => { view.pick = p.id; render(); } })))));
  }

  // ---------- Routing ----------
  function render() {
    const m = /^#\/trip\/([\w-]+)(\/map)?/.exec(location.hash);
    const trip = m ? findTrip(m[1]) : null;
    if (m && !trip) { location.replace("#/"); return; }
    if ((trip && trip.id) !== view.trip) { view.from = null; view.pick = null; view.sel = null; view.trip = trip ? trip.id : null; }
    view.mode = trip && m[2] ? "map" : "board";
    const onMap = view.mode === "map";
    $("viewToggle").hidden = !trip;
    $("viewToggle").replaceChildren(icon(onMap ? "list" : "map"));
    $("viewToggle").setAttribute("aria-label", onMap ? "Board" : "Map");
    $("mapView").hidden = !onMap;
    $("app").hidden = onMap;
    document.body.classList.toggle("on-map", onMap);
    if (onMap) {
      document.body.classList.add("on-board");
      $("title").textContent = trip.name;
      $("back").hidden = false;
      $("editTrip").hidden = false;
      $("fab").hidden = !!view.pick;
      showMap(trip);
      return;
    }
    const main = $("app");
    const y = main.dataset.trip === String(view.trip) ? window.scrollY : 0;
    main.dataset.trip = String(view.trip);
    main.replaceChildren();
    document.body.classList.toggle("on-board", !!trip);
    $("back").hidden = !trip;
    $("editTrip").hidden = !trip;
    $("fab").hidden = !trip;
    if (trip) renderBoard(main, trip); else renderHome(main);
    window.scrollTo(0, y);
  }

  function start(ctx) {
    ({ doc, store, motion, save: saveDoc } = ctx);
    doc = M.sanitizeDoc(doc);
    $("back").append(icon("back"));
    $("editTrip").append(icon("pencil"));
    $("fab").append(icon("plus"));
    $("back").addEventListener("click", () => { location.hash = "#/"; });
    $("viewToggle").addEventListener("click", () => {
      view.pick = null;
      location.hash = "#/trip/" + view.trip + (view.mode === "map" ? "" : "/map");
    });
    $("editTrip").addEventListener("click", (e) => openTrip(findTrip(view.trip), e.currentTarget));
    $("fab").addEventListener("click", (e) => openPlace(null, findTrip(view.trip), null, e.currentTarget));
    window.addEventListener("hashchange", render);
    render();
  }

  window.Tripboard.views = { start, el, render: () => render(), get doc() { return doc; } };
})();
