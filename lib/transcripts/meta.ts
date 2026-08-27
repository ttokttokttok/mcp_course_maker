export type VideoMeta = { title: string; channel: string };

export interface VideoMetaProvider {
  fetchMeta(videoId: string): Promise<VideoMeta | null>;
}

/**
 * The single authority on "this title is still a placeholder".
 *
 * A provider that learns no title stores `title: videoId` rather than leaving
 * the field empty, so both shapes have to count. Ingest, backfill and the
 * course card all key off this one predicate — the card used to carry a second
 * copy of the rule written out in SQL, and the two disagreed about a title of
 * "   ".
 *
 * Structural, not `TranscriptDoc`: the card has a title and a video id and no
 * document at all, and widening the parameter is cheaper than making it build a
 * fake one.
 */
export function needsTitle(doc: { videoId: string; title?: unknown }): boolean {
  // `doc` is cast out of stored JSON, not validated, so `title` can genuinely be
  // absent on a row written before the column existed. `doc.title.trim()` threw
  // there — and ingest's catch reported the resulting crash as a permanently
  // failed video, on the CACHE-HIT path, for a transcript we already had.
  const t = typeof doc.title === "string" ? doc.title.trim() : "";
  return t === "" || t === doc.videoId;
}

// YouTube's public oEmbed endpoint — no API key, no quota, no auth.
// GET https://www.youtube.com/oembed?url=<encoded watch url>&format=json
//   200 → { title, author_name, ... }
//   401 → embedding disabled;  404 → private or deleted
type OEmbedResponse = { title?: string; author_name?: string };

export class OEmbedVideoMetaProvider implements VideoMetaProvider {
  constructor(private readonly doFetch: typeof fetch = fetch) {}

  // Returns null — never throws — for every failure mode. Titles are cosmetic:
  // callers keep the placeholder rather than losing a transcript over them.
  async fetchMeta(videoId: string): Promise<VideoMeta | null> {
    const watch = `https://www.youtube.com/watch?v=${videoId}`;
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`;
    try {
      const res = await this.doFetch(url);
      if (!res.ok) return null;
      const data = (await res.json()) as OEmbedResponse;
      const title = data.title?.trim();
      if (!title) return null;
      return { title, channel: data.author_name?.trim() ?? "" };
    } catch {
      return null;
    }
  }
}
