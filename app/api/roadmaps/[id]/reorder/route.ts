import { NextRequest, NextResponse } from "next/server";
import { getRoadmap, reorderRoadmapVideos } from "@/lib/roadmaps/roadmaps";
import { isRoadmapId } from "@/lib/roadmaps/id";

// Persist a drag-to-reorder of a roadmap's videos.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Course ids are UUIDs; a malformed path segment names nothing, so it gets
  // the same 404 a missing course does, without a query.
  if (!isRoadmapId(id)) {
    return NextResponse.json({ error: "roadmap not found" }, { status: 404 });
  }

  const { orderedVideoIds } = await req.json();
  if (!Array.isArray(orderedVideoIds) || orderedVideoIds.some((v) => typeof v !== "string")) {
    return NextResponse.json({ error: "orderedVideoIds[] (strings) required" }, { status: 400 });
  }

  const roadmap = await getRoadmap(id);
  if (!roadmap) {
    return NextResponse.json({ error: "roadmap not found" }, { status: 404 });
  }
  await reorderRoadmapVideos(id, orderedVideoIds);
  return NextResponse.json({ ok: true });
}
