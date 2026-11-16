#!/usr/bin/env node
// Tripboard as an MCP server (stdio), so an AI chat can read and plan your
// trips. It reads and writes the GitHub sync repo, as the CLI does; the
// apps pick changes up on their next sync. No dependencies.
//
// In a client's config (Claude Desktop, Claude Code, …):
//   { "command": "node", "args": ["/path/to/Tripboard/cli/mcp.js"],
//     "env": { "TRIPBOARD_TOKEN": "github_pat_…", "TRIPBOARD_REPO": "you/tripboard-data" } }
//
// Tools are added, never renamed or removed, so a chat's tools keep working.
const core = require("./core");
const M = core.M;

const VERSION = "0.1.0";
const day = { type: "string", description: "A date, YYYY-MM-DD." };
const tripArg = { type: "string", description: "The trip's id or name (or part of it)." };
const placeFields = {
  name: { type: "string" },
  category: { type: "string", description: "A category id: " + M.CATEGORIES.map((c) => c[0]).join(", ") + ", or one of your own from categories.json in the sync repo." },
  importance: { type: "string", enum: M.IMPORTANCE.map((c) => c[0]), description: "must (must see), want (want to), maybe." },
  day, endDay: { type: "string", description: "YYYY-MM-DD, the last day of a place that lasts several days (a stay); after day." }, time: { type: "string", description: "HH:MM, needs a day; the same on each of its days." }, endTime: { type: "string", description: "HH:MM, after time." },
  note: { type: "string" }, lat: { type: "number" }, lng: { type: "number" }, address: { type: "string" },
  visited: { type: "boolean" },
};
const expenseFields = {
  title: { type: "string" }, amount: { type: "number" },
  currency: { type: "string", description: "ISO 4217 code, like EUR or JPY." },
  category: { type: "string", enum: M.EXPENSE_CATEGORIES.map((c) => c[0]) },
  day, place: { type: "string", description: "A place's id or name in this trip." }, note: { type: "string" },
  paidBy: { type: "string" },
};
const tripFields = { name: { type: "string" }, start: day, end: day, destinations: { type: "array", items: { type: "string" } } };
const obj = (properties, required) => ({ type: "object", properties, required: required || [] });

const TOOLS = [
  { name: "list_trips", description: "Every trip: id, name, dates, destinations and how many places.", inputSchema: obj({}),
    run: async (tb) => { const d = await tb.read(); return d.trips.map((t) => ({ ...t, places: d.places.filter((p) => p.trip === t.id).length })); } },
  { name: "get_trip", description: "One trip in full: its places (by day), expenses with totals per currency, and files (names only).", inputSchema: obj({ trip: tripArg }, ["trip"]),
    run: async (tb, a) => { const d = await tb.read(); return core.tripView(d, core.findTrip(d, a.trip)); } },
  { name: "create_trip", description: "Make a trip.", inputSchema: obj(tripFields, ["name"]), op: "createTrip" },
  { name: "update_trip", description: "Change a trip's name, dates or destinations.", inputSchema: obj({ trip: tripArg, ...tripFields }, ["trip"]), op: "updateTrip" },
  { name: "delete_trip", description: "Delete a trip with its places, expenses and files. Ask the person first.", inputSchema: obj({ trip: tripArg }, ["trip"]), op: "deleteTrip" },
  { name: "add_place", description: "Add a place to a trip. Give a day (and time) to plan it, or leave it undated.", inputSchema: obj({ trip: tripArg, ...placeFields }, ["trip", "name"]), op: "addPlace" },
  { name: "update_place", description: "Change a place's fields; an empty string clears one.", inputSchema: obj({ trip: tripArg, place: { type: "string", description: "The place's id or name." }, ...placeFields }, ["trip", "place"]), op: "updatePlace" },
  { name: "delete_place", description: "Delete a place from a trip.", inputSchema: obj({ trip: tripArg, place: { type: "string" } }, ["trip", "place"]), op: "deletePlace" },
  { name: "add_expense", description: "Add an expense to a trip.", inputSchema: obj({ trip: tripArg, ...expenseFields }, ["trip", "amount", "currency"]), op: "addExpense" },
  { name: "update_expense", description: "Change an expense.", inputSchema: obj({ trip: tripArg, expense: { type: "string", description: "The expense's id or title." }, ...expenseFields }, ["trip", "expense"]), op: "updateExpense" },
  { name: "update_sharing", description: "Who on a shared trip may edit, and who doesn't see expenses or files. With no person it sets what everyone gets; with a person, their own setting (\"default\" goes back to everyone's). The app follows these; they aren't a lock, since the sync repo holds the whole trip. get_trip lists the people.",
    inputSchema: obj({ trip: tripArg, person: { type: "string", description: "A person's id or name on the trip. Leave out for everyone." },
      role: { type: "string", enum: ["editor", "viewer", "default"] },
      hide: { type: "array", items: { type: "string", enum: M.SECTIONS }, description: "The sections they don't see; [] shows all." },
      sameAsEveryone: { type: "boolean", description: "With a person: what they see goes back to everyone's." } }, ["trip"]),
    run: async (tb, a) => tb.change((doc) => core.ops.updateSharing(doc, { ...a, hide: a.sameAsEveryone ? "default" : a.hide }), "Tripboard MCP: update_sharing") },
  { name: "delete_expense", description: "Delete an expense.", inputSchema: obj({ trip: tripArg, expense: { type: "string" } }, ["trip", "expense"]), op: "deleteExpense" },
];

function server({ env = process.env, fetch, write = (s) => process.stdout.write(s) } = {}) {
  let tb = null;
  const conn = () => tb || (tb = core.open({ token: env.TRIPBOARD_TOKEN, repo: env.TRIPBOARD_REPO, branch: env.TRIPBOARD_BRANCH, fetch }));
  const send = (msg) => write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");

  async function call(name, args) {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) throw Object.assign(new Error("Unknown tool " + name), { code: -32602 });
    try {
      const out = tool.run ? await tool.run(conn(), args || {})
        : await conn().change((doc) => core.ops[tool.op](doc, args || {}), "Tripboard MCP: " + name);
      return { content: [{ type: "text", text: JSON.stringify(out, null, 1) }] };
    } catch (e) {
      return { content: [{ type: "text", text: e.message || String(e) }], isError: true };
    }
  }

  async function handle(msg) {
    const { id, method, params } = msg;
    const reply = (result) => id !== undefined && send({ id, result });
    try {
      if (method === "initialize") return reply({
        protocolVersion: (params && params.protocolVersion) || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "tripboard", version: VERSION },
        instructions: "Tripboard's trips, places and expenses, from the person's GitHub sync repo. Changes reach their devices on the next sync. Ask before deleting.",
      });
      if (method === "ping") return reply({});
      if (method === "tools/list") return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      if (method === "tools/call") return reply(await call(params.name, params.arguments));
      if (method && method.startsWith("notifications/")) return;
      if (id !== undefined) send({ id, error: { code: -32601, message: "Method not found: " + method } });
    } catch (e) {
      if (id !== undefined) send({ id, error: { code: e.code || -32603, message: e.message || String(e) } });
    }
  }
  return { handle, TOOLS };
}

if (require.main === module) {
  const s = server();
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (e) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n"); continue; }
      s.handle(msg);
    }
  });
}
module.exports = { server, TOOLS };
