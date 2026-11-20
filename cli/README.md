# Tripboard from a terminal or an AI chat

Both work on the trips in your **GitHub sync repo** (Settings → GitHub sync
in the app), so turn sync on first. Each change is one commit there, and
your devices pick it up on their next sync. They need Node 18 or newer and
nothing else.

Both read two settings from the environment:

- `TRIPBOARD_TOKEN`: a fine-grained GitHub token with only that repo and
  Contents read and write, like the app's. Make a separate one for this,
  so you can revoke it on its own.
- `TRIPBOARD_REPO`: `owner/name`, for example `you/tripboard-data`.
- `TRIPBOARD_BRANCH` is optional. It defaults to the repo's default branch.

## CLI

```sh
export TRIPBOARD_TOKEN=github_pat_…  TRIPBOARD_REPO=you/tripboard-data
node cli/tripboard.js trips
node cli/tripboard.js show kyoto
node cli/tripboard.js add-place kyoto --name "Fushimi Inari" --day 2026-12-01 --time 07:00 --importance must
node cli/tripboard.js add-expense kyoto --amount 48000 --currency JPY --title Ryokan --category stay
```

Run it with no command to see the full list. Add `--json` to any command
for machine-readable output.

## MCP server

`cli/mcp.js` is an MCP server over stdio. Its tools let a chat list trips,
read one in full, create and change trips, places and expenses, and
delete them. File bytes stay out of reach: a chat sees file names only.
For example, in Claude Desktop's `claude_desktop_config.json`:

```json
{ "mcpServers": { "tripboard": {
  "command": "node", "args": ["/path/to/Tripboard/cli/mcp.js"],
  "env": { "TRIPBOARD_TOKEN": "github_pat_…", "TRIPBOARD_REPO": "you/tripboard-data" } } } }
```

Tools are added and never renamed or removed, so a chat that uses them
keeps working.

For an AI app in the cloud (claude.ai, the phone apps, ChatGPT), the
sharing server serves these same tools, minus deleting, with a GitHub
sign-in: see "The cloud connector" in server/README.md.
