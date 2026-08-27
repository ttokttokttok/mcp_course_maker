import { MCPServer } from "mcp-use";
import { z } from "zod";
import {
  addVideosToRoadmap,
  createRoadmap,
  listRoadmaps,
  removeVideoFromRoadmap,
  reorderRoadmapVideos,
  requeueVideo,
  searchRoadmaps,
} from "@/lib/roadmaps/roadmaps";
import { courseOutline } from "@/lib/roadmaps/outline";
import { matchReasons, normalizeQuery } from "@/lib/roadmaps/search";
import { normalizeTitle } from "@/lib/roadmaps/title";
import { isRoadmapId } from "@/lib/roadmaps/id";
import { conceptSearch, isRetrievalError, transcriptWindow } from "@/lib/tutor/retrieval";
import { formatTimestamp } from "@/lib/engine/time";

/**
 * The MCP front door.
 *
 * The Next app and this server are two doors onto the same `lib/` — nothing here
 * reimplements a rule, it only translates between MCP's wire shape and functions
 * the app already uses. The interesting consequence is what is ABSENT: there is
 * no model, no prompt and no tutor in this file, because the host (ChatGPT,
 * Claude, an agent) is the model. This server's job is to ingest YouTube into a
 * timestamped, searchable corpus and hand it over.
 *
 * Mounted by `app/api/mcp/[[...path]]/route.ts`; `withMcpUse` in next.config.ts
 * compiles the view under `mcp/views/` alongside the Next build.
 */
export const server = new MCPServer({
  name: "course-maker",
  version: "0.1.0",
  basePath: "/api/mcp",
});

/** Every tool takes a course id from the model, so every tool shape-checks it. */
const courseId = z.string().describe("Course id, as returned by list_courses or create_course");

const textResult = (text: string) => ({ content: [{ type: "text" as const, text }] });
const errorResult = (text: string) => ({
  isError: true as const,
  content: [{ type: "text" as const, text }],
});

/** One tally sentence, so the model does not have to count the videos array. */
const ingestLine = (o: { ready: number; pending: number; failed: number }) =>
  `${o.ready} ready` +
  (o.pending > 0 ? `, ${o.pending} still transcribing` : "") +
  (o.failed > 0 ? `, ${o.failed} failed` : "");

// ---------------------------------------------------------------------------
// Reading the catalog
// ---------------------------------------------------------------------------

const CARD = z.object({
  courseId: z.string(),
  title: z.string(),
  description: z.string(),
  topics: z.array(z.string()),
  videoCount: z.number(),
  durationSec: z.number().nullable(),
  channel: z.string().nullable(),
  videoTitles: z.array(z.string()),
});

