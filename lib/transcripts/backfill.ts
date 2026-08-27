import { listPlaceholderTranscripts, putTranscript } from "./store";
import { needsTitle, type VideoMetaProvider } from "./meta";

export type BackfillResult = { scanned: number; updated: number; skipped: number };

// One-off sweep for transcripts ingested before oEmbed enrichment existed.
// ingestVideo covers everything from here on; this closes the historical gap.
export async function backfillTitles(opts: {
  metaProvider: VideoMetaProvider;
}): Promise<BackfillResult> {
  const docs = await listPlaceholderTranscripts();
  const result: BackfillResult = { scanned: 0, updated: 0, skipped: 0 };

  // Sequential on purpose: unauthenticated oEmbed throttles on bursts, and this
  // runs rarely against a small table.
  for (const doc of docs) {
    if (!needsTitle(doc)) continue; // SQL is the filter; needsTitle is the authority
    result.scanned++;
    try {
      const meta = await opts.metaProvider.fetchMeta(doc.videoId);
      if (!meta) {
        result.skipped++;
        continue;
      }
      await putTranscript({ ...doc, title: meta.title, channel: meta.channel });
      result.updated++;
    } catch {
      result.skipped++;
    }
  }

  return result;
}
