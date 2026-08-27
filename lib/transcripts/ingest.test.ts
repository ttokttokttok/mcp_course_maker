import { it, expect, vi } from "vitest";
import type { TranscriptProvider } from "./provider";
import type { VideoMetaProvider } from "./meta";
import type { TranscriptDoc } from "@/lib/engine/types";

const doc = (id: string): TranscriptDoc => ({
  videoId: id,
  title: "t",
  channel: "c",
  source: "captions",
  language: "en",
  fetchedAt: "2026-01-01T00:00:00.000Z",
  segments: [{ start: 0, duration: 1, text: "x" }],
});

vi.mock("./store", () => {
  const cache = new Map<string, TranscriptDoc>();
  return {
    getTranscript: vi.fn(async (id: string) => cache.get(id) ?? null),
    putTranscript: vi.fn(async (d: TranscriptDoc) => {
      cache.set(d.videoId, d);
    }),
    getTranscriptsByIds: vi.fn(),
  };
});

it("fetches + caches on miss, then skips provider on hit", async () => {
  const { ingestVideo } = await import("./ingest");
  const provider: TranscriptProvider = { fetchTranscript: vi.fn(async (id) => doc(id)) };
  expect(await ingestVideo("aaaaaaaaaaa", provider)).toEqual({ status: "ready" });
  expect(provider.fetchTranscript).toHaveBeenCalledTimes(1);
  expect(await ingestVideo("aaaaaaaaaaa", provider)).toEqual({ status: "ready" });
  expect(provider.fetchTranscript).toHaveBeenCalledTimes(1); // cache hit → not called again
});

it("returns failed when the provider throws", async () => {
  const { ingestVideo } = await import("./ingest");
  const provider: TranscriptProvider = {
    fetchTranscript: vi.fn(async () => {
      throw new Error("blocked");
    }),
  };
  expect(await ingestVideo("zzzzzzzzzzz", provider)).toEqual({
    status: "failed",
    reason: "blocked",
  });
});

it("enriches the title on a cache miss", async () => {
  const { ingestVideo } = await import("./ingest");
  const { getTranscript } = await import("./store");
  const provider: TranscriptProvider = {
    fetchTranscript: vi.fn(async (id) => ({ ...doc(id), title: id, channel: "" })),
  };
  const meta: VideoMetaProvider = {
    fetchMeta: vi.fn(async () => ({ title: "Real Title", channel: "Real Channel" })),
  };

  expect(await ingestVideo("bbbbbbbbbbb", provider, meta)).toEqual({ status: "ready" });
  const stored = await getTranscript("bbbbbbbbbbb");
  expect(stored?.title).toBe("Real Title");
  expect(stored?.channel).toBe("Real Channel");
});

it("enriches a cached doc whose title is still the videoId", async () => {
  const { ingestVideo } = await import("./ingest");
  const { getTranscript } = await import("./store");
  const provider: TranscriptProvider = {
    fetchTranscript: vi.fn(async (id) => ({ ...doc(id), title: id, channel: "" })),
  };
  const meta: VideoMetaProvider = {
    fetchMeta: vi.fn(async () => ({ title: "Enriched", channel: "Chan" })),
  };

  // First pass with no meta provider: stored carrying the placeholder title.
  expect(await ingestVideo("ccccccccccc", provider)).toEqual({ status: "ready" });
  // Second pass: cache hit, but the title is still a placeholder → enrich it.
  expect(await ingestVideo("ccccccccccc", provider, meta)).toEqual({ status: "ready" });

  expect(provider.fetchTranscript).toHaveBeenCalledTimes(1); // no refetch on hit
  expect(meta.fetchMeta).toHaveBeenCalledTimes(1);
  expect((await getTranscript("ccccccccccc"))?.title).toBe("Enriched");
});

it("makes no metadata call when the title is already real", async () => {
  const { ingestVideo } = await import("./ingest");
  const provider: TranscriptProvider = { fetchTranscript: vi.fn(async (id) => doc(id)) };
  const meta: VideoMetaProvider = {
    fetchMeta: vi.fn(async () => ({ title: "x", channel: "y" })),
  };

  expect(await ingestVideo("ddddddddddd", provider, meta)).toEqual({ status: "ready" }); // miss
  expect(await ingestVideo("ddddddddddd", provider, meta)).toEqual({ status: "ready" }); // hit
  expect(meta.fetchMeta).not.toHaveBeenCalled();
});

it("stays ready and still stores the transcript when metadata fails", async () => {
  const { ingestVideo } = await import("./ingest");
  const { getTranscript } = await import("./store");
  const provider: TranscriptProvider = {
    fetchTranscript: vi.fn(async (id) => ({ ...doc(id), title: id, channel: "" })),
  };

  const throwing: VideoMetaProvider = {
    fetchMeta: vi.fn(async () => {
      throw new Error("oembed down");
    }),
  };
  expect(await ingestVideo("eeeeeeeeeee", provider, throwing)).toEqual({ status: "ready" });
  expect((await getTranscript("eeeeeeeeeee"))?.title).toBe("eeeeeeeeeee");

  const nulling: VideoMetaProvider = { fetchMeta: vi.fn(async () => null) };
  expect(await ingestVideo("fffffffffff", provider, nulling)).toEqual({ status: "ready" });
  expect((await getTranscript("fffffffffff"))?.title).toBe("fffffffffff");
});

it("reports the vendor's reason rather than swallowing it", async () => {
  const { ingestVideo } = await import("./ingest");
  const { TranscriptFetchError } = await import("./errors");
  const provider: TranscriptProvider = {
    fetchTranscript: async () =>
      Promise.reject(
        new TranscriptFetchError("ggggggggggg", 429, "limit-exceeded", "rate limited"),
      ),
  };
  const result = await ingestVideo("ggggggggggg", provider);
  // The reason is the whole point: this diagnosis previously cost an hour
  // because the error was collapsed into the string "failed".
  expect(result).toEqual({ status: "failed", reason: "rate limited" });
});

// A doc read back from JSONB is cast, not validated. `needsTitle` did
// `doc.title.trim()` on it, so a stored row with no title threw — and the catch
// below turned a working cache hit into a permanently failed video.
it("treats a cached doc with no title as needing one, rather than failing", async () => {
  const { ingestVideo } = await import("./ingest");
  const { putTranscript } = await import("./store");
  await putTranscript({ videoId: "hhhhhhhhhhh", segments: [] } as never);
  const provider: TranscriptProvider = {
    fetchTranscript: async () => {
      throw new Error("must not be called");
    },
  };
  const meta: VideoMetaProvider = {
    fetchMeta: async () => ({ title: "Real Title", channel: "Ch" }),
  };
  expect(await ingestVideo("hhhhhhhhhhh", provider, meta)).toEqual({ status: "ready" });
});
