import type { Segment } from "./types";

const DEFAULT_HALF_WINDOW_SEC = 60;

export function getContextWindow(
  segments: Segment[],
  positionSec: number,
  halfWindowSec = DEFAULT_HALF_WINDOW_SEC,
): {
  positionSec: number;
  startSec: number;
  endSec: number;
  segments: Segment[];
} {
  const startSec = positionSec - halfWindowSec;
  const endSec = positionSec + halfWindowSec;

  const overlapping = segments.filter((seg) => {
    const segEnd = seg.start + seg.duration;
    return seg.start < endSec && segEnd > startSec;
  });

  return {
    positionSec,
    startSec,
    endSec,
    segments: overlapping,
  };
}
