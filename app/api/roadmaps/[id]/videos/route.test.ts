import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/roadmaps/roadmaps", () => ({
  getRoadmap: vi.fn(async () => ({ id: "r1", title: "T" })),
  listRoadmapVideos: vi.fn(async () => [
    { videoId: "aaaaaaaaaaa", position: 0, ingestStatus: "ready" },
  ]),
  addVideosToRoadmap: vi.fn(async () => ({ added: ["bbbbbbbbbbb"], skipped: [] })),
}));

vi.mock("@/lib/transcripts/store", () => ({
  getTranscriptsByIds: vi.fn(async () => [{ videoId: "aaaaaaaaaaa", title: "First" }]),
}));

// A real UUID: `roadmaps.id` is a uuid column and the route shape-checks the
// path segment, so a toy id like "r1" would exercise the malformed path instead
// of the one under test.
const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

const post = (body: unknown = { urls: ["https://youtu.be/bbbbbbbbbbb"] }) =>
  new NextRequest(`http://localhost/api/roadmaps/${ID}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const get = () => new NextRequest(`http://localhost/api/roadmaps/${ID}/videos`);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/roadmaps/[id]/videos", () => {
  it("adds videos, and returns the refreshed list", async () => {
    const { POST } = await import("./route");
    const res = await POST(post(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.added).toEqual(["bbbbbbbbbbb"]);
    expect(body.videos[0]).toMatchObject({ videoId: "aaaaaaaaaaa", title: "First" });
  });

  it("404s a malformed id before it can reach the uuid column", async () => {
    const { getRoadmap } = await import("@/lib/roadmaps/roadmaps");
    const { POST } = await import("./route");
    expect((await POST(post(), ctx("not-a-uuid"))).status).toBe(404);
    expect(getRoadmap).not.toHaveBeenCalled();
  });

  it("404s a course that does not exist", async () => {
    const { getRoadmap } = await import("@/lib/roadmaps/roadmaps");
    vi.mocked(getRoadmap).mockResolvedValue(null as never);
    const { POST } = await import("./route");
    expect((await POST(post(), ctx())).status).toBe(404);
  });

  it("400s a missing or malformed urls[]", async () => {
    const { POST } = await import("./route");
    expect((await POST(post({}), ctx())).status).toBe(400);
    expect((await POST(post({ urls: [] }), ctx())).status).toBe(400);
    expect((await POST(post({ urls: [7] }), ctx())).status).toBe(400);
  });

  it("400s when nothing in urls[] parses as a video", async () => {
    const { addVideosToRoadmap } = await import("@/lib/roadmaps/roadmaps");
    vi.mocked(addVideosToRoadmap).mockResolvedValue({ added: [], skipped: [] });
    const { POST } = await import("./route");
    expect((await POST(post({ urls: ["not a link"] }), ctx())).status).toBe(400);
  });

  it("reports a duplicate as skipped rather than failing", async () => {
    const { addVideosToRoadmap } = await import("@/lib/roadmaps/roadmaps");
    vi.mocked(addVideosToRoadmap).mockResolvedValue({ added: [], skipped: ["aaaaaaaaaaa"] });
    const { POST } = await import("./route");
    const res = await POST(post(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ added: [], skipped: ["aaaaaaaaaaa"] });
  });
});

describe("GET /api/roadmaps/[id]/videos", () => {
  it("serves the video list", async () => {
    const { GET } = await import("./route");
    expect((await GET(get(), ctx())).status).toBe(200);
  });

  it("404s a malformed id", async () => {
    const { getRoadmap } = await import("@/lib/roadmaps/roadmaps");
    const { GET } = await import("./route");
    expect((await GET(get(), ctx("not-a-uuid"))).status).toBe(404);
    expect(getRoadmap).not.toHaveBeenCalled();
  });
});
