import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/roadmaps/roadmaps", () => ({
  getRoadmap: vi.fn(async () => ({ id: "r1", title: "T" })),
  requeueVideo: vi.fn(async () => "queued" as const),
}));

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ctx = (id = ID, videoId = "E-y06mAXCRc") => ({ params: Promise.resolve({ id, videoId }) });
const req = () =>
  new NextRequest(`http://localhost/api/roadmaps/${ID}/videos/x/retry`, { method: "POST" });

beforeEach(() => vi.resetAllMocks());

describe("POST /api/roadmaps/[id]/videos/[videoId]/retry", () => {
  it("requeues the video", async () => {
    const { requeueVideo } = await import("@/lib/roadmaps/roadmaps");
    vi.mocked(requeueVideo).mockResolvedValue("queued");
    const { POST } = await import("./route");
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    expect(requeueVideo).toHaveBeenCalledWith(ID, "E-y06mAXCRc");
  });

  // 404 not 403, per the standing rule: a non-owner must not learn that a
  // private course exists. Matches the metadata route.
  it("404s a malformed id before touching the database", async () => {
    const { getRoadmap } = await import("@/lib/roadmaps/roadmaps");
    const { POST } = await import("./route");
    expect((await POST(req(), ctx("not-a-uuid"))).status).toBe(404);
    expect(getRoadmap).not.toHaveBeenCalled();
  });

  it("404s a video that is not in this course", async () => {
    const { requeueVideo } = await import("@/lib/roadmaps/roadmaps");
    vi.mocked(requeueVideo).mockResolvedValue("not-in-course");
    const { POST } = await import("./route");
    expect((await POST(req(), ctx())).status).toBe(404);
  });

  // Distinct from the 404 on purpose. Retrying something already running is not
  // the same answer as "that video is not here", and an owner who gets the
  // latter for the former goes looking for a course that is fine.
  it("409s a video whose ingestion is already running", async () => {
    const { requeueVideo } = await import("@/lib/roadmaps/roadmaps");
    vi.mocked(requeueVideo).mockResolvedValue("already-pending");
    const { POST } = await import("./route");
    expect((await POST(req(), ctx())).status).toBe(409);
  });
});
