import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/roadmaps/roadmaps", () => ({
  createRoadmap: vi.fn(async () => ({ id: "r1", videos: ["v1"] })),
}));

const post = () =>
  new NextRequest("http://localhost/api/roadmaps", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "T", urls: ["https://youtu.be/VMj-3S1tku0"] }),
  });

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: mockClear leaves `mockResolvedValue`
  // implementations installed, so a pin from one test would silently satisfy the
  // next. mockReset restores the implementation passed to `vi.fn(impl)` above, so
  // every test starts from the declared module-scope baseline.
  vi.resetAllMocks();
});

// Not at the end of the test that stubs `fetch`: a failing assertion above it
// would skip the cleanup and leak the stub into every test that follows.
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/roadmaps", () => {
  it("creates a course", async () => {
    const { POST } = await import("./route");
    expect((await POST(post())).status).toBe(201);
  });
});

describe("POST /api/roadmaps without a title", () => {
  // A course is not named until someone names it. Storing "" — rather than
  // inventing a placeholder — is what lets derivation's "fill the title only if
  // nobody has written one" rule ever fire.
  it("creates with an empty title", async () => {
    const { createRoadmap } = await import("@/lib/roadmaps/roadmaps");
    // The file mocks an anonymous owner; creation requires an account.
    vi.mocked(createRoadmap).mockResolvedValue({ id: "rm1", videos: ["VMj-3S1tku0"] } as never);

    const { POST } = await import("./route");
    const res = await POST(
      new NextRequest("http://localhost/api/roadmaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: ["https://youtu.be/VMj-3S1tku0"] }),
      }),
    );

    expect(res.status).toBe(201);
    expect(createRoadmap).toHaveBeenCalledWith(expect.objectContaining({ title: "" }));
  });

  // Creation performs NO network call. A title lookup at create time was the
  // original design and is deliberately gone: it produced a non-blank title,
  // which made the publish sheet unable to ever fill one in.
  it("makes no network call while creating", async () => {
    const { createRoadmap } = await import("@/lib/roadmaps/roadmaps");
    vi.mocked(createRoadmap).mockResolvedValue({ id: "rm1", videos: ["VMj-3S1tku0"] } as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    await POST(
      new NextRequest("http://localhost/api/roadmaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: ["https://youtu.be/VMj-3S1tku0"] }),
      }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // An empty title is legal to CREATE and illegal to RENAME to. A title that is
  // supplied must still be usable — only its absence is meaningful.
  it("still rejects a supplied title that is unusable", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new NextRequest("http://localhost/api/roadmaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "   ", urls: ["https://youtu.be/VMj-3S1tku0"] }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("accepts a supplied title unchanged", async () => {
    const { createRoadmap } = await import("@/lib/roadmaps/roadmaps");
    vi.mocked(createRoadmap).mockResolvedValue({ id: "rm1", videos: ["VMj-3S1tku0"] } as never);

    const { POST } = await import("./route");
    const res = await POST(
      new NextRequest("http://localhost/api/roadmaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "  RL from scratch  ",
          urls: ["https://youtu.be/VMj-3S1tku0"],
        }),
      }),
    );
    expect(res.status).toBe(201);
    expect(createRoadmap).toHaveBeenCalledWith(
      expect.objectContaining({ title: "RL from scratch" }),
    );
  });
});
