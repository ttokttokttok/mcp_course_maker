import { describe, it, expect } from "vitest";

/**
 * The one test in this repo that actually calls OpenAI.
 *
 * It exists because `metadata.test.ts` mocks `generateObject`, and a mocked
 * provider cannot see a constraint the provider imposes. The zod schema is only
 * converted to JSON Schema and validated when a real request is made, so a
 * schema this suite considers perfectly good can still be rejected outright.
 *
 * That is not hypothetical. `videos` was once spelled `.optional()`, which emits
 * a schema omitting the key from `required`, and OpenAI's structured-output mode
 * (strict by default in `@ai-sdk/openai`) rejected every single call with a 400
 * before the model ran:
 *
 *   Invalid schema for response_format 'response': In context=(), 'required' is
 *   required to be supplied and to be an array including every key in
 *   properties. Missing 'videos'.  (code: invalid_json_schema)
 *
 * That broke course naming on every path — creation, add-video, and the publish
 * sheet — and passed `npm run test`, `npm run lint`, `tsc --noEmit` and
 * `npm run build` green, because all four mock or never invoke the provider.
 *
 * So: do not "simplify" this into a mocked test. A mock here would assert only
 * that our own code agrees with itself, which is the exact blind spot that let
 * the outage ship. Nothing below asserts the model's prose — that is
 * nondeterministic, and a flaky smoke test is a deleted smoke test.
 *
 * Gated on the key being present: skips cleanly without one so
 * CI and anyone without one stays green. Vitest's CLI has no `--env-file`, and
 * the config loads no dotenv, so the key has to reach `process.env` via node:
 *
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run \
 *     lib/roadmaps/metadata.live.test.ts
 */
const maybe = process.env.OPENAI_API_KEY ? describe : describe.skip;

const seg = (texts: string[]) => texts.map((text, i) => ({ start: i * 10, duration: 10, text }));

maybe("live metadata derivation (needs OPENAI_API_KEY)", () => {
  it("is accepted by the real API and indexes every summary in range", async () => {
    const { deriveMetadata } = await import("./metadata");
    const { MAX_SUMMARY_LENGTH } = await import("./limits");

    // Two tiny videos. The point is the request being accepted, not the
    // quality of what comes back, so this stays a fraction of a cent.
    const videos = [
      {
        title: "Lecture 1",
        channel: "Test Channel",
        segments: seg([
          "Today we introduce the perceptron, the simplest neural network.",
          "A perceptron computes a weighted sum and applies a step function.",
          "We show why a single perceptron cannot solve the XOR problem.",
        ]),
      },
      {
        title: "Lecture 2",
        channel: "Test Channel",
        segments: seg([
          "Now we stack perceptrons into a multi-layer network.",
          "Backpropagation computes gradients by the chain rule.",
          "We train the network on XOR and it converges.",
        ]),
      },
    ];

    // A schema the API rejects throws here, which is the whole assertion.
    const out = await deriveMetadata({ videos });

    expect(typeof out.title).toBe("string");
    expect(typeof out.description).toBe("string");
    expect(Array.isArray(out.videoSummaries)).toBe(true);

    // Range and uniqueness only. Which videos the model chose to describe is
    // its business; an index outside 1..2 or a duplicate would mean a summary
    // landing on the wrong video, and that is ours.
    const indexes = out.videoSummaries.map((v) => v.index);
    for (const index of indexes) {
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(1);
      expect(index).toBeLessThanOrEqual(videos.length);
    }
    expect(new Set(indexes).size).toBe(indexes.length);

    for (const { summary } of out.videoSummaries) {
      expect(summary.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH);
    }
    // A model call is slower than the default 5s timeout.
  }, 60_000);
});
