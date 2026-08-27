import { NextRequest, NextResponse } from "next/server";
import { getRoadmap, listRoadmapVideos, updateRoadmapMetadata } from "@/lib/roadmaps/roadmaps";
import { getTranscriptsByIds } from "@/lib/transcripts/store";
import { deriveMetadata, isDerivable } from "@/lib/roadmaps/metadata";
import { storeVideoSummaries } from "@/lib/roadmaps/derive";
import { MAX_AUDIENCE_LENGTH, MAX_DESCRIPTION_LENGTH } from "@/lib/roadmaps/limits";
import { isRoadmapId } from "@/lib/roadmaps/id";
import { MAX_TITLE_LENGTH, normalizeTitle } from "@/lib/roadmaps/title";
import { normalizeTopics } from "@/lib/roadmaps/topics";

/**
 * The patch shape, taken from the writer rather than restated. `updateRoadmapMetadata`
 * types its own accumulator against the table, so a key that is not a column
 * cannot reach it — and a typo here is a compile error rather than a field
 * the update would silently drop.
 */
type MetadataPatch = Parameters<typeof updateRoadmapMetadata>[1];

/**
 * Owner-only, 404 rather than 403 for everyone else: a non-owner must not learn
 * that a private course exists, matching `access.ts`. Returns the response to
 * send, or null when the caller may edit the course.
 *
 * Both handlers call this before anything else, so a rejected caller costs a
 * shape check and one indexed read — no model call, and no query at all for an
 * id that is not UUID-shaped, since it cannot name a course.
 */
async function authorize(id: string): Promise<NextResponse | null> {
  if (!isRoadmapId(id)) return NextResponse.json({ error: "roadmap not found" }, { status: 404 });
  const roadmap = await getRoadmap(id);
  if (!roadmap) return NextResponse.json({ error: "roadmap not found" }, { status: 404 });
  return null;
}

