-- Published trips: read-only copies anyone with the link can open and copy
-- (server/published.js). key is the SHA-256 of the key that updates or
-- removes one; by is the name it was published under.
CREATE TABLE published (id TEXT PRIMARY KEY, key TEXT NOT NULL, bundle TEXT NOT NULL, by TEXT NOT NULL, dates INTEGER NOT NULL, copies INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
