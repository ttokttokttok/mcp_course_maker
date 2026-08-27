import { describe, it, expect, vi } from "vitest";
import { SupadataTranscriptProvider } from "./supadata";
import { TranscriptFetchError } from "./errors";

describe("SupadataTranscriptProvider", () => {
  it("maps the vendor response (ms offsets) to a TranscriptDoc (seconds)", async () => {
    // Mirrors the verified live Supadata shape: content[].{text,offset,duration,lang}
    // plus top-level lang/availableLangs, and no title/channel.
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [
              { text: "hello", offset: 0, duration: 2000, lang: "en" },
              { text: "world", offset: 2000, duration: 1500, lang: "en" },
            ],
            lang: "en",
            availableLangs: ["en"],
          }),
          { status: 200 },
        ),
    );
    const p = new SupadataTranscriptProvider("KEY", fakeFetch as unknown as typeof fetch);
    const doc = await p.fetchTranscript("VMj-3S1tku0");

    expect(fakeFetch).toHaveBeenCalledWith(
      "https://api.supadata.ai/v1/youtube/transcript?videoId=VMj-3S1tku0",
      { headers: { "x-api-key": "KEY" } },
    );
    expect(doc.videoId).toBe("VMj-3S1tku0");
    expect(doc.source).toBe("captions");
    expect(doc.language).toBe("en");
    expect(doc.segments).toHaveLength(2);
    expect(doc.segments[0].start).toBeCloseTo(0);
    expect(doc.segments[0].duration).toBeCloseTo(2);
    expect(doc.segments[0].text).toBe("hello");
    expect(doc.segments[1].start).toBeCloseTo(2);
  });

  it("throws on non-200", async () => {
    const fakeFetch = vi.fn(async () => new Response("nope", { status: 429 }));
    const p = new SupadataTranscriptProvider("KEY", fakeFetch as unknown as typeof fetch);
    await expect(p.fetchTranscript("VMj-3S1tku0")).rejects.toThrow();
  });

  it("throws when the API key is missing", async () => {
    const fakeFetch = vi.fn();
    const p = new SupadataTranscriptProvider("", fakeFetch as unknown as typeof fetch);
    await expect(p.fetchTranscript("VMj-3S1tku0")).rejects.toThrow(/SUPADATA_API_KEY/);
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});

describe("SupadataTranscriptProvider error reporting", () => {
  const failing = (status: number, body: string) =>
    vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;

  // The diagnosis that took an hour took it because this body was thrown away.
  it("keeps the vendor's own error code on a 429", async () => {
    const p = new SupadataTranscriptProvider(
      "key",
      failing(
        429,
        '{"error":"limit-exceeded","details":"Request rate limit on current plan was exceeded."}',
      ),
    );
    const err = (await p
      .fetchTranscript("sXZYo9pPaaA")
      .catch((e: unknown) => e)) as TranscriptFetchError;
    expect(err).toBeInstanceOf(TranscriptFetchError);
    expect(err.status).toBe(429);
    expect(err.code).toBe("limit-exceeded");
    expect(err.isRateLimited).toBe(true);
    // The detail is what a human reads in the log, so it must survive.
    expect(err.message).toContain("Request rate limit");
    expect(err.message).toContain("sXZYo9pPaaA");
  });

  // A deleted video is not transient. `RetryingTranscriptProvider` must not
  // retry it, and this getter is the only thing it asks.
  it("reports a 404 as not rate limited", async () => {
    const p = new SupadataTranscriptProvider("key", failing(404, '{"error":"not-found"}'));
    const err = (await p
      .fetchTranscript("gonegonegon")
      .catch((e: unknown) => e)) as TranscriptFetchError;
    expect(err.status).toBe(404);
    expect(err.isRateLimited).toBe(false);
  });

  // An HTML 502 page from a proxy is not JSON. Reading the body must never be
  // the thing that throws — we would lose the status, which is all we have.
  it("survives a non-JSON error body", async () => {
    const p = new SupadataTranscriptProvider("key", failing(502, "<html>502 Bad Gateway</html>"));
    const err = (await p
      .fetchTranscript("aaaaaaaaaaa")
      .catch((e: unknown) => e)) as TranscriptFetchError;
    expect(err).toBeInstanceOf(TranscriptFetchError);
    expect(err.status).toBe(502);
    expect(err.code).toBe("");
  });
});
