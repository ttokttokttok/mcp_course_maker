import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/roadmaps/roadmaps", () => ({
  getRoadmap: vi.fn(async () => ({ id: "r1", title: "T" })),
  listRoadmapVideos: vi.fn(async () => [
    { id: "rv1", videoId: "vid1", position: 0, ingestStatus: "ready" },
  ]),
  updateRoadmapMetadata: vi.fn(async () => {}),
}));

// The write itself belongs to `derive.ts` and is tested there against a recording
// `tx`. What matters here is which rows this route hands it, so the module is
// replaced and the call inspected.
vi.mock("@/lib/roadmaps/derive", () => ({
  storeVideoSummaries: vi.fn(async () => {}),
}));

vi.mock("@/lib/transcripts/store", () => ({
  getTranscriptsByIds: vi.fn(async () => [
    { videoId: "vid1", title: "V", channel: "C", segments: [{ start: 0, duration: 1, text: "t" }] },
  ]),
}));

// Only the model call is replaced; the rest of the module is the real thing, so
// MAX_DESCRIPTION_LENGTH here is the same constant the route validates against.
// A copy pasted into this mock could drift from it, and the failure that hides
// is exactly the one the shared constant exists to prevent: a sheet pre-filled
// with a derived description it then refuses to save.
vi.mock("@/lib/roadmaps/metadata", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/roadmaps/metadata")>()),
  deriveMetadata: vi.fn(async () => ({
    title: "T",
    description: "D",
    topics: ["Math"],
    videoSummaries: [],
  })),
}));

/** A stored transcript, self-labelled so an out-of-order forward is visible. */
const doc = (videoId: string) => ({
  videoId,
  title: `${videoId} title`,
  channel: `${videoId} channel`,
  segments: [{ start: 0, duration: 1, text: videoId }],
});

