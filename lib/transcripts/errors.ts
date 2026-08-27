/**
 * A transcript fetch that failed, with enough of the source's answer left intact
 * to decide what to do about it.
 *
 * A bare `new Error("fetch failed")` throws away the one fact that matters: a
 * 429 is transient and worth retrying, while a deleted video is permanent and
 * retrying it only takes three times as long to reach the same failure.
 *
 * Shared by both providers. `status` is an HTTP status where there is one, and 0
 * where there is not — yt-dlp reports through an exit code and a line of stderr,
 * so `classify` in ytdlp.ts maps the one distinction that matters (a YouTube 429
 * passed through verbatim) onto 429 and everything else onto 0.
 */
export class TranscriptFetchError extends Error {
  constructor(
    readonly videoId: string,
    readonly status: number,
    /** The vendor's own error code, e.g. "limit-exceeded". "" when absent. */
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TranscriptFetchError";
  }

  /** The single question the retry policy asks. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }
}
