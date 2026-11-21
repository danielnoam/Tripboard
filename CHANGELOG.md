# Changelog

Every release of Tripboard, newest first, in words a person using it would
use. Written only by `node tools/release.js x.y.z`, from the notes in
`changes/`.

## [0.3.3] - 2026-11-21

### Added
- AI tools can put a day's places in order without inventing times (order_day, or an order on a place). Today, the board and the map's route follow it; times still come first.
- AI tools can make many changes in one go (batch_update): one commit instead of one call per place, and nothing changes if any step fails.
- Settings › AI tools: a switch for whether AI chats and the command line may delete. It's off at first, only the app can turn it on, and it follows you to every synced device.
- Settings › Display: a 12- or 24-hour clock and, in English, the date order (Nov 21 or 21 Nov). Both follow the device until you pick.

### Changed
- The cloud connector for AI apps now has the delete tools too, and they work only while that switch is on. On the command line and the local MCP, deleting now needs the switch as well.
- Settings has six rows instead of ten: Display (theme, language, °C or °F, clock, dates), Categories, Services (map, search, weather, AI tools), Sharing (your name and the sharing server), Data (GitHub sync, backups, storage) and About.
- Delete in a place's sheet deletes on the first tap. Undo in the message that follows brings the place back.
- Importance has new colours: Must see is blue, Want to is green, Maybe is orange. Warnings keep their red.

### Fixed
- An AI tool's day view (get_day) called a day of a finished trip "now". Its status is now the trip's against today, and it says whether the day itself is past, today or upcoming.
- An AI tool that changes a trip, place, expense or file now answers with the record as saved, including its new change time, instead of the time from before the change.

## [0.3.2] - 2026-11-21

### Added
- Settings › Sharing server: share trips through a server you run yourself (your own free Cloudflare account) instead of Tripboard's. Invite links name the server, and joining a trip on someone else's server asks first. Web app only for now.

### Changed
- A release now builds and publishes the Android app by itself, so the update bar sees it without a hand-run build.

### Fixed
- Going Back no longer shows the screen underneath through the one sliding away.
- Tapping a trip on Home, the +, or Save no longer waits for an animation first: the next screen or sheet comes up on the tap, with the motion running alongside.
- Switching tabs again before a slide finishes carries on from where it was instead of jumping.
- A screen sliding in or out no longer shows a strip of the one under it (such as a trip's cover) between it and the top bar.
- The Android app's update offer is now a small bar at the bottom with an Update button: it downloads the new version inside the app, shows its progress, and opens Android's installer. The first time, Android asks to let Tripboard install apps. The bar can be closed until the next version.

## [0.3.1] - 2026-11-21

### Added
- An AI chat or a terminal can import a Google Maps list by its shared link too (`import --link`, or `import_places` with a link), into a trip or as a new trip named after the list, including through the cloud connector.

## [0.3.0] - 2026-11-21

### Added
- AI apps in the cloud (Claude's connectors, ChatGPT's developer mode) can connect to your trips with a GitHub sign-in, once the server is set up (server/README.md). They can read, add and change, but not delete.
- Add another device: once GitHub sync is on, Settings › GitHub sync shows a code to scan and a setup link to copy. Opening it on the other device asks before connecting, then the trips come over. A device that isn't connected yet can also paste the link.
- Tripboard for Android: Tripboard.apk on the GitHub release page installs Tripboard as a phone app. It has the whole app inside, so it opens with no connection from the first launch, and later versions install over it and keep your trips.
- An AI chat or a terminal can now do everything the app can with your trips: besides trips, places and expenses, it can add, read, rename and delete files, set or remove cover photos, manage your categories, take someone off a shared trip, import a Google Maps list, back up and restore, look up where a place is, and ask for a trip's board, a day's plan (as Today shows it) or places matching filters.
- A chat sees your files' contents only if you turn it on (TRIPBOARD_MCP_FILES=1).
- Screens slide: opening a trip, Sharing, Settings and each page inside Settings come in from the right (the left in Hebrew) and settle with a small bounce, and Back sends them out the same way. The screen underneath drifts a little and dims.
- On a phone, Edit trip and the place editor slide in from the side the same way.
- The buttons at the top and the trips on Home bounce when pressed; with a mouse they also grow a little when you point at them. A trip opens just after its bounce.
- The Settings button is now at the top of a trip too, in the same corner as on Home. Back from Settings returns to the trip you came from.
- Sharing a trip is on: invite people with a link, and they see and edit it with you. Importing a Google Maps list by its link works too.
- Swipe sideways to move between a trip's tabs (Today, Plan, Map, Expenses, Files): on the bottom bar anywhere, and on the page on every tab but Map, where a swipe still pans the map. In Hebrew the direction is mirrored.
- Moving between a trip's tabs now slides: the new tab comes in from its side of the bar and settles with a small bounce, and the old one leaves the other way (mirrored in Hebrew). The circle in the bar slides to the new tab with a little stretch and bounce, and the icon swells, settles back and turns white. The circle never goes past the ends of the bar. With Reduced motion on in the device's settings the screens cross-fade quickly instead.
- New trip can start from a Google Maps list: pick the list's file and the trip takes the list's name, and Create adds every place in it. Places without a location are then found on the map by name, so add the city under Destinations.
- Weather for each trip day: the forecast on Today (high and low, chance of rain, sunrise and sunset) and beside each day on the Plan, from Open-Meteo, up to 16 days ahead. It's off until you say yes (it sends your places' rough locations), can be turned off or switched to °F in Settings › Weather, and the last forecast stays for when there's no signal.
- `weather` in the CLI and `get_weather` in the MCP server give the same forecast.