/** A course row, self-labelled the same way so a misaligned write is readable. */
const row = (id: string, videoId: string, position: number) => ({
  id,
  videoId,
  position,
  ingestStatus: "ready",
});

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body: unknown) =>
  new NextRequest(`http://localhost/api/roadmaps/${ID}/metadata`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/roadmaps/[id]/metadata", () => {
  it("derives without saving", async () => {
    const { updateRoadmapMetadata } = await import("@/lib/roadmaps/roadmaps");
    const { POST } = await import("./route");
    const res = await POST(req("POST", {}), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ title: "T", topics: ["Math"] });
    // Deriving is a preview. Nothing is stored until the owner saves.
    expect(updateRoadmapMetadata).not.toHaveBeenCalled();
  });

  it("sends the transcripts in course order, not storage order", async () => {
    const { listRoadmapVideos } = await import("@/lib/roadmaps/roadmaps");
    const { getTranscriptsByIds } = await import("@/lib/transcripts/store");
    const { deriveMetadata } = await import("@/lib/roadmaps/metadata");
    vi.mocked(listRoadmapVideos).mockResolvedValue([
      row("rv1", "opener", 0),
      row("rv2", "closer", 1),
      { ...row("rv3", "unfinished", 2), ingestStatus: "pending" },
    ] as never);
    // `getTranscriptsByIds` is an unordered `where video_id in (...)`, so the
    // rows arrive in Postgres scan order, NOT the order they were asked for.
    vi.mocked(getTranscriptsByIds).mockResolvedValue([doc("closer"), doc("opener")] as never);
    vi.mocked(deriveMetadata).mockResolvedValue({
      title: "T",
      description: "D",
      topics: [],
      videoSummaries: [],
    });

    const { POST } = await import("./route");
    expect((await POST(req("POST", {}), ctx())).status).toBe(200);

    // The prompt labels these "## Video 1, 2, 3", which asserts a running order
    // to a model being asked to describe a course — and in this product the
    // order of the videos IS the course. A video still ingesting has no
    // transcript yet and drops out rather than appearing as a gap.
    expect(vi.mocked(deriveMetadata).mock.calls[0][0]).toEqual({
      videos: [
        {
          title: "opener title",
          channel: "opener channel",
          segments: [{ start: 0, duration: 1, text: "opener" }],
        },
        {
          title: "closer title",
          channel: "closer channel",
          segments: [{ start: 0, duration: 1, text: "closer" }],
        },
      ],
    });
  });

  it("drops a transcript row that carries no segments, matching the index space", async () => {
    const { listRoadmapVideos } = await import("@/lib/roadmaps/roadmaps");
    const { getTranscriptsByIds } = await import("@/lib/transcripts/store");
    const { deriveMetadata } = await import("@/lib/roadmaps/metadata");
    vi.mocked(listRoadmapVideos).mockResolvedValue([
      row("rv1", "empty", 0),
      row("rv2", "real", 1),
    ] as never);
    // Reachable, not hypothetical: the provider maps an empty caption list
    // without complaint and ingest stores the result as ready, so "has a
    // transcript row" and "has something to read" are different sets.
    vi.mocked(getTranscriptsByIds).mockResolvedValue([
      { videoId: "empty", title: "empty title", channel: "empty channel", segments: [] },
      doc("real"),
    ] as never);
    vi.mocked(deriveMetadata).mockResolvedValue({
      title: "T",
      description: "D",
      topics: [],
      videoSummaries: [],
    });

    const { POST } = await import("./route");
    expect((await POST(req("POST", {}), ctx())).status).toBe(200);

    // deriveMetadata numbers `## Video N` from the segment-bearing subset, so
    // this list must already be that subset. If the empty row survived here,
    // "Video 1" would mean the real video while the caller mapping summaries
    // back by position would write it onto the empty one — every summary
    // shifted by one, silently, for the whole course.
    expect(vi.mocked(deriveMetadata).mock.calls[0][0].videos).toEqual([
      {
        title: "real title",
        channel: "real channel",
        segments: [{ start: 0, duration: 1, text: "real" }],
      },
    ]);
  });

  it("404s a malformed id before touching the database or the model", async () => {
    const { getRoadmap } = await import("@/lib/roadmaps/roadmaps");
    const { deriveMetadata } = await import("@/lib/roadmaps/metadata");
    const { POST } = await import("./route");
    expect((await POST(req("POST", {}), ctx("not-a-uuid"))).status).toBe(404);
    expect(getRoadmap).not.toHaveBeenCalled();
    expect(deriveMetadata).not.toHaveBeenCalled();
  });

  it("502s when the model fails, so the client can degrade", async () => {
    const { deriveMetadata } = await import("@/lib/roadmaps/metadata");
    vi.mocked(deriveMetadata).mockRejectedValue(new Error("rate limited"));
    const { POST } = await import("./route");
    const res = await POST(req("POST", {}), ctx());
    expect(res.status).toBe(502);
  });

  it("stores the video summaries but returns only the reviewable fields", async () => {
    const { deriveMetadata } = await import("@/lib/roadmaps/metadata");
    vi.mocked(deriveMetadata).mockResolvedValue({
      title: "T",
      description: "D",
      topics: ["Math"],
      videoSummaries: [{ index: 1, summary: "First video" }],
    });
    const { POST } = await import("./route");
    const res = await POST(req("POST", {}), ctx());
    const body = await res.json();
    // Summaries are agent-only — no human reviews them, so they save straight
    // away. Sending them to the client would only be noise it must ignore.
    expect(body).toEqual({ title: "T", description: "D", topics: ["Math"] });
  });

  // The half of the index mapping that lives here rather than in `derive.ts`:
  // that module is handed rows and trusts them, so this route is the only place
  // the pairing can be broken. Filtering the docs while keeping the full row
  // list would write "about B" onto the empty video and shift the whole course.
  it("hands the summary writer the same rows the model was shown", async () => {
    const { listRoadmapVideos } = await import("@/lib/roadmaps/roadmaps");
    const { getTranscriptsByIds } = await import("@/lib/transcripts/store");
    const { deriveMetadata } = await import("@/lib/roadmaps/metadata");
    const { storeVideoSummaries } = await import("@/lib/roadmaps/derive");
    vi.mocked(listRoadmapVideos).mockResolvedValue([
      row("rv1", "empty", 0),
      row("rv2", "real", 1),
    ] as never);
    vi.mocked(getTranscriptsByIds).mockResolvedValue([
      { videoId: "empty", title: "empty title", channel: "empty channel", segments: [] },
      doc("real"),
    ] as never);
    const videoSummaries = [{ index: 1, summary: "about the real one" }];
    vi.mocked(deriveMetadata).mockResolvedValue({
      title: "T",
      description: "D",
      topics: [],
      videoSummaries,
    });

    const { POST } = await import("./route");
    expect((await POST(req("POST", {}), ctx())).status).toBe(200);

    expect(storeVideoSummaries).toHaveBeenCalledWith(
      ID,
      [expect.objectContaining({ id: "rv2", videoId: "real" })],
      videoSummaries,
    );
  });
});

