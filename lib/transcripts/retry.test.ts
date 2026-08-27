import { describe, it, expect, vi } from "vitest";
import { RetryingTranscriptProvider } from "./retry";
import { TranscriptFetchError } from "./errors";
import type { TranscriptProvider } from "./provider";
import type { TranscriptDoc } from "@/lib/engine/types";

const doc = (videoId: string): TranscriptDoc => ({
  videoId,
  title: videoId,
  channel: "",
  source: "captions",
  language: "en",
  fetchedAt: "2026-07-30T00:00:00.000Z",
  segments: [{ start: 0, duration: 1, text: "hello" }],
});

const rateLimited = (videoId: string) =>
  new TranscriptFetchError(videoId, 429, "limit-exceeded", "rate limited");

/** A provider that replays a scripted sequence of outcomes, one per call. */
function scripted(outcomes: (TranscriptDoc | Error)[]): TranscriptProvider & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async fetchTranscript() {
      const outcome = outcomes[calls++];
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  } as TranscriptProvider & { calls: number };
}

/** Records what we WOULD have waited, so the suite never actually waits. */
function recordingSleep() {
  const slept: number[] = [];
  return { slept, sleep: async (ms: number) => void slept.push(ms) };
}

describe("RetryingTranscriptProvider", () => {
  it("returns the first success without sleeping", async () => {
    const inner = scripted([doc("aaaaaaaaaaa")]);
    const { slept, sleep } = recordingSleep();
    const p = new RetryingTranscriptProvider(inner, { sleep });
    expect((await p.fetchTranscript("aaaaaaaaaaa")).videoId).toBe("aaaaaaaaaaa");
    expect(inner.calls).toBe(1);
    expect(slept).toEqual([]);
  });

  // The actual bug: the loser of the race got a 429 and died permanently.
  it("retries a 429 and succeeds on the second try", async () => {
    const inner = scripted([rateLimited("sXZYo9pPaaA"), doc("sXZYo9pPaaA")]);
    const { slept, sleep } = recordingSleep();
    const p = new RetryingTranscriptProvider(inner, { sleep });
    expect((await p.fetchTranscript("sXZYo9pPaaA")).videoId).toBe("sXZYo9pPaaA");
    expect(inner.calls).toBe(2);
    expect(slept).toEqual([1000]);
  });

  it("gives up after three tries and throws the last error", async () => {
    const inner = scripted([
      rateLimited("x"),
      rateLimited("x"),
      new TranscriptFetchError("x", 429, "limit-exceeded", "the third one"),
    ]);
    const { slept, sleep } = recordingSleep();
    const p = new RetryingTranscriptProvider(inner, { sleep });
    await expect(p.fetchTranscript("x")).rejects.toThrow("the third one");
    expect(inner.calls).toBe(3);
    // Doubling, and two sleeps for three tries — not three.
    expect(slept).toEqual([1000, 2000]);
  });

  // A deleted video is not transient. Retrying it costs three times as long to
  // reach the same failure, and delays every video queued behind it.
  it("does not retry anything other than a 429", async () => {
    const inner = scripted([new TranscriptFetchError("y", 404, "not-found", "gone")]);
    const { slept, sleep } = recordingSleep();
    const p = new RetryingTranscriptProvider(inner, { sleep });
    await expect(p.fetchTranscript("y")).rejects.toThrow("gone");
    expect(inner.calls).toBe(1);
    expect(slept).toEqual([]);
  });

  // A missing API key throws a plain Error, not a TranscriptFetchError. Three
  // tries will not conjure one.
  it("does not retry an untyped error", async () => {
    const inner = scripted([new Error("SUPADATA_API_KEY not set")]);
    const { slept, sleep } = recordingSleep();
    const p = new RetryingTranscriptProvider(inner, { sleep });
    await expect(p.fetchTranscript("z")).rejects.toThrow("SUPADATA_API_KEY not set");
    expect(inner.calls).toBe(1);
    expect(slept).toEqual([]);
  });

  it("honours a configured attempt count and base delay", async () => {
    const inner = scripted([rateLimited("q"), rateLimited("q"), rateLimited("q"), doc("q")]);
    const { slept, sleep } = recordingSleep();
    const p = new RetryingTranscriptProvider(inner, { attempts: 4, baseDelayMs: 500, sleep });
    expect((await p.fetchTranscript("q")).videoId).toBe("q");
    expect(slept).toEqual([500, 1000, 2000]);
  });

  it("uses a real timer when no sleep is injected", async () => {
    vi.useFakeTimers();
    try {
      const inner = scripted([rateLimited("t"), doc("t")]);
      const p = new RetryingTranscriptProvider(inner);
      const pending = p.fetchTranscript("t");
      await vi.advanceTimersByTimeAsync(1000);
      expect((await pending).videoId).toBe("t");
    } finally {
      vi.useRealTimers();
    }
  });
});
