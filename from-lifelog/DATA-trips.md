## Trips (`travel.json`)

The Travel tab's trips, in a file of their own beside `lifelog.json`,
written compact: `{ "trips": [ ... ], "places": [ ... ] }`. Kept apart
because a build older than 0.241.0, merging `lifelog.json`, would drop a
root key it doesn't know.

- A trip has `id`, `name`, `createdAt`, `updatedAt`, and optionally `start`
  and `end` (dates; an end before the start is swapped).
- A place has `id`, `trip` (its trip's id), `name`, `createdAt`,
  `updatedAt`, and optionally:
  - `day`: the date it's planned for. Without one it's somewhere to get to
    sometime during the trip.
  - `time` and `endTime` (`HH:MM`): a place with a `time` is scheduled. A
    time is only kept with a day, and an end only after the start.
  - `order`: sorts a day's unscheduled places; scheduled ones go by time,
    first.
  - `address`, `note`, `url` (a Google Maps link), `lat` and `lng`,
    `visited` (true when been there), `gid` (Google's place id, as Maps
    writes it: `0x…:0x…`) and `source` (the id of the Google Maps list it
    was imported from).
  - `town`: the town it's in, looked up from where it is (OpenStreetMap)
    for a place whose address doesn't name one. The app fills it in.
  - `placeId`: its id in Google's Places API, saved the first time its
    sheet looks it up with a Places key. The rating, hours and reviews that
    come with it are never stored (Google's terms), only fetched.
- A place whose trip is gone is dropped when the file is read; deleting a
  trip deletes its places.

`lifelog_trips` lists trips, or one trip's plan day by day.
`lifelog_add_trip`, `lifelog_update_trip`, `lifelog_delete_trip`,
`lifelog_add_place`, `lifelog_update_place` and `lifelog_delete_place`
change them. `lifelog_google_list` reads a shared Google Maps list (or one
place) and `lifelog_import_google_list` adds its places to a trip with no
day, skipping any already there (same `gid`, or the same name within 50 m).

