import { getRoadmap, listRoadmapVideos } from "./roadmaps";
import { getTranscriptsByIds } from "@/lib/transcripts/store";
import { needsTitle } from "@/lib/transcripts/meta";

/**
 * A whole course in one object: its own fields, its videos in order, and how far
 * ingestion has got.
 *
 * This is the shape a caller needs to SHOW a course — the MCP `get_course` tool
 * and the view bound to it — as opposed to the card shape (`CourseCard`), which
 * is what a catalog grid needs. The difference is real: a card summarises a
 * course you have not opened, and this describes one you have.
 *
 * Lives here rather than inside the MCP server so it can be tested. Vitest only
 * collects `*.test.ts`, so a shape assembled inside a tool handler is only ever
 * exercised by calling the tool.
 */
export type OutlineVideo = {
  videoId: string;
  position: number;
  /** The transcript's title, or "" while it is still a placeholder. */
  title: string;
  channel: string;
  /** One derived line on what this video covers; "" until derivation runs. */
  summary: string;
  ingestStatus: string;
  durationSec: number | null;
  /** Deep link to the video itself, so a reader is never stuck with a raw id. */
  url: string;
};

export type CourseOutline = {
  courseId: string;
  title: string;
  description: string;
  audience: string;
  topics: string[];
  videos: OutlineVideo[];
  totalDurationSec: number | null;
  /** Counts by ingest status, so a caller can say "3 of 8 ready" without a scan. */
  ready: number;
  pending: number;
  failed: number;
};

export async function courseOutline(courseId: string): Promise<CourseOutline | null> {
  const course = await getRoadmap(courseId);
  if (!course) return null;

  const rows = await listRoadmapVideos(courseId);
  const docs = await getTranscriptsByIds(rows.map((r) => r.videoId));
  const byId = new Map(docs.map((d) => [d.videoId, d]));

  const videos: OutlineVideo[] = rows.map((r) => {
    const doc = byId.get(r.videoId);
    return {
      videoId: r.videoId,
      position: r.position,
      // "" rather than the id, and `needsTitle` rather than a local check: the
      // id is not a title, and a caller that wants a fallback should choose its
      // own rather than be handed an 11-character string that looks like one.
      title: doc && !needsTitle(doc) ? doc.title : "",
      channel: doc?.channel ?? "",
      summary: r.summary,
      ingestStatus: r.ingestStatus,
      durationSec: doc?.durationSec ?? null,
      url: `https://www.youtube.com/watch?v=${r.videoId}`,
    };
  });

  const durations = videos.map((v) => v.durationSec).filter((d): d is number => d !== null);
  const count = (status: string) => videos.filter((v) => v.ingestStatus === status).length;

  return {
    courseId: course.id,
    title: course.title,
    description: course.description,
    audience: course.audience,
    topics: course.topics,
    videos,
    totalDurationSec: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : null,
    ready: count("ready"),
    pending: count("pending"),
    failed: count("failed"),
  };
}
