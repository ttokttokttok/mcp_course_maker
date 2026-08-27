import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/db";
import { seedRoadmap, seedVideo, truncateAll } from "@/lib/test/seed";
import type { Segment, TranscriptDoc } from "@/lib/engine/types";

// Only the model call is replaced; `isDerivable` stays the real predicate. It is
// the thing these tests are actually about — the summaries have to be numbered
// against the same list `deriveMetadata` numbers its `## Video N` headings from,
// and a stubbed copy of the predicate would happily agree with a wrong caller.
vi.mock("@/lib/roadmaps/metadata", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/roadmaps/metadata")>()),
  deriveMetadata: vi.fn(async () => ({
    title: "Derived Title",
    description: "Derived description.",
    topics: ["Math"],
    videoSummaries: [{ index: 1, summary: "First video" }],
  })),
}));

// The transcripts are the one input that does not live in the database: they are
// keyed by video id across the whole app, and every test here is about which of
// them a course's rows map onto.
vi.mock("@/lib/transcripts/store", () => ({
  getTranscriptsByIds: vi.fn(async () => [doc("vidA")]),
}));

/** Self-labelled, so a summary landing on the wrong video is visible in the diff. */
const doc = (
  videoId: string,
  segments: Segment[] = [{ start: 0, duration: 1, text: videoId }],
): TranscriptDoc => ({
  videoId,
  title: `${videoId} title`,
  channel: `${videoId} channel`,
  source: "captions",
  language: "en",
  fetchedAt: "2026-07-30T00:00:00.000Z",
  segments,
});

/** The stored row, read back through raw SQL so the assertions see columns. */
const course = (id: string) =>
  db
    .prepare(
      "SELECT title, description, audience, topics, metadata_derived_at FROM roadmaps WHERE id = ?",
    )
    .get(id) as {
    title: string;
    description: string;
    audience: string;
    topics: string;
    metadata_derived_at: string | null;
  };

const summaries = (id: string) =>
  db
    .prepare("SELECT video_id, summary FROM roadmap_videos WHERE roadmap_id = ? ORDER BY position")
    .all(id) as { video_id: string; summary: string }[];

/** An unnamed, underived course with two ready videos — the state after ingestion. */
function twoVideoCourse(): string {
  const id = seedRoadmap({ title: "" });
  seedVideo(id, "vidA", 0);
  seedVideo(id, "vidB", 1);
  return id;
}

beforeEach(() => {
  truncateAll();
  // Reset, not clear: these tests override the defaults with mockResolvedValue,
  // and a cleared mock keeps the override. The one that stung was "no video has
  // a transcript yet" leaking an empty transcript list into every test after it,
  // where it silently satisfies assertions about not writing.
  vi.resetAllMocks();
});

