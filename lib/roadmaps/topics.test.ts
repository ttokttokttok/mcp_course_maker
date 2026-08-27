import { describe, it, expect } from "vitest";
import { normalizeTopics, MAX_TOPICS, TOPICS } from "./topics";

describe("normalizeTopics", () => {
  it("keeps known topics in vocabulary order", () => {
    expect(normalizeTopics(["Transformers", "Machine learning"])).toEqual([
      "Machine learning",
      "Transformers",
    ]);
  });

  // A model returning one invented tag must not cost the creator the good ones.
  it("drops unknown topics but keeps the rest", () => {
    expect(normalizeTopics(["Machine learning", "Underwater basket weaving"])).toEqual([
      "Machine learning",
    ]);
  });

  it("matches case-insensitively and trims", () => {
    expect(normalizeTopics(["  machine LEARNING "])).toEqual(["Machine learning"]);
  });

  it("dedupes", () => {
    expect(normalizeTopics(["Math", "Math"])).toEqual(["Math"]);
  });

  it("caps the count", () => {
    expect(normalizeTopics([...TOPICS])?.length).toBe(MAX_TOPICS);
  });

  it("returns an empty array when nothing survives", () => {
    expect(normalizeTopics(["nope"])).toEqual([]);
  });

  // null is reserved for "this isn't a list at all", which callers turn into a
  // 400. An empty result is a valid, saveable state.
  it("returns null for a non-array", () => {
    expect(normalizeTopics("Math")).toBeNull();
    expect(normalizeTopics(undefined)).toBeNull();
    expect(normalizeTopics(null)).toBeNull();
  });

  it("ignores non-string members", () => {
    expect(normalizeTopics([42, "Math", null])).toEqual(["Math"]);
  });
});
