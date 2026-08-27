import { describe, it, expect, beforeEach } from "vitest";
import { seedRoadmap, seedTranscript, seedVideo, truncateAll } from "@/lib/test/seed";
import {
  getRoadmap,
  listRoadmaps,
  listTopics,
  searchRoadmaps,
  setFeatured,
  updateRoadmapMetadata,
} from "./roadmaps";

/**
 * These run against a real in-memory SQLite database, built from `db/index.ts`'s
 * own DDL (`DATABASE_PATH=":memory:"`, set in vitest.config.ts). They used to be
 * Nothing here needs a server, a key or a network, so they run everywhere.
 */
beforeEach(truncateAll);

describe("the catalog", () => {
  it("lists every course, pinned first, then newest", async () => {
    // The pinned row is deliberately the OLDEST, so "pinned first" cannot be
    // satisfied by created_at ordering alone.
    const pinned = seedRoadmap({ title: "pinned", createdAt: "2019-01-01T00:00:00.000Z" });
    const older = seedRoadmap({ title: "older", createdAt: "2020-01-01T00:00:00.000Z" });
    const newer = seedRoadmap({ title: "newer", createdAt: "2020-06-01T00:00:00.000Z" });
    await setFeatured(pinned, true);

    const listed = await listRoadmaps();
    expect(listed.map((c) => c.title)).toEqual(["pinned", "newer", "older"]);
    expect(listed[0].featuredAt).not.toBeNull();
    expect(listed[1].featuredAt).toBeNull();

    // A course with no videos is the case every aggregate has to survive with
    // nothing to aggregate: an empty contents list, not null.
    expect(listed[0].videoCount).toBe(0);
    expect(listed[0].channel).toBeNull();
    expect(listed[0].videoTitles).toEqual([]);
    expect(listed[0].durationSec).toBeNull();
    expect(listed[0].coverVideoId).toBeNull();

    // Unpinning drops it behind both others, on created_at alone.
    await setFeatured(pinned, false);
    expect((await listRoadmaps()).map((c) => c.title)).toEqual(["newer", "older", "pinned"]);
    expect(newer && older).toBeTruthy();
  });

  it("carries the first video's channel by position, and maps a blank channel to null", async () => {
    const multi = seedRoadmap({ title: "channels" });
    const blank = seedRoadmap({ title: "blank channel" });
    seedTranscript("vid0000000a", { channel: "Channel Zero" });
    seedTranscript("vid0000000b", { channel: "Channel One" });
    seedTranscript("vid0000000c", { channel: "" });
    // Position 1 is inserted BEFORE position 0, so a card that dropped its
    // ordering — or reversed it — surfaces "Channel One".
    seedVideo(multi, "vid0000000b", 1);
    seedVideo(multi, "vid0000000a", 0);
    seedVideo(blank, "vid0000000c", 0);

    const cards = await listRoadmaps();
    expect(cards.find((c) => c.id === multi)?.channel).toBe("Channel Zero");
    expect(cards.find((c) => c.id === multi)?.videoCount).toBe(2);
    // `transcripts.channel` is notNull default "", so the `|| null` mapping is
    // what keeps an unknown channel from reaching the UI as an empty string.
    expect(cards.find((c) => c.id === blank)?.channel).toBeNull();
  });

  it("carries contents, duration, and a cover video on the card", async () => {
    const id = seedRoadmap({ title: "card" });
    seedTranscript("vid0000001a", { title: "First video", durationSec: 600 });
    seedTranscript("vid0000002a", { title: "Second video", durationSec: 900 });
    seedTranscript("vid0000003a", { title: "Third video", durationSec: 300 });
    seedTranscript("vid0000004a", { title: "Fourth video", durationSec: 120 });
    seedVideo(id, "vid0000002a", 0);
    seedVideo(id, "vid0000001a", 1);
    seedVideo(id, "vid0000003a", 2);
    seedVideo(id, "vid0000004a", 3);

    const card = (await listRoadmaps()).find((c) => c.id === id);
    // Course order, and only the first three — the card has room for three.
    expect(card?.videoTitles).toEqual(["Second video", "First video", "Third video"]);
    // The sum counts the fourth even though the contents list stops at three.
    expect(card?.durationSec).toBe(1920);
    expect(card?.coverVideoId).toBe("vid0000002a");
    expect(card?.videoCount).toBe(4);
  });

  it("keeps placeholder titles out of the contents list", async () => {
    const id = seedRoadmap({ title: "placeholders" });
    // The two shapes `needsTitle` (lib/transcripts/meta.ts) calls a placeholder:
    // the empty string, and the videoId echoed back by a provider that learned
    // no title on the SUCCESSFUL ingestion path.
    seedTranscript("vid0000000p", { title: "vid0000000p", durationSec: 100 });
    seedTranscript("vid0000001p", { title: "", durationSec: 200 });
    seedTranscript("vid0000002p", { title: "Real title A", durationSec: 300 });
    seedTranscript("vid0000003p", { title: "Real title B", durationSec: 400 });
    seedVideo(id, "vid0000000p", 0);
    seedVideo(id, "vid0000001p", 1);
    seedVideo(id, "vid0000002p", 2);
    seedVideo(id, "vid0000003p", 3);

    const card = (await listRoadmaps()).find((c) => c.id === id);
    // Neither placeholder reaches the card: a raw 11-character YouTube id is not
    // a video title, and the card cannot filter it itself because videoTitles
    // carries no ids.
    expect(card?.videoTitles).toEqual(["Real title A", "Real title B"]);
    // The filter belongs to videoTitles alone — the duration sum still counts
    // every video with a transcript, and the cover is still position 0.
    expect(card?.durationSec).toBe(1000);
    expect(card?.coverVideoId).toBe("vid0000000p");
    expect(card?.videoCount).toBe(4);
  });

  it("patches only the metadata fields it is given", async () => {
    const id = seedRoadmap({ title: "Before", description: "Before desc", audience: "Before who" });

    await updateRoadmapMetadata(id, { description: "After desc" });
    let row = await getRoadmap(id);
    expect(row?.description).toBe("After desc");
    expect(row?.title).toBe("Before"); // untouched
    expect(row?.audience).toBe("Before who"); // untouched

    // An empty patch writes nothing rather than issuing `SET` with no
    // assignments, which is a syntax error and not a no-op.
    await updateRoadmapMetadata(id, {});
    row = await getRoadmap(id);
    expect(row?.description).toBe("After desc");

    // Topics round-trip through the JSON column, list and all.
    await updateRoadmapMetadata(id, { topics: ["Math", "Science"], audience: "" });
    row = await getRoadmap(id);
    expect(row?.topics).toEqual(["Math", "Science"]);
    expect(row?.audience).toBe(""); // an emptied field is saved, not ignored
  });
});

