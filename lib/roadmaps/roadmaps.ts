import { db, newId, now, toDate } from "@/db";
import { parseVideoId } from "@/lib/engine/videoId";
import { ingestVideo } from "@/lib/transcripts/ingest";
import { createTranscriptProvider } from "@/lib/transcripts/provider";
import { OEmbedVideoMetaProvider } from "@/lib/transcripts/meta";
import { needsTitle } from "@/lib/transcripts/meta";
import { deriveAndStore } from "./derive";
import { likePattern } from "./search";

/** A row of `roadmaps`, with `topics` already parsed out of its JSON column. */
export type Roadmap = {
  id: string;
  title: string;
  description: string;
  audience: string;
  topics: string[];
  featuredAt: Date | null;
  metadataDerivedAt: Date | null;
  createdAt: Date;
};

/** A row of `roadmap_videos`. */
export type RoadmapVideo = {
  id: string;
  roadmapId: string;
  videoId: string;
  position: number;
  ingestStatus: string;
  summary: string;
  addedAt: Date;
};

type RoadmapRecord = {
  id: string;
  title: string;
  description: string;
  audience: string;
  topics: string;
  featured_at: string | null;
  metadata_derived_at: string | null;
  created_at: string;
};

const ROADMAP_COLUMNS =
  "id, title, description, audience, topics, featured_at, metadata_derived_at, created_at";

/**
 * `topics` is JSON in a TEXT column, so it is parsed rather than read. Defensive
 * because the column is not validated on the way out: a hand-edited row, or one
 * written before this column existed, must degrade to "no topics" rather than
 * throwing inside a page render.
 */
