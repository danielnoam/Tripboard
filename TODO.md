# To do

What's planned, roughly in no order yet. When something ships it leaves
this list (and gets a line in `changes/`); when Daniel turns it down it
moves to DROPPED.md with his reason.

## Data

- **GitHub sync.** keel's GitHub sync transport, as in Waypage and LifeLog.
- **Google Drive backups.** keel's Drive backups. Needs Tripboard's own
  OAuth client IDs.
- **Storage control.** See what takes space (mostly cover images and,
  later, files), ask the browser for persistent storage, clear what's not
  needed.
- **Export to LifeLog / sync.** Send a trip's places (and later expenses)
  to LifeLog. The format is to be decided with LifeLog's side.

## Trips

- **A files section.** Tickets, bookings, PDFs kept with the trip,
  offline.
- **An expenses section.** What the trip costs, by place or day.

## With other people

- **Sharing a trip and editing it together.** Needs a server or a shared
  store the app doesn't have; every option so far keeps data on the
  device. To be designed before building.
- **Publishing a trip.** A read-only copy others can open (and later
  copy, which is where community trips start).

## Tools

- **MCP / CLI tools.** Let an AI chat or a script read and change trips
  and places, like LifeLog's `bridge/` (which Telemachus runs). It needs
  the data somewhere reachable off the device, so it follows GitHub sync.

## From the scope (docs/SCOPE.md)

- Community trips.
- Ratings pulled in for places (likely Google).
- Refresh Google locations older than 30 days (Google's caching terms).
