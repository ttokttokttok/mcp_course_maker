import { NextRequest, NextResponse } from "next/server";
import { getRoadmap, renameRoadmap } from "@/lib/roadmaps/roadmaps";
import { isRoadmapId } from "@/lib/roadmaps/id";
import { MAX_TITLE_LENGTH, normalizeTitle } from "@/lib/roadmaps/title";

// Rename a course.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Course ids are UUIDs; a malformed path segment names nothing, so it gets
  // the same 404 a missing course does, without a query.
  if (!isRoadmapId(id)) {
    return NextResponse.json({ error: "roadmap not found" }, { status: 404 });
  }

  const { title } = await req.json();
  const normalized = normalizeTitle(title);
  if (normalized === null) {
    return NextResponse.json(
      { error: `title must be 1–${MAX_TITLE_LENGTH} characters` },
      { status: 400 },
    );
  }

  const roadmap = await getRoadmap(id);
  if (!roadmap) {
    return NextResponse.json({ error: "roadmap not found" }, { status: 404 });
  }
  await renameRoadmap(id, normalized);
  // Echo the stored title: the client optimistically showed its own string, and
  // this is the trimmed one that actually landed.
  return NextResponse.json({ ok: true, title: normalized });
}
