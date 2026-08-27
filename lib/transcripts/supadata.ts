import type { TranscriptDoc, Segment } from "@/lib/engine/types";
import { TranscriptFetchError } from "./errors";
import type { TranscriptProvider } from "./provider";

// Verified against the live Supadata API (2026-07-26) on video VMj-3S1tku0.
// GET https://api.supadata.ai/v1/youtube/transcript?videoId=<id>
// Auth header: x-api-key
// Response (text=false, the default):
//   { content: { text, offset, duration, lang }[], lang, availableLangs }
// offset/duration are in MILLISECONDS. There are NO title/channel fields.
type SupadataTranscriptResponse = {
  content: { text: string; offset: number; duration: number; lang?: string }[];
  lang?: string;
  availableLangs?: string[];
};

/**
 * Reads the vendor's error body, and never throws while doing it. A proxy's HTML
 * 502 page is not JSON, and letting `res.json()` throw here would replace a
 * legible 502 with a SyntaxError that says nothing about the video.
 *
 * Supadata's shape, verified 2026-07-30 against a real rate limit:
 *   { "error": "limit-exceeded", "details": "Request rate limit ... exceeded." }
 */
async function toFetchError(res: Response, videoId: string): Promise<TranscriptFetchError> {
  let code = "";
  let detail = "";
  try {
    const body = (await res.json()) as { error?: unknown; details?: unknown };
    if (typeof body.error === "string") code = body.error;
    if (typeof body.details === "string") detail = body.details;
  } catch {
    // Not JSON. The status is all we get, and it is enough to classify.
  }
  return new TranscriptFetchError(
    videoId,
    res.status,
    code,
    `Supadata ${res.status}${code ? ` ${code}` : ""} for ${videoId}${detail ? `: ${detail}` : ""}`,
  );
}

export class SupadataTranscriptProvider implements TranscriptProvider {
  constructor(
    private readonly apiKey = process.env.SUPADATA_API_KEY ?? "",
    private readonly doFetch: typeof fetch = fetch,
  ) {}

  async fetchTranscript(videoId: string): Promise<TranscriptDoc> {
    if (!this.apiKey) throw new Error("SUPADATA_API_KEY not set");
    const url = `https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}`;
    const res = await this.doFetch(url, { headers: { "x-api-key": this.apiKey } });
    if (!res.ok) throw await toFetchError(res, videoId);
    const data = (await res.json()) as SupadataTranscriptResponse;
    const segments: Segment[] = data.content.map((c) => ({
      start: c.offset / 1000,
      duration: c.duration / 1000,
      text: c.text,
    }));
    return {
      videoId,
      // Supadata's transcript response carries no title/channel; callers may
      // enrich these later. Fall back to the videoId so the field is non-empty.
      title: videoId,
      channel: "",
      source: "captions",
      language: data.lang ?? "en",
      fetchedAt: new Date().toISOString(),
      segments,
    };
  }
}
