import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/db";
import { seedRoadmap, seedTranscript, truncateAll } from "@/lib/test/seed";

// Ingestion is fire-and-forget and would otherwise shell out to yt-dlp. These
// tests are about the join-table bookkeeping, not transcription.
vi.mock("@/lib/transcripts/ingest", () => ({
  ingestVideo: vi.fn(async () => ({ status: "ready" })),
}));
vi.mock("./derive", () => ({ deriveAndStore: vi.fn(async () => {}) }));

beforeEach(truncateAll);

describe("course video add/remove", () => {
  it("appends after the last position, and skips videos already in the course", async () => {
    const { addVideosToRoadmap, listRoadmapVideos } = await import("./roadmaps");
    const id = seedRoadmap({ title: "add" });

    const first = await addVideosToRoadmap(id, [
      "https://youtu.be/zzztestadd0",
      "zzztestadd1",
      "not a youtube link", // dropped, not fatal
      "https://youtu.be/zzztestadd0", // duplicate WITHIN the input
    ]);
    expect(first.added).toEqual(["zzztestadd0", "zzztestadd1"]);

    // Appends after the existing max rather than restarting at 0.
    expect((await addVideosToRoadmap(id, ["zzztestadd2"])).added).toEqual(["zzztestadd2"]);
    expect((await listRoadmapVideos(id)).map((v) => [v.videoId, v.position])).toEqual([
      ["zzztestadd0", 0],
      ["zzztestadd1", 1],
      ["zzztestadd2", 2],
    ]);

    // Already present → reported as skipped, NOT inserted. Without this the
    // (roadmap_id, video_id) unique index raises a constraint error and the
    // route 500s.
    expect(await addVideosToRoadmap(id, ["zzztestadd1"])).toEqual({
      added: [],
      skipped: ["zzztestadd1"],
    });
    expect((await listRoadmapVideos(id)).length).toBe(3);
  });

  it("unlinks a video, closes the position gap, and leaves the shared transcript alone", async () => {
    const { addVideosToRoadmap, listRoadmapVideos, removeVideoFromRoadmap } =
      await import("./roadmaps");
    const mine = seedRoadmap({ title: "remove" });
    // A second course holding the SAME video — the reason removal must not
    // cascade into `transcripts`, which is keyed by video_id alone.
    const theirs = seedRoadmap({ title: "shared" });
    const videoIds = ["zzztestrmv0", "zzztestrmv1", "zzztestrmv2"];
    videoIds.forEach((v) => seedTranscript(v));

    await addVideosToRoadmap(mine, videoIds);
    await addVideosToRoadmap(theirs, ["zzztestrmv1"]);

    expect(await removeVideoFromRoadmap(mine, "zzztestrmv1")).toBe(true);

    // Gap closed: the survivors renumber to 0..n rather than leaving a hole.
    expect((await listRoadmapVideos(mine)).map((v) => [v.videoId, v.position])).toEqual([
      ["zzztestrmv0", 0],
      ["zzztestrmv2", 1],
    ]);

    // The transcript survives, and the other course still has the video.
    const kept = db
      .prepare("SELECT video_id FROM transcripts WHERE video_id = ?")
      .all("zzztestrmv1");
    expect(kept.length).toBe(1);
    expect((await listRoadmapVideos(theirs)).map((v) => v.videoId)).toEqual(["zzztestrmv1"]);

    // Removing something the course never had is a no-op, not a throw.
    expect(await removeVideoFromRoadmap(mine, "zzztestrmv1")).toBe(false);
  });

  it("deletes a course's video rows with the course, via the FK cascade", async () => {
    const { addVideosToRoadmap, listRoadmapVideos } = await import("./roadmaps");
    const id = seedRoadmap({ title: "cascade" });
    await addVideosToRoadmap(id, ["zzztestcas0"]);

    db.prepare("DELETE FROM roadmaps WHERE id = ?").run(id);

    // `foreign_keys = ON` is a per-connection pragma that SQLite defaults to
    // OFF — without db/index.ts setting it, this cascade silently does nothing
    // and the join table accumulates orphans forever.
    expect(await listRoadmapVideos(id)).toEqual([]);
  });
});
