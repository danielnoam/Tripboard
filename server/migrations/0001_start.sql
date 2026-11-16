-- Shared trips, the keys that open them, invite links, and a daily count
-- of trips shared from each address (to stop a flood).
CREATE TABLE trips (id TEXT PRIMARY KEY, bundle TEXT NOT NULL, version INTEGER NOT NULL, owner TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE keys (hash TEXT PRIMARY KEY, trip TEXT NOT NULL, person TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX keys_trip ON keys (trip, person);
CREATE TABLE invites (trip TEXT NOT NULL, hash TEXT NOT NULL, expires TEXT NOT NULL, PRIMARY KEY (trip, hash));
CREATE TABLE creates (ip TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (ip, day));