function parseTopics(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

const toRoadmap = (r: RoadmapRecord): Roadmap => ({
  id: r.id,
  title: r.title,
  description: r.description,
  audience: r.audience,
  topics: parseTopics(r.topics),
  featuredAt: toDate(r.featured_at),
  metadataDerivedAt: toDate(r.metadata_derived_at),
  // notNull in the schema, so this is never the `null` branch of `toDate`.
  createdAt: toDate(r.created_at) ?? new Date(0),
});

/** A paste of URLs/ids → the distinct video ids it names, invalid entries dropped. */
function parseVideoIds(urls: string[]): string[] {
  const ids = urls
    .map((u) => u.trim())
    .filter(Boolean)
    .map((u) => {
      try {
        return parseVideoId(u);
      } catch {
        return null;
      }
    })
    .filter((x): x is string => x !== null);
  return [...new Set(ids)];
}

/**
 * Fire-and-forget ingestion. `ingestVideo` returns ready straight from the cache
 * when we already hold the transcript, so re-adding a video already ingested
 * costs nothing. Status is written back scoped to THIS roadmap's row.
 *
 * SEQUENTIAL, deliberately. This was `Promise.all`, and yt-dlp is a subprocess
 * per video that downloads from YouTube: a fan-out on a twenty-video course
 * starts twenty of them at once, and YouTube throttles the burst. The hosted
 * fallback has the same shape for a different reason — its plan allows roughly
 * one concurrent request, so a parallel pair reliably lost one to a 429 and
 * wrote it down as permanently "failed".
 *
 * The cost is that a 20-video course takes visibly longer to become usable,
 * which is what the per-video "transcribing" pill in the studio outline is for.
 */
function kickOffIngestion(roadmapId: string, videoIds: string[]): void {
  // Prepared here rather than at module scope: `db` opens the file on first use,
  // and a top-level `db.prepare` would drag that open back to import time — see
  // the proxy in db/index.ts for why that broke the build.
  const setStatus = db.prepare(
    "UPDATE roadmap_videos SET ingest_status = ? WHERE roadmap_id = ? AND video_id = ?",
  );
  const provider = createTranscriptProvider();
  const meta = new OEmbedVideoMetaProvider();
  void (async () => {
    for (const videoId of videoIds) {
      // Per-video, so one video cannot cost every video after it its ingestion.
      // Going sequential made the loop a shared fate the fan-out never was: an
      // unguarded throw here left 2..n at "pending" forever, which is the same
      // permanent non-terminal state, with nobody told why, that this whole
      // shape exists to eliminate.
      try {
        const result = await ingestVideo(videoId, provider, meta);
        if (result.status === "failed") {
          // Logged, not swallowed. The reason dies inside a status string
          // otherwise, and "failed" alone cannot tell a missing yt-dlp binary
          // from a video that has no captions at all.
          console.error("ingest failed", { roadmapId, videoId, reason: result.reason });
        }
        setStatus.run(result.status, roadmapId, videoId);
      } catch (e) {
        // A different failure from the one above, despite the shared shape.
        // `ingestVideo` never throws — it converts a failed fetch into a
        // returned reason — so the only statement above that can reach this
        // catch is the status write itself.
        console.error("ingest status write failed", { roadmapId, videoId, error: e });
        // "failed" here may well be a LIE: the transcript is probably sitting in
        // the cache, and only writing the status down failed. We tell it anyway,
        // because the alternative is worse. "pending" is the column default, so
        // a row left there is indistinguishable from one never attempted — the
        // retry control is gated on "failed", and the studio polls forever on
        // "pending". That is an unrecoverable truth. A recoverable lie costs
        // nothing to correct: retrying a video we already hold is served from
        // the cache and flips it straight back to ready. So we prefer the lie a
        // user can act on to the truth that silently eats the video.
        try {
          setStatus.run("failed", roadmapId, videoId);
        } catch {
          // Swallowed deliberately, not by omission: if the database refused
          // this write too, there is no third thing to try from in here, and
          // throwing would cost every remaining video its ingestion. The line
          // above has already put it in the log.
        }
      }
    }
    // Every transcript that is going to arrive has arrived. Derivation belongs
    // here rather than behind an explicit button: a course nobody re-derived
    // never got a name, and its owner never learned the feature existed.
    // `deriveAndStore` does not throw and declines the model call when nothing
    // is missing, so adding a tenth video to an already-derived nine costs one
    // model call and one summary write, not a rewrite of your course fields.
    await deriveAndStore(roadmapId);
  })().catch((e) => console.error("ingestion error", { roadmapId, error: e }));
}

const INSERT_ROADMAP = "INSERT INTO roadmaps (id, title, created_at) VALUES (?, ?, ?)";
const INSERT_VIDEO =
  "INSERT INTO roadmap_videos (id, roadmap_id, video_id, position, added_at) VALUES (?, ?, ?, ?, ?)";

export async function createRoadmap(input: { title: string; urls: string[] }) {
  const uniqueIds = parseVideoIds(input.urls);
  const id = newId();
  const stamp = now();

  // One transaction, so a course never exists with half its videos: better-sqlite3
  // runs the callback synchronously inside BEGIN/COMMIT and rolls back on a throw.
  const insertVideo = db.prepare(INSERT_VIDEO);
  db.transaction(() => {
    db.prepare(INSERT_ROADMAP).run(id, input.title, stamp);
    uniqueIds.forEach((videoId, i) => insertVideo.run(newId(), id, videoId, i, stamp));
  })();

  if (uniqueIds.length > 0) kickOffIngestion(id, uniqueIds);

  return { id, videos: uniqueIds };
}

/**
 * Append videos to an existing course.
 *
 * Videos already in the course come back as `skipped` rather than being
 * inserted: `(roadmap_id, video_id)` is unique, so inserting one would raise a
 * raw constraint error and surface as a 500. Creation never hit this because the
 * course was always empty.
 */
export async function addVideosToRoadmap(
  roadmapId: string,
  urls: string[],
): Promise<{ added: string[]; skipped: string[] }> {
  const wanted = parseVideoIds(urls);
  if (wanted.length === 0) return { added: [], skipped: [] };

  const existing = await listRoadmapVideos(roadmapId);
  const have = new Set(existing.map((v) => v.videoId));
  const added = wanted.filter((id) => !have.has(id));
  const skipped = wanted.filter((id) => have.has(id));
  if (added.length === 0) return { added, skipped };

  // Append after the current last position. Position is display order, not a
  // key, and a drag resolves a tie — worth less than a lock would cost.
  const nextPosition = existing.reduce((max, v) => Math.max(max, v.position), -1) + 1;
  const stamp = now();
  const insertVideo = db.prepare(INSERT_VIDEO);
  db.transaction(() => {
    added.forEach((videoId, i) =>
      insertVideo.run(newId(), roadmapId, videoId, nextPosition + i, stamp),
    );
  })();
  kickOffIngestion(roadmapId, added);

  return { added, skipped };
}

/**
 * Unlink a video from a course. Returns false when the course never had it.
 *
 * Deliberately leaves `transcripts` alone. That table is keyed by `video_id`
 * alone — one row per YouTube video across the whole app — so dropping it here
 * would break every other course using the same video and make yt-dlp re-download
 * it. Removal is unlinking, not deleting; keeping the cache is also what makes
 * re-adding instant.
 */
export async function removeVideoFromRoadmap(roadmapId: string, videoId: string): Promise<boolean> {
  const deleted = db
    .prepare("DELETE FROM roadmap_videos WHERE roadmap_id = ? AND video_id = ?")
    .run(roadmapId, videoId);
  if (deleted.changes === 0) return false;

  // Close the gap the delete left so positions stay contiguous.
  const remaining = await listRoadmapVideos(roadmapId);
  await reorderRoadmapVideos(
    roadmapId,
    remaining.map((v) => v.videoId),
  );
  return true;
}

/**
 * Three outcomes rather than a boolean, because two of them are refusals and
 * they are not the same refusal. Collapsing them would tell you that a video
 * already being fetched is not in your course — which sends you looking for a
 * problem that is not there.
 */
export type RequeueResult = "queued" | "already-pending" | "not-in-course";

/**
 * Put a video back in the queue.
 *
 * This is the escape hatch that did not exist: before it, one transient failure
 * killed a video permanently and the only way out was delete-and-re-add.
 *
 * Retrying an already-ready video is harmless — `ingestVideo` serves it from the
 * cache. Retrying a PENDING one is not: two requests landing while a transcript
 * is genuinely mid-fetch would start two concurrent `kickOffIngestion` runs for
 * an uncached video, spawning two yt-dlp downloads of the same file. The studio
 * cannot produce that (the button only renders on `failed`), but the endpoint is
 * reachable directly, so the guard lives here rather than in the UI.
 */
export async function requeueVideo(roadmapId: string, videoId: string): Promise<RequeueResult> {
  // The `ingest_status <> 'pending'` clause is the concurrency guard, and it has
  // to be part of the UPDATE rather than an `if` above it: a read-then-write
  // would let two simultaneous requests both pass the check before either wrote.
  //
  // Written before the ingestion starts, not after: "pending" is what gates the
  // studio's poll, so flipping it here is what lets the client hear the outcome.
  const updated = db
    .prepare(
      `UPDATE roadmap_videos SET ingest_status = 'pending'
       WHERE roadmap_id = ? AND video_id = ? AND ingest_status <> 'pending'`,
    )
    .run(roadmapId, videoId);

  if (updated.changes === 0) {
    // Only on the refusal path, so the common case still costs one statement.
    // The row existing is enough to name the reason: the status clause is the
    // sole one that can filter a row this course actually has.
    const row = db
      .prepare("SELECT id FROM roadmap_videos WHERE roadmap_id = ? AND video_id = ?")
      .get(roadmapId, videoId);
    return row ? "already-pending" : "not-in-course";
  }

  // A single-element array is a supported call, and it also re-derives on
  // completion — which matters because a course whose only ready transcript
  // arrives via this path has never been derived at all.
  kickOffIngestion(roadmapId, [videoId]);
  return "queued";
}

export type CourseCard = {
  id: string;
  title: string;
  description: string;
  topics: string[];
  createdAt: Date;
  videoCount: number;
  featuredAt: Date | null;
  channel: string | null;
  /**
   * First three by position, for the contents list. A video with no transcript
   * contributes nothing rather than its raw id — a half-ingested course shows
   * fewer lines instead of a row of gibberish.
   */
  videoTitles: string[];
  durationSec: number | null;
  /** First video by position — the thumbnail's subject. */
  coverVideoId: string | null;
};

type VideoJoinRow = {
  roadmap_id: string;
  video_id: string;
  title: string | null;
  channel: string | null;
  duration_sec: number | null;
};

/**
 * Every course's videos in course order, with whatever the transcript knows
 * about each, for the courses named.
 *
 * One query for the whole page rather than a correlated subquery per field per
 * card, and the aggregation happens in JS: expressing "first three real titles
 * by position" in SQL means `json_group_array` over an ordered subselect, which
 * is harder to read than `toCard` below and harder to be sure of.
 */
function videosFor(roadmapIds: string[]): Map<string, VideoJoinRow[]> {
  const byRoadmap = new Map<string, VideoJoinRow[]>(roadmapIds.map((id) => [id, []]));
  if (roadmapIds.length === 0) return byRoadmap;
  const rows = db
    .prepare(
      `SELECT rv.roadmap_id, rv.video_id, t.title, t.channel, t.duration_sec
       FROM roadmap_videos rv
       LEFT JOIN transcripts t ON t.video_id = rv.video_id
       WHERE rv.roadmap_id IN (${roadmapIds.map(() => "?").join(", ")})
       ORDER BY rv.roadmap_id, rv.position ASC`,
    )
    .all(...roadmapIds) as VideoJoinRow[];
  for (const row of rows) byRoadmap.get(row.roadmap_id)?.push(row);
  return byRoadmap;
}

/**
 * The row → card normalisation, in one place so no two lists can drift.
 *
 * `needsTitle` is imported rather than restated: it is the single authority on
 * "this title is still a placeholder". Writing the rule out a second time in SQL
 * is how a title of "   " came to be a placeholder to one copy and a real title
 * to the other, and reached the card as a blank heading.
 */
function toCard(rm: Roadmap, videos: VideoJoinRow[]): CourseCard {
  const named = videos.filter((v) => !needsTitle({ videoId: v.video_id, title: v.title ?? "" }));
  const durations = videos.map((v) => v.duration_sec).filter((d): d is number => d !== null);
  return {
    id: rm.id,
    title: rm.title,
    description: rm.description,
    topics: rm.topics,
    createdAt: rm.createdAt,
    featuredAt: rm.featuredAt,
    videoCount: videos.length,
    // The FIRST video's channel by position — a course can span several, and the
    // opener is the one you are most likely to recognise.
    channel: videos.find((v) => v.channel)?.channel || null,
    videoTitles: named.slice(0, 3).map((v) => v.title as string),
    durationSec: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : null,
    // From roadmap_videos, not transcripts: the thumbnail should appear while
    // ingestion is still running. YouTube serves the image either way.
    coverVideoId: videos[0]?.video_id ?? null,
  };
}

function toCards(rows: Roadmap[]): CourseCard[] {
  const videos = videosFor(rows.map((r) => r.id));
  return rows.map((rm) => toCard(rm, videos.get(rm.id) ?? []));
}

/**
 * Every course, pinned first (newest pin leading), then newest.
 *
 * There is no visibility filter and no owner filter because there is nobody else
 * on this machine: every course in the database is yours, and the catalog is
 * simply all of them.
 *
 * `featured_at DESC` puts NULLs last in SQLite by default, which is the order
 * this wants: a pinned course leads, and everything else falls back to newest.
 */
export async function listRoadmaps(): Promise<CourseCard[]> {
  const rows = db
    .prepare(`SELECT ${ROADMAP_COLUMNS} FROM roadmaps ORDER BY featured_at DESC, created_at DESC`)
    .all() as RoadmapRecord[];
  return toCards(rows.map(toRoadmap));
}

/** A card plus the channel the query actually matched, for the why-line. */
export type SearchResult = CourseCard & { matchedChannel: string | null };

/**
 * Catalog search over metadata: title, description, topics and channel.
 *
 * NOT over transcripts. `transcripts.doc` is one JSON column with no segments
 * table and no index into its body, so a catalog-wide transcript query would
 * load every document into Node and iterate — measured at ~137 KB and ~1,650
 * segments per hour of video. Searching inside transcripts is what the tutor's
 * `find_concept` tool does, scoped to one course.
 *
 * SQLite's LIKE is case-insensitive for ASCII, so a lowercase query matches a
 * capitalised title without any extra work. `ESCAPE` is NOT optional: SQLite has
 * no default escape character, so without this clause the backslashes
 * `likePattern` adds would be matched as literal backslashes rather than
 * escaping the `%` behind them — and a search for "100%" would return the whole
 * catalog.
 *
 * The channel clause matches ANY of the course's videos, not just the first —
 * courses span teachers, so a search naming the second one would otherwise miss.
 * `topics` is matched through `json_each` rather than as raw JSON text, so a
 * query can never hit the punctuation between two topics.
 */
export async function searchRoadmaps(q: string): Promise<SearchResult[]> {
  const pattern = likePattern(q);
  const rows = db
    .prepare(
      `SELECT ${ROADMAP_COLUMNS} FROM roadmaps r
       WHERE r.title LIKE :p ESCAPE '\\'
          OR r.description LIKE :p ESCAPE '\\'
          OR EXISTS (
               SELECT 1 FROM json_each(r.topics) tp
               WHERE tp.value LIKE :p ESCAPE '\\'
             )
          OR EXISTS (
               SELECT 1 FROM roadmap_videos rv
               JOIN transcripts t ON t.video_id = rv.video_id
               WHERE rv.roadmap_id = r.id AND t.channel LIKE :p ESCAPE '\\'
             )
       ORDER BY r.featured_at DESC, r.created_at DESC`,
    )
    .all({ p: pattern }) as RoadmapRecord[];

  const roadmaps = rows.map(toRoadmap);
  const videos = videosFor(roadmaps.map((r) => r.id));
  const needle = q.toLowerCase();
  return roadmaps.map((rm) => {
    const mine = videos.get(rm.id) ?? [];
    return {
      ...toCard(rm, mine),
      // The channel the query actually matched, which is not necessarily the one
      // on the card. Naming it is what stops a legitimate hit reading as a false
      // positive. Recomputed here rather than returned by the SQL because it is
      // the same containment test, over rows already loaded.
      matchedChannel: mine.find((v) => v.channel?.toLowerCase().includes(needle))?.channel ?? null,
    };
  });
}

/**
 * Distinct topics carried by at least one course. Unfiltered and unordered here
 * — `browsableTopics` in lib/roadmaps/search.ts applies the closed vocabulary,
 * the taxonomy order and the two-topic threshold, because those are display
 * rules and belong somewhere testable.
 */
export async function listTopics(): Promise<string[]> {
  const rows = db
    .prepare("SELECT DISTINCT tp.value AS topic FROM roadmaps r, json_each(r.topics) tp")
    .all() as { topic: string }[];
  return rows.map((r) => r.topic);
}

/** Rename a course. The caller has already normalized the title. */
export async function renameRoadmap(roadmapId: string, title: string): Promise<void> {
  db.prepare("UPDATE roadmaps SET title = ? WHERE id = ?").run(title, roadmapId);
}

/**
 * Partial by design: the details panel saves whichever fields you touched, and
 * an absent key must leave the stored value alone rather than blanking it. The
 * caller has already normalized every field.
 */
export async function updateRoadmapMetadata(
  roadmapId: string,
  patch: { title?: string; description?: string; audience?: string; topics?: string[] },
): Promise<void> {
  // Built from a fixed column map rather than from the patch's own keys, so a
  // caller-supplied name can never reach the SQL. Every value is still bound.
  const columns: [keyof typeof patch, string, (v: never) => string][] = [
    ["title", "title", (v: string) => v],
    ["description", "description", (v: string) => v],
    ["audience", "audience", (v: string) => v],
    ["topics", "topics", (v: string[]) => JSON.stringify(v)],
  ];
  const sets: string[] = [];
  const values: string[] = [];
  for (const [key, column, encode] of columns) {
    const value = patch[key];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(encode(value as never));
  }
  // An empty patch has nothing to write; return before issuing `SET` with no
  // assignments, which is a syntax error rather than a no-op.
  if (sets.length === 0) return;
  db.prepare(`UPDATE roadmaps SET ${sets.join(", ")} WHERE id = ?`).run(...values, roadmapId);
}

/**
 * Returns the rows it actually touched, so the `feature` script can tell
 * "flipped it" from "that id matched nothing" — a void return made a mistyped id
 * print success.
 */
export async function setFeatured(
  roadmapId: string,
  featured: boolean,
): Promise<{ id: string; title: string }[]> {
  const before = db.prepare("SELECT id, title FROM roadmaps WHERE id = ?").get(roadmapId) as
    | { id: string; title: string }
    | undefined;
  if (!before) return [];
  db.prepare("UPDATE roadmaps SET featured_at = ? WHERE id = ?").run(
    featured ? now() : null,
    roadmapId,
  );
  return [before];
}

export async function getRoadmap(roadmapId: string): Promise<Roadmap | null> {
  const row = db.prepare(`SELECT ${ROADMAP_COLUMNS} FROM roadmaps WHERE id = ?`).get(roadmapId) as
    | RoadmapRecord
    | undefined;
  return row ? toRoadmap(row) : null;
}

export async function listRoadmapVideos(roadmapId: string): Promise<RoadmapVideo[]> {
  const rows = db
    .prepare(
      `SELECT id, roadmap_id, video_id, position, ingest_status, summary, added_at
       FROM roadmap_videos WHERE roadmap_id = ? ORDER BY position ASC`,
    )
    .all(roadmapId) as {
    id: string;
    roadmap_id: string;
    video_id: string;
    position: number;
    ingest_status: string;
    summary: string;
    added_at: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    roadmapId: r.roadmap_id,
    videoId: r.video_id,
    position: r.position,
    ingestStatus: r.ingest_status,
    summary: r.summary,
    addedAt: toDate(r.added_at) ?? new Date(0),
  }));
}

export async function reorderRoadmapVideos(
  roadmapId: string,
  orderedVideoIds: string[],
): Promise<void> {
  // Rewrite position to match the given order (drag-to-reorder). One transaction:
  // a half-applied reorder leaves two videos sharing a position.
  const setPosition = db.prepare(
    "UPDATE roadmap_videos SET position = ? WHERE roadmap_id = ? AND video_id = ?",
  );
  db.transaction(() => {
    orderedVideoIds.forEach((videoId, i) => setPosition.run(i, roadmapId, videoId));
  })();
}
