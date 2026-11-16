# The sharing server

A Cloudflare Worker (`worker.js`) that holds the trips people share,
with a D1 database (trips, keys, invite links) and a KV namespace (file
bytes and covers). How it works, and what it checks, is at the top of
`worker.js`. `node test/server.test.js` runs it against SQLite.

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
