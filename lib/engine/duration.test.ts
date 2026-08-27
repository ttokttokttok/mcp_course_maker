import { describe, it, expect } from "vitest";
import { durationFromSegments } from "./duration";
import type { Segment } from "./types";

const seg = (start: number, duration: number): Segment => ({ start, duration, text: "x" });

describe("durationFromSegments", () => {
  it("is the end of the last segment", () => {
    expect(durationFromSegments([seg(0, 5), seg(5, 7)])).toBe(12);
  });

  // Segments arrive in transcript order, but nothing in the schema guarantees
  // it — a provider that emits them out of order must not truncate the course.
  it("takes the maximum end, not the final element's", () => {
    expect(durationFromSegments([seg(100, 4), seg(10, 2)])).toBe(104);
  });

  it("tolerates a missing duration on a segment", () => {
    expect(durationFromSegments([{ start: 30, duration: Number.NaN, text: "x" }])).toBe(30);
  });

  it("returns null for an empty transcript", () => {
    expect(durationFromSegments([])).toBeNull();
  });
});
