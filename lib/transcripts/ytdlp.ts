import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Segment, TranscriptDoc } from "@/lib/engine/types";
import { parseVtt } from "@/lib/engine/vtt";
import { durationFromSegments } from "@/lib/engine/duration";
import { TranscriptFetchError } from "./errors";
import type { TranscriptProvider } from "./provider";

const run = promisify(execFile);

/** The binary, the languages and the patience, all overridable from `.env.local`. */
const BINARY = () => process.env.YTDLP_PATH || "yt-dlp";
/**
 * `en.*` before bare `en` so a regional variant is preferred over nothing, and
 * so `en-orig` — what YouTube calls the auto-caption track in the video's own
 * language — is reachable. yt-dlp takes the first pattern that matches.
 */
const LANGS = () => process.env.YTDLP_SUB_LANGS || "en.*,en";
const TIMEOUT_MS = () => Number(process.env.YTDLP_TIMEOUT_MS) || 120_000;

/** What yt-dlp writes into `<id>.info.json`, of which we read four fields. */
type InfoJson = {
  title?: unknown;
  uploader?: unknown;
  channel?: unknown;
  duration?: unknown;
  subtitles?: Record<string, unknown>;
};

/**
 * yt-dlp reports every failure as a non-zero exit and a line on stderr, so the
 * classification the rest of the pipeline needs has to be read back out of the
 * text. Only one distinction actually matters — retry or do not — and YouTube
 * says that with a 429, which yt-dlp passes through verbatim.
 *
 * Everything else is mapped to 0, which `isRateLimited` reads as "permanent".
 * That is the right default: a private video, a missing binary and a video with
 * no captions at all are exactly as broken on the third try as on the first.
 */
function classify(videoId: string, stderr: string): TranscriptFetchError {
  const rateLimited = /HTTP Error 429|Too Many Requests/i.test(stderr);
  const signedOut = /Sign in to confirm|bot|cookies/i.test(stderr);
  // The last non-empty line: yt-dlp's own summary of what went wrong, with the
  // progress chatter above it dropped.
  const detail =
    stderr
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1) ?? "yt-dlp failed";
  return new TranscriptFetchError(
    videoId,
    rateLimited ? 429 : 0,
    rateLimited ? "rate-limited" : signedOut ? "needs-cookies" : "yt-dlp-failed",
    `yt-dlp could not fetch ${videoId}: ${detail}` +
      (signedOut
        ? " — YouTube is asking this machine to sign in. Set YTDLP_COOKIES_FROM_BROWSER" +
          " (e.g. `firefox`) so yt-dlp can reuse a logged-in session."
        : ""),
  );
}

/**
 * Transcripts straight from YouTube, via the `yt-dlp` binary on this machine.
 *
 * This is the default provider and it needs no account and no API key — which is
 * the whole reason the app can be cloned and run. It costs a subprocess and a
 * download per uncached video, so `ingestVideo` checks the cache first and
 * `kickOffIngestion` runs them one at a time.
 *
 * `--write-subs --write-auto-subs` asks for real captions AND YouTube's machine
 * ones, in that order of preference, because most lectures have only the latter.
 * `--convert-subs vtt` is what lets `parseVtt` be the only parser here: without
 * it yt-dlp hands back whatever format the track happened to be published in.
 */
export class YtDlpTranscriptProvider implements TranscriptProvider {
  constructor(
    private readonly exec: (
      file: string,
      args: string[],
      opts: { timeout: number },
    ) => Promise<{ stdout: string; stderr: string }> = (file, args, opts) =>
      run(file, args, { ...opts, maxBuffer: 32 * 1024 * 1024 }),
  ) {}

