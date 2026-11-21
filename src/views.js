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
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) n.append(kid);
    // A radio group is one Tab stop, on its checked option (radioKeys).
    if (props && props.role === "radio") n.tabIndex = props["aria-checked"] === "true" ? 0 : -1;
    return n;
  }

  // Radio groups (.seg): the arrow keys pick the next or previous option,
  // mirrored right to left. Picking one repaints the group, so the focus
  // goes back to the checked option of the group that's there now.
  function radioKeys() {
    const groups = () => [...document.querySelectorAll("[role=radiogroup]")];
    const refocus = (gi) => {
      const g = groups()[gi];
      const on = g && g.querySelector("[role=radio][aria-checked=true]");
      if (on && !g.contains(document.activeElement)) on.focus();
    };
    document.addEventListener("keydown", (e) => {
      const r = e.target.closest && e.target.closest("[role=radio]");
      const g = r && r.closest("[role=radiogroup]");
      if (!g || e.altKey || e.ctrlKey || e.metaKey) return;
      const back = { ArrowUp: true, ArrowDown: false, ArrowLeft: i18n.dir !== "rtl", ArrowRight: i18n.dir === "rtl" }[e.key];
      if (back === undefined) return;
      e.preventDefault();
      const all = [...g.querySelectorAll("[role=radio]:not(:disabled)")];
      const next = all[(all.indexOf(r) + (back ? -1 : 1) + all.length) % all.length];
      if (!next || next === r) return;
      const gi = groups().indexOf(g);
      next.focus();
      next.click();
      refocus(gi);
    });
    document.addEventListener("click", (e) => {
      const r = e.target.closest && e.target.closest("[role=radio]");
      const g = r && r.closest("[role=radiogroup]");
      if (g && r === document.activeElement) { const gi = groups().indexOf(g); setTimeout(() => refocus(gi)); }
    }, true);
  }

  const today = () => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };
  const asDate = (day) => new Date(day + "T12:00:00");
  const fmt = (opts) => new Intl.DateTimeFormat(i18n.lang, opts);
  const dayLabel = (day) => fmt({ weekday: "short", day: "numeric", month: "short" }).format(asDate(day));
  function rangeLabel(t) {
    if (!t.start) return i18n.t("No dates yet");
    const e = t.end || t.start;
    const f = fmt({ day: "numeric", month: "short", year: "numeric" });
    return f.formatRange ? f.formatRange(asDate(t.start), asDate(e)) : f.format(asDate(t.start)) + " – " + f.format(asDate(e));
  }
  function whenLabel(t) {
    const s = M.tripStatus(t, today());
    if (s === "now") return i18n.t("Under way");
    if (s === "past") return i18n.t("Been");
    if (s === "upcoming") { const n = M.daysUntil(t.start, today()); return n === 1 ? i18n.t("Tomorrow") : i18n.t("In {n} days", { n }); }
    return "";
  }
  const daysLabel = (p) => (p.endDay ? dayLabel(p.day) + " – " + dayLabel(p.endDay) : dayLabel(p.day));
  const timeLabel = (p) => (p.time ? p.time + (p.endTime ? "–" + p.endTime : "") : "");

  let doc, store, motion, saveDoc;
  const covers = new Map();
  const view = { trip: null, sort: "time", only: [], from: null, mode: "board", pick: null, sel: null };
  try { Object.assign(view, JSON.parse(localStorage.getItem("tripboard.view") || "{}"), { trip: null, from: null }); } catch (e) { /* first visit */ }
  const remember = () => { try { localStorage.setItem("tripboard.view", JSON.stringify({ sort: view.sort, only: view.only })); } catch (e) { /* private window */ } };

  const findTrip = (id) => doc.trips.find((t) => t.id === id);
  const placesOf = (id) => doc.places.filter((p) => p.trip === id);
  // What you may do on a trip, by its share settings (M.access).
  const meId = () => window.Tripboard.settings.get().me.id;
  const mayEdit = (trip) => !trip || M.can(trip, meId(), "edit");
  const sees = (trip, section) => !trip || M.can(trip, meId(), section);
  // A sheet for someone who can only view: its fields read-only, and its
  // Save and Delete gone. Open, Save a copy and Cancel stay.
  function lockForm(form, locked) {
    for (const n of form.querySelectorAll("input, select, textarea, button")) {
      if (n.matches("[data-close], .attached-file, #fileOpen, #fileSaveCopy")) continue;
      if (n.type === "submit" || n.classList.contains("danger")) {
        if (locked && !n.hidden) { n.hidden = true; n.dataset.lockHidden = ""; }
        else if (!locked && "lockHidden" in n.dataset) { n.hidden = false; delete n.dataset.lockHidden; }
      } else n.disabled = locked;
    }
  }
  // Every change goes through here: cleaned, stamped against the last save
  // (updatedAt, and what was deleted), kept, drawn, and sent to sync.
  let lastSaved = "{}", version = 0;
  // Your place categories (Settings → Categories).
  const cats = () => M.catList((SET.get().categories || {}).list);
  function save() {
    version++;
    doc = M.stamp(JSON.parse(lastSaved), M.carryCats(M.sanitizeDoc(doc), cats()), undefined, SET.get().me.id);
    lastSaved = JSON.stringify(doc);
    saveDoc(doc);
    render();
    if (window.Tripboard.sync) window.Tripboard.sync.soon();
    if (window.Tripboard.share) window.Tripboard.share.soon();
  }

  // A short note at the bottom, with Undo when the change can be taken back.
  let toastTimer = null;
  function toast(text, undo) {
    let box = $("toast");
    if (!box) { box = el("div.toast", { role: "status" }); box.id = "toast"; document.body.append(box); }
    clearTimeout(toastTimer);
    box.replaceChildren(el("span", { text }), ...(undo ? [el("button.btn.quiet", { type: "button", text: i18n.t("Undo"),
      onclick: () => { box.hidden = true; undo(); } })] : []));
    box.hidden = false;
    toastTimer = setTimeout(() => { box.hidden = true; }, undo ? 8000 : 3000);
  }
  // Makes a change that Undo can take back: the whole doc as it was before.
  function undoable(text, change, after) {
    const before = JSON.stringify(doc);
    change();
    save();
    toast(text, async () => {
      doc = JSON.parse(before);
      if (after) await after();
      save();
      toast(i18n.t("Undone."));
    });
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

  // ---------- Importing a Google Maps list (src/listimport.js) ----------
  // The places come in at once (Undo takes them all back); the ones without
  // a location are then looked up by name with Find by name, one at a time.
  async function importList(trip, items) {
    const have = new Set(placesOf(trip.id).map((p) => p.name.toLowerCase()));
    const stamp = new Date().toISOString();
    const fresh = [];
    for (const it of items) {
      if (have.has(it.name.toLowerCase())) continue;
      have.add(it.name.toLowerCase());
      const p = { id: M.newId(), trip: trip.id, name: it.name, category: "other", importance: "want", createdAt: stamp, updatedAt: stamp };
      if (it.note) p.note = it.note;
      if (it.lat != null) Object.assign(p, { lat: it.lat, lng: it.lng });
      fresh.push(p);
    }
    if (!fresh.length) { toast(items.length ? i18n.t("Those places are all in this trip already.") : i18n.t("No places found in that.")); return; }
    undoable(i18n.tn(fresh.length, "Imported 1 place.", "Imported {n} places."), () => { doc.places.push(...fresh); });
    await locateImported(trip, fresh.filter((p) => p.lat == null).map((p) => p.id));
  }
  async function locateImported(trip, ids) {
    if (!ids.length || navigator.onLine === false) return;
    const prov = SET.get().providers;
    const known = cats().map(([id]) => id);
    let found = 0;
    for (const [i, id] of ids.entries()) {
      const p = doc.places.find((x) => x.id === id);
      if (!p) continue;
      toast(i18n.t("Finding {name} on the map ({at} of {total})…", { name: p.name, at: i + 1, total: ids.length }));
      const near = placesOf(trip.id).filter((x) => x.lat != null);
      try {
        const got = await PL.search(p.name + (trip.destinations[0] && !near.length ? ", " + trip.destinations[0] : ""),
          { chain: SET.chain("search"), keys: { google: prov.google.key, maptiler: prov.maptiler.key }, near });
        const r = got.results[0];
        const cur = doc.places.find((x) => x.id === id);
        if (r && cur && cur.lat == null) {
          Object.assign(cur, { lat: r.lat, lng: r.lng, updatedAt: new Date().toISOString() });
          if (r.source === "google") Object.assign(cur, { placeId: r.placeId, geoAt: new Date().toISOString().slice(0, 10) });
          else if (r.address) cur.address = r.address;
          if (r.category && known.includes(r.category) && cur.category === "other") cur.category = r.category;
          found++;
          save();
        }
      } catch (e) { /* stays without a location */ }
      // OpenStreetMap asks for about one search a second.
      await new Promise((ok) => setTimeout(ok, 1100));
    }
    toast(found === ids.length ? i18n.tn(found, "Found 1 place on the map.", "Found all {n} places on the map.")
      : i18n.t("Found {found} of {total} on the map. The rest have no location yet; Find by name or Pin on map in each one.", { found, total: ids.length }));
  }
  // In New trip the list waits for Create (pendingList); in Edit trip its
  // places come in at once.
  let pendingList = null;
  async function gotList(list) {
    if (editingTrip) {
      await closeSheet($("tripSheet"));
      await importList(editingTrip, list.places);
      return;
    }
    if (!list.places.length) { toast(i18n.t("No places found in that.")); return; }
    const f = $("tripForm");
    if (list.title && !f.name.value.trim()) f.name.value = list.title;
    pendingList = list;
    paintList();
  }
  function paintList() {
    const list = pendingList, n = list ? list.places.length : 0;
    const located = list ? list.places.filter((p) => p.lat != null).length : 0;
    $("tripListCard").hidden = !list;
    $("tripImportPick").hidden = $("tripImportHint").hidden = !!list;
    $("tripImportLinkRow").hidden = !!list || !SHARE.enabled();
    if (list) {
      $("tripListCount").textContent = list.title ? i18n.tn(n, "1 place from {name}", "{n} places from {name}", { name: list.title }) : i18n.tn(n, "1 place", "{n} places");
      $("tripListHow").textContent = located === n ? i18n.t("All of them have a location.")
        : !located ? i18n.t("They're found on the map by name once the trip is made.")
        : i18n.tn(located, "1 has a location; the rest are found on the map by name once the trip is made.", "{n} have a location; the rest are found on the map by name once the trip is made.");
    }
    $("tripDestHint").textContent = list && located < n ? i18n.t("Separate them with commas. With a list, add the city too, so places are found in the right one.") : i18n.t("Separate them with commas.");
    $("tripSave").textContent = editingTrip ? i18n.t("Save") : list ? i18n.tn(n, "Create trip with 1 place", "Create trip with {n} places") : i18n.t("Create trip");
  }
  $("tripListRemove").addEventListener("click", () => {
    const f = $("tripForm");
    if (pendingList && pendingList.title && f.name.value === pendingList.title) f.name.value = "";
    pendingList = null;
    paintList();
  });
  $("tripImportFile").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (/\.kmz$/i.test(file.name)) { toast(i18n.t("That's a KMZ. In My Maps, tick Export to a .KML file and try again.")); return; }
    const text = await file.text();
    const LI = window.Tripboard.listImport;
    await gotList({ title: LI.title(text, file.name), places: LI.parse(text, file.name) });
  });
  $("tripImportGo").addEventListener("click", async () => {
    const btn = $("tripImportGo");
    const url = $("tripImportLink").value.trim();
    if (!url) return;
    btn.disabled = true;
    try {
      const got = await SHARE.googleList(url);
      await gotList({ title: got.title || "", places: got.places || [] });
    } catch (err) { toast(err.message); }
    finally { btn.disabled = false; }
  });

  // ---------- Home ----------
  function renderHome(main) {
    $("title").textContent = "Tripboard";
    const trips = M.sortTrips(doc.trips, today());
    if (!trips.length) {
      main.append(el("div.empty", {}, el("p", { text: i18n.t("No trips yet.") }), el("p.dim", { text: i18n.t("Make one with + at the top, then add the places you want to see.") })));
    } else {
      main.append(el("h2.section", { text: i18n.t("My trips") }));
      main.append(el("ul.trips", {}, trips.map((t) => {
        const n = placesOf(t.id).length;
        const when = whenLabel(t);
        return el("li", {}, el("a.trip-card", { href: "#/trip/" + t.id + (M.tripStatus(t, today()) === "now" ? "/today" : "") },
          coverBox(t, "trip-cover"),
          el("div.trip-text", {},
            el("strong", { text: t.name }),
            el("span.dim", { text: [rangeLabel(t), i18n.tn(n, "1 place", "{n} places")].join(" · ") }),
            t.destinations.length ? el("span.dim", { text: t.destinations.join(", ") }) : null),
          when ? el("span.badge", { text: when }) : null));
      })));
    }
    if (!store.persistent) main.append(el("p.note", { text: i18n.t("This browser isn't keeping data: trips last until the tab closes.") }));
    main.append(el("p.dim.version", { text: i18n.t("Version {version}", { version: window.Tripboard.version }) }));
  }

  // ---------- A trip's board ----------
  const SORTS = [["time", i18n.t("Time")], ["category", i18n.t("Category")], ["importance", i18n.t("Importance")], ["distance", i18n.t("Distance")]];
  function renderBoard(main, trip) {
    $("title").textContent = trip.name;
    const places = placesOf(trip.id);
    const hero = coverBox(trip, "hero");
    hero.append(el("div.hero-text", {},
      el("span", { text: rangeLabel(trip) + (whenLabel(trip) ? " · " + whenLabel(trip) : "") }),
      trip.destinations.length ? el("ul.chips", {}, trip.destinations.map((d) => el("li", { text: d }))) : null));
    main.append(hero);

    const controls = el("div.controls", {},
      el("div.seg.sorts", { role: "tablist", "aria-label": i18n.t("Sort places by") }, SORTS.map(([id, label]) =>
        el("button", { type: "button", role: "tab", "aria-selected": String(view.sort === id), text: label,
          onclick: () => { view.sort = id; remember(); render(); } }))),
      el("div.filters", { role: "group", "aria-label": i18n.t("Show") }, M.IMPORTANCE.map(([id, label]) => {
        const on = !view.only.length || view.only.includes(id);
        return el("button.chip.imp-" + id, { type: "button", "aria-pressed": String(on), text: label, onclick: () => toggleOnly(id) });
      })));
    main.append(controls);
    const ask = wxAsk(trip);
    if (ask) main.append(ask);

    if (!places.length) {
      main.append(el("div.empty", {}, el("p", { text: i18n.t("Nothing planned yet.") }), el("p.dim", { text: i18n.t("Add the first place with +.") })));
      return;
    }
    if (view.sort === "distance" && !view.from) {
      main.append(el("div.locate", {},
        el("p.dim", { text: places.some((p) => p.lat != null) ? i18n.t("Nearest to you first, once you allow your location.")
          : i18n.t("No place has a location yet. Give one with Find by name or Pin on map in its sheet, or on the Map.") }),
        el("button.btn", { type: "button", onclick: locate }, icon("locate"), i18n.t("Use my location"))));
    }
    const groups = M.board(trip, places, view.sort, { only: view.only, from: view.from, cats: cats() });
    // Groups with nothing in them yet, to drop into while dragging.
    const all = view.sort === "category" ? cats() : view.sort === "importance" ? M.IMPORTANCE : [];
    for (const [id, title] of all) {
      if (!groups.some((g) => g.id === id)) groups.push({ id, title, places: [], dropOnly: true });
    }
    const at = (id) => { const i = all.findIndex(([x]) => x === id); return i < 0 ? all.length : i; };
    if (all.length) groups.sort((a, b) => at(a.id) - at(b.id));
    const wrap = el("div.groups");
    if (canDrag()) wireDrag(wrap);
    const wx = view.sort === "time" ? wxDays(trip) : null;
    for (const g of groups) wrap.append(group(trip, g, wx));
    main.append(wrap);
  }

  // A trip's tabs, in the bar's order: Today sits in the middle while the trip is under way.
  const tripTabs = (trip) => [["board", "list", i18n.t("Plan"), ""], ["map", "map", i18n.t("Map"), "/map"], ["today", "sun", i18n.t("Today"), "/today"],
    ["expenses", "wallet", i18n.t("Expenses"), "/expenses"], ["files", "file", i18n.t("Files"), "/files"]].filter(([mode]) => (mode === "today" ? underWay(trip) : sees(trip, mode)));
  // A trip's floating pill at the bottom: Plan, Map, Expenses, Files, as icons.
  function paintTripBar(trip) {
    const bar = $("tripBar");
    const was = !$("bottomBar").hidden && bubble.isConnected && !bubble.hidden ? new DOMMatrix(getComputedStyle(bubble).transform).m41 : null;
    $("bottomBar").hidden = !trip;
    document.body.classList.toggle("with-tabbar", !!trip);
    if (!trip) return;
    const tabs = tripTabs(trip);
    const same = bar.dataset.tabs === trip.id + tabs.map(([m, , label]) => m + label).join();
    // The same tabs keep their nodes, so a repaint mid-move doesn't cut the hop short.
    if (same) [...bar.querySelectorAll(".tab")].forEach((a, i) => a.setAttribute("aria-current", view.mode === tabs[i][0] ? "page" : "false"));
    else {
      bar.dataset.tabs = trip.id + tabs.map(([m, , label]) => m + label).join();
      bar.replaceChildren(bubble, ...tabs.map(([mode, ico, label, path]) =>
        el("a.tab", { href: "#/trip/" + trip.id + path, "aria-label": label, title: label, "aria-current": view.mode === mode ? "page" : "false",
          onclick: () => { view.pick = null; } }, icon(ico))));
    }
    slideBubble(bar, same ? was : null);
  }

  // ---------- Moving between a trip's tabs, and between screens ----------
  // The new tab pushes in from its side of the bar (mirrored right to
  // left, as the swipe is) and the old one leaves the other way, both on
  // one spring that settles a little past its place; the bar's circle
  // slides over on a bouncier spring, stretching as it goes but never past
  // the first or last tab (so never out of the pill), and the icon it lands
  // under swells, settles back and turns white.
  // Going deeper (Home to a trip, a trip to Sharing or Settings, Settings
  // to one of its pages) pushes the next screen in from the end edge with
  // the same small bounce while the one under it drifts a quarter the
  // other way and dims; Back sends it out to the end edge without one.
  // Under reduced motion the screens cross-fade and the circle jumps.
  const springOf = (k, zeta) => window.Keel.motion.spring(k, 2 * zeta * Math.sqrt(k));
  const TAB_PAGE = springOf(260, 0.78), TAB_BUBBLE = springOf(520, 0.68), PAGE_OUT = springOf(400, 1), PRESS = springOf(700, 0.38);
  const LINEAR = !!(window.CSS && CSS.supports && CSS.supports("transition-timing-function", "linear(0, 1)"));
  const onSpring = (s) => ({ duration: s.ms, easing: LINEAR ? s.curve : "cubic-bezier(0.2, 0.9, 0.3, 1)" });
  const lessMotion = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const bubble = el("span.tab-bubble", { "aria-hidden": "true" });
  let tabMove = null;

  function slideBubble(bar, was) {
    const tabs = [...bar.querySelectorAll(".tab")];
    const on = tabs.find((t) => t.getAttribute("aria-current") === "page");
    bubble.hidden = !on;
    if (!on) return;
    const x = on.offsetLeft;
    if (bubble.dataset.x === String(x) && bubble.getAnimations().length) return;
    bubble.getAnimations().forEach((a) => a.cancel());
    bubble.dataset.x = x;
    bubble.style.transform = "translateX(" + x + "px)";
    if (was == null || Math.abs(was - x) < 1 || lessMotion() || !bubble.animate) return;
    const t = onSpring(TAB_BUBBLE), reach = Math.min(1, Math.abs(x - was) / 100);
    const lo = Math.min(...tabs.map((n) => n.offsetLeft)), hi = Math.max(...tabs.map((n) => n.offsetLeft));
    bubble.animate(TAB_BUBBLE.pts.map((k) => ({ transform: "translateX(" + Math.min(hi, Math.max(lo, was + (x - was) * k)) + "px)" })),
      { duration: t.duration, easing: "linear" });
    bubble.animate([{ scale: "1 1" }, { scale: (1 + 0.28 * reach) + " " + (1 - 0.1 * reach), offset: 0.22 }, { scale: "1 1", offset: 0.6 }, { scale: "1 1" }],
      { duration: t.duration, easing: "ease-out" });
    const off = tabs.find((n) => n !== on), dim = off ? getComputedStyle(off).color : null, white = getComputedStyle(on).color;
    if (dim) {
      on.animate([{ color: dim }, { color: dim, offset: 0.3 }, { color: white }], { duration: 260, easing: "linear" });
      const left = tabs.reduce((a, n) => (Math.abs(n.offsetLeft - was) < Math.abs(a.offsetLeft - was) ? n : a), tabs[0]);
      if (left !== on) left.animate([{ color: white }, { color: dim }], { duration: 160, easing: "linear" });
    }
    swell(on.firstChild, 60);
  }
  // A tab's icon, or the +'s, swells and settles when picked.
  function swell(n, delay) {
    if (!n || !n.animate || lessMotion()) return;
    n.animate([{ transform: "none" }, { transform: "scale(1.22)", offset: 0.35 }, { transform: "scale(0.96)", offset: 0.7 }, { transform: "none" }],
      { duration: 420, delay: delay || 0, easing: "ease-out" });
  }

  // What's on screen before a render, so the tab that leaves can be moved.
  let shownHash = null;
  // How deep a screen is: Home 0, a trip 1, its Sharing 2; Settings one
  // more than where it was opened from, and each of its pages one more.
  function depthOf(hash) {
    const sm = /^#\/settings(?:\/(.+))?$/.exec(hash);
    if (sm) { let d = view.settingsFrom ? 2 : 1; for (let pg = sm[1]; pg; pg = settingsParent(pg)) d++; return d; }
    if (/^#\/trip\/[\w-]+\/share/.test(hash)) return 2;
    return /^#\/(trip|join)\//.test(hash) ? 1 : 0;
  }
  function tabBefore() {
    const main = $("app"), map = $("mapView");
    return { hash: shownHash, trip: view.trip, mode: view.mode, kids: [...main.childNodes], cls: main.className,
      top: main.getBoundingClientRect().top, map: map.hidden ? null : map.getBoundingClientRect() };
  }
  function tabAfter(b) {
    const hash = location.hash || "#/";
    shownHash = hash;
    if (tabMove && tabMove.to === hash) { tabMove.hold(); return; }
    // A saved sheet slides away while what it changed is already drawn
    // under it; the screen under it doesn't move as well.
    const sheetUp = !!document.querySelector("dialog[open]");
    // A move cut short by the next one: the screen it was bringing in
    // leaves from where it got to, not from its place, so nothing jumps.
    const cut = tabMove ? { into: tabMove.into, x: new DOMMatrix(getComputedStyle(tabMove.into).transform).m41 } : null;
    if (tabMove) tabMove.end();
    if (sheetUp || b.hash == null || b.hash === hash || !document.body.animate) return;
    const trip = view.trip === b.trip && b.mode !== view.mode && findTrip(view.trip);
    const modes = trip ? tripTabs(trip).map(([m]) => m) : [], i = modes.indexOf(b.mode), j = modes.indexOf(view.mode);
    const d0 = depthOf(b.hash), d1 = depthOf(hash);
    const kind = i >= 0 && j >= 0 ? "tab" : d1 > d0 ? "push" : d1 < d0 ? "pop" : null;
    if (!kind) return;
    const map = $("mapView"), main = $("app");
    let out;
    // A repaint while the map leaves hides it again (paint()); hold() shows it until the move ends.
    const hold = () => { if (out === map) map.hidden = false; };
    if (b.mode === "map") {
      if (!b.map) return;
      out = map;
      map.hidden = false;
      map.classList.add("tab-leaving");
      Object.assign(map.style, { top: b.map.top + "px", left: b.map.left + "px", width: b.map.width + "px", height: b.map.height + "px" });
    } else {
      out = document.createElement("main");
      out.className = b.cls;
      out.classList.add("tab-leaving");
      out.setAttribute("aria-hidden", "true");
      out.inert = true;
      out.style.top = b.top + "px";
      out.append(...b.kids);
      document.body.append(out);
    }
    const into = view.mode === "map" && out !== map ? map : main;
    const w = window.innerWidth * (i18n.dir === "rtl" ? -1 : 1);
    const fx = cut && cut.into === (out === map ? map : main) ? cut.x : 0;
    const at = (k, x = 0) => "translateX(" + (k * w + x) + "px)";
    const DIM = "brightness(0.9)";
    // The screen on top during the move: the new one on a push, the old one on Back.
    if (kind === "push") { out.classList.add("tab-under"); into.classList.add("tab-over"); }
    let anims;
    if (lessMotion()) anims = [into.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 }), out.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: "forwards" })];
    else if (kind === "tab") {
      const k = j > i ? 1 : -1;
      anims = [into.animate([{ transform: at(k, fx) }, { transform: "none" }], onSpring(TAB_PAGE)),
        out.animate([{ transform: at(0, fx) }, { transform: at(-k) }], { ...onSpring(TAB_PAGE), fill: "forwards" })];
    } else if (kind === "push") {
      anims = [into.animate([{ transform: at(1) }, { transform: "none" }], onSpring(TAB_PAGE)),
        out.animate([{ transform: at(0, fx), filter: "none" }, { transform: at(-0.25), filter: DIM }], { ...onSpring(TAB_PAGE), fill: "forwards" })];
    } else {
      anims = [into.animate([{ transform: at(-0.25), filter: DIM }, { transform: "none", filter: "none" }], onSpring(PAGE_OUT)),
        out.animate([{ transform: at(0, fx) }, { transform: at(1) }], { ...onSpring(PAGE_OUT), fill: "forwards" })];
    }
    document.documentElement.classList.add("tab-moving");
    const end = () => {
      if (!tabMove || tabMove.end !== end) return;
      tabMove = null;
      anims.forEach((a) => a.cancel());
      document.documentElement.classList.remove("tab-moving");
      into.classList.remove("tab-over");
      if (out === map) {
        map.classList.remove("tab-leaving", "tab-under");
        ["top", "left", "width", "height"].forEach((k) => map.style.removeProperty(k));
        map.hidden = view.mode !== "map";
      } else out.remove();
    };
    tabMove = { to: hash, end, hold, into };
    Promise.all(anims.map((a) => a.finished)).then(end, end);
  }


  // ---------- Weather ----------
  // Open-Meteo's forecast (src/weather.js) on Today and each day heading,
  // once the person says yes: their places' rough locations go to it.
  // The last forecast is kept on this device (localStorage
  // "tripboard.weather"), so a trip with no signal shows it, never synced.
  const W = window.Tripboard.weather;
  const WX_KEY = "tripboard.weather";
  const WX_ICON = { clear: "sun", partly: "cloudSun", cloudy: "cloud", fog: "cloudFog", drizzle: "cloudDrizzle", rain: "cloudRain", snow: "cloudSnow", storm: "cloudLightning" };
  const WX_WORDS = { clear: i18n.t("Clear"), partly: i18n.t("Partly cloudy"), cloudy: i18n.t("Cloudy"), fog: i18n.t("Fog"), drizzle: i18n.t("Drizzle"), rain: i18n.t("Rain"), snow: i18n.t("Snow"), storm: i18n.t("Thunderstorms") };
  const wxOn = () => SET.get().weather.on === true;
  const wxUnit = () => SET.get().weather.unit || W.localUnit(navigator.language);
  const wxBusy = new Map();
  function wxKept() { try { return JSON.parse(localStorage.getItem(WX_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function wxKeep(tripId, f) {
    const all = wxKept();
    if (f) all[tripId] = f; else delete all[tripId];
    for (const id of Object.keys(all)) if (!findTrip(id)) delete all[id];
    try { localStorage.setItem(WX_KEY, JSON.stringify(all)); } catch (e) { /* private window: this visit only */ }
  }
  // Can this trip have a forecast: a located place, and a day in reach?
  function wxCan(trip) {
    const pts = W.points(trip, placesOf(trip.id));
    return W.reachable(Object.keys(pts), today()).length > 0;
  }
  // The kept forecast's days for a trip, asking Open-Meteo again when it's
  // stale; the screen redraws when the new one comes.
  function wxDays(trip) {
    if (!wxOn()) return null;
    const kept = wxKept()[trip.id] || null;
    const busy = wxBusy.get(trip.id);
    if (navigator.onLine !== false && !(busy && (busy.p || Date.now() - busy.failed < 10 * 60e3))) {
      const job = { p: null, failed: 0 };
      job.p = W.forecast(trip, placesOf(trip.id), { today: today(), cached: kept })
        .then((f) => {
          wxBusy.delete(trip.id);
          if (!f || f === kept) return;
          wxKeep(trip.id, f);
          if (view.trip === trip.id && (view.mode === "today" || (view.mode === "board" && view.sort === "time"))) render();
        })
        .catch((e) => { job.p = null; job.failed = Date.now(); window.Keel.errlog.note("weather", String(e)); });
      wxBusy.set(trip.id, job);
    }
    return kept ? kept.days : null;
  }
  const deg = (c) => W.degrees(c, wxUnit()) + "°";
  const wxSay = (w) => i18n.t("{kind}, high {max}, low {min}", { kind: WX_WORDS[w.kind], max: deg(w.max), min: deg(w.min) });
  // A day's weather, small: its icon, the high and the low.
  const wxChip = (w) => el("span.wx", { role: "img", "aria-label": wxSay(w), title: wxSay(w) },
    icon(WX_ICON[w.kind]), el("span.wx-max", { text: deg(w.max) }), el("span.wx-min", { text: deg(w.min) }));
  const clock = (hm) => fmt({ hour: "numeric", minute: "2-digit" }).format(new Date("2000-01-01T" + hm + ":00"));
  // Asked once, on Today or the Plan: weather sends the places' rough
  // locations to Open-Meteo, so it's off until the person says yes.
  function wxAsk(trip) {
    if (SET.get().weather.on !== null || !wxCan(trip)) return null;
    return el("section.panel.wx-ask", {},
      el("span.wx-ask-ic", {}, icon("cloudSun")),
      el("div.wx-ask-text", {},
        el("h2", { text: i18n.t("See the weather for each day?") }),
        el("p.dim", { text: i18n.t("The forecast comes from Open-Meteo, a free weather service. It gets your places' rough locations and the trip's dates, nothing else.") }),
        el("div.loc-actions", {},
          el("button.btn.primary", { type: "button", text: i18n.t("Show the weather"), onclick: () => { SET.setWeather({ on: true }); render(); } }),
          el("button.btn.quiet", { type: "button", text: i18n.t("Not now"), onclick: () => { SET.setWeather({ on: false }); toast(i18n.t("You can turn the weather on in Settings.")); render(); } }))));
  }

  // ---------- Today ----------
  // While a trip is under way: today's places in order, the way between
  // each two (a guess from the straight line, M.leg), and Navigate on the
  // first one not yet been to.
  const underWay = (trip) => M.tripStatus(trip, today()) === "now";
  function distLabel(km) {
    const m = km < 1;
    return new Intl.NumberFormat(i18n.lang, { style: "unit", unit: m ? "meter" : "kilometer", unitDisplay: "short", maximumFractionDigits: m ? 0 : 1 })
      .format(m ? Math.max(10, Math.round(km * 100) * 10) : km);
  }
  function legLabel(l) {
    const dist = distLabel(l.km);
    if (l.km > 50) return dist;
    const time = l.min < 60 ? i18n.t("{n} min", { n: l.min }) : i18n.t("{h} h {m} min", { h: Math.floor(l.min / 60), m: l.min % 60 });
    return l.mode === "walk" ? i18n.t("about {time} walk · {dist}", { time, dist }) : i18n.t("about {time} drive · {dist}", { time, dist });
  }
  // Google Maps' directions to a place, from wherever the phone is.
  function directions(p, mode) {
    const at = p.lat != null ? p.lat.toFixed(6) + "," + p.lng.toFixed(6) : "";
    return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(at || p.name)
      + (p.placeId ? "&destination_place_id=" + encodeURIComponent(p.placeId) : "")
      + (mode ? "&travelmode=" + (mode === "walk" ? "walking" : "driving") : "");
  }

  function renderToday(main, trip) {
    $("title").textContent = trip.name;
    const day = today();
    const all = placesOf(trip.id);
    const plan = M.dayPlan(all, day);
    const next = M.nextOf(plan);
    const done = plan.filter((p) => p.visited).length;
    const total = trip.end ? M.dayIndex(trip, trip.end) : null;
    main.append(el("header.today-head", {},
      el("div", {},
        el("p.today-kicker", { text: total ? i18n.t("Today · day {n} of {total}", { n: M.dayIndex(trip, day), total }) : i18n.t("Today") }),
        el("h2.today-date", { text: fmt({ weekday: "long", day: "numeric", month: "long" }).format(asDate(day)) })),
      plan.length ? el("span.dim.today-done", { text: i18n.t("{n} of {total} done", { n: done, total: plan.length }) }) : null));
    const wx = wxDays(trip);
    const w = wx && wx[day];
    if (w) {
      const sun = [w.sunrise ? i18n.t("Sunrise {time}", { time: clock(w.sunrise) }) : null, w.sunset ? i18n.t("Sunset {time}", { time: clock(w.sunset) }) : null].filter(Boolean);
      const at = wxKept()[trip.id].at;
      const old = Date.now() - Date.parse(at) > 12 * 3600e3;
      main.append(el("section.panel.wx-today", { "aria-label": i18n.t("Weather") },
        el("span.wx-today-ic", {}, icon(WX_ICON[w.kind])),
        el("div.wx-today-text", {},
          el("p.wx-today-kind", { text: WX_WORDS[w.kind] }),
          el("p.wx-today-temps", { "aria-label": i18n.t("High {max}, low {min}", { max: deg(w.max), min: deg(w.min) }) }, el("span.wx-max", { text: deg(w.max) }), el("span.wx-min", { text: deg(w.min) })),
          w.rain != null ? el("p.wx-today-more.dim", { text: i18n.t("Rain {n}%", { n: w.rain }) }) : null,
          sun.length ? el("p.wx-today-more.dim", { text: sun.join(" · ") }) : null,
          el("p.wx-today-src.dim", { text: old ? i18n.t("Weather from Open-Meteo, as of {when}.", { when: fmt({ weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(at)) }) : i18n.t("Weather from Open-Meteo.") }))));
    } else {
      const ask = wxAsk(trip);
      if (ask) main.append(ask);
    }

    if (!plan.length) {
      main.append(el("div.empty", {}, el("p", { text: i18n.t("Nothing planned for today.") }),
        el("p.dim", { text: mayEdit(trip) ? i18n.t("Add a place for today with +, or give one today's date on the Plan.") : i18n.t("The whole trip is on the Plan.") })));
    } else {
      const list = el("ol.today");
      plan.forEach((p, i) => {
        if (i) {
          const l = M.leg(plan[i - 1], p);
          list.append(el("li.leg", { "aria-hidden": l ? null : "true" }, l ? legLabel(l) : ""));
        }
        const isNext = p === next;
        const meta = [M.catName(cats(), trip, p.category)];
        if (p.endDay) meta.push(i18n.t("{n} of {total} days", { n: M.daySpan({ day: p.day, endDay: day }) + 1, total: M.daySpan(p) + 1 }));
        if (p.time) meta.push(timeLabel(p));
        const toHere = isNext && i ? M.leg(plan[i - 1], p) : null;
        list.append(el("li.card.imp-" + p.importance + (p.visited ? ".visited" : "") + (isNext ? ".next" : ""), { "data-id": p.id },
          el("div.card-row", {},
            el("button.tick", { type: "button", disabled: !mayEdit(trip), "aria-pressed": String(!!p.visited), "aria-label": p.visited ? i18n.t("Been to {name}", { name: p.name }) : i18n.t("Mark as been to {name}", { name: p.name }),
              onclick: () => { p.visited = !p.visited; p.updatedAt = new Date().toISOString(); save(); } }, icon("check")),
            el("button.card-body", { type: "button", onclick: (e) => openPlace(p, trip, null, e.currentTarget) },
              el("span.card-name", { text: p.name }),
              el("span.card-meta", {}, el("span.imp", { text: M.IMPORTANCE_LABEL.get(p.importance) }), " · " + meta.join(" · ")),
              p.note ? el("span.card-note", { text: p.note }) : null)),
          isNext ? el("div.next-row", {},
            el("span.next-label", { text: i18n.t("Next") }),
            el("a.btn.primary", { href: directions(p, toHere && toHere.mode), target: "_blank", rel: "noopener noreferrer", text: i18n.t("Navigate"),
              "aria-label": i18n.t("Navigate to {name}", { name: p.name }) })) : null));
      });
      main.append(list);
      if (plan.some((p) => p.lat != null)) main.append(el("p.hint.dim", { text: i18n.t("Times are guesses from the straight line between places.") }));
    }

    const tomorrow = M.addDays(day, 1);
    const later = trip.end && tomorrow <= trip.end ? M.dayPlan(all, tomorrow) : [];
    if (later.length) {
      main.append(el("a.panel.tomorrow", { href: "#/trip/" + trip.id },
        el("span.tomorrow-head", {}, el("h2", { text: i18n.t("Tomorrow") }), wx && wx[tomorrow] ? wxChip(wx[tomorrow]) : null, el("span.dim", { text: String(later.length) })),
        el("p.dim", { text: later.map((p) => p.name).join(", ") })));
    }
  }

  // ---------- Expenses ----------
  const expensesOf = (id) => (doc.expenses || []).filter((x) => x.trip === id);
  function money(amount, currency) {
    try { return new Intl.NumberFormat(i18n.lang, { style: "currency", currency }).format(amount); }
    catch (e) { return amount + " " + currency; }
  }
  const moneyList = (totals) => totals.map((t) => money(t.total, t.currency)).join(" + ");

  function renderExpenses(main, trip) {
    $("title").textContent = trip.name;
    const list = expensesOf(trip.id);
    if (!list.length) {
      main.append(el("div.empty", {}, el("p", { text: i18n.t("No expenses yet.") }), el("p.dim", { text: i18n.t("Add what the trip costs with +.") })));
      return;
    }
    const totals = M.expenseTotals(list);
    main.append(el("section.panel.spend", {},
      el("h2", { text: i18n.t("Total") }),
      el("p.spend-total", {}, totals.map((t) => el("span", { text: money(t.total, t.currency) }))),
      totals.length > 1 ? el("p.hint.dim", { text: i18n.t("Each currency adds up on its own, without exchange rates.") }) : null,
      el("ul.spend-cats", {}, M.expensesByCategory(list).map((g) => el("li", {}, el("span", { text: g.title }), el("span.amount", { text: moneyList(g.totals) }))))));
    const wrap = el("div.groups");
    for (const g of M.expenseDays(list)) {
      const title = g.day ? (trip.start ? i18n.t("Day {n} · {date}", { n: M.dayIndex(trip, g.day), date: dayLabel(g.day) }) : dayLabel(g.day)) : i18n.t("No date");
      wrap.append(el("section.group", {},
        el("div.group-head", {}, el("h2", { text: title }), el("span.count", { text: moneyList(M.expenseTotals(g.items)) })),
        el("div.xrows", {}, g.items.map((x) => {
          const place = x.place && doc.places.find((p) => p.id === x.place);
          return el("button.xrow", { type: "button", onclick: (e) => openExpense(x, trip, e.currentTarget) },
            el("span.xrow-text", {}, el("span.xrow-title", { text: x.title }),
              el("span.xrow-meta", { text: M.EXPENSE_CATEGORY.get(x.category) + (place ? " · " + place.name : "") + (x.note ? " · " + x.note : "") })),
            el("span.amount", { text: money(x.amount, x.currency) }));
        }))));
    }
    main.append(wrap);
  }

  // ---------- Files ----------
  const filesOf = (id) => (doc.files || []).filter((x) => x.trip === id);
  const sizeLabel = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB");
  const kindOf = (f) => {
    const ext = (/\.(\w{1,5})$/.exec(f.name) || [])[1];
    return f.type === "application/pdf" ? "PDF" : f.type.startsWith("image/") ? i18n.t("Image") : ext ? ext.toUpperCase() : i18n.t("File");
  };
  let haveFiles = new Set();
  // New files ask once whether they sync or stay on this device.
  let pendingFiles = null, attachTo = "";
  function askFiles(list, trip, place) {
    if (!mayEdit(trip)) return;
    const ok = list.filter((f) => f.size <= M.MAX_FILE_MB * 1e6);
    const big = list.filter((f) => f.size > M.MAX_FILE_MB * 1e6).map((f) => f.name);
    if (big.length) toast(i18n.tn(big.length, "{join} is over {MAX_FILE_MB} MB, too big to keep here.", "{join} are over {MAX_FILE_MB} MB, too big to keep here.", { join: i18n.join(big), MAX_FILE_MB: M.MAX_FILE_MB }));
    if (!ok.length) return;
    pendingFiles = { list: ok, trip, place: place || "" };
    $("addFilesTitle").textContent = i18n.tn(ok.length, "Add 1 file", "Add {n} files");
    $("addFilesNames").textContent = i18n.join(ok.map((f) => f.name));
    openSheet($("addFilesSheet"));
  }
  for (const [id, local] of [["addFilesSync", false], ["addFilesLocal", true]]) {
    $(id).addEventListener("click", async () => {
      const p = pendingFiles;
      pendingFiles = null;
      await closeSheet($("addFilesSheet"));
      if (p) await addFiles(p.list, p.trip, { local, place: p.place });
    });
  }
  async function addFiles(list, trip, { local = false, place = "" } = {}) {
    const big = [], added = [];
    for (const file of list) {
      if (file.size > M.MAX_FILE_MB * 1e6) { big.push(file.name); continue; }
      const stamp = new Date().toISOString();
      const f = M.sanitizeFile({ id: M.newId(), trip: trip.id, name: file.name, type: file.type, size: file.size, local, place, createdAt: stamp, updatedAt: stamp });
      await store.setFile(f.id, file);
      haveFiles.add(f.id);
      added.push(f);
    }
    if (added.length) { doc.files = (doc.files || []).concat(added); save(); }
    if (big.length) toast(i18n.tn(big.length, "{join} is over {MAX_FILE_MB} MB, too big to keep here.", "{join} are over {MAX_FILE_MB} MB, too big to keep here.", { join: i18n.join(big), MAX_FILE_MB: M.MAX_FILE_MB }));
    else if (added.length) toast(i18n.tn(added.length, "Added 1 file.", "Added {n} files."));
    if ($("placeSheet").open) paintPlaceFiles();
  }
  $("fileAdd").addEventListener("change", (e) => {
    const trip = findTrip(view.trip);
    if (trip && e.target.files.length) askFiles([...e.target.files], trip, attachTo);
    attachTo = "";
    e.target.value = "";
  });

  function renderFiles(main, trip) {
    $("title").textContent = trip.name;
    const list = filesOf(trip.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    // A file dropped anywhere on the page joins the trip (with a mouse).
    main.ondragover = (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { e.preventDefault(); main.classList.add("file-over"); } };
    main.ondragleave = (e) => { if (e.target === main) main.classList.remove("file-over"); };
    main.ondrop = (e) => { if (!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); main.classList.remove("file-over"); askFiles([...e.dataTransfer.files], trip); };
    if (!list.length) {
      main.append(el("div.empty", {}, el("p", { text: i18n.t("No files yet.") }),
        el("p.dim", { text: window.matchMedia("(pointer: fine)").matches ? i18n.t("Keep tickets, bookings and PDFs with the trip, to open without a connection. Add one with +, or drop it here.") : i18n.t("Keep tickets, bookings and PDFs with the trip, to open without a connection. Add one with +.") })));
      return;
    }
    const row = (f) => {
      const place = f.place && doc.places.find((p) => p.id === f.place);
      const here = haveFiles.has(f.id);
      return el("button.xrow", { type: "button", onclick: (e) => openFile(f, trip, e.currentTarget) },
        el("span.xrow-ic", {}, icon(f.type.startsWith("image/") ? "image" : "file")),
        el("span.xrow-text", {}, el("span.xrow-title", { text: f.name }),
          el("span.xrow-meta", { text: [kindOf(f), sizeLabel(f.size), place ? place.name : "", here ? "" : i18n.t("not on this device yet")].filter(Boolean).join(" · ") })));
    };
    const synced = list.filter((f) => !f.local), local = list.filter((f) => f.local);
    const wrap = el("div.groups");
    if (synced.length) wrap.append(el("section.group", {}, el("div.group-head", {}, el("h2", { text: i18n.t("Synced") }), el("span.count", { text: String(synced.length) })),
      el("p.hint.dim", { text: i18n.t("On all your devices, and with everyone the trip is shared with.") }), el("div.xrows", {}, synced.map(row))));
    if (local.length) wrap.append(el("section.group", {}, el("div.group-head", {}, el("h2", { text: i18n.t("On this device only") }), el("span.count", { text: String(local.length) })),
      el("p.hint.dim", { text: i18n.t("Stays here. Other devices and other people don't see it.") }), el("div.xrows", {}, local.map(row))));
    main.append(wrap);
    if (window.matchMedia("(pointer: fine)").matches) main.append(el("p.dim.hint.page-hint", { text: i18n.t("Drop files here to add them.") }));
  }

  let editingFile = null, fileLocal = false;
  function paintKept() {
    $("fileKeptSeg").replaceChildren(...[[false, i18n.t("Synced")], [true, i18n.t("Only this device")]].map(([local, label]) =>
      el("button", { type: "button", role: "radio", "aria-checked": String(fileLocal === local), text: label, onclick: () => { fileLocal = local; paintKept(); } })));
    $("fileKeptHint").textContent = fileLocal ? i18n.t("Stays here. Other devices and other people don't see it.") : i18n.t("On all your devices, and with everyone the trip is shared with.");
  }
  async function openFile(f, trip, from) {
    editingFile = f;
    const form = $("fileForm");
    form.reset();
    form.name.value = f.name;
    form.note.value = f.note || "";
    $("filePlace").replaceChildren(el("option", { value: "", text: i18n.t("None") }),
      ...placesOf(trip.id).slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => el("option", { value: p.id, text: p.name })));
    $("filePlace").value = f.place && placesOf(trip.id).some((p) => p.id === f.place) ? f.place : "";
    fileLocal = !!f.local;
    paintKept();
    const blob = await store.file(f.id);
    $("fileInfo").textContent = i18n.t(blob ? "{kind} · {size} · added {date}" : "{kind} · {size} · added {date}. It isn't on this device yet; it comes with the next sync.", { kind: kindOf(f), size: sizeLabel(f.size), date: i18n.date(new Date(f.createdAt)) });
    $("fileOpen").disabled = $("fileSaveCopy").disabled = !blob;
    const url = () => URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: f.type }));
    $("fileOpen").onclick = () => { const u = url(); window.open(u, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(u), 60000); };
    $("fileSaveCopy").onclick = () => {
      const a = el("a", { href: url(), download: f.name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    };
    armDelete($("fileDelete"), i18n.t("Delete"), () => {
      closeSheet($("fileSheet"));
      undoable(i18n.t("Deleted {name}.", { name: f.name }), () => { doc.files = doc.files.filter((x) => x !== f); });
    });
    lockForm(form, !mayEdit(trip));
    openSheet($("fileSheet"), from);
  }
  $("fileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    if (!form.name.value.trim()) { form.name.setAttribute("aria-invalid", "true"); form.name.focus(); return; }
    form.name.removeAttribute("aria-invalid");
    Object.assign(editingFile, { name: form.name.value, place: form.place.value, note: form.note.value });
    if (fileLocal) editingFile.local = true; else delete editingFile.local;
    const closing = closeSheet($("fileSheet"));
    save();
    await closing;
  });
  // Opens a file's bytes in a new tab, or says why it can't.
  async function viewFile(f) {
    const blob = await store.file(f.id);
    if (!blob) { toast(i18n.t("{name} isn't on this device yet; it comes with the next sync.", { name: f.name })); return; }
    const u = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: f.type }));
    window.open(u, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  }
  const filesOn = (placeId) => (doc.files || []).filter((f) => f.place === placeId);
  function fileButtons(list) {
    return list.map((f) => el("li", {}, el("button.attached-file", { type: "button", onclick: () => viewFile(f) },
      icon(f.type.startsWith("image/") ? "image" : "file"), el("span", { text: f.name }),
      f.local ? el("span.attached-local", { title: i18n.t("Only this device"), "aria-label": i18n.t("Only this device") }, icon("phone")) : null)));
  }
  function paintPlaceFiles() {
    const on = !!editingPlace && sees(placeTrip, "files");
    $("placeFilesRow").hidden = !on;
    if (on) $("placeFiles").replaceChildren(...fileButtons(filesOn(editingPlace.id)));
    $("placeAttach").hidden = !mayEdit(placeTrip);
  }
  $("placeAttach").addEventListener("click", () => {
    if (!editingPlace) return;
    attachTo = editingPlace.id;
    $("fileAdd").click();
  });

  // Bytes whose record is gone (deleted, past its Undo) are let go at start.
  async function sweepFiles() {
    const ids = await store.fileIds().catch(() => []);
    const live = new Set((doc.files || []).map((f) => f.id));
    for (const id of ids) if (!live.has(id)) await store.dropFile(id);
    haveFiles = new Set(ids.filter((id) => live.has(id)));
    if (view.mode === "files") render();
  }

  let editingExpense = null, expenseTrip = null;
  const lastCurrency = () => { try { return localStorage.getItem("tripboard.currency") || ""; } catch (e) { return ""; } };
  function openExpense(x, trip, from) {
    editingExpense = x;
    expenseTrip = trip;
    const f = $("expenseForm");
    f.reset();
    f.amount.removeAttribute("aria-invalid");
    const mine = expensesOf(trip.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const cur = x ? x.currency : (mine[0] && mine[0].currency) || lastCurrency() || "USD";
    const codes = [...new Set([cur, ...mine.map((e) => e.currency), ...M.CURRENCIES])];
    $("expenseCurrency").replaceChildren(...codes.map((c) => el("option", { value: c, text: c })));
    $("expenseCurrency").value = cur;
    $("expenseCategory").replaceChildren(...M.EXPENSE_CATEGORIES.map(([id, label]) => el("option", { value: id, text: label })));
    $("expenseCategory").value = x ? x.category : "food";
    const dated = !!trip.start;
    $("expenseDay").hidden = !dated;
    $("expenseDayInput").hidden = dated;
    $("expenseDay").replaceChildren(el("option", { value: "", text: i18n.t("No date") }),
      ...M.tripDays(trip, placesOf(trip.id)).map((d) => el("option", { value: d, text: trip.start ? i18n.t("Day {n} · {date}", { n: M.dayIndex(trip, d), date: dayLabel(d) }) : dayLabel(d) })));
    const today = new Date().toISOString().slice(0, 10);
    const day = x ? x.day || "" : M.tripDays(trip, []).includes(today) ? today : "";
    $("expenseDay").value = day;
    $("expenseDayInput").value = day;
    $("expensePlace").replaceChildren(el("option", { value: "", text: i18n.t("None") }),
      ...placesOf(trip.id).slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => el("option", { value: p.id, text: p.name })));
    $("expensePlace").value = (x && x.place && placesOf(trip.id).some((p) => p.id === x.place)) ? x.place : "";
    // Who paid, once the trip has more than one person on it.
    const people = trip.members || [];
    $("expensePaidRow").hidden = people.length < 2;
    $("expensePaidBy").replaceChildren(el("option", { value: "", text: i18n.t("Not set") }),
      ...people.map((m) => el("option", { value: m.id, text: m.id === SET.get().me.id ? i18n.t("You") : m.name || i18n.t("Someone") })));
    $("expensePaidBy").value = x ? x.paidBy || "" : people.length > 1 ? SET.get().me.id : "";
    f.amount.value = x ? String(x.amount) : "";
    f.title.value = x ? x.title : "";
    f.note.value = x ? x.note || "" : "";
    $("expenseSheetTitle").textContent = x ? i18n.t("Edit expense") : i18n.t("Add an expense");
    $("expenseSave").textContent = x ? i18n.t("Save") : i18n.t("Add expense");
    $("expenseDelete").hidden = !x;
    if (x) armDelete($("expenseDelete"), i18n.t("Delete"), () => {
      closeSheet($("expenseSheet"));
      undoable(i18n.t("Deleted {title}.", { title: x.title }), () => { doc.expenses = doc.expenses.filter((e) => e !== x); });
    });
    lockForm(f, !mayEdit(trip));
    openSheet($("expenseSheet"), from);
  }
  // "12,50" and "1 200.5" are amounts too.
  function parseAmount(v) {
    let t = String(v).replace(/[\s\u00a0']/g, "");
    if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(",", ".");
    t = t.replace(/,/g, "");
    return /^\d+(\.\d+)?$/.test(t) ? +t : null;
  }
  $("expenseForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const amount = parseAmount(f.amount.value);
    if (amount == null) { f.amount.setAttribute("aria-invalid", "true"); f.amount.focus(); return; }
    const stamp = new Date().toISOString();
    const x = editingExpense || { id: M.newId(), trip: expenseTrip.id, createdAt: stamp };
    Object.assign(x, { amount, currency: f.currency.value, title: f.title.value, category: f.category.value,
      day: expenseTrip.start ? $("expenseDay").value : $("expenseDayInput").value, place: f.place.value, note: f.note.value, updatedAt: stamp });
    if (!$("expensePaidRow").hidden) x.paidBy = $("expensePaidBy").value;
    try { localStorage.setItem("tripboard.currency", x.currency); } catch (err) { /* private window */ }
    if (!editingExpense) { doc.expenses = doc.expenses || []; doc.expenses.push(x); }
    const closing = closeSheet($("expenseSheet"));
    save();
    await closing;
  });

  function group(trip, g, wx) {
    const isDay = !!g.day;
    const title = isDay ? (trip.start ? i18n.t("Day {n} · {date}", { n: M.dayIndex(trip, g.day), date: dayLabel(g.day) }) : dayLabel(g.day)) : g.title;
    const head = el("div.group-head", {},
      el("h2", { text: title }),
      isDay && wx && wx[g.day] ? wxChip(wx[g.day]) : null,
      el("span.count", { text: String(g.places.length) }),
      view.sort === "time" && mayEdit(trip) ? el("button.icon-btn.small", { type: "button", "aria-label": i18n.t("Add a place to {title}", { title: title }),
        onclick: (e) => openPlace(null, trip, { day: g.day || "" }, e.currentTarget) }, icon("plus")) : null);
    const box = el("section.group" + (g.dropOnly ? ".drop-only" : ""), {}, head);
    if (view.sort !== "distance") box.dataset.drop = g.id;
    if (isDay) {
      if (!g.slots.length) box.append(el("p.dim.slot-empty", { text: i18n.t("Free day") }));
      // Every slot is drawn, so a place can be dropped into an empty one;
      // the empty ones show only while dragging.
      const have = new Map(g.slots.map((s) => [s.id, s]));
      for (const [id, t] of M.SLOTS.concat([["any", i18n.t("Any time")]])) {
        const s = have.get(id);
        box.append(el("div.slot-box" + (s ? "" : ".drop-only"), { "data-slot": id }, el("h3.slot", { text: t }), cards(trip, s ? s.places : [], g)));
      }
    } else if (g.places.length) {
      box.append(cards(trip, g.places, g));
    } else {
      box.append(el("p.dim.slot-empty", { text: g.dropOnly ? i18n.t("Drop here") : i18n.t("Places without a day land here.") }));
    }
    return box;
  }

  // ---------- Drag and drop (mouse) ----------
  // Dropping a card on another group changes what that sort groups by: its
  // day (and time slot), category or importance. Distance has nothing to change.
  const canDrag = () => window.matchMedia("(pointer: fine)").matches && view.sort !== "distance" && mayEdit(findTrip(view.trip));
  const SLOT_TIME = { morning: "09:00", afternoon: "14:00", evening: "19:00" };
  const mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
  const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  function movePlace(p, groupId, slot) {
    const before = JSON.stringify([p.day, p.endDay, p.time, p.endTime, p.category, p.importance]);
    undoable(i18n.t("Moved {name}.", { name: p.name }), () => shift(p, groupId, slot));
    if (JSON.stringify([p.day, p.endDay, p.time, p.endTime, p.category, p.importance]) === before) $("toast").hidden = true;
  }
  function shift(p, groupId, slot) {
    if (view.sort === "category") p.category = groupId;
    else if (view.sort === "importance") p.importance = groupId;
    else if (view.sort === "time") {
      if (groupId !== p.day) delete p.order;
      if (groupId === "nodate") { delete p.day; delete p.endDay; delete p.time; delete p.endTime; }
      else {
        // A place over several days moves as a whole: it starts on the day it's dropped on.
        if (p.endDay) p.endDay = M.addDays(groupId, M.daySpan(p));
        p.day = groupId;
        if (slot === "any") { delete p.time; delete p.endTime; }
        else if (slot && (!p.time || M.slotOf(p) !== slot)) {
          const len = p.time && p.endTime ? mins(p.endTime) - mins(p.time) : 0;
          p.time = SLOT_TIME[slot];
          if (len > 0 && mins(p.time) + len < 24 * 60) p.endTime = hhmm(mins(p.time) + len); else delete p.endTime;
        }
      }
    }
    p.updatedAt = new Date().toISOString();
  }
  let dragging = null;
  function wireDrag(main) {
    main.addEventListener("dragstart", (e) => {
      const card = e.target.closest && e.target.closest(".card[draggable=true]");
      if (!card) return;
      dragging = card.dataset.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", card.querySelector(".card-name").textContent);
      requestAnimationFrame(() => { document.body.classList.add("dragging"); card.classList.add("lifted"); });
    });
    main.addEventListener("dragend", () => {
      dragging = null;
      document.body.classList.remove("dragging");
      main.querySelectorAll(".lifted, .drop-over").forEach((n) => n.classList.remove("lifted", "drop-over"));
    });
    const target = (e) => e.target.closest && (e.target.closest(".slot-box") || e.target.closest("[data-drop]"));
    main.addEventListener("dragover", (e) => {
      if (!dragging) return;
      const t = target(e);
      main.querySelectorAll(".drop-over").forEach((n) => { if (n !== t) n.classList.remove("drop-over"); });
      if (!t) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      t.classList.add("drop-over");
    });
    main.addEventListener("drop", (e) => {
      const t = dragging && target(e);
      if (!t) return;
      e.preventDefault();
      const p = doc.places.find((x) => x.id === dragging);
      const grp = t.closest("[data-drop]");
      if (p && grp) movePlace(p, grp.dataset.drop, t.dataset.slot || "");
    });
  }

  // 350 m, 1.2 km; in Hebrew 350 מ׳, 1.2 ק״מ.
  const boardDist = (km) => (km < 1
    ? new Intl.NumberFormat(i18n.lang, { style: "unit", unit: "meter", maximumFractionDigits: 0 }).format(Math.round(km * 1000))
    : new Intl.NumberFormat(i18n.lang, { style: "unit", unit: "kilometer", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(km));
  function cards(trip, list, g) {
    return el("ul.cards", {}, list.map((p) => {
      const meta = view.sort === "category" ? [] : [M.catName(cats(), trip, p.category)];
      if (view.sort !== "time" && p.day) meta.push(daysLabel(p));
      else if (p.endDay && g.day) meta.push(i18n.t("{n} of {total} days", { n: M.daySpan({ day: p.day, endDay: g.day }) + 1, total: M.daySpan(p) + 1 }));
      if (p.time) meta.push(timeLabel(p));
      const nFiles = sees(trip, "files") ? filesOn(p.id).length : 0;
      if (g.km && g.km.has(p.id)) meta.push(boardDist(g.km.get(p.id)));
      return el("li.card.imp-" + p.importance + (p.visited ? ".visited" : ""), { "data-id": p.id, draggable: canDrag() ? "true" : null },
        el("button.tick", { type: "button", disabled: !mayEdit(trip), "aria-pressed": String(!!p.visited), "aria-label": p.visited ? i18n.t("Been to {name}", { name: p.name }) : i18n.t("Mark as been to {name}", { name: p.name }),
          onclick: () => { p.visited = !p.visited; p.updatedAt = new Date().toISOString(); save(); } }, icon("check")),
        el("button.card-body", { type: "button", onclick: (e) => openPlace(p, trip, null, e.currentTarget) },
          el("span.card-name", { text: p.name }),
          el("span.card-meta", {}, el("span.imp", { text: M.IMPORTANCE_LABEL.get(p.importance) }), meta.length ? " · " + meta.join(" · ") : "",
            nFiles ? el("span.clip", { title: i18n.tn(nFiles, "1 file", "{n} files"), "aria-label": i18n.tn(nFiles, "1 file", "{n} files") }, icon("paperclip"), String(nFiles)) : null),
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
  // A sheet opens with the sheet itself in focus, never a field, so a
  // phone doesn't throw up its keyboard before you tap where to type.
  function openSheet(d, from) {
    opener = from || null;
    d.showModal();
    d.tabIndex = -1;
    d.focus();
    if (narrow() && d.classList.contains("page")) slideSheet(d, true);
    else (narrow() ? motion.rise(d) : motion.dialogIn(d, from && from.getBoundingClientRect()));
  }
  async function closeSheet(d) {
    if (!d.open) return;
    await (narrow() && d.classList.contains("page") ? slideSheet(d, false)
      : narrow() ? motion.sink(d) : motion.dialogOut(d, opener && opener.getBoundingClientRect()));
    d.close();
  }
  // A full-screen editor on a phone is a screen like the others: in from
  // the end edge with the small bounce, out the same way without it.
  function slideSheet(d, open) {
    if (!d.animate) return Promise.resolve();
    const off = "translateX(" + (i18n.dir === "rtl" ? -100 : 100) + "%)";
    const a = lessMotion() ? d.animate([{ opacity: open ? 0 : 1 }, { opacity: open ? 1 : 0 }], { duration: 120, fill: "forwards" })
      : open ? d.animate([{ transform: off }, { transform: "none" }], onSpring(TAB_PAGE))
      : d.animate([{ transform: "none" }, { transform: off }], { ...onSpring(PAGE_OUT), fill: "forwards" });
    return a.finished.then(() => a.cancel(), () => {});
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
      btn.textContent = i18n.t("Tap again to delete");
      setTimeout(() => { delete btn.dataset.armed; btn.textContent = label; }, 3000);
    };
  }

  // Trip sheet
  let editingTrip = null, pendingCover;
  function showCoverPreview(url) {
    const box = $("coverPreview");
    box.replaceChildren(url ? el("img", { src: url, alt: "" }) : el("span.dim", { text: i18n.t("No photo") }));
    $("coverRemove").hidden = !url;
  }
  async function openTrip(trip, from) {
    editingTrip = trip;
    pendingCover = undefined;
    const f = $("tripForm");
    f.reset();
    $("tripSheetTitle").textContent = trip ? i18n.t("Edit trip") : i18n.t("New trip");
    if (trip) {
      f.name.value = trip.name;
      f.start.value = trip.start || "";
      f.end.value = trip.end || "";
      f.destinations.value = trip.destinations.join(", ");
    }
    showCoverPreview(trip ? await coverUrl(trip) : null);
    $("tripDelete").hidden = !trip;
    $("tripFileRow").hidden = !trip;
    $("tripExport").onclick = () => trip && saveBackup([trip.id]);
    $("tripOfflineRow").hidden = !trip;
    $("tripImportLink").value = "";
    // New trip starts from a list, at the top; Edit trip imports into it, lower down.
    const listRow = $("tripImportRow");
    listRow.hidden = false;
    if (trip) $("tripOfflineRow").before(listRow); else f.querySelector(".page-bar").after(listRow);
    $("tripImportLabel").textContent = trip ? i18n.t("Import places from Google Maps") : i18n.t("Start from a Google Maps list");
    pendingList = null;
    paintList();
    if (trip) armDelete($("tripDelete"), i18n.t("Delete trip"), () => deleteTrip(trip));
    openSheet($("tripSheet"), from);
    paintOffline();
  }
  // Offline, in Edit trip: OpenFreeMap's map around the trip's places,
  // kept on this device (offline.js).
  const OFF = window.Tripboard.offline;
  function paintOffline() {
    const trip = editingTrip, box = $("offlineCard");
    if (!trip || !$("tripSheet").open) return;
    const st = OFF.status(trip.id);
    const points = OFF.pointsOf(placesOf(trip.id));
    const where = trip.destinations.length ? i18n.join(trip.destinations) : "";
    const mb = (n) => Math.max(1, Math.round(n / 1e6));
    const go = (force) => OFF.save(trip, OFF.pointsOf(placesOf(trip.id)), { style: (SET.get().providers.openfreemap || {}).style, force })
      .catch((e) => toast(e.message));
    const wifi = el("label.check", {}, el("input", { type: "checkbox", checked: OFF.wifiOnly, onchange: (e) => { OFF.wifiOnly = e.target.checked; } }),
      el("span", { text: i18n.t("Only on Wi-Fi") }));
    const kids = [];
    if (st && st.state === "saving") {
      kids.push(el("p.offline-title", { text: i18n.t("Saving for no signal…") }),
        el("progress", { max: st.total || 1, value: st.done, "aria-label": i18n.t("Saving for no signal…") }),
        el("p.dim", { text: st.waiting === "wifi" ? i18n.t("Waiting for Wi-Fi. It goes on by itself on Wi-Fi, or untick Only on Wi-Fi.")
          : st.waiting === "offline" ? i18n.t("Waiting for a connection. It goes on by itself once there is one.")
          : !st.total ? i18n.t("Getting ready…")
          : i18n.t("Map tiles {done} of {total} · about {mb} MB so far. You can keep using the app.", { done: fmtNum(st.done), total: fmtNum(st.total), mb: mb(st.bytes) }) }),
        el("div.offline-actions", {}, el("button.btn.quiet", { type: "button", text: i18n.t("Stop"), onclick: () => OFF.stop() })),
        st.waiting === "wifi" ? wifi : null);
    } else if (st && st.state === "saved") {
      const gone = OFF.missing(st.points, points);
      const at = new Date(st.at);
      const when = new Intl.DateTimeFormat(i18n.lang, at.toDateString() === new Date().toDateString() ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(at);
      kids.push(el("p.offline-title", { text: i18n.t("Saved for no signal") }),
        el("p.dim", { text: (where ? i18n.t("The map of {where} (zoomed in to street level), every place, cover and synced file.", { where })
          : i18n.t("The map around this trip's places (zoomed in to street level), every place, cover and synced file.")) + " "
          + i18n.t("{mb} MB on this device. Updated {when}.", { mb: mb(st.bytes), when }) }),
        gone ? el("p", { text: i18n.tn(gone, "1 place added since isn't on the saved map. Update now to add it.", "{n} places added since aren't on the saved map. Update now to add them.") }) : null,
        el("div.offline-actions", {}, el("button.btn", { type: "button", text: i18n.t("Update now"), onclick: () => go(true) }),
          el("button.btn.quiet", { type: "button", text: i18n.t("Remove"), onclick: () => OFF.remove(trip.id) })));
    } else {
      const partial = st && st.state === "partial";
      kids.push(el("p.offline-title", { text: partial ? i18n.t("Not finished") : i18n.t("Not saved for offline") }),
        el("p.dim", { text: !points.length ? i18n.t("Add places with a location first. The map is saved around them.")
          : partial ? (st.error ? st.error + " " : "") + i18n.t("{done} of {total} map files saved. Save for offline picks up where it stopped.", { done: fmtNum(st.saved || 0), total: fmtNum(st.total || 0) })
          : where ? i18n.t("Saves the map around this trip's places ({where}, about {mb} MB). Places, covers and synced files are already on this device, so it all works with no signal.", { where, mb: mb(OFF.estimate(points)) })
          : i18n.t("Saves the map around this trip's places (about {mb} MB). Places, covers and synced files are already on this device, so it all works with no signal.", { mb: mb(OFF.estimate(points)) }) }),
        el("div.offline-actions", {}, el("button.btn.primary", { type: "button", text: i18n.t("Save for offline"), disabled: !points.length, onclick: () => go(false) }),
          partial ? el("button.btn.quiet", { type: "button", text: i18n.t("Remove"), onclick: () => OFF.remove(trip.id) }) : null),
        wifi);
    }
    box.replaceChildren(...kids.filter(Boolean));
  }
  const fmtNum = (n) => new Intl.NumberFormat(i18n.lang).format(n);
  OFF.onChange(() => { paintOffline(); paintOfflineBadge(); });
  function paintOfflineBadge() {
    const st = view.trip && OFF.status(view.trip);
    $("offlineBadge").hidden = !(st && st.state === "saved") || view.mode === "share";
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
      $("coverPreview").replaceChildren(el("span.error", { text: i18n.t("That file couldn't be read as a photo.") }));
    }
  });
  $("coverRemove").addEventListener("click", () => { pendingCover = null; showCoverPreview(null); $("coverFile").value = ""; });
  $("tripForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.name.value.trim()) { f.name.focus(); f.name.setAttribute("aria-invalid", "true"); return; }
    f.name.removeAttribute("aria-invalid");
    const stamp = new Date().toISOString();
    const trip = editingTrip || M.ownTrip({ id: M.newId(), createdAt: stamp }, SET.get().me);
    Object.assign(trip, { name: f.name.value, start: f.start.value, end: f.end.value, destinations: f.destinations.value, updatedAt: stamp });
    if (pendingCover !== undefined) {
      if (covers.get(trip.id)) URL.revokeObjectURL(covers.get(trip.id));
      covers.delete(trip.id);
      if (pendingCover) { await store.setCover(trip.id, pendingCover); trip.cover = true; }
      else { await store.dropCover(trip.id); trip.cover = false; }
      trip.coverAt = stamp;
    }
    if (!editingTrip) doc.trips.push(trip);
    const closing = closeSheet($("tripSheet"));
    save();
    if (!editingTrip) location.hash = "#/trip/" + trip.id;
    await closing;
    const list = !editingTrip && pendingList;
    pendingList = null;
    if (list) await importList(doc.trips.find((t) => t.id === trip.id) || trip, list.places);
  });
  async function deleteTrip(trip) {
    const blob = trip.cover ? await store.cover(trip.id) : null;
    if (blob) store.dropCover(trip.id);
    closeSheet($("tripSheet"));
    location.hash = "#/";
    undoable(i18n.t("Deleted {name}.", { name: trip.name }), () => { doc.trips = doc.trips.filter((t) => t !== trip); },
      async () => { if (blob) await store.setCover(trip.id, blob); });
  }

  // Place sheet
  let editingPlace = null, placeTrip = null, importance = "want", loc, categoryTouched = false;
  // The place's location in the sheet: undefined unchanged, null cleared,
  // or { lat, lng, address } found by name.
  function paintWhere() {
    const p = loc === undefined ? editingPlace : loc;
    const has = p && p.lat != null;
    const expired = !has && loc === undefined && editingPlace && editingPlace.placeId;
    $("placeWhere").textContent = expired ? i18n.t("Google's location expired after 30 days. It comes back when Google answers again (Settings → Services).") : !has ? i18n.t("Not set") : p.address || (p.placeId || p.source === "google" ? i18n.t("On Google Maps") + " · " : "") + p.lat.toFixed(5) + ", " + p.lng.toFixed(5);
    $("placeOpenIn").replaceChildren(...(has || (editingPlace && editingPlace.name) ? [openIn({ name: $("placeForm").name.value || (editingPlace && editingPlace.name), ...(has ? p : {}) })] : []));
    $("placeWhere").classList.toggle("dim", !has);
    $("placeClear").hidden = !has;
    $("placePin").textContent = has ? i18n.t("Move on map") : i18n.t("Pin on map");
  }
  $("categorySelect").addEventListener("change", () => { categoryTouched = true; });
  $("placeClear").addEventListener("click", () => { loc = null; $("placeResults").replaceChildren(); $("placeFindNote").textContent = ""; paintWhere(); });
  let searching = 0;
  $("placeFind").addEventListener("click", async () => {
    const f = $("placeForm");
    const q = f.name.value.trim();
    const note = $("placeFindNote"), out = $("placeResults");
    if (!q) { note.textContent = i18n.t("Type the place's name first."); f.name.focus(); return; }
    const me = ++searching;
    note.textContent = i18n.t("Searching…");
    out.replaceChildren();
    const near = placesOf(placeTrip.id).filter((p) => p.lat != null);
    const dest = placeTrip.destinations[0];
    const prov = SET.get().providers;
    const opts = { chain: SET.chain("search"), keys: { google: prov.google.key, maptiler: prov.maptiler.key }, near };
    try {
      let got = await PL.search(q, opts);
      // Nothing for the bare name: try it with the trip's first destination.
      if (!got.results.length && dest && !q.toLowerCase().includes(dest.toLowerCase())) got = await PL.search(q + ", " + dest, opts);
      if (me !== searching) return;
      const list = got.results;
      const via = SET.PROVIDERS[got.by] ? SET.PROVIDERS[got.by].name : got.by;
      const fell = got.skipped.length ? " " + i18n.t("({why} Used {via}.)", { why: got.skipped.map((x) => x.reason).join(" "), via }) : "";
      note.textContent = (list.length ? i18n.t("Pick the right one, from {via}:", { via }) : i18n.t("Nothing found on {via}. Try another spelling, or pin it on the map.", { via })) + fell;
      out.replaceChildren(...list.map((r) => el("li", {}, el("button", { type: "button", onclick: () => {
        loc = { lat: r.lat, lng: r.lng, address: r.address, placeId: r.placeId, source: r.source };
        if (r.category && !categoryTouched && !editingPlace && cats().some(([id]) => id === r.category)) f.category.value = r.category;
        out.replaceChildren();
        note.textContent = i18n.t("From {via}.", { via: via });
        paintWhere();
      } }, el("strong", { text: r.name }), el("span.dim", { text: r.address })))));
    } catch (e) {
      if (me !== searching) return;
      window.Keel.errlog.note("search", String(e));
      note.textContent = navigator.onLine === false ? i18n.t("Searching needs a connection.") : e.message || i18n.t("The search didn't work. Try again in a moment.");
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
  function openPlace(place, trip, preset, from) {
    editingPlace = place;
    placeTrip = trip;
    const f = $("placeForm");
    f.reset();
    const p = place || { category: cats()[0][0], importance: "want", ...(preset || {}) };
    $("placeSheetTitle").textContent = place ? i18n.t("Edit place") : i18n.t("Add a place");
    $("placeSave").textContent = place ? i18n.t("Save") : i18n.t("Add place");
    f.name.value = p.name || "";
    // Your categories, and the place's own if it isn't one of them (a shared trip's).
    const list = cats();
    if (!list.some(([id]) => id === p.category)) list.push([p.category, M.catName(list, trip, p.category)]);
    $("categorySelect").replaceChildren(...list.map(([id, label]) => el("option", { value: id, text: label })));
    f.category.value = p.category;
    importance = p.importance;
    paintImportance();
    // A dated trip offers its days; one without dates takes any date.
    const days = M.tripDays(trip, placesOf(trip.id));
    const dated = !!trip.start;
    $("daySelect").hidden = !dated;
    $("dayInput").hidden = dated;
    $("daySelect").replaceChildren(el("option", { value: "", text: i18n.t("No date") }),
      ...days.map((d) => el("option", { value: d, text: trip.start ? i18n.t("Day {n} · {date}", { n: M.dayIndex(trip, d), date: dayLabel(d) }) : dayLabel(d) })));
    $("daySelect").value = p.day || "";
    $("dayInput").value = p.day || "";
    paintUntil(days, p.endDay || "");
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
    // Adding is a sheet from below over the trip; editing a place is a page.
    $("placeSheet").classList.toggle("page", !!place);
    paintPlaceFiles();
    lockForm(f, !mayEdit(trip));
    if (!mayEdit(trip)) $("placeSheetTitle").textContent = p.name;
    // One tap: the toast's Undo brings it back.
    if (place) $("placeDelete").onclick = () => {
      closeSheet($("placeSheet"));
      undoable(i18n.t("Deleted {name}.", { name: place.name }), () => { doc.places = doc.places.filter((x) => x !== place); });
    };
    openSheet($("placeSheet"), from);
  }
  // "Until": for a place that lasts several days, the last of them. Offered
  // once there's a day; the days after it, or any later date.
  function paintUntil(days, keep) {
    const dated = !!placeTrip.start;
    const day = dated ? $("daySelect").value : $("dayInput").value;
    $("untilField").hidden = !day;
    $("untilSelect").hidden = !dated;
    $("untilInput").hidden = dated;
    $("untilSelect").replaceChildren(el("option", { value: "", text: i18n.t("Just that day") }),
      ...(days || M.tripDays(placeTrip, placesOf(placeTrip.id))).filter((d) => d > day).map((d) => el("option", { value: d,
        text: i18n.t("Day {n} · {date}", { n: M.dayIndex(placeTrip, d), date: dayLabel(d) }) })));
    $("untilSelect").value = keep > day ? keep : "";
    $("untilInput").min = day ? M.addDays(day, 1) : "";
    $("untilInput").value = keep > day ? keep : "";
  }
  async function commitPlace() {
    const f = $("placeForm");
    f.name.removeAttribute("aria-invalid");
    const stamp = new Date().toISOString();
    const day = placeTrip.start ? $("daySelect").value : $("dayInput").value;
    const until = placeTrip.start ? $("untilSelect").value : $("untilInput").value;
    const p = editingPlace || { id: M.newId(), trip: placeTrip.id, createdAt: stamp };
    if (day && until > day) p.endDay = until; else delete p.endDay;
    if (day !== p.day) delete p.order;
    Object.assign(p, { name: f.name.value, category: f.category.value, importance, day, time: f.time.value, endTime: f.endTime.value, note: f.note.value, updatedAt: stamp });
    if (loc === null) { for (const k of ["lat", "lng", "address", "placeId", "geoAt"]) delete p[k]; }
    else if (loc) {
      for (const k of ["address", "placeId", "geoAt"]) delete p[k];
      Object.assign(p, { lat: loc.lat, lng: loc.lng });
      // Google's terms: its place id kept for good, its location for 30 days
      // (geoAt says when), its address not at all.
      if (loc.source === "google") Object.assign(p, { placeId: loc.placeId, geoAt: new Date().toISOString().slice(0, 10) });
      else if (loc.address) p.address = loc.address;
    }
    if (!editingPlace) doc.places.push(p);
    const closing = closeSheet($("placeSheet"));
    save();
    await closing;
    return p;
  }
  for (const id of ["daySelect", "dayInput"]) $(id).addEventListener("change", () => paintUntil(null, placeTrip.start ? $("untilSelect").value : $("untilInput").value));
  $("placeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.name.value.trim()) { f.name.focus(); f.name.setAttribute("aria-invalid", "true"); return; }
    await commitPlace();
  });

  // ---------- Sharing ----------
  const SHARE = window.Tripboard.share;
  // A trip's share settings: what everyone gets, and anyone set apart.
  const SECTION_LABEL = () => [["expenses", i18n.t("Expenses")], ["files", i18n.t("Files")]];
  function personName(trip, m) {
    if (m.id === meId()) return i18n.t("You");
    return m.name || i18n.t("Someone");
  }
  function accessLabel(a) {
    const parts = [a.role === "owner" ? i18n.t("Owner") : a.role === "viewer" ? i18n.t("Can view") : i18n.t("Can edit")];
    const hidden = SECTION_LABEL().filter(([k]) => a.hide.includes(k)).map(([, l]) => l);
    if (hidden.length) parts.push(i18n.t("doesn't see {what}", { what: i18n.join(hidden) }));
    return parts.join(" · ");
  }
  function changeShare(trip, fn) {
    M.ownTrip(trip, SET.get().me);
    fn(trip);
    trip.updatedAt = new Date().toISOString();
    save();
  }
  function roleSeg(cur, options, onpick, locked) {
    return el("div.seg", { role: "radiogroup" }, options.map(([id, label]) => el("button", { type: "button", role: "radio", disabled: locked,
      "aria-checked": String(cur === id), text: label, onclick: () => onpick(id) })));
  }
  function sectionChips(hide, ontoggle, locked) {
    return el("div.chips-row", {}, SECTION_LABEL().map(([k, label]) => el("button.chip", { type: "button", disabled: locked,
      "aria-pressed": String(!hide.includes(k)), onclick: () => ontoggle(k) }, icon(hide.includes(k) ? "eyeOff" : "eye"), label)));
  }
  function renderShare(main, trip) {
    $("title").textContent = i18n.t("Sharing");
    main.classList.add("share-page");
    const manage = M.can(trip, meId(), "manage");
    const d = trip.share || { role: "editor", hide: [] };
    const toggle = (list, k) => (list.includes(k) ? list.filter((x) => x !== k) : list.concat(k));
    main.append(el("section.panel", {},
      el("h2", { text: i18n.t("Everyone") }),
      el("p.hint.dim", { text: i18n.t("What people on this trip get, unless you set something else for them below.") }),
      el("fieldset.field", {}, el("legend", { text: i18n.t("Can") }),
        roleSeg(d.role, [["editor", i18n.t("Edit")], ["viewer", i18n.t("Only view")]], (role) => changeShare(trip, (t) => { t.share = { ...d, role }; }), !manage)),
      el("fieldset.field", {}, el("legend", { text: i18n.t("Sees") }),
        el("p.hint.dim", { text: i18n.t("The plan and the map are always shown.") }),
        sectionChips(d.hide, (k) => changeShare(trip, (t) => { t.share = { ...d, hide: toggle(d.hide, k) }; }), !manage))));

    const people = (trip.members && trip.members.length ? trip.members : [{ id: meId(), name: SET.get().me.name, role: "owner" }])
      .slice().sort((a, b) => (b.role === "owner") - (a.role === "owner"));
    const rows = people.map((m) => {
      const a = M.access(trip.members ? trip : { ...trip, members: [] }, m.id);
      const head = [el("span.avatar", { "aria-hidden": "true", text: (personName(trip, m)[0] || "?").toUpperCase() }),
        el("span.srow-text", {}, el("span.srow-title", { text: personName(trip, m) + (m.id === meId() && m.name ? " (" + m.name + ")" : "") }),
          el("span.srow-status", { text: accessLabel(a) + (a.role !== "owner" && !a.own.role && !a.own.hide ? " · " + i18n.t("as everyone") : "") }))];
      if (a.role === "owner" || !manage) return el("li.person", {}, el("div.person-head", {}, head));
      const set = (fn) => { view.sharePerson = m.id; changeShare(trip, (t) => fn(t.members.find((x) => x.id === m.id))); };
      return el("li.person", {}, el("details", { open: view.sharePerson === m.id, ontoggle: (e) => { if (e.target.open) view.sharePerson = m.id; } },
        el("summary.person-head", {}, head, el("span.srow-chev", { "aria-hidden": "true", text: "›" })),
        el("div.person-body", {},
          el("fieldset.field", {}, el("legend", { text: i18n.t("Can") }),
            roleSeg(m.role || "", [["", i18n.t("As everyone")], ["editor", i18n.t("Edit")], ["viewer", i18n.t("Only view")]], (role) => set((x) => { if (role) x.role = role; else delete x.role; }))),
          el("fieldset.field", {}, el("legend", { text: i18n.t("Sees") }),
            sectionChips(a.hide, (k) => set((x) => { x.hide = toggle(a.hide, k); })),
            a.own.hide ? el("div", {}, el("button.btn.quiet", { type: "button", text: i18n.t("Same as everyone"), onclick: () => set((x) => { delete x.hide; }) })) : null),
          el("div", {}, removeButton(trip, m)))));
    });
    main.append(el("section.panel", {},
      el("div.group-head", {}, el("h2", { text: i18n.t("People") }), el("span.count", { text: String(people.length) })),
      el("ul.people", {}, rows),
      people.length < 2 ? el("p.hint.dim", { text: i18n.t("No one else is on this trip yet. Invite people with a link.") }) : null,
      !manage ? el("p.hint.dim", { text: i18n.t("Only the trip's owner can change these.") }) : null));

    const shared = SHARE.shared(trip.id);
    if (!SHARE.enabled()) {
      main.prepend(el("section.panel.share-note", {}, el("p", { text: i18n.t("Inviting people needs the sharing server, which isn't set up yet. You can choose the settings now; they apply once it is.") })));
    } else if (manage) {
      main.prepend(invitePanel(trip, shared));
    }
    if (shared) {
      const own = shared.role === "owner";
      const btn = el("button.btn.danger", { type: "button" });
      armConfirm(btn, own ? i18n.t("Stop sharing") : i18n.t("Leave this trip"), async () => {
        try { if (own) await SHARE.stop(trip.id); else await SHARE.leave(trip.id); }
        catch (e) { toast(e.message); return; }
        toast(own ? i18n.t("{name} isn't shared any more. Your copy stays.", { name: trip.name }) : i18n.t("You left {name}. Your copy stays here.", { name: trip.name }));
        render();
      });
      main.append(el("section.panel", {}, el("div", {}, btn),
        el("p.hint.dim", { text: own ? i18n.t("It stops syncing with everyone. Each person keeps their copy as their own.") : i18n.t("You keep your copy as your own trip. It stops getting their changes.") })));
    }
    main.append(el("section.panel.share-note", {},
      el("h2", { text: i18n.t("Who can see what") }),
      shared ? el("p", { text: i18n.t("The sharing server checks these for everyone else: someone who can only view can't change the trip, and a section someone doesn't see never reaches their device.") }) : null,
      el("p", { text: i18n.t("Your own sync repo keeps the whole trip, and each person's devices keep what they see.") })));
  }

  // Removing someone: they leave the trip's people, and the server ends
  // their key at the next sync.
  function removeButton(trip, m) {
    if (!SHARE.shared(trip.id)) return null;
    const btn = el("button.btn.quiet.danger-text", { type: "button" });
    armConfirm(btn, i18n.t("Remove from trip"), () => {
      view.sharePerson = null;
      changeShare(trip, (t) => { t.members = t.members.filter((x) => x.id !== m.id); });
      toast(i18n.t("Removed {name}.", { name: m.name || i18n.t("Someone") }));
    });
    return btn;
  }
  // A step that can't be taken back asks for a second tap.
  function armConfirm(btn, label, act) {
    btn.textContent = label;
    btn.onclick = () => {
      if (btn.dataset.armed) { delete btn.dataset.armed; act(); return; }
      btn.dataset.armed = "1";
      btn.textContent = i18n.t("Tap again to confirm");
      setTimeout(() => { delete btn.dataset.armed; btn.textContent = label; }, 3000);
    };
  }

  const invites = {};
  function invitePanel(trip, shared) {
    const box = el("section.panel");
    const inv = invites[trip.id];
    const make = async (btn) => {
      btn.disabled = true;
      try { invites[trip.id] = await SHARE.invite(trip); }
      catch (e) { toast(e.message); }
      render();
    };
    box.append(el("h2", { text: i18n.t("Invite people") }));
    if (!inv) {
      box.append(el("p.hint.dim", { text: shared ? i18n.t("Make a link to add more people. A new link stops the old one.") : i18n.t("Make a link and send it to the people you travel with. The trip goes to the sharing server, and they join as Everyone below.") }),
        el("div", {}, el("button.btn.primary", { type: "button", text: shared ? i18n.t("New invite link") : i18n.t("Make an invite link"), onclick: (e) => make(e.currentTarget) })));
      return box;
    }
    const field = el("input.link-field", { readOnly: true, value: inv.link, "aria-label": i18n.t("Invite link"), onfocus: (e) => e.target.select() });
    const copy = async () => {
      try { await navigator.clipboard.writeText(inv.link); toast(i18n.t("Link copied.")); } catch (e) { field.select(); }
    };
    box.append(field,
      el("div.loc-actions", {},
        navigator.share ? el("button.btn.primary", { type: "button", text: i18n.t("Send…"), onclick: () => navigator.share({ title: trip.name, url: inv.link }).catch(() => {}) }) : null,
        el("button.btn", { type: "button", text: i18n.t("Copy link"), onclick: copy }),
        el("button.btn.quiet", { type: "button", text: i18n.t("Stop this link"), onclick: async () => {
          try { await SHARE.stopLink(trip.id); delete invites[trip.id]; toast(i18n.t("The link doesn't work any more.")); render(); } catch (e) { toast(e.message); } } })),
      el("p.hint.dim", { text: i18n.t("Anyone with the link can join until {date}. Send it only to people you want on the trip.", { date: i18n.date(new Date(inv.expires)) }) }));
    return box;
  }

  // ---------- Joining from a link ----------
  // host: the server the link names, when it isn't Tripboard's.
  function renderJoin(main, tripId, code, host) {
    $("title").textContent = i18n.t("Join a trip");
    if (findTrip(tripId) && SHARE.shared(tripId)) { location.replace("#/trip/" + tripId); return; }
    if (!SHARE.enabled()) { main.append(el("div.empty", {}, el("p", { text: i18n.t("Sharing isn't set up in this copy of the app.") }))); return; }
    const other = host ? SHARE.origin(host) : null;
    if (host && !other) { main.append(el("div.empty", {}, el("p", { text: i18n.t("This invite link is broken.") }))); return; }
    if (other && other !== SHARE.DEFAULT && !SHARE.allowed(other)) {
      main.append(el("section.panel", {}, el("h2", { text: i18n.t("This trip is on another server") }),
        el("p", { text: i18n.t("The invite link you opened is for a trip on a server someone runs themselves:") }),
        el("p", {}, el("strong", { text: SHARE.host(other) })),
        el("p.hint.dim", { text: i18n.t("Joining lets Tripboard talk to that server for this trip. Whoever runs it can read the trip. Tripboard opens again once to allow it.") }),
        el("button.btn.primary", { type: "button", text: i18n.t("Join through it"), onclick: async () => {
          if (!SHARE.canUseOwn()) { toast(i18n.t("Trips on other servers work in the web app for now.")); return; }
          await SHARE.allowJoin(other);
          location.reload();
        } }), " ",
        el("button.btn.quiet", { type: "button", text: i18n.t("Cancel"), onclick: async () => { await SHARE.allowJoin(null); location.replace("#/"); } })));
      return;
    }
    const me = SET.get().me;
    const name = el("input", { value: me.name, autocomplete: "name", maxlength: "60", placeholder: i18n.t("Your name") });
    const go = el("button.btn.primary", { type: "button", text: i18n.t("Join"), onclick: async () => {
      go.disabled = true;
      if (name.value.trim() !== me.name) SET.setMe({ name: name.value });
      try { await SHARE.join(tripId, code, host); location.replace("#/trip/" + tripId); }
      catch (e) { go.disabled = false; toast(e.message); }
    } });
    main.append(el("section.panel", {},
      el("p", { text: i18n.t("Someone invited you to a trip. Joining brings it to this device, and the people on it see your name and what you add.") }),
      other && other !== SHARE.DEFAULT ? el("p.hint.dim", { text: i18n.t("The trip is on {host}, a server someone runs themselves. Whoever runs it can read the trip.", { host: SHARE.host(other) }) }) : null,
      el("label.field", {}, i18n.t("Your name"), name),
      el("div", {}, go)));
  }


  // ---------- The map ----------
  const TM = window.Tripboard.map;
  const SET = window.Tripboard.settings;
  const PL = window.Tripboard.places;
  let mapFailed = null;
  // The map's places: the importance filter, and the day picked on the map.
  function shownPlaces(trip) {
    let all = placesOf(trip.id);
    if (view.mapDay) all = all.filter((p) => M.onDay(p, view.mapDay));
    return view.only.length ? all.filter((p) => view.only.includes(p.importance)) : all;
  }
  function paintDays(trip) {
    const days = M.tripDays(trip, placesOf(trip.id));
    if (view.mapDay && !days.includes(view.mapDay)) view.mapDay = null;
    const bar = $("mapDays");
    bar.hidden = !days.length;
    const pick = (day) => { view.mapDay = day; view.sel = null; view.fitDay = true; render(); };
    bar.replaceChildren(
      el("button.chip", { type: "button", "aria-pressed": String(!view.mapDay), text: i18n.t("All"), onclick: () => pick(null) }),
      ...days.map((d) => el("button.chip", { type: "button", "aria-pressed": String(view.mapDay === d),
        text: trip.start ? i18n.t("Day {dayIndex}", { dayIndex: M.dayIndex(trip, d) }) : dayLabel(d), title: dayLabel(d), onclick: () => pick(d) })));
    const on = bar.querySelector('[aria-pressed="true"]');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  async function showMap(trip) {
    const panel = $("mapPanel");
    if (mapFailed) { mapMessage(mapFailed); return; }
    const first = !TM.ready;
    let got;
    try { got = await TM.open($("map"), { chain: SET.chain("map"), providers: SET.get().providers }); }
    catch (e) {
      window.Keel.errlog.note("map", String(e));
      mapFailed = navigator.onLine === false ? i18n.t("The map needs a connection the first time it opens.")
        : i18n.t("The map couldn't load. {why}", { why: e.skipped && e.skipped.length ? e.message : i18n.t("Check the connection and try again.") });
      mapMessage(mapFailed);
      return;
    }
    const note = $("mapNote");
    note.hidden = !(got && got.skipped.length);
    if (got && got.skipped.length) note.textContent = i18n.t("Showing {name}: {join}", { name: SET.PROVIDERS[got.by].name, join: got.skipped.map((x) => x.reason).join(" ") });
    if (view.mode !== "map" || view.trip !== trip.id) return;
    paintDays(trip);
    const list = shownPlaces(trip);
    const route = view.mapDay ? M.dayRoute(list, view.mapDay) : [];
    TM.places(list, view.sel, new Map(route.map((p, i) => [p.id, i + 1])));
    TM.route(route);
    if (first || view.fitDay || $("map").dataset.trip !== trip.id) { TM.fit(list.length ? list : placesOf(trip.id)); $("map").dataset.trip = trip.id; view.fitDay = false; }
    paintPanel(trip);
    panel.hidden = !panel.childNodes.length;
  }
  function mapMessage(text) {
    $("mapPanel").replaceChildren(el("p", { text }), el("button.btn", { type: "button", text: i18n.t("Try again"), onclick: () => { mapFailed = null; render(); } }));
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
      panel.replaceChildren(el("p.pick", { text: p ? i18n.t("Tap the map where {name} is.", { name: p.name }) : i18n.t("Tap the map where it is.") }),
        el("button.btn", { type: "button", text: i18n.t("Cancel"), onclick: () => { view.pick = null; render(); } }));
      return;
    }
    const sel = view.sel && all.find((x) => x.id === view.sel);
    if (sel) {
      const meta = [M.IMPORTANCE_LABEL.get(sel.importance), M.catName(cats(), findTrip(view.trip), sel.category)];
      if (sel.day) meta.push(daysLabel(sel));
      if (sel.time) meta.push(timeLabel(sel));
      panel.replaceChildren(el("div.sel", {},
        el("strong", { text: sel.name }), el("span.dim", { text: meta.join(" · ") }),
        sel.address ? el("span.dim.addr", { text: sel.address }) : null),
        sees(trip, "files") && filesOn(sel.id).length ? el("ul.attached", {}, fileButtons(filesOn(sel.id))) : null,
        el("div.loc-actions", {},
          el("button.btn", { type: "button", text: mayEdit(trip) ? i18n.t("Edit") : i18n.t("Details"), onclick: (e) => openPlace(sel, trip, null, e.currentTarget) }),
          mayEdit(trip) ? el("button.btn.quiet", { type: "button", text: i18n.t("Move pin"), onclick: () => { view.pick = sel.id; view.sel = null; render(); } }) : null),
        openIn(sel));
      return;
    }
    const nowhere = shownPlaces(trip).filter((p) => p.lat == null);
    if (!nowhere.length || !mayEdit(trip)) { panel.replaceChildren(); return; }
    panel.replaceChildren(
      el("p.dim", { text: i18n.tn(nowhere.length, "1 place has no location yet. Pick one, then tap the map.", "{n} places have no location yet. Pick one, then tap the map.") }),
      el("ul.unplaced", {}, nowhere.map((p) => el("li", {}, el("button.chip.imp-" + p.importance, { type: "button", "aria-pressed": "true", text: p.name,
        onclick: () => { view.pick = p.id; render(); } })))));
  }

  // Links that open a place in another maps app: Google Maps by its id or
  // location, Apple Maps, and Waze (which needs a location).
  function openIn(p) {
    const at = p.lat != null ? p.lat.toFixed(6) + "," + p.lng.toFixed(6) : "";
    const name = encodeURIComponent(p.name || "");
    const g = "https://www.google.com/maps/search/?api=1&query=" + (at && !p.placeId ? at : name) + (p.placeId ? "&query_place_id=" + encodeURIComponent(p.placeId) : "");
    const a = "https://maps.apple.com/?q=" + name + (at ? "&ll=" + at : "");
    const links = [["Google Maps", g], ["Apple Maps", a]];
    if (at) links.push(["Waze", "https://waze.com/ul?ll=" + at + "&navigate=yes"]);
    return el("p.open-in", {}, el("span.dim", { text: i18n.t("Open in ") }),
      links.map(([label, href], i) => [i ? el("span.dim", { text: " · " }) : null, el("a", { href, target: "_blank", rel: "noopener noreferrer", text: label })]));
  }

  // ---------- Google's 30-day locations ----------
  // A location from Google is kept 30 days (its terms). Past that it's
  // fetched again by its place id, or dropped when Google can't answer;
  // a dropped one comes back the next time Google can. Offline, nothing
  // changes until there's a connection.
  let refreshing = false;
  async function refreshGoogle() {
    if (refreshing || navigator.onLine === false) return;
    const due = M.staleGoogle(doc.places, today()).slice(0, 50);
    if (!due.length) return;
    refreshing = true;
    const key = SET.ready("google") ? SET.get().providers.google.key : "";
    let changed = 0;
    for (const p of due) {
      try {
        if (!key) throw new Error("no key");
        const at = await PL.googleLocation(p.placeId, { key });
        Object.assign(p, { lat: at.lat, lng: at.lng, geoAt: today() });
        changed++;
      } catch (e) {
        if (p.lat != null) { delete p.lat; delete p.lng; delete p.geoAt; changed++; }
      }
    }
    refreshing = false;
    if (changed) save();
  }
  SET.onChange(() => setTimeout(refreshGoogle, 500));
  window.addEventListener("online", () => refreshGoogle());

  // ---------- Backup files ----------
  const toDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  function fromDataUrl(url) {
    const [head, b64] = String(url).split(",");
    const type = (/^data:([^;]+)/.exec(head) || [])[1] || "image/jpeg";
    const bin = atob(b64 || "");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }
  const fileName = (s) => (s.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "trips");
  // A backup: the trips with their covers and files, as data addresses.
  async function backupData(tripIds) {
    const data = M.backupOf(doc, tripIds);
    for (const t of data.trips) {
      const blob = t.cover ? await store.cover(t.id) : null;
      if (blob) data.covers[t.id] = await toDataUrl(blob);
    }
    for (const f of data.files) {
      const blob = await store.file(f.id);
      if (blob) data.blobs[f.id] = await toDataUrl(blob.type ? blob : new Blob([blob], { type: f.type }));
    }
    return data;
  }
  async function saveBackup(tripIds) {
    const data = await backupData(tripIds);
    const name = (data.trips.length === 1 ? fileName(data.trips[0].name) : "tripboard") + "-" + today() + ".json";
    const a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" })), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(i18n.t("Saved {name}.", { name: name }));
  }
  async function restoreBackup(file) {
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (e) { toast(i18n.t("That file isn't a Tripboard backup.")); return; }
    await restoreData(data);
  }
  // Adds the backup's trips here, and replaces a trip that's already here;
  // Undo takes it back.
  async function restoreData(data) {
    let r;
    try { r = M.mergeBackup(doc, data); }
    catch (e) { toast(e.message); return false; }
    for (const id of r.ids) {
      const url = data.covers && data.covers[id];
      if (url) { await store.setCover(id, fromDataUrl(url)); if (covers.get(id)) URL.revokeObjectURL(covers.get(id)); covers.delete(id); }
      const t = r.doc.trips.find((x) => x.id === id);
      if (t && t.cover) t.coverAt = new Date().toISOString();
    }
    for (const f of r.doc.files || []) {
      const url = data.blobs && data.blobs[f.id];
      if (url && r.ids.includes(f.trip)) { await store.setFile(f.id, fromDataUrl(url)); haveFiles.add(f.id); }
    }
    const n = r.added + r.replaced;
    undoable((r.replaced ? i18n.tn(n, "Restored 1 trip ({replaced} replaced).", "Restored {n} trips ({replaced} replaced).", { replaced: r.replaced }) : i18n.tn(n, "Restored 1 trip.", "Restored {n} trips.")), () => { doc = r.doc; });
    return true;
  }

  // ---------- Settings ----------
  const STEPS = {
    google: [
      [i18n.t("Make a project in Google Cloud and turn on billing. Google asks for it even inside the free monthly allowance."), "https://console.cloud.google.com/projectcreate"],
      [i18n.t("Turn on Places API (New), for Find by name."), "https://console.cloud.google.com/apis/library/places.googleapis.com"],
      [i18n.t("Turn on Map Tiles API, for Google's map."), "https://console.cloud.google.com/apis/library/tile.googleapis.com"],
      [i18n.t("Create an API key. Restrict it to those two APIs, and to this site: {site}", { site: location.origin + "/*" }), "https://console.cloud.google.com/apis/credentials"],
      [i18n.t("Set a budget alert, and a daily cap under each API's Quotas, so a leaked key can't run up a bill."), "https://console.cloud.google.com/billing/budgets"],
      [i18n.t("Paste the key into Key, above, and press Test.")],
    ],
    maptiler: [
      [i18n.t("Sign up for a free MapTiler account."), "https://cloud.maptiler.com/auth/widget?mode=register"],
      [i18n.t("Copy a key from API keys, and restrict it to this site: {site}", { site: location.origin }), "https://cloud.maptiler.com/account/keys/"],
      [i18n.t("Paste the key into Key, above, and press Test.")],
    ],
  };
  const SERVICES = [["map", i18n.t("Map")], ["search", i18n.t("Find by name")]];

  const P_ICON = { openfreemap: "layers", osm: "globe", google: "key", maptiler: "mountain" };
  const S_ICON = { map: "map", search: "search" };
  const svcName = (svc) => SERVICES.find(([s]) => s === svc)[1];

  // A line under each row: what it's set to, or what needs you.
  function serviceStatus(svc, cfg) {
    const main = cfg[svc].main, fb = cfg[svc].fallback, name = (id) => SET.PROVIDERS[id].name;
    if (!SET.ready(main)) return { text: name(main) + " needs a key" + (fb ? ", so " + name(fb) + " is used" : ""), tone: "warn" };
    return { text: name(main) + (fb ? ", then " + name(fb) : "") };
  }
  function providerStatus(id) {
    const P = SET.PROVIDERS[id];
    if (!P.key) return { text: i18n.t("Free, no key") };
    return SET.ready(id) ? { text: i18n.t("Key set") } : { text: i18n.t("Needs a key") };
  }

  function srow(href, ico, title, status) {
    return el("a.srow", { href },
      el("span.srow-ic", {}, icon(ico)),
      el("span.srow-text", {}, el("span.srow-title", { text: title }), status ? el("span.srow-status", { text: status.text, "data-tone": status.tone || "" }) : null),
      el("span.srow-chev", { "aria-hidden": "true", text: "›" }));
  }
  const sgroup = (label, rows) => el("section.sgroup", {}, el("h2.sgroup-label", { text: label }), el("div.sgroup-card", {}, rows));

  // Everything search can find: each page, and what's on it.
  function settingsIndex() {
    const out = [
      ...(driveOn() ? [{ ico: "cloud", title: i18n.t("Google Drive"), where: i18n.t("Settings"), href: "#/settings/drive", words: "drive google backup backups restore automatic cloud copy" }] : []),
      { ico: "refresh", title: i18n.t("GitHub sync"), where: i18n.t("Settings"), href: "#/settings/sync", words: "sync devices github repo token connect disconnect backup cloud phone computer" },
      { ico: "user", title: i18n.t("You"), where: i18n.t("Settings"), href: "#/settings/you", words: "name me profile person shared trips paid by who" },
      { ico: "tag", title: i18n.t("Categories"), where: i18n.t("Settings"), href: "#/settings/categories", words: "categories category kinds types places add rename remove order sights food stays" },
      { ico: "database", title: i18n.t("Storage"), where: i18n.t("Settings"), href: "#/settings/storage", words: "space used trips places photos covers persistent keep safe delete browser" },
      { ico: "database", title: i18n.t("Backup"), where: i18n.t("Storage"), href: "#/settings/storage", words: "backup restore file export import save json" },
      { ico: "palette", title: i18n.t("Appearance"), where: i18n.t("Settings"), href: "#/settings/appearance", words: "theme dark light system mode colours" },
      { ico: "globe", title: i18n.t("Language"), where: i18n.t("Appearance"), href: "#/settings/appearance", words: "language english hebrew rtl right to left שפה עברית אנגלית" },
      { ico: "plug", title: i18n.t("Services"), where: i18n.t("Settings"), href: "#/settings/services", words: "connections providers map search keys google maptiler openstreetmap openfreemap" },
      { ico: "map", title: i18n.t("Map"), where: i18n.t("Services"), href: "#/settings/map", words: "map tiles use fallback if it fails provider" },
      { ico: "search", title: i18n.t("Find by name"), where: i18n.t("Services"), href: "#/settings/search", words: "search find places geocoding use fallback if it fails provider" },
      { ico: "users", title: i18n.t("Sharing server"), where: i18n.t("Settings"), href: "#/settings/server", words: "sharing server own self host cloudflare worker deploy address invite" },
      { ico: "cloudSun", title: i18n.t("Weather"), where: i18n.t("Settings"), href: "#/settings/weather", words: "weather forecast rain temperature celsius fahrenheit open-meteo sunrise sunset" },
      { ico: "key", title: i18n.t("AI tools"), where: i18n.t("Settings"), href: "#/settings/ai", words: "ai chat claude chatgpt mcp cli connector delete deleting allow permission" },
      { ico: "info", title: i18n.t("About"), where: i18n.t("Settings"), href: "#/settings/about", words: "version credits licences privacy" },
    ];
    for (const [id, P] of Object.entries(SET.PROVIDERS)) {
      const href = "#/settings/p/" + id;
      out.push({ ico: P_ICON[id], title: P.name, where: i18n.t("Services"), href, words: P.services.map(svcName).join(" ") });
      if (P.key) out.push({ ico: P_ICON[id], title: i18n.t("Key"), where: P.name, href, words: "api key paste test remove how to get a key" });
      for (const [opt, choices] of Object.entries(P.options || {})) {
        out.push({ ico: P_ICON[id], title: opt === "mapType" ? i18n.t("Map type") : i18n.t("Style"), where: P.name, href, words: choices.map((c) => c[1]).join(" ") });
      }
    }
    return out;
  }
  function searchSettings(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return settingsIndex().filter((e) => {
      const hay = (e.title + " " + e.where + " " + e.words).toLowerCase();
      return words.every((w) => hay.includes(w));
    }).sort((a, b) => (a.title.toLowerCase().startsWith(words[0]) ? 0 : 1) - (b.title.toLowerCase().startsWith(words[0]) ? 0 : 1));
  }

  // Settings' pages, and the page each one steps back to.
  const SETTINGS_PARENT = { map: "services", search: "services", p: "services" };
  const settingsParent = (page) => SETTINGS_PARENT[String(page).split("/")[0]] || "";

  function renderSettings(main, page) {
    if (page === "map" || page === "search") return renderService(main, page);
    if (page === "services") return renderServices(main);
    if (page === "drive") return renderDrive(main);
    if (page === "sync") return renderSync(main);
    if (page === "you") return renderYou(main);
    if (page === "categories") return renderCategories(main);
    if (page === "storage") return renderStorage(main);
    if (page === "appearance") return renderAppearance(main);
    if (page === "about") return renderAbout(main);
    if (page === "weather") return renderWeather(main);
    if (page === "server") return renderServer(main);
    if (page === "ai") return renderAi(main);
    const pm = /^p\/(\w+)$/.exec(page || "");
    if (pm && SET.PROVIDERS[pm[1]]) return renderProvider(main, pm[1]);
    $("title").textContent = i18n.t("Settings");
    const cfg = SET.get();
    const input = el("input", { type: "search", placeholder: i18n.t("Search settings"), "aria-label": i18n.t("Search settings"), autocomplete: "off", spellcheck: false, value: view.settingsQ || "" });
    const results = el("div.settings-results");
    const needs = SERVICES.map(([svc]) => serviceStatus(svc, cfg)).find((st) => st.tone === "warn");
    const home = el("div.sgroup", {}, el("div.sgroup-card", {},
      srow("#/settings/you", "user", i18n.t("You"), { text: cfg.me.name || i18n.t("Your name, for shared trips") }),
      srow("#/settings/categories", "tag", i18n.t("Categories"), { text: cats().map(([, n]) => n).slice(0, 4).join(", ") + (cats().length > 4 ? "…" : "") }),
      srow("#/settings/storage", "database", i18n.t("Storage"), { text: i18n.t("Space used, backup and restore") }),
      srow("#/settings/appearance", "palette", i18n.t("Appearance"), { text: THEMES.find(([t]) => t === cfg.appearance.theme)[1] }),
      srow("#/settings/services", "plug", i18n.t("Services"), needs || { text: i18n.t("Map and Find by name: {join}", { join: SERVICES.map(([svc]) => SET.PROVIDERS[cfg[svc].main].name).join(", ") }) }),
      srow("#/settings/sync", "refresh", i18n.t("GitHub sync"), syncSummary()),
      driveOn() ? srow("#/settings/drive", "cloud", i18n.t("Google Drive"), driveSummary()) : null,
      srow("#/settings/server", "users", i18n.t("Sharing server"), { text: SHARE.server() === SHARE.DEFAULT ? i18n.t("Tripboard's server") : SHARE.host(SHARE.server()) }),
      srow("#/settings/weather", "cloudSun", i18n.t("Weather"), { text: wxOn() ? i18n.t("On, from Open-Meteo") : i18n.t("Off") }),
      srow("#/settings/ai", "key", i18n.t("AI tools"), { text: cfg.ai.deleting ? i18n.t("Can delete") : i18n.t("Can't delete") }),
      srow("#/settings/about", "info", i18n.t("About"), { text: i18n.t("Version {version} · credits", { version: window.Tripboard.version }) })));
    const paint = () => {
      const q = input.value.trim();
      view.settingsQ = input.value;
      home.hidden = !!q;
      results.hidden = !q;
      if (!q) return;
      const hits = searchSettings(q);
      results.replaceChildren(sgroup(hits.length ? i18n.tn(hits.length, "1 result", "{n} results") : i18n.t("No results"),
        hits.length ? hits.map((h) => srow(h.href, h.ico, h.title, { text: h.where }))
          : [el("p.srow-empty", { text: i18n.t("Nothing matches. Try “key”, “dark” or “fallback”.") })]));
    };
    input.addEventListener("input", paint);
    main.append(el("label.settings-search", {}, icon("search"), input), results, home);
    paint();
  }

  // The map and search providers: which each service uses, then each one's setup.
  function renderServices(main) {
    $("title").textContent = i18n.t("Services");
    const cfg = SET.get();
    main.append(el("p.dim.hint.page-hint", { text: i18n.t("Where the map and place search come from. Pick one for each, and one to fall back on.") }),
      sgroup(i18n.t("Use"), SERVICES.map(([svc, title]) => srow("#/settings/" + svc, S_ICON[svc], title, serviceStatus(svc, cfg)))),
      sgroup(i18n.t("Providers"), Object.entries(SET.PROVIDERS).map(([id, P]) => srow("#/settings/p/" + id, P_ICON[id], P.name, providerStatus(id)))));
  }

  const THEMES = [["system", i18n.t("Same as this device")], ["light", i18n.t("Light")], ["dark", i18n.t("Dark")]];
  function renderAppearance(main) {
    $("title").textContent = i18n.t("Appearance");
    const cur = SET.get().appearance.theme;
    main.append(el("section.panel", {}, el("fieldset.field", {}, el("legend", { text: i18n.t("Theme") }),
      el("div.seg", { role: "radiogroup" }, THEMES.map(([id, label]) => el("button", { type: "button", role: "radio", "aria-checked": String(cur === id), text: id === "system" ? i18n.t("System") : label,
        onclick: () => { SET.setTheme(id); render(); } })))),
      el("fieldset.field", {}, el("legend", { text: i18n.t("Language") }),
        el("div.seg", { role: "radiogroup" }, [["", i18n.t("System")], ...i18n.list().map((l) => [l.code, l.name])].map(([code, label]) => el("button", { type: "button", role: "radio", "aria-checked": String((i18n.choice || "") === code), text: label,
          onclick: () => { if (i18n.set(code)) location.reload(); } }))))));
  }

  async function renderStorage(main) {
    $("title").textContent = i18n.t("Storage");
    const trips = doc.trips.length, places = doc.places.length, covers = doc.trips.filter((t) => t.cover).length, files = (doc.files || []).length;
    const used = el("p", { text: i18n.t("Working it out…") });
    const keep = el("p.hint.dim");
    const keepBtn = el("button.btn", { type: "button", text: i18n.t("Keep my trips safe"), hidden: true });
    main.append(el("section.panel", {}, el("h2", { text: i18n.t("On this device") }),
      el("p", { text: i18n.join([i18n.tn(trips, "1 trip", "{n} trips"), i18n.tn(places, "1 place", "{n} places"), i18n.tn(covers, "1 cover photo", "{n} cover photos"), i18n.tn(files, "1 file", "{n} files")]) + "." }), used),
    el("section.panel", {}, el("h2", { text: i18n.t("Kept safe") }), keep, el("div.loc-actions", {}, keepBtn)),
    el("section.panel", {}, el("h2", { text: i18n.t("Backup") }),
      el("p.hint.dim", { text: i18n.t("A file with your trips, places, expenses, cover photos and files. Restoring it adds its trips here, and replaces a trip that's already here.") }),
      el("div.loc-actions", {},
        el("button.btn", { type: "button", text: i18n.t("Save a backup"), disabled: !trips, onclick: () => saveBackup() }),
        el("label.btn.quiet", {}, i18n.t("Restore from a file"), el("input.visually-hidden", { type: "file", accept: ".json,application/json",
          onchange: (e) => { const f = e.target.files && e.target.files[0]; if (f) restoreBackup(f); e.target.value = ""; } })))),
    el("p.dim.hint.page-hint", { text: SYNC && SYNC.connected() ? i18n.t("Your trips are also in your GitHub repo, so clearing this site's data loses only what hasn't synced yet.")
      : i18n.t("Without GitHub sync, trips live in this browser only. Clearing this site's data deletes them.") }));
    const S = navigator.storage;
    if (S && S.estimate) {
      try { const e = await S.estimate(); used.textContent = (e.quota ? i18n.t("About {mb} used, of {quota} this browser allows.", { mb: mb(e.usage), quota: mb(e.quota) }) : i18n.t("About {mb} used.", { mb: mb(e.usage) })); }
      catch (err) { used.textContent = ""; }
    } else used.textContent = "";
    const persisted = S && S.persisted ? await S.persisted().catch(() => false) : false;
    keep.textContent = persisted ? i18n.t("The browser won't clear Tripboard's data to free up space.")
      : i18n.t("The browser may clear Tripboard's data when the device runs short of space. Asking it to keep the data stops that.");
    keepBtn.hidden = persisted || !(S && S.persist);
    keepBtn.onclick = async () => {
      const ok = await S.persist().catch(() => false);
      if (ok) render(); else keep.textContent = i18n.t("The browser said no. Installing Tripboard (Add to Home screen) usually lets it keep the data.");
    };
  }
  const mb = (bytes) => (bytes >= 1e9 ? (bytes / 1e9).toFixed(1) + " GB" : Math.max(0.1, bytes / 1e6).toFixed(1) + " MB");

  function renderService(main, svc) {
    $("title").textContent = svcName(svc);
    const cfg = SET.get();
    const ids = Object.keys(SET.PROVIDERS).filter((id) => SET.PROVIDERS[id].services.includes(svc));
    const label = (id) => SET.PROVIDERS[id].name + (SET.ready(id) ? "" : " (needs a key)");
    const mainSel = el("select", { onchange: (e) => { SET.setService(svc, { main: e.target.value }); render(); } },
      ids.map((id) => el("option", { value: id, text: label(id), selected: cfg[svc].main === id })));
    const fbSel = el("select", { onchange: (e) => { SET.setService(svc, { fallback: e.target.value }); render(); } },
      el("option", { value: "", text: i18n.t("None"), selected: !cfg[svc].fallback }),
      ids.filter((id) => id !== cfg[svc].main).map((id) => el("option", { value: id, text: label(id), selected: cfg[svc].fallback === id })));
    const st = serviceStatus(svc, cfg);
    main.append(el("section.panel", {},
      el("label.field", {}, i18n.t("Use"), mainSel),
      el("label.field", {}, i18n.t("If it fails, use"), fbSel),
      st.tone === "warn" ? el("p.hint.warn", { text: st.text + "." }) : null,
      el("p.hint.dim", { text: svc === "map" ? i18n.t("If the first can't answer (no key, a refused key, a used-up quota), the second is used and the map says why.") : i18n.t("If the first can't answer (no key, a refused key, a used-up quota), the second is used and the search says why.") })),
      sgroup(i18n.t("Set up"), ids.map((id) => srow("#/settings/p/" + id, P_ICON[id], SET.PROVIDERS[id].name, providerStatus(id)))));
  }

  function renderProvider(main, id) {
    const P = SET.PROVIDERS[id], conf = SET.get().providers[id];
    $("title").textContent = P.name;
    const status = el("p.hint", { role: "status" });
    const kids = [el("p.dim", { text: P.note }), el("p.hint.dim", { text: i18n.t("Used for: {join}.", { join: P.services.map(svcName).join(", ") }) })];
    for (const [opt, choices] of Object.entries(P.options || {})) {
      kids.push(el("label.field", {}, opt === "mapType" ? i18n.t("Map type") : i18n.t("Style"),
        el("select", { onchange: (e) => SET.setProvider(id, { [opt]: e.target.value }) },
          choices.map(([v, t]) => el("option", { value: v, text: t, selected: conf[opt] === v })))));
    }
    if (P.key) {
      const input = el("input", { type: "password", value: conf.key || "", autocomplete: "off", spellcheck: false, placeholder: i18n.t("Paste your key"),
        onchange: (e) => { SET.setProvider(id, { key: e.target.value.trim() }); render(); } });
      kids.push(el("label.field", {}, i18n.t("Key"), input),
        el("div.loc-actions", {},
          el("button.btn", { type: "button", text: i18n.t("Test"), onclick: () => testProvider(id, status) }),
          el("button.btn.quiet", { type: "button", text: i18n.t("Show"), onclick: (e) => { const show = input.type === "password"; input.type = show ? "text" : "password"; e.currentTarget.textContent = show ? i18n.t("Hide") : i18n.t("Show"); } }),
          conf.key ? el("button.btn.danger", { type: "button", text: i18n.t("Remove key"), onclick: () => { SET.setProvider(id, { key: "" }); render(); } }) : null),
        status);
    } else {
      kids.push(el("div.loc-actions", {}, el("button.btn", { type: "button", text: i18n.t("Test"), onclick: () => testProvider(id, status) })), status);
    }
    main.append(el("section.panel", {}, kids));
    if (STEPS[id]) main.append(el("section.panel", {}, el("h2", { text: i18n.t("How to get a key") }),
      el("ol.steps", {}, STEPS[id].map(([t, href]) => el("li", {}, t, href ? [" ", el("a", { href, target: "_blank", rel: "noopener noreferrer", text: i18n.t("Open") })] : null)))));
    if (P.key) main.append(el("p.dim.hint", { text: i18n.t("The key is kept in this browser only, and sent only to {name} when it's used.", { name: P.name }) }));
  }

  // Sharing server: Tripboard's, or one the person runs (server/README.md).
  // A new address works after a reload, once sw.js adds it to the CSP.
  const SERVER_GUIDE = "https://github.com/danielnoam/Tripboard/blob/main/server/README.md";
  function renderServer(main) {
    $("title").textContent = i18n.t("Sharing server");
    const saved = SHARE.server() === SHARE.DEFAULT ? null : SHARE.server();
    const own = view.ownServer !== undefined ? view.ownServer : !!saved;
    const seg = el("fieldset.field", {}, el("legend", { text: i18n.t("Server") }),
      el("div.seg", { role: "radiogroup" }, [["main", i18n.t("Tripboard's")], ["own", i18n.t("Your own")]].map(([id, label]) =>
        el("button", { type: "button", role: "radio", "aria-checked": String((own ? "own" : "main") === id), text: label, onclick: async () => {
          view.ownServer = id === "own";
          if (id === "main" && saved) await SHARE.setServer(null);
          render();
        } }))));
    const kids = [seg];
    if (own) {
      const input = el("input", { type: "url", inputmode: "url", value: saved || "", placeholder: "https://tripboard.you.workers.dev", autocomplete: "off", spellcheck: false, "aria-label": i18n.t("Server address") });
      const status = el("p.hint");
      const use = el("button.btn.primary", { type: "button", text: i18n.t("Use this server"), onclick: async () => {
        if (!SHARE.canUseOwn()) { toast(i18n.t("Your own server works in the web app for now.")); return; }
        try {
          const r = await SHARE.setServer(input.value);
          if (r.reload) { toast(i18n.t("Opening Tripboard again to reach it…")); setTimeout(() => location.reload(), 600); return; }
          render();
        } catch (e) { toast(e.message); }
      } });
      const same = () => saved && SHARE.origin(input.value) === saved && SHARE.allowed(saved);
      use.hidden = same();
      input.addEventListener("input", () => { use.hidden = same(); });
      kids.push(el("label.field", {}, i18n.t("Server address"), input), status, use);
      if (saved && !SHARE.allowed(saved)) status.textContent = i18n.t("Open Tripboard again to reach it.");
      else if (saved) {
        status.textContent = i18n.t("Checking…");
        SHARE.check(saved).then((ok) => { status.textContent = ok ? i18n.t("✓ Reached it: a Tripboard sharing server.") : i18n.t("Couldn't reach a Tripboard sharing server there. Check the address, and that the server is deployed."); });
      }
      kids.push(el("p.hint.dim", { text: i18n.t("Trips you share from now on, and Google Maps list links, go to this server. A new address needs Tripboard to open again once. Trips you already share stay on the server they started on.") }));
    } else {
      kids.push(el("p.hint.dim", { text: i18n.t("Shared trips and Google Maps list links go to Tripboard's server, which its maker runs on Cloudflare. Whoever runs a server can read the trips shared through it.") }));
    }
    main.append(el("section.panel", {}, kids),
      el("section.panel", {}, el("h2", { text: i18n.t("Run your own") }),
        el("p.hint.dim", { text: i18n.t("It takes free GitHub and Cloudflare accounts and about 15 minutes: copy Tripboard on GitHub, and its setup makes the server and its database. Then paste the server's address here. People you invite join your trips through your server.") }),
        el("a.btn", { href: SERVER_GUIDE, target: "_blank", rel: "noopener noreferrer", text: i18n.t("How to set it up") })));
  }

  // Weather: on or off on this device, and °C or °F.
  function renderWeather(main) {
    $("title").textContent = i18n.t("Weather");
    const w = SET.get().weather, unit = wxUnit();
    const seg = (legend, opts, cur, pick) => el("fieldset.field", {}, el("legend", { text: legend }),
      el("div.seg", { role: "radiogroup" }, opts.map(([id, label]) => el("button", { type: "button", role: "radio", "aria-checked": String(cur === id), text: label, onclick: () => { pick(id); render(); } }))));
    main.append(el("section.panel", {},
      seg(i18n.t("Show the weather"), [["on", i18n.t("On")], ["off", i18n.t("Off")]], w.on ? "on" : "off", (id) => { SET.setWeather({ on: id === "on" }); if (id === "off") try { localStorage.removeItem(WX_KEY); } catch (e) { /* private window */ } }),
      seg(i18n.t("Temperature"), [["c", "°C"], ["f", "°F"]], unit, (id) => SET.setWeather({ unit: id })),
      el("p.hint.dim", { text: i18n.t("The forecast for each day of a trip, on Today and on the Plan's days, up to 16 days ahead. It comes from Open-Meteo, a free weather service, which gets each day's rough location (about a kilometre) and the dates, nothing else. The last forecast stays on this device for when there's no signal.") }),
      el("p.hint.dim", {}, i18n.t("Weather data: "), el("a", { href: "https://open-meteo.com", target: "_blank", rel: "noopener noreferrer", text: "Open-Meteo.com" }), " (CC BY 4.0)")));
  }

  // Whether AI tools (the CLI, its MCP, the cloud connector) may delete.
  // GitHub sync carries it to them in ai.json, which they never write.
  function renderAi(main) {
    $("title").textContent = i18n.t("AI tools");
    const on = SET.get().ai.deleting;
    main.append(el("p.dim.hint.page-hint", { text: i18n.t("AI chats and the Tripboard command line reach your trips through your GitHub sync repo. They can always read, add and change.") }),
      el("section.panel", {},
        el("fieldset.field", {}, el("legend", { text: i18n.t("Let AI tools delete") }),
          el("div.seg", { role: "radiogroup" }, [["off", i18n.t("Off")], ["on", i18n.t("On")]].map(([id, label]) => el("button", { type: "button", role: "radio", "aria-checked": String((on ? "on" : "off") === id), text: label,
            onclick: () => { if ((id === "on") === on) return; SET.setAi(id === "on"); if (SYNC && SYNC.connected()) SYNC.soon(); render(); } })))),
        el("p.hint.dim", { text: i18n.t("On, they can also delete trips, places, expenses, files and categories, take people off a trip, and restore a backup over your trips. Only this app can turn it on, and your other devices follow.") }),
        !SYNC || !SYNC.connected() ? el("p.hint", { "data-tone": "warn", text: i18n.t("GitHub sync is off, so AI tools can't reach your trips yet.") }) : null),
      el("section.panel", {}, el("h2", { text: i18n.t("What it guards") }),
        el("p.hint.dim", { text: i18n.t("It stops a chat that only has Tripboard's tools. It isn't a lock: anything with your sync token can still change the repo directly. What's deleted stays in the repo's history on GitHub.") })));
  }

  function renderAbout(main) {
    $("title").textContent = i18n.t("About");
    const link = (text, href) => el("a", { href, target: "_blank", rel: "noopener noreferrer", text });
    main.append(el("section.panel", {}, el("h2", { text: i18n.t("Tripboard {version}", { version: window.Tripboard.version }) }),
      el("p.dim", { text: i18n.t("Your trips stay on this device, and in your own private GitHub repo if you turn on sync. Keys and tokens you add are kept in this browser and sent only to their own service.") })),
    sgroup(i18n.t("Credits"), [el("ul.credits", {},
      el("li", {}, i18n.t("Icons: "), link("Lucide", "https://lucide.dev"), " (ISC)"),
      el("li", {}, i18n.t("Map: "), link("MapLibre GL JS", "https://maplibre.org"), " (BSD-3), ", link("OpenFreeMap", "https://openfreemap.org"), ", © ", link("OpenMapTiles", "https://www.openmaptiles.org")),
      el("li", {}, i18n.t("Map data and Find by name: © "), link("OpenStreetMap", "https://www.openstreetmap.org/copyright"), i18n.t(" contributors, "), link("Nominatim", "https://nominatim.org")),
      el("li", {}, i18n.t("Weather data: "), link("Open-Meteo.com", "https://open-meteo.com"), " (CC BY 4.0)"),
      el("li", {}, i18n.t("Hebrew and Arabic map labels: "), link("mapbox-gl-rtl-text", "https://github.com/mapbox/mapbox-gl-rtl-text"), " (BSD-2)"),
      el("li", {}, i18n.t("With your own key: "), link("Google Maps Platform", "https://developers.google.com/maps"), ", ", link("MapTiler", "https://www.maptiler.com")))]));
  }

  // ---------- You ----------
  function renderYou(main) {
    $("title").textContent = i18n.t("You");
    const me = SET.get().me;
    const name = el("input", { value: me.name, autocomplete: "name", maxlength: "60", placeholder: i18n.t("Your name"),
      onchange: (e) => { SET.setMe({ name: e.target.value }); toast(i18n.t("Saved.")); } });
    main.append(el("section.panel", {}, el("label.field", {}, i18n.t("Name"), name),
      el("p.hint.dim", { text: i18n.t("Shown to people you share a trip with, next to what you add and what you paid. Sharing comes in a later version; trips you make now are already marked as yours.") })),
    el("p.dim.hint", { text: i18n.t("Your devices that sync share one id for you, kept in the sync repo.") }));
  }

  // ---------- Categories ----------
  // One list for all your trips, synced (categories.json). Removing one
  // moves its places in your trips to Other; Undo brings both back.
  function renderCategories(main) {
    $("title").textContent = i18n.t("Categories");
    const list = cats();
    const asSaved = (l) => l.map(([id, name]) => (M.CATEGORY.get(id) === name ? { id } : { id, name }));
    const setList = (l) => { SET.setCategories(asSaved(l)); save(); };
    const count = (id) => doc.places.filter((p) => p.category === id).length;
    const rows = list.map(([id, name], i) => {
      const input = el("input", { value: name, maxlength: "40", "aria-label": i18n.t("Name of {name}", { name }), autocomplete: "off",
        onchange: (e) => { const v = e.target.value.trim(); if (!v) { e.target.value = name; return; } const l = cats(); l[i] = [id, v]; setList(l); } });
      const move = (d) => { const l = cats(); [l[i], l[i + d]] = [l[i + d], l[i]]; setList(l); };
      const remove = el("button.btn.quiet", { type: "button" });
      armConfirm(remove, i18n.t("Remove"), () => {
        const before = cats();
        undoable(i18n.t("Removed {name}. Its places are in Other now.", { name }), () => {
          for (const p of doc.places) if (p.category === id && mayEdit(findTrip(p.trip) || {})) p.category = "other";
          SET.setCategories(asSaved(before.filter(([x]) => x !== id)));
        }, () => SET.setCategories(asSaved(before)));
      });
      return el("li", {},
        el("span.cat-name", {}, input, el("span.dim", { text: i18n.tn(count(id), "1 place", "{n} places") })),
        el("span.cat-btns", {},
          el("button.icon-btn.small", { type: "button", "aria-label": i18n.t("Move {name} up", { name }), disabled: i === 0, onclick: () => move(-1) }, icon("arrowUp")),
          el("button.icon-btn.small", { type: "button", "aria-label": i18n.t("Move {name} down", { name }), disabled: i === list.length - 1, onclick: () => move(1) }, icon("arrowDown")),
          id === "other" ? el("span.cat-keep", { text: "" }) : remove));
    });
    const add = el("input", { maxlength: "40", placeholder: i18n.t("Markets"), "aria-label": i18n.t("New category"), autocomplete: "off" });
    const addIt = () => {
      const v = add.value.trim();
      if (!v) return;
      if (cats().some(([, n]) => n.toLowerCase() === v.toLowerCase())) { toast(i18n.t("There's already a category called {name}.", { name: v })); return; }
      const l = cats();
      const at = l.findIndex(([x]) => x === "other");
      l.splice(at < 0 ? l.length : at, 0, ["c" + M.newId(), v]);
      setList(l);
      toast(i18n.t("Added {name}.", { name: v }));
    };
    add.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addIt(); } });
    const reset = el("button.btn.quiet", { type: "button" });
    armConfirm(reset, i18n.t("Back to the defaults"), () => {
      const before = cats();
      const keep = new Set(M.CATEGORIES.map(([id]) => id));
      undoable(i18n.t("Categories are back to the defaults."), () => {
        for (const p of doc.places) if (!keep.has(p.category) && mayEdit(findTrip(p.trip) || {})) p.category = "other";
        SET.setCategories(M.CATEGORIES.map(([id]) => ({ id })));
      }, () => SET.setCategories(asSaved(before)));
    });
    main.append(el("p.dim.hint.page-hint", { text: i18n.t("One list for all your trips. It syncs to your devices, and a trip you share shows your categories' names to the others.") }),
      el("section.panel", {}, el("ul.cat-list", {}, rows)),
      el("section.panel", {}, el("label.field", {}, i18n.t("New category"), add), el("div.loc-actions", {}, el("button.btn", { type: "button", text: i18n.t("Add"), onclick: addIt }))),
      el("div.loc-actions", {}, reset));
  }

  // ---------- GitHub sync ----------
  const SYNC = window.Tripboard.sync;
  let syncPaint = null;
  function ago(iso) {
    const s = Math.round((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return new Date(iso).toLocaleDateString(i18n.lang);
  }
  function syncSummary() {
    if (!SYNC || !SYNC.connected()) return { text: i18n.t("Off. Keep your trips on every device") };
    const st = SYNC.status, c = SET.get().sync;
    if (st.state === "error") return { text: i18n.t("Didn't finish. Open for why"), tone: "warn" };
    if (st.state === "syncing") return { text: i18n.t("Syncing…") };
    return { text: c.owner + "/" + c.repo + (st.at ? ", synced " + ago(st.at) : "") };
  }
  const SYNC_STEPS = [
    [i18n.t("On GitHub, make a private repo for your trips (tripboard-data is a good name). Tick Add a README, so it isn't empty."), "https://github.com/new?name=tripboard-data&visibility=private"],
    [i18n.t("Make a fine-grained token. Under Repository access pick Only select repositories and choose that repo. Under Permissions give Contents Read and write. Nothing else."), "https://github.com/settings/personal-access-tokens/new"],
    [i18n.t("Copy the token and paste it below, with your GitHub user name and the repo's name."), null],
  ];
  // Another device in two taps: a setup link (or its QR code) carries the
  // repo and token in the address's #, which never leaves the browser.
  // Opening it asks first: any link someone got you to open could otherwise
  // point this device at their repo and send your trips there.
  // The web copy: index.html's keel-site.
  const WEB = window.Keel.releases.metaSite();
  const setupBase = () => (/^https?:$/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname) ? location.origin + location.pathname : WEB);
  function setupLink() {
    const c = SET.get().sync;
    return setupBase() + "#t=" + encodeURIComponent(c.token) + "&o=" + encodeURIComponent(c.owner) + "&r=" + encodeURIComponent(c.repo);
  }
  function setupIn(text) {
    const m = /#(.*)$/.exec(String(text || "").trim());
    if (!m) return null;
    const q = new URLSearchParams(m[1]);
    const v = { token: (q.get("t") || "").trim(), owner: (q.get("o") || "").trim(), repo: (q.get("r") || "").trim() };
    return v.token && v.owner && v.repo && /^[\w.-]+$/.test(v.owner) && /^[\w.-]+$/.test(v.repo) ? v : null;
  }
  let pendingSetup = null;
  async function connectSync(v, status, btn) {
    if (btn) btn.disabled = true;
    status.textContent = i18n.t("Checking with GitHub…");
    try {
      const info = await SYNC.check(v);
      if (!info.private) { status.textContent = i18n.t("That repo is public, so anyone could read your trips. Make it private on GitHub (Settings, Danger zone), then connect."); return false; }
      if (SYNC.connected()) { SET.setSync({ token: "" }); await SYNC.forget(); }
      SET.setSync({ ...v, branch: info.branch });
      SYNC.start({ getDoc: () => doc, adopt, version: () => version, store, coverChanged, filesChanged: sweepFiles });
      SYNC.now();
      return true;
    } catch (e) { status.textContent = SYNC.explain(e); return false; }
    finally { if (btn) btn.disabled = false; }
  }
  function setupPanel() {
    const v = pendingSetup, c = SET.get().sync;
    const status = el("p.hint", { role: "status" });
    const go = el("button.btn.primary", { type: "button", text: i18n.t("Connect") });
    go.onclick = async () => { if (await connectSync(v, status, go)) { pendingSetup = null; render(); toast(i18n.t("Connected. Your trips are on their way.")); } };
    return el("section.panel.setup-ask", {},
      el("h2", { text: i18n.t("Connect this device?") }),
      el("p", { text: SYNC.connected() && (c.owner + "/" + c.repo) !== (v.owner + "/" + v.repo)
        ? i18n.t("This link connects Tripboard here to the GitHub repo {repo}, in place of {now}.", { repo: v.owner + "/" + v.repo, now: c.owner + "/" + c.repo })
        : i18n.t("This link connects Tripboard here to the GitHub repo {repo}.", { repo: v.owner + "/" + v.repo }) }),
      el("p.hint.warn", { text: i18n.t("Only continue if you made this link yourself, on another device of yours.") }),
      el("div.loc-actions", {}, go, el("button.btn.quiet", { type: "button", text: i18n.t("Don't connect"), onclick: () => { pendingSetup = null; render(); } })),
      status);
  }
  function addDevicePanel() {
    const link = setupLink();
    const Q = window.Keel && window.Keel.qr;
    const box = el("div.sync-qr", { role: "img", "aria-label": i18n.t("Setup code") });
    const svg = Q && Q.fits(link) ? Q.svg(link, { size: 200 }) : null;
    if (svg) box.innerHTML = svg;
    const copy = async () => {
      try { await navigator.clipboard.writeText(link); toast(i18n.t("Setup link copied. Only send it to yourself.")); }
      catch (e) { toast(i18n.t("Couldn't copy the link.")); }
    };
    return el("section.panel", {},
      el("h2", { text: i18n.t("Add another device") }),
      el("p.hint.dim", { text: i18n.t("Point the other device's camera at this code, or send yourself the link and open it there. Tripboard asks before it connects.") }),
      svg ? box : null,
      el("div.loc-actions", {}, el("button.btn", { type: "button", text: i18n.t("Copy setup link"), onclick: copy })),
      el("p.hint.warn", { text: i18n.t("The code and the link hold your token. Only use them on your own devices.") }));
  }
  function pastePanel() {
    const input = el("input", { type: "url", autocomplete: "off", spellcheck: false, autocapitalize: "off", placeholder: WEB + "#t=…" });
    const status = el("p.hint", { role: "status" });
    const go = el("button.btn", { type: "button", text: i18n.t("Use link"), onclick: () => {
      const v = setupIn(input.value);
      if (!v) { status.textContent = i18n.t("That isn't a Tripboard setup link."); return; }
      pendingSetup = v; render();
    } });
    return el("section.panel", {}, el("h2", { text: i18n.t("Have a setup link?") }),
      el("p.hint.dim", { text: i18n.t("From Settings › GitHub sync on a device that's already connected.") }),
      el("div.link-row", {}, input, go), status);
  }

  function renderSync(main) {
    $("title").textContent = i18n.t("GitHub sync");
    const c = SET.get().sync;
    const status = el("p.hint", { role: "status" });
    if (pendingSetup) {
      main.append(setupPanel());
      if (!SYNC.connected()) return;
    }
    if (!SYNC.connected()) {
      const owner = el("input", { value: c.owner, autocomplete: "off", spellcheck: false, autocapitalize: "off", placeholder: "your-user-name" });
      const repo = el("input", { value: c.repo, autocomplete: "off", spellcheck: false, autocapitalize: "off" });
      const token = el("input", { type: "password", autocomplete: "off", spellcheck: false, placeholder: "github_pat_…" });
      const go = el("button.btn", { type: "button", text: i18n.t("Connect") });
      go.onclick = async () => {
        const v = { owner: owner.value.trim(), repo: repo.value.trim(), token: token.value.trim() };
        if (!v.owner || !v.repo || !v.token) { status.textContent = i18n.t("All three are needed."); return; }
        if (await connectSync(v, status, go)) render();
      };
      main.append(el("p.dim.hint.page-hint", { text: i18n.t("Sync keeps your trips in a private GitHub repo of yours, so your phone and computer see the same trips. Tripboard has no server: your trips go only to GitHub.") }),
        el("section.panel", {}, el("h2", { text: i18n.t("Set it up") }),
          el("ol.steps", {}, SYNC_STEPS.map(([t, href]) => el("li", {}, t, href ? [" ", el("a", { href, target: "_blank", rel: "noopener noreferrer", text: i18n.t("Open") })] : null)))),
        el("section.panel", {},
          el("label.field", {}, i18n.t("GitHub user name"), owner),
          el("label.field", {}, i18n.t("Repo"), repo),
          el("label.field", {}, i18n.t("Token"), token),
          el("div.loc-actions", {}, go), status),
        pastePanel(),
        el("p.dim.hint", { text: i18n.t("The token is kept in this browser and sent only to GitHub. Anyone who can open this browser's Tripboard can use it, so give it only that one repo.") }));
      return;
    }
    const line = el("p");
    const now = el("button.btn", { type: "button", text: i18n.t("Sync now"), onclick: () => SYNC.now() });
    syncPaint = () => {
      if (!line.isConnected) { syncPaint = null; return; }
      const st = SYNC.status;
      now.disabled = st.state === "syncing";
      line.textContent = st.state === "syncing" ? i18n.t("Syncing…") : st.state === "error" ? SYNC.explain(st.error) : st.at ? i18n.t("Synced {ago}.", { ago: ago(st.at) }) : i18n.t("Not synced yet on this device.");
      line.dataset.tone = st.state === "error" ? "warn" : "";
    };
    const repoUrl = "https://github.com/" + encodeURIComponent(c.owner) + "/" + encodeURIComponent(c.repo);
    main.append(el("section.panel", {}, el("h2", {}, el("a", { href: repoUrl, target: "_blank", rel: "noopener noreferrer", text: c.owner + "/" + c.repo })),
      line, el("p.hint.dim", { text: i18n.t("It syncs a few seconds after each change, when Tripboard opens, and every few minutes while it's open.") }),
      el("div.loc-actions", {}, now,
        el("button.btn.danger", { type: "button", text: i18n.t("Disconnect"), onclick: async () => {
          SET.setSync({ token: "" });
          await SYNC.forget();
          render();
          toast(i18n.t("Disconnected. Your trips stay on this device and in the repo."));
        } }))),
    addDevicePanel(),
    el("p.dim.hint", { text: i18n.t("Each trip is a file in the repo (trips/), with its cover photo (covers/). Changes made on two devices at once are merged; when both changed the same thing, the later change wins.") }));
    syncPaint();
  }

  // ---------- Google Drive backups (src/drive.js) ----------
  // Dated copies of every trip beside GitHub sync, not a second sync: a
  // backup never merges on its own. Restoring one is the same as restoring
  // a backup file, and Undo takes it back.
  const DRIVE = window.Tripboard.drive;
  const driveOn = () => !!(DRIVE && DRIVE.available);
  let driveList = null, driveBusy = false;
  const deviceName = () => { const P = window.Keel.platform || {}; return P.native ? (P.os === "ios" ? "iPhone" : "Android") : P.desktop ? (P.desktopOs === "linux" ? "Linux" : "Windows") : "Browser"; };
  const when = (at) => new Date(at).toLocaleString(i18n.lang, { dateStyle: "medium", timeStyle: "short" });
  function driveSummary() {
    if (!DRIVE.on) return { text: i18n.t("Off. Dated copies of your trips") };
    if (driveBusy) return { text: i18n.t("Backing up…") };
    if (DRIVE.auto && DRIVE.due && !DRIVE.signedIn) return { text: i18n.t("A backup is due. Open to back up"), tone: "warn" };
    const last = DRIVE.last;
    return { text: last ? i18n.t("Last backup {when}", { when: when(last.at) }) : i18n.t("No backup yet") };
  }
  function driveError(e) {
    if (e && e.code === "cancelled") return;
    toast((e && e.message) || i18n.t("Google Drive didn't answer. Try again."));
  }
  const drivePaint = () => { if (/^#\/settings(\/drive)?$/.test(location.hash)) render(); };
  async function loadDriveList(ask) {
    if (!DRIVE.on || (!ask && !DRIVE.signedIn)) return;
    try {
      if (ask) await DRIVE.getToken(true, "list");
      driveList = await DRIVE.list();
    } catch (e) { if (ask) driveError(e); }
    drivePaint();
  }
  async function connectDrive() {
    try {
      const email = await DRIVE.connect();
      toast(email ? i18n.t("Google Drive connected as {email}.", { email }) : i18n.t("Google Drive connected."));
      await loadDriveList(false);
    } catch (e) { driveError(e); }
    drivePaint();
  }
  // `quiet`: the automatic one, which speaks only when it fails.
  async function backupToDrive(quiet) {
    if (!DRIVE.on || driveBusy) return;
    if (quiet && !doc.trips.length) return;
    driveBusy = true;
    drivePaint();
    try {
      if (!quiet) await DRIVE.getToken(true, "backup");
      const data = await backupData();
      await DRIVE.upload(JSON.stringify(data), deviceName());
      driveList = await DRIVE.list().catch(() => driveList);
      if (!quiet) toast(i18n.t("Backed up to Google Drive."));
    } catch (e) {
      if (!quiet || e.code !== "signin") driveError(e);
    } finally {
      driveBusy = false;
      drivePaint();
    }
  }
  // A backup that's due goes up when a token is at hand without asking.
  // A browser's lasts an hour from signing in, so there it often waits for
  // a tap (the Settings row says so).
  function maybeDriveBackup() {
    if (!driveOn() || !DRIVE.on || !DRIVE.auto || !DRIVE.due || !DRIVE.signedIn || document.visibilityState !== "visible") return;
    backupToDrive(true);
  }
  async function restoreDrive(f) {
    try {
      toast(i18n.t("Restoring…"));
      const data = await DRIVE.download(f.id);
      await restoreData(data);
    } catch (e) { driveError(e); }
  }
  function renderDrive(main) {
    $("title").textContent = i18n.t("Google Drive");
    if (!driveOn()) {
      main.append(el("p.dim.hint.page-hint", { text: i18n.t("Google Drive backups aren't set up in this copy of Tripboard yet.") }));
      return;
    }
    if (!DRIVE.on) {
      main.append(el("p.dim.hint.page-hint", { text: i18n.t("Puts a dated copy of all your trips, with their photos and files, in a Tripboard folder in your Google Drive. The newest three are kept.") }),
        el("section.panel", {}, el("div.loc-actions", {}, el("button.btn", { type: "button", text: i18n.t("Connect Google Drive"), onclick: connectDrive }))),
        el("p.dim.hint", { text: i18n.t("Tripboard can see only the files it puts there, nothing else in your Drive. Backups go from this device straight to Google.") }));
      return;
    }
    const last = DRIVE.last;
    const line = driveBusy ? i18n.t("Backing up…") : last ? i18n.t("Last backup {when}.", { when: when(last.at) }) : i18n.t("No backup yet.");
    const often = (d) => (d === 1 ? i18n.t("Every day") : d === 7 ? i18n.t("Every week") : d === 30 ? i18n.t("Every month") : i18n.tn(d, "Every day", "Every {n} days"));
    const auto = el("select", { onchange: (e) => { const d = Number(e.target.value); DRIVE.auto = d > 0; if (d) DRIVE.every = d; render(); } },
      el("option", { value: "0", selected: !DRIVE.auto, text: i18n.t("Off") }),
      DRIVE.EVERY.map((d) => el("option", { value: String(d), selected: DRIVE.auto && DRIVE.every === d, text: often(d) })));
    const disconnect = el("button.btn.danger", { type: "button" });
    armConfirm(disconnect, i18n.t("Disconnect"), async () => {
      await DRIVE.disconnect();
      driveList = null;
      render();
      toast(i18n.t("Google Drive disconnected. The backups stay in your Drive."));
    });
    main.append(el("section.panel", {}, el("h2", { text: DRIVE.email || i18n.t("Google Drive") }),
      el("p", { text: line }),
      el("div.loc-actions", {}, el("button.btn", { type: "button", text: i18n.t("Back up now"), disabled: driveBusy || !doc.trips.length, onclick: () => backupToDrive(false) }), disconnect)),
    el("section.panel", {},
      el("label.field", {}, i18n.t("Back up by itself"), auto),
      el("p.hint.dim", { text: window.Keel.platform && window.Keel.platform.bundled ? i18n.t("When one is due, it goes up the next time Tripboard opens.")
        : i18n.t("When one is due, it goes up the next time Tripboard opens. In a browser Google's sign-in lasts an hour, so it may ask you to tap Back up now.") })),
    driveBackupsPanel());
    if (!driveList) loadDriveList(false);
  }
  function driveBackupsPanel() {
    const box = el("section.panel", {}, el("h2", { text: i18n.t("Backups") }));
    if (!driveList) {
      box.append(el("p.hint.dim", { text: DRIVE.signedIn ? i18n.t("Loading…") : i18n.t("Google asks again before showing them.") }),
        DRIVE.signedIn ? null : el("div.loc-actions", {}, el("button.btn.quiet", { type: "button", text: i18n.t("Show backups"), onclick: () => loadDriveList(true) })));
      return box;
    }
    if (!driveList.length) { box.append(el("p.hint.dim", { text: i18n.t("None yet.") })); return box; }
    box.append(el("ul.drive-list", {}, driveList.map((f) => {
      const del = el("button.btn.quiet", { type: "button" });
      armConfirm(del, i18n.t("Delete"), async () => {
        try { await DRIVE.remove(f.id); driveList = driveList.filter((x) => x.id !== f.id); toast(i18n.t("Backup deleted.")); }
        catch (e) { driveError(e); }
        render();
      });
      return el("li", {},
        el("span.drive-text", {}, el("span", { text: when(f.at) }), el("span.dim", { text: [mb(f.size), f.from ? i18n.t("from {device}", { device: f.from }) : ""].filter(Boolean).join(" · ") })),
        el("span.drive-btns", {}, el("button.btn.quiet", { type: "button", text: i18n.t("Restore"), onclick: () => restoreDrive(f) }), del));
    })), el("p.hint.dim", { text: i18n.t("Restoring adds the backup's trips here, and replaces a trip that's already here. Undo takes it back.") }));
    return box;
  }

  async function testProvider(id, status) {
    status.textContent = i18n.t("Testing…");
    const conf = SET.get().providers[id];
    const P = SET.PROVIDERS[id];
    const lines = [];
    if (P.services.includes("search")) {
      try { const r = await PL.providers[id].search("Eiffel Tower", { key: conf.key }); lines.push(r.length ? i18n.t("Find by name works.") : i18n.t("Find by name works, though it found nothing for a test search.")); }
      catch (e) { lines.push(i18n.t("Find by name: {why}", { why: e.message })); }
    }
    if (P.services.includes("map")) {
      try { await TM.SOURCES[id](conf, false); lines.push(i18n.t("The map works.")); }
      catch (e) { lines.push(i18n.t("Map: {why}", { why: e.message })); }
    }
    status.textContent = navigator.onLine === false ? i18n.t("Testing needs a connection.") : lines.join(" ");
  }
  SET.onChange(() => { mapFailed = null; });

  // ---------- Routing ----------
  function render() {
    const before = tabBefore();
    paint();
    tabAfter(before);
  }
  function paint() {
    const sm = /^#\/settings(?:\/(.+))?$/.exec(location.hash);
    const settings = !!sm;
    $("settingsBtn").hidden = settings;
    const jm = /^#\/join\/([\w-]+)\/([\w-]+)(?:\/([\w.:-]+))?/.exec(location.hash);
    const m = /^#\/trip\/([\w-]+)(?:\/(map|expenses|files|share|today))?/.exec(location.hash);
    const trip = m ? findTrip(m[1]) : null;
    if (m && !trip) { location.replace("#/"); return; }
    if (trip && (m[2] === "expenses" || m[2] === "files") && !sees(trip, m[2])) { location.replace("#/trip/" + trip.id); return; }
    if (trip && m[2] === "today" && !underWay(trip)) { location.replace("#/trip/" + trip.id); return; }
    if ((trip && trip.id) !== view.trip) { view.from = null; view.pick = null; view.sel = null; view.mapDay = null; view.trip = trip ? trip.id : null; }
    view.mode = trip && m[2] ? m[2] : "board";
    const onMap = view.mode === "map";
    $("mapView").hidden = !onMap;
    paintTripBar(view.mode === "share" ? null : trip);
    paintOfflineBadge();
    $("shareTrip").hidden = !trip || view.mode === "share";
    $("app").hidden = onMap;
    document.body.classList.toggle("on-map", onMap);
    if (onMap) {
      document.body.classList.add("on-board"); document.body.classList.remove("on-home");
      $("title").textContent = trip.name;
      $("back").hidden = false;
      $("newTrip").hidden = true;
      $("editTrip").hidden = !mayEdit(trip);
      $("fab").hidden = !!view.pick || !mayEdit(trip);
      showMap(trip);
      return;
    }
    const main = $("app");
    const y = main.dataset.trip === view.trip + view.mode ? window.scrollY : 0;
    main.dataset.trip = view.trip + view.mode;
    main.replaceChildren();
    document.body.classList.toggle("on-board", !!trip);
    document.body.classList.toggle("on-home", !trip && !settings && !jm);
    $("newTrip").hidden = !!(trip || settings || jm);
    $("back").hidden = !trip;
    $("editTrip").hidden = !trip || !mayEdit(trip) || view.mode === "share";
    $("fab").hidden = !trip || !mayEdit(trip) || view.mode === "share";
    if (jm) { $("back").hidden = false; renderJoin(main, jm[1], jm[2], jm[3]); }
    else if (settings) { $("back").hidden = false; renderSettings(main, sm[1] || ""); }
    else if (trip && view.mode === "expenses") renderExpenses(main, trip);
    else if (trip && view.mode === "files") renderFiles(main, trip);
    else if (trip && view.mode === "share") renderShare(main, trip);
    else if (trip && view.mode === "today") renderToday(main, trip);
    else if (trip) renderBoard(main, trip); else renderHome(main);
    $("fab").setAttribute("aria-label", view.mode === "expenses" ? i18n.t("Add an expense") : view.mode === "files" ? i18n.t("Add files") : i18n.t("Add a place"));
    if (view.mode !== "share") main.classList.remove("share-page");
    main.classList.toggle("today-page", !!trip && view.mode === "today");
    if (view.mode !== "files") { main.ondragover = main.ondragleave = main.ondrop = null; main.classList.remove("file-over"); }
    window.scrollTo(0, y);
  }

  // Swiping sideways moves between a trip's tabs: on the bottom bar always,
  // on the page everywhere but the map, which needs the finger to pan. Not
  // from a screen edge (the system's back), over a dialog, a field, a row
  // that scrolls sideways, or while text is selected.
  function wireSwipe() {
    let s = null;
    const sideways = (n) => {
      for (; n && n !== document.body; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
      }
      return false;
    };
    document.addEventListener("touchstart", (e) => {
      s = null;
      const t = e.touches[0], at = e.target;
      if (e.touches.length > 1 || !view.trip || view.mode === "share" || document.querySelector("dialog[open]")) return;
      if (t.clientX < 24 || t.clientX > window.innerWidth - 24) return;
      const onBar = !!at.closest("#bottomBar");
      if (!onBar && (view.mode === "map" || at.closest("#mapView") || at.closest("input, textarea, select, [contenteditable]") || sideways(at))) return;
      s = { x: t.clientX, y: t.clientY, at: e.timeStamp };
    }, { passive: true });
    document.addEventListener("touchmove", (e) => { if (e.touches.length > 1) s = null; }, { passive: true });
    document.addEventListener("touchcancel", () => { s = null; }, { passive: true });
    document.addEventListener("touchend", (e) => {
      if (!s) return;
      const t = e.changedTouches[0];
      const step = M.swipeStep(t.clientX - s.x, t.clientY - s.y, e.timeStamp - s.at, i18n.dir === "rtl");
      s = null;
      const sel = window.getSelection();
      if (!step || (sel && !sel.isCollapsed)) return;
      const trip = findTrip(view.trip);
      const tabs = trip ? tripTabs(trip) : [];
      const i = tabs.findIndex(([mode]) => mode === view.mode);
      const next = i < 0 ? null : tabs[i + step];
      if (!next) return;
      view.pick = null;
      location.hash = "#/trip/" + trip.id + next[3];
    }, { passive: true });
  }

  // The token leaves the address bar before anything else happens.
  function takeSetupLink() {
    if (!/^#t=/.test(location.hash)) return false;
    const v = setupIn(location.hash);
    history.replaceState(history.state, "", location.pathname + location.search + "#/settings/sync");
    if (v) pendingSetup = v; else toast(i18n.t("That setup link is incomplete. Make a new one on the other device."));
    render();
    return true;
  }
  // The buttons at the top and the trips on Home sink under a finger or
  // the mouse and spring back past their size when let go (hover, in
  // styles.css, grows them a little). The bounce never holds anything up:
  // a trip opens on the tap, and the card bounces as it slides away.
  function pressBounce() {
    const DEPTH = [[".bar .icon-btn", 0.84], [".trip-card", 0.96]];
    let held = null;
    const sink = (n) => DEPTH.find(([sel]) => n.matches(sel))[1];
    document.addEventListener("pointerdown", (e) => {
      const n = e.target.closest && e.target.closest(DEPTH.map(([sel]) => sel).join(", "));
      if (!n || e.button > 0 || lessMotion() || !n.animate) return;
      held = n;
      n.getAnimations().filter((a) => a.id === "press").forEach((a) => a.cancel());
      const a = n.animate([{ transform: "none" }, { transform: "scale(" + sink(n) + ")" }], { duration: 90, easing: "ease-out", fill: "forwards" });
      a.id = "press";
    });
    const up = () => {
      if (!held) return;
      const n = held, from = new DOMMatrix(getComputedStyle(n).transform).a || sink(n);
      held = null;
      n.getAnimations().filter((a) => a.id === "press").forEach((a) => a.cancel());
      const a = n.animate([{ transform: "scale(" + from + ")" }, { transform: "none" }], onSpring(PRESS));
      a.id = "press";
    };
    for (const t of ["pointerup", "pointercancel", "dragstart"]) document.addEventListener(t, up);
  }

  function start(ctx) {
    ({ doc, store, motion, save: saveDoc } = ctx);
    pressBounce();
    doc = M.sanitizeDoc(doc);
    lastSaved = JSON.stringify(doc);
    $("back").append(icon("back", "icon-back"));
    for (const b of document.querySelectorAll(".page-back")) b.append(icon("back", "icon-back"));
    $("editTrip").append(icon("pencil"));
    $("shareTrip").append(icon("users"));
    $("shareTrip").addEventListener("click", () => { view.sharePerson = null; location.hash = "#/trip/" + view.trip + "/share"; });
    $("fab").append(icon("plus"));
    $("settingsBtn").append(icon("sliders"));
    $("updateClose").append(icon("x"));
    $("offlineBadge").prepend(icon("check"));
    $("newTrip").append(icon("plus"));
    $("newTrip").addEventListener("click", (e) => openTrip(null, e.currentTarget));
    $("settingsBtn").addEventListener("click", () => { view.settingsQ = ""; view.settingsFrom = /^#\/trip\//.test(location.hash) ? location.hash : null; location.hash = "#/settings"; });
    $("back").addEventListener("click", () => { const sp = /^#\/settings\/(.+)$/.exec(location.hash);
      if (view.mode === "share" && view.trip) { location.hash = "#/trip/" + view.trip; return; }
      location.hash = sp ? "#/settings" + (settingsParent(sp[1]) ? "/" + settingsParent(sp[1]) : "") : /^#\/settings$/.test(location.hash) && view.settingsFrom || "#/"; });
    $("editTrip").addEventListener("click", (e) => openTrip(findTrip(view.trip), e.currentTarget));
    // The + itself stays put; its icon swells and flashes green, like a tab's.
    $("fab").addEventListener("click", (e) => {
      const fab = e.currentTarget;
      swell(fab.firstChild);
      if (!lessMotion() && fab.animate) fab.animate([{ color: getComputedStyle(fab).getPropertyValue("--tab-on") }, { color: getComputedStyle(fab).color }],
        { duration: 600, easing: "ease-in" });
    });
    // What the + opens comes up at once, with the swell under it.
    $("fab").addEventListener("click", (e) => {
      const fab = e.currentTarget, trip = findTrip(view.trip), mode = view.mode;
      if (mode === "files") $("fileAdd").click();
      else if (mode === "expenses") openExpense(null, trip, fab);
      else openPlace(null, trip, mode === "today" ? { day: today() } : null, fab);
    });
    window.addEventListener("hashchange", () => { if (!takeSetupLink()) render(); });
    radioKeys();
    wireSwipe();
    if (!takeSetupLink()) render();
    setTimeout(refreshGoogle, 2000);
    sweepFiles();
    if (doc.trips.length) OFF.sweep(doc.trips.map((t) => t.id));
    const T = window.Tripboard;
    if (T.sync) {
      T.sync.onStatus = () => { if (syncPaint) syncPaint(); };
      T.sync.start({ getDoc: () => doc, adopt, version: () => version, store, coverChanged, filesChanged: sweepFiles });
    }
    SHARE.onChange = () => { if (view.mode === "share") render(); };
    if (driveOn()) {
      // A browser that had to leave for Google's page comes back here.
      if (DRIVE.resume === "connect") setTimeout(connectDrive, 1500);
      else if (DRIVE.resume === "backup") setTimeout(() => backupToDrive(false), 3000);
      else if (DRIVE.resume === "list") { location.hash = "#/settings/drive"; setTimeout(() => loadDriveList(false), 1000); }
      setTimeout(maybeDriveBackup, 20000);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") setTimeout(maybeDriveBackup, 5000); });
    }
    SHARE.start({ getDoc: () => doc, adopt, version: () => version, store, coverChanged, filesChanged: sweepFiles, unshared });
  }

  // Sync's side: a doc it merged comes in as it is (already stamped by
  // whichever device made each change), and a cover it fetched is redrawn.
  function adopt(next) {
    next = M.sanitizeDoc(next);
    if (JSON.stringify(next) === JSON.stringify(doc)) return;
    doc = next;
    lastSaved = JSON.stringify(doc);
    saveDoc(doc);
    render();
  }
  // A shared trip that stopped being shared with you stays here, as your
  // own: you own this copy, and nobody else is on it.
  function unshared(id, why) {
    const t = findTrip(id);
    if (!t) return;
    const me = SET.get().me;
    if (t.owner !== me.id) {
      t.owner = me.id;
      t.members = [{ id: me.id, name: me.name, role: "owner" }];
      delete t.share;
    } else t.members = (t.members || []).filter((m) => m.id === me.id);
    t.updatedAt = new Date().toISOString();
    save();
    if (why === "removed" || why === "ended") toast(i18n.t("{name} isn't shared with you any more. Your copy stays here.", { name: t.name }));
  }
  function coverChanged(id) {
    if (covers.get(id)) URL.revokeObjectURL(covers.get(id));
    covers.delete(id);
    render();
  }

  window.Tripboard.views = { start, el, render: () => render(), adopt, coverChanged, version: () => version, get doc() { return doc; } };
})();
