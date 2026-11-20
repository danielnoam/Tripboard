#!/usr/bin/env node
// Tripboard from a terminal: read and change the trips in your GitHub sync
// repo. The apps pick the changes up on their next sync. Its commands are
// cli/tools.js, the same list the MCP server is made from.
//
//   TRIPBOARD_TOKEN=github_pat_… TRIPBOARD_REPO=you/tripboard-data node cli/tripboard.js trips
//
// Run with no command for the list. Every command takes --json.
const core = require("./core");
const { TOOLS, run, done } = require("./tools");

const flag = (k) => "--" + k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
function usage(t) {
  const args = t.args.filter(([, , o = {}]) => o.cli !== false);
  const pos = args.filter(([, , o = {}]) => o.pos != null).sort((a, b) => a[2].pos - b[2].pos).map(([k, , o]) => (o.req ? "<" + k + ">" : "[<" + k + ">]"));
  const opts = args.filter(([, , o = {}]) => o.pos == null).map(([k, s, o = {}]) => (o.req ? flag(k) + " " + k.toUpperCase() : "[" + flag(k) + (s.type === "boolean" ? " true|false" : "") + "]"));
  return [t.cmd, ...pos, ...opts].join(" ");
}
const HELP = `Tripboard CLI. Needs TRIPBOARD_TOKEN and TRIPBOARD_REPO (owner/name); TRIPBOARD_BRANCH is optional.

${TOOLS.map((t) => "  " + usage(t) + "\n      " + t.description.split(". ")[0].replace(/\.$/, "") + ".").join("\n")}

A trip, place, expense, file, person or category is its id or its name (or part of it).
Dates are YYYY-MM-DD; lists are comma-separated; an empty value ("") clears a field.
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

async function main(argv, env = process.env, out = console.log) {
  const { pos, opt } = parse(argv);
  const cmd = pos.shift();
  if (!cmd || cmd === "help" || opt.help !== undefined) { out(HELP); return; }
  const t = TOOLS.find((x) => x.cmd === cmd);
  if (!t) throw new Error("No command " + JSON.stringify(cmd) + ". Run with no command for the list.");
  const tb = core.open({ token: env.TRIPBOARD_TOKEN, repo: env.TRIPBOARD_REPO, branch: env.TRIPBOARD_BRANCH });
  const args = { ...opt };
  delete args.json;
  for (const [k, , o = {}] of t.args) if (o.pos != null && pos[o.pos] !== undefined) args[k] = pos[o.pos];
  const r = await run(tb, t, args, "cli", env);
  if (typeof r === "string") return out(r);
  out(opt.json || !(t.print || t.kind === "write") ? JSON.stringify(r, null, 2) : (t.print || done)(r));
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message || String(e)); process.exitCode = 1; });
}
module.exports = { main, parse, HELP };
