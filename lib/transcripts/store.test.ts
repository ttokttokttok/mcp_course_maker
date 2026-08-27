import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { truncateAll } from "@/lib/test/seed";
import type { TranscriptDoc } from "@/lib/engine/types";
import {
  getTranscript,
  getTranscriptsByIds,
  listPlaceholderTranscripts,
  putTranscript,
} from "./store";

const doc = (videoId: string, over: Partial<TranscriptDoc> = {}): TranscriptDoc => ({
  videoId,
  title: "T",
  channel: "C",
  source: "captions",
  language: "en",
  fetchedAt: "2026-01-01T00:00:00.000Z",
  segments: [{ start: 0, duration: 1, text: "x" }],
  ...over,
});

beforeEach(truncateAll);

describe("the transcript store", () => {
  it("round-trips a document, and answers null for one it does not hold", async () => {
    await putTranscript(doc("zzztest0001"));
    expect((await getTranscript("zzztest0001"))?.title).toBe("T");
    expect((await getTranscriptsByIds(["zzztest0001"])).length).toBe(1);
    expect(await getTranscript("nope-nope-no")).toBeNull();
    // An empty id list must not build `IN ()`, which is a syntax error.
    expect(await getTranscriptsByIds([])).toEqual([]);
  });

  it("upserts rather than failing on a video it already holds", async () => {
    await putTranscript(doc("zzztest0002", { title: "First" }));
    await putTranscript(doc("zzztest0002", { title: "Second", channel: "Later" }));
    const stored = await getTranscript("zzztest0002");
    expect(stored?.title).toBe("Second");
    expect(stored?.channel).toBe("Later");
    // Still one row: the whole point of keying on video_id alone.
    expect(db.prepare("SELECT count(*) c FROM transcripts").get()).toEqual({ c: 1 });
  });

  it("derives and stores a duration from the segments when the doc carries none", async () => {
    await putTranscript(doc("zzztest0003", { segments: [{ start: 10, duration: 5, text: "x" }] }));
    expect((await getTranscript("zzztest0003"))?.durationSec).toBe(15);
    expect(
      db.prepare("SELECT duration_sec d FROM transcripts WHERE video_id = ?").get("zzztest0003"),
    ).toEqual({ d: 15 });
  });

  it("survives a stored document with no segments at all", async () => {
    // A row written by an older version, or by hand. `putTranscript` must not
    // throw on it — ingest's catch would report a working cache hit as a
    // permanently failed video.
    await expect(
      putTranscript({ videoId: "zzztest0004" } as TranscriptDoc),
    ).resolves.toBeUndefined();
    expect((await getTranscript("zzztest0004"))?.videoId).toBe("zzztest0004");
  });

  it("lists only the rows whose title is still a placeholder", async () => {
    await putTranscript(doc("zzztest0005", { title: "A real title" }));
    await putTranscript(doc("zzztest0006", { title: "" }));
    await putTranscript(doc("zzztest0007", { title: "zzztest0007" })); // the id echoed back
    await putTranscript(doc("zzztest0008", { title: "   " })); // whitespace is not a title

    expect((await listPlaceholderTranscripts()).map((d) => d.videoId).sort()).toEqual([
      "zzztest0006",
      "zzztest0007",
      "zzztest0008",
    ]);
  });
});
