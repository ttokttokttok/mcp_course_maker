import { describe, it, expect, beforeEach } from "vitest";
import { seedRoadmap, seedTranscript, seedVideo, truncateAll } from "@/lib/test/seed";
import { courseOutline } from "./outline";

beforeEach(truncateAll);

describe("courseOutline", () => {
  it("returns the course, its videos in order, and the ingest tally", async () => {
    const id = seedRoadmap({
      title: "Neural networks",
      description: "From scratch",
      audience: "Knows Python",
      topics: ["Deep learning"],
    });
    seedTranscript("vid00000001", { title: "Intro", channel: "Karpathy", durationSec: 600 });
    seedTranscript("vid00000002", { title: "Backprop", channel: "Karpathy", durationSec: 900 });
    // Inserted out of order, so a missing ORDER BY shows up here.
    seedVideo(id, "vid00000002", 1, { summary: "the chain rule" });
    seedVideo(id, "vid00000001", 0);
    seedVideo(id, "vid00000003", 2, { ingestStatus: "failed" });

    const outline = await courseOutline(id);

    expect(outline?.title).toBe("Neural networks");
    expect(outline?.audience).toBe("Knows Python");
    expect(outline?.topics).toEqual(["Deep learning"]);
    expect(outline?.videos.map((v) => v.videoId)).toEqual([
      "vid00000001",
      "vid00000002",
      "vid00000003",
    ]);
    expect(outline?.videos[1].summary).toBe("the chain rule");
    expect(outline?.videos[0].channel).toBe("Karpathy");
    expect(outline?.videos[0].url).toBe("https://www.youtube.com/watch?v=vid00000001");
    // The failed video has no transcript, so it contributes no duration.
    expect(outline?.totalDurationSec).toBe(1500);
    expect({ ready: outline?.ready, pending: outline?.pending, failed: outline?.failed }).toEqual({
      ready: 2,
      pending: 0,
      failed: 1,
    });
  });

  it("reports a placeholder title as absent rather than as an id", async () => {
    const id = seedRoadmap({ title: "Placeholders" });
    // Both shapes `needsTitle` calls a placeholder.
    seedTranscript("vid0000000p", { title: "vid0000000p" });
    seedTranscript("vid0000000q", { title: "" });
    seedVideo(id, "vid0000000p", 0);
    seedVideo(id, "vid0000000q", 1);

    const outline = await courseOutline(id);
    // "" and not the id: a caller choosing a fallback must be able to tell that
    // there is nothing to fall back FROM. Handing it back an 11-character string
    // that looks like a title is how "VMj-3S1tku0" ends up rendered as one.
    expect(outline?.videos.map((v) => v.title)).toEqual(["", ""]);
  });

  it("is null for a course that does not exist", async () => {
    expect(await courseOutline("no-such-course")).toBeNull();
  });

  it("describes an empty course without inventing a duration", async () => {
    const id = seedRoadmap({ title: "Empty" });
    const outline = await courseOutline(id);
    expect(outline?.videos).toEqual([]);
    expect(outline?.totalDurationSec).toBeNull();
    expect(outline?.ready).toBe(0);
  });
});
