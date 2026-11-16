# Sharing a trip and editing it together

Status: the data is ready (2026-11-15). Nothing is shared yet, because
there's no store that more than one person can reach.

## What's in place

- **You.** Each device makes a person id once (`settings.me.id`), and you
  can give a name (Settings → You).
- **Who changed what.** Every save stamps `by` (your id) on each record it
  changes, and on each tombstone it leaves. A merge takes `by` from the
  newer side, along with `updatedAt`.
- **Members.** A new trip gets `owner` (you) and
  `members: [{ id, name, role }]`. The roles are owner, editor and viewer.
  `model.can(trip, personId, "read" | "edit" | "manage")` says what each
  role may do. Nothing enforces it yet. Trips made before this have no
  members, and `can` treats them as their device's own.
- **Who paid.** Expenses have `paidBy`. The sheet offers it once a trip
  has more than one member.
- **A trip travels alone.** Sync already keeps each trip in its own
  bundle (`trips/<id>.json`) with its own tombstones, files and cover.
  That bundle is the unit to share.

- **Share settings** (2026-11-16). `trip.share = { role, hide }` is what
  everyone gets; a member's own `role` or `hide` overrides it.
  `model.access(trip, id)` works out what a person gets, and the app
  follows it for whoever uses it (read-only sheets, hidden tabs). It is
  not a lock: the bundle in the repo still holds everything.
- **One id per person.** The first device to sync writes `me.json`
  (`{ id }`) to the repo; the others take that id and move trips that
  named their old one over (`settings.me.was`, `model.renamePerson`).
- **Joining.** Opening a trip that has members adds you to them
  (`model.join`), so the sharing page lists everyone who synced it.

## The sharing server (2026-11-16)

Daniel chose option 2 below: a Cloudflare Worker on the free plan
(server/, set up as server/README.md says). Peer to peer was ruled out:
two phones rarely sync while both are online, it still needs a relay,
and nothing could keep a hidden section from a peer.

- The owner makes an invite link (14 days, one at a time, can be
  stopped). Joining from it gives that device its own key; no accounts.
- Each device syncs a shared trip with the server, beside GitHub sync,
  with its own agreed copy and version (src/share.js).
- The server checks every write: viewers can't write, only the owner
  changes the people or the share settings, and a hidden section is never
  sent and what's sent for it is ignored. Taking someone off the people
  ends their key; their device drops the trip at its next sync.
- An id that already has a key on a trip can't join it again, so a link
  can't be used to become someone. A person's other devices get the
  trip's key through their GitHub sync (shares.json in their own repo)
  and open it as them. Without GitHub sync a shared trip is on one device
  ("Add another device" is in TODO.md's ideas).
- Leaving, being taken off, or the owner stopping sharing never deletes
  anyone's copy: it becomes their own trip, which stops syncing with the
  others.
- Not end-to-end encrypted: the server (and whoever runs the Cloudflare
  account) can read shared trips. A later step if it ever goes public.

## The options that were weighed

The missing piece is a place that every member's device can read and
write, and that checks roles.

1. **A shared GitHub repo per shared trip.** The owner makes a repo,
   invites members as collaborators, and each member's app syncs that
   trip from it as well as from their own repo. It needs no server, and
   the sync code mostly exists. Every member needs a GitHub account and a
   token, and roles are all-or-nothing: a collaborator can write.
   This fits a trip with a technical friend, not with family.
2. **A small server** (for example a Cloudflare Worker with a database).
   It stores shared trips' bundles and files, enforces roles, and hands
   out invite links. The app syncs a shared trip with it exactly as with
   GitHub: the same bundles and the same three-way merge. It costs
   something to run and needs accounts (or invite links that act as
   them), and it holds other people's data, which brings privacy duties.
3. **Live editing (CRDTs, websockets).** This isn't needed. A
   few-seconds-later merge per record is fine for planning a trip.

## Still to decide

- Publishing (a read-only public copy). It can reuse the bundle as is.
