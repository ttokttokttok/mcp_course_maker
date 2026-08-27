import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/roadmaps/roadmaps", () => ({
  getRoadmap: vi.fn(async () => ({ id: "r1", title: "T" })),
  reorderRoadmapVideos: vi.fn(async () => {}),
}));

// A real UUID: `roadmaps.id` is a uuid column and the route shape-checks the
// path segment, so a toy id would exercise the malformed path instead of the
// authorization path these tests are about.
const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const patch = () =>
  new NextRequest(`http://localhost/api/roadmaps/${ID}/reorder`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderedVideoIds: ["a", "b"] }),
  });
const ctx = { params: Promise.resolve({ id: ID }) };

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: mockClear leaves `mockResolvedValue`
  // implementations installed, so a pin from one test would silently satisfy the
  // next. mockReset restores the implementation passed to `vi.fn(impl)` above, so
  // every test starts from the declared module-scope baseline.
  vi.resetAllMocks();
});

describe("PATCH /api/roadmaps/[id]/reorder", () => {
  it("reorders the videos", async () => {
    const { PATCH } = await import("./route");
    expect((await PATCH(patch(), ctx)).status).toBe(200);
  });

  it("404s a malformed id before it can reach the uuid column", async () => {
    const { getRoadmap } = await import("@/lib/roadmaps/roadmaps");
    const { PATCH } = await import("./route");
    const bad = { params: Promise.resolve({ id: "r1" }) };
    expect((await PATCH(patch(), bad)).status).toBe(404);
    expect(getRoadmap).not.toHaveBeenCalled();
  });
});
