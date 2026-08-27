import { describe, it, expect, vi } from "vitest";
import { OEmbedVideoMetaProvider, needsTitle } from "./meta";
import type { TranscriptDoc } from "@/lib/engine/types";

const doc = (over: Partial<TranscriptDoc>): TranscriptDoc => ({
  videoId: "VMj-3S1tku0",
  title: "T",
  channel: "C",
  source: "captions",
  language: "en",
  fetchedAt: "2026-01-01T00:00:00.000Z",
  segments: [],
  ...over,
});

const providerWith = (impl: () => Promise<Response>) =>
  new OEmbedVideoMetaProvider(vi.fn(impl) as unknown as typeof fetch);

describe("needsTitle", () => {
  it("is true for an empty or whitespace-only title", () => {
    expect(needsTitle(doc({ title: "" }))).toBe(true);
    expect(needsTitle(doc({ title: "   " }))).toBe(true);
  });

  it("is true when the title is just the videoId (the placeholder)", () => {
    expect(needsTitle(doc({ title: "VMj-3S1tku0" }))).toBe(true);
  });

  it("is false for a real title", () => {
    expect(needsTitle(doc({ title: "Attention Is All You Need" }))).toBe(false);
  });
});

describe("OEmbedVideoMetaProvider", () => {
  it("maps title/author_name and percent-encodes the watch URL", async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ title: "Deep Learning", author_name: "3Blue1Brown" }), {
          status: 200,
        }),
    );
    const p = new OEmbedVideoMetaProvider(fakeFetch as unknown as typeof fetch);

    expect(await p.fetchMeta("VMj-3S1tku0")).toEqual({
      title: "Deep Learning",
      channel: "3Blue1Brown",
    });
    expect(fakeFetch).toHaveBeenCalledWith(
      "https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DVMj-3S1tku0&format=json",
    );
  });

  it("returns null on 404 (deleted/private) and 401 (embedding disabled)", async () => {
    for (const status of [404, 401]) {
      const p = providerWith(async () => new Response("no", { status }));
      expect(await p.fetchMeta("VMj-3S1tku0")).toBeNull();
    }
  });

  it("returns null when the network throws", async () => {
    const p = providerWith(async () => {
      throw new Error("offline");
    });
    expect(await p.fetchMeta("VMj-3S1tku0")).toBeNull();
  });

  it("returns null on a malformed body or a missing title", async () => {
    const html = providerWith(async () => new Response("<html>nope</html>", { status: 200 }));
    expect(await html.fetchMeta("VMj-3S1tku0")).toBeNull();

    const noTitle = providerWith(
      async () => new Response(JSON.stringify({ author_name: "x" }), { status: 200 }),
    );
    expect(await noTitle.fetchMeta("VMj-3S1tku0")).toBeNull();
  });

  it("defaults channel to empty when author_name is absent", async () => {
    const p = providerWith(
      async () => new Response(JSON.stringify({ title: "T" }), { status: 200 }),
    );
    expect(await p.fetchMeta("VMj-3S1tku0")).toEqual({ title: "T", channel: "" });
  });
});
