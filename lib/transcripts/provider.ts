import type { TranscriptDoc } from "@/lib/engine/types";
import { YtDlpTranscriptProvider } from "./ytdlp";
import { SupadataTranscriptProvider } from "./supadata";
import { RetryingTranscriptProvider } from "./retry";

export interface TranscriptProvider {
  fetchTranscript(videoId: string): Promise<TranscriptDoc>;
}

/**
 * Try one provider, then the next, and report the FIRST failure if both fail.
 *
 * The first is the one that matters: the fallback only exists because the
 * primary could not do it, so "yt-dlp is not installed" is the sentence worth
 * keeping, not the hosted vendor's complaint about a key nobody set. The
 * fallback's own error is logged rather than dropped, because when the primary
 * failed for a boring reason the second message is the interesting one.
 */
export class FallbackTranscriptProvider implements TranscriptProvider {
  constructor(
    private readonly primary: TranscriptProvider,
    private readonly fallback: TranscriptProvider,
  ) {}

  async fetchTranscript(videoId: string): Promise<TranscriptDoc> {
    try {
      return await this.primary.fetchTranscript(videoId);
    } catch (first) {
      try {
        return await this.fallback.fetchTranscript(videoId);
      } catch (second) {
        console.error("transcript fallback also failed", { videoId, error: second });
        throw first;
      }
    }
  }
}

/**
 * The provider the app actually ingests with.
 *
 * yt-dlp is the default and needs nothing configured, which is what makes a
 * fresh clone work. A hosted vendor is a strict addition: set `SUPADATA_API_KEY`
 * and it becomes the second attempt for videos yt-dlp cannot get — age-gated
 * ones, and the "sign in to confirm you're not a bot" wall YouTube shows to
 * datacenter IPs, which is the failure a self-hoster on a VPS hits first.
 *
 * Only the hosted leg is wrapped in the retry: its 429 is a wait-and-try-again,
 * whereas yt-dlp's failures are all permanent by the time `classify` is done
 * with them, and retrying one costs another download.
 */
export function createTranscriptProvider(): TranscriptProvider {
  const ytdlp = new YtDlpTranscriptProvider();
  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) return ytdlp;
  return new FallbackTranscriptProvider(
    ytdlp,
    new RetryingTranscriptProvider(new SupadataTranscriptProvider(apiKey)),
  );
}