/**
 * Re-derive: read the transcripts again and propose what they say.
 *
 * Deliberately not `deriveAndStore`. That is the automatic path and declines to
 * touch a course it has already derived; this handler is a person pressing a
 * button on purpose, so it always calls the model and always answers. The two
 * share the model call, not the write policy.
 *
 * The course fields come back unsaved — they are the owner's words, and the
 * panel shows them for review. The per-video summaries do not: nothing renders
 * them and no human reviews them, so they are stored here.
 *
 * `metadata_derived_at` is deliberately NOT stamped. It does not mean "the model
 * has been asked"; it is the gate `deriveAndStore` reads before it will ever
 * fill title/description/topics again, and this handler stores none of those —
 * the owner may close the panel without pressing Save, and the panel never sends
 * `title` at all. Stamping would close that gate on fields nobody wrote, leaving
 * a course with its fallback name forever. The cost of not stamping is one
 * redundant model call on the next add-video or retry, which re-merges only into
 * blanks. A recoverable redundancy beats an unrecoverable gate.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await authorize(id);
  if (denied) return denied;

  const rows = await listRoadmapVideos(id);
  const docs = await getTranscriptsByIds(rows.map((r) => r.videoId));

  // Re-sorted into course order. `listRoadmapVideos` orders by position but
  // `getTranscriptsByIds` is an unordered `where video_id in (...)`, so mapping
  // over the docs would hand the model whatever order the database returned them in
  // — labelled `## Video 1, 2, 3...`, which asserts a running order. The
  // description is where that matters: "starts from linear algebra and builds
  // to transformers" is a claim about sequence, and the sequence IS the course.
  // Videos still ingesting have no doc yet and simply drop out.
  //
  // `isDerivable` rather than a local "has a doc" test: a transcript row can
  // exist and still carry zero segments — the provider maps an empty caption
  // list without complaint and ingest stores it as ready — and deriveMetadata
  // numbers its `## Video N` headings from the segment-bearing subset. Filtering
  // on a different predicate here would hand back indexes into a longer list,
  // shifting every summary by one for any course whose first video has empty
  // captions. The predicate is imported so the two cannot drift.
  //
  // The row travels through that filter beside its doc rather than being
  // narrowed separately afterwards. The summaries are written back BY POSITION
  // in this list, so the row identity and the index have to survive as one
  // thing; two lists narrowed by the same rule in two places is the same drift
  // by another route, and its symptom is the tutor describing video 2 when
  // asked about video 5.
  const byId = new Map(docs.map((d) => [d.videoId, d]));
  const ready = rows.flatMap((row) => {
    const doc = byId.get(row.videoId);
    return doc && isDerivable(doc) ? [{ row, doc }] : [];
  });
  const videos = ready.map(({ doc }) => ({
    title: doc.title,
    channel: doc.channel,
    segments: doc.segments,
  }));

  try {
    const { videoSummaries, ...reviewable } = await deriveMetadata({ videos });
    // Summaries are agent-only, so they save without review; title, description
    // and topics are the owner's words and are only ever PROPOSED here.
    await storeVideoSummaries(
      id,
      ready.map((r) => r.row),
      videoSummaries,
    );
    return NextResponse.json(reviewable);
  } catch {
    // The client shows empty editable fields on this. Editing must never depend
    // on the model being reachable. A course with no transcripts at all lands
    // here too — deriveMetadata throws rather than returning blanks.
    return NextResponse.json({ error: "could not read the transcripts" }, { status: 502 });
  }
}

/** Save whichever fields the owner edited. Absent keys are left alone. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await authorize(id);
  if (denied) return denied;

  const body: unknown = await req.json();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "body must be an object" }, { status: 400 });
  }
  const fields = body as Record<string, unknown>;

  // The whole patch is validated before a single write, so a bad field cannot
  // leave the course half-saved.
  const patch: MetadataPatch = {};

  if (fields.title !== undefined) {
    const title = normalizeTitle(fields.title);
    if (title === null) {
      return NextResponse.json(
        { error: `title must be 1–${MAX_TITLE_LENGTH} characters` },
        { status: 400 },
      );
    }
    patch.title = title;
  }

  // Description and audience may legitimately be cleared, so "" is valid input
  // and only the type and length are checked. The description limit is the one
  // deriveMetadata clamps to, imported rather than restated: two literals would
  // drift, and the panel would pre-fill a value it then refused to save.
  for (const [key, max] of [
    ["description", MAX_DESCRIPTION_LENGTH],
    ["audience", MAX_AUDIENCE_LENGTH],
  ] as const) {
    const value = fields[key];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      return NextResponse.json(
        { error: `${key} must be a string of at most ${max} characters` },
        { status: 400 },
      );
    }
    // Trim first, then measure. Measuring the raw value rejects a description
    // whose 300 characters are followed by a space — 301 by the check, 300 once
    // stored, which is a rejection the owner cannot see the cause of.
    const trimmed = value.trim();
    if (trimmed.length > max) {
      return NextResponse.json(
        { error: `${key} must be a string of at most ${max} characters` },
        { status: 400 },
      );
    }
    patch[key] = trimmed;
  }

  if (fields.topics !== undefined) {
    // null means "not a list" and nothing else — an empty array is a real value,
    // and is how the owner clears the topics.
    const topics = normalizeTopics(fields.topics);
    if (topics === null) {
      return NextResponse.json({ error: "topics must be an array" }, { status: 400 });
    }
    patch.topics = topics;
  }

  // `title` stays accepted even though the details panel no longer sends it —
  // the studio's inline rename is the only writer now, and it has its own route.
  // A patch is a patch: narrowing this to reject a key it already validates
  // would buy nothing and break any caller that still sends one.
  await updateRoadmapMetadata(id, patch);
  // Echo what was stored — the client optimistically showed its own strings, and
  // these are the normalized ones that actually landed.
  return NextResponse.json({ ok: true, ...patch });
}