describe("searchRoadmaps", () => {
  it("matches title, description, topics and any video's channel", async () => {
    const byTitle = seedRoadmap({ title: "Neural networks from scratch" });
    const byDesc = seedRoadmap({ title: "A", description: "A tour of neural nets" });
    const byTopic = seedRoadmap({ title: "B", topics: ["Deep learning"] });
    const byChannel = seedRoadmap({ title: "C" });
    seedRoadmap({ title: "Unrelated cooking course" });

    seedTranscript("vid000chan0", { channel: "Some Other Teacher" });
    seedTranscript("vid000chan1", { channel: "DeepMind" });
    // The matching channel is the SECOND video, not the first: courses span
    // teachers, and a search naming the second one must still find the course.
    seedVideo(byChannel, "vid000chan0", 0);
    seedVideo(byChannel, "vid000chan1", 1);

    expect((await searchRoadmaps("neural")).map((r) => r.id).sort()).toEqual(
      [byTitle, byDesc].sort(),
    );
    expect((await searchRoadmaps("deep learning")).map((r) => r.id)).toEqual([byTopic]);
    expect((await searchRoadmaps("cooking")).length).toBe(1);
    expect((await searchRoadmaps("nothing here")).length).toBe(0);

    // The why-line names the channel the query actually matched, which is not
    // the one on the card — the card shows the first video's.
    const hit = (await searchRoadmaps("deepmind"))[0];
    expect(hit.id).toBe(byChannel);
    expect(hit.matchedChannel).toBe("DeepMind");
    expect(hit.channel).toBe("Some Other Teacher");
  });

  it("treats LIKE wildcards in the query as literal characters", async () => {
    seedRoadmap({ title: "100% pure math" });
    const other = seedRoadmap({ title: "Anything at all" });

    // Without `likePattern`'s escaping AND the ESCAPE clause SQLite needs to
    // honour it, "%" is a wildcard and this matches every course in the table.
    const hits = await searchRoadmaps("100%");
    expect(hits.map((h) => h.title)).toEqual(["100% pure math"]);
    expect(hits.map((h) => h.id)).not.toContain(other);
  });

  it("lists the distinct topics the catalog actually carries", async () => {
    seedRoadmap({ title: "A", topics: ["Math", "Science"] });
    seedRoadmap({ title: "B", topics: ["Math"] });
    seedRoadmap({ title: "C", topics: [] });

    expect((await listTopics()).sort()).toEqual(["Math", "Science"]);
  });
});
