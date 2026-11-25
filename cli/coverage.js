// What the app can do, and which CLI command / MCP tool does the same, so
// a chat can do everything a person can. test/coverage.test.js reads the
// app (model.js's fields and functions, index.html's sheets, views.js's
// Settings pages and undoable actions, sync.js's repo files) and fails
// when something there isn't listed here. Each entry is the tools (MCP
// names, from cli/tools.js) that cover it, or a string saying why none
// does: "device:" for what lives on one device only (never in the sync
// repo), "auto:" for what core.js keeps up by itself, "app:" for what only
// the app may change, on purpose.
//
// Adding to the app? Add the tool first (cli/tools.js, core.js), then the
// line here. A "device:" or "auto:" answer is for things a chat really
// can't or shouldn't reach, not for skipping the work.

// Tools a chat may already use: never renamed or removed (add, don't change).
const PUBLISHED = ["list_trips", "get_trip", "create_trip", "update_trip", "delete_trip", "add_place", "update_place", "delete_place",
  "add_expense", "update_expense", "update_sharing", "delete_expense",
  "find_places", "get_board", "get_day", "list_categories", "get_file", "export_backup", "find_location", "set_trip_cover",
  "import_places", "add_file", "update_file", "delete_file", "remove_person", "add_category", "update_category", "delete_category",
  "reset_categories", "import_backup", "get_weather", "order_day", "batch_update", "add_link", "add_note", "duplicate_trip", "publish_trip", "unpublish_trip", "copy_published"];

const made = "auto: made by core.js (ids, times, who changed it)";
const fields = {
  trip: {
    id: made, createdAt: made, updatedAt: made, by: made,
    name: ["create_trip", "update_trip"], start: ["create_trip", "update_trip"], end: ["create_trip", "update_trip"], destinations: ["create_trip", "update_trip"],
    destInfo: ["create_trip", "update_trip", "get_trip", "get_board"],
    cover: ["set_trip_cover"], art: ["set_trip_cover"],
    owner: "auto: you (me.json) on create_trip, as in the app; changing owners isn't something the app does",
    members: ["remove_person", "get_trip"],
    share: ["update_sharing"],
    cats: "auto: carried from your categories on every write (model.carryCats), as the app does",
  },
  place: {
    id: made, trip: made, createdAt: made, updatedAt: made, by: made,
    name: ["add_place", "update_place"], category: ["add_place", "update_place"], importance: ["add_place", "update_place"],
    day: ["add_place", "update_place"], endDay: ["add_place", "update_place"], time: ["add_place", "update_place"], endTime: ["add_place", "update_place"],
    note: ["add_place", "update_place"], lat: ["add_place", "update_place", "find_location"], lng: ["add_place", "update_place", "find_location"],
    address: ["add_place", "update_place"], placeId: ["add_place", "update_place"], visited: ["add_place", "update_place"], check: ["update_place", "find_places", "import_places"],
    rating: ["add_place", "update_place", "find_places", "get_board"],
    dest: ["add_place", "update_place", "get_trip", "get_board"],
    order: ["add_place", "update_place", "order_day"],
    geoAt: "auto: the day a Google location was fetched (Google's 30-day rule); only the app fetches from Google, and update_place drops it with a new location",
    kind: ["add_place", "update_place", "find_places"], mode: ["add_place", "update_place"],
    toName: ["add_place", "update_place"], toLat: ["add_place", "update_place", "find_location"], toLng: ["add_place", "update_place", "find_location"],
    toAddress: ["add_place", "update_place"], toPlaceId: ["add_place", "update_place"],
    arriveDay: ["add_place", "update_place", "get_day"], arriveTime: ["add_place", "update_place", "get_day"], number: ["add_place", "update_place"],
    toGeoAt: "auto: as geoAt, for where a journey arrives",
  },
  expense: {
    id: made, trip: made, createdAt: made, updatedAt: made, by: made,
    title: ["add_expense", "update_expense"], amount: ["add_expense", "update_expense"], currency: ["add_expense", "update_expense"],
    category: ["add_expense", "update_expense"], day: ["add_expense", "update_expense"], place: ["add_expense", "update_expense"],
    note: ["add_expense", "update_expense"], paidBy: ["add_expense", "update_expense"],
  },
  file: {
    id: made, trip: made, createdAt: made, updatedAt: made, by: made,
    name: ["add_file", "add_link", "add_note", "update_file"], place: ["add_file", "add_link", "add_note", "update_file"], note: ["add_file", "add_link", "update_file"],
    type: ["add_file"], size: "auto: the bytes' length (0 for a link or note)",
    kind: ["add_link", "add_note"], url: ["add_link", "update_file"], text: ["add_note", "update_file"],
    local: "device: a file kept on one device only never reaches the sync repo, so no chat can see it",
  },
};

