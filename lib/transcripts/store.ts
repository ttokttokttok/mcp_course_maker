import { db, now } from "@/db";
import type { TranscriptDoc } from "@/lib/engine/types";
import { durationFromSegments } from "@/lib/engine/duration";
import { needsTitle } from "./meta";

/**
 * The transcript cache: one row per YouTube video, shared by every course that
 * uses it. Keyed by video id alone, which is what makes adding a video someone
 * already ingested instant and free.
 *
 * The document itself lives in a JSON TEXT column rather than in a segments
 * table. Segments are only ever read as a whole document — the tutor's context
 * window and concept search both walk the array in Node — so a row per segment
 * would buy an index nothing queries.
 */
type TranscriptRecord = { doc: string };

/**
 * A stored doc is parsed, not validated. A file hand-edited or written by an
 * older version can be anything, and every caller here would rather have "no
 * transcript" than an exception thrown mid-render.
 */
function parseDoc(raw: string): TranscriptDoc | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as TranscriptDoc) : null;
  } catch {
    return null;
  }
}

export async function getTranscript(videoId: string): Promise<TranscriptDoc | null> {
  const row = db.prepare("SELECT doc FROM transcripts WHERE video_id = ?").get(videoId) as
    | TranscriptRecord
    | undefined;
  return row ? parseDoc(row.doc) : null;
}

export async function putTranscript(doc: TranscriptDoc): Promise<void> {
  // Computed here rather than at the call sites so every path that stores a
  // transcript — fresh fetch, cache-hit enrichment, backfill — gets it.
  //
  // `?? []` because a doc read back out of JSON is cast, not validated: a stored
  // row missing `segments` would throw in the loop inside `durationFromSegments`,
  // and ingest's catch would report a working cache hit as a permanently failed
  // video that then blocks the course. No duration is a fine answer here; a
  // broken video is not.
  const durationSec = doc.durationSec ?? durationFromSegments(doc.segments ?? []);
  const stored: TranscriptDoc = durationSec === null ? doc : { ...doc, durationSec };
  db.prepare(
    `INSERT INTO transcripts (video_id, doc, title, channel, source, duration_sec, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (video_id) DO UPDATE SET
       doc = excluded.doc,
       title = excluded.title,
       channel = excluded.channel,
       source = excluded.source,
       duration_sec = excluded.duration_sec`,
  ).run(
    stored.videoId,
    JSON.stringify(stored),
    // Coalesced, not passed through: a doc read back out of JSON is cast rather
    // than validated, so any of these can be absent on a row written by an older
    // version or edited by hand. SQLite refuses to bind `undefined` at all, so
    // without these a ragged document throws here — inside ingest's catch, which
    // would then report a working cache hit as a permanently failed video. The
    // column defaults are restated because this is the last place that can apply
    // them.
    stored.title ?? "",
    stored.channel ?? "",
    stored.source ?? "captions",
    durationSec,
    // Only on the insert: `fetched_at` is absent from the DO UPDATE list so a
    // re-store — an oEmbed title arriving for a transcript fetched last week —
    // does not restamp the row as freshly fetched.
    now(),
  );
}

export async function getTranscriptsByIds(ids: string[]): Promise<TranscriptDoc[]> {
  if (ids.length === 0) return [];
  const rows = db
    .prepare(`SELECT doc FROM transcripts WHERE video_id IN (${ids.map(() => "?").join(", ")})`)
    .all(...ids) as TranscriptRecord[];
  return rows.map((r) => parseDoc(r.doc)).filter((d): d is TranscriptDoc => d !== null);
}

/**
 * Rows still carrying a placeholder title. The SQL is the coarse filter — it
 * catches the two shapes cheaply — and `needsTitle` remains the authority,
 * re-checked per row by the caller.
 */
export async function listPlaceholderTranscripts(): Promise<TranscriptDoc[]> {
  const rows = db
    .prepare("SELECT doc FROM transcripts WHERE trim(title) = '' OR trim(title) = video_id")
    .all() as TranscriptRecord[];
  return rows
    .map((r) => parseDoc(r.doc))
    .filter((d): d is TranscriptDoc => d !== null && needsTitle(d));
}
