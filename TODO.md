# To do

What's planned, roughly in no order yet. When something ships it leaves
this list (and gets a line in `changes/`); when Daniel turns it down it
moves to DROPPED.md with his reason.

## Data

- **Turn on Google Drive backups.** Built (src/drive.js); waits for
  Tripboard's own Google OAuth client ID, which Daniel makes
  (docs/DRIVE.md), then it goes in `WEB_CLIENT`.
- **The cloud connector reads only the trip a tool names**, so it
  isn't capped at about 40 trips on the free plan.
- **Export to LifeLog / sync.** Send a trip's places (and later expenses)
  to LifeLog. The format is to be decided with LifeLog's side.

## With other people

- **End-to-end encrypted sharing**, if Tripboard ever goes public. The
  real fix for "the server's owner can read shared trips", for every
  user; your own server (2026-11-21) only helps people who run one.
- **A Deploy to Cloudflare button** for your own sharing server, instead
  of forking. Needs server/ self-contained (mcp.js imports cli/), and the
  button only takes public repos. server/README.md "Running your own".
- **Your own sharing server in the phone and desktop apps.** Today only
  the web app (sw.js widens the CSP); the bundled apps need their own way.
- **A map on a published trip's page.** Today it shows the plan by day
  and each place's Open in links; the map comes with the copy.
- **Published links open the phone app.** On Android a published link
  opens the browser, even with the app installed (App Links).

## From the scope (docs/SCOPE.md)

- Community trips: published trips anyone can find by searching
  (Daniel, 2026-11-25: not until Tripboard has real public users; it
  needs reporting, taking trips down and spam limits first). Publishing
  and copying by link are built (2026-11-25).
- Ratings pulled in for places (likely Google).

## Ideas

- **"Add another device" for a shared trip** (Daniel, 2026-11-16: not
  now). A one-time link tied to a person, so a device without GitHub
  sync opens a shared trip as that same person. Today a person's other
  devices get the trip's key only through GitHub sync (shares.json).
