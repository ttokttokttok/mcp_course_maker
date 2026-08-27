import { notFound } from "next/navigation";
import { getRoadmap, listRoadmapVideos } from "@/lib/roadmaps/roadmaps";
import { isRoadmapId } from "@/lib/roadmaps/id";
import { getTranscriptsByIds } from "@/lib/transcripts/store";
import { Studio, type StudioVideoRow } from "@/components/Studio";
import { AppHeader } from "@/components/AppHeader";

// Explicit, not incidental. This page shows ingest status that changes while
// you watch it, so a cached render would show a course still transcribing long
// after it finished.
export const dynamic = "force-dynamic";

export default async function RoadmapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // A malformed id names nothing, so it gets the same notFound() as a missing
  // course rather than reaching the query.
  if (!isRoadmapId(id)) notFound();

  const roadmap = await getRoadmap(id);
  if (!roadmap) notFound();

  const rows = await listRoadmapVideos(id);
  const docs = await getTranscriptsByIds(rows.map((r) => r.videoId));
  const titleById = new Map(docs.map((d) => [d.videoId, d.title]));

  const videos: StudioVideoRow[] = rows.map((r) => ({
    videoId: r.videoId,
    position: r.position,
    ingestStatus: r.ingestStatus,
    title: titleById.get(r.videoId)?.trim() || r.videoId,
  }));

  return (
    <>
      <AppHeader />
      <Studio
        roadmapId={id}
        title={roadmap.title}
        videos={videos}
        description={roadmap.description}
        audience={roadmap.audience}
        topics={roadmap.topics}
      />
    </>
  );
}
