import { it, expect, vi, beforeEach, type Mock } from "vitest";

// `kickOffIngestion` is private and fire-and-forget, so it is exercised through
// `createRoadmap` with both the database and ingestion faked. The status write
// is the ONLY statement in its loop that can throw — `ingestVideo` converts its
// own failures into a returned reason — so the fake db is where the failure
// gets injected. A real SQLite database cannot be made to refuse one specific
// write, which is why this file mocks where the others do not.
const state = vi.hoisted(() => ({
  updateAttempts: [] as { ingestStatus: string }[],
  /** 1-based indices of the status writes that should reject. */
  failOnAttempts: [] as number[],
}));

vi.mock("@/db", () => ({
  newId: () => "rm1",
  now: () => "2026-01-01T00:00:00.000Z",
  toDate: () => new Date(0),
  db: {
    // Every statement the ingestion loop reaches is an `UPDATE ... SET
    // ingest_status`, so the fake only has to recognise that one and record it.
    // `requeueVideo` needs a `changes` of 1 back from its guarded update, or it
    // takes the refusal branch and never starts an ingestion at all.
    prepare: (sql: string) => ({
      run: (...args: unknown[]) => {
        if (!sql.includes("ingest_status")) return { changes: 1 };
        if (sql.includes("'pending'")) return { changes: 1 }; // requeue's guarded write
        state.updateAttempts.push({ ingestStatus: args[0] as string });
        if (state.failOnAttempts.includes(state.updateAttempts.length)) {
          throw new Error("connection reset by peer");
        }
        return { changes: 1 };
      },
      get: () => undefined,
      all: () => [],
    }),
    // better-sqlite3 returns a callable; `createRoadmap` invokes it immediately.
    transaction: (fn: () => void) => () => fn(),
  },
}));

vi.mock("@/lib/transcripts/ingest", () => ({
  ingestVideo: vi.fn(async () => ({ status: "ready" })),
}));

// Mocked because the real one runs against the fake `db` above, whose `get`
// answers nothing, and swallows its own failure into the `console.error` spy
// every test here already silences. Unmocked, deleting the call at the end of
// the ingestion loop changed nothing anybody could observe.
vi.mock("@/lib/roadmaps/derive", () => ({ deriveAndStore: vi.fn(async () => {}) }));

// Ingestion is fire-and-forget: `createRoadmap` returns before the loop runs.
// Every fake here resolves immediately, so yielding to the macrotask queue once
// is enough to drain the whole chain of microtasks behind it.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  const { ingestVideo } = await import("@/lib/transcripts/ingest");
  const { deriveAndStore } = await import("@/lib/roadmaps/derive");
  (ingestVideo as Mock).mockClear();
  (deriveAndStore as Mock).mockClear();
  state.updateAttempts = [];
  state.failOnAttempts = [];
});

it("keeps ingesting after a status write throws, rather than stranding the rest", async () => {
  const { createRoadmap } = await import("./roadmaps");
  const { ingestVideo } = await import("@/lib/transcripts/ingest");
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  state.failOnAttempts = [1]; // the FIRST video's status write dies

  await createRoadmap({ title: "t", urls: ["aaaaaaaaaaa", "bbbbbbbbbbb"] });
  await settle();

  // The second video is the whole point. With an unguarded loop the throw from
  // video one's write aborted the iteration, and video two was never ingested
  // and never left "pending" — a permanent non-terminal state with nobody told
  // why, which is precisely what this change exists to eliminate.
  expect((ingestVideo as Mock).mock.calls.map((c) => c[0])).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb"]);
  // Three writes: video one's failed attempt, its "failed" fallback, then video two.
  expect(state.updateAttempts).toEqual([
    { ingestStatus: "ready" },
    { ingestStatus: "failed" },
    { ingestStatus: "ready" },
  ]);

  // A caught error here means the status could not be RECORDED, not that the
  // transcript could not be fetched — so it carries its own message, while
  // keeping the { roadmapId, videoId } shape that makes the two greppable together.
  expect(errors).toHaveBeenCalledWith(
    "ingest status write failed",
    expect.objectContaining({ roadmapId: "rm1", videoId: "aaaaaaaaaaa" }),
  );
  errors.mockRestore();
});

