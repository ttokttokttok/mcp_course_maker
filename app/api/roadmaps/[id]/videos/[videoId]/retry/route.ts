import { NextRequest, NextResponse } from "next/server";
import { getRoadmap, requeueVideo } from "@/lib/roadmaps/roadmaps";
import { isRoadmapId } from "@/lib/roadmaps/id";

/**
 * Retry a failed video.
 *
 * 404 rather than 403 for everyone else, matching `access.ts` and the metadata
 * route: a non-owner must not learn that a private course exists. The sibling
 * `visibility` and `title` routes return 403 for the same case, and so does the
 * DELETE in this very directory — that disagreement predates this route, and
 * this one joins the correct side of it rather than widening the split.
 *
 * Returns immediately. The studio already polls `/videos` every 4s while
 * anything is pending, so the outcome arrives through a path that exists.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; videoId: string }> },
) {
  const { id, videoId } = await ctx.params;
  // Course ids are UUIDs; a malformed path segment names nothing, so it gets
  // the same 404 a missing course does, without a query.
  if (!isRoadmapId(id)) {
    return NextResponse.json({ error: "roadmap not found" }, { status: 404 });
  }

  const roadmap = await getRoadmap(id);
  if (!roadmap) return NextResponse.json({ error: "roadmap not found" }, { status: 404 });

  // 409, not 404, for a video already being fetched: it is a real video in a
  // real course and the caller's request was simply redundant. Answering "not
  // in this course" would send an owner hunting for a problem that is not there.
  const result = await requeueVideo(id, videoId);
  if (result === "not-in-course") {
    return NextResponse.json({ error: "video not in this course" }, { status: 404 });
  }
  if (result === "already-pending") {
    return NextResponse.json({ error: "already transcribing" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
