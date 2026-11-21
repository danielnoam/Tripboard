# Tripboard from a terminal or an AI chat

Everything you can do with your trips in the app, a terminal or an AI chat
can do too: read them, plan them, add, change and remove places,
expenses, files, covers, people and categories, import Google Maps lists,
and back up and restore. Both work on the trips in your **GitHub sync
repo** (Settings → GitHub sync in the app), so turn sync on first. Each
change is one commit there, and your devices pick it up on their next
sync. They need Node 18 or newer and nothing else.

Both read their settings from the environment:

- `TRIPBOARD_TOKEN`: a fine-grained GitHub token with only that repo and
  Contents read and write, like the app's. Make a separate one for this,
  so you can revoke it on its own.
- `TRIPBOARD_REPO`: `owner/name`, for example `you/tripboard-data`.
- `TRIPBOARD_BRANCH` is optional. It defaults to the repo's default branch.
- `TRIPBOARD_MCP_FILES=1` (MCP only) lets a chat read your files' contents
  (`get_file`, and `export_backup` with `withBytes`). Off by default:
  tickets and passports would go to the AI's provider. A chat can always
  add files and see their names.

## What it can do

The CLI and the MCP server are made from one list (`cli/tools.js`), so
they always match.

| Read | CLI | MCP tool |
|---|---|---|
| Every trip, in Home's order (under way, upcoming, undated, past) | `trips` | `list_trips` |
| One trip in full: places, days, expenses with totals, people, files | `show` | `get_trip` |
| A trip's places by day, category, importance, visited, text, or nearest to a point | `places` | `find_places` |
| The trip's board as the app groups it (time, category, importance, distance) | `board` | `get_board` |
| One day as the Today view shows it: the plan, times between places, what's next | `day` | `get_day` |
| Your place categories, in order | `categories` | `list_categories` |
| A file kept with a trip (MCP: only with `TRIPBOARD_MCP_FILES=1`) | `file` | `get_file` |
| A backup file, like the app's Save a backup | `export` | `export_backup` |
| Where a place is, by name, from OpenStreetMap (as Find by name) | `locate` | `find_location` |
| The weather for a trip's days, from Open-Meteo (as Today and the Plan show it) | `weather` | `get_weather` |

| Change | CLI | MCP tool |
|---|---|---|
| Make a trip | `new-trip` | `create_trip` |
| Change a trip's name, dates or destinations | `edit-trip` | `update_trip` |
| Delete a trip with its places, expenses, files and cover | `delete-trip` | `delete_trip` |
| Set or remove a trip's cover photo | `cover` | `set_trip_cover` |
| Add a place | `add-place` | `add_place` |
| Change a place (day, time, location, visited…) | `edit-place` | `update_place` |
| Delete a place | `delete-place` | `delete_place` |
| Import a Google Maps list into a trip, or into a new one | `import` | `import_places` |
| Add an expense | `add-expense` | `add_expense` |
| Change an expense | `edit-expense` | `update_expense` |
| Delete an expense | `delete-expense` | `delete_expense` |
| Keep a file with a trip (up to 25 MB) | `add-file` | `add_file` |
| Rename a file, change its note or place | `edit-file` | `update_file` |
| Delete a file | `delete-file` | `delete_file` |
| Who on a shared trip may edit, and who sees expenses and files | `share` | `update_sharing` |
| Take someone off a shared trip | `remove-person` | `remove_person` |
| Add a category | `add-category` | `add_category` |
| Rename or move a category | `edit-category` | `update_category` |
| Remove a category (its places go to Other) | `delete-category` | `delete_category` |
| Back to the built-in categories | `reset-categories` | `reset_categories` |
| Restore a backup file | `restore` | `import_backup` |

What stays on each device and out of reach: offline maps, map and search
providers and their keys, theme and language, your name, the sync and
Drive sign-ins, files marked "Only this device", and shared trips' keys.
`cli/coverage.js` lists every part of the app and what covers it.

If the sync repo has `me.json` (the app writes it on its first sync), the
CLI acts as you: new trips are yours, changes carry your id, and a trip
shared with you as a viewer can't be changed, as in the app.

## CLI

```sh
export TRIPBOARD_TOKEN=github_pat_…  TRIPBOARD_REPO=you/tripboard-data
node cli/tripboard.js trips
node cli/tripboard.js show kyoto
node cli/tripboard.js day kyoto 2026-12-01
node cli/tripboard.js locate "Fushimi Inari, Kyoto"
node cli/tripboard.js weather kyoto
node cli/tripboard.js add-place kyoto --name "Fushimi Inari" --day 2026-12-01 --time 07:00 --importance must --lat 34.9671 --lng 135.7727
node cli/tripboard.js add-expense kyoto --amount 48000 --currency JPY --title Ryokan --category stay
node cli/tripboard.js add-file kyoto --path ~/Downloads/ryokan.pdf --place ryokan
node cli/tripboard.js import --path "~/Downloads/Kyoto.csv"
```

Run it with no command to see every command and its options. Add `--json`
to any command for machine-readable output.

## MCP server

`cli/mcp.js` is an MCP server over stdio, with the tools above. Each says
whether it only reads (`readOnlyHint`) or deletes (`destructiveHint`).
For example, in Claude Desktop's `claude_desktop_config.json`:

```json
{ "mcpServers": { "tripboard": {
  "command": "node", "args": ["/path/to/Tripboard/cli/mcp.js"],
  "env": { "TRIPBOARD_TOKEN": "github_pat_…", "TRIPBOARD_REPO": "you/tripboard-data" } } } }
```

A chat gives a file's contents as base64 (`content`) or `text`, never a
path, so it can't make the server read other files on your computer.

Tools are added and never renamed or removed, so a chat that uses them
keeps working.

For an AI app in the cloud (claude.ai, the phone apps, ChatGPT), the
sharing server serves these same tools, minus deleting, with a GitHub
sign-in: see "The cloud connector" in server/README.md.
