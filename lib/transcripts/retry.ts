import type { TranscriptProvider } from "./provider";
import type { TranscriptDoc } from "@/lib/engine/types";
import { TranscriptFetchError } from "./errors";

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retries a rate-limited transcript fetch, and nothing else.
 *
 * The failure this exists for: a hosted transcript API on a small plan allows
 * roughly one concurrent request, so firing several videos at once meant the
 * loser of the race took a 429 and was recorded as permanently failed. A retry
 * turns that into a wait.
 *
 * A decorator rather than a `withRetry(fn)` helper, so it satisfies
 * `TranscriptProvider` itself: `createTranscriptProvider` wraps only the hosted
 * leg in it and nests that inside the fallback, without either provider knowing
 * this exists.
 *
 * `sleep` is injected so the tests assert the delays without waiting them. That
 * is not only speed — a suite that really slept would be tuned down to
 * milliseconds, and would then stop testing the actual backoff.
 */
export class RetryingTranscriptProvider implements TranscriptProvider {
  private readonly attempts: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly inner: TranscriptProvider,
    opts: {
      /** TOTAL tries, not retries-after-the-first. Default 3. */
      attempts?: number;
      baseDelayMs?: number;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ) {
    this.attempts = opts.attempts ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 1000;
    this.sleep = opts.sleep ?? realSleep;
  }

  async fetchTranscript(videoId: string): Promise<TranscriptDoc> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.inner.fetchTranscript(videoId);
      } catch (e) {
        // Only a 429 is worth a second look. A 404, a malformed response, or a
        // missing API key is exactly as broken on the third try as on the first.
        const transient = e instanceof TranscriptFetchError && e.isRateLimited;
        if (!transient || attempt >= this.attempts - 1) throw e;
        await this.sleep(this.baseDelayMs * 2 ** attempt);
      }
    }
  }
}
