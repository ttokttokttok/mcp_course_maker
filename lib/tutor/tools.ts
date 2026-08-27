import { tool } from "ai";
import { z } from "zod";
import { conceptSearch, isRetrievalError, transcriptWindow } from "./retrieval";

/**
 * The built-in tutor's tools.
 *
 * Thin on purpose: every rule that decides WHAT may be read lives in
 * `retrieval.ts`, which the MCP server calls too. This file is the AI SDK's
 * wire shape and nothing else — schemas in, retrieval out — so the two front
 * doors cannot come to disagree about which videos belong to a course.
 */
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
        // 0, never `ctx.positionSec`, on a different video. Carrying the current
        // position into another video is what produced a confident answer about
        // 30:00 of the wrong lecture — worse than refusing.
        const defaultStart = target === ctx.videoId ? ctx.positionSec : 0;
        const result = await transcriptWindow({
          courseId: ctx.roadmapId,
          videoId: target,
          timestampSec: timestamp ?? defaultStart,
          halfWindowSec,
        });
        if (isRetrievalError(result)) {
          return {
            error:
              result.error === "transcript-not-ready"
                ? "transcript not ready for this video"
                : `video ${target} is not in this course`,
          };
        }
        return result;
      },
    }),
    find_concept: tool({
      description:
        "Find where a concept is discussed — in the current video or across the whole course. Returns timestamped quotes.",
      inputSchema: z.object({
        query: z.string().describe("Concept or phrase to find"),
        scope: z
          .enum(["video", "roadmap"])
          .describe("Search the active video or the whole roadmap/course"),
        limit: z.number().optional().describe("Max hits (default 10)"),
      }),
      execute: async ({ query, scope, limit }) => {
        const result = await conceptSearch({
          courseId: ctx.roadmapId,
          query,
          // "roadmap" is this tool's long-standing wire value for the whole
          // course; `retrieval.ts` calls the same scope "course".
          scope: scope === "video" ? "video" : "course",
          videoId: ctx.videoId,
          limit,
        });
        return isRetrievalError(result) ? { hits: [] } : { hits: result.hits };
      },
    }),
  };
}