describe("PATCH /api/roadmaps/[id]/metadata", () => {
  it("saves a partial patch with normalized fields", async () => {
    const { updateRoadmapMetadata } = await import("@/lib/roadmaps/roadmaps");
    const { PATCH } = await import("./route");
    const res = await PATCH(
      req("PATCH", { title: "  Real title  ", topics: ["math", "nope"] }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(updateRoadmapMetadata).toHaveBeenCalledWith(ID, {
      title: "Real title",
      topics: ["Math"],
    });
  });

  it("400s an unusable title without saving anything", async () => {
    const { updateRoadmapMetadata } = await import("@/lib/roadmaps/roadmaps");
    const { PATCH } = await import("./route");
    const res = await PATCH(req("PATCH", { title: "   " }), ctx());
    expect(res.status).toBe(400);
    expect(updateRoadmapMetadata).not.toHaveBeenCalled();
  });

  // "" is a clear, not a missing field: the owner deleting the description must
  // write the empty value, so the check is `!== undefined` and never truthiness.
  it("saves an emptied description rather than ignoring it", async () => {
    const { updateRoadmapMetadata } = await import("@/lib/roadmaps/roadmaps");
    const { PATCH } = await import("./route");
    const res = await PATCH(req("PATCH", { description: "" }), ctx());
    expect(res.status).toBe(200);
    expect(updateRoadmapMetadata).toHaveBeenCalledWith(ID, { description: "" });
  });

  it("accepts a description as long as a derived one, and rejects longer", async () => {
    const { MAX_DESCRIPTION_LENGTH } = await import("@/lib/roadmaps/metadata");
    const { updateRoadmapMetadata } = await import("@/lib/roadmaps/roadmaps");
    const { PATCH } = await import("./route");
    // deriveMetadata clamps TO this length, so a value of exactly this length is
    // one the sheet can pre-fill — it must be saveable.
    const atLimit = "x".repeat(MAX_DESCRIPTION_LENGTH);
    expect((await PATCH(req("PATCH", { description: atLimit }), ctx())).status).toBe(200);
    // Measured after trimming, like the value that gets stored: a trailing space
    // is not a 301st character the owner can see and delete.
    expect((await PATCH(req("PATCH", { description: atLimit + "  " }), ctx())).status).toBe(200);
    expect(updateRoadmapMetadata).toHaveBeenLastCalledWith(ID, { description: atLimit });
    expect((await PATCH(req("PATCH", { description: atLimit + "x" }), ctx())).status).toBe(400);
    expect(updateRoadmapMetadata).toHaveBeenCalledTimes(2);
  });

  // normalizeTopics returns null ONLY for "not a list"; [] is a real, saveable
  // value. Collapsing the two would make clearing the topics impossible.
  it("saves an emptied topics list but rejects a non-list", async () => {
    const { updateRoadmapMetadata } = await import("@/lib/roadmaps/roadmaps");
    const { PATCH } = await import("./route");
    expect((await PATCH(req("PATCH", { topics: [] }), ctx())).status).toBe(200);
    expect(updateRoadmapMetadata).toHaveBeenCalledWith(ID, { topics: [] });
    expect((await PATCH(req("PATCH", { topics: "Math" }), ctx())).status).toBe(400);
    expect(updateRoadmapMetadata).toHaveBeenCalledTimes(1);
  });

  it("400s a body that is not an object, rather than throwing a 500", async () => {
    const { updateRoadmapMetadata } = await import("@/lib/roadmaps/roadmaps");
    const { PATCH } = await import("./route");
    expect((await PATCH(req("PATCH", null), ctx())).status).toBe(400);
    expect((await PATCH(req("PATCH", ["title"]), ctx())).status).toBe(400);
    expect(updateRoadmapMetadata).not.toHaveBeenCalled();
  });

  it("404s a malformed id before touching the database", async () => {
    const { getRoadmap } = await import("@/lib/roadmaps/roadmaps");
    const { PATCH } = await import("./route");
    expect((await PATCH(req("PATCH", { description: "x" }), ctx("not-a-uuid"))).status).toBe(404);
    expect(getRoadmap).not.toHaveBeenCalled();
  });
});
