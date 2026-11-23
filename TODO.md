# To do

What's planned, roughly in no order yet. When something ships it leaves
this list (and gets a line in `changes/`); when Daniel turns it down it
moves to DROPPED.md with his reason.

## Next up (mockups OK'd 2026-11-16)

Mockups are in the screenshot gallery (claude.ai/artifact/L6hDngGoaGY1uyTwRg13eW,
"mockups, not built yet").

- **Share into a trip on Android.** In Google Maps, Share → Tripboard
  asks which trip, then opens Add a place already filled in. The signed
  APK itself ships from 0.3.0 (android.yml, still run by hand).

## Data

- **Turn on Google Drive backups.** Built (src/drive.js); waits for
  Tripboard's own Google OAuth client ID, which Daniel makes
  (docs/DRIVE.md), then it goes in `WEB_CLIENT`.
- **Turn on the cloud connector for AI apps.** Built (server/mcp.js);
  waits for the sharing server's Cloudflare setup, then Daniel's GitHub
  App (server/README.md, "The cloud connector"). Later: read only the
  trip a tool names, so it isn't capped at about 40 trips on the free plan.
- **Export to LifeLog / sync.** Send a trip's places (and later expenses)
  to LifeLog. The format is to be decided with LifeLog's side.

## Trips

- **More from the weather** (Daniel, 2026-11-16; the forecast itself
  shipped 2026-11-21). A rain warning on outdoor places, what to pack,
  and typical weather for a trip more than 16 days off.

Gaps found importing Daniel's Japan 2023 sheet (2026-11-23; to look at
later, not decided):


## With other people

- **Turn on the sharing server.** Built (server/); waits for Daniel's
  Cloudflare setup (server/README.md), then its address goes in
  src/share.js and the CSP.
- **End-to-end encrypted sharing**, if Tripboard ever goes public. The
  real fix for "the server's owner can read shared trips", for every
  user; your own server (2026-11-21) only helps people who run one.
- **A Deploy to Cloudflare button** for your own sharing server, instead
  of forking. Needs server/ self-contained (mcp.js imports cli/), and the
  button only takes public repos. server/README.md "Running your own".
- **Your own sharing server in the phone and desktop apps.** Today only
  the web app (sw.js widens the CSP); the bundled apps need their own way.
- **Publishing a trip.** A read-only copy others can open (and later
  copy, which is where community trips start).

## From the scope (docs/SCOPE.md)

- Community trips.
- Ratings pulled in for places (likely Google).

## Ideas

- **"Add another device" for a shared trip** (Daniel, 2026-11-16: not
  now). A one-time link tied to a person, so a device without GitHub
  sync opens a shared trip as that same person. Today a person's other
  devices get the trip's key only through GitHub sync (shares.json).
