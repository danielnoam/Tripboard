#!/usr/bin/env node
// Tripboard as an MCP server (stdio), so an AI chat can read and plan your
// trips. It reads and writes the GitHub sync repo, as the CLI does; the
// apps pick changes up on their next sync. Its tools are cli/tools.js, the
// same list the CLI is made from. No dependencies.
//
// In a client's config (Claude Desktop, Claude Code, …):
//   { "command": "node", "args": ["/path/to/Tripboard/cli/mcp.js"],
//     "env": { "TRIPBOARD_TOKEN": "github_pat_…", "TRIPBOARD_REPO": "you/tripboard-data" } }
//
// Tools are added, never renamed or removed, so a chat's tools keep working.
const core = require("./core");
const { TOOLS, run } = require("./tools");

const VERSION = "0.2.0";

// A tool's input schema: its arguments the MCP side takes.
function schema(t) {
  const args = t.args.filter(([, , o = {}]) => o.mcp !== false);
  return { type: "object", properties: Object.fromEntries(args.map(([k, s]) => [k, s])), required: args.filter(([, , o = {}]) => o.req).map(([k]) => k) };
}

// What tools/list gives: each tool's name, description, input schema, and
// annotations (readOnlyHint for reads, destructiveHint for anything that
// deletes, removes or replaces), which clients use to skip or ask before a call.
const LIST = TOOLS.map((t) => ({ name: t.tool, description: t.description, inputSchema: schema(t),
  annotations: { readOnlyHint: t.kind === "read", destructiveHint: /^(delete|remove|reset|import_backup)/.test(t.tool), openWorldHint: t.tool === "find_location" || t.tool === "import_places" } }));

function server({ env = process.env, fetch, write = (s) => process.stdout.write(s), googleList } = {}) {
  let tb = null;
  const conn = () => tb || (tb = core.open({ token: env.TRIPBOARD_TOKEN, repo: env.TRIPBOARD_REPO, branch: env.TRIPBOARD_BRANCH, fetch }));
  const send = (msg) => write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");

  async function call(name, args) {
    const tool = TOOLS.find((t) => t.tool === name);
    if (!tool) throw Object.assign(new Error("Unknown tool " + name), { code: -32602 });
    try {
      const out = await run(conn(), tool, args || {}, "mcp", { ...env, fetch, googleList });
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
        instructions: "Tripboard's trips, places, expenses, files, people and categories, from the person's GitHub sync repo. Changes reach their devices on the next sync. Ask before deleting anything or restoring a backup.",
      });
      if (method === "ping") return reply({});
      if (method === "tools/list") return reply({ tools: LIST });
      if (method === "tools/call") return reply(await call(params.name, params.arguments));
      if (method && method.startsWith("notifications/")) return;
      if (id !== undefined) send({ id, error: { code: -32601, message: "Method not found: " + method } });
    } catch (e) {
      if (id !== undefined) send({ id, error: { code: e.code || -32603, message: e.message || String(e) } });
    }
  }
  return { handle, TOOLS: LIST };
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
module.exports = { server, schema, TOOLS: LIST };
