import { formatTimestamp } from "./time";
import type { Segment } from "./types";

export type ConceptHit = {
  start: number;
  timestamp: string;
  quote: string;
  score: number;
};

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function scoreSegment(text: string, query: string, tokens: string[]): number {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();

  if (lowerQuery && lowerText.includes(lowerQuery)) {
    return 1000 + tokens.length;
  }

  if (tokens.length === 0) {
    return 0;
  }

  const matchingTokens = tokens.filter((token) => lowerText.includes(token));
  if (matchingTokens.length === tokens.length) {
    return 100 + matchingTokens.length;
  }

  return matchingTokens.length;
}

export function findConcept(segments: Segment[], query: string, limit = 5): ConceptHit[] {
  const tokens = tokenize(query);

  const hits: ConceptHit[] = segments
    .map((seg) => ({
      start: seg.start,
      timestamp: formatTimestamp(seg.start),
      quote: seg.text.trim(),
      score: scoreSegment(seg.text, query, tokens),
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.start - b.start)
    .slice(0, limit);

  return hits;
}

export type RoadmapConceptHit = ConceptHit & { videoId: string };

export function findConceptAcrossVideos(
  videos: { videoId: string; segments: Segment[] }[],
  query: string,
  limit = 10,
): RoadmapConceptHit[] {
  const all: RoadmapConceptHit[] = [];
  for (const v of videos) {
    for (const hit of findConcept(v.segments, query, limit)) {
      all.push({ ...hit, videoId: v.videoId });
    }
  }
  all.sort((a, b) => b.score - a.score);
  return all.slice(0, limit);
}
