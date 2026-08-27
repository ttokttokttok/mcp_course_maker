import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FallbackTranscriptProvider, createTranscriptProvider } from "./provider";
import { YtDlpTranscriptProvider } from "./ytdlp";
import type { TranscriptDoc } from "@/lib/engine/types";

const doc = { videoId: "v", title: "T" } as TranscriptDoc;
const ok = { fetchTranscript: vi.fn(async () => doc) };
const fails = (message: string) => ({
  fetchTranscript: vi.fn(async () => {
    throw new Error(message);
  }),
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe("FallbackTranscriptProvider", () => {
  it("never reaches the fallback when the primary succeeds", async () => {
    const second = ok;
    const doc2 = await new FallbackTranscriptProvider(ok, second).fetchTranscript("v");
    expect(doc2).toBe(doc);
    expect(second.fetchTranscript).toHaveBeenCalledTimes(1); // `ok` is the same object
  });

  it("uses the fallback when the primary fails", async () => {
    const primary = fails("yt-dlp is not installed");
    expect(await new FallbackTranscriptProvider(primary, ok).fetchTranscript("v")).toBe(doc);
  });

  it("reports the PRIMARY's failure when both fail, and logs the other", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = new FallbackTranscriptProvider(
      fails("yt-dlp is not installed"),
      fails("SUPADATA_API_KEY not set"),
    );
    // The first is the one worth reading: the fallback only ran because the
    // primary could not do it, so the vendor's complaint is downstream noise.
    await expect(provider.fetchTranscript("v")).rejects.toThrow("yt-dlp is not installed");
    expect(errors).toHaveBeenCalledWith(
      "transcript fallback also failed",
      expect.objectContaining({ videoId: "v" }),
    );
    errors.mockRestore();
  });
});

describe("createTranscriptProvider", () => {
  it("is yt-dlp alone when no vendor key is set — a fresh clone configures nothing", () => {
    vi.stubEnv("SUPADATA_API_KEY", "");
    expect(createTranscriptProvider()).toBeInstanceOf(YtDlpTranscriptProvider);
  });

  it("adds the hosted vendor as a second attempt once a key is set", () => {
    vi.stubEnv("SUPADATA_API_KEY", "sk-test");
    expect(createTranscriptProvider()).toBeInstanceOf(FallbackTranscriptProvider);
  });
});
