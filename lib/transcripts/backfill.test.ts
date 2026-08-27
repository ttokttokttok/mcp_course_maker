import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TranscriptDoc } from "@/lib/engine/types";
import type { VideoMetaProvider } from "./meta";

const doc = (id: string, title: string): TranscriptDoc => ({
  videoId: id,
  title,
  channel: "",
  source: "captions",
  language: "en",
  fetchedAt: "2026-01-01T00:00:00.000Z",
  segments: [{ start: 0, duration: 1, text: "x" }],
});

vi.mock("./store", () => ({
  listPlaceholderTranscripts: vi.fn(async () => [] as TranscriptDoc[]),
  putTranscript: vi.fn(async () => {}),
  getTranscript: vi.fn(),
  getTranscriptsByIds: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("backfillTitles", () => {
  it("enriches placeholder rows and reports accurate counts", async () => {
    const { backfillTitles } = await import("./backfill");
    const store = await import("./store");
    vi.mocked(store.listPlaceholderTranscripts).mockResolvedValue([
      doc("aaaaaaaaaaa", "aaaaaaaaaaa"),
      doc("bbbbbbbbbbb", ""),
    ]);
    const metaProvider: VideoMetaProvider = {
      fetchMeta: vi.fn(async (id) => ({ title: `Title ${id}`, channel: "Chan" })),
    };

    expect(await backfillTitles({ metaProvider })).toEqual({
      scanned: 2,
      updated: 2,
      skipped: 0,
    });
    expect(store.putTranscript).toHaveBeenCalledTimes(2);
    expect(vi.mocked(store.putTranscript).mock.calls[0][0]).toMatchObject({
      videoId: "aaaaaaaaaaa",
      title: "Title aaaaaaaaaaa",
      channel: "Chan",
      segments: [{ start: 0, duration: 1, text: "x" }], // rest of the doc preserved
    });
  });

  it("skips a row whose title is already real, even if SQL returned it", async () => {
    const { backfillTitles } = await import("./backfill");
    const store = await import("./store");
    vi.mocked(store.listPlaceholderTranscripts).mockResolvedValue([
      doc("ccccccccccc", "A Real Title"),
    ]);
    const metaProvider: VideoMetaProvider = { fetchMeta: vi.fn(async () => null) };

    expect(await backfillTitles({ metaProvider })).toEqual({
      scanned: 0,
      updated: 0,
      skipped: 0,
    });
    expect(metaProvider.fetchMeta).not.toHaveBeenCalled();
    expect(store.putTranscript).not.toHaveBeenCalled();
  });

  it("counts unavailable metadata as skipped and writes nothing", async () => {
    const { backfillTitles } = await import("./backfill");
    const store = await import("./store");
    vi.mocked(store.listPlaceholderTranscripts).mockResolvedValue([
      doc("ddddddddddd", "ddddddddddd"),
    ]);
    const metaProvider: VideoMetaProvider = { fetchMeta: vi.fn(async () => null) };

    expect(await backfillTitles({ metaProvider })).toEqual({
      scanned: 1,
      updated: 0,
      skipped: 1,
    });
    expect(store.putTranscript).not.toHaveBeenCalled();
  });

  it("keeps sweeping when one video throws", async () => {
    const { backfillTitles } = await import("./backfill");
    const store = await import("./store");
    vi.mocked(store.listPlaceholderTranscripts).mockResolvedValue([
      doc("eeeeeeeeeee", "eeeeeeeeeee"),
      doc("fffffffffff", "fffffffffff"),
    ]);
    const metaProvider: VideoMetaProvider = {
      fetchMeta: vi.fn(async (id) => {
        if (id === "eeeeeeeeeee") throw new Error("boom");
        return { title: "Survivor", channel: "Chan" };
      }),
    };

    expect(await backfillTitles({ metaProvider })).toEqual({
      scanned: 2,
      updated: 1,
      skipped: 1,
    });
    expect(vi.mocked(store.putTranscript).mock.calls[0][0]).toMatchObject({
      videoId: "fffffffffff",
      title: "Survivor",
    });
  });
});
