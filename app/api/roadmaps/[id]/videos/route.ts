import { NextRequest, NextResponse } from "next/server";
import { addVideosToRoadmap, getRoadmap, listRoadmapVideos } from "@/lib/roadmaps/roadmaps";
import { isRoadmapId } from "@/lib/roadmaps/id";
import { getTranscriptsByIds } from "@/lib/transcripts/store";

/**
 * The studio's view of a course's videos: order, ingest status, and the title
 * that only exists once the transcript lands. Same shape the page builds on the
 * server, so the client can swap one for the other.
 */
async function videoRows(roadmapId: string) {
  const rows = await listRoadmapVideos(roadmapId);
  const docs = await getTranscriptsByIds(rows.map((r) => r.videoId));
  const titleById = new Map(docs.map((d) => [d.videoId, d.title]));
  return rows.map((r) => ({
    videoId: r.videoId,
    position: r.position,
    ingestStatus: r.ingestStatus,
    title: titleById.get(r.videoId)?.trim() || r.videoId,
  }));
}

/** Read the video list — this is what the studio polls while a video is transcribing. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Course ids are UUIDs; a malformed path segment names nothing, so it gets
  // the same 404 a missing course does, without a query.
  if (!isRoadmapId(id)) {
    return NextResponse.json({ error: "roadmap not found" }, { status: 404 });
  }

  if (!(await getRoadmap(id))) {
    return NextResponse.json({ error: "roadmap not found" }, { status: 404 });
  }

  return NextResponse.json({ videos: await videoRows(id) });
}

/** Append videos to an existing course. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isRoadmapId(id)) {
    return NextResponse.json({ error: "roadmap not found" }, { status: 404 });
  }

  const { urls } = await req.json();
  if (!Array.isArray(urls) || urls.length === 0 || urls.some((u) => typeof u !== "string")) {
    return NextResponse.json(
      { error: "a non-empty urls[] of strings is required" },
      { status: 400 },
    );
  }

  const roadmap = await getRoadmap(id);
  if (!roadmap) {
    return NextResponse.json({ error: "roadmap not found" }, { status: 404 });
  }
  const { added, skipped } = await addVideosToRoadmap(id, urls);
  if (added.length === 0 && skipped.length === 0) {
    return NextResponse.json({ error: "no valid YouTube URLs/IDs found" }, { status: 400 });
  }

  // The fresh list rides along so the client never needs a follow-up GET.
  return NextResponse.json({ added, skipped, videos: await videoRows(id) });
}
