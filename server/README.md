# The sharing server

A Cloudflare Worker (`worker.js`) that holds the trips people share,
with a D1 database (trips, keys, invite links) and a KV namespace (file
bytes and covers). How it works, and what it checks, is at the top of
`worker.js`. `node test/server.test.js` runs it against SQLite.

Tripboard's own server is Daniel's (`SERVER` in `src/share.js`), and
every copy of the app uses it unless someone picks another in Settings ›
Sharing server. "Running your own" below is the way for anyone else.

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
8. For Tripboard's own server, that address goes in `src/share.js`
   (`SERVER`) and in index.html's `connect-src`, in their own PR. For a
   server of your own, see below.

The token and IDs never go in the repo or in a chat.

## Running your own

Anyone can run a server of their own, so their shared trips sit in their
own Cloudflare account instead of Daniel's, under their own free-plan
limits. The app stays the same one, at Tripboard's usual address.

1. On GitHub, **Fork** danielnoam/Tripboard (your copy holds the server
   code and the workflow that deploys it). In the fork's **Actions** tab,
   turn workflows on.
2. Do steps 1 to 7 above in your fork (its Settings, its Actions). The
   Deploy step's log shows your server's address.
3. In Tripboard: **Settings › Sharing server › Your own**, paste the
   address, **Use this server**. Tripboard opens again once, then says
   whether it reached a Tripboard server.

Trips you share from then on live on your server, and their invite links
name it: people who open one are asked before joining through it, and
their app talks to your server for that trip only. Trips you shared
before stay on the server they started on. Whoever runs a server can read
the trips shared through it, so a trip is as private as the server it's
on.

Your own server works in the web app (it uses the service worker; see
ARCHITECTURE.md's Trade-offs), not yet in the phone or desktop apps.

To update your server later, **Sync fork** on GitHub, then run the
Sharing server workflow again. The cloud connector for AI apps (below)
works on your server the same way, with your own GitHub App and your
own id in `TRIPBOARD_MCP_USERS`.

A Deploy to Cloudflare button would skip the fork, but it needs the
server to be self-contained in `server/`, and `mcp.js` uses `cli/`. Not
done yet (TODO.md).

## Changing it

The tables change only through a new file in `migrations/`, never by
editing an old one. A merge that changes `server/`, `cli/` or a `src/` file the
connector loads deploys it (`.github/workflows/server.yml` lists them).

## The cloud connector for AI apps (optional)

`mcp.js` makes the same Worker a remote MCP server, so Claude (Settings →
Connectors), ChatGPT (developer mode) or another AI app can read and plan
your trips from the cloud, phones included. It uses the same tools as the
local MCP server (`cli/mcp.js`) on your GitHub sync repo (those that
delete work only while the app's Settings › AI tools › Let AI tools
delete is on); your devices pick changes up on their next sync. You
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