// The doc's collections (model.sanitizeDoc).
const collections = {
  trips: ["list_trips", "get_trip"], places: ["get_trip", "find_places"], expenses: ["get_trip"], files: ["get_trip", "get_file"],
  deleted: "auto: tombstones, written by model.stamp on every delete",
};

// index.html's sheets.
const sheets = {
  dupSheet: ["duplicate_trip", "copy_published"],
  pasteSheet: ["import_places", "find_location"],
  shareInSheet: ["add_place", "add_link", "import_places"],
  tripSheet: ["create_trip", "update_trip", "delete_trip", "set_trip_cover", "import_places"],
  placeSheet: ["add_place", "update_place", "delete_place", "find_location"],
  expenseSheet: ["add_expense", "update_expense", "delete_expense"],
  fileSheet: ["update_file", "delete_file", "get_file"],
  addFilesSheet: ["add_file"],
  addKindSheet: ["add_file", "add_link", "add_note"],
  linkSheet: ["add_link", "update_file", "delete_file", "get_file"],
  noteSheet: ["add_note", "update_file", "delete_file", "get_file"],
  viewSheet: "device: how this device's place cards show category and importance (icons, names or both), whether its cards show ratings, and when its map names pins, never in the sync repo",
  mapStyleSheet: "device: the map's look is this device's map provider and style (Settings › Services › Map), never in the sync repo",
  confirmSheet: ["delete_trip", "delete_place"],
  moveSheet: ["batch_update", "update_place"],
};

// Settings pages (#/settings/<page> in views.js).
const settings = {
  sharing: "device: your name is kept on each device (your id is me.json, which the CLI reads); the sharing server is its own page (server)",
  data: ["export_backup", "import_backup"],
  categories: ["list_categories", "add_category", "update_category", "delete_category", "reset_categories"],
  appearance: "device: theme, language, °C or °F, clock and date order",
  services: "device: map and search providers and their keys (Sync keys puts the keys in keys.json, which no tool reads), never given to a chat",
  map: "device: the map provider", search: "device: the search provider (find_location uses OpenStreetMap)", p: "device: a provider's key and style, and whether its key last worked",
  drive: "device: Google Drive backups sign in on the device; export_backup makes the same file",
  server: "device: which sharing server this device shares through. A chat can't change it, since whoever runs a server reads the trips shared through it; get_trip says which server a shared trip is on",
  weather: "device: whether this device shows the weather, and in °C or °F; get_weather gives a chat the same forecast",
  ai: "app: whether AI tools may delete; a chat that could turn it on would make it pointless, so core.js refuses to write ai.json. The destructive tools say when it's off",
  about: "device: version and credits",
};

// What the app can undo (views.js's undoable(), by its English message).
const actions = {
  "Imported 1 place.": ["import_places"],
  "Added {name}.": ["add_place"],
  "Deleted {name}.": ["delete_trip", "delete_place", "delete_file"],
  "Deleted {title}.": ["delete_expense"],
  "Moved {name}.": ["update_place"],
  "Moved {name} to {to}.": ["update_place"],
  "{name} is inside {to} now.": ["update_trip"],
  "{name} has a block of its own now.": ["update_trip"],
  "{name} has new dates.": ["update_trip"],
  "Moved 1 place.": ["batch_update", "update_place"],
  "Moved 1 place to {to}.": ["batch_update", "update_place", "update_trip"],
  "Deleted 1 place.": ["delete_place"],
  "Restored 1 trip ({replaced} replaced).": ["import_backup"],
  "Restored 1 trip.": ["import_backup"],
  "Removed {name}. Its places are in Other now.": ["delete_category"],
  "Categories are back to the defaults.": ["reset_categories"],
  "Made {name}.": ["duplicate_trip"],
  "Made {name}. 1 file isn't on this device yet, so it stayed behind.": ["duplicate_trip"],
};