it("logs the vendor's reason and still records the failed status", async () => {
  const { createRoadmap } = await import("./roadmaps");
  const { ingestVideo } = await import("@/lib/transcripts/ingest");
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  (ingestVideo as Mock).mockResolvedValueOnce({ status: "failed", reason: "rate limited" });

  await createRoadmap({ title: "t", urls: ["aaaaaaaaaaa"] });
  await settle();

  expect(errors).toHaveBeenCalledWith("ingest failed", {
    roadmapId: "rm1",
    videoId: "aaaaaaaaaaa",
    reason: "rate limited",
  });
  // Still written down: a failure the user can see beats a silent "pending".
  expect(state.updateAttempts).toEqual([{ ingestStatus: "failed" }]);
  errors.mockRestore();
});

// `pending` is the schema default, so a row stranded there is indistinguishable
// from one never attempted: the retry control is gated on "failed", and the
// studio's poll is gated on "pending". Landing on "failed" is what keeps the
// video reachable by a user, even though the transcript may well be stored.
it("falls back to a terminal failed status when the write throws", async () => {
  const { createRoadmap } = await import("./roadmaps");
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  state.failOnAttempts = [1];

  await createRoadmap({ title: "t", urls: ["aaaaaaaaaaa"] });
  await settle();

  expect(state.updateAttempts).toEqual([{ ingestStatus: "ready" }, { ingestStatus: "failed" }]);
  errors.mockRestore();
});

// "Derive at creation" is the headline of the branch, and the whole of it is one
// call at the bottom of the loop. Ordering is asserted, not just the call: moved
// inside the loop it would describe a course whose later videos have no
// transcript yet, and derivation is guarded on `metadata_derived_at` so that
// first wrong answer is the one that sticks.
it("derives the course once, after every video has settled", async () => {
  const { createRoadmap } = await import("./roadmaps");
  const { deriveAndStore } = await import("@/lib/roadmaps/derive");
  const { ingestVideo } = await import("@/lib/transcripts/ingest");

  await createRoadmap({ title: "t", urls: ["aaaaaaaaaaa", "bbbbbbbbbbb"] });
  await settle();

  expect(deriveAndStore).toHaveBeenCalledTimes(1);
  expect(deriveAndStore).toHaveBeenCalledWith("rm1");
  expect((deriveAndStore as Mock).mock.invocationCallOrder[0]).toBeGreaterThan(
    (ingestVideo as Mock).mock.invocationCallOrder[1],
  );
});

// The retry path re-derives for a reason the creation path cannot cover: a
// course whose only usable transcript arrives via a retry has never been derived
// at all, so without this it keeps its fallback name forever.
it("derives again after a retry, once that video has settled", async () => {
  const { requeueVideo } = await import("./roadmaps");
  const { deriveAndStore } = await import("@/lib/roadmaps/derive");
  const { ingestVideo } = await import("@/lib/transcripts/ingest");

  expect(await requeueVideo("rm1", "aaaaaaaaaaa")).toBe("queued");
  await settle();

  expect(deriveAndStore).toHaveBeenCalledTimes(1);
  expect(deriveAndStore).toHaveBeenCalledWith("rm1");
  expect((deriveAndStore as Mock).mock.invocationCallOrder[0]).toBeGreaterThan(
    (ingestVideo as Mock).mock.invocationCallOrder[0],
  );
});

it("gives up quietly when even the fallback write throws, and moves on", async () => {
  const { createRoadmap } = await import("./roadmaps");
  const { ingestVideo } = await import("@/lib/transcripts/ingest");
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  state.failOnAttempts = [1, 2]; // the real write AND its fallback both die

  await createRoadmap({ title: "t", urls: ["aaaaaaaaaaa", "bbbbbbbbbbb"] });
  await settle();

  // Both writes for video one were attempted, and the unhandled rejection the
  // fallback would otherwise raise does not escape the loop or cost video two.
  expect(state.updateAttempts).toEqual([
    { ingestStatus: "ready" },
    { ingestStatus: "failed" },
    { ingestStatus: "ready" },
  ]);
  expect((ingestVideo as Mock).mock.calls.map((c) => c[0])).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb"]);
  errors.mockRestore();
});
