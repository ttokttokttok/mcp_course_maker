import { db, newId } from "@/db";

/**
 * Fixture writers for the tests that run against a real SQLite database.
 *
 * They write columns directly rather than going through `lib/roadmaps` so a test
 * can set up a state the app's own writers would never produce — a course
 * already stamped as derived, a transcript with a blank channel, positions out
 * of order — which is exactly the state most of these tests are about.
 */

export function seedRoadmap(
  fields: Partial<{
    id: string;
    title: string;
    description: string;
    audience: string;
    topics: string[];
    featuredAt: string | null;
    metadataDerivedAt: string | null;
    createdAt: string;
  }> = {},
): string {
  const id = fields.id ?? newId();
  db.prepare(
    `INSERT INTO roadmaps
       (id, title, description, audience, topics, featured_at, metadata_derived_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    fields.title ?? "",
    fields.description ?? "",
    fields.audience ?? "",
    JSON.stringify(fields.topics ?? []),
    fields.featuredAt ?? null,
    fields.metadataDerivedAt ?? null,
    fields.createdAt ?? "2026-01-01T00:00:00.000Z",
  );
  return id;
}

export function seedVideo(
  roadmapId: string,
  videoId: string,
  position: number,
  fields: { id?: string; ingestStatus?: string; summary?: string } = {},
): string {
  const id = fields.id ?? newId();
  db.prepare(
    `INSERT INTO roadmap_videos
       (id, roadmap_id, video_id, position, ingest_status, summary, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    roadmapId,
    videoId,
    position,
    fields.ingestStatus ?? "ready",
    fields.summary ?? "",
    "2026-01-01T00:00:00.000Z",
  );
  return id;
}

export function seedTranscript(
  videoId: string,
  fields: { title?: string; channel?: string; durationSec?: number | null } = {},
): void {
  const title = fields.title ?? videoId;
  const channel = fields.channel ?? "";
  db.prepare(
    `INSERT INTO transcripts (video_id, doc, title, channel, source, duration_sec, fetched_at)
     VALUES (?, ?, ?, ?, 'captions', ?, '2026-01-01T00:00:00.000Z')`,
  ).run(
    videoId,
    JSON.stringify({
      videoId,
      title,
      channel,
      source: "captions",
      language: "en",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      segments: [],
    }),
    title,
    channel,
    fields.durationSec ?? null,
  );
}

/** Between tests in one file, since the in-memory database outlives each `it`. */
export function truncateAll(): void {
  db.exec("DELETE FROM roadmap_videos; DELETE FROM roadmaps; DELETE FROM transcripts;");
}