// Files sync.js keeps in the repo.
const repo = {
  "trips/": ["list_trips", "get_trip"],
  "covers/": ["set_trip_cover", "export_backup"],
  "files/": ["add_file", "get_file", "delete_file"],
  "me.json": "auto: read for your id (owner of new trips, `by`, what you may change)",
  "categories.json": ["list_categories", "add_category", "update_category", "delete_category", "reset_categories"],
  "shares.json": ["get_trip"],
  "published.json": ["publish_trip", "unpublish_trip", "get_trip"],
  "keys.json": "app: Settings › Services › Sync keys; the map and search keys, never read, written or returned by core.js or any tool",
  "ai.json": "app: Settings › AI tools; read by core.js before any tool that deletes, never written by it",
};

// model.js's API: "cli" when cli/ uses it, or why it doesn't.
const ui = "device: the app's screens only";
const model = {
  sanitizeFile: "cli", MAX_FILE_MB: "cli", MAX_NOTE: "cli", hasBytes: "cli", linkUrl: "cli", linkHost: "auto: sanitizeFile names a link after its site with it", SECTIONS: "cli", access: "cli", can: "cli", ownTrip: "cli", duplicateTrip: "cli", publishedOf: "cli", publishedDoc: "cli", HIDDEN_START: "auto: publishedOf moves a trip published without dates to it", EXPENSE_CATEGORIES: "cli", CATEGORY: "cli",
  sanitizeExpense: "cli", expenseTotals: "cli", expensesByCategory: "cli", onDay: "cli", catList: "cli", catName: "cli", carryCats: "cli", isCatId: "cli",
  CATEGORIES: "cli", IMPORTANCE: "cli", newId: "cli", isDay: "cli", sanitizeTrip: "cli", sanitizePlace: "cli", sanitizeDoc: "cli", stamp: "cli",
  tripDays: "cli", dayIndex: "cli", tripStatus: "cli", sortTrips: "cli", slotOf: "cli", timeOn: "cli", stayPart: "cli", isStay: "auto: sanitizePlace, timeOn and stayPart use it", distanceKm: "cli", board: "cli", filterPlaces: "auto: board uses it for get_board's only, categories and rating", STAR_FILTERS: "cli", areas: "auto: board uses it for sort area", backupOf: "cli",
  mergeBackup: "cli", COVER_ART: "cli", dayPlan: "cli", awayStay: "cli", leg: "cli", nextOf: "cli", KNOWN: "auto: test/coverage.test.js checks fields against it",
  ROLES: "auto: sanitizeTrip checks roles", join: "device: a device joining a shared trip adds itself", renamePerson: "auto: the app's sync moves ids to me.json's",
  EXPENSE_CATEGORY: "auto: sanitizeExpense checks it", CURRENCIES: "device: the currency picker's first choices; any ISO code is taken",
  expenseDays: ui, placeDays: "auto: onDay and tripDays cover it", addDays: ui, daySpan: ui, IMPORTANCE_LABEL: ui, RATINGS: "auto: board's rating sort uses it", SLOTS: "auto: slotOf and board use it",
  isTime: "auto: sanitizePlace checks it", daysUntil: ui, staleGoogle: "device: refreshing Google locations needs the person's Google key",
  REACH_KM: "cli", destOf: "cli", dayDest: "cli", setDest: "cli", datesFromStays: "cli",
  destsOf: "auto: destOf and board use it", hasDestDates: "auto: board uses it",
  dayRoute: "auto: get_day gives the same places in order",
  MODES: "auto: add_place's mode enum", MODE: ui, isJourney: "cli", landsOn: "auto: arrivals uses it", endOf: "auto: leg uses it",
  arrivals: "cli", connection: "cli", nextLeg: ui, staleGoogleTo: "device: as staleGoogle", GOOGLE_DAYS: "device: as staleGoogle", swipeStep: ui,
};

module.exports = { PUBLISHED, fields, collections, sheets, settings, actions, repo, model };
