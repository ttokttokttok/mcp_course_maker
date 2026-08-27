import { getTranscript, getTranscriptsByIds } from "@/lib/transcripts/store";
import { getRoadmap, listRoadmapVideos } from "@/lib/roadmaps/roadmaps";
import { getContextWindow } from "@/lib/engine/context";
import { findConcept, findConceptAcrossVideos } from "@/lib/engine/search";
import type { RoadmapConceptHit } from "@/lib/engine/search";
import type { Segment } from "@/lib/engine/types";

/**
 * The two retrieval operations a tutor actually needs, with the course-membership
 * rule stated once.
 *
 * There are two callers with different wire shapes — the built-in tutor's AI SDK
 * tools in `tools.ts`, and the MCP tools in `mcp/server.ts` — and only one of
 * them can be the authority on "is this video part of this course". Writing that
 * check twice is how one copy comes to trust a video id the other rejects, and
 * the id is model-supplied in both.
 *
 * Worth being exact about the stake, so nobody later reads the guard as covering
 * more than it does: a transcript is captions for a third-party YouTube video,
 * not user content, and the ids cannot be enumerated from here. What the check
 * denies is an ingestion oracle — whether video X is held at all — and inference
 * spent answering about a lecture the learner is not taking.
 */

/** Every failure mode either operation has, as a value rather than a throw. */
export type RetrievalError =
  | { error: "course-not-found"; courseId: string }
  | { error: "video-not-in-course"; videoId: string }
  | { error: "transcript-not-ready"; videoId: string };

/** Narrowing helper, so callers do not each invent their own `"error" in x`. */
export function isRetrievalError(v: object): v is RetrievalError {
  return "error" in v;
}

export type TranscriptWindow = {
  videoId: string;
  videoTitle: string;
  startSec: number;
  endSec: number;
  segments: Segment[];
};

export type ConceptSearch = {
  courseId: string;
  query: string;
  scope: "video" | "course";
  hits: (RoadmapConceptHit & { videoTitle: string })[];
};

/**
 * Read the transcript around a moment in one of a course's videos.
 *
 * `videoId` is checked against the course even though `getTranscript` is keyed by
 * video id alone across the whole app — that key is precisely why the check has
 * to happen here rather than being assumed by the caller.
 */
export async function transcriptWindow(args: {
  courseId: string;
  videoId: string;
  timestampSec?: number;
  halfWindowSec?: number;
}): Promise<TranscriptWindow | RetrievalError> {
  if (!(await getRoadmap(args.courseId))) {
    return { error: "course-not-found", courseId: args.courseId };
  }
  const rows = await listRoadmapVideos(args.courseId);
  if (!rows.some((r) => r.videoId === args.videoId)) {
    return { error: "video-not-in-course", videoId: args.videoId };
  }
  const doc = await getTranscript(args.videoId);
  if (!doc) return { error: "transcript-not-ready", videoId: args.videoId };

  const w = getContextWindow(doc.segments, args.timestampSec ?? 0, args.halfWindowSec);
  return {
    videoId: args.videoId,
    // So a caller can say WHICH video it read, rather than implying the active one.
    videoTitle: doc.title,
    startSec: w.startSec,
    endSec: w.endSec,
    segments: w.segments,
  };
}

/**
 * Find where a concept is discussed — in one video, or across the whole course.
 *
 * Hits carry their video's title as well as its id, because the caller is
 * usually about to show them to a person, and a bare 11-character YouTube id
 * names nothing to a reader.
 */
export async function conceptSearch(args: {
  courseId: string;
  query: string;
  scope?: "video" | "course";
  videoId?: string;
  limit?: number;
}): Promise<ConceptSearch | RetrievalError> {
  if (!(await getRoadmap(args.courseId))) {
    return { error: "course-not-found", courseId: args.courseId };
  }
  const scope = args.scope ?? "course";
  const rows = await listRoadmapVideos(args.courseId);

  // Scoping to one video still means proving it is this course's video: the
  // narrower request must not be the looser guard.
  if (scope === "video" && !rows.some((r) => r.videoId === args.videoId)) {
    return { error: "video-not-in-course", videoId: args.videoId ?? "" };
  }

  const wanted = scope === "video" ? [args.videoId as string] : rows.map((r) => r.videoId);
  const docs = await getTranscriptsByIds(wanted);
  const titleById = new Map(docs.map((d) => [d.videoId, d.title]));

  const hits: RoadmapConceptHit[] =
    scope === "video"
      ? findConcept(docs[0]?.segments ?? [], args.query, args.limit).map((h) => ({
          ...h,
          videoId: args.videoId as string,
        }))
      : findConceptAcrossVideos(
          // Course order, not storage order: `getTranscriptsByIds` is an
          // unordered `IN (…)`, and a reader scanning hits expects them to run
          // in the order the course does when scores tie.
          rows.flatMap((r) => {
            const doc = docs.find((d) => d.videoId === r.videoId);
            return doc ? [{ videoId: doc.videoId, segments: doc.segments }] : [];
          }),
          args.query,
          args.limit,
        );

  return {
    courseId: args.courseId,
    query: args.query,
    scope,
    hits: hits.map((h) => ({ ...h, videoTitle: titleById.get(h.videoId) ?? h.videoId })),
  };
}
