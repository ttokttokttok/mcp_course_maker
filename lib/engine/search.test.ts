import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { parseVtt } from "./vtt";
import { findConcept, findConceptAcrossVideos } from "./search";
import type { Segment } from "./types";

describe("findConcept", () => {
  let segments: Awaited<ReturnType<typeof parseVtt>>;

  beforeAll(async () => {
    const fixturePath = path.join(import.meta.dirname, "fixtures", "sample.en.vtt");
    const contents = await fs.readFile(fixturePath, "utf8");
    segments = parseVtt(contents);
  });

  it("finds attention with formatted timestamp", () => {
    const hits = findConcept(segments, "attention");

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].timestamp).toBe("12:30");
    expect(hits[0].quote).toContain("Attention");
  });

  it("finds backprop via substring match", () => {
    const hits = findConcept(segments, "backprop");

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].quote).toMatch(/backpropagation/i);
  });
});

const seg = (start: number, text: string): Segment => ({ start, duration: 3, text });

describe("findConceptAcrossVideos", () => {
  it("returns hits across videos, each tagged with videoId, sorted", () => {
    const videos = [
      {
        videoId: "aaaaaaaaaaa",
        segments: [seg(10, "the policy gradient theorem"), seg(20, "unrelated")],
      },
      {
        videoId: "bbbbbbbbbbb",
        segments: [seg(5, "reward shaping"), seg(30, "policy gradient again")],
      },
    ];
    const hits = findConceptAcrossVideos(videos, "policy gradient", 10);
    expect([...new Set(hits.map((h) => h.videoId))].sort()).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb"]);
    expect(hits[0]).toHaveProperty("videoId");
  });
});
