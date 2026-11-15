#!/usr/bin/env node
// Tripboard from a terminal: read and change the trips in your GitHub sync
// repo. The apps pick the changes up on their next sync.
//
//   TRIPBOARD_TOKEN=github_pat_… TRIPBOARD_REPO=you/tripboard-data node cli/tripboard.js trips
//
// Run with no command for the list. Every command takes --json.
const core = require("./core");

const HELP = `Tripboard CLI. Needs TRIPBOARD_TOKEN and TRIPBOARD_REPO (owner/name); TRIPBOARD_BRANCH is optional.

  trips                                   every trip
  show <trip>                             a trip's places, expenses and files
  new-trip --name N [--start D --end D --destinations "A, B"]
  edit-trip <trip> [--name --start --end --destinations]
  delete-trip <trip>
  add-place <trip> --name N [--day D --time HH:MM --category C --importance must|want|maybe --note T --lat --lng]
  edit-place <trip> <place> [same fields; --field "" clears one]
  delete-place <trip> <place>
  add-expense <trip> --amount A --currency EUR [--title T --category C --day D --place P --note T]
  edit-expense <trip> <expense> [same fields]
  delete-expense <trip> <expense>

A trip, place or expense is its id or its name (or part of it). Dates are YYYY-MM-DD.
Categories: places ${core.M.CATEGORIES.map((c) => c[0]).join(", ")}; expenses ${core.M.EXPENSE_CATEGORIES.map((c) => c[0]).join(", ")}.`;

function parse(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (k === "json") { opt.json = true; continue; }
      opt[k.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i] ?? "";
    } else pos.push(a);
  }
  return { pos, opt };
}

const COMMANDS = {
  "new-trip": [[], "createTrip"], "edit-trip": [["trip"], "updateTrip"], "delete-trip": [["trip"], "deleteTrip"],
  "add-place": [["trip"], "addPlace"], "edit-place": [["trip", "place"], "updatePlace"], "delete-place": [["trip", "place"], "deletePlace"],
  "add-expense": [["trip"], "addExpense"], "edit-expense": [["trip", "expense"], "updateExpense"], "delete-expense": [["trip", "expense"], "deleteExpense"],
};

function money(n, cur) {
  try { return new Intl.NumberFormat("en", { style: "currency", currency: cur }).format(n); } catch (e) { return n + " " + cur; }
}
function printTrip(v) {
  const t = v.trip;
  const lines = [t.name + (t.start ? "  " + t.start + (t.end && t.end !== t.start ? " to " + t.end : "") : "") + "  (" + t.id + ")"];
  if (t.destinations.length) lines.push("  " + t.destinations.join(", "));
  lines.push("", "Places (" + v.places.length + ")");
  for (const p of v.places) lines.push("  " + [p.day || "no date", p.time || "", p.name, "[" + p.importance + ", " + p.category + "]", p.visited ? "visited" : ""].filter(Boolean).join("  ") + "  (" + p.id + ")");
  lines.push("", "Expenses (" + v.expenses.length + ")" + (v.totals.length ? ": " + v.totals.map((x) => money(x.total, x.currency)).join(" + ") : ""));
  for (const x of v.expenses) lines.push("  " + [x.day || "no date", money(x.amount, x.currency), x.title, "[" + x.category + "]"].join("  ") + "  (" + x.id + ")");
  lines.push("", "Files (" + v.files.length + ")");
  for (const f of v.files) lines.push("  " + f.name + "  " + Math.max(1, Math.round(f.size / 1000)) + " KB  (" + f.id + ")");
  return lines.join("\n");
}

async function main(argv, env = process.env, out = console.log) {
  const { pos, opt } = parse(argv);
  const cmd = pos.shift();
  if (!cmd || cmd === "help" || opt.help !== undefined) { out(HELP); return; }
  const tb = core.open({ token: env.TRIPBOARD_TOKEN, repo: env.TRIPBOARD_REPO, branch: env.TRIPBOARD_BRANCH });
  const show = (x, plain) => out(opt.json ? JSON.stringify(x, null, 2) : plain(x));
  if (cmd === "trips") {
    const doc = await tb.read();
    const list = core.M.sortTrips ? core.M.sortTrips(doc.trips, new Date().toISOString().slice(0, 10)) : doc.trips;
    return show(list, (l) => l.map((t) => t.name + (t.start ? "  " + t.start : "") + "  " + doc.places.filter((p) => p.trip === t.id).length + " places  (" + t.id + ")").join("\n") || "No trips yet.");
  }
  if (cmd === "show") {
    const doc = await tb.read();
    return show(core.tripView(doc, core.findTrip(doc, pos[0])), printTrip);
  }
  const c = COMMANDS[cmd];
  if (!c) throw new Error("No command " + JSON.stringify(cmd) + ". Run with no command for the list.");
  const args = { ...opt };
  c[0].forEach((k, i) => { args[k] = pos[i]; });
  if (args.visited !== undefined) args.visited = args.visited !== "false" && args.visited !== "";
  for (const k of ["lat", "lng"]) if (args[k] !== undefined && args[k] !== "") args[k] = +args[k];
  const r = await tb.change((doc) => core.ops[c[1]](doc, args), "Tripboard CLI: " + cmd);
  show(r, (x) => (x.deleted ? "Deleted " + x.deleted + "." : "Done: " + (x.name || x.title) + " (" + x.id + ")"));
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message || String(e)); process.exitCode = 1; });
}
module.exports = { main, parse };
