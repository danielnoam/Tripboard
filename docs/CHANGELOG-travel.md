# Travel in LifeLog's CHANGELOG

Every changelog line that mentions Travel, trips, places or Google Maps, by release (LifeLog CHANGELOG.md at eca2dac). Some are about other features that merely say "trip" (Ledger projects); they're kept for completeness.


## [0.315.0] - 2026-11-14

- IGDB time-to-beat for games How Long to Beat doesn't know: with IGDB keys set, a Steam game with no How Long to Beat times, or a game picked from IGDB that isn't on Steam, gets IGDB's Main Story, Main + Extras and Completionist times in the same strip over the cover. Tapping it opens the game on IGDB.
- View's up and down arrows for Home swap a section with its neighbour, each taking the other's place in the floors.

## [0.313.0] - 2026-11-13

- Hardcover as a books source (or fallback): each match shows its series and place in it ("Mistborn #2"), a pick brings the author, pages, rating and blurb, finishing a book offers the next one in its series, and Discover's Popular shows what's trending on Hardcover. Set it up in Settings → Media lookups with your Hardcover API token; a browser needs the proxy, the apps don't.

## [0.309.0] - 2026-11-09

- Excalidraw drawings come in as boards: pick an Obsidian `.excalidraw.md` (or a `.excalidraw` file) with Markdown import, or import the whole vault folder. Rectangles, ellipses, diamonds, lines, arrows, freehand and text keep their place, size, angle, colour and stroke; solid fills keep their colour (softer on dark themes). Images, frames and embeds are left out, and the review says how many
- The Ledger's Summary has "<Month> so far": each category's spending this month, where it's heading by month end, and its usual month (the three before), flagged when it's heading 25% or more over. Bills count at their price and trips are left out, so rent on the 1st doesn't look like a spending spree.

## [0.307.0] - 2026-11-06

- Reading a note shows its written and edited dates in the bar at the bottom, the same place as the editor, instead of under the text.

## [0.304.0] - 2026-11-04

- LifeLog for Windows and Linux: LifeLog-setup.exe on each release, and LifeLog.AppImage (or .deb) when a Linux build is asked for. It opens offline, looks up Steam, SteamGridDB, GG.deals and Google Maps without the proxy, and saves exports with the system's Save dialog.
- A Google Maps list into a trip gets the whole window: the map beside the list on a computer, the screen on a phone.

## [0.301.0] - 2026-11-03

- Every date the app shows follows the chosen format: Timeline, Backlog, Ledger, Habits, Notes, Boards, Travel, Recap, Search, History and the widgets.

## [0.300.0] - 2026-11-03

- Left to do at the top of Habits, in place of the "3 of 6 today" line: what's still open today, this week, this month and this year, how much each needs, and a button that does the next bit.

## [0.259.2] - 2026-10-09

- Place links, Google Maps links and store links open only as web

## [0.248.0] - 2026-10-08

- **Travel is off by default.** Settings → Tabs turns it on. A device that

## [0.245.1] - 2026-10-06

- "Been there" in the place sheet, the ↩ ✓ on an In progress row, the ☆ on

## [0.245.0] - 2026-10-06

- **Travel: areas named after their town.** Places from a Google list
- **Google's rating, opening hours and reviews on a place**, with a Google
- **Trips have history.** Settings → History → Trips lists past saves of
- **Trips get the file backup too**: Settings → Sync can keep a copy of

## [0.244.0] - 2026-10-06

- **Activity: everything that takes a while, in one place.** Steam and

## [0.243.2] - 2026-10-06

- **Importing from Google Maps no longer spins forever.** In the phone

## [0.243.0] - 2026-10-06

- **Travel's trips are its chips.** Like the years and categories in the
- **By time, By area and Map are Travel's modes**, a swipe apart like the
- **Sorting a trip's places is a long press.** Hold a place and the rows

## [0.242.0] - 2026-10-05

- **Import from Google Maps.** In a trip, ⇣ (or + → From Google Maps)
- **By time, By area and Map.** A trip can now be seen three ways. By area
- **Arrange.** ⇅ Arrange, or a long press on a place, lets you drag places
- The AI bridge can read a shared Google Maps list or place, and import

## [0.241.0] - 2026-10-05

- **Travel, a fifth tab.** Plan a trip: give it a name and, if you like,
- The AI bridge can read a trip's plan day by day and add, move, schedule

## [0.209.0] - 2026-09-28

- **Sheets fade in and rise into place**, and fade out when they close,

## [0.199.0] - 2026-09-26

- **Note widget (Android).** Pick one note when you place it and it stays on
- **Choose lists for the To-do widget (Android).** When you place it, or

## [0.154.0] - 2026-09-16

- **Paired fields travel together.** The media link (source + id) already did;

## [0.149.0] - 2026-09-13

- **Settling up is recorded per expense, not per project.** A trip through

## [0.148.0] - 2026-09-13

- **Projects no longer have a start and end date.** They earned their place on

## [0.139.0] - 2026-09-11

- **The bulk action bar updates in place.** The count ticks as you select

## [0.137.0] - 2026-09-11

- **Discover refreshes in place instead of flashing.** Hitting ↻, or

## [0.136.0] - 2026-09-10

- **Lists move instead of jumping.** Tick a to-do and its row travels down
- **The filter chips keep their place while you type.** The year and category

## [0.135.0] - 2026-09-10

- **The Ledger updates in place instead of redrawing.** Editing an expense

## [0.134.0] - 2026-09-10

- **The Backlog updates in place instead of redrawing** — Entries and Next

## [0.133.0] - 2026-09-10

- **The Timeline updates in place instead of redrawing.** Editing an entry,

## [0.132.0] - 2026-09-10

- **Notes updates in place instead of redrawing.** Editing a note now leaves

## [0.130.0] - 2026-09-10

- **The To-do list updates in place instead of redrawing.** Tick something

## [0.102.0] - 2026-08-28

- **The random picker shows what it's drawing from.** A strip at the top of

## [0.99.0] - 2026-08-14

- The "🎲 Pick something for me" button moved into the new toggle strip,

## [0.96.0] - 2026-08-11

- **⇄ Convert to entries** on a recurring expense — the reverse trip: every

## [0.86.0] - 2026-07-16

- Added CSV round-trip test coverage for Journal import/export (export

## [0.81.2] - 2026-07-14

- A media-search title stripped of its trailing "Season N"/"Book N" marker

## [0.48.0] - 2026-07-05

- Media sync now strips a trailing "S1"/"Season 1"/"B1"/"Book 1" style
