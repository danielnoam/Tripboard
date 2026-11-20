# To do

What's planned, roughly in no order yet. When something ships it leaves
this list (and gets a line in `changes/`); when Daniel turns it down it
moves to DROPPED.md with his reason.

## Next up (mockups OK'd 2026-11-16)

Mockups are in the screenshot gallery (claude.ai/artifact/L6hDngGoaGY1uyTwRg13eW,
"mockups, not built yet").

- **Android app with Share into a trip.** In Google Maps, Share → Tripboard
  asks which trip, then opens Add a place already filled in. Needs Daniel's
  signing key as GitHub secrets (ANDROID_KEYSTORE_B64 / PASSWORD) and
  android.yml turned back on.

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

- **Weather for each trip day** (Daniel, 2026-11-16). A forecast on
  Today and on each day heading, and later other uses: a rain warning on
  outdoor places, sunrise and sunset, what to pack. Open-Meteo is the
  likely service: no key and it allows browser requests. Forecasts reach
  only about 16 days ahead, so a trip further off shows climate averages
  or nothing until it gets close. Privacy: the trip's place coordinates
  go to the weather service. Its host goes in the CSP `connect-src`, and
  offline trips would keep the last forecast.

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
