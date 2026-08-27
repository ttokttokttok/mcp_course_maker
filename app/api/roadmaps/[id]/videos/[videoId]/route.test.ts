import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/roadmaps/roadmaps", () => ({
  getRoadmap: vi.fn(async () => ({ id: "r1", title: "T" })),
  removeVideoFromRoadmap: vi.fn(async () => true),
}));

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const VIDEO = "aaaaaaaaaaa";
const ctx = (id = ID) => ({ params: Promise.resolve({ id, videoId: VIDEO }) });
const del = () =>
  new NextRequest(`http://localhost/api/roadmaps/${ID}/videos/${VIDEO}`, { method: "DELETE" });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("DELETE /api/roadmaps/[id]/videos/[videoId]", () => {
  it("unlinks a video", async () => {
    const { removeVideoFromRoadmap } = await import("@/lib/roadmaps/roadmaps");
    const { DELETE } = await import("./route");
    expect((await DELETE(del(), ctx())).status).toBe(200);
    expect(removeVideoFromRoadmap).toHaveBeenCalledWith(ID, VIDEO);
  });

  it("404s a malformed id before it can reach the uuid column", async () => {
    const { getRoadmap } = await import("@/lib/roadmaps/roadmaps");
    const { DELETE } = await import("./route");
    expect((await DELETE(del(), ctx("not-a-uuid"))).status).toBe(404);
    expect(getRoadmap).not.toHaveBeenCalled();
  });

  it("404s a video the course does not have", async () => {
    const { removeVideoFromRoadmap } = await import("@/lib/roadmaps/roadmaps");
    vi.mocked(removeVideoFromRoadmap).mockResolvedValue(false);
    const { DELETE } = await import("./route");
    expect((await DELETE(del(), ctx())).status).toBe(404);
  });
});
