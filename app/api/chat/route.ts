import { openai } from "@ai-sdk/openai";
import { frontendTools } from "@assistant-ui/react-ai-sdk";
import {
  type JSONSchema7,
  streamText,
  stepCountIs,
  convertToModelMessages,
  type UIMessage,
} from "ai";
import { buildTutorTools } from "@/lib/tutor/tools";
import { getRoadmap, listRoadmapVideos } from "@/lib/roadmaps/roadmaps";
import { getTranscriptsByIds } from "@/lib/transcripts/store";
import { isRoadmapId } from "@/lib/roadmaps/id";
import { formatCourseContext } from "@/lib/tutor/context";

const GROUNDING_SYSTEM =
  "You are a YouTube lecture tutor over a learning roadmap. Use the tools before answering. " +
  "Cite timestamps from tool results; never invent quotes. When the learner asks where something " +
  "is covered across videos, call find_concept with scope 'roadmap'.";

/**
 * Sent only when a map is actually sent, and immediately before it.
 *
 * Kept out of `GROUNDING_SYSTEM` because this route also serves chat with no
 * `roadmapId` at all, and telling a model to consult a block that is not there
 * is an invitation to invent one.
 *
 * Structural questions — what is this course, what is next, how far in am I —
 * are answerable from the map without a tool call. Searching transcripts for
 * them wastes a step and answers worse.
 */
const MAP_SYSTEM =
  "The course map below tells you the course's subject, its videos in order, and where the " +
  "learner is. Answer structural questions from it directly. If it says who the course is for, " +
  "pitch your explanations at that reader.";

export async function POST(req: Request) {
  const {
    messages,
    system,
    tools,
    roadmapId,
    videoId,
    positionSec,
  }: {
    messages: UIMessage[];
    system?: string;
    tools?: Record<string, { description?: string; parameters: JSONSchema7 }>;
    roadmapId?: string;
    videoId?: string;
    positionSec?: number;
  } = await req.json();

  // Resolved before any model call, and hoisted out of the block below so the
  // course map is built from this row rather than fetching it a second time.
  let roadmap: Awaited<ReturnType<typeof getRoadmap>> = null;
  if (roadmapId) {
    // `roadmapId` is declared `string` but destructured from an unvalidated JSON
    // body, so at runtime it can be a number or an object. `isRoadmapId` takes
    // `unknown` and never throws, and a malformed id cannot name a course — so
    // it gets the same 404 a nonexistent one does.
    if (!isRoadmapId(roadmapId)) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    roadmap = await getRoadmap(roadmapId);
    if (!roadmap) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
  }

  // `roadmap` is the row the 404 check above already fetched, not a second lookup.
  let courseContext = "";
  // The video the learner is actually on, once the course has vouched for it.
  // Undefined until then, so nothing downstream can reach for the raw body value
  // by accident.
  let activeVideoId: string | undefined;
  if (roadmap) {
    const rows = await listRoadmapVideos(roadmap.id);

    // `videoId` arrives in the same unvalidated JSON body as `roadmapId`, which
    // gets isRoadmapId + getRoadmap — so trusting this one was an inconsistent
    // guard on the same request, not a considered exemption. It reaches
    // `getTranscript`, which is keyed by video id alone across every course.
    //
    // `typeof` because the declared `string` is a compile-time fiction on a JSON
    // body: the same reason `isRoadmapId` takes `unknown`. Without it a posted
    // object also slips past the identity check inside the tutor tools — `target
    // !== ctx.videoId` is false for the same reference — and reaches the query.
    //
    // Free: `rows` is the list the course map is built from either way.
    activeVideoId =
      typeof videoId === "string" && rows.some((r) => r.videoId === videoId) ? videoId : undefined;

    const docs = await getTranscriptsByIds(rows.map((r) => r.videoId));
    const titleById = new Map(docs.map((d) => [d.videoId, d.title]));
    courseContext = formatCourseContext({
      title: roadmap.title,
      description: roadmap.description,
      topics: roadmap.topics,
      audience: roadmap.audience,
      videos: rows.map((r) => ({
        videoId: r.videoId,
        // The raw id when no transcript title exists yet, which is the same
        // placeholder the studio and the catalog see; `formatCourseContext`
        // knows to read it as "unnamed" rather than as a name.
        title: titleById.get(r.videoId)?.trim() || r.videoId,
        summary: r.summary,
        ingestStatus: r.ingestStatus,
      })),
      // The validated id, not the body's: otherwise the map still tells the
      // model the learner is on a video this course does not contain.
      activeVideoId: activeVideoId ?? "",
      positionSec: positionSec ?? 0,
    });
  }

  const tutorTools =
    roadmapId && activeVideoId
      ? buildTutorTools({
          roadmapId,
          videoId: activeVideoId,
          positionSec: positionSec ?? 0,
        })
      : {};

  const result = streamText({
    model: openai(process.env.OPENAI_MODEL ?? "gpt-4o-mini"),
    // The map rides in `system` despite being untrusted content, because the AI
    // SDK offers no less-privileged place to put it: there is no data role, and
    // the only alternative — a synthetic first user turn — would put words in
    // the learner's mouth and reappear as theirs in every later turn. So the
    // fencing and the framing inside `formatCourseContext` carry the weight,
    // and they are a speed bump rather than a boundary; see the comment there.
    // It goes last so the instruction about how to read it arrives first.
    system:
      (system ? system + "\n\n" : "") +
      GROUNDING_SYSTEM +
      (courseContext ? "\n\n" + MAP_SYSTEM + "\n\n" + courseContext : ""),
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(6),
    tools: {
      ...tutorTools,
      ...frontendTools(tools ?? {}),
    },
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });
}
