import { describe, it, expect, vi } from "vitest";
import type { TranscriptDoc } from "@/lib/engine/types";

const docA: TranscriptDoc = {
  videoId: "aaaaaaaaaaa",
  title: "A",
  channel: "c",
  source: "captions",
  language: "en",
  fetchedAt: "2026-01-01T00:00:00.000Z",
  segments: [{ start: 210, duration: 4, text: "the derivative measures change" }],
};

// Keyed by id, because the point of these tests is which video got read.
const docsById: Record<string, TranscriptDoc> = {
  aaaaaaaaaaa: docA,
  active: {
    ...docA,
    videoId: "active",
    title: "Active video",
    segments: [{ start: 600, duration: 4, text: "the active lecture" }],
  },
  second: {
    ...docA,
    videoId: "second",
    title: "Second video",
    segments: [{ start: 0, duration: 4, text: "the second lecture" }],
  },
  // In the store but NOT in `listRoadmapVideos` below: the actual attack shape.
  // Without the membership check this id returns segments, not an error.
  stranger: {
    ...docA,
    videoId: "stranger",
    title: "Someone else's video",
    segments: [{ start: 0, duration: 4, text: "another course entirely" }],
  },
};

vi.mock("@/lib/transcripts/store", () => ({
  getTranscript: vi.fn(async (videoId: string) => docsById[videoId] ?? null),
  getTranscriptsByIds: vi.fn(async () => [docA]),
}));
vi.mock("@/lib/roadmaps/roadmaps", () => ({
  listRoadmapVideos: vi.fn(async () => [
    { videoId: "aaaaaaaaaaa" },
    { videoId: "active" },
    { videoId: "second" },
  ]),
}));
it("get_context returns a window; find_concept(roadmap) finds across videos", async () => {
  const { buildTutorTools } = await import("./tools");
  const tools = buildTutorTools({
    roadmapId: "r1",
    videoId: "aaaaaaaaaaa",
    positionSec: 212,
  });

  const ctx = (await tools.get_context.execute!({ halfWindowSec: 30 }, {} as never)) as {
    segments?: { text: string }[];
    error?: string;
  };
  expect(ctx.segments?.some((s) => /derivative/.test(s.text)) ?? false).toBe(true);

  const fc = (await tools.find_concept.execute!(
    { query: "derivative", scope: "roadmap" },
    {} as never,
  )) as { hits: { videoId: string }[] };
  expect(fc.hits[0].videoId).toBe("aaaaaaaaaaa");
});

describe("get_context with an explicit videoId", () => {
  type ContextResult = {
    videoId?: string;
    videoTitle?: string;
    startSec?: number;
    endSec?: number;
    segments?: { text: string }[];
    error?: string;
  };

  async function getContext(
    positionSec: number,
    args: { videoId?: string; timestamp?: number; halfWindowSec?: number },
  ): Promise<ContextResult> {
    const { buildTutorTools } = await import("./tools");
    const tools = buildTutorTools({
      roadmapId: "rm1",
      videoId: "active",
      positionSec,
    });
    return (await tools.get_context.execute!(args, {} as never)) as ContextResult;
  }

  it("reads the named video rather than the active one", async () => {
    const out = await getContext(600, { videoId: "second", timestamp: 30 });
    expect(out.videoId).toBe("second");
    expect(out.videoTitle).toBe("Second video");
    expect(out.segments?.some((s) => /second lecture/.test(s.text)) ?? false).toBe(true);
  });

  // The bug this parameter exists to fix. Carrying the CURRENT video's position
  // into a different video produces a confident answer about the wrong moment,
  // which is worse than refusing.
  it("starts at 0 on another video, never at the current position", async () => {
    const out = await getContext(1800, { videoId: "second" });
    // The window is centred on the timestamp, so centring on 0 gives [-60, 60].
    // Had 1800 been carried over it would read [1740, 1860].
    expect(out.startSec).toBe(-60);
    expect(out.endSec).toBe(60);
  });

  it("still defaults to the player position on the active video", async () => {
    const out = await getContext(600, {});
    expect(out.videoId).toBe("active");
    expect(out.startSec).toBe(540);
  });

  // The boundary is membership of THIS course. `getTranscript` is keyed by video
  // id alone, across every course in the app, so without the check the model
  // picks which row gets read.
  //
  // Two cases, because only the second one actually holds the boundary: with the
  // membership check deleted, the id below still fails — but on "transcript not
  // ready", i.e. because the fixture has no such document, not because the guard
  // held. It is kept for the not-yet-ingested variant.
  it("refuses a videoId that is not in this course", async () => {
    const out = await getContext(0, { videoId: "someone-elses-video" });
    expect(out.error).toMatch(/not in this course/i);
    expect(out.segments).toBeUndefined();
  });

  it("refuses a video whose transcript exists but belongs to another course", async () => {
    const out = await getContext(0, { videoId: "stranger" });
    expect(out.error).toMatch(/not in this course/i);
    expect(out.segments).toBeUndefined();
  });
});
