# The sharing server

A Cloudflare Worker (`worker.js`) that holds the trips people share,
with a D1 database (trips, keys, invite links) and a KV namespace (file
bytes and covers). How it works, and what it checks, is at the top of
`worker.js`. `node test/server.test.js` runs it against SQLite.

It also reads a shared Google Maps list's places from its link
(`googlelist.js`, `POST /google-list`), for the trip sheet's import. That
uses Google Maps' undocumented list data, so it may stop working when
Google changes it; the file import in the app doesn't depend on it.

Cloudflare's free plan covers it: no card is needed for Workers, D1 or
KV. Its limits that matter here: 100,000 requests a day, 5 GB of
database, 1 GB of KV and 1,000 KV writes a day (one per file or cover
uploaded), files up to 25 MB.

## Setting it up (once)

1. Make a Cloudflare account (dash.cloudflare.com), with two-step login on.
2. **Storage & Databases → D1 → Create**, named `tripboard`. Copy its
   database ID.
3. **Storage & Databases → KV → Create**, named `tripboard-files`. Copy its
   namespace ID.
4. **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"**
   template; add the permissions **D1: Edit** and **Workers KV Storage:
   Edit**; limit it to your account. Copy the token (it's shown once).
5. Your **Account ID** is on the Workers & Pages overview page.
6. In GitHub, the Tripboard repo → **Settings → Secrets and variables →
   Actions**:
   - Secrets: `CLOUDFLARE_API_TOKEN` (step 4), `CLOUDFLARE_ACCOUNT_ID` (step 5).
   - Variables: `TRIPBOARD_D1_ID` (step 2), `TRIPBOARD_KV_ID` (step 3).
7. **Actions → Sharing server → Run workflow.** It creates the tables and
   deploys. The server's address is in the Deploy step's log, like
   `https://tripboard.<your subdomain>.workers.dev`.
8. That address goes in `src/share.js` (`SERVER`) and in index.html's
   `connect-src`, in their own PR. Until then the app shows sharing as not
   set up.

The token and IDs never go in the repo or in a chat.

## Changing it

The tables change only through a new file in `migrations/`, never by
editing an old one. A merge that changes `server/` deploys it.

## The cloud connector for AI apps (optional)

`mcp.js` makes the same Worker a remote MCP server, so Claude (Settings →
Connectors), ChatGPT (developer mode) or another AI app can read and plan
your trips from the cloud, phones included. It uses the same tools as the
local MCP server (`cli/mcp.js`), minus the ones that delete, on your
GitHub sync repo; your devices pick changes up on their next sync. You
sign in with GitHub through your own GitHub App, which reaches only the
sync repo. Only the GitHub accounts in `TRIPBOARD_MCP_USERS` get in.

It needs the server set up first (above). Then, once:

1. GitHub → **Settings → Developer settings → GitHub Apps → New GitHub
   App**:
   - Name: anything unique, like `Tripboard <your login>`. Homepage:
     `https://danielnoam.github.io/Tripboard/`.
   - Callback URL: the server's address + `/callback`, like
     `https://tripboard.<your subdomain>.workers.dev/callback`. Leave
     "Expire user authorization tokens" ticked.
   - Webhook: untick **Active**.
   - Repository permissions: **Contents: Read and write**. Nothing else.
   - Where it can be installed: **Only on this account**. Create it.
2. On the app's page, copy the **Client ID**, then **Generate a new client
   secret** and copy it (it's shown once).
3. **Install App** → your account → **Only select repositories** → your
   sync repo.
4. Your GitHub user id is the `id` at `https://api.github.com/users/<your login>`.
5. In the Tripboard repo → **Settings → Secrets and variables → Actions**:
   - Variables: `TRIPBOARD_GITHUB_APP_ID` (the Client ID, step 2) and
     `TRIPBOARD_MCP_USERS`: `<your user id>=<owner>/<sync repo>`, like
     `12345=you/tripboard-data` (`@branch` after it if sync uses another
     branch; more people comma-separated).
   - Secrets: `TRIPBOARD_GITHUB_APP_SECRET` (step 2) and
     `TRIPBOARD_MCP_SECRET`, a long random string you make on your
     computer, like the output of `openssl rand -base64 32`.
6. **Actions → Sharing server → Run workflow.** It puts the four into
   Cloudflare's secret store.
7. Add the connector with the server's address + `/mcp`:
   - Claude: **Settings → Connectors → Add custom connector** (on the web
     or desktop; it then works on the phone apps too).
   - ChatGPT (on the web): turn on **Developer mode**, then add a custom
     MCP server with that address and OAuth. Each change asks you to
     confirm; reads don't.
   Tripboard asks whether to let the app in, then GitHub asks you to sign in.

To cut every AI app off at once: in GitHub, **Settings → Applications →
Authorized GitHub Apps → Revoke** (or uninstall the app), or change
`TRIPBOARD_MCP_SECRET` and run the workflow again, which ends every
sign-in. Taking your id out of `TRIPBOARD_MCP_USERS` works too.

The secrets never go in the repo or in a chat.
