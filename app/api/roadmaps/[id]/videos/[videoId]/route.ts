import { NextRequest, NextResponse } from "next/server";
import { getRoadmap, removeVideoFromRoadmap } from "@/lib/roadmaps/roadmaps";
import { isRoadmapId } from "@/lib/roadmaps/id";

/**
 * Unlink a video from a course.
 *
 * This does not delete the transcript — see `removeVideoFromRoadmap`. The
 * cached transcript is shared across every course using that video.
 */
export async function DELETE(
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
  if (!roadmap) {
    return NextResponse.json({ error: "roadmap not found" }, { status: 404 });
  }
  const removed = await removeVideoFromRoadmap(id, videoId);
  if (!removed) {
    return NextResponse.json({ error: "video not in this course" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