describe("deriveAndStore", () => {
  it("names an unnamed course and stamps it derived", async () => {
    const { deriveAndStore } = await import("./derive");
    const id = twoVideoCourse();
    await deriveAndStore(id);

    const row = course(id);
    expect(row.title).toBe("Derived Title");
    expect(row.description).toBe("Derived description.");
    expect(JSON.parse(row.topics)).toEqual(["Math"]);
    expect(row.metadata_derived_at).not.toBeNull();
  });

  // You may have named the course while ingestion was still running. A model
  // that has just read the transcripts is not evidence you were wrong.
  //
  // All three fields, not just the title: with only the title populated here,
  // dropping `description` and `topics` out of the merge and writing the derived
  // values straight through leaves the whole suite green.
  it("keeps every course field that was already written", async () => {
    const { deriveAndStore } = await import("./derive");
    const id = seedRoadmap({ title: "My Course", description: "Mine", topics: ["Science"] });
    seedVideo(id, "vidA", 0);
    await deriveAndStore(id);

    const row = course(id);
    expect(row.title).toBe("My Course");
    expect(row.description).toBe("Mine");
    expect(JSON.parse(row.topics)).toEqual(["Science"]);
  });

  // The narrow window the re-read inside the transaction exists for. The first
  // read happens before a model call that takes seconds; a rename landing during
  // that call is invisible to it, and merging against the stale blank title
  // reads the new name as "nobody wrote this" and overwrites it.
  it("keeps a rename that landed while the model call was in flight", async () => {
    const { deriveMetadata } = await import("@/lib/roadmaps/metadata");
    const id = twoVideoCourse();
    vi.mocked(deriveMetadata).mockImplementation(async () => {
      db.prepare("UPDATE roadmaps SET title = 'My Course' WHERE id = ?").run(id);
      return {
        title: "Derived Title",
        description: "Derived description.",
        topics: ["Math"],
        videoSummaries: [],
      };
    });
    const { deriveAndStore } = await import("./derive");
    await deriveAndStore(id);

    expect(course(id).title).toBe("My Course");
  });

  // The other half of the same race, and the half no re-read can win: two
  // ingestions finishing together both read a null stamp and both decide to
  // write. Only the database sees both, so the decision travels in the statement
  // that does the writing — `WHERE metadata_derived_at IS NULL`.
  it("declines the course write when a stamp lands during the model call", async () => {
    const { deriveMetadata } = await import("@/lib/roadmaps/metadata");
    const id = twoVideoCourse();
    vi.mocked(deriveMetadata).mockImplementation(async () => {
      // What the competing derive would have written, moments earlier.
      db.prepare(
        "UPDATE roadmaps SET title = 'Winner', metadata_derived_at = '2026-01-01T00:00:00.000Z' WHERE id = ?",
      ).run(id);
      return {
        title: "Loser",
        description: "D",
        topics: [],
        videoSummaries: [{ index: 1, summary: "First video" }],
      };
    });
    const { deriveAndStore } = await import("./derive");
    await deriveAndStore(id);

    expect(course(id).title).toBe("Winner");
    // The summaries still land: they are independent of the course fields, and
    // the loser has no reason to abandon work the winner did not do.
    expect(summaries(id)[0].summary).toBe("First video");
  });

  it("writes nothing when the course is deleted during the model call", async () => {
    const { deriveMetadata } = await import("@/lib/roadmaps/metadata");
    const id = twoVideoCourse();
    vi.mocked(deriveMetadata).mockImplementation(async () => {
      db.prepare("DELETE FROM roadmaps WHERE id = ?").run(id);
      return {
        title: "Derived Title",
        description: "D",
        topics: [],
        videoSummaries: [{ index: 1, summary: "First video" }],
      };
    });
    const { deriveAndStore } = await import("./derive");
    await expect(deriveAndStore(id)).resolves.toBeUndefined();
    // The summaries go too: those rows cascaded away with the course.
    expect(summaries(id)).toEqual([]);
  });

  it("writes a summary onto the matching video row", async () => {
    const { deriveAndStore } = await import("./derive");
    const id = twoVideoCourse();
    await deriveAndStore(id);
    expect(summaries(id)).toEqual([
      { video_id: "vidA", summary: "First video" },
      { video_id: "vidB", summary: "" },
    ]);
  });

  // The regression this whole file guards. A stored transcript can hold zero
  // segments — a provider maps an empty caption list without complaint and
  // ingest writes the video down as ready — so "has a transcript row" and "has
  // segments" are different sets. `deriveMetadata` numbers its headings from the
  // second one. Map the indexes back through the first and every summary shifts,
  // and the tutor confidently describes video 2 when asked about video 5.
  it("numbers the summaries against the videos that have segments", async () => {
    const { getTranscriptsByIds } = await import("@/lib/transcripts/store");
    const { deriveMetadata } = await import("@/lib/roadmaps/metadata");
    const id = seedRoadmap({ title: "" });
    seedVideo(id, "vidA", 0);
    seedVideo(id, "vidB", 1);
    seedVideo(id, "vidC", 2);
    vi.mocked(getTranscriptsByIds).mockResolvedValue([doc("vidA", []), doc("vidB"), doc("vidC")]);
    vi.mocked(deriveMetadata).mockResolvedValue({
      title: "T",
      description: "D",
      topics: [],
      videoSummaries: [
        { index: 1, summary: "about B" },
        { index: 2, summary: "about C" },
      ],
    });
    const { deriveAndStore } = await import("./derive");
    await deriveAndStore(id);

    // The empty transcript is not shown to the model at all…
    expect(vi.mocked(deriveMetadata).mock.calls[0][0].videos.map((v) => v.title)).toEqual([
      "vidB title",
      "vidC title",
    ]);
    // …so index 1 is vidB, not vidA.
    expect(summaries(id)).toEqual([
      { video_id: "vidA", summary: "" },
      { video_id: "vidB", summary: "about B" },
      { video_id: "vidC", summary: "about C" },
    ]);
  });

  // This is what makes "add a video later" summarise only the new one.
  it("leaves a row that already has a summary alone", async () => {
    const { getTranscriptsByIds } = await import("@/lib/transcripts/store");
    const { deriveMetadata } = await import("@/lib/roadmaps/metadata");
    const id = seedRoadmap({ title: "" });
    seedVideo(id, "vidA", 0, { summary: "written earlier" });
    seedVideo(id, "vidB", 1);
    vi.mocked(getTranscriptsByIds).mockResolvedValue([doc("vidA"), doc("vidB")]);
    vi.mocked(deriveMetadata).mockResolvedValue({
      title: "T",
      description: "D",
      topics: [],
      videoSummaries: [
        { index: 1, summary: "about A" },
        { index: 2, summary: "about B" },
      ],
    });
    const { deriveAndStore } = await import("./derive");
    await deriveAndStore(id);

    expect(summaries(id)).toEqual([
      { video_id: "vidA", summary: "written earlier" },
      { video_id: "vidB", summary: "about B" },
    ]);
  });

  it("does not touch course fields once the course has been derived", async () => {
    const { deriveAndStore } = await import("./derive");
    const id = seedRoadmap({
      title: "Named",
      metadataDerivedAt: "2026-07-30T00:00:00.000Z",
    });
    seedVideo(id, "vidA", 0);
    await deriveAndStore(id);

    expect(course(id).title).toBe("Named");
    // The missing summary is still worth fetching — that is why the model ran.
    expect(summaries(id)[0].summary).toBe("First video");
  });

  it("spends no model call when nothing is missing", async () => {
    const { deriveMetadata } = await import("@/lib/roadmaps/metadata");
    const id = seedRoadmap({ title: "Named", metadataDerivedAt: "2026-07-30T00:00:00.000Z" });
    seedVideo(id, "vidA", 0, { summary: "already" });
    const { deriveAndStore } = await import("./derive");
    await deriveAndStore(id);

    expect(deriveMetadata).not.toHaveBeenCalled();
    expect(course(id).title).toBe("Named");
  });

  it("does nothing when no video has a transcript yet", async () => {
    const { getTranscriptsByIds } = await import("@/lib/transcripts/store");
    const { deriveMetadata } = await import("@/lib/roadmaps/metadata");
    vi.mocked(getTranscriptsByIds).mockResolvedValue([]);
    const { deriveAndStore } = await import("./derive");
    await deriveAndStore(twoVideoCourse());
    expect(deriveMetadata).not.toHaveBeenCalled();
  });

  // The other half of the same divergence: a course whose only transcripts are
  // empty has nothing to describe, and `deriveMetadata` throws on an empty list
  // rather than returning blanks. Calling it would burn the attempt on an error.
  it("does nothing when every stored transcript is empty", async () => {
    const { getTranscriptsByIds } = await import("@/lib/transcripts/store");
    const { deriveMetadata } = await import("@/lib/roadmaps/metadata");
    const id = twoVideoCourse();
    vi.mocked(getTranscriptsByIds).mockResolvedValue([doc("vidA", [])]);
    const { deriveAndStore } = await import("./derive");
    await deriveAndStore(id);

    expect(deriveMetadata).not.toHaveBeenCalled();
    expect(course(id).title).toBe("");
  });

  it("does nothing when the course no longer exists", async () => {
    const { deriveMetadata } = await import("@/lib/roadmaps/metadata");
    const { deriveAndStore } = await import("./derive");
    await deriveAndStore("no-such-course");
    expect(deriveMetadata).not.toHaveBeenCalled();
  });

  // A derive that produced no usable title must not mark the course derived —
  // otherwise the automatic path never tries again and the course is stuck
  // falling back to its first video's title forever.
  it("leaves the course underived when the model returned no title", async () => {
    const { deriveMetadata } = await import("@/lib/roadmaps/metadata");
    const id = twoVideoCourse();
    vi.mocked(deriveMetadata).mockResolvedValue({
      title: "",
      description: "",
      topics: [],
      videoSummaries: [{ index: 1, summary: "S" }],
    });
    const { deriveAndStore } = await import("./derive");
    await deriveAndStore(id);

    expect(course(id).metadata_derived_at).toBeNull();
    // The summary is still worth keeping — it is independent of the title.
    expect(summaries(id)[0].summary).toBe("S");
  });

  // Called from fire-and-forget ingestion. Throwing here would reject the
  // background promise and could mark ready videos failed.
  it("never throws when the model fails", async () => {
    const { deriveMetadata } = await import("@/lib/roadmaps/metadata");
    vi.mocked(deriveMetadata).mockRejectedValue(new Error("502"));
    const { deriveAndStore } = await import("./derive");
    await expect(deriveAndStore(twoVideoCourse())).resolves.toBeUndefined();
  });
});