### Changed
- The CLI acts as you when your sync repo knows who you are: new trips are yours, changes carry your id, and a trip shared with you to view can't be changed.
- The + sits beside the bottom bar, at its end (the left in Hebrew), as a rounded square of its own, instead of on top of the bar.
- Adding a place from the + opens a sheet that comes up from below over the trip, instead of a full screen. Editing a place is still a full screen.
- Tapping the + makes its icon swell and flash green, like a tab's icon; the square itself stays still.
- Animations are on again across the app, so sheets, windows and the map move too. With Reduced motion on in the device's settings, screens fade quickly instead and nothing bounces.
- On a phone, a trip's "Ready offline" badge in the top bar shows only its tick, so the trip's name still fits next to the buttons. On a wider screen it keeps its words.
- The selected tab's circle is solid green with a white icon.
- While a trip is under way, Today is the middle tab: Plan, Map, Today, Expenses, Files.
- The update check (phone and Windows apps, once they are on) follows keel's channels: releases by default, or the newest build of main on the unreleased channel. The web copy serves those builds under `unreleased/`, never the Releases page.

### Fixed
- Opening a trip's map straight from a link no longer leaves Home's new-trip + in the header.
- The +'s swell now shows when it opens Add a place or Add an expense; before, the sheet covered it straight away.

## [0.2.0] - 2026-11-16

