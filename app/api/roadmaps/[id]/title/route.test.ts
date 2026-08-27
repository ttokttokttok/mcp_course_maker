import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { MAX_TITLE_LENGTH } from "@/lib/roadmaps/title";

vi.mock("@/lib/roadmaps/roadmaps", () => ({
  getRoadmap: vi.fn(async () => ({ id: "r1", title: "T" })),
  renameRoadmap: vi.fn(async () => {}),
}));

// A real UUID: `roadmaps.id` is a uuid column and the route shape-checks the
// path segment, so a toy id would exercise the malformed path instead.
const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

const patch = (title: unknown) =>
  new NextRequest(`http://localhost/api/roadmaps/${ID}/title`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("PATCH /api/roadmaps/[id]/title", () => {
  it("renames the course, storing the trimmed title", async () => {
    const { renameRoadmap } = await import("@/lib/roadmaps/roadmaps");
    const { PATCH } = await import("./route");
    const res = await PATCH(patch("  RL from scratch  "), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ title: "RL from scratch" });
    expect(renameRoadmap).toHaveBeenCalledWith(ID, "RL from scratch");
  });

  it("404s a malformed id before it can reach the uuid column", async () => {
    const { getRoadmap } = await import("@/lib/roadmaps/roadmaps");
    const { PATCH } = await import("./route");
    expect((await PATCH(patch("fine"), ctx("r1"))).status).toBe(404);
    expect(getRoadmap).not.toHaveBeenCalled();
  });

  it("404s a course that does not exist", async () => {
    const { getRoadmap } = await import("@/lib/roadmaps/roadmaps");
    vi.mocked(getRoadmap).mockResolvedValue(null as never);
    const { PATCH } = await import("./route");
    expect((await PATCH(patch("fine"), ctx())).status).toBe(404);
  });

  it("400s a blank, oversized, or non-string title", async () => {
    const { renameRoadmap } = await import("@/lib/roadmaps/roadmaps");
    const { PATCH } = await import("./route");
    expect((await PATCH(patch("   "), ctx())).status).toBe(400);
    expect((await PATCH(patch(""), ctx())).status).toBe(400);
    expect((await PATCH(patch(7), ctx())).status).toBe(400);
    expect((await PATCH(patch(undefined), ctx())).status).toBe(400);
    expect((await PATCH(patch("x".repeat(MAX_TITLE_LENGTH + 1)), ctx())).status).toBe(400);
    expect(renameRoadmap).not.toHaveBeenCalled();
  });
});