export const listCourses = server.tool(
  {
    name: "list_courses",
    title: "List courses",
    description:
      "List every course on this machine, pinned first then newest. Start here when the user " +
      "refers to a course by name rather than by id.",
    inputSchema: z.object({}),
    outputSchema: z.object({ courses: z.array(CARD) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    const courses = (await listRoadmaps()).map((c) => ({
      courseId: c.id,
      title: c.title,
      description: c.description,
      topics: c.topics,
      videoCount: c.videoCount,
      durationSec: c.durationSec,
      channel: c.channel,
      videoTitles: c.videoTitles,
    }));
    return {
      ...textResult(
        courses.length === 0
          ? "No courses yet. Use create_course with some YouTube links to make one."
          : courses.map((c) => `${c.title || "(unnamed)"} — ${c.courseId}`).join("\n"),
      ),
      structuredContent: { courses },
    };
  },
);

export const searchCourses = server.tool(
  {
    name: "search_courses",
    title: "Search courses",
    description:
      "Search the catalog over course titles, descriptions, topics and the channels their " +
      "videos came from. This does NOT search inside transcripts — use find_concept for that.",
    inputSchema: z.object({ query: z.string().describe("Free text; a topic, title or teacher") }),
    outputSchema: z.object({
      query: z.string(),
      results: z.array(CARD.extend({ matchedBecause: z.string() })),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ query }) => {
    const q = normalizeQuery(query);
    if (q === null) return errorResult("query must be a non-empty string");

    const results = (await searchRoadmaps(q)).map((r) => ({
      courseId: r.id,
      title: r.title,
      description: r.description,
      topics: r.topics,
      videoCount: r.videoCount,
      durationSec: r.durationSec,
      channel: r.channel,
      videoTitles: r.videoTitles,
      // The same why-line the web catalog shows, so a hit that looks surprising
      // explains itself rather than reading as a false positive.
      matchedBecause: matchReasons(r, r.matchedChannel, q),
    }));
    return {
      ...textResult(
        results.length === 0
          ? `Nothing in the catalog matches "${q}".`
          : results.map((r) => `${r.title} — ${r.courseId} (${r.matchedBecause})`).join("\n"),
      ),
      structuredContent: { query: q, results },
    };
  },
);

// ---------------------------------------------------------------------------
// Reading one course — the view-bound tool
// ---------------------------------------------------------------------------

const OUTLINE = z.object({
  courseId: z.string(),
  title: z.string(),
  description: z.string(),
  audience: z.string(),
  topics: z.array(z.string()),
  videos: z.array(
    z.object({
      videoId: z.string(),
      position: z.number(),
      title: z.string(),
      channel: z.string(),
      summary: z.string(),
      ingestStatus: z.string(),
      durationSec: z.number().nullable(),
      url: z.string(),
    }),
  ),
  totalDurationSec: z.number().nullable(),
  ready: z.number(),
  pending: z.number(),
  failed: z.number(),
});

export const getCourse = server.tool(
  {
    name: "get_course",
    title: "Open a course",
    description:
      "Open one course: its videos in order, what each covers, and how far transcription has " +
      "got. Renders an interactive player the user can watch and search. Call this whenever " +
      "the user wants to SEE or WATCH a course rather than just hear about it.",
    inputSchema: z.object({ courseId }),
    outputSchema: OUTLINE,
    annotations: { readOnlyHint: true, openWorldHint: false },
    view: {
      name: "course-player",
      description: "A course player: video, outline, and search over the transcripts.",
      prefersBorder: true,
      /**
       * The YouTube embed is a nested iframe, which the MCP Apps sandbox
       * forbids unless the view names the origin here. `resourceDomains` covers
       * the thumbnail CDN, used for the poster frame and as the fallback when a
       * host declines to render the frame at all.
       *
       * `connectDomains` is deliberately absent: the view talks only to this
       * server, and the framework appends the server's own origin at emission
       * time. Listing anything else would widen the sandbox for nothing.
       */
      csp: {
        frameDomains: ["https://www.youtube.com", "https://www.youtube-nocookie.com"],
        resourceDomains: ["https://i.ytimg.com"],
      },
    },
  },
  async ({ courseId: id }) => {
    if (!isRoadmapId(id)) return errorResult(`no course with id ${id}`);
    const outline = await courseOutline(id);
    if (!outline) return errorResult(`no course with id ${id}`);

    const lines = outline.videos.map(
      (v) =>
        `${v.position + 1}. ${v.title || v.videoId}` +
        (v.summary ? ` — ${v.summary}` : "") +
        (v.ingestStatus === "ready" ? "" : ` [${v.ingestStatus}]`),
    );
    return {
      ...textResult(
        `${outline.title || "(unnamed course)"} — ${ingestLine(outline)}\n${lines.join("\n")}`,
      ),
      structuredContent: outline,
    };
  },
);

// ---------------------------------------------------------------------------
// Reading inside the transcripts
// ---------------------------------------------------------------------------

export const findConceptTool = server.tool(
  {
    name: "find_concept",
    title: "Find a concept",
    description:
      "Search INSIDE a course's transcripts and return timestamped quotes. This is how you " +
      "answer 'where does she explain X?' — every hit is a real line someone said, with the " +
      "second it was said at. Prefer this over guessing from video titles.",
    inputSchema: z.object({
      courseId,
      query: z.string().describe("The concept or phrase to look for"),
      scope: z
        .enum(["course", "video"])
        .optional()
        .describe("Whole course (default) or a single video"),
      videoId: z.string().optional().describe("Required when scope is 'video'"),
      limit: z.number().optional().describe("Max hits (default 10)"),
    }),
    outputSchema: z.object({
      courseId: z.string(),
      query: z.string(),
      scope: z.string(),
      hits: z.array(
        z.object({
          videoId: z.string(),
          videoTitle: z.string(),
          start: z.number(),
          timestamp: z.string(),
          quote: z.string(),
          score: z.number(),
          url: z.string(),
        }),
      ),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ courseId: id, query, scope, videoId, limit }) => {
    const result = await conceptSearch({ courseId: id, query, scope, videoId, limit });
    if (isRetrievalError(result)) return errorResult(describeRetrievalError(result));

    const hits = result.hits.map((h) => ({
      ...h,
      // A deep link at the exact second, so a hit is actionable outside the view
      // as well as inside it.
      url: `https://www.youtube.com/watch?v=${h.videoId}&t=${Math.floor(h.start)}s`,
    }));
    return {
      ...textResult(
        hits.length === 0
          ? `Nothing in this course's transcripts matches "${query}".`
          : hits
              .map((h) => `[${h.timestamp}] ${h.videoTitle || h.videoId}: "${h.quote}"`)
              .join("\n"),
      ),
      structuredContent: { ...result, hits },
    };
  },
);

export const getTranscriptTool = server.tool(
  {
    name: "get_transcript",
    title: "Read a transcript window",
    description:
      "Read the transcript around a moment in one of a course's videos — use it after " +
      "find_concept to read what surrounds a hit, or to quote a passage accurately.",
    inputSchema: z.object({
      courseId,
      videoId: z.string().describe("A video in this course"),
      timestampSec: z.number().optional().describe("Seconds into the video (default 0)"),
      halfWindowSec: z.number().optional().describe("Seconds before and after (default 60)"),
    }),
    outputSchema: z.object({
      videoId: z.string(),
      videoTitle: z.string(),
      startSec: z.number(),
      endSec: z.number(),
      text: z.string(),
      segments: z.array(z.object({ start: z.number(), timestamp: z.string(), text: z.string() })),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ courseId: id, videoId, timestampSec, halfWindowSec }) => {
    const w = await transcriptWindow({ courseId: id, videoId, timestampSec, halfWindowSec });
    if (isRetrievalError(w)) return errorResult(describeRetrievalError(w));

    const segments = w.segments.map((s) => ({
      start: s.start,
      timestamp: formatTimestamp(s.start),
      text: s.text,
    }));
    // The flat prose as well as the segments: a model quoting a passage should
    // not have to reassemble it, and the segment boundaries are an artifact of
    // caption timing rather than of the sentence.
    const text = segments.map((s) => s.text).join(" ");
    return {
      ...textResult(text || "(no transcript in that window)"),
      structuredContent: { ...w, segments, text },
    };
  },
);

// ---------------------------------------------------------------------------
// Building courses
// ---------------------------------------------------------------------------

export const createCourse = server.tool(
  {
    name: "create_course",
    title: "Create a course",
    description:
      "Create a course from YouTube links or video ids, in the order given. Transcripts are " +
      "downloaded in the background one at a time, so the course comes back with videos still " +
      "'pending' — call get_course again to see them land. Leave the title empty and the " +
      "course names itself from the transcripts once they arrive.",
    inputSchema: z.object({
      urls: z
        .array(z.string())
        .min(1)
        .describe("YouTube URLs or bare video ids, in the order they should be watched"),
      title: z.string().optional().describe("Optional; derived from the transcripts when omitted"),
    }),
    outputSchema: z.object({
      courseId: z.string(),
      videoIds: z.array(z.string()),
      skippedInputs: z.array(z.string()),
    }),
  },
  async ({ urls, title }) => {
    // "" is a legal stored title and means "nobody has named this yet", which is
    // what lets derivation fill it in later. A supplied one still has to be usable.
    const normalized = title === undefined ? "" : normalizeTitle(title);
    if (normalized === null) return errorResult("title must be 1–200 characters");

    const result = await createRoadmap({ title: normalized, urls });
    if (result.videos.length === 0) {
      return errorResult("none of those inputs parsed as a YouTube video");
    }
    const skippedInputs = urls.filter((u) => !result.videos.some((v) => u.includes(v)));
    return {
      ...textResult(
        `Created course ${result.id} with ${result.videos.length} video(s). ` +
          "Transcripts are downloading now — call get_course to watch them land.",
      ),
      structuredContent: {
        courseId: result.id,
        videoIds: result.videos,
        skippedInputs,
      },
    };
  },
);

export const addVideos = server.tool(
  {
    name: "add_videos",
    title: "Add videos to a course",
    description:
      "Append YouTube videos to the end of an existing course. Videos already in the course " +
      "come back as skipped rather than being added twice.",
    inputSchema: z.object({ courseId, urls: z.array(z.string()).min(1) }),
    outputSchema: z.object({ added: z.array(z.string()), skipped: z.array(z.string()) }),
  },
  async ({ courseId: id, urls }) => {
    if (!isRoadmapId(id) || !(await courseOutline(id)))
      return errorResult(`no course with id ${id}`);
    const { added, skipped } = await addVideosToRoadmap(id, urls);
    if (added.length === 0 && skipped.length === 0) {
      return errorResult("none of those inputs parsed as a YouTube video");
    }
    return {
      ...textResult(
        `Added ${added.length}${skipped.length > 0 ? `, skipped ${skipped.length} already present` : ""}.`,
      ),
      structuredContent: { added, skipped },
    };
  },
);

export const removeVideo = server.tool(
  {
    name: "remove_video",
    title: "Remove a video from a course",
    description:
      "Unlink a video from a course and close the gap in the ordering. The transcript stays " +
      "cached, so re-adding it later is instant and costs no download.",
    inputSchema: z.object({ courseId, videoId: z.string() }),
    outputSchema: z.object({ removed: z.boolean() }),
    annotations: { destructiveHint: true },
  },
  async ({ courseId: id, videoId }) => {
    if (!isRoadmapId(id)) return errorResult(`no course with id ${id}`);
    const removed = await removeVideoFromRoadmap(id, videoId);
    if (!removed) return errorResult(`${videoId} is not in course ${id}`);
    return { ...textResult(`Removed ${videoId}.`), structuredContent: { removed } };
  },
);

export const reorderVideos = server.tool(
  {
    name: "reorder_videos",
    title: "Reorder a course",
    description:
      "Set the order of a course's videos. Order is the whole point of a course, so this is " +
      "how you put a prerequisite before the lecture that assumes it. Pass every video id.",
    inputSchema: z.object({ courseId, orderedVideoIds: z.array(z.string()).min(1) }),
    outputSchema: z.object({ orderedVideoIds: z.array(z.string()) }),
  },
  async ({ courseId: id, orderedVideoIds }) => {
    if (!isRoadmapId(id)) return errorResult(`no course with id ${id}`);
    const outline = await courseOutline(id);
    if (!outline) return errorResult(`no course with id ${id}`);

    // Refused rather than partially applied: reordering a subset silently leaves
    // the omitted videos sharing positions with the ones that moved, and the
    // model has no way to notice.
    const have = new Set(outline.videos.map((v) => v.videoId));
    const missing = outline.videos.filter((v) => !orderedVideoIds.includes(v.videoId));
    const unknown = orderedVideoIds.filter((v) => !have.has(v));
    if (missing.length > 0 || unknown.length > 0) {
      return errorResult(
        "orderedVideoIds must list every video in the course exactly once. " +
          (missing.length > 0 ? `Missing: ${missing.map((v) => v.videoId).join(", ")}. ` : "") +
          (unknown.length > 0 ? `Not in this course: ${unknown.join(", ")}.` : ""),
      );
    }

    await reorderRoadmapVideos(id, orderedVideoIds);
    return { ...textResult("Reordered."), structuredContent: { orderedVideoIds } };
  },
);

export const retryVideo = server.tool(
  {
    name: "retry_video",
    title: "Retry a failed video",
    description:
      "Put a video whose transcript download failed back in the queue. Use this after fixing " +
      "the cause — installing yt-dlp, or setting YTDLP_COOKIES_FROM_BROWSER.",
    inputSchema: z.object({ courseId, videoId: z.string() }),
    outputSchema: z.object({ status: z.enum(["queued", "already-pending", "not-in-course"]) }),
  },
  async ({ courseId: id, videoId }) => {
    if (!isRoadmapId(id)) return errorResult(`no course with id ${id}`);
    const status = await requeueVideo(id, videoId);
    if (status === "not-in-course") return errorResult(`${videoId} is not in course ${id}`);
    return {
      ...textResult(
        status === "queued"
          ? `Requeued ${videoId}; call get_course to see it land.`
          : `${videoId} is already being fetched.`,
      ),
      structuredContent: { status },
    };
  },
);

/** One sentence per refusal, in the words the model should repeat to the user. */
function describeRetrievalError(e: { error: string; courseId?: string; videoId?: string }): string {
  switch (e.error) {
    case "course-not-found":
      return `no course with id ${e.courseId}`;
    case "video-not-in-course":
      return `${e.videoId || "that video"} is not in this course`;
    default:
      return `the transcript for ${e.videoId} is not ready yet — it may still be downloading, or it may have failed`;
  }
}

export default server;
