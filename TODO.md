# To do

What's planned, roughly in no order yet. When something ships it leaves
this list (and gets a line in `changes/`); when Daniel turns it down it
moves to DROPPED.md with his reason.

## Next up (mockups shown 2026-11-16, waiting on Daniel's OK)

Mockups are in the screenshot gallery (claude.ai/artifact/L6hDngGoaGY1uyTwRg13eW,
"mockups, not built yet").

- **Today view.** While a trip is under way, a sun icon first in the pill
  opens today's places in time order, with the gap between each one
  ("about 15 min walk · 1.1 km") and Navigate on the next place. The times
  are estimates from straight-line distance unless a routing service is
  added (Google's costs money).
- **Android app with Share into a trip.** In Google Maps, Share → Tripboard
  asks which trip, then opens Add a place already filled in. Needs Daniel's
  signing key as GitHub secrets (ANDROID_KEYSTORE_B64 / PASSWORD) and
  android.yml turned back on.

## Data

- **Turn on Google Drive backups.** Built (src/drive.js); waits for
  Tripboard's own Google OAuth client ID, which Daniel makes
  (docs/DRIVE.md), then it goes in `WEB_CLIENT`.
- **Export to LifeLog / sync.** Send a trip's places (and later expenses)
  to LifeLog. The format is to be decided with LifeLog's side.

## Trips

## With other people

- **Turn on the sharing server.** Built (server/); waits for Daniel's
  Cloudflare setup (server/README.md), then its address goes in
  src/share.js and the CSP.
- **End-to-end encrypted sharing**, if Tripboard ever goes public.
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
