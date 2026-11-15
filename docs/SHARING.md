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

## What's missing, and the options

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

Recommendation: start with 2 when sharing is built. Keep 1 in mind as a
quick try for two people who both use GitHub.

## Still to decide

- How a person's id follows them across their own devices. One option is
  to keep it in their sync repo (`me.json`) and have every connected
  device adopt it.
- How invites work, and what a viewer sees.
- Publishing (a read-only public copy). It can reuse the bundle as is.
