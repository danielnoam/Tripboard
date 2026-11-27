// Tripboard's screens: Home (new trip, my trips) and a trip's board, and
// the trip and place sheets. app.js starts it with the loaded data; every
// change goes through save(), which keeps the store and the screen in step.
(function () {
  const M = window.Tripboard.model;
  const icon = window.Tripboard.icon;
  const catIcon = window.Tripboard.catIcon;
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
  // Dates and times, in Settings › Display's clock and (in English) date order.
  const dateLang = () => { const d = SET.get().display.dates; return i18n.lang === "en" && d ? (d === "dm" ? "en-GB" : "en-US") : i18n.lang; };
  const fmt = (opts) => { const c = SET.get().display.clock; return new Intl.DateTimeFormat(dateLang(), opts.hour && c ? { ...opts, hour12: c === "12" } : opts); };
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
  const hm = (t) => (SET.get().display.clock === "12" ? fmt({ hour: "numeric", minute: "2-digit" }).format(new Date("2000-01-01T" + t + ":00")) : t);
  // On a day: a stay's check-in or check-out, when it's that day. Without
  // one (sorts other than time, the map): both.
  function timeLabel(p, day) {
    if (M.isStay(p)) {
      const part = day ? M.stayPart(p, day) : null;
      const cin = p.time && part !== "out" && part !== "night" ? i18n.t("Check-in {time}", { time: hm(p.time) }) : "";
      const cout = p.endTime && part !== "in" && part !== "night" ? i18n.t("Check-out {time}", { time: hm(p.endTime) }) : "";
      // A non-breaking hyphen, so "Check-in" doesn't break over two lines.
      return [cin, cout].filter(Boolean).join(" · ").replace(/-/g, "\u2011");
    }
    return p.time ? hm(p.time) + (p.endTime ? "–" + hm(p.endTime) : "") : "";
  }
  // A destination's dates, "Feb 6 – 13", or "No dates".
  function destRange(d) {
    if (!d.start) return i18n.t("No dates");
    const f = fmt({ day: "numeric", month: "short" });
    return d.end === d.start ? f.format(asDate(d.start)) : f.formatRange ? f.formatRange(asDate(d.start), asDate(d.end)) : f.format(asDate(d.start)) + " – " + f.format(asDate(d.end));
  }

  let doc, store, motion, saveDoc;
  const covers = new Map();
  const view = { trip: null, sort: "time", only: [], mapCats: [], stars: "", check: false, unplacedOpen: false, destShut: [], from: null, mode: "board", pick: null, sel: null, deskMap: true, split: 0 };
  try { Object.assign(view, JSON.parse(localStorage.getItem("tripboard.view") || "{}"), { trip: null }); } catch (e) { /* first visit */ }
  // The Plan goes by time or destination; category, importance, rating and
  // distance were views of their own up to 0.7, and are filters (or gone) now.
  if (view.sort !== "area") view.sort = "time";
  if (!M.STAR_FILTERS.includes(view.stars)) view.stars = "";
  view.check = view.check === true;
  const remember = () => { try { localStorage.setItem("tripboard.view", JSON.stringify({ sort: view.sort, only: view.only, mapCats: view.mapCats, stars: view.stars, check: view.check, unplacedOpen: view.unplacedOpen, destShut: view.destShut, deskMap: view.deskMap, split: view.split })); } catch (e) { /* private window */ } };

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
  let toastTimer = null, undoUntil = 0;
  function toast(text, undo, act) {
    let box = $("toast");
    if (!box) { box = el("div.toast", { role: "status" }); box.id = "toast"; document.body.append(box); }
    clearTimeout(toastTimer);
    const tap = undo || (act && act.run);
    box.replaceChildren(el("span", { text }), ...(tap ? [el("button.btn.quiet", { type: "button", text: undo ? i18n.t("Undo") : act.label,
      onclick: () => { box.hidden = true; undoUntil = 0; tap(); } })] : []));
    box.hidden = false;
    const ms = undo ? 8000 : act ? 6000 : 3000;
    undoUntil = undo ? Date.now() + ms : 0;
    toastTimer = setTimeout(() => { box.hidden = true; undoUntil = 0; }, ms);
  }
  // What a sync brought from your other devices, the AI connector or a
  // shared trip's people, as one note. It waits for an Undo note to go, so
  // a sync never takes your Undo away.
  let arrivalTimer = null;
  function tellArrivals(came) {
    const { added, updated, removed } = came;
    if (!added.length && !updated.length && !removed.length) return;
    const parts = [];
    if (added.length === 1) parts.push(i18n.t("New trip: {name}.", { name: added[0].name }));
    else if (added.length && added.length <= 3) parts.push(i18n.t("New trips: {join}.", { join: i18n.join(added.map((t) => t.name)) }));
    else if (added.length) parts.push(i18n.tn(added.length, "1 new trip.", "{n} new trips."));
    if (updated.length === 1) parts.push(i18n.t("{name} was updated.", { name: updated[0].name }));
    else if (updated.length && updated.length <= 3) parts.push(i18n.t("Updated: {join}.", { join: i18n.join(updated.map((t) => t.name)) }));
    else if (updated.length) parts.push(i18n.tn(updated.length, "1 trip was updated.", "{n} trips were updated."));
    if (removed.length === 1) parts.push(i18n.t("{name} was deleted on another device.", { name: removed[0].name }));
    else if (removed.length) parts.push(i18n.tn(removed.length, "1 trip was deleted on another device.", "{n} trips were deleted on another device."));
    const one = added.length === 1 && !updated.length && !removed.length && view.trip !== added[0].id ? added[0] : null;
    const show = () => {
      if (Date.now() < undoUntil) { clearTimeout(arrivalTimer); arrivalTimer = setTimeout(show, undoUntil - Date.now() + 200); return; }
      toast(parts.join(" "), null, one ? { label: i18n.t("Open"), run: () => { go("#/trip/" + one.id); } } : null);
    };
    show();
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

  const artUrl = (name) => (M.COVER_ART.includes(name) ? "assets/covers/" + name + ".svg" : null);
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
    coverUrl(trip).then((url) => { const src = url || artUrl(trip.art); if (src) box.append(el("img", { src, alt: "" })); });
    return box;
  }

  // ---------- Importing a Google Maps list (src/listimport.js) ----------
  // The places come in at once (Undo takes them all back); the ones without
  // a location are then looked up by name with Find by name, one at a time.
  // opts: { importance, category, day } for every new place (Paste a list).
  async function importList(trip, items, opts = {}) {
    const have = new Set(placesOf(trip.id).map((p) => p.name.toLowerCase()));
    const stamp = new Date().toISOString();
    const fresh = [];
    for (const it of items) {
      if (have.has(it.name.toLowerCase())) continue;
      have.add(it.name.toLowerCase());
      const p = { id: M.newId(), trip: trip.id, name: it.name, category: opts.category || "other", importance: opts.importance || "want", createdAt: stamp, updatedAt: stamp };
      if (opts.day) p.day = opts.day;
      if (it.note) p.note = it.note;
      if (it.lat != null) Object.assign(p, { lat: it.lat, lng: it.lng });
      fresh.push(p);
    }
    if (!fresh.length) { toast(items.length ? i18n.t("Those places are all in this trip already.") : i18n.t("No places found in that.")); return; }
    undoable(i18n.tn(fresh.length, "Imported 1 place.", "Imported {n} places."), () => { doc.places.push(...fresh); });
    await locateImported(trip, fresh.filter((p) => p.lat == null).map((p) => p.id));
  }
  // Two names for the same place: one holds the other, once accents, case
  // and punctuation are set aside ("pasteis de belem" and "Pastéis de Belém").
  const plainName = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const sameName = (a, b) => { const x = plainName(a), y = plainName(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };
  // Each one is looked up and takes the first answer. One it found under
  // another name, or didn't find, is marked To check.
  async function locateImported(trip, ids) {
    if (!ids.length || navigator.onLine === false) return;
    const prov = SET.get().providers;
    const known = cats().map(([id]) => id);
    let found = 0, unsure = 0;
    for (const [i, id] of ids.entries()) {
      const p = doc.places.find((x) => x.id === id);
      if (!p) continue;
      toast(i18n.t("Finding {name} on the map ({at} of {total})…", { name: p.name, at: i + 1, total: ids.length }));
      const near = placesOf(trip.id).filter((x) => x.lat != null);
      let r = null, asked = false;
      try {
        const got = await keyedSearch(p.name + (trip.destinations[0] && !near.length ? ", " + trip.destinations[0] : ""),
          { chain: SET.chain("search"), keys: { google: prov.google.key, maptiler: prov.maptiler.key }, near });
        r = got.results[0];
        asked = true;
      } catch (e) { /* stays without a location */ }
      const cur = doc.places.find((x) => x.id === id);
      if (cur && cur.lat == null && asked) {
        if (r) {
          Object.assign(cur, { lat: r.lat, lng: r.lng, updatedAt: new Date().toISOString() });
          if (r.source === "google") Object.assign(cur, { placeId: r.placeId, geoAt: new Date().toISOString().slice(0, 10) });
          else if (r.address) cur.address = r.address;
          if (r.category && known.includes(r.category) && cur.category === "other") cur.category = r.category;
          found++;
        }
        if (!r || !sameName(cur.name, r.name)) { cur.check = true; cur.updatedAt = new Date().toISOString(); unsure++; }
        save();
      }
      // OpenStreetMap asks for about one search a second.
      await new Promise((ok) => setTimeout(ok, 1100));
    }
    toast(!unsure && found === ids.length ? i18n.tn(found, "Found 1 place on the map.", "Found all {n} places on the map.")
      : unsure ? i18n.tn(unsure, "Found {found} of {total} on the map. 1 is under To check: see that it's the right one.", "Found {found} of {total} on the map. {n} are under To check: see that they're the right ones.", { found, total: ids.length })
      : i18n.t("Found {found} of {total} on the map. The rest have no location yet; Find by name or Pin on map in each one.", { found, total: ids.length }));
  }

  // ---------- Paste a list ----------
  // One place a line (listimport.js's pasted), what it understood shown as
  // it's typed, and the same importance, category and day for all of them.
  let pasteTrip = null, pasteImp = "want";
  function openPaste(trip, from) {
    pasteTrip = trip;
    const f = $("pasteForm");
    f.reset();
    pasteImp = "want";
    $("pasteImp").replaceChildren(...M.IMPORTANCE.map(([id, label]) =>
      el("button.imp-" + id, { type: "button", role: "radio", "aria-checked": String(id === pasteImp), text: label,
        onclick: () => { pasteImp = id; for (const b of $("pasteImp").children) b.setAttribute("aria-checked", String(b.classList.contains("imp-" + id))); } })));
    $("pasteCat").replaceChildren(el("option", { value: "", text: i18n.t("From the search") }), ...cats().map(([id, label]) => el("option", { value: id, text: label })));
    const days = M.tripDays(trip, placesOf(trip.id));
    $("pasteDay").hidden = !trip.start;
    $("pasteDayInput").hidden = !!trip.start;
    $("pasteDay").replaceChildren(el("option", { value: "", text: i18n.t("No date") }),
      ...days.map((d) => el("option", { value: d, text: trip.start ? i18n.t("Day {n} · {date}", { n: M.dayIndex(trip, d), date: dayLabel(d) }) : dayLabel(d) })));
    paintPaste();
    openSheet($("pasteSheet"), from);
    $("pasteText").focus();
  }
  function pastedNow() {
    const got = window.Tripboard.listImport.pasted($("pasteText").value);
    const have = new Set(placesOf(pasteTrip.id).map((p) => p.name.toLowerCase()));
    return { ...got, fresh: got.places.filter((p) => !have.has(p.name.toLowerCase())), dupes: got.places.filter((p) => have.has(p.name.toLowerCase())).length };
  }
  function paintPaste() {
    const got = pastedNow(), n = got.fresh.length;
    $("pasteFound").hidden = !got.places.length && !got.short;
    $("pasteCount").textContent = i18n.tn(n, "1 place", "{n} places");
    $("pasteList").replaceChildren(...got.fresh.map((p) => el("li", {},
      el("span.paste-ic" + (p.lat != null ? ".on" : ""), {}, icon(p.lat != null ? "pin" : p.from === "link" ? "link" : "search")),
      el("strong", { text: p.name, dir: "auto" }),
      el("span.dim", { text: p.lat != null ? i18n.t("Has a location") : i18n.t("Found by name") }))));
    const where = pasteTrip.destinations[0];
    $("pasteHow").textContent = [
      got.fresh.some((p) => p.lat == null) ? (where ? i18n.t("Names are looked up near {where} after adding, about one a second. Any it isn't sure of go under To check.", { where }) : i18n.t("Names are looked up after adding, about one a second. Any it isn't sure of go under To check.")) : "",
      got.dupes ? i18n.tn(got.dupes, "1 is in this trip already.", "{n} are in this trip already.") : "",
      got.short ? i18n.tn(got.short, "1 short link (maps.app.goo.gl) can't be read here: paste the place's name instead.", "{n} short links (maps.app.goo.gl) can't be read here: paste the places' names instead.") : "",
    ].filter(Boolean).join(" ");
    $("pasteGo").disabled = !n;
    $("pasteGoLabel").textContent = n ? i18n.tn(n, "Add 1 place", "Add {n} places") : i18n.t("Add places");
  }
  $("pasteText").addEventListener("input", paintPaste);
  $("pasteForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const got = pastedNow();
    if (!got.fresh.length) return;
    const trip = pasteTrip;
    const day = trip.start ? $("pasteDay").value : $("pasteDayInput").value;
    await closeSheet($("pasteSheet"));
    await importList(trip, got.fresh, { importance: pasteImp, category: $("pasteCat").value, day: M.isDay(day) ? day : "" });
  });
  $("placePaste").addEventListener("click", async () => {
    const trip = placeTrip;
    await closeSheet($("placeSheet"));
    openPaste(trip);
  });

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
    if (list) showLinkRow(false);
    if (list) {
      $("tripListCount").textContent = list.title ? i18n.tn(n, "1 place from {name}", "{n} places from {name}", { name: list.title }) : i18n.tn(n, "1 place", "{n} places");
      $("tripListHow").textContent = located === n ? i18n.t("All of them have a location.")
        : !located ? i18n.t("They're found on the map by name once the trip is made.")
        : i18n.tn(located, "1 has a location; the rest are found on the map by name once the trip is made.", "{n} have a location; the rest are found on the map by name once the trip is made.");
    }
    $("tripDestHint").textContent = list && located < n ? i18n.t("With a list, add its city as a destination too, so places are found in the right one.") : i18n.t("Places go with the nearest destination by themselves. One without dates suits a day trip.");
    $("tripSave").textContent = editingTrip ? i18n.t("Save") : list ? i18n.tn(n, "Create trip with 1 place", "Create trip with {n} places") : i18n.t("Create trip");
  }
  // Add from link opens the link's box under the two buttons, and closes it.
  function showLinkRow(on) {
    $("tripImportLinkRow").hidden = !on;
    $("tripFromLink").setAttribute("aria-expanded", String(on));
    $("tripImportHint").textContent = on ? i18n.t("The link from Share on a Google Maps list.")
      : editingTrip ? i18n.t("A list from Google Takeout (Saved, as CSV), a map from My Maps (Export to KML), or Saved Places.json.")
      : i18n.t("A trip saved from Tripboard, or a Google Maps list: Takeout (CSV), My Maps (KML) or Saved Places.json.");
  }
  $("tripFromFile").prepend(icon("file"));
  $("tripFromLink").prepend(icon("link"));
  $("coverRemove").append(icon("x"));
  $("tripFromLink").addEventListener("click", () => {
    const on = $("tripImportLinkRow").hidden;
    showLinkRow(on);
    if (on) $("tripImportLink").focus();
  });
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
    // A trip saved from Tripboard (or a backup) comes in whole, as Restore does.
    let data = null;
    if (/\.json$/i.test(file.name)) { try { data = JSON.parse(text); } catch (err) { /* not JSON: a list's parser says so */ } }
    if (data && data.app === "tripboard") {
      if (editingTrip) { toast(i18n.t("That's a whole trip saved from Tripboard. Open it with Import from file in New trip.")); return; }
      if (await restoreData(data)) await closeSheet($("tripSheet"));
      return;
    }
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
        return el("li", {}, el("a.trip-card", { href: "#/trip/" + t.id + (M.tripStatus(t, today()) === "now" ? "/today" : ""), "data-trip": t.id },
          coverBox(t, "trip-cover"),
          el("div.trip-text", {},
            el("strong", { text: t.name }),
            el("span.dim", { text: [rangeLabel(t), i18n.tn(n, "1 place", "{n} places")].join(" · ") }),
            t.destinations.length ? el("span.dim", { text: t.destinations.join(", ") }) : null),
          when ? el("span.badge", { text: when }) : null));
      }),
      // On a computer, a last card that starts a new trip (the top button does the same; this one only for the mouse).
      el("li.new-card-item", {}, el("button.new-card", { type: "button", tabindex: "-1", "aria-hidden": "true", onclick: (e) => openTrip(null, e.currentTarget) },
        icon("plus"), el("span", { text: i18n.t("New trip") })))));
    }
    if (!store.persistent) main.append(el("p.note", { text: i18n.t("This browser isn't keeping data: trips last until the tab closes.") }));
    main.append(el("p.dim.version", { text: i18n.t("Version {version}", { version: window.Tripboard.version }) }));
  }

  // ---------- A trip's board ----------
  const SORTS = [["time", i18n.t("Time")], ["area", i18n.t("Destination")]];
  const sortsOf = (trip) => SORTS.filter(([id]) => id !== "area" || trip.destinations.length);
  function pickSort(id, seg) {
    segWas = segSpot(seg);
    view.sort = id;
    remember();
    render();
  }
  const starsLabel = (n) => i18n.tn(n, "1 star", "{n} stars");
  function renderBoard(main, trip) {
    $("title").textContent = trip.name;
    const places = placesOf(trip.id);
    // By destination needs destinations; without, the Plan goes by time.
    if (view.sort === "area" && !trip.destinations.length) view.sort = "time";
    const hero = coverBox(trip, "hero");
    hero.append(el("div.hero-text", {},
      el("span", { text: rangeLabel(trip) + (whenLabel(trip) ? " · " + whenLabel(trip) : "") }),
      trip.destinations.length ? el("ul.chips", {}, trip.destinations.map((d) => el("li", { text: d }))) : null));
    if (!document.body.classList.contains("land")) main.append(hero);

    const controls = el("div.controls", {},
      el("div.seg.sorts", { role: "tablist", "aria-label": i18n.t("Sort places by") }, segBubble(), sortsOf(trip).map(([id, label]) =>
        el("button", { type: "button", role: "tab", "aria-selected": String(view.sort === id), text: label,
          onclick: (e) => pickSort(id, e.currentTarget.parentNode) }))),
      places.length ? el("div.filters", { role: "group", "aria-label": i18n.t("Show") }, filterChips(trip)) : null);
    if (document.body.classList.contains("land")) $("title").after(controls);
    else main.append(controls);
    slideSeg(controls.firstChild);
    const ask = wxAsk(trip);
    if (ask) main.append(ask);

    if (!places.length) {
      main.append(el("div.empty", {}, el("p", { text: i18n.t("Nothing planned yet.") }), el("p.dim", { text: i18n.t("Add the first place with +.") })));
      return;
    }
    const kept = M.filterPlaces(places, { only: view.only, categories: view.mapCats, stars: view.stars, check: view.check });
    if (view.sort === "area") {
      const wrap = el("div.groups.areas");
      const blocks = M.board(trip, kept, "area");
      if (canDrag() && blocks.some((g) => g.dest)) {
        wireAreaDrag(wrap, trip);
      }
      for (const g of blocks) wrap.append(area(trip, g, blocks.length === 1));
      main.append(wrap);
      return;
    }
    const groups = M.board(trip, kept, "time");
    const wrap = el("div.groups");
    if (canDrag()) wireDrag(wrap);
    const wx = wxDays(trip);
    for (const g of groups) {
      if (g.day) g.lands = M.arrivals(kept, g.day);
      wrap.append(group(trip, g, wx));
    }
    main.append(wrap);
    // Today's "Show all" opens the Plan at that destination's list.
    if (view.focus) {
      const at = wrap.querySelector('[data-drop="' + CSS.escape(view.focus) + '"]');
      view.focus = null;
      if (at) requestAnimationFrame(() => at.scrollIntoView({ block: "start" }));
    }
  }

  // A trip's tabs, in the bar's order: Today sits in the middle while the
  // trip is under way (and leads back to today), or as Day while one day
  // opened from the Plan is showing.
  const tripTabs = (trip) => {
    const now = underWay(trip);
    return [["board", "list", i18n.t("Plan"), ""], ["map", "map", i18n.t("Map"), "/map"], ["today", "sun", now ? i18n.t("Today") : i18n.t("Day"), now ? "/today" : "/today/" + view.day],
      ["expenses", "wallet", i18n.t("Expenses"), "/expenses"], ["files", "paperclip", i18n.t("Attachments"), "/files"]].filter(([mode]) => (mode === "today" ? now || view.mode === "today" : sees(trip, mode)));
  };
  // One day's page, from a day's heading on the Plan.
  const dayHref = (trip, day) => "#/trip/" + trip.id + "/today" + (day === today() && underWay(trip) ? "" : "/" + day);
  // On a computer's wide screen a trip is laid out for it: its tabs in a
  // side bar at the start instead of the pill at the bottom, and the map
  // beside the Plan, Today, Expenses and Files (folded away with the handle
  // on its edge, kept on this device), or the map alone from the side
  // bar's Map. A phone, and a narrow window, keep the bottom bar.
  const DESK = window.matchMedia("(min-width: 1100px)");
  const desk = () => DESK.matches;
  const deskTrip = () => desk() && !!view.trip && view.mode !== "share";
  // A phone on its side is short and wide: a trip's tabs go to a rail at
  // the start, the Plan's switch and filters into the top bar, and the
  // Plan is laid out in columns as on a computer.
  const LAND = window.matchMedia("(orientation: landscape) and (max-height: 500px)");
  const land = () => LAND.matches && !desk();
  const sideMap = () => deskTrip() && view.deskMap && view.mode !== "map";
  const mapOn = () => view.mode === "map" || sideMap();
  // On a computer a trip's page scrolls by itself, beside the side bar and the map.
  const scrollTop = () => (document.body.classList.contains("desk") ? $("app").scrollTop : window.scrollY);
  // The line between the page and the map drags to share the width between
  // them. view.split is the page's share of what the side bar leaves (0: the
  // CSS default), kept to at least 380 px for the page and 320 for the map.
  const SPLIT_MIN = 380, MAP_MIN = 320;
  const splitRoom = () => window.innerWidth - $("side").offsetWidth;
  function applySplit() {
    const room = splitRoom(), split = $("deskSplit");
    if (!view.split || room <= SPLIT_MIN + MAP_MIN) document.body.style.removeProperty("--panel");
    else document.body.style.setProperty("--panel", Math.round(Math.min(Math.max(view.split * room, SPLIT_MIN), room - MAP_MIN)) + "px");
    const w = $("app").offsetWidth;
    split.setAttribute("aria-valuemin", String(Math.round(SPLIT_MIN / room * 100)));
    split.setAttribute("aria-valuemax", String(Math.round((room - MAP_MIN) / room * 100)));
    split.setAttribute("aria-valuenow", String(Math.round(w / room * 100)));
  }
  function setSplit(px) {
    const room = splitRoom();
    view.split = Math.min(Math.max(px, SPLIT_MIN), room - MAP_MIN) / room;
    applySplit();
    TM.resize();
  }
  function wireSplit() {
    const split = $("deskSplit");
    const rtl = () => document.documentElement.dir === "rtl";
    const at = (e) => (rtl() ? window.innerWidth - e.clientX : e.clientX) - $("side").offsetWidth;
    let frame = 0;
    split.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("#deskFold")) return;
      e.preventDefault();
      split.setPointerCapture(e.pointerId);
      document.body.classList.add("splitting");
    });
    split.addEventListener("pointermove", (e) => {
      if (!split.hasPointerCapture(e.pointerId)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setSplit(at(e)));
    });
    const done = (e) => {
      if (!split.hasPointerCapture(e.pointerId)) return;
      split.releasePointerCapture(e.pointerId);
      document.body.classList.remove("splitting");
      remember();
    };
    split.addEventListener("pointerup", done);
    split.addEventListener("pointercancel", done);
    // A double click goes back to the usual width.
    split.addEventListener("dblclick", (e) => { if (e.target.closest("#deskFold")) return; view.split = 0; applySplit(); TM.resize(); remember(); });
    split.addEventListener("keydown", (e) => {
      const step = { ArrowLeft: -40, ArrowRight: 40 }[e.key];
      if (!step || e.target !== split) return;
      e.preventDefault();
      setSplit($("app").offsetWidth + (rtl() ? -step : step));
      remember();
    });
    window.addEventListener("resize", () => { if (!split.hidden) applySplit(); });
  }
  // The folded map's handle keeps clear of the page's scroll bar.
  function fitFold() {
    const main = $("app");
    document.body.style.setProperty("--bar-w", Math.max(0, main.offsetWidth - main.clientWidth) + "px");
  }
  // Folding the map slides it out past the window's edge while the page
  // widens into its room, and back. The fold happens at once; only the look follows.
  const FOLD_MS = 220, FOLD_EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
  function foldMap() {
    const main = $("app"), map = $("mapView"), fold = $("deskFold");
    const opening = !view.deskMap, w0 = main.offsetWidth, f0 = fold.getBoundingClientRect(), m0 = map.getBoundingClientRect();
    view.deskMap = !view.deskMap;
    remember();
    render();
    fitFold();
    if (lessMotion() || !main.animate) return;
    const rtl = document.documentElement.dir === "rtl", out = rtl ? "-100%" : "100%";
    const at = { duration: FOLD_MS, easing: FOLD_EASE };
    const w1 = main.offsetWidth, f1 = fold.getBoundingClientRect();
    if (w0 !== w1) main.animate([{ width: w0 + "px" }, { width: w1 + "px" }], at);
    if (!fold.hidden) fold.animate([{ transform: `translate(${f0.left - f1.left}px, ${f0.top - f1.top}px)` }, { transform: "none" }], at);
    if (opening) {
      if (!map.hidden) map.animate([{ transform: `translateX(${out})` }, { transform: "none" }], at);
      return;
    }
    if (!m0.width) return;
    // The map is hidden by now; a moment more on screen lets it slide away.
    map.hidden = false;
    map.classList.add("map-leaving");
    map.style.setProperty("inset-inline", "auto");
    map.style.setProperty("left", m0.left + "px");
    map.style.setProperty("width", m0.width + "px");
    map.animate([{ transform: "none" }, { transform: `translateX(${out})` }], at).finished.catch(() => {}).then(() => {
      map.classList.remove("map-leaving");
      for (const k of ["inset-inline", "left", "width"]) map.style.removeProperty(k);
      map.hidden = !mapOn();
    });
  }
  function paintSide(trip) {
    const side = $("side"), fold = $("deskFold"), split = $("deskSplit");
    side.hidden = !trip;
    fold.hidden = !trip || view.mode === "map";
    split.hidden = !trip || !sideMap();
    if (!split.hidden) applySplit();
    if (!trip) { side.replaceChildren(); delete side.dataset.trip; return; }
    const label = view.deskMap ? i18n.t("Hide the map") : i18n.t("Show the map");
    fold.setAttribute("aria-label", label);
    fold.title = label;
    fold.setAttribute("aria-expanded", String(view.deskMap));
    // Its cover and name stay as they are while moving between tabs.
    if (side.dataset.trip !== trip.id + "|" + trip.name + "|" + (trip.coverAt || "") + (trip.art || "")) {
      side.dataset.trip = trip.id + "|" + trip.name + "|" + (trip.coverAt || "") + (trip.art || "");
      side.replaceChildren(
        el("a.side-back", { href: "#/", onclick: (e) => { e.preventDefault(); goUp("#/"); } }, icon("back", "icon-back"), el("span", { text: i18n.t("All trips") })),
        coverBox(trip, "side-cover"),
        el("h1.side-name", { text: trip.name }),
        el("p.side-when"),
        el("nav.side-nav", { "aria-label": i18n.t("Show") }),
        el("button.btn.primary.side-add", { type: "button", onclick: (e) => addHere(e.currentTarget) }, icon("plus"), el("span")),
        el("p.side-dests"));
    }
    side.querySelector(".side-when").textContent = rangeLabel(trip) + (whenLabel(trip) ? " · " + whenLabel(trip) : "");
    const n = placesOf(trip.id).length;
    side.querySelector(".side-nav").replaceChildren(...tripTabs(trip).map(([mode, ico, label, path]) =>
      el("a.side-tab", { href: "#/trip/" + trip.id + path, "aria-current": view.mode === mode ? "page" : "false", onclick: () => { view.pick = null; } },
        icon(ico), el("span", { text: label }), mode === "board" && n ? el("span.count", { text: String(n) }) : null)));
    const add = side.querySelector(".side-add");
    add.hidden = !mayEdit(trip) || !!view.pick;
    add.lastChild.textContent = view.mode === "expenses" ? i18n.t("Add an expense") : view.mode === "files" ? i18n.t("Add an attachment") : i18n.t("Add a place");
    const dests = side.querySelector(".side-dests");
    dests.hidden = !trip.destinations.length;
    dests.textContent = trip.destinations.join(" · ");
  }
  // A trip's floating pill at the bottom: Plan, Map, Expenses, Files, as icons.
  function paintTripBar(trip) {
    const bar = $("tripBar");
    const was = !$("bottomBar").hidden && bubble.isConnected && !bubble.hidden ? new DOMMatrix(getComputedStyle(bubble).transform)[document.body.classList.contains("land") ? "m42" : "m41"] : null;
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
    // On the landscape rail the tabs stand in a column, so the circle moves down it.
    const axis = document.body.classList.contains("land") ? "Y" : "X", at = (n) => (axis === "Y" ? n.offsetTop : n.offsetLeft);
    const x = at(on);
    if (bubble.dataset.x === axis + x && bubble.getAnimations().length) return;
    bubble.getAnimations().forEach((a) => a.cancel());
    if (bubble.dataset.x && bubble.dataset.x[0] !== axis) was = null;
    bubble.dataset.x = axis + x;
    bubble.style.transform = "translate" + axis + "(" + x + "px)";
    if (was == null || Math.abs(was - x) < 1 || lessMotion() || !bubble.animate) return;
    const t = onSpring(TAB_BUBBLE), reach = Math.min(1, Math.abs(x - was) / 100);
    const lo = Math.min(...tabs.map(at)), hi = Math.max(...tabs.map(at));
    bubble.animate(TAB_BUBBLE.pts.map((k) => ({ transform: "translate" + axis + "(" + Math.min(hi, Math.max(lo, was + (x - was) * k)) + "px)" })),
      { duration: t.duration, easing: "linear" });
    const stretch = axis === "Y" ? (1 - 0.1 * reach) + " " + (1 + 0.28 * reach) : (1 + 0.28 * reach) + " " + (1 - 0.1 * reach);
    bubble.animate([{ scale: "1 1" }, { scale: stretch, offset: 0.22 }, { scale: "1 1", offset: 0.6 }, { scale: "1 1" }],
      { duration: t.duration, easing: "ease-out" });
    const off = tabs.find((n) => n !== on), dim = off ? getComputedStyle(off).color : null, white = getComputedStyle(on).color;
    if (dim) {
      on.animate([{ color: dim }, { color: dim, offset: 0.3 }, { color: white }], { duration: 260, easing: "linear" });
      const left = tabs.reduce((a, n) => (Math.abs(at(n) - was) < Math.abs(at(a) - was) ? n : a), tabs[0]);
      if (left !== on) left.animate([{ color: white }, { color: dim }], { duration: 160, easing: "linear" });
    }
    swell(on.firstChild, 60);
  }
  // The Plan's Time / Category / Importance switch: its white pill slides
  // to the picked one on the bar's spring, stretching on the way, as the
  // bar's circle does. The switch is drawn again on each pick, so where
  // the pill was is kept from the tap.
  let segWas = null;
  const segBubble = () => el("span.seg-bubble", { "aria-hidden": "true" });
  function segSpot(seg) {
    const b = seg && seg.querySelector(".seg-bubble");
    if (!b) return null;
    const r = b.getBoundingClientRect(), o = seg.getBoundingClientRect();
    return { x: r.left - o.left + seg.scrollLeft, w: r.width, of: seg.className };
  }
  function slideSeg(seg) {
    const was = segWas && segWas.of === seg.className ? segWas : null;
    if (was) segWas = null;
    const b = seg.querySelector(".seg-bubble"), on = seg.querySelector("[aria-selected=true]");
    b.hidden = !on;
    if (!on) return;
    const x = on.offsetLeft, w = on.offsetWidth;
    b.style.transform = "translateX(" + x + "px)";
    b.style.width = w + "px";
    if (x < seg.scrollLeft || x + w > seg.scrollLeft + seg.clientWidth) seg.scrollLeft = x - (seg.clientWidth - w) / 2;
    if (!was || Math.abs(was.x - x) < 1 || lessMotion() || !b.animate) return;
    const t = onSpring(TAB_BUBBLE), reach = Math.min(1, Math.abs(x - was.x) / 100);
    b.animate(TAB_BUBBLE.pts.map((k) => ({ transform: "translateX(" + (was.x + (x - was.x) * k) + "px)", width: Math.max(0, was.w + (w - was.w) * k) + "px" })),
      { duration: t.duration, easing: "linear" });
    b.animate([{ scale: "1 1" }, { scale: (1 + 0.12 * reach) + " " + (1 - 0.08 * reach), offset: 0.22 }, { scale: "1 1", offset: 0.6 }, { scale: "1 1" }],
      { duration: t.duration, easing: "ease-out" });
  }
  // A tab's icon, or the +'s, swells and settles when picked.
  function swell(n, delay) {
    if (!n || !n.animate || lessMotion()) return;
    n.animate([{ transform: "none" }, { transform: "scale(1.22)", offset: 0.35 }, { transform: "scale(0.96)", offset: 0.7 }, { transform: "none" }],
      { duration: 420, delay: delay || 0, easing: "ease-out" });
  }

  // What's on screen before a render, so the tab that leaves can be moved.
  let shownHash = null;
  // How deep a screen is: Home 0, a trip 1, its Sharing 2, Settings 1 and
  // each of its pages one more.
  function depthOf(hash) {
    const sm = /^#\/settings(?:\/(.+))?$/.exec(hash);
    if (sm) { let d = 1; for (let pg = sm[1]; pg; pg = settingsParent(pg)) d++; return d; }
    if (/^#\/trip\/[\w-]+\/share/.test(hash)) return 2;
    return /^#\/(trip|join|p)\//.test(hash) ? 1 : 0;
  }
  function tabBefore() {
    const main = $("app"), map = $("mapView");
    return { hash: shownHash, trip: view.trip, mode: view.mode, kids: [...main.childNodes], cls: main.className,
      box: main.getBoundingClientRect(), map: map.hidden ? null : map.getBoundingClientRect(), bar: document.querySelector(".bar").getBoundingClientRect(), scroll: main.scrollTop, desk: document.body.classList.contains("desk") };
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
    // The top bar is as wide as the screen under it (Home, a trip and
    // Settings differ): rather than jump to its new width, it fades in there.
    const bar = document.querySelector(".bar"), nb = bar.getBoundingClientRect();
    if (kind !== "tab" && b.bar && (Math.abs(b.bar.left - nb.left) > 1 || Math.abs(b.bar.width - nb.width) > 1) && !lessMotion())
      bar.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
    if (desk() && (kind === "tab" || b.trip || view.trip)) { deskFade(b, hash, kind !== "tab"); return; }
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
      // Pinned where it was: its width comes from the body's class, which
      // is already the next screen's (Home 960, a trip 1200, Settings 640),
      // and a scrollbar that comes or goes would move it off centre.
      Object.assign(out.style, { top: b.box.top + "px", left: b.box.left + "px", width: b.box.width + "px" });
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
        map.hidden = !mapOn();
      } else out.remove();
    };
    tabMove = { to: hash, end, hold, into };
    Promise.all(anims.map((a) => a.finished)).then(end, end);
  }


  // A computer's trip tabs: the side bar and the map beside stay, and only
  // the page changes, fading over in place; a slide across a wide window
  // reads as the whole app moving. Into or out of a trip the side bar and
  // the map come or go, so the new screen fades in whole.
  function deskFade(b, hash, whole) {
    const main = $("app");
    if (lessMotion() || !main.animate) return;
    let out = null;
    const anims = [];
    // The old page is drawn by the layout it had; into or out of a trip that's gone, so it isn't kept.
    if (b.mode !== "map" && b.kids.length && view.mode !== "map" && b.desk === document.body.classList.contains("desk")) {
      out = document.createElement("main");
      out.className = b.cls;
      out.classList.add("tab-leaving", "tab-under");
      out.setAttribute("aria-hidden", "true");
      out.inert = true;
      Object.assign(out.style, { top: b.box.top + "px", left: b.box.left + "px", width: b.box.width + "px" });
      out.append(...b.kids);
      document.body.append(out);
      out.scrollTop = b.scroll;
      anims.push(out.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: "ease-in", fill: "forwards" }));
    }
    const rise = [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], at = { duration: 240, delay: out ? 60 : 0, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)", fill: "backwards" };
    if (!main.hidden) anims.push(main.animate(rise, at));
    if (whole) for (const n of [$("side"), $("mapView"), $("deskFold")]) if (!n.hidden) anims.push(n.animate([{ opacity: 0 }, { opacity: 1 }], at));
    if (!anims.length) return;
    const end = () => {
      if (!tabMove || tabMove.end !== end) return;
      tabMove = null;
      anims.forEach((a) => a.cancel());
      if (out) out.remove();
    };
    tabMove = { to: hash, end, hold: () => {}, into: main };
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
    const day = view.day;
    const isToday = day === today();
    const all = placesOf(trip.id);
    const booked = M.dayPlan(all, day);
    const plan = booked.filter((p) => !M.awayStay(trip, p, day));
    const away = booked.filter((p) => M.awayStay(trip, p, day));
    const next = isToday ? M.nextOf(plan) : null;
    const done = plan.filter((p) => p.visited).length;
    const total = trip.end ? M.dayIndex(trip, trip.end) : null;
    const here = M.dayDest(trip, day);
    const n = M.dayIndex(trip, day);
    const inTrip = total && n >= 1 && n <= total;
    const kicker = isToday ? (inTrip ? i18n.t("Today · day {n} of {total}", { n, total }) : i18n.t("Today")) : inTrip ? i18n.t("Day {n} of {total}", { n, total }) : "";
    // The trip's days, one step at a time, and back to today while under way.
    const days = M.tripDays(trip, all);
    const at = days.indexOf(day);
    const before = at > 0 ? days[at - 1] : at < 0 ? days.filter((d) => d < day).pop() : null;
    const after = at >= 0 ? days[at + 1] : days.find((d) => d > day);
    const step = (to, label, ico) => el("a.icon-btn.day-step" + (to ? "" : ".off"), to ? { href: dayHref(trip, to), "aria-label": label, title: label } : { "aria-label": label, "aria-disabled": "true" }, icon(ico));
    main.append(el("header.today-head", {},
      el("div.today-top", {},
        el("p.today-kicker", { text: [kicker, here].filter(Boolean).join(" · ") }),
        el("nav.day-steps", { "aria-label": i18n.t("Days") },
          step(before, i18n.t("The day before"), "prev"),
          !isToday && underWay(trip) ? el("a.btn.quiet.day-back", { href: dayHref(trip, today()), text: i18n.t("Today") }) : null,
          step(after, i18n.t("The day after"), "next"))),
      el("h2.today-date", { text: fmt({ weekday: "long", day: "numeric", month: "long" }).format(asDate(day)) }),
      plan.length ? el("p.dim.today-done", { text: i18n.t("{n} of {total} done", { n: done, total: plan.length }) }) : null));
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

    // An overnight journey landing today goes in among the places by time.
    const lands = M.arrivals(all, day);
    const items = [];
    const left = lands.slice();
    for (const p of plan) {
      while (left.length && (left[0].arriveTime || "99") <= (M.timeOn(p, day) || "99")) items.push({ land: left.shift() });
      items.push(p);
    }
    items.push(...left.map((j) => ({ land: j })));
    if (!items.length) {
      main.append(el("div.empty", {}, el("p", { text: isToday ? i18n.t("Nothing planned for today.") : i18n.t("Nothing planned for this day.") }),
        el("p.dim", { text: !mayEdit(trip) ? i18n.t("The whole trip is on the Plan.") : isToday ? i18n.t("Add a place for today with +, or give one today's date on the Plan.") : i18n.t("Add a place for this day with +, or give one this day's date on the Plan.") })));
    } else {
      const list = el("ol.today");
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      items.forEach((p, i) => {
        // Between two legs, the change; after a journey, from where it lands.
        const prev = i ? items[i - 1].land || items[i - 1] : null;
        if (i && !p.land) {
          const c = M.connection(prev, p);
          const l = c ? null : M.leg(prev, p);
          list.append(el("li.leg", { "aria-hidden": l || c ? null : "true" },
            c ? i18n.t("Change at {place} · {time}", { place: iso(c.at), time: durLabel(c.min) }) : l ? legLabel(l) : ""));
        }
        if (p.land) { list.append(landRow(p.land, trip)); return; }
        const isNext = p === next;
        const journey = M.isJourney(p);
        const meta = catWords() ? [M.catName(cats(), trip, p.category)] : [];
        if (p.endDay && !["in", "out"].includes(M.stayPart(p, day))) meta.push(i18n.t("{n} of {total} days", { n: M.daySpan({ day: p.day, endDay: day }) + 1, total: M.daySpan(p) + 1 }));
        if (timeLabel(p, day)) meta.push(timeLabel(p, day));
        const toHere = isNext && prev && !journey ? M.leg(prev, p) : null;
        const until = journey && isNext && p.day === day && p.time ? +p.time.slice(0, 2) * 60 + +p.time.slice(3) - nowMin : null;
        list.append(el("li.card" + (journey ? ".journey" : ".imp-" + p.importance) + (p.visited ? ".visited" : "") + (isNext ? ".next" : ""), { "data-id": p.id },
          el("div.card-row", {},
            el("button.tick", { type: "button", disabled: !mayEdit(trip), "aria-pressed": String(!!p.visited), "aria-label": p.visited ? i18n.t("Been to {name}", { name: p.name }) : i18n.t("Mark as been to {name}", { name: p.name }),
              onclick: () => { p.visited = !p.visited; p.updatedAt = new Date().toISOString(); save(); } }, icon("check")),
            el("button.card-body", { type: "button", onclick: (e) => openPlace(p, trip, null, e.currentTarget) },
              ...(journey ? journeyParts(p) : [
                el("span.card-name", {}, icon(catIcon(p.category), "cat"), p.name, ratingBadge(p)),
                el("span.card-meta", {}, ...metaParts(p, meta))]),
              p.note ? el("span.card-note", { text: p.note }) : null)),
          isNext ? el("div.next-row", {},
            el("span.next-label", { text: i18n.t("Next") }),
            until != null && until > 0 && until < 24 * 60 ? el("span.jsoon", { text: i18n.t("Leaves in {time}", { time: durLabel(until) }) }) : null,
            el("a.btn.primary", { href: directions(p, toHere && toHere.mode), target: "_blank", rel: "noopener noreferrer", text: i18n.t("Navigate"),
              "aria-label": i18n.t("Navigate to {name}", { name: p.name }) })) : null));
      });
      main.append(list);
      if (plan.some((p) => p.lat != null)) main.append(el("p.hint.dim", { text: i18n.t("Times are guesses from the straight line between places.") }));
    }
    if (away.length) {
      main.append(el("section.also-booked", { "aria-label": i18n.t("Also booked") },
        el("span.also-booked-ic", {}, icon("bed")),
        el("div", {},
          el("p.dim.also-booked-label", { text: i18n.t("Also booked") }),
          ...away.map((p) => el("button.also-booked-name", { type: "button", onclick: (e) => openPlace(p, trip, null, e.currentTarget) },
            el("span", { text: p.name }), el("span.dim", { text: " · " + i18n.t("{n} of {total} nights", { n: M.daySpan({ day: p.day, endDay: day }) + 1, total: M.daySpan(p) }) }))))));
    }

    // The destination's places with no day yet, to fit in while there.
    const rank = (p) => M.IMPORTANCE.findIndex(([x]) => x === p.importance);
    const open = here ? all.filter((p) => !p.day && !p.visited && M.destOf(trip, p) === here).sort((a, b) => rank(a) - rank(b)) : [];
    if (open.length) {
      main.append(el("section.panel.also", {},
        el("div.also-head", {}, el("h2", { text: i18n.t("Also in {name}", { name: here }) }), el("span.dim", { text: String(open.length) })),
        el("p.dim", { text: i18n.t("No day yet, most important first.") }),
        cards(trip, open.slice(0, 3), {}),
        open.length > 3 ? el("button.btn.quiet", { type: "button", text: i18n.t("Show all {n}", { n: open.length }), onclick: () => {
          const k = destKey(trip, here);
          if (view.destShut.includes(k)) { view.destShut = view.destShut.filter((x) => x !== k); remember(); }
          view.focus = "any:" + here;
          go("#/trip/" + trip.id);
        } }) : null));
    }

    const tomorrow = M.addDays(day, 1);
    const later = trip.end && tomorrow <= trip.end ? M.dayPlan(all, tomorrow).filter((p) => !M.awayStay(trip, p, tomorrow)) : [];
    if (later.length) {
      main.append(el("a.panel.tomorrow", { href: dayHref(trip, tomorrow) },
        el("span.tomorrow-head", {}, el("h2", { text: isToday ? i18n.t("Tomorrow") : i18n.t("The day after") }), wx && wx[tomorrow] ? wxChip(wx[tomorrow]) : null, el("span.dim", { text: String(later.length) })),
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
      main.append(el("div.empty", {}, el("p", { text: i18n.t("Nothing here yet.") }),
        el("p.dim", { text: window.matchMedia("(pointer: fine)").matches ? i18n.t("Keep tickets, bookings, links and notes with the trip, to open without a connection. Add one with +, or drop a file here.") : i18n.t("Keep tickets, bookings, links and notes with the trip, to open without a connection. Add one with +.") })));
      return;
    }
    const placeName = (f) => { const p = f.place && doc.places.find((x) => x.id === f.place); return p ? p.name : ""; };
    const local = (f) => (f.local ? el("span.attached-local", { title: i18n.t("Only this device"), "aria-label": i18n.t("Only this device") }, icon("phone")) : null);
    const row = (f) => {
      const meta = f.kind === "link" ? [M.linkHost(f.url), placeName(f)]
        : f.kind === "note" ? [firstLine(f.text), placeName(f)]
        : [kindOf(f), sizeLabel(f.size), placeName(f), haveFiles.has(f.id) ? "" : i18n.t("not on this device yet")];
      return el("button.xrow", { type: "button", onclick: (e) => openEntry(f, trip, e.currentTarget) },
        el("span.xrow-ic", {}, icon(entryIcon(f))),
        el("span.xrow-text", {}, el("span.xrow-title", { text: f.name }), el("span.xrow-meta", { text: meta.filter(Boolean).join(" · ") })), local(f));
    };
    const byAdded = (a, b) => String(a.createdAt).localeCompare(String(b.createdAt));
    const wrap = el("div.groups.files-groups");
    for (const [kind, title, items] of [["note", i18n.t("Notes"), list.filter((f) => f.kind === "note").sort(byAdded)],
      ["link", i18n.t("Links"), list.filter((f) => f.kind === "link").sort(byAdded)], ["file", i18n.t("Files"), list.filter(M.hasBytes)]]) {
      if (items.length) wrap.append(el("section.group.files-" + kind, {}, el("div.group-head", {}, el("h2", { text: title }), el("span.count", { text: String(items.length) })),
        el("div.xrows", {}, items.map(row))));
    }
    main.append(wrap);
    if (window.matchMedia("(pointer: fine)").matches) main.append(el("p.dim.hint.page-hint", { text: i18n.t("Drop files here to add them.") }));
  }
  const entryIcon = (f) => (f.kind === "link" ? "link" : f.kind === "note" ? "note" : f.type.startsWith("image/") ? "image" : "file");
  const firstLine = (t) => { const l = String(t || "").split("\n").find((x) => x.trim()) || ""; return l.length > 80 ? l.slice(0, 80) + "…" : l; };
  function openEntry(f, trip, from) {
    if (f.kind === "link") openLink(f, trip, from);
    else if (f.kind === "note") openNote(f, trip, from);
    else openFile(f, trip, from);
  }

  // The + on Attachments, and Attach in Edit place: a file, a link or a note.
  const kindTrip = () => (sheetPlace() ? placeTrip : findTrip(view.trip));
  $("addKindFile").addEventListener("click", async () => { await closeSheet($("addKindSheet")); attachTo = sheetPlace(); $("fileAdd").click(); });
  $("addKindLink").addEventListener("click", async () => { await closeSheet($("addKindSheet")); const t = kindTrip(); if (t) openLink(null, t); });
  $("addKindNote").addEventListener("click", async () => { await closeSheet($("addKindSheet")); const t = kindTrip(); if (t) openNote(null, t); });

  // A link's or note's sheet: Kept, and the place it belongs to.
  function keptSeg(prefix, get, set) {
    const paint = () => {
      $(prefix + "KeptSeg").replaceChildren(...[[false, i18n.t("Synced")], [true, i18n.t("Only this device")]].map(([local, label]) =>
        el("button", { type: "button", role: "radio", "aria-checked": String(get() === local), text: label, onclick: () => { set(local); paint(); } })));
      $(prefix + "KeptHint").textContent = get() ? i18n.t("Stays here. Other devices and other people don't see it.") : i18n.t("On all your devices, and with everyone the trip is shared with.");
    };
    paint();
  }
  function placeOptions(select, trip, value) {
    select.replaceChildren(el("option", { value: "", text: i18n.t("None") }),
      ...placesOf(trip.id).slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => el("option", { value: p.id, text: p.name })));
    select.value = value && placesOf(trip.id).some((p) => p.id === value) ? value : "";
  }
  const sheetPlace = () => ($("placeSheet").open && editingPlace ? editingPlace.id : "");
  // Adds a new link or note, or changes the one being edited.
  function keepEntry(editing, trip, fields, local) {
    if (editing) {
      const f = (doc.files || []).find((x) => x.id === editing.id);
      if (f) { Object.assign(f, fields); if (local) f.local = true; else delete f.local; }
    } else {
      const stamp = new Date().toISOString();
      doc.files = (doc.files || []).concat(M.sanitizeFile({ id: M.newId(), trip: trip.id, ...fields, local, createdAt: stamp, updatedAt: stamp }));
    }
    save();
    if ($("placeSheet").open) paintPlaceFiles();
  }
  function deleteEntry(btn, sheet, f) {
    btn.hidden = !f;
    if (!f) return;
    armDelete(btn, i18n.t("Delete"), () => {
      closeSheet(sheet);
      undoable(i18n.t("Deleted {name}.", { name: f.name }), () => { doc.files = doc.files.filter((x) => x.id !== f.id); });
      if ($("placeSheet").open) paintPlaceFiles();
    });
  }

  let editingLink = null, linkTrip = null, linkLocal = false;
  function openLink(f, trip, from) {
    againOn($("linkSheet"), "files", f, trip, openLink);
    editingLink = f; linkTrip = trip;
    const form = $("linkForm");
    form.reset();
    form.url.removeAttribute("aria-invalid");
    $("linkSheetTitle").textContent = f ? i18n.t("Link") : i18n.t("Add a link");
    form.url.value = f ? f.url : "";
    form.name.value = f ? f.name : "";
    form.note.value = (f && f.note) || "";
    $("linkOpenRow").hidden = !f || !f.url;
    if (f && f.url) $("linkOpen").href = f.url;
    placeOptions($("linkPlace"), trip, f ? f.place : sheetPlace());
    linkLocal = !!(f && f.local);
    keptSeg("link", () => linkLocal, (v) => { linkLocal = v; });
    deleteEntry($("linkDelete"), $("linkSheet"), f);
    lockForm(form, !mayEdit(trip));
    openSheet($("linkSheet"), from);
    if (!f) form.url.focus();
  }
  $("linkForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const url = M.linkUrl(form.url.value);
    if (!url) { form.url.setAttribute("aria-invalid", "true"); form.url.focus(); toast(i18n.t("That isn't a web address. Links start with http:// or https://.")); return; }
    form.url.removeAttribute("aria-invalid");
    const closing = closeSheet($("linkSheet"));
    keepEntry(editingLink, linkTrip, { kind: "link", url, name: form.name.value.trim() || M.linkHost(url), place: form.place.value, note: form.note.value }, linkLocal);
    await closing;
  });

  let editingNote = null, noteTrip = null, noteLocal = false;
  function openNote(f, trip, from) {
    againOn($("noteSheet"), "files", f, trip, openNote);
    editingNote = f; noteTrip = trip;
    const form = $("noteForm");
    form.reset();
    form.text.removeAttribute("aria-invalid");
    $("noteSheetTitle").textContent = f ? f.name : i18n.t("Add a note");
    form.name.value = f ? f.name : "";
    form.text.value = f ? f.text || "" : "";
    placeOptions($("notePlace"), trip, f ? f.place : sheetPlace());
    noteLocal = !!(f && f.local);
    keptSeg("note", () => noteLocal, (v) => { noteLocal = v; });
    deleteEntry($("noteDelete"), $("noteSheet"), f);
    lockForm(form, !mayEdit(trip));
    openSheet($("noteSheet"), from);
    if (!f) form.name.focus();
  }
  $("noteForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    if (!form.text.value.trim()) { form.text.setAttribute("aria-invalid", "true"); form.text.focus(); return; }
    form.text.removeAttribute("aria-invalid");
    const closing = closeSheet($("noteSheet"));
    keepEntry(editingNote, noteTrip, { kind: "note", text: form.text.value, name: form.name.value.trim() || firstLine(form.text.value).slice(0, 60) || i18n.t("Note"), place: form.place.value }, noteLocal);
    await closing;
  });

  let editingFile = null, fileLocal = false;
  function paintKept() {
    $("fileKeptSeg").replaceChildren(...[[false, i18n.t("Synced")], [true, i18n.t("Only this device")]].map(([local, label]) =>
      el("button", { type: "button", role: "radio", "aria-checked": String(fileLocal === local), text: label, onclick: () => { fileLocal = local; paintKept(); } })));
    $("fileKeptHint").textContent = fileLocal ? i18n.t("Stays here. Other devices and other people don't see it.") : i18n.t("On all your devices, and with everyone the trip is shared with.");
  }
  async function openFile(f, trip, from) {
    againOn($("fileSheet"), "files", f, trip, openFile);
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
    return list.map((f) => {
      // A link shows where it goes, in grey after its name, as far as there's room.
      const where = f.kind === "link" && f.url ? f.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : "";
      const kids = [icon(entryIcon(f)), el("span", { text: f.name }), where ? el("span.attached-url", { text: where, dir: "ltr" }) : null,
        f.local ? el("span.attached-local", { title: i18n.t("Only this device"), "aria-label": i18n.t("Only this device") }, icon("phone")) : null];
      return el("li", {}, f.kind === "link" ? el("a.attached-file", { href: f.url, target: "_blank", rel: "noopener noreferrer" }, ...kids)
        : el("button.attached-file", { type: "button", onclick: (e) => (f.kind === "note" ? openNote(f, findTrip(f.trip), e.currentTarget) : viewFile(f)) }, ...kids));
    });
  }
  function paintPlaceFiles() {
    const on = !!editingPlace && sees(placeTrip, "files");
    $("placeFilesRow").hidden = !on;
    if (on) $("placeFiles").replaceChildren(...fileButtons(filesOn(editingPlace.id)));
    $("placeAttach").hidden = !mayEdit(placeTrip);
  }
  $("placeAttach").addEventListener("click", (e) => {
    if (editingPlace) openSheet($("addKindSheet"), e.currentTarget);
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
    againOn($("expenseSheet"), "expenses", x, trip, openExpense);
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

  // ---------- By destination ----------
  // A destination's block, as in a sheet with a block for each city: its
  // stays, its days, then what has no day yet; trips out of it (a day in
  // Hiroshima from Osaka) sit beside it on a wide screen, under it on a phone.
  function area(trip, g, lone) {
    const k = destKey(trip, "area:" + (g.dest || g.id));
    // A computer has the room to show every block, so they don't fold there,
    // and a block alone on the board has nothing to fold away for.
    const folds = !desk() && !land() && !lone;
    const open = !folds || !view.destShut.includes(k);
    const flip = () => {
      view.destShut = open ? view.destShut.concat(k).slice(-50) : view.destShut.filter((x) => x !== k);
      remember();
      render();
    };
    const all = (g.places || []).concat(g.stays || [], ...(g.side || []).map((s) => s.places.concat(s.stays)));
    const been = all.filter((p) => p.visited && !M.isJourney(p) && !M.isStay(p)).length;
    const counted = all.filter((p) => !M.isJourney(p) && !M.isStay(p)).length;
    const title = g.kind === "travel" ? i18n.t("On the way") : g.dest ? g.dest : i18n.t("No destination");
    const head = el("div.area-head", { draggable: canDrag() && g.dest ? "true" : null, "data-dest": g.dest || null },
      el(folds ? "button.fold" : "div.fold", folds ? { type: "button", "aria-expanded": String(open), onclick: flip } : {},
        icon(g.kind === "travel" ? "plane" : "pin"),
        el("span.area-name", {}, el("h2", { text: title }), el("span.dim", { text: areaWhen(g) })),
        counted ? el("span.area-count", { text: been ? i18n.t("{been} of {n} been", { been, n: counted }) : i18n.tn(counted, "1 place", "{n} places") }) : null,
        folds ? icon("chevron") : null),
      mayEdit(trip) && g.dest ? el("button.icon-btn.small", { type: "button", "aria-label": i18n.t("Add a place to {title}", { title }),
        onclick: (e) => openPlace(null, trip, { dest: g.dest }, e.currentTarget) }, icon("plus")) : null);
    const box = el("section.area" + (open ? ".open" : "") + (g.kind === "travel" ? ".travel" : ""), { "data-area": g.dest || g.id, "data-into": g.dest || null }, head);
    if (!open) {
      if (g.side && g.side.length) box.append(el("p.dim.area-peek", { text: i18n.t("Including {names}", { names: g.side.map((x) => x.dest).join(" · ") }) }));
      return box;
    }
    const cols = el("div.area-cols", {}, areaCol(trip, g, false));
    for (const s of g.side || []) cols.append(areaCol(trip, s, true));
    box.append(cols);
    // On a wide screen blocks share a row by how many columns each needs.
    const n = [...cols.children].reduce((sum, c) => sum + (c.classList.contains("wide") ? 2 : 1), 0);
    box.style.setProperty("--cols", String(n));
    return box;
  }
  // With a mouse: a block's name dragged onto another block puts it inside
  // that one (a day trip from it, dates or not); a column's name dragged
  // onto the strip at the top gives it a block of its own. A place dragged
  // onto a block or column goes with that destination.
  function wireAreaDrag(wrap, trip) {
    let what = null;
    // A destination dropped on empty space between the blocks gets a block of its own.
    const into = (e) => (e.target.closest && e.target.closest("[data-into]")) || (what && what.dest && e.target === wrap ? wrap : null);
    const clear = () => { wrap.classList.remove("drop-over"); wrap.querySelectorAll(".drop-over").forEach((n) => n.classList.remove("drop-over")); };
    wrap.addEventListener("dragstart", (e) => {
      const head = e.target.closest && e.target.closest("[data-dest][draggable=true]");
      const card = !head && e.target.closest && e.target.closest(".card[draggable=true]");
      if (!head && !card) return;
      what = head ? { dest: head.dataset.dest } : { place: card.dataset.id };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", head ? head.dataset.dest : card.querySelector(".card-name").textContent);
      requestAnimationFrame(() => document.body.classList.add(head ? "dragging-dest" : "dragging"));
    });
    wrap.addEventListener("dragend", () => { what = null; clear(); document.body.classList.remove("dragging-dest", "dragging"); });
    const fits = (t) => {
      if (!t || !what) return false;
      const name = t.dataset.into || "";
      if (what.place) return !!name;
      return name !== what.dest;
    };
    wrap.addEventListener("dragover", (e) => {
      const t = into(e);
      clear();
      if (!fits(t)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      t.classList.add("drop-over");
    });
    wrap.addEventListener("drop", (e) => {
      const t = into(e);
      if (!fits(t)) return;
      e.preventDefault();
      const name = t.dataset.into || "", w = what;
      const stamp = new Date().toISOString();
      if (w.place) {
        const p = doc.places.find((x) => x.id === w.place);
        if (!p) return;
        undoable(i18n.t("Moved {name} to {to}.", { name: p.name, to: name }), () => { M.setDest(trip, p, name); p.updatedAt = stamp; });
        return;
      }
      undoable(name ? i18n.t("{name} is inside {to} now.", { name: w.dest, to: name }) : i18n.t("{name} has a block of its own now.", { name: w.dest }), () => {
        const t2 = findTrip(trip.id);
        t2.destInfo = { ...(t2.destInfo || {}), [w.dest]: { ...((t2.destInfo || {})[w.dest] || {}), in: name } };
        // Whatever was inside the one moved in comes along.
        if (name) for (const [k, v] of Object.entries(t2.destInfo)) if (v.in === w.dest) t2.destInfo[k] = { ...v, in: name };
        t2.updatedAt = stamp;
      });
    });
  }
  function areaWhen(g) {
    if (!g.start) return g.kind === "area" ? i18n.t("No dates yet") : "";
    const nights = M.daySpan({ day: g.start, endDay: g.end });
    return destRange(g) + (nights ? " · " + i18n.tn(nights, "1 night", "{n} nights") : "");
  }
  // One column: a trip out (with its own name and dates) or the destination's own.
  function areaCol(trip, g, side) {
    const col = el("div.area-col" + (side ? ".trip-out" : ""), { "data-into": side ? g.dest : null });
    if (side) {
      const nights = g.start ? M.daySpan({ day: g.start, endDay: g.end }) : 0;
      col.append(el("div.area-col-head", { draggable: canDrag() ? "true" : null, "data-dest": g.dest }, el("h3", { text: g.dest }),
        el("span.dim", { text: !g.start ? i18n.t("No dates yet") : destRange(g) + " · " + (nights ? i18n.tn(nights, "1 night", "{n} nights") : i18n.t("Day trip")) })));
    }
    const ctx = { area: true };
    // One stay over the destination's own dates: its dates would only repeat
    // the heading's, so under it go just its check-in and check-out.
    const one = g.stays && g.stays.length === 1 && g.stays[0].day === g.start && (g.stays[0].endDay || g.stays[0].day) === g.end;
    if (g.stays && g.stays.length) col.append(el("h4.slot", { text: i18n.t("Stay") }), cards(trip, g.stays, one ? { area: true, sameDates: true } : ctx));
    const byDay = new Map();
    for (const p of g.places.filter((x) => x.day)) byDay.set(p.day, (byDay.get(p.day) || []).concat(p));
    for (const [day, list] of byDay) col.append(el("h4.slot", {}, el("a.day-open", { href: dayHref(trip, day), title: i18n.t("Open this day") }, el("span", { text: dayLabel(day) }), icon("next", "day-open-ic"))), cards(trip, list, { area: true, day }));
    const rest = g.places.filter((x) => !x.day);
    if (rest.length) col.append(el("h4.slot", { text: byDay.size || (g.stays && g.stays.length) ? i18n.t("Any day") : i18n.t("Places") }), cards(trip, rest, ctx));
    if (col.childElementCount === (side ? 1 : 0)) col.append(el("p.dim.slot-empty", { text: i18n.t("Nothing here yet.") }));
    if (!side && g.side && g.side.length) col.classList.add("main");
    if (!side && rest.length > 14) col.classList.add("wide");
    return col;
  }

  // A destination's run of days starts with its name and dates.
  function destBand(g) {
    const nights = g.start ? M.daySpan({ day: g.start, endDay: g.end }) : 0;
    return el("div.dest-band", {}, icon("pin"),
      el("h2", { text: g.again ? i18n.t("{name}, again", { name: g.dest }) : g.dest }),
      el("span.dim", { text: destRange(g) + (nights ? " · " + i18n.tn(nights, "1 night", "{n} nights") : "") }));
  }
  // Its places with no day yet, folded to a line until opened (kept on this device).
  const destKey = (trip, name) => trip.id + "|" + name;
  function anyDay(trip, g) {
    // They start open, as a spreadsheet's columns.
    const k = destKey(trip, g.dest);
    const open = !view.destShut.includes(k);
    const flip = () => {
      view.destShut = open ? view.destShut.concat(k).slice(-50) : view.destShut.filter((x) => x !== k);
      remember();
      render();
    };
    const n = g.places.length;
    const head = el("div.group-head", {},
      n ? el("h2", {}, el("button.fold", { type: "button", "aria-expanded": String(open), onclick: flip }, el("span.fold-title", { text: g.title }), el("span.count", { text: String(n) }), icon("chevron")))
        : el("h2", { text: g.title }),
      mayEdit(trip) ? el("button.icon-btn.small", { type: "button", "aria-label": i18n.t("Add a place to {title}", { title: g.title }),
        onclick: (e) => openPlace(null, trip, { dest: g.dest }, e.currentTarget) }, icon("plus")) : null);
    const box = el("section.group.dest-any" + (open ? ".open" : ""), { "data-drop": g.id }, head);
    if (!n) box.append(el("p.dim.slot-empty", { text: i18n.t("Places near {name} without a day show here.", { name: g.dest }) }));
    else if (open) box.append(cards(trip, g.places, g));
    else {
      const names = g.places.slice(0, 3).map((p) => p.name);
      box.append(el("p.dim.peek", { text: n > 3 ? i18n.tn(n - 3, "{names} and 1 more", "{names} and {n} more", { names: names.join(", ") }) : names.join(", ") }));
    }
    return box;
  }
  function group(trip, g, wx) {
    if (g.kind === "dest") return destBand(g);
    if (g.kind === "any") return anyDay(trip, g);
    const isDay = !!g.day;
    const title = isDay ? (trip.start ? i18n.t("Day {n} · {date}", { n: M.dayIndex(trip, g.day), date: dayLabel(g.day) }) : dayLabel(g.day)) : g.title;
    const head = el("div.group-head", {},
      isDay ? el("h2", {}, el("a.day-open", { href: dayHref(trip, g.day), title: i18n.t("Open this day") }, el("span", { text: title }), icon("next", "day-open-ic"))) : el("h2", {}, title),
      isDay && wx && wx[g.day] ? wxChip(wx[g.day]) : null,
      el("span.count", { text: String(g.places.length) }),
      mayEdit(trip) ? el("button.icon-btn.small", { type: "button", "aria-label": i18n.t("Add a place to {title}", { title: title }),
        onclick: (e) => openPlace(null, trip, { day: g.day || "" }, e.currentTarget) }, icon("plus")) : null);
    const box = el("section.group", {}, head);
    // On a wide screen days run on without a band for each destination, so each day names its own.
    if (isDay && g.dest) box.prepend(el("p.group-dest", { text: g.dest }));
    box.dataset.drop = g.id;
    if (isDay) {
      const lands = g.lands || [];
      if (!g.slots.length && !lands.length) box.append(el("p.dim.slot-empty", { text: i18n.t("Free day") }));
      // Every slot is drawn, so a place can be dropped into an empty one;
      // the empty ones show only while dragging.
      const have = new Map(g.slots.map((s) => [s.id, s]));
      for (const [id, t] of M.SLOTS.concat([["any", i18n.t("Any time")]])) {
        const s = have.get(id);
        const here = lands.filter((j) => (j.arriveTime ? M.slotOf({ time: j.arriveTime }) : "any") === id);
        box.append(el("div.slot-box" + (s || here.length ? "" : ".drop-only"), { "data-slot": id }, el("h3.slot", { text: t }), cards(trip, s ? s.places : [], g, here)));
      }
    } else if (g.parts) {
      for (const part of g.parts) box.append(el("h3.slot", { text: part.dest || i18n.t("No destination") }), cards(trip, part.places, g));
    } else if (g.places.length) {
      box.append(cards(trip, g.places, g));
    } else {
      box.append(el("p.dim.slot-empty", { text: i18n.t("Places without a day land here.") }));
    }
    return box;
  }

  // ---------- Drag and drop (mouse) ----------
  // Dropping a card on another group changes its day (and time slot), or
  // in Destination, its destination.
  const canDrag = () => window.matchMedia("(pointer: fine)").matches && mayEdit(findTrip(view.trip));
  const SLOT_TIME = { morning: "09:00", afternoon: "14:00", evening: "19:00" };
  const mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
  const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  function movePlace(p, groupId, slot) {
    const before = JSON.stringify([p.day, p.endDay, p.time, p.endTime, p.dest]);
    undoable(i18n.t("Moved {name}.", { name: p.name }), () => shift(p, groupId, slot));
    if (JSON.stringify([p.day, p.endDay, p.time, p.endTime, p.dest]) === before) $("toast").hidden = true;
  }
  function shift(p, groupId, slot) {
    if (groupId !== p.day) delete p.order;
    // "any:<name>": no day, in that destination.
    if (groupId === "nodate" || groupId.startsWith("any:")) {
      delete p.day; delete p.endDay; delete p.time; delete p.endTime;
      if (groupId !== "nodate") M.setDest(findTrip(p.trip), p, groupId.slice(4));
    } else {
      // A place over several days moves as a whole: it starts on the day it's dropped on.
      if (p.endDay) p.endDay = M.addDays(groupId, M.daySpan(p));
      p.day = groupId;
      // A stay keeps its check-out; the slot sets its check-in.
      if (M.isStay(p)) { if (slot === "any") delete p.time; else if (slot && (!p.time || M.slotOf(p) !== slot)) p.time = SLOT_TIME[slot]; }
      else if (slot === "any") { delete p.time; delete p.endTime; }
      else if (slot && (!p.time || M.slotOf(p) !== slot)) {
        const len = p.time && p.endTime ? mins(p.endTime) - mins(p.time) : 0;
        p.time = SLOT_TIME[slot];
        if (len > 0 && mins(p.time) + len < 24 * 60) p.endTime = hhmm(mins(p.time) + len); else delete p.endTime;
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
      if (p && grp && picked && picked.has(p.id) && picked.size > 1) moveMany(grp.dataset.drop, t.dataset.slot || "");
      else if (p && grp) movePlace(p, grp.dataset.drop, t.dataset.slot || "");
    });
  }

  // Settings' View sheet: a card's category as an icon, its name or both;
  // its importance as the colour on its edge, its name or both.
  const catWords = () => SET.get().view.cat !== "icon";
  function metaParts(p, meta) {
    const parts = SET.get().view.imp === "color" ? [] : [el("span.imp", { text: M.IMPORTANCE_LABEL.get(p.importance) })];
    if (meta.length) parts.push((parts.length ? " · " : "") + meta.join(" · "));
    return parts;
  }
  function paintView() {
    const v = SET.get().view;
    document.documentElement.dataset.cat = v.cat;
    document.documentElement.dataset.imp = v.imp;
    document.documentElement.dataset.labels = v.labels;
    document.documentElement.dataset.ratings = v.ratings;
  }
  // Gold stars, filled up to n of 5.
  // A card's rating: a star and the number, at the end of its name.
  const ratingBadge = (p) => (p.rating ? el("span.rating", { title: starsLabel(p.rating), "aria-label": starsLabel(p.rating) }, el("span.star", { text: "★", "aria-hidden": "true" }), String(p.rating)) : null);
  // A journey: its mode's icon, from → to, when it leaves and arrives, its
  // number. An overnight one lands on its arrival day as a row of its own,
  // and a change to the next leg shows how long it is.
  const MODE_ICON = { flight: "plane", train: "train", bus: "bus", ferry: "ship", other: "route" };
  // Names kept apart from the words around them (Unicode isolates), so in
  // Hebrew an English name doesn't take the arrow or a number into its run.
  const iso = (s) => "\u2068" + s + "\u2069";
  // It starts with the language's own direction mark: both names are
  // isolated, so the card's plaintext title would otherwise read as
  // left-to-right and turn Hebrew's arrow round.
  const fromTo = (p) => (i18n.dir === "rtl" ? "\u200f" : "\u200e") + i18n.t("{from} → {to}", { from: iso(p.name), to: iso(p.toName || "?") });
  const durLabel = (min) => (min < 60 ? i18n.t("{n} min", { n: min }) : i18n.t("{h} h {m} min", { h: Math.floor(min / 60), m: min % 60 }));
  function journeyParts(p) {
    const plus = p.arriveDay ? M.daySpan({ day: p.day, endDay: p.arriveDay }) : 0;
    const when = p.time || p.arriveTime ? el("span.jline", { "aria-label": i18n.t("Leaves {dep}, arrives {arr}", { dep: p.time ? hm(p.time) : "?", arr: p.arriveTime ? hm(p.arriveTime) : "?" }) },
      el("span", { text: p.time ? hm(p.time) : "" }), el("span.rail"),
      el("span", {}, p.arriveTime ? hm(p.arriveTime) : "", plus ? el("sup", { text: "+" + plus }) : null)) : null;
    return [el("span.card-name", {}, icon(MODE_ICON[p.mode] || "route", "cat"), el("span.card-title", { text: fromTo(p) })), when,
      el("span.card-meta", { text: [catWords() && M.MODE.get(p.mode), p.number && iso(p.number)].filter(Boolean).join(" · ") || null })];
  }
  function landRow(j, trip) {
    return el("li.jland", {}, el("button", { type: "button", onclick: (e) => openPlace(j, trip, null, e.currentTarget) },
      icon(j.mode === "flight" ? "planeLand" : MODE_ICON[j.mode] || "route"),
      el("span", {}, j.arriveTime ? el("b", { text: hm(j.arriveTime) }) : null, j.arriveTime ? " " : "",
        i18n.t("Arrive at {place}", { place: iso(j.toName || "?") }) + (j.number ? " · " + iso(j.number) : ""))));
  }
  function changeRow(j, trip) {
    const n = M.nextLeg(placesOf(trip.id), j);
    const c = n && M.connection(j, n);
    return c ? el("li.jchange", {}, icon("clock"), i18n.t("Change at {place} · {time}", { place: iso(c.at), time: durLabel(c.min) })) : null;
  }
  function cards(trip, list, g, lands) {
    // Arrivals go in among the places by time.
    const items = [];
    const left = (lands || []).slice();
    for (const p of list) {
      while (left.length && (left[0].arriveTime || "99") <= (M.timeOn(p, g.day) || "99")) items.push({ land: left.shift() });
      items.push(p);
    }
    items.push(...left.map((j) => ({ land: j })));
    return el("ul.cards", {}, items.flatMap((p) => {
      if (p.land) return [landRow(p.land, trip), changeRow(p.land, trip)].filter(Boolean);
      const journey = M.isJourney(p);
      const meta = catWords() ? [M.catName(cats(), trip, p.category)] : [];
      if (g.sameDates) { if (timeLabel(p)) meta.push(timeLabel(p)); }
      else if (view.sort !== "time" && p.day && (!g.area || p.endDay)) meta.push(daysLabel(p));
      else if (p.endDay && g.day && !["in", "out"].includes(M.stayPart(p, g.day))) meta.push(i18n.t("{n} of {total} days", { n: M.daySpan({ day: p.day, endDay: g.day }) + 1, total: M.daySpan(p) + 1 }));
      const nFiles = sees(trip, "files") ? filesOn(p.id).length : 0;
      const on = !!(picked && picked.has(p.id));
      const card = el("li.card" + (journey ? ".journey" : ".imp-" + p.importance) + (p.visited ? ".visited" : "") + (on ? ".picked" : ""), { "data-id": p.id, draggable: canDrag() ? "true" : null,
        onmouseenter: () => { if (sideMap()) TM.hover(p.id, true); }, onmouseleave: () => TM.hover(p.id, false) },
        picked ? el("button.tick.pick", { type: "button", "aria-pressed": String(on), "aria-label": i18n.t("Select {name}", { name: p.name }), onclick: () => pick(p.id) }, icon("check"))
          : el("button.tick", { type: "button", disabled: !mayEdit(trip), "aria-pressed": String(!!p.visited), "aria-label": p.visited ? i18n.t("Been to {name}", { name: p.name }) : i18n.t("Mark as been to {name}", { name: p.name }),
            onclick: () => { p.visited = !p.visited; p.updatedAt = new Date().toISOString(); save(); } }, icon("check")),
        el("button.card-body", { type: "button", onclick: (e) => (picked ? pick(p.id) : openPlace(p, trip, null, e.currentTarget)) },
          ...(journey ? journeyParts(p) : [
            el("span.card-name", {}, icon(catIcon(p.category), "cat"), el("span.card-title", { text: p.name }), ratingBadge(p)),
            el("span.card-meta", {}, ...metaParts(p, meta),
              nFiles ? el("span.clip", { title: i18n.tn(nFiles, "1 attachment", "{n} attachments"), "aria-label": i18n.tn(nFiles, "1 attachment", "{n} attachments") }, icon("paperclip"), String(nFiles)) : null)]),
          p.note ? el("span.card-note", { text: p.note }) : null,
          !g.sameDates && (journey ? p.time : timeLabel(p, g.day)) ? el("span.card-time", { text: journey ? [p.time, p.arriveTime].filter(Boolean).map(hm).join("–") : timeLabel(p, g.day) }) : null));
      // A change to the next leg, when this one lands the same day.
      return journey && !p.arriveDay && view.sort === "time" ? [card, changeRow(p, trip)].filter(Boolean) : [card];
    }));
  }

  // ---------- Back and Forward ----------
  // Each screen is a hash (#/trip/…) and each open sheet a step of its own
  // on top of it, so Back (the browser's, a mouse's side button, a phone's)
  // closes the sheet, then leaves the screen, and Forward opens them again.
  // A sheet closed in the app takes its step back off; until the browser has
  // done that, the next move waits, or it would land on the wrong step.
  const steps = [];
  const waiting = [];
  let owed = 0, flying = false, flyTimer = null, reviving = null;
  function settle(fn) { if (flying || owed) waiting.push(fn); else fn(); }
  function fly() {
    if (flying) return;
    if (owed) {
      const n = owed;
      owed = 0;
      flying = true;
      flyTimer = setTimeout(landed, 800);
      history.go(-n);
      return;
    }
    while (waiting.length && !flying && !owed) waiting.shift()();
  }
  function landed() { flying = false; clearTimeout(flyTimer); fly(); }
  function go(hash, replace) {
    settle(() => {
      if (!replace) { location.hash = hash; return; }
      // A screen put in another's place keeps that one's trail.
      const s = history.state || {};
      location.replace(hash);
      if (Array.isArray(s.trail)) history.replaceState({ at: hash, trail: s.trail }, "");
    });
  }
  // Forward onto a sheet opens it on the same thing, if it's still there
  // (list names the doc's records; x null is a new one).
  function againOn(d, list, x, trip, open) {
    d.again = () => {
      const t = findTrip(trip.id), y = x && (doc[list] || []).find((z) => z.id === x.id);
      if (!t || (x && !y)) return false;
      open(y || null, t);
    };
  }
  function stepIn(d) {
    if (steps.includes(d)) return;
    steps.push(d);
    if (reviving === d.id) { reviving = null; d.stepped = true; return; }
    d.stepped = false;
    const ids = steps.map((x) => x.id);
    d.stepPush = () => { d.stepped = true; history.pushState({ ...history.state, sheets: ids }, ""); };
    settle(d.stepPush);
  }
  function stepOut(d) {
    const i = steps.indexOf(d);
    if (i < 0) return;
    for (const x of steps.splice(i)) {
      if (x.stepped) owed++;
      else if (waiting.includes(x.stepPush)) waiting.splice(waiting.indexOf(x.stepPush), 1);
    }
    fly();
  }
  window.addEventListener("popstate", () => {
    if (flying) { landed(); return; }
    const want = (history.state && history.state.sheets) || [];
    let n = 0;
    while (n < steps.length && n < want.length && steps[n].id === want[n]) n++;
    for (const d of steps.splice(n).reverse()) leaveSheet(d);
    // Forward onto a sheet: it opens again where it can (again() says how);
    // where it can't, the step is skipped back over.
    for (const id of want.slice(n)) {
      const d = $(id);
      reviving = id;
      if (!d || d.open || !d.again || d.again() === false) { reviving = null; owed++; fly(); return; }
    }
  });
  // Each history step knows the screens before it (trail), so the app's own
  // back arrow can go back to where you came from instead of adding a step:
  // Back after it then goes further back, not into the screen you left.
  let here = null;
  function stamp() {
    const h = location.hash || "#/", s = history.state || {};
    if (s.at === h && Array.isArray(s.trail)) { here = s; return; }
    here = { ...s, at: h, trail: here && here.at !== h ? here.trail.concat(here.at).slice(-40) : (here ? here.trail : []) };
    history.replaceState(here, "");
  }
  function goUp(parent) {
    const trail = (history.state && history.state.trail) || [], d = depthOf(parent);
    for (let k = trail.length - 1; k >= 0; k--) {
      if (trail[k] === parent) { history.go(k - trail.length); return; }
      if (depthOf(trail[k]) <= d) break;
    }
    go(parent);
  }

  // ---------- Sheets ----------
  const narrow = () => !window.matchMedia("(min-width: 720px)").matches;
  // A sheet opens with the sheet itself in focus, never a field, so a
  // phone doesn't throw up its keyboard before you tap where to type.
  function openSheet(d, from) {
    d.classList.remove("leaving");
    d.showModal();
    stepIn(d);
    d.tabIndex = -1;
    d.focus();
    if (narrow() && d.classList.contains("page")) slideSheet(d, true);
    else (narrow() ? motion.rise(d) : motion.dialogIn(d, from && from.getBoundingClientRect()));
  }
  // The dimming behind fades out with the sheet (styles.css, .leaving),
  // and the sheet lets go of the page the moment it's out of sight.
  async function closeSheet(d) {
    if (!d.open || d.classList.contains("leaving")) return;
    d.classList.add("leaving");
    stepOut(d);
    await (narrow() && d.classList.contains("page") ? slideSheet(d, false)
      : narrow() ? sinkSheet(d) : fadeSheet(d));
    // A tap beside the sheet while it was leaving reaches the page once it's
    // closed (after its close event has taken its history step off).
    const at = d.passOn;
    d.passOn = null;
    if (at) d.addEventListener("close", () => {
      const n = document.elementFromPoint(at.x, at.y);
      if (n && !n.closest("dialog")) n.click();
    }, { once: true });
    d.close();
    d.classList.remove("leaving");
  }
  // Down and out on a plain ease-in: keel's sink rides the spring's settling
  // tail long after the sheet has left the screen, holding the page.
  function sinkSheet(d) {
    if (!d.animate || lessMotion()) return motion.sink(d);
    const a = d.animate([{ transform: "none" }, { transform: "translateY(100%)" }], { duration: 220, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
    return a.finished.then(() => a.cancel(), () => {});
  }
  // On a wide screen a sheet fades out as its dimming does and closes then:
  // keel's dialogOut is see-through by 70% of its spring and then held the
  // page, invisible, for its settling tail.
  function fadeSheet(d) {
    if (!d.animate || lessMotion()) return motion.dialogOut(d);
    const a = d.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.98)" }], { duration: 200, easing: "ease-out", fill: "forwards" });
    return a.finished.then(() => a.cancel(), () => {});
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
  // Leaving a sheet (Back, Escape, its back arrow, a tap outside) goes
  // through its onLeave when it has one: the place sheet saves on the way out.
  const leaveSheet = (d) => (d.classList.contains("leaving") ? null : d.onLeave ? d.onLeave() : closeSheet(d));
  for (const d of document.querySelectorAll("dialog.sheet")) {
    // A sheet on its way out still holds the page, so a second tap on its
    // Save or Done would save twice and a tap beside it would be lost: a tap
    // in it is dropped, and one beside it is passed on once it's gone.
    d.addEventListener("click", (e) => {
      if (!d.classList.contains("leaving")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.target === d && e.isTrusted) d.passOn = { x: e.clientX, y: e.clientY };
    }, true);
    d.addEventListener("submit", (e) => { if (d.classList.contains("leaving")) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    d.addEventListener("cancel", (e) => { e.preventDefault(); leaveSheet(d); });
    d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-close]")) leaveSheet(d); });
    d.addEventListener("close", () => stepOut(d));
  }
  // The phone's Back button is the browser's Back (a sheet first, then the
  // screen), and from the first screen puts the app away.
  const appPlugin = window.Keel.platform && window.Keel.platform.plugin("App");
  if (appPlugin) appPlugin.addListener("backButton", ({ canGoBack }) => {
    const d = [...document.querySelectorAll("dialog[open]")].pop();
    if (d && !steps.includes(d)) { if (d.dispatchEvent(new Event("cancel", { cancelable: true }))) d.close(); return; }
    if (canGoBack || steps.length) history.back();
    else if (appPlugin.minimizeApp) appPlugin.minimizeApp();
    else appPlugin.exitApp();
  });
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

  // "Delete …?" with Cancel and Delete; resolves true on Delete.
  function confirmDelete(title, from) {
    const d = $("confirmSheet");
    $("confirmTitle").textContent = title;
    $("confirmText").textContent = i18n.t("You can undo it right after.");
    return new Promise((done) => {
      let yes = false;
      $("confirmGo").onclick = () => { yes = true; closeSheet(d); };
      d.addEventListener("close", () => done(yes), { once: true });
      openSheet(d, from);
    });
  }

  // Trip sheet
  // pendingCover: a new photo (a blob), null to drop it, undefined to keep it;
  // pendingArt the same for a drawing's name.
  let editingTrip = null, pendingCover, pendingArt;
  function showCoverPreview(url, art) {
    const src = url || artUrl(art);
    $("coverShow").replaceChildren(...(src ? [el("img", { src, alt: "" })] : [icon("image"), el("span", { text: i18n.t("Add a cover photo") })]));
    $("coverPreview").classList.toggle("has-photo", !!src);
    $("coverRemove").hidden = !src;
    for (const b of $("coverArt").querySelectorAll("[data-art]")) b.setAttribute("aria-pressed", String(!url && b.dataset.art === art));
  }
  async function openTrip(trip, from) {
    $("tripSheet").again = () => { const t = trip && findTrip(trip.id); if (trip && !t) return false; openTrip(t || null); };
    editingTrip = trip;
    shareWaiting = null;
    pendingCover = pendingArt = undefined;
    const f = $("tripForm");
    f.reset();
    delete f.dataset.busy;
    $("tripSheetTitle").textContent = trip ? i18n.t("Edit trip") : i18n.t("New trip");
    if (trip) {
      f.name.value = trip.name;
      f.start.value = trip.start || "";
      f.end.value = trip.end || "";
    }
    destRows = trip ? M.destsOf(trip).map((d) => ({ ...d, orig: d.name, at: d.lat != null ? d.name : undefined })) : [];
    if (!destRows.length) destRows.push({ name: "" });
    paintDests();
    showCoverPreview(trip ? await coverUrl(trip) : null, trip && trip.art);
    $("tripDelete").hidden = $("tripDup").hidden = !trip;
    $("tripFileRow").hidden = !trip;
    $("tripExport").onclick = () => trip && saveBackup([trip.id]);
    $("tripOfflineRow").hidden = !trip;
    $("tripImportLink").value = "";
    $("tripImportRow").hidden = false;
    $("tripImportLabel").textContent = trip ? i18n.t("Import places") : i18n.t("Start with places");
    showLinkRow(false);
    pendingList = null;
    paintList();
    if (trip) armDelete($("tripDelete"), i18n.t("Delete trip"), () => deleteTrip(trip));
    $("tripDup").onclick = trip ? async () => { await closeSheet($("tripSheet")); openDup(trip); } : null;
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
      const when = fmt(at.toDateString() === new Date().toDateString() ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(at);
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
      pendingArt = null;
      showCoverPreview(URL.createObjectURL(pendingCover));
    } catch (err) {
      window.Keel.errlog.note("cover", String(err));
      showCoverPreview(null);
      $("coverShow").replaceChildren(el("span.error", { text: i18n.t("That file couldn't be read as a photo.") }));
    }
  });
  $("coverRemove").addEventListener("click", () => { pendingCover = pendingArt = null; showCoverPreview(null); $("coverFile").value = ""; });
  const ART_NAMES = { mountains: i18n.t("Mountains"), beach: i18n.t("Beach"), city: i18n.t("City"), desert: i18n.t("Desert"),
    forest: i18n.t("Forest"), snow: i18n.t("Snow"), lake: i18n.t("Lake"), countryside: i18n.t("Countryside") };
  $("coverPhotoTile").append(icon("camera"));
  $("coverArt").append(...M.COVER_ART.map((name) => el("button", { type: "button", "data-art": name, "aria-pressed": "false",
    "aria-label": ART_NAMES[name], title: ART_NAMES[name],
    onclick: () => { pendingArt = name; pendingCover = null; $("coverFile").value = ""; showCoverPreview(null, name); } },
  el("img", { src: artUrl(name), alt: "" }))));
  // Edit trip's destinations: a row each, with its dates under it when
  // opened. A row remembers the name it came with (orig), so a rename
  // carries the places put in it by hand.
  let destRows = [];
  function paintDests() {
    const f = $("tripForm");
    $("tripDests").replaceChildren(...destRows.map((d, i) => {
      const chip = el("button.dest-when" + (d.start ? "" : ".none"), { type: "button", "aria-expanded": String(!!d.open), text: destRange(d),
        onclick: () => { d.open = !d.open; paintDests(); if (d.open) $("tripDests").children[i].querySelector("input[type=date]").focus(); } });
      const from = el("input", { type: "date", value: d.start || "", min: f.start.value || null, max: f.end.value || null });
      const to = el("input", { type: "date", value: d.end || "", min: d.start || f.start.value || null, max: f.end.value || null });
      const dated = () => { chip.textContent = destRange(d); chip.classList.toggle("none", !d.start); to.min = d.start || f.start.value || ""; };
      from.addEventListener("change", () => { d.start = from.value || undefined; if (d.start && (!d.end || d.end < d.start)) to.value = d.end = d.start; if (!d.start) { d.end = undefined; to.value = ""; } dated(); });
      to.addEventListener("change", () => { d.end = to.value || d.start; if (d.end && !d.start) from.value = d.start = d.end; if (d.end < d.start) [d.start, d.end] = [d.end, d.start]; from.value = d.start || ""; to.value = d.end || ""; dated(); });
      return el("li.dest-row", {},
        el("div.dest-line", {},
          el("input.dest-name", { type: "text", value: d.name, autocomplete: "off", maxlength: "80", placeholder: i18n.t("Tokyo"), "aria-label": i18n.t("Destination"),
            oninput: (e) => { d.name = e.target.value; } }),
          chip,
          el("button.icon-btn.small", { type: "button", "aria-label": d.name ? i18n.t("Remove {name}", { name: d.name }) : i18n.t("Remove"),
            onclick: () => { destRows.splice(i, 1); if (!destRows.length) destRows.push({ name: "" }); paintDests(); } }, icon("x"))),
        el("div.dest-dates", { hidden: !d.open },
          el("label.field", {}, el("span", { text: i18n.t("From") }), from),
          el("label.field", {}, el("span", { text: i18n.t("To") }), to),
          d.start ? el("button.btn.quiet", { type: "button", text: i18n.t("No dates"), onclick: () => { d.start = d.end = undefined; d.open = false; paintDests(); } }) : null,
          destRows.length > 1 ? partOf(d) : null));
    }));
    const stays = editingTrip && placesOf(editingTrip.id).some((p) => p.category === "stay" && p.day);
    $("tripDestStays").hidden = !stays;
  }
  // Where it sits in Plan › Destination: by its dates, on its own, or
  // inside another (a day trip from it). Rows are matched by the name they
  // came with, so a rename keeps it.
  const rowKey = (d) => d.orig || d.name.trim();
  function partOf(d) {
    const others = destRows.filter((o) => o !== d && o.name.trim());
    const pick = el("select", { onchange: (e) => { d.in = e.target.value === "auto" ? undefined : e.target.value === "own" ? "" : e.target.value; } },
      el("option", { value: "auto", text: i18n.t("By its dates") }),
      el("option", { value: "own", text: i18n.t("On its own") }),
      ...others.map((o) => el("option", { value: rowKey(o), text: i18n.t("Inside {name}", { name: o.name.trim() }) })));
    pick.value = d.in === undefined ? "auto" : d.in === "" ? "own" : others.some((o) => rowKey(o) === d.in) ? d.in : "auto";
    return el("label.field.dest-part", {}, el("span", { text: i18n.t("In Plan › Destination") }), pick);
  }
  $("tripDestAdd").prepend(icon("plus"));
  $("tripDestStays").prepend(icon("bed"));
  $("tripDestAdd").addEventListener("click", () => {
    destRows.push({ name: "" });
    paintDests();
    $("tripDests").lastElementChild.querySelector(".dest-name").focus();
  });
  // The rows as the trip will keep them: names, and destInfo for those with dates or a place.
  // Dated ones in date order, then the rest as they were.
  const byDates = (list) => list.slice().sort((a, b) => (a.start ? 0 : 1) - (b.start ? 0 : 1) || (a.start || "").localeCompare(b.start || "") || (a.end || "").localeCompare(b.end || ""));
  function destsFromRows() {
    const names = [], info = {};
    for (const d of byDates(destRows)) {
      const name = d.name.trim();
      if (!name || names.includes(name)) continue;
      names.push(name);
      const r = {};
      if (d.start) Object.assign(r, { start: d.start, end: d.end || d.start });
      if (d.lat != null && name === d.at) Object.assign(r, { lat: d.lat, lng: d.lng });
      if (d.in === "") r.in = "";
      else if (d.in) { const up = destRows.find((o) => rowKey(o) === d.in); if (up && up.name.trim() && up !== d) r.in = up.name.trim(); }
      if (Object.keys(r).length) info[name] = r;
    }
    return { destinations: names, destInfo: info };
  }
  function keepDests(trip) {
    const { destinations, destInfo } = destsFromRows();
    const renamed = new Map(destRows.filter((d) => d.orig && d.name.trim() && d.name.trim() !== d.orig).map((d) => [d.orig, d.name.trim()]));
    for (const p of placesOf(trip.id)) {
      if (!p.dest) continue;
      const to = renamed.get(p.dest) || p.dest;
      if (!destinations.includes(to)) { delete p.dest; p.updatedAt = trip.updatedAt; }
      else if (to !== p.dest) { p.dest = to; p.updatedAt = trip.updatedAt; }
    }
    trip.destinations = destinations;
    if (Object.keys(destInfo).length) trip.destInfo = destInfo; else delete trip.destInfo;
  }
  // Finds each destination on the map once (the search provider in
  // Settings gets its name, as with Find by name), so places can go with
  // the nearest. Only once there's a choice to make: two or more, or dates.
  async function findDest(name) {
    const prov = SET.get().providers;
    const got = await keyedSearch(name, { chain: SET.chain("search"), keys: { google: prov.google.key, maptiler: prov.maptiler.key } });
    const r = got.results[0];
    return r ? { lat: r.lat, lng: r.lng } : null;
  }
  const destsWanted = (list) => list.length >= 2 || list.some((d) => d.start);
  async function locateDests(tripId) {
    const trip = findTrip(tripId);
    if (!trip || !mayEdit(trip) || navigator.onLine === false || !destsWanted(M.destsOf(trip))) return;
    let first = true;
    for (const d of M.destsOf(trip)) {
      if (d.lat != null) continue;
      if (!first) await new Promise((ok) => setTimeout(ok, 1100));
      first = false;
      let at = null;
      try { at = await findDest(d.name); } catch (e) { /* stays unlocated; the next save tries again */ }
      const cur = findTrip(tripId);
      if (!at || !cur || !cur.destinations.includes(d.name)) continue;
      cur.destInfo = { ...(cur.destInfo || {}), [d.name]: { ...((cur.destInfo || {})[d.name] || {}), ...at } };
      cur.updatedAt = new Date().toISOString();
      save();
    }
  }
  $("tripDestStays").addEventListener("click", async () => {
    const btn = $("tripDestStays");
    btn.disabled = true;
    try {
      const rows = destRows.filter((d) => d.name.trim());
      for (const [i, d] of rows.entries()) {
        const name = d.name.trim();
        if (d.lat != null && name === d.at) continue;
        toast(i18n.t("Finding {name} on the map…", { name }));
        if (i) await new Promise((ok) => setTimeout(ok, 1100));
        const at = await findDest(name).catch(() => null);
        if (at) Object.assign(d, at, { at: name });
      }
      const got = M.datesFromStays({ id: editingTrip.id, ...destsFromRows() }, placesOf(editingTrip.id));
      let n = 0;
      for (const d of rows) { const r = got[d.name.trim()]; if (r) { Object.assign(d, r); n++; } }
      destRows = byDates(destRows);
      paintDests();
      toast(n ? i18n.tn(n, "Dates for 1 destination, from your stays.", "Dates for {n} destinations, from your stays.") : i18n.t("No stay is near one of these destinations."));
    } finally { btn.disabled = false; }
  });
  $("tripForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.name.value.trim()) { f.name.focus(); f.name.setAttribute("aria-invalid", "true"); return; }
    f.name.removeAttribute("aria-invalid");
    // Saving a cover photo waits on the device's storage: a second tap meanwhile isn't a second trip.
    if (f.dataset.busy) return;
    f.dataset.busy = "1";
    const stamp = new Date().toISOString();
    const trip = editingTrip || M.ownTrip({ id: M.newId(), createdAt: stamp }, SET.get().me);
    Object.assign(trip, { name: f.name.value, start: f.start.value, end: f.end.value, updatedAt: stamp });
    keepDests(trip);
    if (pendingCover !== undefined) {
      if (covers.get(trip.id)) URL.revokeObjectURL(covers.get(trip.id));
      covers.delete(trip.id);
      if (pendingCover) { await store.setCover(trip.id, pendingCover); trip.cover = true; }
      else { await store.dropCover(trip.id); trip.cover = false; }
      trip.coverAt = stamp;
    }
    if (pendingArt !== undefined) { if (pendingArt) trip.art = pendingArt; else delete trip.art; }
    if (!editingTrip) doc.trips.push(trip);
    const shared = !editingTrip && shareWaiting;
    const closing = closeSheet($("tripSheet"));
    save();
    if (!editingTrip) go("#/trip/" + trip.id);
    await closing;
    const list = !editingTrip && pendingList;
    pendingList = null;
    if (list) await importList(doc.trips.find((t) => t.id === trip.id) || trip, list.places);
    locateDests(trip.id);
    if (shared) shareInto(findTrip(trip.id) || trip, shared);
  });
  async function deleteTrip(trip) {
    const blob = trip.cover ? await store.cover(trip.id) : null;
    if (blob) store.dropCover(trip.id);
    closeSheet($("tripSheet"));
    go("#/");
    undoable(i18n.t("Deleted {name}.", { name: trip.name }), () => { doc.trips = doc.trips.filter((t) => t !== trip); },
      async () => { if (blob) await store.setCover(trip.id, blob); });
  }

  // Duplicate trip: a copy that's yours alone, with what the sheet keeps.
  // pub: a published trip being copied ({ doc, id, host, dates }), whose
  // plan comes from its own doc instead of this device's.
  let dupOf = null, dupPub = null;
  function openDup(trip, from, pub) {
    dupOf = trip;
    dupPub = pub || null;
    const f = $("dupForm");
    f.reset();
    delete f.dataset.busy;
    const src = pub ? pub.doc : doc;
    $("dupTitle").textContent = pub ? i18n.t("Copy {name} to my trips", { name: trip.name }) : i18n.t("Duplicate {name}", { name: trip.name });
    f.name.value = pub ? trip.name : i18n.t("{name} (copy)", { name: trip.name });
    const n = src.places.filter((p) => p.trip === trip.id).length;
    $("dupWhat").textContent = i18n.tn(n, "Copy its 1 place, with", "Copy its {n} places, with");
    f.querySelector("button[type=submit]").textContent = pub ? i18n.t("Copy") : i18n.t("Duplicate");
    $("dupNever").textContent = pub ? i18n.t("The copy is yours alone: change anything. Whoever published it never sees it or who copied it.")
      : i18n.t("Names, categories, importance, descriptions and destinations always come along. Ratings, been there, expenses and the people it's shared with never do: the copy is yours alone.");
    const files = (src.files || []).filter((x) => x.trip === trip.id), bytes = files.filter(M.hasBytes);
    const size = bytes.reduce((a, x) => a + (x.size || 0), 0);
    $("dupFilesRow").hidden = !files.length;
    $("dupFilesHint").textContent = !bytes.length ? i18n.tn(files.length, "1 link or note.", "{n} links and notes.")
      : files.length === bytes.length ? i18n.tn(bytes.length, "1 file ({size}).", "{n} files ({size}).", { size: sizeLabel(size) })
      : i18n.t("{links} links and notes, {files} files ({size}).", { links: files.length - bytes.length, files: bytes.length, size: sizeLabel(size) });
    f.start.value = pub && !pub.dates ? "" : trip.start || "";
    paintDup();
    openSheet($("dupSheet"), from);
    f.name.select();
  }
  // The new start only matters with dates, on a trip that has them.
  function paintDup() {
    const f = $("dupForm"), trip = dupOf;
    $("dupStartRow").hidden = !(trip.start && f.dates.checked);
    // A trip published without its dates has no start to keep: pick one.
    const hidden = dupPub && !dupPub.dates;
    if (hidden && !M.isDay(f.start.value)) { if (trip.start) $("dupStartHint").textContent = i18n.t("Pick its first day. Without one, every place goes to No date."); return; }
    if (!f.start.value) f.start.value = trip.start || "";
    if (!trip.start) return;
    const start = M.isDay(f.start.value) ? f.start.value : trip.start;
    const shift = Math.round((Date.parse(start) - Date.parse(trip.start)) / 864e5);
    $("dupStartHint").textContent = rangeLabel({ start, end: trip.end ? M.addDays(trip.end, shift) : start }) + ". " + i18n.t("Every planned day moves with it: Day 2 stays Day 2.");
  }
  $("dupForm").addEventListener("change", paintDup);
  $("dupForm").addEventListener("input", (e) => { if (e.target.name === "start") paintDup(); });
  $("dupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, trip = dupOf;
    if (!f.name.value.trim()) { f.name.focus(); f.name.setAttribute("aria-invalid", "true"); return; }
    f.name.removeAttribute("aria-invalid");
    // Copying covers and files takes a moment: a second tap meanwhile isn't a second copy.
    if (f.dataset.busy) return;
    f.dataset.busy = "1";
    const pub = dupPub;
    const dates = f.dates.checked && !(pub && !pub.dates && !M.isDay(f.start.value));
    const got = M.duplicateTrip(pub ? pub.doc : doc, trip, { name: f.name.value, start: f.start.value, locations: f.locations.checked, dates, attachments: f.attachments.checked }, SET.get().me);
    if (pub) SHARE.copiedPublished(pub.id, pub.host);
    // A cover photo and each file's bytes are copied on this device; a file
    // that hasn't come here yet stays behind.
    const blob = got.trip.cover && !pub ? await store.cover(trip.id) : null;
    if (got.trip.cover && blob) await store.setCover(got.trip.id, blob);
    else if (got.trip.cover) { got.trip.cover = false; delete got.trip.coverAt; }
    const missing = new Set();
    for (const [from, to] of got.fileIds) {
      const b = await store.file(from);
      if (b) await store.setFile(to, b); else missing.add(to);
    }
    const files = got.files.filter((x) => !missing.has(x.id));
    await closeSheet($("dupSheet"));
    undoable(missing.size ? i18n.tn(missing.size, "Made {name}. 1 file isn't on this device yet, so it stayed behind.", "Made {name}. {n} files aren't on this device yet, so they stayed behind.", { name: got.trip.name }) : i18n.t("Made {name}.", { name: got.trip.name }), () => {
      doc.trips.push(got.trip);
      doc.places.push(...got.places);
      if (files.length) doc.files = (doc.files || []).concat(files);
    }, async () => {
      await store.dropCover(got.trip.id);
      for (const x of files) if (M.hasBytes(x)) await store.dropFile(x.id);
    });
    go("#/trip/" + got.trip.id);
    locateDests(got.trip.id);
  });

  // Place sheet
  let editingPlace = null, placeTrip = null, importance = "want", rating = 0, loc, categoryTouched = false, checkedOk = false;
  // A journey in the sheet: its kind, mode and where it goes (toLoc as loc).
  let journey = false, mode = "flight", toLoc;
  // The place's location in the sheet: undefined unchanged, null cleared,
  // or { lat, lng, address } found by name.
  function paintWhere() {
    const p = loc === undefined ? editingPlace : loc;
    const has = p && p.lat != null;
    const expired = !has && loc === undefined && editingPlace && editingPlace.placeId;
    $("placeWhere").textContent = expired ? i18n.t("Google's location expired after 30 days. It comes back when Google answers again (Settings → Services).") : !has ? i18n.t("Not set") : p.address || (p.placeId || p.source === "google" ? i18n.t("On Google Maps") + " · " : "") + p.lat.toFixed(5) + ", " + p.lng.toFixed(5);
    const named = $("placeForm").name.value || (editingPlace && editingPlace.name);
    const menu = $("placeOpenIn");
    menu.open = false;
    menu.hidden = !(has || named);
    if (!menu.hidden) menu.replaceChildren(el("summary.btn", {}, icon("external"), el("span", { text: i18n.t("Open") }), icon("chevron", "chev")),
      el("div.open-menu-list", {}, ...openLinks({ name: named, ...(has ? p : {}) }).map(([label, href]) =>
        el("a", { href, target: href.startsWith("geo:") ? null : "_blank", rel: "noopener noreferrer", text: label, onclick: () => { menu.open = false; } }))));
    $("placeWhere").classList.toggle("dim", !has);
    $("placeClear").hidden = !has;
    $("placeFindLabel").textContent = has ? i18n.t("Change") : i18n.t("Find by name");
    $("placeFind").hidden = !has && !journey;
    const unsure = !!(editingPlace && editingPlace.check) && loc === undefined && !checkedOk;
    $("placeCheck").hidden = !unsure || !mayEdit(placeTrip);
    $("placePinLabel").textContent = has ? i18n.t("On map") : i18n.t("Pin on map");
  }
  // The Open menu opens toward whichever side has room for it.
  $("placeOpenIn").addEventListener("toggle", (e) => {
    const menu = e.currentTarget;
    if (!menu.open) return;
    const r = menu.getBoundingClientRect(), list = menu.querySelector(".open-menu-list");
    const room = i18n.dir === "rtl" ? r.right : innerWidth - r.left;
    menu.classList.toggle("to-end", !!list && room < list.offsetWidth + 16);
  });
  // The Open menu closes when anything else is clicked.
  document.addEventListener("click", (e) => {
    const menu = $("placeOpenIn");
    if (menu.open && !menu.contains(e.target)) menu.open = false;
  });
  $("categorySelect").addEventListener("change", () => { categoryTouched = true; paintTimes(); paintBadge(); paintUntilRow(); });
  // A stay's From and To are its check-in and check-out.
  function paintTimes() {
    const stay = $("categorySelect").value === "stay";
    // A stay's two times get a row each: Check-in, then Check-out.
    $("timesLabel").textContent = stay ? i18n.t("Check-in") : i18n.t("Time");
    $("timeDash").hidden = stay;
    $("checkOutRow").hidden = !stay;
    if (stay) $("checkOutSlot").append($("placeEndTime"));
    else $("placeTimeSlot").append($("placeEndTime"));
    $("timeLabel").textContent = stay ? i18n.t("Check-in") : i18n.t("From", { _: "time" });
    $("endTimeLabel").textContent = stay ? i18n.t("Check-out") : i18n.t("To", { _: "time" });
  }
  // The header's icon: the place's category, or the journey's mode.
  function paintBadge() {
    $("placeBadge").replaceChildren(icon(journey ? MODE_ICON[mode] : catIcon($("categorySelect").value)));
  }
  // A journey's header: where it leaves from and where it goes.
  function paintRoute() {
    const f = $("placeForm");
    const from = f.name.value.trim(), to = f.toName.value.trim();
    $("placeRoute").textContent = from && to ? from + " → " + to : from || to || (editingPlace ? i18n.t("Edit journey") : i18n.t("Add a journey"));
  }
  $("placeForm").name.addEventListener("input", () => { if (journey) paintRoute(); });
  $("toName").addEventListener("input", paintRoute);
  // "Until" waits behind "Lasts more than one day", unless the place already
  // lasts several days or is a stay.
  let untilWanted = false;
  function paintUntilRow() {
    const day = placeTrip.start ? $("daySelect").value : $("dayInput").value;
    const until = placeTrip.start ? $("untilSelect").value : $("untilInput").value;
    const show = !!day && !journey && (untilWanted || !!until || $("categorySelect").value === "stay");
    $("untilField").hidden = !show;
    $("untilOpen").hidden = !day || show || journey || !mayEdit(placeTrip);
  }
  $("untilOpen").addEventListener("click", () => {
    untilWanted = true;
    paintUntilRow();
    (placeTrip.start ? $("untilSelect") : $("untilInput")).focus();
  });
  $("placeClear").addEventListener("click", () => { loc = null; $("placeResults").replaceChildren(); $("placeFindNote").textContent = ""; paintWhere(); });
  let searching = 0;
  function findThis() {
    return findPlace($("placeForm").name, $("placeFindNote"), $("placeResults"), (r) => {
      const f = $("placeForm");
      // "Just this name": no location for now.
      if (!r) { f.name.blur(); return; }
      loc = { lat: r.lat, lng: r.lng, address: r.address, placeId: r.placeId, source: r.source };
      // A place found by a shortened name takes the found one's name.
      if (!journey && !editingPlace && r.name) f.name.value = r.name;
      if (r.category && !journey && !categoryTouched && !editingPlace && cats().some(([id]) => id === r.category)) { f.category.value = r.category; paintTimes(); paintBadge(); paintUntilRow(); }
      paintWhere();
    }, !journey);
  }
  $("placeFind").addEventListener("click", findThis);
  $("placeCheckOk").addEventListener("click", () => { checkedOk = true; paintWhere(); });
  // Enter in a place's name searches for it, until it has a location.
  $("placeForm").name.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing || journey) return;
    const has = loc === undefined ? editingPlace && editingPlace.lat != null : !!loc;
    if (has || !e.target.value.trim()) return;
    e.preventDefault();
    findThis();
  });
  // Add another: this one is kept, and an empty sheet takes the next.
  $("placeAnother").addEventListener("click", async () => {
    const f = $("placeForm");
    if (!f.name.value.trim()) { f.name.focus(); f.name.setAttribute("aria-invalid", "true"); return; }
    const p = await commitPlace();
    openPlace(null, findTrip(p.trip) || placeTrip, p.day ? { day: p.day } : null);
    $("placeForm").name.focus();
  });
  // Where a journey goes: found by name like the place, under the same
  // Google rule (its id kept, its location 30 days, its address never).
  $("toFind").addEventListener("click", () => findPlace($("placeForm").toName, $("toFindNote"), $("toResults"), (r) => {
    toLoc = { lat: r.lat, lng: r.lng, address: r.address, placeId: r.placeId, source: r.source };
    paintTo();
  }));
  $("toClear").addEventListener("click", () => { toLoc = null; $("toResults").replaceChildren(); $("toFindNote").textContent = ""; paintTo(); });
  function paintTo() {
    const p = toLoc === undefined ? (editingPlace && editingPlace.toLat != null ? { lat: editingPlace.toLat, lng: editingPlace.toLng, address: editingPlace.toAddress, placeId: editingPlace.toPlaceId } : null) : toLoc;
    const has = !!(p && p.lat != null);
    $("toWhere").textContent = has ? p.address || (p.placeId || p.source === "google" ? i18n.t("On Google Maps") + " · " : "") + p.lat.toFixed(5) + ", " + p.lng.toFixed(5) : i18n.t("Not set");
    $("toWhere").classList.toggle("dim", !has);
    $("toClear").hidden = !has;
  }
  async function findPlace(input, note, out, onpick, plain) {
    const q = input.value.trim();
    if (!q) { note.textContent = i18n.t("Type the place's name first."); input.focus(); return; }
    const me = ++searching;
    note.textContent = i18n.t("Searching…");
    out.replaceChildren();
    const near = placesOf(placeTrip.id).filter((p) => p.lat != null);
    const dest = placeTrip.destinations[0];
    const prov = SET.get().providers;
    const opts = { chain: SET.chain("search"), keys: { google: prov.google.key, maptiler: prov.maptiler.key }, near };
    try {
      let got = await keyedSearch(q, opts);
      // Nothing for the bare name: try it with the trip's first destination.
      if (!got.results.length && dest && !q.toLowerCase().includes(dest.toLowerCase())) got = await keyedSearch(q + ", " + dest, opts);
      if (me !== searching) return;
      const list = got.results;
      const via = SET.PROVIDERS[got.by] ? SET.PROVIDERS[got.by].name : got.by;
      const fell = got.skipped.length ? " " + i18n.t("({why} Used {via}.)", { why: got.skipped.map((x) => x.reason).join(" "), via }) : "";
      note.textContent = (list.length ? i18n.t("From {via}", { via }) : i18n.t("Nothing found on {via}. Try another spelling, or pin it on the map.", { via })) + fell;
      const done = () => { out.replaceChildren(); note.textContent = ""; };
      out.replaceChildren(...list.map((r) => el("li", {}, el("button", { type: "button", onclick: () => { done(); onpick(r, via); } },
        el("strong", { text: r.name }), el("span.dim", { text: r.address })))),
        plain ? el("li.plain", {}, el("button", { type: "button", onclick: () => { done(); onpick(null); } },
          el("strong", { text: i18n.t("Just “{name}”", { name: q }) }), el("span.dim", { text: i18n.t("No location for now") }))) : null);
    } catch (e) {
      if (me !== searching) return;
      window.Keel.errlog.note("search", String(e));
      note.textContent = navigator.onLine === false ? i18n.t("Searching needs a connection.") : e.message || i18n.t("The search didn't work. Try again in a moment.");
    }
  }
  $("placePin").addEventListener("click", async () => {
    const f = $("placeForm");
    if (!f.name.value.trim()) { f.name.focus(); f.name.setAttribute("aria-invalid", "true"); return; }
    const p = await commitPlace();
    view.pick = p.id;
    view.pickFly = true;
    view.pickFrom = "sheet";
    view.sel = null;
    go("#/trip/" + placeTrip.id + "/map");
    render();
  });
  function paintImportance() {
    $("importanceSeg").replaceChildren(...M.IMPORTANCE.map(([id, label]) =>
      el("button.imp-" + id, { type: "button", role: "radio", "aria-checked": String(importance === id), text: label,
        onclick: () => { importance = id; paintImportance(); } })));
  }
  // Your rating: tap a star to give that many, tap the same one again to take it away.
  function paintRating() {
    $("ratingSeg").replaceChildren(...[1, 2, 3, 4, 5].map((n) =>
      el("button.star" + (n <= rating ? ".on" : ""), { type: "button", role: "radio", "aria-checked": String(rating === n), "aria-label": starsLabel(n), text: "★",
        onclick: () => { rating = rating === n ? 0 : n; paintRating(); } })));
    $("ratingClear").hidden = !rating;
  }
  // Place or journey: one sheet, the fields of the other hidden (styles.css).
  function paintKind() {
    const f = $("placeForm");
    f.classList.toggle("is-journey", journey);
    // One name field and one start time, moved to where this kind shows them.
    $(journey ? "placeFromSlot" : "placeNameSlot").append(f.name);
    if (journey) $("leaveTimeSlot").append($("placeTime"));
    else $("placeTimeSlot").prepend($("placeTime"));
    $("kindSeg").hidden = !mayEdit(placeTrip);
    // A place's search answers show under its name; a journey's under where it leaves from.
    (journey ? $("placeFoundHome") : $("placeFoundSlot")).append($("placeFindNote"), $("placeResults"));
    const adding = !editingPlace && mayEdit(placeTrip);
    $("placePaste").hidden = !adding;
    $("placeDone").hidden = $("placeAnother").hidden = !adding || journey;
    $("kindSeg").replaceChildren(...[[false, i18n.t("Place")], [true, i18n.t("Journey")]].map(([j, label]) =>
      el("button", { type: "button", role: "radio", "aria-checked": String(journey === j), text: label,
        onclick: () => { journey = j; paintKind(); paintUntilRow(); } })));
    $("modeSeg").replaceChildren(...M.MODES.map(([id, label]) =>
      el("button", { type: "button", role: "radio", "aria-checked": String(mode === id), onclick: () => { mode = id; paintKind(); } },
        icon(MODE_ICON[id], ""), label)));
    if (mayEdit(placeTrip)) $("placeSheetTitle").textContent = editingPlace ? (journey ? i18n.t("Edit journey") : i18n.t("Edit place")) : journey ? i18n.t("Add a journey") : i18n.t("Add a place");
    f.name.placeholder = journey ? "Zurich (ZRH)" : "Fushimi Inari";
    paintBadge();
    paintRoute();
  }
  // When a journey arrives: the day it leaves, or one of the next three.
  function paintArrive(keep) {
    const dated = !!placeTrip.start;
    const day = dated ? $("daySelect").value : $("dayInput").value;
    $("arriveSelect").hidden = !dated;
    $("arriveInput").hidden = dated;
    const later = day ? [1, 2, 3].map((n) => M.addDays(day, n)) : [];
    $("arriveSelect").replaceChildren(el("option", { value: "", text: i18n.t("Same day") }),
      ...later.map((d) => el("option", { value: d, text: i18n.t("Day {n} · {date}", { n: M.dayIndex(placeTrip, d), date: dayLabel(d) }) })));
    $("arriveSelect").value = later.includes(keep) ? keep : "";
    $("arriveInput").min = day || "";
    $("arriveInput").value = keep > day ? keep : "";
  }
  function openPlace(place, trip, preset, from) {
    againOn($("placeSheet"), "places", place, trip, (p, t) => openPlace(p, t, p ? null : preset));
    editingPlace = place;
    placeTrip = trip;
    shareLink = null;
    untilWanted = false;
    checkedOk = false;
    const f = $("placeForm");
    f.reset();
    const p = place || { category: cats()[0][0], importance: "want", ...(preset || {}) };
    journey = M.isJourney(p);
    mode = p.mode || "flight";
    $("placeSheetTitle").textContent = place ? i18n.t("Edit place") : i18n.t("Add a place");
    f.name.value = p.name || "";
    // Your categories, and the place's own if it isn't one of them (a shared trip's).
    const list = cats();
    if (!list.some(([id]) => id === p.category)) list.push([p.category, M.catName(list, trip, p.category)]);
    $("categorySelect").replaceChildren(...list.map(([id, label]) => el("option", { value: id, text: label })));
    f.category.value = p.category;
    // A trip with a choice of destinations: this place's, or the nearest.
    const dests = trip.destinations;
    $("destField").hidden = !(dests.length >= 2 || M.hasDestDates(trip));
    const near = M.destOf(trip, { ...p, dest: null });
    $("destSelect").replaceChildren(el("option", { value: "", text: near ? i18n.t("{name} (nearest)", { name: near }) : i18n.t("None nearby") }),
      ...dests.map((d) => el("option", { value: d, text: d })));
    $("destSelect").value = p.dest && dests.includes(p.dest) ? p.dest : "";
    importance = p.importance;
    paintImportance();
    rating = p.rating || 0;
    paintRating();
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
    paintTimes();
    f.note.value = p.note || "";
    // The next leg starts where the last one arrived, location and all.
    loc = !place && p.lat != null ? { lat: p.lat, lng: p.lng, address: p.address, placeId: p.placeId, geoAt: p.geoAt } : undefined;
    categoryTouched = false;
    searching++;
    $("placeResults").replaceChildren();
    $("placeFindNote").textContent = "";
    paintWhere();
    f.toName.value = p.toName || "";
    toLoc = undefined;
    $("toResults").replaceChildren();
    $("toFindNote").textContent = "";
    paintTo();
    paintArrive(p.arriveDay || "");
    f.arriveTime.value = p.arriveTime || "";
    f.number.value = p.number || "";
    paintKind();
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
  // ---------- Shared into Tripboard ----------
  // Android's Share (MainActivity hands it to the App plugin as a
  // tripboard-share: address) or the installed web app's share target
  // (manifest.json, ?sharetext=): pick a trip, then Add a place opens with
  // what came, searched for by its name, and its link kept to attach.
  let shareLink = null, shareWaiting = null;
  function sharedIn(text, title) {
    const got = window.Tripboard.listImport.shared(text, title);
    if (!got) { toast(i18n.t("Nothing came with that to add.")); return; }
    // The address in its own direction, so a Hebrew "from Google Maps" doesn't get mixed into it.
    const from = got.maps ? i18n.t("from Google Maps") : got.url ? M.linkHost(got.url) : "";
    const where = [got.address ? el("bdi", { text: got.address }) : null, got.address && from ? " · " : "", from].filter(Boolean);
    $("shareInWhat").replaceChildren(el("strong", { text: got.name || (got.maps ? i18n.t("A place on Google Maps") : i18n.t("A link")) }),
      where.length ? el("span.dim", {}, ...where) : null);
    const trips = M.sortTrips(doc.trips, today()).filter((t) => mayEdit(t));
    // The trip under way, or else the next one, is the likely one.
    const likely = trips.find((t) => M.tripStatus(t, today()) === "now") || trips.find((t) => M.tripStatus(t, today()) === "upcoming");
    $("shareInTrips").replaceChildren(...trips.map((t) =>
      el("button.xrow" + (t === likely ? ".suggest" : ""), { type: "button", onclick: () => { closeSheet($("shareInSheet")).then(() => shareInto(t, got)); } },
        el("span.xrow-text", {}, el("span.xrow-title", { text: t.name }),
          el("span.xrow-meta", { text: [t.start ? rangeLabel(t) : "", t.destinations.join(", ")].filter(Boolean).join(" · ") || i18n.t("No dates yet") })))),
      el("button.xrow", { type: "button", onclick: async (e) => {
        await closeSheet($("shareInSheet"));
        openTrip(null, e.currentTarget);
        shareWaiting = got;
      } }, el("span.xrow-ic", {}, icon("plus")), el("span.xrow-text", {}, el("span.xrow-title", { text: i18n.t("New trip") }))));
    openSheet($("shareInSheet"));
  }
  // A new trip made for it gets it; one left unmade lets it go.
  $("tripSheet").addEventListener("close", () => { shareWaiting = null; });
  function shareInto(trip, got) {
    go("#/trip/" + trip.id);
    openPlace(null, trip, { name: got.name, ...(got.lat != null ? { lat: got.lat, lng: got.lng } : {}) });
    shareLink = got.url ? { url: got.url, maps: got.maps } : null;
    if (got.name && got.lat == null) findThis();
    else if (!got.name) $("placeForm").name.focus();
  }
  // Android: once from the share that opened the app, then each one after.
  function takeShares() {
    if (appPlugin) appPlugin.addListener("appUrlOpen", ({ url }) => {
      if (!/^tripboard-share:/.test(url || "")) return;
      let q;
      try { q = new URL(url).searchParams; } catch (e) { return; }
      sharedIn(q.get("text"), q.get("title"));
    });
    const q = new URLSearchParams(location.search);
    if (!["sharetext", "sharetitle", "shareurl"].some((k) => q.has(k))) return;
    history.replaceState(history.state, "", location.pathname + location.hash);
    sharedIn([q.get("sharetext"), q.get("shareurl")].filter(Boolean).join("\n"), q.get("sharetitle"));
  }
  // "Until": for a place that lasts several days, the last of them. Offered
  // once there's a day; the days after it, or any later date.
  function paintUntil(days, keep) {
    const dated = !!placeTrip.start;
    const day = dated ? $("daySelect").value : $("dayInput").value;
    $("untilSelect").hidden = !dated;
    $("untilInput").hidden = dated;
    $("untilSelect").replaceChildren(el("option", { value: "", text: i18n.t("Just that day") }),
      ...(days || M.tripDays(placeTrip, placesOf(placeTrip.id))).filter((d) => d > day).map((d) => el("option", { value: d,
        text: i18n.t("Day {n} · {date}", { n: M.dayIndex(placeTrip, d), date: dayLabel(d) }) })));
    $("untilSelect").value = keep > day ? keep : "";
    $("untilInput").min = day ? M.addDays(day, 1) : "";
    $("untilInput").value = keep > day ? keep : "";
    paintUntilRow();
  }
  async function commitPlace() {
    const f = $("placeForm");
    f.name.removeAttribute("aria-invalid");
    const stamp = new Date().toISOString();
    const day = placeTrip.start ? $("daySelect").value : $("dayInput").value;
    const until = placeTrip.start ? $("untilSelect").value : $("untilInput").value;
    const p = editingPlace || { id: M.newId(), trip: placeTrip.id, createdAt: stamp };
    const raw = editingPlace && JSON.stringify(p);
    const same = (a, b) => JSON.stringify(M.sanitizePlace({ ...a, updatedAt: 0 })) === JSON.stringify(M.sanitizePlace({ ...b, updatedAt: 0 }));
    if (day && until > day) p.endDay = until; else delete p.endDay;
    if (day !== p.day) delete p.order;
    if (rating) p.rating = rating; else delete p.rating;
    Object.assign(p, { name: f.name.value, category: f.category.value, importance, day, time: f.time.value, endTime: f.endTime.value, note: f.note.value, updatedAt: stamp });
    if (journey) {
      const arrive = placeTrip.start ? $("arriveSelect").value : $("arriveInput").value;
      // A new journey (or a place made one) goes under Getting around, unless a category was picked.
      if (!(editingPlace && M.isJourney(JSON.parse(raw))) && !categoryTouched) p.category = "transport";
      delete p.endDay; delete p.endTime;
      Object.assign(p, { kind: "journey", mode, toName: f.toName.value.trim(), arriveTime: f.arriveTime.value, number: f.number.value.trim() });
      if (day && arrive > day) p.arriveDay = arrive; else delete p.arriveDay;
      for (const k of ["toName", "arriveTime", "number"]) if (!p[k]) delete p[k];
      if (toLoc === null) { for (const k of ["toLat", "toLng", "toAddress", "toPlaceId", "toGeoAt"]) delete p[k]; }
      else if (toLoc) {
        for (const k of ["toAddress", "toPlaceId", "toGeoAt"]) delete p[k];
        Object.assign(p, { toLat: toLoc.lat, toLng: toLoc.lng });
        if (toLoc.source === "google") Object.assign(p, { toPlaceId: toLoc.placeId, toGeoAt: new Date().toISOString().slice(0, 10) });
        else if (toLoc.address) p.toAddress = toLoc.address;
      }
    } else {
      for (const k of ["kind", "mode", "toName", "toLat", "toLng", "toAddress", "toPlaceId", "toGeoAt", "arriveDay", "arriveTime", "number"]) delete p[k];
    }
    // A location set here, or Looks right, settles To check.
    if (loc !== undefined || checkedOk) delete p.check;
    if (loc === null) { for (const k of ["lat", "lng", "address", "placeId", "geoAt"]) delete p[k]; }
    else if (loc) {
      for (const k of ["address", "placeId", "geoAt"]) delete p[k];
      Object.assign(p, { lat: loc.lat, lng: loc.lng });
      // Google's terms: its place id kept for good, its location for 30 days
      // (geoAt says when), its address not at all.
      if (loc.source === "google") Object.assign(p, { placeId: loc.placeId, geoAt: new Date().toISOString().slice(0, 10) });
      // Carried from the leg before: Google's id with the day it was fetched.
      else if (loc.placeId && loc.geoAt) Object.assign(p, { placeId: loc.placeId, geoAt: loc.geoAt });
      else if (loc.address) p.address = loc.address;
    }
    if (!$("destField").hidden) M.setDest(placeTrip, p, $("destSelect").value || null);
    const closing = closeSheet($("placeSheet"));
    // Forward after Back opens the place just added, not a new empty one.
    if (!editingPlace) againOn($("placeSheet"), "places", p, placeTrip, (x, t) => openPlace(x, t));
    // What came with a share: its link goes on the new place's Attachments.
    const link = !editingPlace && shareLink;
    shareLink = null;
    if (!editingPlace) undoable(i18n.t("Added {name}.", { name: p.name }), () => {
      doc.places.push(p);
      if (link) doc.files = (doc.files || []).concat(M.sanitizeFile({ id: M.newId(), trip: placeTrip.id, kind: "link", url: link.url,
        name: link.maps ? "Google Maps" : M.linkHost(link.url), place: p.id, createdAt: stamp, updatedAt: stamp }));
    });
    else if (!same(p, JSON.parse(raw))) save();
    // Opened and left without a change: nothing to sync.
    else { for (const k of Object.keys(p)) delete p[k]; Object.assign(p, JSON.parse(raw)); }
    await closing;
    return p;
  }
  // There's no Save: leaving the sheet keeps what's in it. A new place
  // without a name is let go; an edited one keeps its old name.
  $("placeSheet").onLeave = () => {
    const f = $("placeForm");
    if (!mayEdit(placeTrip) || (!editingPlace && !f.name.value.trim())) return closeSheet($("placeSheet"));
    if (!f.name.value.trim()) f.name.value = editingPlace.name;
    return commitPlace();
  };
  for (const id of ["daySelect", "dayInput"]) $(id).addEventListener("change", () => {
    paintUntil(null, placeTrip.start ? $("untilSelect").value : $("untilInput").value);
    paintArrive(placeTrip.start ? $("arriveSelect").value : $("arriveInput").value);
  });
  // Add the next leg: this one is kept, and a new one starts where it arrives.
  $("nextLeg").addEventListener("click", async () => {
    const f = $("placeForm");
    if (!f.name.value.trim()) { f.name.focus(); f.name.setAttribute("aria-invalid", "true"); return; }
    const p = await commitPlace();
    const trip = placeTrip;
    openPlace(null, trip, { kind: "journey", mode: p.mode, category: p.category, name: p.toName || "", day: p.arriveDay || p.day || "",
      ...(p.toLat != null ? { lat: p.toLat, lng: p.toLng, address: p.toAddress, placeId: p.toPlaceId, geoAt: p.toGeoAt } : {}) });
  });
  $("placeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.name.value.trim()) { f.name.focus(); f.name.setAttribute("aria-invalid", "true"); return; }
    await commitPlace();
  });

  // ---------- Sharing ----------
  const SHARE = window.Tripboard.share;
  // A trip's share settings: what everyone gets, and anyone set apart.
  const SECTION_LABEL = () => [["expenses", i18n.t("Expenses")], ["files", i18n.t("Attachments")]];
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

    if (SHARE.enabled() && manage) main.append(publishPanel(trip));
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

  // ---------- Publishing ----------
  // A read-only copy of the plan that anyone with its link can open and
  // copy (src/share.js, server/published.js). The checks are kept for the
  // next Publish again.
  const pubOpts = {};
  function publishPanel(trip) {
    const st = SHARE.published(trip.id);
    const o = pubOpts[trip.id] || (pubOpts[trip.id] = { dates: st ? st.dates !== false : true, notes: st ? st.notes !== false : true });
    const box = el("section.panel.publish");
    const check = (k, title, hint) => el("label.check.dup-check", {},
      el("input", { type: "checkbox", checked: o[k], onchange: (e) => { o[k] = e.target.checked; } }),
      el("span", {}, el("strong", { text: title }), el("span.hint.dim", { text: hint })));
    const go = async (btn) => {
      btn.disabled = true;
      try { await SHARE.publish(trip, o); toast(st ? i18n.t("Published again.") : i18n.t("Published. Copy the link and send it.")); }
      catch (e) { toast(e.message); }
      render();
    };
    const name = SET.get().me.name;
    box.append(el("h2", { text: i18n.t("Publish") }),
      el("p.hint.dim", { text: i18n.t("A read-only copy of the plan that anyone with its link can open and copy into their own trips. It doesn't follow your changes: publish again to update it.") }));
    if (st) {
      const link = SHARE.publishedLink(st);
      const field = el("input.link-field", { readOnly: true, value: link, "aria-label": i18n.t("Published link"), onfocus: (e) => e.target.select() });
      const copy = async () => {
        try { await navigator.clipboard.writeText(link); toast(i18n.t("Link copied.")); } catch (e) { field.select(); }
      };
      const when = el("p.hint.dim", { text: i18n.t("Published {date}.", { date: i18n.date(new Date(st.at)) }) });
      SHARE.openPublished(st.id, st.server ? SHARE.host(st.server) : "").then((got) => {
        when.textContent = i18n.t("Published {date}.", { date: i18n.date(new Date(got.at)) }) + " " + (got.copies ? i18n.tn(got.copies, "Copied once.", "Copied {n} times.") : i18n.t("Not copied yet."));
      }).catch((e) => { if (e.status === 404) when.textContent = i18n.t("The server doesn't have it any more. Publish again to make a new link."); });
      box.append(field,
        el("div.loc-actions", {},
          navigator.share ? el("button.btn.primary", { type: "button", text: i18n.t("Send…"), onclick: () => navigator.share({ title: trip.name, url: link }).catch(() => {}) }) : null,
          el("button.btn", { type: "button", text: i18n.t("Copy link"), onclick: copy })),
        when);
    }
    const stop = el("button.btn.quiet.danger-text", { type: "button" });
    if (st) armConfirm(stop, i18n.t("Stop publishing"), async () => {
      try { await SHARE.unpublish(trip.id); toast(i18n.t("The published link doesn't work any more.")); }
      catch (e) { toast(e.message); }
      render();
    });
    box.append(el("fieldset.field.dup-what", {},
        check("dates", i18n.t("Dates"), i18n.t("Off: Day 1, Day 2 and so on, without your dates.")),
        check("notes", i18n.t("Descriptions, links and notes"), i18n.t("Each place's description, and the trip's links and notes. Never its files."))),
      el("p.hint.dim", { text: i18n.t("Never published: expenses, files, ratings, been there, a cover photo and who is on the trip.") + " " +
        (name ? i18n.t("It says it's by {name}.", { name }) : i18n.t("It shows no name; set yours in Settings › Sharing.")) }),
      el("div.loc-actions", {},
        el("button.btn" + (st ? "" : ".primary"), { type: "button", text: st ? i18n.t("Publish again") : i18n.t("Publish"), onclick: (e) => go(e.currentTarget) }),
        st ? stop : null));
    return box;
  }

  // A published trip, opened from its link: the plan, read only, and Copy
  // to my trips. Fetched once a visit; host is the server the link names.
  const pubCache = {};
  function renderPublished(main, id, host) {
    const key = id + "/" + (host || "");
    const got = pubCache[key];
    $("title").textContent = got && got.doc ? got.doc.trips[0].name : i18n.t("A published trip");
    if (!got) {
      pubCache[key] = { loading: true };
      SHARE.openPublished(id, host).then((r) => { pubCache[key] = { ...r, doc: M.publishedDoc(r.bundle) }; })
        .catch((e) => { pubCache[key] = { error: e.status === 404 ? i18n.t("This trip isn't published any more.") : e.message }; })
        .then(() => { if (location.hash.startsWith("#/p/" + id)) render(); });
    }
    if (!got || got.loading) { main.append(el("div.empty", {}, el("p.dim", { text: i18n.t("Opening…") }))); return; }
    if (got.error) { main.append(el("div.empty", {}, el("p", { text: got.error }))); return; }
    const pdoc = got.doc, trip = pdoc.trips[0], places = pdoc.places;
    const days = trip.start ? M.tripDays(trip, places).length : 0;
    const hero = coverBox(trip, "hero");
    hero.append(el("div.hero-text", {},
      el("span", { text: got.dates ? rangeLabel(trip) : days ? i18n.tn(days, "1 day", "{n} days") : "" }),
      trip.destinations.length ? el("ul.chips", {}, trip.destinations.map((d) => el("li", { text: d }))) : null));
    main.append(hero);
    const copyBtn = el("button.btn.primary", { type: "button", onclick: (e) => openDup(trip, e.currentTarget, { doc: pdoc, id, host, dates: got.dates }) }, icon("copy"), el("span", { text: i18n.t("Copy to my trips") }));
    main.append(el("section.panel.published-by", {},
      el("h2", {}, icon("globe"), el("span", { text: got.by ? i18n.t("Published by {name}", { name: got.by }) : i18n.t("A published trip") })),
      el("p.hint.dim", { text: [i18n.tn(places.length, "1 place", "{n} places"), i18n.t("Updated {date}", { date: i18n.date(new Date(got.at)) }), got.copies ? i18n.tn(got.copies, "Copied once", "Copied {n} times") : ""].filter(Boolean).join(" · ") }),
      el("p.hint.dim", { text: i18n.t("Read only. Copy it to make it yours: change anything, and it stays yours alone.") }),
      el("div", {}, copyBtn)));
    const label = (day) => (got.dates ? dayLabel(day) : i18n.t("Day {dayIndex}", { dayIndex: M.dayIndex(trip, day) }));
    const row = (p) => {
      const links = (pdoc.files || []).filter((f) => f.place === p.id && f.kind === "link");
      return el("li.pub-place", {}, el("details", {},
        el("summary", {}, icon(M.isJourney(p) ? "route" : catIcon(p.category)), el("span.grow", { text: M.isJourney(p) ? p.name + " → " + (p.toName || "") : p.name }), p.time ? el("span.dim", { text: p.time }) : null),
        p.note ? el("p.pub-note", { text: p.note }) : null,
        links.length ? el("p", {}, links.map((f, i) => [i ? " · " : null, el("a", { href: f.url, target: "_blank", rel: "noopener noreferrer nofollow", text: f.name })])) : null,
        p.lat != null ? openIn(p) : null));
    };
    const wrap = el("div.groups.pub-plan");
    for (const g of M.board(trip, places, "time")) {
      if (!g.places || !g.places.length) continue;
      const title = g.day ? label(g.day) : g.title;
      wrap.append(el("section.group", {}, el("div.group-head", {}, el("h2", { text: title }), el("span.count", { text: String(g.places.length) })),
        el("ul.pub-places", {}, g.places.map(row))));
    }
    main.append(wrap);
    const loose = (pdoc.files || []).filter((f) => !f.place);
    if (loose.length) {
      main.append(el("section.panel", {}, el("h2", { text: i18n.t("Links and notes") }),
        el("ul.pub-places", {}, loose.map((f) => el("li.pub-place", {}, f.kind === "link"
          ? el("a", { href: f.url, target: "_blank", rel: "noopener noreferrer nofollow", text: f.name })
          : el("details", {}, el("summary", { text: f.name }), el("p.pub-note", { text: f.text })))))));
    }
  }

  // ---------- Joining from a link ----------
  // host: the server the link names, when it isn't Tripboard's.
  function renderJoin(main, tripId, code, host) {
    $("title").textContent = i18n.t("Join a trip");
    if (findTrip(tripId) && SHARE.shared(tripId)) { go("#/trip/" + tripId, true); return; }
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
        el("button.btn.quiet", { type: "button", text: i18n.t("Cancel"), onclick: async () => { await SHARE.allowJoin(null); go("#/", true); } })));
      return;
    }
    const me = SET.get().me;
    const name = el("input", { value: me.name, autocomplete: "name", maxlength: "60", placeholder: i18n.t("Your name") });
    const go = el("button.btn.primary", { type: "button", text: i18n.t("Join"), onclick: async () => {
      go.disabled = true;
      if (name.value.trim() !== me.name) SET.setMe({ name: name.value });
      try { await SHARE.join(tripId, code, host); go("#/trip/" + tripId, true); }
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
  // The map's places: the day picked on the map, and the importance and
  // category filters (the Plan's too; all when none picked).
  function shownPlaces(trip) {
    let all = placesOf(trip.id);
    if (view.mapDay) all = all.filter((p) => M.onDay(p, view.mapDay) || (M.isJourney(p) && M.landsOn(p) === view.mapDay));
    return M.filterPlaces(all, { only: view.only, categories: view.mapCats, stars: view.stars, check: view.check });
  }
  // The trip's categories, in the app's order, each with how many places.
  function tripCats(trip) {
    const n = new Map();
    for (const p of placesOf(trip.id)) n.set(p.category, (n.get(p.category) || 0) + 1);
    return cats().filter(([id]) => n.has(id)).map(([id, name]) => ({ id, name, n: n.get(id) }));
  }
  // The filters the Plan and the map share, each a chip that opens the
  // same drop-down with its choices: categories (this trip's), importance
  // and rating (one choice: that many stars and up, or not rated yet).
  function mapFacets(trip) {
    const n = (key) => placesOf(trip.id).reduce((m, p) => m.set(p[key], (m.get(p[key]) || 0) + 1), new Map());
    const imp = n("importance");
    return {
      cat: { title: i18n.t("Categories"), key: "mapCats", many: (k) => i18n.tn(k, "1 category", "{n} categories"),
        items: tripCats(trip).map((c) => ({ ...c, mark: () => icon(catIcon(c.id)) })) },
      imp: { title: i18n.t("Importance"), key: "only", many: (k) => i18n.tn(k, "1 level", "{n} levels"),
        items: M.IMPORTANCE.map(([id, name]) => ({ id, name, n: imp.get(id) || 0, mark: () => el("span.dot.imp-" + id) })) },
      stars: { title: i18n.t("Rating"), key: "stars", one: true,
        items: STAR_CHOICES().map(([id, name, short]) => ({ id, name, short, n: placesOf(trip.id).filter((p) => !M.isJourney(p) && (!id || M.filterPlaces([p], { stars: id }).length)).length })) },
    };
  }
  // The rating filter's choices: [id, its name in the list, the chip's words when on].
  const STAR_CHOICES = () => [["", i18n.t("Any rating"), ""], ["5", i18n.t("5 stars"), i18n.t("5 stars")], ["4", i18n.t("4 stars and up"), i18n.t("4★ and up")],
    ["3", i18n.t("3 stars and up"), i18n.t("3★ and up")], ["none", i18n.t("Not rated yet"), i18n.t("Not rated")]];
  function paintFilters(trip) {
    const bar = $("mapFilters");
    bar.hidden = !placesOf(trip.id).length;
    bar.replaceChildren(...filterChips(trip));
  }
  function filterChips(trip) {
    const facets = mapFacets(trip);
    view.mapCats = view.mapCats.filter((id) => facets.cat.items.some((c) => c.id === id));
    const chip = (which) => {
      const f = facets[which];
      const on = f.one ? f.items.find((c) => c.id && c.id === view[f.key]) : null;
      const picked = f.one ? (on ? [on] : []) : f.items.filter((c) => view[f.key].includes(c.id));
      return el("button.chip.pick.filter-pick", { type: "button", "aria-pressed": String(picked.length > 0), "aria-haspopup": "menu", "data-which": which,
        "aria-expanded": String(filterMenu.open === which), onclick: (e) => filterMenu(trip, which, e.currentTarget) },
        on ? null : picked.length === 1 ? picked[0].mark() : null, on ? on.short : !picked.length ? f.title : picked.length === 1 ? picked[0].name : f.many(picked.length), icon("chevron"));
    };
    // Rating only once a place has one (or the filter is on).
    const rated = view.stars || placesOf(trip.id).some((p) => p.rating);
    // To check only while a place is (a list's lookup wasn't sure of it).
    const unsure = placesOf(trip.id).filter((p) => p.check).length;
    if (!unsure && view.check) { view.check = false; remember(); }
    const check = unsure ? el("button.chip.pick.check-pick", { type: "button", "aria-pressed": String(!!view.check),
      onclick: () => { view.check = !view.check; remember(); render(); } }, icon("info"), i18n.t("To check · {n}", { n: unsure })) : null;
    return [check, facets.cat.items.length > 1 ? chip("cat") : null, chip("imp"), rated ? chip("stars") : null].filter(Boolean);
  }
  // A filter's drop-down, under its chip: All, then a box for each choice.
  // It stays open while boxes are ticked; the last ticked box can't be
  // unticked, since none would show nothing.
  let filterBox = null;
  function closeFilterMenu(refocus) {
    if (!filterBox) return;
    const which = filterMenu.open;
    filterBox.remove(); filterBox = null; filterMenu.open = null;
    const chip = document.querySelector('.filter-pick[aria-expanded="true"]');
    if (chip) chip.setAttribute("aria-expanded", "false");
    if (refocus) { const again = [...document.querySelectorAll(".filter-pick")].find((b) => !b.hidden && b.offsetParent && b.dataset.which === which); if (again) again.focus(); }
  }
  function filterMenu(trip, which, from) {
    const same = filterMenu.open === which;
    closeFilterMenu();
    if (same) return;
    filterMenu.open = which;
    from.setAttribute("aria-expanded", "true");
    const box = el("div.quick-menu.filter-menu", { role: "menu", "aria-label": mapFacets(trip)[which].title });
    const paint = () => {
      const f = mapFacets(trip)[which];
      if (f.one) {
        const row = (c) => el("button", { type: "button", role: "menuitemradio", "aria-checked": String(view[f.key] === c.id),
          onclick: () => { view[f.key] = c.id; remember(); paint(); render(); } },
          el("span.box.radio", {}, view[f.key] === c.id ? icon("check") : null), +c.id ? el("span.star", { text: "★", "aria-hidden": "true" }) : null, el("span.grow", { text: c.name }), c.id ? el("span.dim", { text: String(c.n) }) : null);
        box.replaceChildren(row(f.items[0]), el("hr"), ...f.items.slice(1, -1).map(row), el("hr"), row(f.items[f.items.length - 1]));
        return;
      }
      const ids = f.items.map((x) => x.id);
      const on = (id) => !view[f.key].length || view[f.key].includes(id);
      const set = (next) => { view[f.key] = next.length === ids.length ? [] : next; remember(); paint(); render(); };
      const row = (checked, mark, label, n, onclick) => el("button", { type: "button", role: "menuitemcheckbox", "aria-checked": String(checked), onclick },
        el("span.box", {}, checked === "mixed" ? icon("minus") : checked ? icon("check") : null), mark, el("span.grow", { text: label }), n == null ? null : el("span.dim", { text: String(n) }));
      const all = !view[f.key].length ? true : "mixed";
      box.replaceChildren(row(all, null, i18n.t("All"), null, () => { if (all !== true) set(ids); }),
        el("hr"),
        ...f.items.map((c) => row(on(c.id), c.mark(), c.name, c.n, () => {
          const next = on(c.id) ? ids.filter((x) => x !== c.id && on(x)) : ids.filter((x) => x === c.id || on(x));
          if (next.length) set(next);
        })));
    };
    paint();
    document.body.append(box);
    filterBox = box;
    const c = from.getBoundingClientRect(), r = box.getBoundingClientRect(), M8 = 8;
    const left = i18n.dir === "rtl" ? c.right - r.width : c.left;
    box.style.left = Math.max(M8, Math.min(innerWidth - r.width - M8, left)) + "px";
    box.style.top = Math.min(c.bottom + 4, innerHeight - r.height - M8) + "px";
    box.dataset.y = String(scrollTop());
    if (!lessMotion() && box.animate) box.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { duration: 120, easing: "ease-out" });
    box.querySelector("button").focus({ preventScroll: true });
  }
  document.addEventListener("pointerdown", (e) => { if (filterBox && !filterBox.contains(e.target) && !e.target.closest(".filter-pick")) closeFilterMenu(); }, true);
  document.addEventListener("keydown", (e) => {
    if (!filterBox) return;
    if (e.key === "Escape") { e.preventDefault(); closeFilterMenu(true); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...filterBox.querySelectorAll("button")];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  });
  window.addEventListener("hashchange", () => closeFilterMenu());
  window.addEventListener("resize", () => closeFilterMenu());
  // A render can nudge the page a pixel or two; only a real scroll closes it.
  document.addEventListener("scroll", () => { if (filterBox && Math.abs(scrollTop() - Number(filterBox.dataset.y)) > 24) closeFilterMenu(); }, true);
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
    try { got = await TM.open($("map"), { chain: SET.chain("map"), providers: SET.get().providers }); noteKeys(got); }
    catch (e) {
      noteKeys(e);
      window.Keel.errlog.note("map", String(e));
      mapFailed = navigator.onLine === false ? i18n.t("The map needs a connection the first time it opens.")
        : i18n.t("The map couldn't load. {why}", { why: e.skipped && e.skipped.length ? e.message : i18n.t("Check the connection and try again.") });
      mapMessage(mapFailed);
      return;
    }
    $("mapTools").hidden = false;
    const note = $("mapNote");
    note.hidden = !(got && got.skipped.length);
    if (got && got.skipped.length) note.textContent = i18n.t("Showing {name}: {join}", { name: SET.PROVIDERS[got.by].name, join: got.skipped.map((x) => x.reason).join(" ") });
    if (!mapOn() || view.trip !== trip.id) return;
    paintDays(trip);
    paintFilters(trip);
    const list = shownPlaces(trip);
    const route = view.mapDay ? M.dayRoute(list, view.mapDay) : [];
    // A journey is a line on the map, not a pin.
    // Moving a place: its pin is shown even if filtered out, picked, and draggable.
    const moving = view.pick && placesOf(trip.id).find((p) => p.id === view.pick);
    const pins = list.filter((p) => !M.isJourney(p));
    if (moving && !pins.includes(moving)) pins.push(moving);
    // Show on map: its pin even if filtered out, picked and centred.
    const shown = !moving && view.flyTo && placesOf(trip.id).find((p) => p.id === view.flyTo && p.lat != null);
    if (shown && !pins.includes(shown)) pins.push(shown);
    TM.places(pins, moving ? moving.id : view.sel, new Map(route.map((p, i) => [p.id, i + 1])));
    TM.drag(moving && moving.lat != null ? moving.id : null, (at) => {
      const p = doc.places.find((x) => x.id === view.pick);
      if (p) movePlace(p, at);
    });
    TM.route(route);
    TM.journeys(list.filter(M.isJourney));
    const ends = (l) => l.flatMap((p) => (M.isJourney(p) ? [p, M.endOf(p)].filter(Boolean) : [p]));
    // A place being moved is centred instead of framing them all.
    if (moving && moving.lat != null) {
      if (first || view.pickFly || $("map").dataset.trip !== trip.id) TM.flyTo(moving);
      $("map").dataset.trip = trip.id;
      view.pickFly = false;
    } else if (shown) {
      TM.flyTo(shown);
      $("map").dataset.trip = trip.id;
      view.flyTo = null; view.fitDay = false;
    } else if (first || view.fitDay || $("map").dataset.trip !== trip.id) { TM.fit(ends(list.length ? list : placesOf(trip.id))); $("map").dataset.trip = trip.id; view.fitDay = false; }
    paintPanel(trip);
    panel.hidden = !panel.childNodes.length;
  }
  function mapMessage(text) {
    $("mapTools").hidden = true;
    $("mapPanel").replaceChildren(el("p", { text }), el("button.btn", { type: "button", text: i18n.t("Try again"), onclick: () => { mapFailed = null; render(); } }));
    $("mapPanel").hidden = false;
  }
  TM.onPin = (id) => {
    if (view.pick) return;
    view.sel = view.sel === id ? null : id;
    render();
  };
  TM.onFocus = (id) => {
    if (view.pick) return;
    const p = doc.places.find((x) => x.id === id);
    view.sel = id;
    render();
    if (p) TM.focus(p);
  };
  TM.onTap = ({ lat, lng }) => {
    if (view.pick) {
      const p = doc.places.find((x) => x.id === view.pick);
      if (p) movePlace(p, { lat, lng });
      else { view.pick = null; render(); }
      return;
    }
    if (view.sel) { view.sel = null; render(); }
  };
  // A place moved on the map, by a tap or by dragging its pin. It stays
  // movable until Done, which opens the place again.
  function movePlace(p, { lat, lng }) {
    for (const k of ["address", "placeId", "geoAt", "check"]) delete p[k];
    Object.assign(p, { lat, lng, updatedAt: new Date().toISOString() });
    save();
  }
  function paintPanel(trip) {
    const panel = $("mapPanel");
    panel.classList.remove("nowhere");
    const all = placesOf(trip.id);
    if (view.pick) {
      const p = all.find((x) => x.id === view.pick);
      const placed = p && p.lat != null;
      panel.replaceChildren(el("p.pick", { text: !p ? i18n.t("Tap the map where it is.") : placed ? i18n.t("Drag {name}'s pin, or tap the map where it is.", { name: p.name }) : i18n.t("Tap the map where {name} is.", { name: p.name }) }),
        el("button.btn" + (placed ? ".primary" : ""), { type: "button", text: placed ? i18n.t("Done") : i18n.t("Cancel"), onclick: (e) => {
          view.pick = null;
          render();
          const back = view.pickFrom === "sheet";
          view.pickFrom = null;
          if (placed) { view.sel = p.id; if (back) openPlace(p, trip, null, e.currentTarget); }
        } }));
      return;
    }
    const sel = view.sel && all.find((x) => x.id === view.sel);
    if (sel) {
      const meta = [M.IMPORTANCE_LABEL.get(sel.importance), M.catName(cats(), findTrip(view.trip), sel.category)];
      if (sel.day) meta.push(daysLabel(sel));
      if (timeLabel(sel, view.mapDay)) meta.push(timeLabel(sel, view.mapDay));
      if (sel.rating) meta.push("★ " + sel.rating);
      panel.replaceChildren(el("div.sel", {},
        el("strong", { text: sel.name }), el("span.dim", { text: meta.join(" · ") }),
        sel.address ? el("span.dim.addr", { text: sel.address }) : null),
        ...(sees(trip, "files") && filesOn(sel.id).length ? [el("ul.attached", {}, fileButtons(filesOn(sel.id)))] : []),
        el("div.loc-actions", {},
          el("button.btn", { type: "button", text: mayEdit(trip) ? i18n.t("Edit") : i18n.t("Details"), onclick: (e) => openPlace(sel, trip, null, e.currentTarget) }),
          mayEdit(trip) ? el("button.btn.quiet", { type: "button", text: i18n.t("Move pin"), onclick: () => { view.pick = sel.id; view.sel = null; render(); } }) : null),
        openIn(sel));
      return;
    }
    const nowhere = shownPlaces(trip).filter((p) => p.lat == null);
    if (!nowhere.length || !mayEdit(trip)) { panel.replaceChildren(); return; }
    // Folded to one line by default, so the map stays in view.
    const open = view.unplacedOpen;
    panel.classList.add("nowhere");
    panel.replaceChildren(...[
      el("button.unplaced-head", { type: "button", "aria-expanded": String(open),
        onclick: () => { view.unplacedOpen = !open; remember(); render(); } },
        icon("pin"), el("span", { text: i18n.tn(nowhere.length, "1 place has no location yet", "{n} places have no location yet") }), icon("chevron", "fold")),
      open ? el("p.dim", { text: i18n.t("Pick one, then tap the map.") }) : null,
      open ? el("ul.unplaced", {}, nowhere.map((p) => el("li", {}, el("button.chip.imp-" + p.importance, { type: "button", "aria-pressed": "true", text: p.name,
        onclick: () => { view.pick = p.id; render(); } })))) : null].filter(Boolean));
  }

  // The map's style: the free maps (OpenFreeMap's), then the ones that need
  // a key. Picking one changes Settings › Services › Map: its provider
  // becomes the map, with OpenFreeMap behind it if it fails. One that needs
  // a key and has none opens that provider's setup.
  const MAP_STYLES = [
    { id: "auto", name: () => i18n.t("Auto"), sub: () => i18n.t("Follows the app"), at: [["openfreemap", "style", "light"]] },
    { id: "light", name: () => i18n.t("Light"), at: [["openfreemap", "style", "positron"]] },
    { id: "dark", name: () => i18n.t("Dark"), at: [["openfreemap", "style", "dark"]] },
    { id: "liberty", name: () => "Liberty", sub: () => i18n.t("Colourful"), at: [["openfreemap", "style", "liberty"]] },
    { id: "bright", name: () => "Bright", at: [["openfreemap", "style", "bright"]] },
    { id: "streets", name: () => i18n.t("Streets"), sub: () => "MapTiler", at: [["maptiler", "style", "streets"]], only: true },
    { id: "streets", name: () => i18n.t("Map"), sub: () => "Google", at: [["google", "mapType", "roadmap"]], only: true },
    { id: "satellite", name: () => i18n.t("Satellite"), sub: (by) => by ? SET.PROVIDERS[by].name : "MapTiler, Google", at: [["maptiler", "style", "satellite"], ["google", "mapType", "satellite"]] },
    { id: "outdoor", name: () => i18n.t("Outdoor"), sub: () => "MapTiler", at: [["maptiler", "style", "outdoor"]] },
    { id: "terrain", name: () => i18n.t("Terrain"), sub: () => "Google", at: [["google", "mapType", "terrain"]] },
  ];
  function paintMapStyles() {
    const cur = SET.get(), main = cur.map.main;
    const isOn = ([id, k, v]) => main === id && (cur.providers[id] || {})[k] === v;
    const tile = (st) => {
      const at = st.at.find(isOn) || st.at.find(([id]) => SET.ready(id));
      const on = !!st.at.find(isOn);
      const locked = !at;
      return el("button.mstyle" + (locked ? ".locked" : ""), { type: "button", "aria-pressed": String(on),
        onclick: () => {
          if (locked) { closeSheet($("mapStyleSheet")); go("#/settings/p/" + st.at[0][0]); return; }
          const [id, k, v] = at;
          SET.setProvider(id, { [k]: v });
          if (main !== id) SET.setService("map", { main: id, fallback: id === "openfreemap" ? (cur.map.fallback === "openfreemap" ? "" : cur.map.fallback) : "openfreemap" });
          closeSheet($("mapStyleSheet"));
          render();
        } },
        el("span.mthumb." + st.id, {}, locked ? icon("key") : null),
        st.name(), st.sub ? el("small", { text: st.sub(at && at[0] !== "openfreemap" && st.at.length > 1 ? at[0] : null) }) : null);
    };
    const free = MAP_STYLES.filter((st) => st.at[0][0] === "openfreemap");
    const keyed = MAP_STYLES.filter((st) => st.at[0][0] !== "openfreemap" && (!st.only || SET.ready(st.at[0][0])));
    const anyKey = SET.ready("maptiler") || SET.ready("google");
    $("mapStyles").replaceChildren(
      el("p.mstyle-group", { text: i18n.t("Free") }), el("div.mstyle-grid", {}, free.map(tile)),
      el("p.mstyle-group", { text: anyKey ? i18n.t("With your key") : i18n.t("With your own key") }), el("div.mstyle-grid", {}, keyed.map(tile)),
      anyKey ? null : el("p.mstyle-hint", {}, i18n.t("A free MapTiler key gives satellite and outdoor maps:") + " ",
        el("a", { href: "#/settings/p/maptiler", text: i18n.t("set it up"), onclick: (e) => { e.preventDefault(); closeSheet($("mapStyleSheet")); go("#/settings/p/maptiler"); } })));
  }
  function mapButtons() {
    $("mapZoomIn").append(icon("plus"));
    $("mapZoomOut").append(icon("minus"));
    $("mapStyleBtn").append(icon("layers"));
    $("mapFit").append(icon("fit"));
    $("mapLocate").append(icon("locate"));
    $("mapCreditIc").append(icon("info"));
    $("mapZoomIn").addEventListener("click", () => TM.zoom(1));
    $("mapZoomOut").addEventListener("click", () => TM.zoom(-1));
    $("mapStyleBtn").addEventListener("click", (e) => { paintMapStyles(); openSheet($("mapStyleSheet"), e.currentTarget); });
    $("mapStyleSheet").again = () => { if (!mapOn()) return false; $("mapStyleBtn").click(); };
    $("mapFit").addEventListener("click", () => {
      const trip = findTrip(view.trip);
      if (!trip) return;
      const list = shownPlaces(trip);
      TM.fit(list.some((p) => p.lat != null) ? list : placesOf(trip.id), true);
    });
    $("mapLocate").addEventListener("click", () => TM.locate());
    TM.onLocateFail = () => toast(i18n.t("Couldn't find where you are. Check that location is allowed for Tripboard."));
    $("mapCredit").addEventListener("click", () => TM.toggleCredits());
    // The buttons rise above a place's card: its height, kept current.
    const panel = $("mapPanel");
    if (window.ResizeObserver) new ResizeObserver(() => $("mapView").style.setProperty("--panel-h", (panel.hidden ? 0 : panel.offsetHeight + 8) + "px")).observe(panel);
  }

  // Links that open a place in another maps app: Google Maps by its id or
  // location, Apple Maps, and Waze (which needs a location).
  function openLinks(p) {
    const at = p.lat != null ? p.lat.toFixed(6) + "," + p.lng.toFixed(6) : "";
    const name = encodeURIComponent(p.name || "");
    const g = "https://www.google.com/maps/search/?api=1&query=" + (at && !p.placeId ? at : name) + (p.placeId ? "&query_place_id=" + encodeURIComponent(p.placeId) : "");
    const a = "https://maps.apple.com/?q=" + name + (at ? "&ll=" + at : "");
    // What's offered follows the device (keel's platform.js): Apple Maps on
    // Apple's, Waze on phones, and on Android the phone's own list of the
    // map apps it has (a geo: link).
    const dev = window.Keel.platform.device, phone = window.Keel.platform.phone;
    const links = [["Google Maps", g]];
    if (dev === "ios" || dev === "mac") links.push(["Apple Maps", a]);
    if (at && phone) links.push(["Waze", "https://waze.com/ul?ll=" + at + "&navigate=yes"]);
    // Street View is Google Maps' own; it opens there, at the place.
    if (at) links.push([i18n.t("Street View"), "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=" + at]);
    if (at && dev === "android") links.push([i18n.t("Other apps…"), "geo:" + at + "?q=" + at + (p.name ? "(" + name + ")" : "")]);
    return links;
  }
  function openIn(p) {
    const links = openLinks(p);
    return el("p.open-in", {}, el("span.dim", { text: i18n.t("Open in ") }),
      links.map(([label, href], i) => [i ? el("span.dim", { text: " · " }) : null, el("a", { href, target: href.startsWith("geo:") ? null : "_blank", rel: "noopener noreferrer", text: label })]));
  }

  // ---------- Google's 30-day locations ----------
  // A location from Google is kept 30 days (its terms). Past that it's
  // fetched again by its place id, or dropped when Google can't answer;
  // a dropped one comes back the next time Google can. Offline, nothing
  // changes until there's a connection.
  let refreshing = false;
  async function refreshGoogle() {
    if (refreshing || navigator.onLine === false) return;
    // A journey's arrival from Google is kept the same way, by its to* fields.
    const due = M.staleGoogle(doc.places, today()).map((p) => [p, ""]).concat(M.staleGoogleTo(doc.places, today()).map((p) => [p, "to"])).slice(0, 50);
    if (!due.length) return;
    refreshing = true;
    const key = SET.ready("google") ? SET.get().providers.google.key : "";
    let changed = 0;
    const k = (pre, name) => (pre ? pre + name[0].toUpperCase() + name.slice(1) : name);
    for (const [p, pre] of due) {
      try {
        if (!key) throw new Error("no key");
        const at = await PL.googleLocation(p[k(pre, "placeId")], { key });
        Object.assign(p, { [k(pre, "lat")]: at.lat, [k(pre, "lng")]: at.lng, [k(pre, "geoAt")]: today() });
        changed++;
      } catch (e) {
        if (p[k(pre, "lat")] != null) { for (const n of ["lat", "lng", "geoAt"]) delete p[k(pre, n)]; changed++; }
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
    for (const f of data.files.filter(M.hasBytes)) {
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
      [i18n.t("Set a budget under Billing › Budgets & caps for this project, with a spend cap of a small real amount (not 0, or Maps stops at once) and email alerts, so a leaked key can't run up a bill."), "https://console.cloud.google.com/billing/budgets"],
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

  // A map or search run tells each key how it went: refused, or worked.
  function noteKeys(r) {
    if (!r) return;
    for (const x of r.skipped || []) if (x.refused) SET.setCheck(x.id, false);
    if (r.by) SET.setCheck(r.by, true);
  }
  function keyedSearch(q, o) { return PL.search(q, o).then((r) => { noteKeys(r); return r; }, (e) => { noteKeys(e); throw e; }); }

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
      { ico: "palette", title: i18n.t("Display"), where: i18n.t("Settings"), href: "#/settings/appearance", words: "appearance theme dark light system mode colours" },
      { ico: "globe", title: i18n.t("Language"), where: i18n.t("Display"), href: "#/settings/appearance", words: "language english hebrew rtl right to left שפה עברית אנגלית" },
      { ico: "cloudSun", title: i18n.t("Temperature"), where: i18n.t("Display"), href: "#/settings/appearance", words: "temperature celsius fahrenheit units degrees" },
      { ico: "clock", title: i18n.t("Clock"), where: i18n.t("Display"), href: "#/settings/appearance", words: "clock time 12 24 hour am pm format" },
      { ico: "calendar", title: i18n.t("Dates"), where: i18n.t("Display"), href: "#/settings/appearance", words: "dates date format order day month" },
      { ico: "tag", title: i18n.t("Categories"), where: i18n.t("Settings"), href: "#/settings/categories", words: "categories category kinds types places add rename remove order sights food stays" },
      { ico: "plug", title: i18n.t("Services"), where: i18n.t("Settings"), href: "#/settings/services", words: "connections providers map search keys google maptiler openstreetmap openfreemap" },
      { ico: "map", title: i18n.t("Map"), where: i18n.t("Services"), href: "#/settings/map", words: "map tiles use fallback if it fails provider" },
      { ico: "search", title: i18n.t("Find by name"), where: i18n.t("Services"), href: "#/settings/search", words: "search find places geocoding use fallback if it fails provider" },
      { ico: "cloudSun", title: i18n.t("Weather"), where: i18n.t("Services"), href: "#/settings/weather", words: "weather forecast rain open-meteo sunrise sunset" },
      { ico: "key", title: i18n.t("AI tools"), where: i18n.t("Services"), href: "#/settings/ai", words: "ai chat claude chatgpt mcp cli connector delete deleting allow permission" },
      { ico: "users", title: i18n.t("Sharing"), where: i18n.t("Settings"), href: "#/settings/sharing", words: "you name me profile person shared trips paid by who" },
      { ico: "users", title: i18n.t("Sharing server"), where: i18n.t("Sharing"), href: "#/settings/server", words: "sharing server own self host cloudflare worker deploy address invite" },
      { ico: "database", title: i18n.t("Data"), where: i18n.t("Settings"), href: "#/settings/data", words: "data sync backup storage" },
      { ico: "refresh", title: i18n.t("GitHub sync"), where: i18n.t("Data"), href: "#/settings/data", words: "sync devices github repo token connect disconnect backup cloud phone computer" },
      ...(driveOn() ? [{ ico: "cloud", title: i18n.t("Google Drive"), where: i18n.t("Data"), href: "#/settings/drive", words: "drive google backup backups restore automatic cloud copy" }] : []),
      { ico: "database", title: i18n.t("Storage and backup"), where: i18n.t("Data"), href: "#/settings/data", words: "storage space used trips places photos covers persistent keep safe delete browser backup restore file export import save json" },
      { ico: "info", title: i18n.t("About"), where: i18n.t("Settings"), href: "#/settings/about", words: "version credits licences privacy" },
      { ico: "list", title: i18n.t("Changelog"), where: i18n.t("About"), href: "#/settings/changelog", words: "changelog changes what's new whats new versions releases unreleased" },
      ...(window.Tripboard.channels() ? [{ ico: "refresh", title: i18n.t("Updates"), where: i18n.t("About"), href: "#/settings/about", words: "updates unreleased builds channel releases newest" }] : []),
    ];
    for (const [id, P] of Object.entries(SET.PROVIDERS)) {
      const href = "#/settings/p/" + id;
      out.push({ ico: P_ICON[id], title: P.name, where: i18n.t("Services"), href, words: P.services.map(svcName).join(" ") });
      if (P.key) out.push({ ico: P_ICON[id], title: i18n.t("Key"), where: P.name, href, words: "api key paste test remove how to get a key" });
      for (const [opt, choices] of Object.entries(P.options || {})) {
        out.push({ ico: P_ICON[id], title: opt === "mapType" ? i18n.t("Map type") : i18n.t("Style"), where: P.name, href, words: choices.map((c) => c[1]).join(" ") });
      }
    }
    out.push({ ico: "key", title: i18n.t("Sync keys"), where: i18n.t("Services"), href: "#/settings/services", words: "sync keys api key github devices share keys.json" });
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
  const SETTINGS_PARENT = { map: "services", search: "services", p: "services", weather: "services", ai: "services",
    server: "sharing", drive: "data", changelog: "about" };
  const settingsParent = (page) => SETTINGS_PARENT[String(page).split("/")[0]] || "";

  // On a computer Settings has two panes: its list (and search) on one side,
  // the page open on the other, Display when none is.
  const SETTINGS_SECTION = { display: "appearance", you: "sharing", sync: "data", storage: "data" };
  function renderSettings(main, page) {
    if (!DESK.matches) return settingsPage(main, page) || settingsHome(main);
    const open = page || "appearance";
    const top = settingsParent(open) || SETTINGS_SECTION[open] || open.split("/")[0];
    const nav = el("nav.settings-nav", { "aria-label": i18n.t("Settings") }), pane = el("div.settings-pane");
    main.append(nav, pane);
    settingsHome(nav);
    for (const a of nav.querySelectorAll(".sgroup > .sgroup-card > .srow")) {
      if (a.getAttribute("href") === "#/settings/" + top) a.setAttribute("aria-current", "page");
    }
    if (!settingsPage(pane, open)) settingsPage(pane, "appearance");
  }
  function settingsPage(main, page) {
    if (page === "map" || page === "search") return (renderService(main, page), true);
    if (page === "services") return (renderServices(main), true);
    if (page === "drive") return (renderDrive(main), true);
    if (page === "you" || page === "sharing") return (renderSharing(main), true);
    if (page === "data" || page === "sync" || page === "storage") return (renderData(main), true);
    if (page === "categories") return (renderCategories(main), true);
    if (page === "appearance" || page === "display") return (renderAppearance(main), true);
    if (page === "about") return (renderAbout(main), true);
    if (page === "changelog") return (renderChangelog(main), true);
    if (page === "weather") return (renderWeather(main), true);
    if (page === "server") return (renderServer(main), true);
    if (page === "ai") return (renderAi(main), true);
    const pm = /^p\/(\w+)$/.exec(page || "");
    if (pm && SET.PROVIDERS[pm[1]]) return (renderProvider(main, pm[1]), true);
    return false;
  }
  function settingsHome(main) {
    $("title").textContent = i18n.t("Settings");
    const cfg = SET.get();
    const input = el("input", { type: "search", placeholder: i18n.t("Search settings"), "aria-label": i18n.t("Search settings"), autocomplete: "off", spellcheck: false, value: view.settingsQ || "" });
    const results = el("div.settings-results");
    const needs = SERVICES.map(([svc]) => serviceStatus(svc, cfg)).find((st) => st.tone === "warn");
    const home = el("div.sgroup", {}, el("div.sgroup-card", {},
      srow("#/settings/appearance", "palette", i18n.t("Display"), { text: i18n.t("Theme, language, temperature and clock") }),
      srow("#/settings/categories", "tag", i18n.t("Categories"), { text: cats().map(([, n]) => n).slice(0, 4).join(", ") + (cats().length > 4 ? "…" : "") }),
      srow("#/settings/services", "plug", i18n.t("Services"), needs || { text: i18n.t("Map, search, weather and AI tools") }),
      srow("#/settings/sharing", "users", i18n.t("Sharing"), { text: i18n.join([cfg.me.name || i18n.t("No name yet"), SHARE.server() === SHARE.DEFAULT ? i18n.t("Tripboard's server") : SHARE.host(SHARE.server())]) }),
      srow("#/settings/data", "database", i18n.t("Data"), dataSummary()),
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
    main.append(el("p.dim.hint.page-hint", { text: i18n.t("What Tripboard uses from outside this device: the map, place search, the weather and AI tools. For the map and search, pick one provider and one to fall back on.") }),
      sgroup(i18n.t("Use"), SERVICES.map(([svc, title]) => srow("#/settings/" + svc, S_ICON[svc], title, serviceStatus(svc, cfg))).concat(
        srow("#/settings/weather", "cloudSun", i18n.t("Weather"), { text: wxOn() ? i18n.t("On, from Open-Meteo") : i18n.t("Off") }),
        srow("#/settings/ai", "key", i18n.t("AI tools"), { text: cfg.ai.deleting ? i18n.t("Can delete") : i18n.t("Can't delete") }))),
      sgroup(i18n.t("Providers"), Object.entries(SET.PROVIDERS).map(([id, P]) => srow("#/settings/p/" + id, P_ICON[id], P.name, providerStatus(id)))),
      keySyncPanel());
  }
  // Sync keys: the Google and MapTiler keys in the sync repo's keys.json.
  function keySyncPanel() {
    const on = SET.get().keySync.on, linked = SYNC && SYNC.connected();
    return el("section.panel", {},
      el("fieldset.field", {}, el("legend", { text: i18n.t("Sync keys") }),
        el("div.seg", { role: "radiogroup" }, [["off", i18n.t("Off")], ["on", i18n.t("On")]].map(([id, label]) => el("button", { type: "button", role: "radio", "aria-checked": String((on ? "on" : "off") === id), text: label,
          onclick: () => { if ((id === "on") === on) return; SET.setKeySync(id === "on"); if (linked) SYNC.soon(); render(); } })))),
      el("p.hint.dim", { text: i18n.t("On, your Google and MapTiler keys go to your GitHub sync repo (keys.json), so your other devices get them, and a key you change or remove changes everywhere. Anything that can read that repo can read them, and its history keeps old keys: if one leaks, make a new one. Tripboard's AI tools never read it.") }),
      on && !linked ? el("p.hint", { "data-tone": "warn", text: i18n.t("GitHub sync is off, so keys stay on this device until it's on.") }) : null);
  }

  const THEMES = [["system", i18n.t("Same as this device")], ["light", i18n.t("Light")], ["dark", i18n.t("Dark")]];
  // Display: how things look and read on this device.
  function renderAppearance(main) {
    $("title").textContent = i18n.t("Display");
    const dp = SET.get().display;
    const seg = (legend, opts, cur, pick) => el("fieldset.field", {}, el("legend", { text: legend }),
      el("div.seg", { role: "radiogroup" }, opts.map(([id, label]) => el("button", { type: "button", role: "radio", dir: "auto", "aria-checked": String(cur === id), text: label, onclick: () => { pick(id); render(); } }))));
    const at = new Date(2026, 10, 21, 13, 0);
    const sample = (opts, lang) => new Intl.DateTimeFormat(lang || i18n.lang, opts).format(at);
    const cur = SET.get().appearance.theme;
    main.append(el("section.panel", {}, el("fieldset.field", {}, el("legend", { text: i18n.t("Theme") }),
      el("div.seg", { role: "radiogroup" }, THEMES.map(([id, label]) => el("button", { type: "button", role: "radio", "aria-checked": String(cur === id), text: id === "system" ? i18n.t("System") : label,
        onclick: () => { SET.setTheme(id); render(); } })))),
      el("fieldset.field", {}, el("legend", { text: i18n.t("Language") }),
        el("div.seg", { role: "radiogroup" }, [["", i18n.t("System")], ...i18n.list().map((l) => [l.code, l.name])].map(([code, label]) => el("button", { type: "button", role: "radio", "aria-checked": String((i18n.choice || "") === code), text: label,
          onclick: () => { if (i18n.set(code)) location.reload(); } })))),
      seg(i18n.t("Temperature"), [["c", "°C"], ["f", "°F"]], wxUnit(), (id) => SET.setWeather({ unit: id })),
      seg(i18n.t("Clock"), [["", i18n.t("System")], ["12", sample({ hour: "numeric", minute: "2-digit", hour12: true })], ["24", sample({ hour: "2-digit", minute: "2-digit", hour12: false })]], dp.clock, (id) => SET.setDisplay({ clock: id })),
      i18n.lang === "en" ? seg(i18n.t("Dates"), [["", i18n.t("System")], ["md", sample({ day: "numeric", month: "short" }, "en-US")], ["dm", sample({ day: "numeric", month: "short" }, "en-GB")]], dp.dates, (id) => SET.setDisplay({ dates: id })) : null));
  }

  // Storage and backup, on the Data page.
  function storageParts() {
    const trips = doc.trips.length, places = doc.places.length, covers = doc.trips.filter((t) => t.cover).length, files = (doc.files || []).length;
    const used = el("p.hint.dim", { text: i18n.t("Working it out…") });
    const keep = el("p.hint.dim");
    const keepBtn = el("button.btn", { type: "button", text: i18n.t("Keep my trips safe"), hidden: true });
    const S = navigator.storage;
    (async () => {
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
    })();
    return [el("section.panel", {},
      el("p", { text: i18n.join([i18n.tn(trips, "1 trip", "{n} trips"), i18n.tn(places, "1 place", "{n} places"), i18n.tn(covers, "1 cover photo", "{n} cover photos"), i18n.tn(files, "1 file", "{n} files")]) + "." }),
      used, keep, el("div.loc-actions", {}, keepBtn)),
    el("section.panel", {}, el("h2", { text: i18n.t("Backup") }),
      el("p.hint.dim", { text: i18n.t("A file with your trips, places, expenses, cover photos and files. Restoring it adds its trips here, and replaces a trip that's already here.") }),
      el("div.loc-actions", {},
        el("button.btn", { type: "button", text: i18n.t("Save a backup"), disabled: !trips, onclick: () => saveBackup() }),
        el("label.btn.quiet", {}, i18n.t("Restore from a file"), el("input.visually-hidden", { type: "file", accept: ".json,application/json",
          onchange: (e) => { const f = e.target.files && e.target.files[0]; if (f) restoreBackup(f); e.target.value = ""; } }))))];
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

  // "Key", with how it last went: a dot and a word, once there's a key.
  const KEY_STATE = { unchecked: () => i18n.t("not checked yet"), ok: () => i18n.t("works"), refused: () => i18n.t("refused") };
  function keyLabel(id) {
    const st = SET.keyState(id);
    if (st === "none") return el("span.key-label", { text: i18n.t("Key") });
    return el("span.key-label", { "data-state": st }, el("span.key-dot", { "aria-hidden": "true" }), i18n.t("Key") + " · " + KEY_STATE[st]());
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
      const eye = el("button.key-eye", { type: "button", "aria-label": i18n.t("Show key"), "aria-pressed": "false", onclick: () => {
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        eye.setAttribute("aria-pressed", String(show));
        eye.setAttribute("aria-label", show ? i18n.t("Hide key") : i18n.t("Show key"));
        eye.replaceChildren(icon(show ? "eyeOff" : "eye"));
      } }, icon("eye"));
      kids.push(el("label.field", {}, keyLabel(id), el("span.key-wrap", {}, input, eye)),
        el("div.loc-actions", {},
          el("button.btn", { type: "button", text: i18n.t("Test"), onclick: () => testProvider(id, status) }),
          conf.key ? el("button.btn.danger", { type: "button", text: i18n.t("Remove key"), onclick: () => { SET.setProvider(id, { key: "" }); render(); } }) : null),
        status);
    } else {
      kids.push(el("div.loc-actions", {}, el("button.btn", { type: "button", text: i18n.t("Test"), onclick: () => testProvider(id, status) })), status);
    }
    main.append(el("section.panel", {}, kids));
    if (STEPS[id]) main.append(el("section.panel", {}, el("h2", { text: i18n.t("How to get a key") }),
      el("ol.steps", {}, STEPS[id].map(([t, href]) => el("li", {}, t, href ? [" ", el("a", { href, target: "_blank", rel: "noopener noreferrer", text: i18n.t("Open") })] : null)))));
    if (P.key) main.append(el("p.dim.hint", { text: SET.get().keySync.on
      ? i18n.t("Sync keys is on: the key is also in your GitHub sync repo, so your other devices get it. It's sent only to {name} when it's used.", { name: P.name })
      : i18n.t("The key is kept in this browser only, and sent only to {name} when it's used.", { name: P.name }) }));
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
    const w = SET.get().weather;
    const seg = (legend, opts, cur, pick) => el("fieldset.field", {}, el("legend", { text: legend }),
      el("div.seg", { role: "radiogroup" }, opts.map(([id, label]) => el("button", { type: "button", role: "radio", "aria-checked": String(cur === id), text: label, onclick: () => { pick(id); render(); } }))));
    main.append(el("section.panel", {},
      seg(i18n.t("Show the weather"), [["on", i18n.t("On")], ["off", i18n.t("Off")]], w.on ? "on" : "off", (id) => { SET.setWeather({ on: id === "on" }); if (id === "off") try { localStorage.removeItem(WX_KEY); } catch (e) { /* private window */ } }),
      el("p.hint.dim", { text: i18n.t("°C or °F is in Settings › Display.") }),
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

  // About's Check for updates (app.js's checkUpdates). In the apps an
  // update is offered right here, with keel's Update / Install button.
  function updateCheck() {
    const text = el("p.update-status", { "aria-live": "polite" });
    const btn = el("button.btn", { type: "button", text: i18n.t("Check for updates") });
    const box = el("div.update-check", {}, text, btn);
    const say = (msg, label, onclick) => { text.textContent = msg; btn.textContent = label; btn.disabled = false; btn.onclick = onclick; };
    const check = async () => {
      text.textContent = i18n.t("Checking…");
      btn.disabled = true;
      try {
        const r = await window.Tripboard.checkUpdates();
        if (r.offer) r.offer({ bar: box, text, btn });
        else if (r.reload) say(i18n.t("A new version is ready."), i18n.t("Reload"), () => location.reload());
        else say(i18n.t("You have the latest version."), i18n.t("Check again"), check);
      } catch (e) {
        say(i18n.t("Couldn't check for updates. Are you online?"), i18n.t("Try again"), check);
      }
    };
    btn.onclick = check;
    return box;
  }

  // Which builds Check for updates offers, on this device: releases, or
  // also the newest build of main (keel's unreleased channel).
  function channelField() {
    const T = window.Tripboard;
    if (!T.channels()) return null;
    const on = T.releases.channel() === "unreleased";
    return el("div.channel", {},
      el("fieldset.field", {}, el("legend", { text: i18n.t("Updates") }),
        el("div.seg", { role: "radiogroup" }, [["release", i18n.t("Releases")], ["unreleased", i18n.t("Unreleased builds")]].map(([id, label]) => el("button", { type: "button", role: "radio", "aria-checked": String((on ? "unreleased" : "release") === id), text: label,
          onclick: () => { if ((id === "unreleased") === on) return; T.releases.setChannel(id); render(); } })))),
      el("p.hint.dim", { text: i18n.t("Unreleased builds are every change once it's merged, before it's a release. They can have bugs a release wouldn't. This device only.") }));
  }

  // Settings › About › Changelog: CHANGELOG.md as this copy of the app has
  // it, in English only (the items say which way they read: dir="auto").
  // A build of main or a test build has what's merged since its
  // version on top (tools/build-www.js), shown as Not released yet.
  function renderChangelog(main) {
    $("title").textContent = i18n.t("Changelog");
    const C = window.Keel.changelog, v = window.Tripboard.version;
    const box = el("div.changelog", {}, el("p.dim", { text: i18n.t("Loading…") }));
    main.append(box);
    C.load("CHANGELOG.md?v=" + v).then((entries) => {
      if (!entries || !entries.length) return box.replaceChildren(el("p.hint", { "data-tone": "warn", text: i18n.t("The changelog didn't load. It's on GitHub as CHANGELOG.md.") }));
      const mine = C.mine(entries, v);
      const day = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? i18n.date(new Date(d + "T12:00:00")) : d);
      box.replaceChildren(...entries.map((e) => el("section.panel.change", { "aria-current": e === mine ? "true" : null },
        el("h2", {}, e.version === "Unreleased" ? i18n.t("Not released yet") : e.version,
          e === mine ? el("span.change-you", { text: i18n.t("You have this") }) : null),
        e.date ? el("p.dim.change-date", { text: day(e.date) }) : null,
        ...e.sections.map((sec) => el("div.change-part", {},
          sec.title ? el("h3", { text: KINDS[sec.title] ? KINDS[sec.title]() : sec.title }) : null,
          el("ul", {}, sec.items.map((t) => el("li", { dir: "auto", text: t }))))))));
    });
  }
  const KINDS = { Added: () => i18n.t("Added"), Changed: () => i18n.t("Changed"), Fixed: () => i18n.t("Fixed"), Removed: () => i18n.t("Removed") };

  function renderAbout(main) {
    $("title").textContent = i18n.t("About");
    const link = (text, href) => el("a", { href, target: "_blank", rel: "noopener noreferrer", text });
    main.append(el("section.panel", {}, el("h2", { text: i18n.t("Tripboard {version}", { version: window.Tripboard.version }) }),
      el("p.dim", { text: i18n.t("Your trips stay on this device, and in your own private GitHub repo if you turn on sync. Keys and tokens you add are kept in this browser and sent only to their own service.") }),
      updateCheck(), channelField()),
    sgroup(i18n.t("Changes"), [srow("#/settings/changelog", "list", i18n.t("Changelog"), { text: i18n.t("What changed in each version") })]),
    sgroup(i18n.t("Credits"), [el("ul.credits", {},
      el("li", {}, i18n.t("Icons: "), link("Lucide", "https://lucide.dev"), " (ISC)"),
      el("li", {}, i18n.t("Map: "), link("MapLibre GL JS", "https://maplibre.org"), " (BSD-3), ", link("OpenFreeMap", "https://openfreemap.org"), ", © ", link("OpenMapTiles", "https://www.openmaptiles.org")),
      el("li", {}, i18n.t("Map data and Find by name: © "), link("OpenStreetMap", "https://www.openstreetmap.org/copyright"), i18n.t(" contributors, "), link("Nominatim", "https://nominatim.org")),
      el("li", {}, i18n.t("Weather data: "), link("Open-Meteo.com", "https://open-meteo.com"), " (CC BY 4.0)"),
      el("li", {}, i18n.t("Hebrew and Arabic map labels: "), link("mapbox-gl-rtl-text", "https://github.com/mapbox/mapbox-gl-rtl-text"), " (BSD-2)"),
      el("li", {}, i18n.t("With your own key: "), link("Google Maps Platform", "https://developers.google.com/maps"), ", ", link("MapTiler", "https://www.maptiler.com")))]));
  }

  // ---------- You ----------
  // Sharing: your name on shared trips, and the server they go through.
  function renderSharing(main) {
    $("title").textContent = i18n.t("Sharing");
    const me = SET.get().me;
    const name = el("input", { value: me.name, autocomplete: "name", maxlength: "60", placeholder: i18n.t("Your name"),
      onchange: (e) => { SET.setMe({ name: e.target.value }); toast(i18n.t("Saved.")); } });
    main.append(el("section.panel", {}, el("label.field", {}, i18n.t("Your name"), name),
      el("p.hint.dim", { text: i18n.t("Shown to people you share a trip with, next to what you add and what you paid. Your devices that sync share one id for you, kept in the sync repo.") })),
    sgroup(i18n.t("Server"), [srow("#/settings/server", "users", i18n.t("Sharing server"), { text: SHARE.server() === SHARE.DEFAULT ? i18n.t("Tripboard's server") : SHARE.host(SHARE.server()) })]));
  }

  // Data: where your trips are kept, on this device and elsewhere.
  function dataSummary() {
    const sync = syncSummary();
    if (sync.tone === "warn") return sync;
    return { text: SYNC && SYNC.connected() ? i18n.t("GitHub sync on · backups") : i18n.t("On this device · backups") };
  }
  // Data: GitHub sync, storage and backups, all on one page.
  function renderData(main) {
    $("title").textContent = i18n.t("Data");
    const label = (t) => el("h2.sgroup-label.data-label", { text: t });
    main.append(label(i18n.t("GitHub sync")), ...syncParts(),
      ...(driveOn() ? [sgroup(i18n.t("Backups elsewhere"), [srow("#/settings/drive", "cloud", i18n.t("Google Drive"), driveSummary())])] : []),
      label(i18n.t("On this device")), ...storageParts(),
      el("p.dim.hint.page-hint", { text: SYNC && SYNC.connected() ? i18n.t("Your trips are also in your GitHub repo, so clearing this site's data loses only what hasn't synced yet.")
        : i18n.t("Without GitHub sync, trips live in this browser only. Clearing this site's data deletes them.") }));
    if (syncPaint) syncPaint();
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
    if (s < 60) return i18n.t("just now");
    if (s < 3600) return i18n.tn(Math.round(s / 60), "1 min ago", "{n} min ago");
    if (s < 86400) return i18n.tn(Math.round(s / 3600), "1 h ago", "{n} h ago");
    return fmt({ day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
  }
  function syncSummary() {
    if (!SYNC || !SYNC.connected()) return { text: i18n.t("Off. Keep your trips on every device") };
    const st = SYNC.status, c = SET.get().sync;
    if (st.state === "error") return { text: i18n.t("Didn't finish. Open for why"), tone: "warn" };
    if (st.state === "syncing") return { text: i18n.t("Syncing…") };
    return { text: st.at ? i18n.t("{repo}, synced {ago}", { repo: c.owner + "/" + c.repo, ago: ago(st.at) }) : c.owner + "/" + c.repo };
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
    box.hidden = true;
    const show = el("button.btn", { type: "button", text: i18n.t("Show setup code"), hidden: !svg, onclick: () => { box.hidden = !box.hidden; show.textContent = box.hidden ? i18n.t("Show setup code") : i18n.t("Hide setup code"); } });
    const copy = async () => {
      try { await navigator.clipboard.writeText(link); toast(i18n.t("Setup link copied. Only send it to yourself.")); }
      catch (e) { toast(i18n.t("Couldn't copy the link.")); }
    };
    return el("section.panel", {},
      el("h2", { text: i18n.t("Add another device") }),
      el("p.hint.dim", { text: i18n.t("Point the other device's camera at this code, or send yourself the link and open it there. Tripboard asks before it connects.") }),
      svg ? box : null,
      el("div.loc-actions", {}, show, el("button.btn", { type: "button", text: i18n.t("Copy setup link"), onclick: copy })),
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
      el("p.hint.dim", { text: i18n.t("From Settings › Data on a device that's already connected.") }),
      el("div.link-row", {}, input, go), status);
  }

  // GitHub sync, on the Data page: the setup form, or the repo and its status.
  function syncParts() {
    const c = SET.get().sync;
    const status = el("p.hint", { role: "status" });
    const out = pendingSetup ? [setupPanel()] : [];
    if (!SYNC.connected()) {
      if (pendingSetup) return out;
      const owner = el("input", { value: c.owner, autocomplete: "off", spellcheck: false, autocapitalize: "off", placeholder: "your-user-name" });
      const repo = el("input", { value: c.repo, autocomplete: "off", spellcheck: false, autocapitalize: "off" });
      const token = el("input", { type: "password", autocomplete: "off", spellcheck: false, placeholder: "github_pat_…" });
      const go = el("button.btn", { type: "button", text: i18n.t("Connect") });
      go.onclick = async () => {
        const v = { owner: owner.value.trim(), repo: repo.value.trim(), token: token.value.trim() };
        if (!v.owner || !v.repo || !v.token) { status.textContent = i18n.t("All three are needed."); return; }
        if (await connectSync(v, status, go)) render();
      };
      out.push(el("section.panel", {},
        el("p", { text: i18n.t("Sync keeps your trips in a private GitHub repo of yours, so your phone and computer see the same trips. Tripboard has no server: your trips go only to GitHub.") }),
        el("details.sync-steps", {}, el("summary", { text: i18n.t("How to make the repo and token") }),
          el("ol.steps", {}, SYNC_STEPS.map(([t, href]) => el("li", {}, t, href ? [" ", el("a", { href, target: "_blank", rel: "noopener noreferrer", text: i18n.t("Open") })] : null)))),
        el("label.field", {}, i18n.t("GitHub user name"), owner),
        el("label.field", {}, i18n.t("Repo"), repo),
        el("label.field", {}, i18n.t("Token"), token),
        el("div.loc-actions", {}, go), status,
        el("p.hint.dim", { text: i18n.t("The token is kept in this browser and sent only to GitHub. Anyone who can open this browser's Tripboard can use it, so give it only that one repo.") })),
      pastePanel());
      return out;
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
    out.push(el("section.panel", {}, el("h2", {}, el("a", { href: repoUrl, target: "_blank", rel: "noopener noreferrer", text: c.owner + "/" + c.repo })),
      line, el("p.hint.dim", { text: i18n.t("It syncs a few seconds after each change, when Tripboard opens, and every few minutes while it's open.") }),
      el("div.loc-actions", {}, now,
        el("button.btn.danger", { type: "button", text: i18n.t("Disconnect"), onclick: async () => {
          SET.setSync({ token: "" });
          await SYNC.forget();
          render();
          toast(i18n.t("Disconnected. Your trips stay on this device and in the repo."));
        } })),
      el("p.hint.dim", { text: i18n.t("Each trip is a file in the repo (trips/), with its cover photo (covers/). Changes made on two devices at once are merged; when both changed the same thing, the later change wins.") })),
    addDevicePanel());
    return out;
  }

  // ---------- Google Drive backups (src/drive.js) ----------
  // Dated copies of every trip beside GitHub sync, not a second sync: a
  // backup never merges on its own. Restoring one is the same as restoring
  // a backup file, and Undo takes it back.
  const DRIVE = window.Tripboard.drive;
  const driveOn = () => !!(DRIVE && DRIVE.available);
  let driveList = null, driveBusy = false;
  const deviceName = () => { const P = window.Keel.platform || {}; return P.native ? (P.os === "ios" ? "iPhone" : "Android") : P.desktop ? (P.desktopOs === "linux" ? "Linux" : "Windows") : "Browser"; };
  const when = (at) => fmt({ day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(at));
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
    let worked = 0, refused = false;
    if (P.services.includes("search")) {
      try { const r = await PL.providers[id].search("Eiffel Tower", { key: conf.key }); worked++; lines.push(r.length ? i18n.t("Find by name works.") : i18n.t("Find by name works, though it found nothing for a test search.")); }
      catch (e) { refused = refused || !!e.refused; lines.push(i18n.t("Find by name: {why}", { why: e.message })); }
    }
    if (P.services.includes("map")) {
      try { await TM.SOURCES[id](conf, false); worked++; lines.push(i18n.t("The map works.")); }
      catch (e) { refused = refused || !!e.refused; lines.push(i18n.t("Map: {why}", { why: e.message })); }
    }
    if (refused) SET.setCheck(id, false);
    else if (worked) SET.setCheck(id, true);
    const label = status.parentNode && status.parentNode.querySelector(".key-label");
    if (label) label.replaceWith(keyLabel(id));
    status.textContent = navigator.onLine === false ? i18n.t("Testing needs a connection.") : lines.join(" ");
  }
  SET.onChange(() => { mapFailed = null; });

  // ---------- Routing ----------
  function render() {
    stamp();
    const before = tabBefore();
    paint();
    paintPicking();
    tabAfter(before);
  }
  function paint() {
    const sm = /^#\/settings(?:\/(.+))?$/.exec(location.hash);
    const settings = !!sm;
    const jm = /^#\/join\/([\w-]+)\/([\w-]+)(?:\/([\w.:-]+))?/.exec(location.hash);
    const pm = /^#\/p\/([\w-]+)(?:\/([\w.:-]+))?/.exec(location.hash);
    const m = /^#\/trip\/([\w-]+)(?:\/(map|expenses|files|share|today)(?:\/(\d{4}-\d\d-\d\d))?)?/.exec(location.hash);
    const trip = m ? findTrip(m[1]) : null;
    $("settingsBtn").hidden = settings || !!m || /^#\/p\//.test(location.hash);
    if (m && !trip) { go("#/", true); return; }
    if (trip && (m[2] === "expenses" || m[2] === "files") && !sees(trip, m[2])) { go("#/trip/" + trip.id, true); return; }
    if (trip && m[2] === "today" && !(m[3] && M.isDay(m[3])) && !underWay(trip)) { go("#/trip/" + trip.id, true); return; }
    if (trip && m[2] === "today") view.day = m[3] && M.isDay(m[3]) ? m[3] : today();
    if ((trip && trip.id) !== view.trip) { picked = null; view.pick = null; view.sel = null; view.mapDay = null; view.trip = trip ? trip.id : null; }
    view.mode = trip && m[2] ? m[2] : "board";
    const onMap = view.mode === "map";
    $("mapView").hidden = !mapOn();
    document.body.classList.toggle("desk", deskTrip());
    document.body.classList.toggle("land", !!trip && land() && view.mode !== "share");
    document.querySelectorAll(".bar > .controls").forEach((c) => c.remove());
    document.body.classList.toggle("side-map", sideMap());
    document.documentElement.dataset.look = "list";
    document.documentElement.dataset.rows = "expanded";
    paintSide(deskTrip() ? trip : null);
    paintTripBar(view.mode === "share" ? null : trip);
    paintOfflineBadge();
    paintSyncBadge();
    $("shareTrip").hidden = !trip || view.mode === "share";
    $("viewTrip").hidden = !trip || ["share", "expenses", "files"].includes(view.mode);
    paintView();
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
    const y = main.dataset.trip === view.trip + view.mode ? scrollTop() : 0;
    main.dataset.trip = view.trip + view.mode;
    main.replaceChildren();
    document.body.classList.toggle("on-board", !!trip);
    document.body.classList.toggle("on-home", !trip && !settings && !jm && !pm);
    document.body.classList.toggle("on-settings", settings);
    $("newTrip").hidden = !!(trip || settings || jm || pm);
    $("back").hidden = !trip;
    $("editTrip").hidden = !trip || !mayEdit(trip) || view.mode === "share";
    $("fab").hidden = !trip || !mayEdit(trip) || view.mode === "share";
    if (jm) { $("back").hidden = false; renderJoin(main, jm[1], jm[2], jm[3]); }
    else if (pm) { $("back").hidden = false; renderPublished(main, pm[1], pm[2]); }
    else if (settings) { $("back").hidden = false; renderSettings(main, sm[1] || ""); }
    else if (trip && view.mode === "expenses") renderExpenses(main, trip);
    else if (trip && view.mode === "files") renderFiles(main, trip);
    else if (trip && view.mode === "share") renderShare(main, trip);
    else if (trip && view.mode === "today") renderToday(main, trip);
    else if (trip) renderBoard(main, trip); else renderHome(main);
    $("fab").setAttribute("aria-label", view.mode === "expenses" ? i18n.t("Add an expense") : view.mode === "files" ? i18n.t("Add an attachment") : i18n.t("Add a place"));
    if (view.mode !== "share") main.classList.remove("share-page");
    main.classList.toggle("today-page", !!trip && view.mode === "today");
    if (view.mode !== "files") { main.ondragover = main.ondragleave = main.ondrop = null; main.classList.remove("file-over"); }
    if (deskTrip()) main.scrollTop = y; else window.scrollTo(0, y);
    if (trip && sideMap()) showMap(trip);
  }

  // Swiping sideways on the bottom bar moves between a trip's tabs; on the
  // Plan's page it moves between its views (Time, Destination, ...), in
  // the order the switch shows them. Nowhere else, so the page never
  // changes tab under a finger. Not from a screen edge (the system's
  // back), over a dialog, a field, the map, a row that scrolls sideways,
  // or while text is selected.
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
      const bar = !!at.closest("#bottomBar");
      if (bar && document.body.classList.contains("land")) return;
      if (!bar && (!["board", "today"].includes(view.mode) || view.pick || at.closest("#mapView") || at.closest("input, textarea, select, [contenteditable]") || sideways(at))) return;
      s = { x: t.clientX, y: t.clientY, at: e.timeStamp, bar };
    }, { passive: true });
    document.addEventListener("touchmove", (e) => { if (e.touches.length > 1) s = null; }, { passive: true });
    document.addEventListener("touchcancel", () => { s = null; }, { passive: true });
    document.addEventListener("touchend", (e) => {
      if (!s) return;
      const t = e.changedTouches[0], bar = s.bar;
      const step = M.swipeStep(t.clientX - s.x, t.clientY - s.y, e.timeStamp - s.at, i18n.dir === "rtl");
      s = null;
      const sel = window.getSelection();
      if (!step || (sel && !sel.isCollapsed)) return;
      const trip = findTrip(view.trip);
      if (!trip) return;
      if (!bar) {
        if (view.mode === "today") {
          const to = document.querySelectorAll(".day-steps .day-step")[step > 0 ? 1 : 0];
          if (to && to.href) go(to.getAttribute("href"));
          return;
        }
        if (view.mode !== "board") return;
        const sorts = sortsOf(trip), i = sorts.findIndex(([id]) => id === view.sort);
        const next = i < 0 ? null : sorts[i + step];
        if (next) pickSort(next[0], document.querySelector(".seg.sorts"));
        return;
      }
      const tabs = tripTabs(trip);
      const i = tabs.findIndex(([mode]) => mode === view.mode);
      const next = i < 0 ? null : tabs[i + step];
      if (!next) return;
      view.pick = null;
      go("#/trip/" + trip.id + next[3]);
    }, { passive: true });
  }

  // The token leaves the address bar before anything else happens.
  function takeSetupLink() {
    if (!/^#t=/.test(location.hash)) return false;
    const v = setupIn(location.hash);
    history.replaceState(history.state, "", location.pathname + location.search + "#/settings/data");
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

  // A long press (touch) or a right-click (mouse, or the keyboard's menu
  // key) on what matches sel calls hold(node, x, y, keyboard, touch); it answers
  // true when it did something. A tap still goes through at once; only a
  // press held LONG_PRESS ms without moving counts, and the click that may
  // follow it is swallowed.
  const LONG_PRESS = 450;
  function onHold(sel, hold) {
    let timer = 0, swallow = false;
    const at = (n) => n && n.closest && n.closest(sel);
    const cancel = () => { clearTimeout(timer); timer = 0; };
    document.addEventListener("pointerdown", (e) => {
      // A long press that Android ended with its own menu has no click to
      // swallow, so the swallow ends with it, not on the next tap.
      if (swallow === "hold") swallow = false;
      const node = at(e.target);
      if (!node || e.pointerType === "mouse") return;
      cancel();
      const x0 = e.clientX, y0 = e.clientY;
      timer = setTimeout(() => {
        timer = 0;
        if (hold(node, x0, y0, false, true)) { swallow = "hold"; if (navigator.vibrate) navigator.vibrate(10); }
      }, LONG_PRESS);
      const move = (m) => { if (Math.hypot(m.clientX - x0, m.clientY - y0) > 10) cancel(); };
      node.addEventListener("pointermove", move);
      const done = () => { cancel(); node.removeEventListener("pointermove", move); };
      node.addEventListener("pointerup", done, { once: true });
      node.addEventListener("pointercancel", done, { once: true });
    }, true);
    document.addEventListener("contextmenu", (e) => {
      const node = at(e.target);
      if (!node) return;
      if (swallow) { e.preventDefault(); return; }
      if (hold(node, e.clientX, e.clientY, !e.clientX && !e.clientY)) { e.preventDefault(); cancel(); }
    });
    document.addEventListener("click", (e) => {
      if (!swallow) return;
      swallow = false;
      if (at(e.target)) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    return { swallow: () => { swallow = true; } };
  }

  // A small menu at the pointer (or under the item, from the keyboard):
  // Home's trips get Edit and Delete; the Plan's places Select, Edit and
  // Delete. Delete asks first (confirmDelete), then the toast offers Undo.
  let qBox = null, qFrom = null;
  const qHeld = [];
  function closeQuick(refocus) {
    if (!qBox) return;
    qBox.remove();
    qBox = null;
    if (refocus && qFrom) qFrom.focus();
  }
  // items: [icon, label, go, danger]
  function openQuick(from, label, items, x, y, keyboard) {
    closeQuick();
    qFrom = from;
    qBox = el("div.quick-menu", { role: "menu", "aria-label": label }, items.map(([ico, text, go, danger]) =>
      el("button" + (danger ? ".danger" : ""), { type: "button", role: "menuitem", onclick: () => { closeQuick(); go(); } }, icon(ico), el("span", { text }))));
    document.body.append(qBox);
    const r = qBox.getBoundingClientRect(), M8 = 8, vw = innerWidth, vh = innerHeight;
    if (keyboard) { const c = from.getBoundingClientRect(); x = i18n.dir === "rtl" ? c.right : c.left; y = c.bottom; }
    const left = i18n.dir === "rtl" ? x - r.width : x;
    const top = y + r.height + M8 > vh ? y - r.height : y;
    qBox.style.left = Math.max(M8, Math.min(vw - r.width - M8, left)) + "px";
    qBox.style.top = Math.max(M8, Math.min(vh - r.height - M8, top)) + "px";
    if (!lessMotion() && qBox.animate) qBox.animate([{ opacity: 0, transform: "scale(0.92)" }, { opacity: 1, transform: "none" }], { duration: 120, easing: "ease-out" });
    if (keyboard) qBox.querySelector("button").focus();
    return true;
  }
  function quickMenus() {
    // A tap beside the open menu only closes it. A right-click beside it
    // opens the next one at once (a right-click has no click to swallow, so
    // swallowing it would eat the next right-click instead).
    document.addEventListener("pointerdown", (e) => {
      if (!qBox || qBox.contains(e.target)) return;
      closeQuick();
      if (e.button === 0) qHeld.forEach((h) => h.swallow());
    }, true);
    document.addEventListener("keydown", (e) => {
      if (!qBox) return;
      if (e.key === "Escape") { e.preventDefault(); closeQuick(true); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const items = [...qBox.querySelectorAll("button")];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
    });
    for (const t of ["hashchange", "resize", "blur"]) window.addEventListener(t, () => closeQuick());
    document.addEventListener("scroll", () => closeQuick(), true);
    // Plan › Destination: a destination's name gets Set the day for all,
    // Take out (when it's inside another) and Add a place.
    qHeld.push(onHold(".area-head[data-dest], .area-col-head[data-dest]", (head, x, y, keyboard) => {
      const trip = findTrip(view.trip), name = head.dataset.dest;
      if (!trip || !mayEdit(trip) || !trip.destinations.includes(name)) return false;
      const out = head.closest(".trip-out"), parent = out && out.parentElement.closest("[data-into]");
      const inside = !!(parent && parent.dataset.into);
      return openQuick(head, name, [
        ["calendar", i18n.t("Set the days for all"), () => openDestDay(head, trip, name)],
        inside ? ["arrowUp", i18n.t("Remove from {name}", { name: inside && parent.dataset.into }), () => setDestIn(trip, name, "")] : null,
        ["plus", i18n.t("Add a place"), () => openPlace(null, trip, { dest: name }, head)],
      ].filter(Boolean), x, y, keyboard);
    }));
    qHeld.push(onHold(".area[data-area=nodest] > .area-head", (head, x, y, keyboard) => {
      const trip = findTrip(view.trip);
      if (!trip || !mayEdit(trip)) return false;
      return openQuick(head, i18n.t("No destination"), [
        ["calendar", i18n.t("Set the days for all"), () => openDestDay(head, trip, null)],
        ["pin", i18n.t("Set the destination for all"), () => openSetDest(head, trip)],
      ], x, y, keyboard);
    }));
    qHeld.push(onHold(".trip-card[data-trip]", (card, x, y, keyboard) => {
      const trip = findTrip(card.dataset.trip);
      if (!trip) return false;
      const edit = mayEdit(trip);
      return openQuick(card, trip.name, [
        edit ? ["pencil", i18n.t("Edit"), () => openTrip(trip, card)] : null,
        ["copy", i18n.t("Duplicate"), () => openDup(trip, card)],
        edit ? ["trash", i18n.t("Delete"), async () => { if (await confirmDelete(i18n.t("Delete {name}?", { name: trip.name }), card)) deleteTrip(trip); }, true] : null,
      ].filter(Boolean), x, y, keyboard);
    }));
  }

  // Picking places on the Plan: a long press or right-click on a place
  // starts it; then a tap adds or drops a place, and the bar at the bottom
  // moves them all (to a day and time, a category or an importance, by
  // what the Plan is sorted by) or deletes them.
  let picked = null;
  function paintPicking() {
    if (picked && (view.mode !== "board" || !findTrip(view.trip))) picked = null;
    if (picked) for (const id of [...picked]) if (!doc.places.some((p) => p.id === id)) picked.delete(id);
    if (picked && !picked.size) picked = null;
    document.body.classList.toggle("picking", !!picked);
    $("selectBar").hidden = !picked;
    if (picked) $("selectCount").textContent = i18n.tn(picked.size, "1 selected", "{n} selected");
  }
  function pick(id) {
    if (!picked) picked = new Set();
    if (picked.has(id)) picked.delete(id); else picked.add(id);
    // Dropping the last one ends picking before the cards are drawn, so their ticks are for "been" again.
    if (!picked.size) picked = null;
    render();
  }
  const stopPicking = () => { picked = null; render(); };
  const pickedPlaces = () => doc.places.filter((p) => picked && picked.has(p.id));
  function placePicking() {
    // A long press (touch) picks the place at once; a right-click or the
    // menu key opens Select, Edit and Delete. While picking, either adds or
    // drops it.
    qHeld.push(onHold(".groups .card[data-id]", (card, x, y, keyboard, touch) => {
      const trip = findTrip(view.trip), p = doc.places.find((q) => q.id === card.dataset.id);
      if (!trip || !p) return false;
      const edit = mayEdit(trip);
      if (edit && (touch || picked)) { pick(p.id); return true; }
      const onMap = p.lat != null ? [["pin", i18n.t("Show on map"), () => showOnMap(trip, p)]] : [];
      if (!edit) return onMap.length ? openQuick(card, p.name, onMap, x, y, keyboard) : false;
      return openQuick(card, p.name, [
        ["check", i18n.t("Select"), () => pick(p.id)],
        ...onMap,
        ["pencil", i18n.t("Edit"), () => openPlace(p, trip, null, card.querySelector(".card-body"))],
        ["trash", i18n.t("Delete"), async () => {
          if (await confirmDelete(i18n.t("Delete {name}?", { name: p.name }), card))
            undoable(i18n.t("Deleted {name}.", { name: p.name }), () => { doc.places = doc.places.filter((x) => x !== p); });
        }, true],
      ], x, y, keyboard);
    }));
    $("selectDone").addEventListener("click", stopPicking);
    $("selectMove").addEventListener("click", (e) => openMove(e.currentTarget));
    $("selectDelete").addEventListener("click", async (e) => {
      const list = pickedPlaces();
      if (!list.length || !await confirmDelete(i18n.tn(list.length, "Delete 1 place?", "Delete {n} places?"), e.currentTarget)) return;
      const ids = new Set(list.map((p) => p.id));
      picked = null;
      undoable(i18n.tn(list.length, "Deleted 1 place.", "Deleted {n} places."), () => { doc.places = doc.places.filter((x) => !ids.has(x.id)); });
    });
    document.addEventListener("keydown", (e) => { if (picked && e.key === "Escape" && !document.querySelector("dialog[open]")) stopPicking(); });
  }
  // On a computer with the map beside the Plan it's shown there; otherwise
  // the Map tab opens on it.
  function showOnMap(trip, p) {
    view.flyTo = p.id;
    view.sel = p.id;
    if (view.mapDay && !M.onDay(p, view.mapDay)) view.mapDay = null;
    if (sideMap()) render();
    else go("#/trip/" + trip.id + "/map");
  }
  function moveMany(groupId, slot) {
    const list = pickedPlaces();
    closeSheet($("moveSheet"));
    picked = null;
    if (!list.length) return render();
    undoable(i18n.tn(list.length, "Moved 1 place.", "Moved {n} places."), () => list.forEach((p) => shift(p, groupId, slot)));
  }
  // Every place in a destination (Plan › Destination's grouping, its
  // stays and journeys left as they are) onto one day, or off any day. A
  // destination with no dates of its own gets that day, so it shows as a
  // day trip on it.
  function destPlaces(trip, name) {
    // No name: the No destination block.
    const find = (list) => { for (const g of list) { if (name ? g.dest === name : g.id === "nodest") return g; const s = find(g.side || []); if (s) return s; } return null; };
    const g = find(M.board(trip, placesOf(trip.id), "area"));
    return g ? g.places.filter((p) => !M.isJourney(p) && !M.isStay(p)) : [];
  }
  // Set the days for everything in a destination: one day moves it all to
  // that day; a range makes those the destination's dates and leaves what's
  // already on one of them there, the rest on its first day.
  function openDestDay(from, trip, name) {
    const list = destPlaces(trip, name);
    $("moveTitle").textContent = i18n.t("Set the days for {name}", { name: name || i18n.t("No destination") });
    const box = $("moveList");
    box.replaceChildren();
    document.querySelectorAll(".move-hint").forEach((n) => n.remove());
    if (!list.length) { box.append(el("p.dim", { text: i18n.t("Nothing here yet.") })); openSheet($("moveSheet"), from); return; }
    const hint = el("p.dim.move-hint", { text: i18n.t("Tap a day, then the last day for more than one. Tap it again for just that day.") });
    let first = null;
    const go = (a, b) => {
      closeSheet($("moveSheet"));
      if (a !== "nodate" && b < a) [a, b] = [b, a];
      const one = a === "nodate" || a === b;
      const moving = one ? list : list.filter((p) => !(M.isDay(p.day) && p.day >= a && p.day <= b));
      if (!name && !moving.length) return;
      undoable(moving.length ? i18n.tn(moving.length, "Moved 1 place.", "Moved {n} places.") : i18n.t("{name} has new dates.", { name }), () => {
        moving.forEach((p) => shift(p, a, ""));
        if (a === "nodate" || !name) return;
        const t = findTrip(trip.id), info = (t.destInfo || {})[name] || {};
        t.destInfo = { ...(t.destInfo || {}), [name]: { ...info, start: a, end: b } };
        t.updatedAt = new Date().toISOString();
      });
    };
    const pick = (day, row) => {
      if (!first) {
        first = day;
        row.classList.add("on");
        row.setAttribute("aria-pressed", "true");
        hint.textContent = i18n.t("Now the last day, or the same day again for just that one.");
        return;
      }
      go(first, day);
    };
    box.before(hint);
    for (const day of M.tripDays(trip, placesOf(trip.id))) {
      const row = el("button.move-to", { type: "button", "aria-pressed": "false" },
        el("span", { text: trip.start ? i18n.t("Day {n} · {date}", { n: M.dayIndex(trip, day), date: dayLabel(day) }) : dayLabel(day) }));
      row.addEventListener("click", () => pick(day, row));
      box.append(row);
    }
    box.append(el("button.move-to", { type: "button", onclick: () => go("nodate", "nodate") }, el("span", { text: i18n.t("No date") })));
    openSheet($("moveSheet"), from);
  }
  // Everything in No destination into one destination. Its dates grow to
  // take in their days, or they'd only fall back out by their dates.
  function openSetDest(from, trip) {
    const g = M.board(trip, placesOf(trip.id), "area").find((x) => x.id === "nodest");
    const list = g ? g.places.concat(g.stays || []).filter((p) => !M.isJourney(p)) : [];
    $("moveTitle").textContent = i18n.t("Set the destination for all");
    const box = $("moveList");
    box.replaceChildren();
    document.querySelectorAll(".move-hint").forEach((n) => n.remove());
    if (!list.length) box.append(el("p.dim", { text: i18n.t("Nothing here yet.") }));
    else for (const name of trip.destinations) box.append(el("button.move-to", { type: "button", onclick: () => {
      closeSheet($("moveSheet"));
      undoable(i18n.tn(list.length, "Moved 1 place to {to}.", "Moved {n} places to {to}.", { to: name }), () => {
        const t = findTrip(trip.id), stamp = new Date().toISOString();
        for (const p of list) { p.dest = name; p.updatedAt = stamp; }
        const days = list.flatMap((p) => [p.day, p.endDay]).filter(M.isDay).sort();
        const info = (t.destInfo || {})[name] || {};
        if (days.length && info.start) {
          const start = days[0] < info.start ? days[0] : info.start, end = days[days.length - 1] > info.end ? days[days.length - 1] : info.end;
          if (start !== info.start || end !== info.end) { t.destInfo = { ...t.destInfo, [name]: { ...info, start, end } }; t.updatedAt = stamp; }
        }
      });
    } }, icon("pin", "cat"), el("span", { text: name })));
    openSheet($("moveSheet"), from);
  }
  function setDestIn(trip, name, to) {
    undoable(to ? i18n.t("{name} is inside {to} now.", { name, to }) : i18n.t("{name} has a block of its own now.", { name }), () => {
      const t = findTrip(trip.id);
      t.destInfo = { ...(t.destInfo || {}), [name]: { ...((t.destInfo || {})[name] || {}), in: to } };
      t.updatedAt = new Date().toISOString();
    });
  }
  // Where the picked places can go: the trip's days (with a time of day).
  function openMove(from) {
    const trip = findTrip(view.trip), n = picked ? picked.size : 0;
    if (!trip || !n) return;
    $("moveTitle").textContent = i18n.tn(n, "Move 1 place", "Move {n} places");
    document.querySelectorAll(".move-hint").forEach((n) => n.remove());
    const row = (label, ico, go) => el("button.move-to", { type: "button", onclick: go }, ico ? icon(ico, "cat") : null, el("span", { text: label }));
    const box = $("moveList");
    box.replaceChildren();
    let slot = "";
    const slots = [["", i18n.t("Keep the time")]].concat(M.SLOTS.map(([id, t]) => [id, t]), [["any", i18n.t("Any time")]]);
    const seg = el("div.seg.move-slots", { role: "radiogroup", "aria-label": i18n.t("Time of day") }, slots.map(([id, t]) =>
      el("button", { type: "button", role: "radio", "aria-checked": String(id === slot), text: t, onclick: (e) => {
        slot = id;
        seg.querySelectorAll("[role=radio]").forEach((b) => { b.setAttribute("aria-checked", String(b === e.currentTarget)); b.tabIndex = b === e.currentTarget ? 0 : -1; });
      } })));
    box.append(seg);
    for (const day of M.tripDays(trip, placesOf(trip.id))) {
      box.append(row(trip.start ? i18n.t("Day {n} · {date}", { n: M.dayIndex(trip, day), date: dayLabel(day) }) : dayLabel(day), null, () => moveMany(day, slot)));
    }
    box.append(row(i18n.t("No date"), null, () => moveMany("nodate", "")));
    openSheet($("moveSheet"), from);
  }

  // What the + (or the side bar's Add) adds on the tab you're on.
  function addHere(from) {
    const trip = findTrip(view.trip), mode = view.mode;
    if (mode === "files") { $("addKindSheet").again = () => (view.mode === "files" ? addHere() : false); openSheet($("addKindSheet"), from); }
    else if (mode === "expenses") openExpense(null, trip, from);
    else openPlace(null, trip, mode === "today" ? { day: view.day || today() } : null, from);
  }
  function start(ctx) {
    ({ doc, store, motion, save: saveDoc } = ctx);
    pressBounce();
    quickMenus();
    placePicking();
    $("selectDone").append(icon("x"));
    $("selectDelete").prepend(icon("trash"));
    doc = M.sanitizeDoc(doc);
    lastSaved = JSON.stringify(doc);
    $("back").append(icon("back", "icon-back"));
    for (const b of document.querySelectorAll(".page-back")) b.append(icon("back", "icon-back"), icon("x", "icon-x"));
    for (const n of document.querySelectorAll("[data-icon]")) n.prepend(icon(n.dataset.icon));
    $("editTrip").append(icon("pencil"));
    $("shareTrip").append(icon("users"));
    $("viewTrip").append(icon("sliders"));
    $("viewSheet").again = () => { if ($("viewTrip").hidden) return false; $("viewTrip").click(); };
    $("viewTrip").addEventListener("click", (e) => {
      const v = SET.get().view;
      $("viewCat").value = v.cat; $("viewImp").value = v.imp; $("viewLabels").value = v.labels; $("viewRatings").value = v.ratings;
      // The cards' part where there are cards, the map's where there's a map (both beside each other on a computer).
      $("viewCards").hidden = view.mode === "map";
      $("viewMapPart").hidden = !mapOn();
      openSheet($("viewSheet"), e.currentTarget);
    });
    $("viewCat").addEventListener("change", (e) => { SET.setView({ cat: e.target.value }); render(); });
    $("viewImp").addEventListener("change", (e) => { SET.setView({ imp: e.target.value }); render(); });
    $("viewLabels").addEventListener("change", (e) => { SET.setView({ labels: e.target.value }); paintView(); });
    $("viewRatings").addEventListener("change", (e) => { SET.setView({ ratings: e.target.value }); paintView(); });
    $("ratingClear").addEventListener("click", () => { rating = 0; paintRating(); });
    $("shareTrip").addEventListener("click", () => { view.sharePerson = null; go("#/trip/" + view.trip + "/share"); });
    $("fab").append(icon("plus"));
    for (const [id, name] of [["addKindFile", "file"], ["addKindLink", "link"], ["addKindNote", "note"]]) $(id).querySelector(".xrow-ic").append(icon(name));
    $("linkOpen").prepend(icon("external"));
    $("settingsBtn").append(icon("gear"));
    $("updateClose").append(icon("x"));
    mapButtons();
    $("offlineBadge").prepend(icon("check"));
    $("newTrip").append(icon("plus"), el("span.btn-label", { text: i18n.t("New trip") }));
    $("newTrip").addEventListener("click", (e) => openTrip(null, e.currentTarget));
    $("settingsBtn").addEventListener("click", () => { view.settingsQ = ""; go("#/settings"); });
    $("back").addEventListener("click", () => { const sp = /^#\/settings\/(.+)$/.exec(location.hash);
      if (view.mode === "share" && view.trip) { goUp("#/trip/" + view.trip); return; }
      // Settings' list is beside its pages on a computer, so a top page steps back to Home.
      goUp(sp && (settingsParent(sp[1]) || !DESK.matches) ? "#/settings" + (settingsParent(sp[1]) ? "/" + settingsParent(sp[1]) : "") : "#/"); });
    $("editTrip").addEventListener("click", (e) => openTrip(findTrip(view.trip), e.currentTarget));
    // The + itself stays put; its icon swells and flashes green, like a tab's.
    $("fab").addEventListener("click", (e) => {
      const fab = e.currentTarget;
      swell(fab.firstChild);
      if (!lessMotion() && fab.animate) fab.animate([{ color: getComputedStyle(fab).getPropertyValue("--tab-on") }, { color: getComputedStyle(fab).color }],
        { duration: 600, easing: "ease-in" });
    });
    // What the + opens comes up at once, with the swell under it.
    $("fab").addEventListener("click", (e) => addHere(e.currentTarget));
    $("deskFold").append(icon("chevron"));
    $("deskFold").addEventListener("click", foldMap);
    if (window.ResizeObserver) new ResizeObserver(fitFold).observe($("app"));
    $("deskSplit").setAttribute("aria-label", i18n.t("Drag to share the width between the plan and the map"));
    wireSplit();
    DESK.addEventListener("change", () => render());
    LAND.addEventListener("change", () => render());
    window.addEventListener("hashchange", () => { if (!takeSetupLink()) render(); });
    radioKeys();
    wireSwipe();
    if (!takeSetupLink()) render();
    takeShares();
    setTimeout(refreshGoogle, 2000);
    sweepFiles();
    if (doc.trips.length) OFF.sweep(doc.trips.map((t) => t.id));
    const T = window.Tripboard;
    $("syncBadge").prepend(icon("refresh"));
    SHARE.onStatus = paintSyncBadge;
    if (T.sync) {
      T.sync.onStatus = () => { if (syncPaint) syncPaint(); paintSyncBadge(); };
      T.sync.start({ getDoc: () => doc, adopt, version: () => version, store, coverChanged, filesChanged: sweepFiles });
    }
    SHARE.onChange = () => { if (view.mode === "share") render(); };
    if (driveOn()) {
      // A browser that had to leave for Google's page comes back here.
      if (DRIVE.resume === "connect") setTimeout(connectDrive, 1500);
      else if (DRIVE.resume === "backup") setTimeout(() => backupToDrive(false), 3000);
      else if (DRIVE.resume === "list") { go("#/settings/drive"); setTimeout(() => loadDriveList(false), 1000); }
      setTimeout(maybeDriveBackup, 20000);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") setTimeout(maybeDriveBackup, 5000); });
    }
    SHARE.start({ getDoc: () => doc, adopt, version: () => version, store, coverChanged, filesChanged: sweepFiles, unshared });
    updatedToast();
  }

  // The first launch of a new version says so, with the way to what changed.
  function updatedToast() {
    const v = window.Tripboard.version, KEY = "tripboard.seenVersion";
    let seen = null;
    try { seen = localStorage.getItem(KEY); localStorage.setItem(KEY, v); } catch (e) { return; }
    if (seen && seen !== v) toast(i18n.t("Updated to {version}.", { version: v }), null, { label: i18n.t("What's new"), run: () => go("#/settings/changelog") });
  }

  // The bar's sync badge. Turning arrows show only for a sync that takes a
  // moment, and stay long enough to be seen, so a quick one doesn't flash.
  let badgeShow = null, badgeHide = null, badgeSince = 0;
  function paintSyncBadge() {
    const b = $("syncBadge"), st = SYNC && SYNC.connected() ? SYNC.status : { state: "off" };
    const busy = st.state === "syncing" || !!SHARE.busy;
    const set = (state, ico, text) => {
      b.dataset.state = state;
      b.firstChild.replaceWith(icon(ico));
      $("syncBadgeText").textContent = text;
      b.title = text;
      b.hidden = false;
    };
    if (busy) {
      clearTimeout(badgeHide); badgeHide = null;
      if (!b.hidden && b.dataset.state === "syncing") return;
      if (!badgeShow) badgeShow = setTimeout(() => { badgeShow = null; badgeSince = Date.now(); set("syncing", "refresh", i18n.t("Syncing…")); }, 300);
      return;
    }
    clearTimeout(badgeShow); badgeShow = null;
    if (st.state === "error") { const off = st.error && st.error.kind === "offline"; set(off ? "offline" : "error", "cloudOff", off ? i18n.t("Offline") : i18n.t("Not synced")); return; }
    // On a computer the side bar has the room to say it's synced all the
    // time; a phone's bar shows only syncing and trouble.
    if (deskTrip() && st.state !== "off") {
      if (badgeHide) return;
      const synced = () => set("synced", "cloudCheck", i18n.t("Synced"));
      if (!b.hidden && b.dataset.state === "syncing") badgeHide = setTimeout(() => { badgeHide = null; synced(); }, Math.max(0, 900 - (Date.now() - badgeSince)));
      else synced();
      return;
    }
    if (b.hidden || badgeHide) return;
    badgeHide = setTimeout(() => { badgeHide = null; b.hidden = true; }, Math.max(0, 900 - (Date.now() - badgeSince)));
  }

  // Sync's side: a doc it merged comes in as it is (already stamped by
  // whichever device made each change), and a cover it fetched is redrawn.
  function adopt(next) {
    next = M.sanitizeDoc(next);
    if (JSON.stringify(next) === JSON.stringify(doc)) return;
    const came = window.Tripboard.merge.arrivals(doc, next);
    doc = next;
    lastSaved = JSON.stringify(doc);
    saveDoc(doc);
    render();
    tellArrivals(came);
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
