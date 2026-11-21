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
  "reset_categories", "import_backup", "get_weather"];

const made = "auto: made by core.js (ids, times, who changed it)";
const fields = {
  trip: {
    id: made, createdAt: made, updatedAt: made, by: made,
    name: ["create_trip", "update_trip"], start: ["create_trip", "update_trip"], end: ["create_trip", "update_trip"], destinations: ["create_trip", "update_trip"],
    cover: ["set_trip_cover"],
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
    address: ["add_place", "update_place"], placeId: ["add_place", "update_place"], visited: ["add_place", "update_place"],
    geoAt: "auto: the day a Google location was fetched (Google's 30-day rule); only the app fetches from Google, and update_place drops it with a new location",
  },
  expense: {
    id: made, trip: made, createdAt: made, updatedAt: made, by: made,
    title: ["add_expense", "update_expense"], amount: ["add_expense", "update_expense"], currency: ["add_expense", "update_expense"],
    category: ["add_expense", "update_expense"], day: ["add_expense", "update_expense"], place: ["add_expense", "update_expense"],
    note: ["add_expense", "update_expense"], paidBy: ["add_expense", "update_expense"],
  },
  file: {
    id: made, trip: made, createdAt: made, updatedAt: made, by: made,
    name: ["add_file", "update_file"], place: ["add_file", "update_file"], note: ["add_file", "update_file"],
    type: ["add_file"], size: "auto: the bytes' length",
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
  tripSheet: ["create_trip", "update_trip", "delete_trip", "set_trip_cover", "import_places"],
  placeSheet: ["add_place", "update_place", "delete_place", "find_location"],
  expenseSheet: ["add_expense", "update_expense", "delete_expense"],
  fileSheet: ["update_file", "delete_file", "get_file"],
  addFilesSheet: ["add_file"],
};

// Settings pages (#/settings/<page> in views.js).
const settings = {
  you: "device: your name is kept on each device; your id is me.json, which the CLI reads",
  categories: ["list_categories", "add_category", "update_category", "delete_category", "reset_categories"],
  storage: ["export_backup", "import_backup"],
  appearance: "device: theme and language",
  services: "device: map and search providers and their keys, never given to a chat",
  map: "device: the map provider", search: "device: the search provider (find_location uses OpenStreetMap)", p: "device: a provider's key and style",
  sync: "device: the GitHub sync token; the CLI has its own (TRIPBOARD_TOKEN)",
  drive: "device: Google Drive backups sign in on the device; export_backup makes the same file",
  server: "device: which sharing server this device shares through. A chat can't change it, since whoever runs a server reads the trips shared through it; get_trip says which server a shared trip is on",
  weather: "device: whether this device shows the weather, and in °C or °F; get_weather gives a chat the same forecast",
  ai: "app: whether AI tools may delete; a chat that could turn it on would make it pointless, so core.js refuses to write ai.json. The destructive tools say when it's off",
  about: "device: version and credits",
};

// What the app can undo (views.js's undoable(), by its English message).
const actions = {
  "Imported 1 place.": ["import_places"],
  "Deleted {name}.": ["delete_trip", "delete_place", "delete_file"],
  "Deleted {title}.": ["delete_expense"],
  "Moved {name}.": ["update_place"],
  "Restored 1 trip ({replaced} replaced).": ["import_backup"],
  "Restored 1 trip.": ["import_backup"],
  "Removed {name}. Its places are in Other now.": ["delete_category"],
  "Categories are back to the defaults.": ["reset_categories"],
};

// Files sync.js keeps in the repo.
const repo = {
  "trips/": ["list_trips", "get_trip"],
  "covers/": ["set_trip_cover", "export_backup"],
  "files/": ["add_file", "get_file", "delete_file"],
  "me.json": "auto: read for your id (owner of new trips, `by`, what you may change)",
  "categories.json": ["list_categories", "add_category", "update_category", "delete_category", "reset_categories"],
  "shares.json": ["get_trip"],
  "ai.json": "app: Settings › AI tools; read by core.js before any tool that deletes, never written by it",
};

// model.js's API: "cli" when cli/ uses it, or why it doesn't.
const ui = "device: the app's screens only";
const model = {
  sanitizeFile: "cli", MAX_FILE_MB: "cli", SECTIONS: "cli", access: "cli", can: "cli", ownTrip: "cli", EXPENSE_CATEGORIES: "cli", CATEGORY: "cli",
  sanitizeExpense: "cli", expenseTotals: "cli", expensesByCategory: "cli", onDay: "cli", catList: "cli", catName: "cli", carryCats: "cli", isCatId: "cli",
  CATEGORIES: "cli", IMPORTANCE: "cli", newId: "cli", isDay: "cli", sanitizeTrip: "cli", sanitizePlace: "cli", sanitizeDoc: "cli", stamp: "cli",
  tripDays: "cli", dayIndex: "cli", tripStatus: "cli", sortTrips: "cli", slotOf: "cli", distanceKm: "cli", board: "cli", backupOf: "cli",
  mergeBackup: "cli", dayPlan: "cli", leg: "cli", nextOf: "cli", KNOWN: "auto: test/coverage.test.js checks fields against it",
  ROLES: "auto: sanitizeTrip checks roles", join: "device: a device joining a shared trip adds itself", renamePerson: "auto: the app's sync moves ids to me.json's",
  EXPENSE_CATEGORY: "auto: sanitizeExpense checks it", CURRENCIES: "device: the currency picker's first choices; any ISO code is taken",
  expenseDays: ui, placeDays: "auto: onDay and tripDays cover it", addDays: ui, daySpan: ui, IMPORTANCE_LABEL: ui, SLOTS: "auto: slotOf and board use it",
  isTime: "auto: sanitizePlace checks it", daysUntil: ui, staleGoogle: "device: refreshing Google locations needs the person's Google key",
  dayRoute: "auto: get_day gives the same places in order", GOOGLE_DAYS: "device: as staleGoogle", swipeStep: ui,
};

module.exports = { PUBLISHED, fields, collections, sheets, settings, actions, repo, model };
