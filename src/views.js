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
    return n;
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
  const timeLabel = (p) => (p.time ? p.time + (p.endTime ? "–" + p.endTime : "") : "");

  let doc, store, motion, saveDoc;
  const covers = new Map();
  const view = { trip: null, sort: "time", only: [], from: null, mode: "board", pick: null, sel: null };
  try { Object.assign(view, JSON.parse(localStorage.getItem("tripboard.view") || "{}"), { trip: null, from: null }); } catch (e) { /* first visit */ }
  const remember = () => { try { localStorage.setItem("tripboard.view", JSON.stringify({ sort: view.sort, only: view.only })); } catch (e) { /* private window */ } };

  const findTrip = (id) => doc.trips.find((t) => t.id === id);
  const placesOf = (id) => doc.places.filter((p) => p.trip === id);
  // Every change goes through here: cleaned, stamped against the last save
  // (updatedAt, and what was deleted), kept, drawn, and sent to sync.
  let lastSaved = "{}", version = 0;
  function save() {
    version++;
    doc = M.stamp(JSON.parse(lastSaved), M.sanitizeDoc(doc), undefined, SET.get().me.id);
    lastSaved = JSON.stringify(doc);
    saveDoc(doc);
    render();
    if (window.Tripboard.sync) window.Tripboard.sync.soon();
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

  // ---------- Home ----------
  function renderHome(main) {
    $("title").textContent = "Tripboard";
    const trips = M.sortTrips(doc.trips, today());
    main.append(el("button.btn.primary.new-trip", { type: "button", onclick: (e) => openTrip(null, e.currentTarget) }, icon("plus"), i18n.t("New trip")));
    if (!trips.length) {
      main.append(el("div.empty", {}, el("p", { text: i18n.t("No trips yet.") }), el("p.dim", { text: i18n.t("Make one, then add the places you want to see.") })));
    } else {
      main.append(el("h2.section", { text: i18n.t("My trips") }));
      main.append(el("ul.trips", {}, trips.map((t) => {
        const n = placesOf(t.id).length;
        const when = whenLabel(t);
        return el("li", {}, el("a.trip-card", { href: "#/trip/" + t.id },
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
    const groups = M.board(trip, places, view.sort, { only: view.only, from: view.from });
    // Groups with nothing in them yet, to drop into while dragging.
    const all = view.sort === "category" ? M.CATEGORIES : view.sort === "importance" ? M.IMPORTANCE : [];
    for (const [id, title] of all) {
      if (!groups.some((g) => g.id === id)) groups.push({ id, title, places: [], dropOnly: true });
    }
    const at = (id) => all.findIndex(([x]) => x === id);
    if (all.length) groups.sort((a, b) => at(a.id) - at(b.id));
    const wrap = el("div.groups");
    if (canDrag()) wireDrag(wrap);
    for (const g of groups) wrap.append(group(trip, g));
    main.append(wrap);
  }

  // Plan, Expenses and Files: a trip's lists (the map is the button at the top).
  // A trip's floating pill at the bottom: Plan, Map, Expenses, Files, as icons.
  function paintTripBar(trip) {
    const bar = $("tripBar");
    bar.hidden = !trip;
    document.body.classList.toggle("with-tabbar", !!trip);
    if (!trip) return;
    const tabs = [["board", "list", i18n.t("Plan"), ""], ["map", "map", i18n.t("Map"), "/map"],
      ["expenses", "wallet", i18n.t("Expenses"), "/expenses"], ["files", "file", i18n.t("Files"), "/files"]];
    bar.replaceChildren(...tabs.map(([mode, ico, label, path]) =>
      el("a.tab", { href: "#/trip/" + trip.id + path, "aria-label": label, title: label, "aria-current": view.mode === mode ? "page" : "false",
        onclick: () => { view.pick = null; } }, icon(ico))));
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
    openSheet($("fileSheet"), from);
  }
  $("fileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    if (!form.name.value.trim()) { form.name.setAttribute("aria-invalid", "true"); form.name.focus(); return; }
    form.name.removeAttribute("aria-invalid");
    Object.assign(editingFile, { name: form.name.value, place: form.place.value, note: form.note.value });
    if (fileLocal) editingFile.local = true; else delete editingFile.local;
    await closeSheet($("fileSheet"));
    save();
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
    const on = !!editingPlace;
    $("placeFilesRow").hidden = !on;
    if (on) $("placeFiles").replaceChildren(...fileButtons(filesOn(editingPlace.id)));
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
    await closeSheet($("expenseSheet"));
    save();
  });

  function group(trip, g) {
    const isDay = !!g.day;
    const title = isDay ? (trip.start ? i18n.t("Day {n} · {date}", { n: M.dayIndex(trip, g.day), date: dayLabel(g.day) }) : dayLabel(g.day)) : g.title;
    const head = el("div.group-head", {},
      el("h2", { text: title }),
      el("span.count", { text: String(g.places.length) }),
      view.sort === "time" ? el("button.icon-btn.small", { type: "button", "aria-label": i18n.t("Add a place to {title}", { title: title }),
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
  const canDrag = () => window.matchMedia("(pointer: fine)").matches && view.sort !== "distance";
  const SLOT_TIME = { morning: "09:00", afternoon: "14:00", evening: "19:00" };
  const mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
  const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  function movePlace(p, groupId, slot) {
    const before = JSON.stringify([p.day, p.time, p.endTime, p.category, p.importance]);
    undoable(i18n.t("Moved {name}.", { name: p.name }), () => shift(p, groupId, slot));
    if (JSON.stringify([p.day, p.time, p.endTime, p.category, p.importance]) === before) $("toast").hidden = true;
  }
  function shift(p, groupId, slot) {
    if (view.sort === "category") p.category = groupId;
    else if (view.sort === "importance") p.importance = groupId;
    else if (view.sort === "time") {
      if (groupId === "nodate") { delete p.day; delete p.time; delete p.endTime; }
      else {
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

  function cards(trip, list, g) {
    return el("ul.cards", {}, list.map((p) => {
      const meta = view.sort === "category" ? [] : [M.CATEGORY.get(p.category)];
      if (view.sort !== "time" && p.day) meta.push(dayLabel(p.day));
      if (p.time) meta.push(timeLabel(p));
      const nFiles = filesOn(p.id).length;
      if (g.km && g.km.has(p.id)) meta.push(g.km.get(p.id) < 1 ? Math.round(g.km.get(p.id) * 1000) + " m" : g.km.get(p.id).toFixed(1) + " km");
      return el("li.card.imp-" + p.importance + (p.visited ? ".visited" : ""), { "data-id": p.id, draggable: canDrag() ? "true" : null },
        el("button.tick", { type: "button", "aria-pressed": String(!!p.visited), "aria-label": p.visited ? i18n.t("Been to {name}", { name: p.name }) : i18n.t("Mark as been to {name}", { name: p.name }),
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
    $("tripSave").textContent = trip ? i18n.t("Save") : i18n.t("Create trip");
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
    if (trip) armDelete($("tripDelete"), i18n.t("Delete trip"), () => deleteTrip(trip));
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
    await closeSheet($("tripSheet"));
    save();
    if (!editingTrip) location.hash = "#/trip/" + trip.id;
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
        if (r.category && !categoryTouched && !editingPlace) f.category.value = r.category;
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
  $("categorySelect").replaceChildren(...M.CATEGORIES.map(([id, label]) => el("option", { value: id, text: label })));
  function openPlace(place, trip, preset, from) {
    editingPlace = place;
    placeTrip = trip;
    const f = $("placeForm");
    f.reset();
    const p = place || { category: "sight", importance: "want", ...(preset || {}) };
    $("placeSheetTitle").textContent = place ? i18n.t("Edit place") : i18n.t("Add a place");
    $("placeSave").textContent = place ? i18n.t("Save") : i18n.t("Add place");
    f.name.value = p.name || "";
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
    paintPlaceFiles();
    if (place) armDelete($("placeDelete"), i18n.t("Delete"), () => {
      closeSheet($("placeSheet"));
      undoable(i18n.t("Deleted {name}.", { name: place.name }), () => { doc.places = doc.places.filter((x) => x !== place); });
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
  const SET = window.Tripboard.settings;
  const PL = window.Tripboard.places;
  let mapFailed = null;
  // The map's places: the importance filter, and the day picked on the map.
  function shownPlaces(trip) {
    let all = placesOf(trip.id);
    if (view.mapDay) all = all.filter((p) => p.day === view.mapDay);
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
      const meta = [M.IMPORTANCE_LABEL.get(sel.importance), M.CATEGORY.get(sel.category)];
      if (sel.day) meta.push(dayLabel(sel.day));
      if (sel.time) meta.push(timeLabel(sel));
      panel.replaceChildren(el("div.sel", {},
        el("strong", { text: sel.name }), el("span.dim", { text: meta.join(" · ") }),
        sel.address ? el("span.dim.addr", { text: sel.address }) : null),
        filesOn(sel.id).length ? el("ul.attached", {}, fileButtons(filesOn(sel.id))) : null,
        el("div.loc-actions", {},
          el("button.btn", { type: "button", text: i18n.t("Edit"), onclick: (e) => openPlace(sel, trip, null, e.currentTarget) }),
          el("button.btn.quiet", { type: "button", text: i18n.t("Move pin"), onclick: () => { view.pick = sel.id; view.sel = null; render(); } })),
        openIn(sel));
      return;
    }
    const nowhere = shownPlaces(trip).filter((p) => p.lat == null);
    if (!nowhere.length) { panel.replaceChildren(); return; }
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
  async function saveBackup(tripIds) {
    const data = M.backupOf(doc, tripIds);
    for (const t of data.trips) {
      const blob = t.cover ? await store.cover(t.id) : null;
      if (blob) data.covers[t.id] = await toDataUrl(blob);
    }
    for (const f of data.files) {
      const blob = await store.file(f.id);
      if (blob) data.blobs[f.id] = await toDataUrl(blob.type ? blob : new Blob([blob], { type: f.type }));
    }
    const name = (data.trips.length === 1 ? fileName(data.trips[0].name) : "tripboard") + "-" + today() + ".json";
    const a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" })), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(i18n.t("Saved {name}.", { name: name }));
  }
  async function restoreBackup(file) {
    let data, r;
    try { data = JSON.parse(await file.text()); r = M.mergeBackup(doc, data); }
    catch (e) { toast(e instanceof SyntaxError ? i18n.t("That file isn't a Tripboard backup.") : e.message); return; }
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
      { ico: "refresh", title: i18n.t("GitHub sync"), where: i18n.t("Settings"), href: "#/settings/sync", words: "sync devices github repo token connect disconnect backup cloud phone computer" },
      { ico: "user", title: i18n.t("You"), where: i18n.t("Settings"), href: "#/settings/you", words: "name me profile person shared trips paid by who" },
      { ico: "database", title: i18n.t("Storage"), where: i18n.t("Settings"), href: "#/settings/storage", words: "space used trips places photos covers persistent keep safe delete browser" },
      { ico: "database", title: i18n.t("Backup"), where: i18n.t("Storage"), href: "#/settings/storage", words: "backup restore file export import save json" },
      { ico: "palette", title: i18n.t("Appearance"), where: i18n.t("Settings"), href: "#/settings/appearance", words: "theme dark light system mode colours" },
      { ico: "globe", title: i18n.t("Language"), where: i18n.t("Appearance"), href: "#/settings/appearance", words: "language english hebrew rtl right to left שפה עברית אנגלית" },
      { ico: "plug", title: i18n.t("Services"), where: i18n.t("Settings"), href: "#/settings/services", words: "connections providers map search keys google maptiler openstreetmap openfreemap" },
      { ico: "map", title: i18n.t("Map"), where: i18n.t("Services"), href: "#/settings/map", words: "map tiles use fallback if it fails provider" },
      { ico: "search", title: i18n.t("Find by name"), where: i18n.t("Services"), href: "#/settings/search", words: "search find places geocoding use fallback if it fails provider" },
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
    if (page === "sync") return renderSync(main);
    if (page === "you") return renderYou(main);
    if (page === "storage") return renderStorage(main);
    if (page === "appearance") return renderAppearance(main);
    if (page === "about") return renderAbout(main);
    const pm = /^p\/(\w+)$/.exec(page || "");
    if (pm && SET.PROVIDERS[pm[1]]) return renderProvider(main, pm[1]);
    $("title").textContent = i18n.t("Settings");
    const cfg = SET.get();
    const input = el("input", { type: "search", placeholder: i18n.t("Search settings"), "aria-label": i18n.t("Search settings"), autocomplete: "off", spellcheck: false, value: view.settingsQ || "" });
    const results = el("div.settings-results");
    const needs = SERVICES.map(([svc]) => serviceStatus(svc, cfg)).find((st) => st.tone === "warn");
    const home = el("div.sgroup", {}, el("div.sgroup-card", {},
      srow("#/settings/sync", "refresh", i18n.t("GitHub sync"), syncSummary()),
      srow("#/settings/you", "user", i18n.t("You"), { text: cfg.me.name || i18n.t("Your name, for shared trips") }),
      srow("#/settings/storage", "database", i18n.t("Storage"), { text: i18n.t("Space used, backup and restore") }),
      srow("#/settings/appearance", "palette", i18n.t("Appearance"), { text: THEMES.find(([t]) => t === cfg.appearance.theme)[1] }),
      srow("#/settings/services", "plug", i18n.t("Services"), needs || { text: i18n.t("Map and Find by name: {join}", { join: SERVICES.map(([svc]) => SET.PROVIDERS[cfg[svc].main].name).join(", ") }) }),
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

  function renderAbout(main) {
    $("title").textContent = i18n.t("About");
    const link = (text, href) => el("a", { href, target: "_blank", rel: "noopener noreferrer", text });
    main.append(el("section.panel", {}, el("h2", { text: i18n.t("Tripboard {version}", { version: window.Tripboard.version }) }),
      el("p.dim", { text: i18n.t("Your trips stay on this device, and in your own private GitHub repo if you turn on sync. Keys and tokens you add are kept in this browser and sent only to their own service.") })),
    sgroup(i18n.t("Credits"), [el("ul.credits", {},
      el("li", {}, i18n.t("Icons: "), link("Lucide", "https://lucide.dev"), " (ISC)"),
      el("li", {}, i18n.t("Map: "), link("MapLibre GL JS", "https://maplibre.org"), " (BSD-3), ", link("OpenFreeMap", "https://openfreemap.org"), ", © ", link("OpenMapTiles", "https://www.openmaptiles.org")),
      el("li", {}, i18n.t("Map data and Find by name: © "), link("OpenStreetMap", "https://www.openstreetmap.org/copyright"), i18n.t(" contributors, "), link("Nominatim", "https://nominatim.org")),
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
    el("p.dim.hint", { text: i18n.t("Each device has its own id for you until sharing can link them.") }));
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
  function renderSync(main) {
    $("title").textContent = i18n.t("GitHub sync");
    const c = SET.get().sync;
    const status = el("p.hint", { role: "status" });
    if (!SYNC.connected()) {
      const owner = el("input", { value: c.owner, autocomplete: "off", spellcheck: false, autocapitalize: "off", placeholder: "your-user-name" });
      const repo = el("input", { value: c.repo, autocomplete: "off", spellcheck: false, autocapitalize: "off" });
      const token = el("input", { type: "password", autocomplete: "off", spellcheck: false, placeholder: "github_pat_…" });
      const go = el("button.btn", { type: "button", text: i18n.t("Connect") });
      go.onclick = async () => {
        const v = { owner: owner.value.trim(), repo: repo.value.trim(), token: token.value.trim() };
        if (!v.owner || !v.repo || !v.token) { status.textContent = i18n.t("All three are needed."); return; }
        go.disabled = true;
        status.textContent = i18n.t("Checking with GitHub…");
        try {
          const info = await SYNC.check(v);
          if (!info.private) { status.textContent = i18n.t("That repo is public, so anyone could read your trips. Make it private on GitHub (Settings, Danger zone), then connect."); return; }
          SET.setSync({ ...v, branch: info.branch });
          SYNC.start({ getDoc: () => doc, adopt, version: () => version, store, coverChanged, filesChanged: sweepFiles });
          SYNC.now();
          render();
        } catch (e) { status.textContent = SYNC.explain(e); }
        finally { go.disabled = false; }
      };
      main.append(el("p.dim.hint.page-hint", { text: i18n.t("Sync keeps your trips in a private GitHub repo of yours, so your phone and computer see the same trips. Tripboard has no server: your trips go only to GitHub.") }),
        el("section.panel", {}, el("h2", { text: i18n.t("Set it up") }),
          el("ol.steps", {}, SYNC_STEPS.map(([t, href]) => el("li", {}, t, href ? [" ", el("a", { href, target: "_blank", rel: "noopener noreferrer", text: i18n.t("Open") })] : null)))),
        el("section.panel", {},
          el("label.field", {}, i18n.t("GitHub user name"), owner),
          el("label.field", {}, i18n.t("Repo"), repo),
          el("label.field", {}, i18n.t("Token"), token),
          el("div.loc-actions", {}, go), status),
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
    el("p.dim.hint", { text: i18n.t("Each trip is a file in the repo (trips/), with its cover photo (covers/). Changes made on two devices at once are merged; when both changed the same thing, the later change wins.") }));
    syncPaint();
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
    const sm = /^#\/settings(?:\/(.+))?$/.exec(location.hash);
    const settings = !!sm;
    $("settingsBtn").hidden = !!/^#\/trip\//.test(location.hash) || settings;
    const m = /^#\/trip\/([\w-]+)(?:\/(map|expenses|files))?/.exec(location.hash);
    const trip = m ? findTrip(m[1]) : null;
    if (m && !trip) { location.replace("#/"); return; }
    if ((trip && trip.id) !== view.trip) { view.from = null; view.pick = null; view.sel = null; view.mapDay = null; view.trip = trip ? trip.id : null; }
    view.mode = trip && m[2] ? m[2] : "board";
    const onMap = view.mode === "map";
    $("mapView").hidden = !onMap;
    paintTripBar(trip);
    $("app").hidden = onMap;
    document.body.classList.toggle("on-map", onMap);
    if (onMap) {
      document.body.classList.add("on-board"); document.body.classList.remove("on-home");
      $("title").textContent = trip.name;
      $("back").hidden = false;
      $("editTrip").hidden = false;
      $("fab").hidden = !!view.pick;
      showMap(trip);
      return;
    }
    const main = $("app");
    const y = main.dataset.trip === view.trip + view.mode ? window.scrollY : 0;
    main.dataset.trip = view.trip + view.mode;
    main.replaceChildren();
    document.body.classList.toggle("on-board", !!trip);
    document.body.classList.toggle("on-home", !trip && !settings);
    $("back").hidden = !trip;
    $("editTrip").hidden = !trip;
    $("fab").hidden = !trip;
    if (settings) { $("back").hidden = false; renderSettings(main, sm[1] || ""); }
    else if (trip && view.mode === "expenses") renderExpenses(main, trip);
    else if (trip && view.mode === "files") renderFiles(main, trip);
    else if (trip) renderBoard(main, trip); else renderHome(main);
    $("fab").setAttribute("aria-label", view.mode === "expenses" ? i18n.t("Add an expense") : view.mode === "files" ? i18n.t("Add files") : i18n.t("Add a place"));
    if (view.mode !== "files") { main.ondragover = main.ondragleave = main.ondrop = null; main.classList.remove("file-over"); }
    window.scrollTo(0, y);
  }

  function start(ctx) {
    ({ doc, store, motion, save: saveDoc } = ctx);
    doc = M.sanitizeDoc(doc);
    lastSaved = JSON.stringify(doc);
    $("back").append(icon("back", "icon-back"));
    $("editTrip").append(icon("pencil"));
    $("fab").append(icon("plus"));
    $("settingsBtn").append(icon("sliders"));
    $("settingsBtn").addEventListener("click", () => { view.settingsQ = ""; location.hash = "#/settings"; });
    $("back").addEventListener("click", () => { const sp = /^#\/settings\/(.+)$/.exec(location.hash);
      location.hash = sp ? "#/settings" + (settingsParent(sp[1]) ? "/" + settingsParent(sp[1]) : "") : "#/"; });
    $("editTrip").addEventListener("click", (e) => openTrip(findTrip(view.trip), e.currentTarget));
    $("fab").addEventListener("click", (e) => view.mode === "files" ? $("fileAdd").click()
      : view.mode === "expenses" ? openExpense(null, findTrip(view.trip), e.currentTarget)
      : openPlace(null, findTrip(view.trip), null, e.currentTarget));
    window.addEventListener("hashchange", render);
    render();
    setTimeout(refreshGoogle, 2000);
    sweepFiles();
    const T = window.Tripboard;
    if (T.sync) {
      T.sync.onStatus = () => { if (syncPaint) syncPaint(); };
      T.sync.start({ getDoc: () => doc, adopt, version: () => version, store, coverChanged, filesChanged: sweepFiles });
    }
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
  function coverChanged(id) {
    if (covers.get(id)) URL.revokeObjectURL(covers.get(id));
    covers.delete(id);
    render();
  }

  window.Tripboard.views = { start, el, render: () => render(), adopt, coverChanged, version: () => version, get doc() { return doc; } };
})();
