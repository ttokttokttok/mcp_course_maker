import { describe, it, expect, beforeEach } from "vitest";
import { seedRoadmap, seedTranscript, seedVideo, truncateAll } from "@/lib/test/seed";
import { conceptSearch, isRetrievalError, transcriptWindow } from "./retrieval";

/**
 * The rules both front doors share. The built-in tutor's AI SDK tools and the
 * MCP server are both thin wrappers over these two functions, so this is where
 * the course-membership guard is actually pinned down.
 */
const line = (start: number, text: string) => ({ start, duration: 4, text });

function course() {
  const id = seedRoadmap({ title: "Calculus" });
  seedTranscript("vidlecture1", {
    title: "Lecture one",
    segments: [line(10, "we begin with the derivative"), line(30, "and then the chain rule")],
  });
  seedTranscript("vidlecture2", {
    title: "Lecture two",
    segments: [line(5, "the chain rule again, in depth")],
  });
  // In the store, but NOT in this course — the shape the guard exists for.
  seedTranscript("vidstranger1", {
    title: "Another course entirely",
    segments: [line(0, "the chain rule, somewhere else")],
  });
  seedVideo(id, "vidlecture1", 0);
  seedVideo(id, "vidlecture2", 1);
  return id;
}

beforeEach(truncateAll);

describe("transcriptWindow", () => {
  it("reads the segments around a timestamp and names the video it read", async () => {
    const id = course();
    const w = await transcriptWindow({
      courseId: id,
      videoId: "vidlecture1",
      timestampSec: 30,
      halfWindowSec: 5,
    });
    if (isRetrievalError(w)) throw new Error("expected a window");

    expect(w.videoTitle).toBe("Lecture one");
    expect(w.segments.map((s) => s.text)).toEqual(["and then the chain rule"]);
    expect([w.startSec, w.endSec]).toEqual([25, 35]);
  });

  it("refuses a video the course does not contain, even though the store has it", async () => {
    const id = course();
    // The whole point: `getTranscript` is keyed by video id across every course
    // in the app, so without this guard a model-supplied id reads a transcript
    // belonging to a course the learner is not taking.
    expect(await transcriptWindow({ courseId: id, videoId: "vidstranger1" })).toEqual({
      error: "video-not-in-course",
      videoId: "vidstranger1",
    });
  });

  it("separates a course that does not exist from a video that is not in it", async () => {
    const id = course();
    expect(await transcriptWindow({ courseId: "no-such-course", videoId: "vidlecture1" })).toEqual({
      error: "course-not-found",
      courseId: "no-such-course",
    });
    // In the course, but nothing has been ingested for it yet — a third state,
    // and the only one that resolves itself by waiting.
    seedVideo(id, "vidpending01", 2);
    expect(await transcriptWindow({ courseId: id, videoId: "vidpending01" })).toEqual({
      error: "transcript-not-ready",
      videoId: "vidpending01",
    });
  });
});

describe("conceptSearch", () => {
  it("searches every video in the course and carries each hit's video title", async () => {
    const id = course();
    const r = await conceptSearch({ courseId: id, query: "chain rule" });
    if (isRetrievalError(r)) throw new Error("expected hits");

    expect(r.hits.map((h) => h.videoId).sort()).toEqual(["vidlecture1", "vidlecture2"]);
    // Titles, not just ids: the caller is usually about to show these to a
    // person, and an 11-character id names nothing to a reader.
    expect(r.hits.every((h) => h.videoTitle.startsWith("Lecture"))).toBe(true);
    expect(r.hits.every((h) => typeof h.timestamp === "string")).toBe(true);
    // The stranger's transcript says "the chain rule" too, and must not appear.
    expect(r.hits.some((h) => h.videoId === "vidstranger1")).toBe(false);
  });

  it("scopes to one video only after proving it is this course's video", async () => {
    const id = course();
    const mine = await conceptSearch({
      courseId: id,
      query: "chain rule",
      scope: "video",
      videoId: "vidlecture2",
    });
    if (isRetrievalError(mine)) throw new Error("expected hits");
    expect(mine.hits.map((h) => h.videoId)).toEqual(["vidlecture2"]);

    // The narrower request must not be the looser guard.
    expect(
      await conceptSearch({
        courseId: id,
        query: "chain rule",
        scope: "video",
        videoId: "vidstranger1",
      }),
    ).toEqual({ error: "video-not-in-course", videoId: "vidstranger1" });

    // scope "video" with no videoId names nothing rather than quietly widening
    // to the whole course.
    expect(await conceptSearch({ courseId: id, query: "chain rule", scope: "video" })).toEqual({
      error: "video-not-in-course",
      videoId: "",
    });
  });

  it("returns no hits, rather than an error, when nothing matches", async () => {
    const id = course();
    const r = await conceptSearch({ courseId: id, query: "photosynthesis" });
    if (isRetrievalError(r)) throw new Error("expected an empty result");
    expect(r.hits).toEqual([]);
    expect(r.scope).toBe("course");
  });

  it("refuses a course that does not exist", async () => {
    expect(await conceptSearch({ courseId: "no-such-course", query: "x" })).toEqual({
      error: "course-not-found",
      courseId: "no-such-course",
    });
  });
});
