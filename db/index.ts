import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

/**
 * The whole database. One SQLite file on this machine, no server, no account.
 *
 * `DATABASE_PATH` exists so the tests can point at a throwaway file and so a
 * self-hoster can put the data on another volume; the default keeps everything
 * inside the checkout, next to the code that owns it, and `data/` is gitignored.
 */
const DEFAULT_PATH = resolve(process.cwd(), "data", "app.db");

/**
 * Every table, stated once, created on first open.
 *
 * `IF NOT EXISTS` rather than a migration tool: the schema ships with the code,
 * there is exactly one deployment of it (yours), and a migration journal only
 * earns its complexity when a database you cannot see has to be upgraded in
 * place. If a column is ever added here, this file is also where the `ALTER` for
 * an existing local database would go.
 *
 * Times are ISO-8601 strings, not epoch integers: `sqlite3 data/app.db` is the
 * debugging tool for a local app, and a readable timestamp is worth more there
 * than the bytes an integer saves. Ordering still works — ISO-8601 sorts
 * lexicographically in the same order it sorts chronologically.
 *
 * `topics` is a JSON array in a TEXT column, because SQLite has no array type.
 * It is only ever read through `json_each` / `JSON.parse`, never by string
 * matching on the raw column.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS roadmaps (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  -- Human-only: prerequisites and who it's for. A transcript can say what is
  -- covered; it cannot say the course assumes you know calculus.
  audience            TEXT NOT NULL DEFAULT '',
  topics              TEXT NOT NULL DEFAULT '[]',
  featured_at         TEXT,           -- null = not pinned
  -- null = never derived. The automatic derivation runs once and then declines
  -- to touch your words again; this column is how it knows.
  metadata_derived_at TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roadmap_videos (
  id            TEXT PRIMARY KEY,
  roadmap_id    TEXT NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  video_id      TEXT NOT NULL,
  position      INTEGER NOT NULL,
  ingest_status TEXT NOT NULL DEFAULT 'pending',  -- pending|ready|failed
  -- One line on what this video covers, for the tutor's course map. '' = not
  -- summarised yet. Lives here rather than on transcripts because that table
  -- is keyed by video_id alone — one row per YouTube video across the whole app
  -- — and this summary is derived in the context of THIS course.
  summary       TEXT NOT NULL DEFAULT '',
  added_at      TEXT NOT NULL,
  UNIQUE (roadmap_id, video_id)
);

CREATE INDEX IF NOT EXISTS roadmap_videos_by_roadmap
  ON roadmap_videos (roadmap_id, position);

CREATE TABLE IF NOT EXISTS transcripts (
  video_id     TEXT PRIMARY KEY,
  doc          TEXT NOT NULL,          -- the TranscriptDoc, JSON
  title        TEXT NOT NULL DEFAULT '',
  channel      TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL DEFAULT 'captions',  -- captions|asr
  duration_sec INTEGER,
  fetched_at   TEXT NOT NULL
);
`;

function connect(): Database.Database {
  const path = process.env.DATABASE_PATH ?? DEFAULT_PATH;
  // `:memory:` has no directory to create, and neither does a bare filename.
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const handle = new Database(path);
  // Before anything else, because the two pragmas below take locks of their own.
  // SQLite's default is to fail INSTANTLY on a busy database rather than wait,
  // which turns any brief overlap — a page render during an ingestion write, two
  // processes opening at once — into a thrown SQLITE_BUSY instead of a pause.
  handle.pragma("busy_timeout = 5000");
  // WAL so a read (a page render) never blocks on the write a background
  // ingestion is in the middle of. Without it the studio's poll and the
  // ingestion loop contend for the same lock on every video.
  handle.pragma("journal_mode = WAL");
  // Off by default in SQLite, and `roadmap_videos.roadmap_id` declares a
  // cascade that does nothing at all unless this is on.
  handle.pragma("foreign_keys = ON");
  handle.exec(SCHEMA);
  return handle;
}

/**
 * Cached on `globalThis` because Next's dev server re-evaluates this module on
 * every hot reload. A fresh handle per reload leaks file descriptors and, under
 * WAL, leaves a growing pile of readers pinning the write-ahead log.
 */
const cache = globalThis as unknown as { __db?: Database.Database };

/**
 * The handle, opened on FIRST USE rather than at import.
 *
 * This is the whole reason `db` is a proxy and not a `const`. `next build`
 * collects page data by importing every route in sixteen parallel worker
 * processes; when opening the file was a module-level side effect, all sixteen
 * opened it at once, raced on the `journal_mode` pragma's write lock, and the
 * build died with SQLITE_BUSY on a machine that was not even running the app.
 * Deferring the open means importing a route costs nothing, and only a request
 * that actually reads or writes touches the disk.
 *
 * Methods are bound to the real handle: better-sqlite3's are native and reject a
 * `this` that is not a Database, which the proxy would otherwise hand them.
 */
export const db: Database.Database = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const handle = (cache.__db ??= connect());
    const value = Reflect.get(handle, prop) as unknown;
    return typeof value === "function" ? value.bind(handle) : value;
  },
});

/** The one-liner every write path uses; SQLite has no `defaultRandom()`. */
export { randomUUID as newId } from "node:crypto";

/** ISO-8601, the format every timestamp column in `SCHEMA` stores. */
export const now = (): string => new Date().toISOString();

/**
 * `null` for a null column, a `Date` otherwise. Timestamps are stored as text,
 * but everything above the storage layer works in `Date`s — this is the single
 * place that conversion happens.
 */
export const toDate = (v: unknown): Date | null =>
  typeof v === "string" && v !== "" ? new Date(v) : null;
