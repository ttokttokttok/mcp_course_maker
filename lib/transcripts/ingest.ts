import { getTranscript, putTranscript } from "./store";
import type { TranscriptProvider } from "./provider";
import { needsTitle, type VideoMetaProvider } from "./meta";
import type { TranscriptDoc } from "@/lib/engine/types";

// Never throws: a metadata failure must not cost us a transcript we already
// fetched. The doc keeps its `title: videoId` placeholder and the UI falls
// back to the id exactly as it did before this feature.
async function withMeta(doc: TranscriptDoc, meta?: VideoMetaProvider): Promise<TranscriptDoc> {
  if (!meta || !needsTitle(doc)) return doc;
  try {
    const m = await meta.fetchMeta(doc.videoId);
    return m ? { ...doc, title: m.title, channel: m.channel } : doc;
  } catch {
    return doc;
  }
}

/**
 * Why a shape and not a string: `"failed"` is a status, and the reason it
 * failed is a different fact. Collapsing the two threw away the only evidence
 * of WHY, which is what made a rate limit look identical to a deleted video.
 */
export type IngestResult = { status: "ready" } | { status: "failed"; reason: string };

export async function ingestVideo(
  videoId: string,
  provider: TranscriptProvider,
  meta?: VideoMetaProvider,
): Promise<IngestResult> {
  try {
    const cached = await getTranscript(videoId);
    if (cached) {
      // Cache hit still enriches: catches videos ingested before titles existed
      // and videos already shared with another course.
      const enriched = await withMeta(cached, meta);
      if (enriched !== cached) await putTranscript(enriched); // identity: withMeta returns the same ref when unchanged
      return { status: "ready" };
    }
    const doc = await withMeta(await provider.fetchTranscript(videoId), meta);
    await putTranscript(doc);
    return { status: "ready" };
  } catch (e) {
    return { status: "failed", reason: e instanceof Error ? e.message : String(e) };
  }
}