### Added
- Google Drive backups (Settings → Google Drive): a dated copy of every trip, with its cover photos and files, in a Tripboard folder in your Drive. Back up now, back up by itself every day to every month, restore a backup (Undo takes it back) or delete one; the newest three are kept. It shows once Tripboard's Google sign-in is set up (docs/DRIVE.md).
- Expenses in a trip: a Plan / Expenses switch under the trip's cover. Add what you spend with +: amount and currency, what it was, a category, and optionally a day, a place and a note. See the total per currency, per category and per day. Expenses go into backups and GitHub sync.
- GitHub sync (Settings → GitHub sync): your trips, places and cover photos go to a private GitHub repo of yours, so every device you connect sees the same trips. It syncs a few seconds after each change, when Tripboard opens and every few minutes. Changes made on two devices are merged, and a deletion on one device reaches the others.
- Tripboard in Hebrew: pick the language in Settings › Appearance › Language (System follows the device). Hebrew lays the app out right to left, and dates and amounts follow the language.
- Import a Google Maps list into a trip (Edit trip → Import places from Google Maps): pick a file from Google Takeout (Saved, as CSV), My Maps (Export to KML) or Saved Places.json, or paste a shared list's link once the sharing server is on. Places already in the trip are skipped, Undo takes the import back, and places without a location are found by name one by one.
- Adding files asks whether they sync (every device, and everyone the trip is shared with) or stay on this device only. The Files tab shows the two apart, and a file's sheet moves it between them.
- Attach files to a place from its sheet. Tap one to open it. A place with files shows a paperclip and how many on its card, and the map's place panel lists them too.
- A command line tool and an MCP server (cli/, see cli/README.md): list, read, create and change trips, places and expenses in your GitHub sync repo from a terminal or an AI chat. Your devices pick the changes up on their next sync.
- A place can last several days (a hotel, a festival): pick its last day under Until. It shows under each of its days on the board, with "2 of 3 days", and on each day's map route. Dragging it to another day moves the whole stay. The CLI and MCP server take `endDay` too.
- Save a trip for offline, in Edit trip: the map around its places, down to street level, is kept on this device so it works with no signal. It can wait for Wi-Fi, shows its progress while you keep using the app, and has Update now and Remove. A saved trip says "Ready offline" next to its name. Maps from OpenFreeMap only: Google's terms don't allow saving its map.
- Your own place categories (Settings → Categories): add, rename, reorder and remove them, or go back to the defaults. One list for all your trips; GitHub sync keeps it in categories.json so your devices share it (the newer list wins). Removing a category moves its places in your trips to Other, and Undo brings both back. A trip carries the names of the categories its places use, so people on a shared trip see them by name.
- Share a trip with people: on its Sharing page, make an invite link and send it. Whoever opens it joins with their name, and the trip syncs between everyone through Tripboard's sharing server. The owner can take someone off the trip, stop a link, or stop sharing; anyone else can leave.
- The sharing server enforces the share settings for everyone else: someone who can only view can't change the trip, and expenses or files hidden from someone never reach their device.
- The server itself (server/, a Cloudflare Worker) and a workflow that deploys it once its account is set up.
- Settings → You: your name, for when trips can be shared. Trips you make are marked as yours, and each change records who made it.
- Today: while a trip is under way, a sun first in its bar opens today's places in time order, with a rough walk or drive time between each two, Navigate on the next place not yet been to, and tomorrow's places below. Opening a trip that's under way from Home lands on Today.
- Files in a trip: a Files tab next to Plan and Expenses. Add tickets, bookings and PDFs with + (or drop them on the page with a mouse), up to 25 MB each. They're kept on the device to open without a connection. Give one a place and a note, open it, save a copy or delete it. Files go into backups and GitHub sync.
- A trip's sharing page (the people button at the top right): what everyone on the trip can do (edit or only view) and see (expenses, files), and a different setting for any one person. The app follows them: someone who can only view gets no +, no editing and read-only sheets, and a hidden section's tab goes away. They aren't a lock, since the sync repo holds the whole trip.
- Your devices that sync now share one person id, kept in the sync repo as me.json, so they count as one person on a trip.
- CLI `share` and MCP `update_sharing`; `get_trip` lists the people and what each gets.
- Home: make a trip and see your trips, soonest first, each with its cover, dates and number of places.
- A trip: name, dates, destinations and a cover photo, all changeable later.
- The trip board: places as cards, by time (each day in morning, afternoon and evening, then "No date"), by category, by importance or by distance from you, with importance as a filter too. Tick a place once you've been.
- Add a place with +, or with the + on a day: name, importance, category, day, time and a description.
- A map of each trip (the map button at the top): every place with a location is a pin, coloured by importance. Tap one to see it, edit it or move its pin; tap a place without a location, then the map, to pin it.
- Find a place by name in its sheet (from OpenStreetMap), which fills in its location and address, and usually its category.
- Sort by distance now works for places with a location.
- Services in Settings (the sliders at the top of Home): set up OpenFreeMap, OpenStreetMap, Google and MapTiler, and for the map and for Find by name pick which to use and which to fall back on. Google and MapTiler use your own key, with steps to get one and a Test button.
- Open a place in Google Maps, Apple Maps or Waze, from its sheet or the map.
- Settings is one list, with a search bar: Storage (what's kept, space used, and asking the browser to keep it), Appearance (system, light or dark), Services (the map and Find by name, and each provider's setup) and About (version and credits).
- With a mouse, drag a place to another group on the board to change it: to another day or time of day (by time), category or importance. Empty days, times of day and categories open up as places to drop it while you drag. It works with the importance filter on.
- Back up your trips to a file and restore them (Settings → Storage), or save one trip as a file from its sheet. Cover photos come along.
- Undo after deleting a trip or a place, moving a place by dragging, or restoring a backup.
- The map can show one day: pick it at the top, and its places are numbered in planned order with a dashed line between them.
- A location found with Google is fetched again after 30 days, as Google's terms ask; if Google can't answer, the pin is removed until it can.

