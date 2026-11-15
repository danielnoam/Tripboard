# How Travel came to be

Notes kept while Travel was built in LifeLog (2026-10-05 to 2026-10-06), as written then. TODO.md, NOTES.md and the to-do list they mention were LifeLog's.

Daniel wants a LifeLog Travel tab: trips with an itinerary, a timeline view and an in-app map (map top half, itinerary sheet bottom on phones). What matters most to him is bringing in his **Google Maps saved lists**; he rejected a version without them. Books support was dropped the same day (DROPPED.md).

Facts established 2026-10-05:
- Google has no API for saved lists. A shared list link (maps.app.goo.gl/…) redirects to google.com/maps/@/data=!4m3!11m2!2s<LIST_ID>!3e3…
- `https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=en&gl=us&pb=!1m4!1s<LIST_ID>!2e1!3m1!1e1!2e2!3e2!4i500!16b1` returns `)]}'` + JSON. Root[0][4] = list name, [0][8] = places; each place p: p[2] name, p[3] note, p[1][4] address (often empty), p[1][5][2..3] lat/lng, p[1][6] the two ints of Google's 0x…:0x… id.
- Tested on his "Italy" list: 27/27 places with coords, 17 with address. The list spans several trips, so import = pick places.
- This cloud sandbox can't reach google.com (network policy); Daniel had to fetch it in his browser.

Design doc (Claude Doc "LifeLog travel tab design"): https://claude.ai/code/artifact/d85c64b9-f9d6-447b-89f4-f6402d9db929
Recommended: Leaflet first (Google map later), trip = Ledger project, `trips` + `places` collections in lifelog.json, dated days + "no day yet", build order Timeline → import → map → single places/share sheet. Bridge grows in the same commits ([[telemachus]]).

Later the same day Daniel added: days can be focused (timed) or open (just places for the day), with views by time, by area and map; places get optional time/endTime, no mode switch. He wants Google reviews: Places API with a key (reviews can't be stored, fetch on open), so Google's map is now recommended over Leaflet. Google sign-in can't read saved lists.

Decided 2026-10-05: Leaflet first; a fifth tab named "Travel"; no link to Ledger projects for now. Part 1 shipped as 0.241.0 (trips + places, By time view, bridge tools lifelog_trips / add|update|delete _trip|_place). Trips live in travel.json beside lifelog.json (older builds' merges drop unknown root keys). Next parts are in TODO.md: list import, map view, by area, drag to reorder.

0.242.0 (2026-10-05) shipped the rest of that list: Google list/place import (apps native, web via worker routes /gmaps-link and /gmaps-list, bridge lifelog_google_list + lifelog_import_google_list), By time / By area / Map as a seg on the trip page, Leaflet with CARTO tiles, Arrange (drag). Remaining ideas in TODO.md (naming "Near …" areas, map in the import sheet, Settings history). The import is untested against live Google from here (sandbox can't reach it); first real use is Daniel's.

0.243.0 (2026-10-06), at Daniel's ask: trips are the Travel tab's chip row (no trip list page), By time/By area/Map are VIEW_MODES.travel (swipeable), sorting is long-press only (no Arrange button).

0.245.0 (2026-10-06) finished the Travel TODO list: town names via OpenStreetMap Nominatim (place.town), import map, trips history + file backup, Google rating/hours/reviews via Places API (New) with Daniel's own key in settings.mediaKeys.googlePlaces (only placeId stored, per Google's terms). "Ledger project per trip" went to DROPPED.md at his word. Nominatim and Places are untested against the live services; TODO.md has a check-with-real-services item.