  async fetchTranscript(videoId: string): Promise<TranscriptDoc> {
    const dir = await mkdtemp(join(tmpdir(), "ytdlp-"));
    try {
      await this.download(videoId, dir);
      return await this.read(videoId, dir);
    } finally {
      // A download that failed halfway still left files behind, and this runs
      // once per uncached video — a leak here is a slow disk fill, not a crash,
      // which is the kind that goes unnoticed for months.
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async download(videoId: string, dir: string): Promise<void> {
    const cookies = process.env.YTDLP_COOKIES_FROM_BROWSER;
    const args = [
      "--skip-download",
      "--write-info-json",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      LANGS(),
      "--sub-format",
      "vtt",
      "--convert-subs",
      "vtt",
      // A URL can name a playlist as well as a video; we were given an id, and
      // pulling its playlist would download hundreds of subtitle files.
      "--no-playlist",
      "--no-progress",
      "--no-warnings",
      ...(cookies ? ["--cookies-from-browser", cookies] : []),
      "-o",
      join(dir, "%(id)s.%(ext)s"),
      `https://www.youtube.com/watch?v=${videoId}`,
    ];

    try {
      await this.exec(BINARY(), args, { timeout: TIMEOUT_MS() });
    } catch (e) {
      const err = e as { code?: string | number; stderr?: string; killed?: boolean };
      // ENOENT is the one failure worth its own sentence, because it is the one
      // a new clone hits first and the one nothing in the app can fix.
      if (err.code === "ENOENT") {
        throw new TranscriptFetchError(
          videoId,
          0,
          "yt-dlp-missing",
          `yt-dlp is not installed (looked for "${BINARY()}"). Install it — ` +
            "`brew install yt-dlp`, `pipx install yt-dlp`, or see " +
            "https://github.com/yt-dlp/yt-dlp#installation — or set YTDLP_PATH.",
        );
      }
      if (err.killed) {
        throw new TranscriptFetchError(
          videoId,
          0,
          "timeout",
          `yt-dlp took longer than ${TIMEOUT_MS()}ms on ${videoId}. Raise YTDLP_TIMEOUT_MS.`,
        );
      }
      throw classify(videoId, err.stderr ?? "");
    }
  }

  /**
   * Turn what landed in `dir` into a document.
   *
   * Split from the download because the two fail for unrelated reasons: above is
   * "yt-dlp could not run", here is "it ran and this video has no captions",
   * which is permanent, common, and worth saying in those words rather than as
   * an exit code.
   */
  private async read(videoId: string, dir: string): Promise<TranscriptDoc> {
    const files = await readdir(dir);
    // `<id>.<lang>.vtt`. Sorted so the choice is deterministic when a video has
    // several tracks — yt-dlp writes them in the order `--sub-langs` matched,
    // but readdir does not promise to hand them back that way.
    const vtt = files.filter((f) => f.endsWith(".vtt")).sort()[0];
    if (!vtt) {
      throw new TranscriptFetchError(
        videoId,
        0,
        "no-captions",
        `${videoId} has no captions in ${LANGS()}. Set YTDLP_SUB_LANGS to look for others.`,
      );
    }

    const segments: Segment[] = parseVtt(await readFile(join(dir, vtt), "utf8"));
    const info = await this.info(dir, videoId);
    // Between `<id>.` and `.vtt`. Only used to ask the info json whether this
    // track was human-written, so an unparseable name degrades to "asr" — the
    // conservative answer, since machine captions are the common case.
    const lang = vtt.slice(videoId.length + 1, -".vtt".length);
    const manual = Object.keys(info?.subtitles ?? {}).some((k) => k === lang);

    return {
      videoId,
      // The info json is the authority; the `videoId` fallback is the same
      // placeholder `needsTitle` recognises, so the oEmbed enrichment in
      // `ingestVideo` still gets its chance if this came back empty.
      title: typeof info?.title === "string" && info.title.trim() ? info.title : videoId,
      channel:
        (typeof info?.uploader === "string" && info.uploader) ||
        (typeof info?.channel === "string" && info.channel) ||
        "",
      source: manual ? "captions" : "asr",
      language: lang || "en",
      fetchedAt: new Date().toISOString(),
      // yt-dlp knows the real runtime; the segments only know when the last one
      // ends, which stops early on a video that finishes without speech.
      durationSec:
        typeof info?.duration === "number" && info.duration > 0
          ? Math.round(info.duration)
          : (durationFromSegments(segments) ?? undefined),
      segments,
    };
  }

  /** Never throws: metadata is cosmetic, and a transcript is not worth losing over it. */
  private async info(dir: string, videoId: string): Promise<InfoJson | null> {
    try {
      return JSON.parse(await readFile(join(dir, `${videoId}.info.json`), "utf8")) as InfoJson;
    } catch {
      return null;
    }
  }
}