### Changed
- Adding or editing a trip or a place opens a full-screen page, like Sharing, with a back arrow in its own bar, instead of a sheet over the board. Save stays at the bottom of the screen.
- Settings: GitHub sync and Google Drive are now below Services.
- Your devices that use GitHub sync all open a shared trip as you: joining on one brings the trip, with its sharing, to the others.
- Leaving a shared trip, being taken off it, or its owner stopping sharing no longer deletes anyone's copy: it stays as their own trip, no longer synced with the others.
- Plan, Expenses and Files are now a bar at the bottom of a trip (a floating bar on a wide screen), instead of tabs under the cover.
- A trip's Plan, Map, Expenses and Files are now icons in a small floating pill at the bottom, and the map moved into it from the top bar.
- Editing a trip, place, expense or file no longer opens the phone keyboard straight away; tap a field to type.
- With animations off, the map stops moving on its own too: zooming and moving to a place jump, a flick doesn't glide on, and labels and Google's tiles don't fade in.
- Animations are off for now: sheets, screens and the map open and move without motion. Turning them back on is removing data-motion="off" from index.html.
- Home: New trip is a + button at the top, just before Settings.
- Adding a trip, place, expense or file no longer opens the phone keyboard either: every sheet opens with nothing in focus.
- The theme you picked shows from the first frame after a reload, instead of light first.

### Fixed
- Hebrew and Arabic place names on the map read in the right order, with Arabic letters joined (MapLibre's right-to-left text plugin, kept offline with the app).
- In Hebrew, + stays on the right over the map, clear of the map's panel.
- "not on this device yet" on a file now shows in Hebrew too.
- Pins on the map sat lower than their places, more so for each pin.
- The app opened to a blank page after the Today view and the Hebrew units fix landed together (a name was declared twice); it starts again.
- Edit trip no longer shows the Google Maps link box while the sharing server isn't set up; it couldn't work without it. The file import is unchanged.
- With a keyboard, a row of choices (importance, theme, who can edit, where a file is kept) is one Tab stop, the arrow keys move between its options, and picking one no longer drops the focus to the top of the page.
- "Choose a photo" and "Choose a file" show a focus ring when tabbed to.
- In Hebrew, + keeps clear of a phone's notch on the side it sits on.
- In Hebrew, distances on the board read in Hebrew units (350 מ׳, 1.2 ק״מ) instead of m and km.

## [0.1.0] - 2026-11-15

### Added
- The first version: an empty app that works offline in the browser.
