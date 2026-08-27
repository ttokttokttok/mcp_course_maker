import type { Segment } from "./types";

/**
 * A video's length, taken from where its transcript stops. Not exact — captions
 * end before the outro does — but it is free, needs no extra API call, and is
 * accurate to well within the precision a card renders ("4h 22m").
 */
export function durationFromSegments(segments: Segment[]): number | null {
  let end = 0;
  for (const s of segments) {
    const start = Number.isFinite(s.start) ? s.start : 0;
    const dur = Number.isFinite(s.duration) ? s.duration : 0;
    if (start + dur > end) end = start + dur;
  }
  return end > 0 ? Math.round(end) : null;
}
