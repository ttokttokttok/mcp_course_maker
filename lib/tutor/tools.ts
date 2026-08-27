import { tool } from "ai";
import { z } from "zod";
import { getTranscript, getTranscriptsByIds } from "@/lib/transcripts/store";
import { listRoadmapVideos } from "@/lib/roadmaps/roadmaps";
import { getContextWindow } from "@/lib/engine/context";
import { findConcept, findConceptAcrossVideos } from "@/lib/engine/search";

export function buildTutorTools(ctx: { roadmapId: string; videoId: string; positionSec: number }) {
  return {
    get_context: tool({
      description:
        "Get transcript segments around a timestamp. Defaults to the video the learner is " +
        "watching and their current position. Pass videoId to read a DIFFERENT video in this " +
        "course — its timestamp starts at 0 unless you give one.",
      inputSchema: z.object({
        videoId: z
          .string()
          .optional()
          .describe("A video in this course. Defaults to the one being watched."),
        timestamp: z
          .number()
          .optional()
          .describe("Seconds; defaults to the current player position, or 0 for another video"),
        halfWindowSec: z.number().optional().describe("Seconds before/after (default 60)"),
      }),
      execute: async ({ videoId, timestamp, halfWindowSec }) => {
        const target = videoId ?? ctx.videoId;

        // Membership in THIS course, not merely "is a string". `getTranscript`
        // is keyed by video id alone, across every course in the app, so an
        // unvalidated id lets the MODEL choose which row gets read — and this is
        // the first model-supplied identifier in the tutor tools; everything
        // else is closure-captured from `ctx`.
        //
        // Worth being exact about the stake, so nobody later reads this as
        // guarding more than it does: a transcript is captions for a third-party
        // YouTube video, not user content, and the id cannot be enumerated from
        // here. What the check denies is an ingestion oracle — whether ANY user
        // of this app has ingested video X — and inference spent off-course.
        if (target !== ctx.videoId) {
          const vids = await listRoadmapVideos(ctx.roadmapId);
          if (!vids.some((v) => v.videoId === target)) {
            return { error: `video ${target} is not in this course` };
          }
        }

        const doc = await getTranscript(target);
        if (!doc) return { error: "transcript not ready for this video" };

        // 0, never `ctx.positionSec`, on a different video. Carrying the
        // current position into another video is what produced a confident
        // answer about 30:00 of the wrong lecture — worse than refusing.
        const defaultStart = target === ctx.videoId ? ctx.positionSec : 0;
        const w = getContextWindow(doc.segments, timestamp ?? defaultStart, halfWindowSec);
        return {
          videoId: target,
          // So the model can say WHICH video it read, rather than implying the
          // active one.
          videoTitle: doc.title,
          startSec: w.startSec,
          endSec: w.endSec,
          segments: w.segments,
        };
      },
    }),
    find_concept: tool({
      description:
        "Find where a concept is discussed — in the current video or across the whole roadmap. Returns timestamped quotes.",
      inputSchema: z.object({
        query: z.string().describe("Concept or phrase to find"),
        scope: z
          .enum(["video", "roadmap"])
          .describe("Search the active video or the whole roadmap/course"),
        limit: z.number().optional().describe("Max hits (default 10)"),
      }),
      execute: async ({ query, scope, limit }) => {
        if (scope === "video") {
          const doc = await getTranscript(ctx.videoId);
          return {
            hits: doc
              ? findConcept(doc.segments, query, limit).map((h) => ({
                  ...h,
                  videoId: ctx.videoId,
                }))
              : [],
          };
        }
        const vids = await listRoadmapVideos(ctx.roadmapId);
        const docs = await getTranscriptsByIds(vids.map((v) => v.videoId));
        return {
          hits: findConceptAcrossVideos(
            docs.map((d) => ({ videoId: d.videoId, segments: d.segments })),
            query,
            limit,
          ),
        };
      },
    }),
  };
}
