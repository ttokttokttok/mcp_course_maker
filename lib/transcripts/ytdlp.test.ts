import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { YtDlpTranscriptProvider } from "./ytdlp";
import { TranscriptFetchError } from "./errors";

const VTT = `WEBVTT

00:00:01.000 --> 00:00:04.000
the chain rule

00:00:04.000 --> 00:00:07.500
applied twice
`;

/**
 * A stand-in for the binary that writes into the directory `-o` names, which is
 * the only side effect the provider actually depends on. Reading the `-o`
 * argument rather than hardcoding a path is what keeps this honest: change the
 * output template in the provider and these tests follow it.
 */
function fakeYtDlp(
  files: Record<string, string>,
  opts: { fail?: Partial<{ code: string; stderr: string; killed: boolean }> } = {},
) {
  return vi.fn(async (_file: string, args: string[]) => {
    const dir = join(args[args.indexOf("-o") + 1], "..");
    if (opts.fail) throw Object.assign(new Error("yt-dlp"), opts.fail);
    for (const [name, body] of Object.entries(files)) {
      await writeFile(join(dir, name), body, "utf8");
    }
    return { stdout: "", stderr: "" };
  });
}

const info = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: "Backpropagation, explained",
    uploader: "Andrej Karpathy",
    duration: 3612.4,
    subtitles: { en: [{ ext: "vtt" }] },
    ...over,
  });

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "ytdlp-test-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("YtDlpTranscriptProvider", () => {
  it("parses the VTT it downloaded and takes title, channel and duration from the info json", async () => {
    const exec = fakeYtDlp({ "vid00000001.en.vtt": VTT, "vid00000001.info.json": info() });
    const doc = await new YtDlpTranscriptProvider(exec).fetchTranscript("vid00000001");

    expect(doc.videoId).toBe("vid00000001");
    expect(doc.title).toBe("Backpropagation, explained");
    expect(doc.channel).toBe("Andrej Karpathy");
    // Rounded from the info json, NOT derived from where the last cue ends —
    // segments stop early on a video that finishes without speech.
    expect(doc.durationSec).toBe(3612);
    expect(doc.segments.map((s) => [s.start, s.text])).toEqual([
      [1, "the chain rule"],
      [4, "applied twice"],
    ]);
    // The language appears in `subtitles`, so this track was human-written.
    expect(doc.source).toBe("captions");
    expect(doc.language).toBe("en");
  });

  it("calls it a machine transcript when the language is only in automatic_captions", async () => {
    const exec = fakeYtDlp({
      "vid00000002.en.vtt": VTT,
      "vid00000002.info.json": info({ subtitles: {}, automatic_captions: { en: [] } }),
    });
    const doc = await new YtDlpTranscriptProvider(exec).fetchTranscript("vid00000002");
    expect(doc.source).toBe("asr");
  });

  it("falls back to the videoId placeholder when there is no info json to read", async () => {
    // Which is what keeps the oEmbed enrichment in `ingestVideo` reachable:
    // `needsTitle` recognises exactly this shape.
    const exec = fakeYtDlp({ "vid00000003.en.vtt": VTT });
    const doc = await new YtDlpTranscriptProvider(exec).fetchTranscript("vid00000003");
    expect(doc.title).toBe("vid00000003");
    expect(doc.channel).toBe("");
    // No info json means no real duration either, so it comes from the cues —
    // through `durationFromSegments`, which rounds the 7.5s end to whole seconds.
    expect(doc.durationSec).toBe(8);
  });

  it("names the missing binary rather than reporting a generic failure", async () => {
    const exec = fakeYtDlp({}, { fail: { code: "ENOENT" } });
    const err = (await new YtDlpTranscriptProvider(exec)
      .fetchTranscript("vid00000004")
      .catch((e: unknown) => e)) as TranscriptFetchError;

    expect(err).toBeInstanceOf(TranscriptFetchError);
    expect(err.code).toBe("yt-dlp-missing");
    // The one failure a fresh clone hits first, and the one nothing in the app
    // can fix — so the message has to say how to fix it outside the app.
    expect(err.message).toContain("yt-dlp is not installed");
    expect(err.isRateLimited).toBe(false);
  });

  it("marks a YouTube 429 retryable, and everything else permanent", async () => {
    const limited = (await new YtDlpTranscriptProvider(
      fakeYtDlp(
        {},
        { fail: { stderr: "ERROR: unable to download: HTTP Error 429: Too Many Requests" } },
      ),
    )
      .fetchTranscript("vid00000005")
      .catch((e: unknown) => e)) as TranscriptFetchError;
    expect(limited.isRateLimited).toBe(true);
    expect(limited.code).toBe("rate-limited");

    const gone = (await new YtDlpTranscriptProvider(
      fakeYtDlp({}, { fail: { stderr: "ERROR: Video unavailable" } }),
    )
      .fetchTranscript("vid00000006")
      .catch((e: unknown) => e)) as TranscriptFetchError;
    // A deleted video is exactly as gone on the third try as on the first.
    expect(gone.isRateLimited).toBe(false);
    expect(gone.message).toContain("Video unavailable");
  });

  it("points at cookies when YouTube asks the machine to sign in", async () => {
    const err = (await new YtDlpTranscriptProvider(
      fakeYtDlp({}, { fail: { stderr: "ERROR: Sign in to confirm you're not a bot." } }),
    )
      .fetchTranscript("vid00000007")
      .catch((e: unknown) => e)) as TranscriptFetchError;
    expect(err.code).toBe("needs-cookies");
    expect(err.message).toContain("YTDLP_COOKIES_FROM_BROWSER");
  });

  it("says a video simply has no captions, rather than blaming the binary", async () => {
    // yt-dlp exits 0 for a video with no subtitle track in the requested
    // languages — it just writes nothing. Reporting that as "yt-dlp failed"
    // sends you looking at your install instead of at the video.
    const exec = fakeYtDlp({ "vid00000008.info.json": info() });
    const err = (await new YtDlpTranscriptProvider(exec)
      .fetchTranscript("vid00000008")
      .catch((e: unknown) => e)) as TranscriptFetchError;
    expect(err.code).toBe("no-captions");
    expect(err.message).toContain("YTDLP_SUB_LANGS");
  });

  it("passes the browser cookie source through only when one is configured", async () => {
    const withoutCookies = fakeYtDlp({ "vid00000009.en.vtt": VTT });
    await new YtDlpTranscriptProvider(withoutCookies).fetchTranscript("vid00000009");
    expect(withoutCookies.mock.calls[0][1]).not.toContain("--cookies-from-browser");

    vi.stubEnv("YTDLP_COOKIES_FROM_BROWSER", "firefox");
    const withCookies = fakeYtDlp({ "vid00000010.en.vtt": VTT });
    await new YtDlpTranscriptProvider(withCookies).fetchTranscript("vid00000010");
    const args = withCookies.mock.calls[0][1];
    expect(args[args.indexOf("--cookies-from-browser") + 1]).toBe("firefox");
  });
});
