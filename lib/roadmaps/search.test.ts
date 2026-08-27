import { describe, it, expect } from "vitest";
import {
  normalizeQuery,
  likePattern,
  highlight,
  MAX_QUERY,
  matchReasons,
  browsableTopics,
} from "./search";

describe("normalizeQuery", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normalizeQuery("  neural   networks ")).toBe("neural networks");
  });

  // null, not "", so /search can render a prompt rather than silently listing
  // the whole catalog.
  it("returns null for empty and whitespace-only input", () => {
    expect(normalizeQuery("")).toBeNull();
    expect(normalizeQuery("   ")).toBeNull();
  });

  it("returns null for anything that is not a string", () => {
    expect(normalizeQuery(undefined)).toBeNull();
    expect(normalizeQuery(["a"])).toBeNull();
    expect(normalizeQuery(42)).toBeNull();
  });

  it("clamps to MAX_QUERY", () => {
    expect(normalizeQuery("x".repeat(500))?.length).toBe(MAX_QUERY);
  });
});

describe("likePattern", () => {
  it("wraps a plain query in wildcards", () => {
    expect(likePattern("rust")).toBe("%rust%");
  });

  // Without this, a query containing % matches every course in the catalog —
  // a bug that only shows up on a query nobody thinks to try.
  it("escapes LIKE wildcards so they match literally", () => {
    expect(likePattern("100%")).toBe("%100\\%%");
    expect(likePattern("a_b")).toBe("%a\\_b%");
  });

  // Escape the escape character first, or "\%" becomes "\\%" — an escaped
  // backslash followed by a live wildcard.
  it("escapes the escape character itself", () => {
    expect(likePattern("a\\b")).toBe("%a\\\\b%");
  });
});

describe("highlight", () => {
  it("returns one non-hit segment when nothing matches", () => {
    expect(highlight("Deep learning", "rust")).toEqual([{ text: "Deep learning", hit: false }]);
  });

  it("splits around a single match", () => {
    expect(highlight("Intro to Neural Networks", "neural")).toEqual([
      { text: "Intro to ", hit: false },
      { text: "Neural", hit: true },
      { text: " Networks", hit: false },
    ]);
  });

  it("marks every occurrence", () => {
    expect(highlight("ab ab", "ab")).toEqual([
      { text: "ab", hit: true },
      { text: " ", hit: false },
      { text: "ab", hit: true },
    ]);
  });

  // The hit keeps the ORIGINAL casing, not the query's.
  it("matches case-insensitively and preserves the source casing", () => {
    expect(highlight("Karpathy", "karp")).toEqual([
      { text: "Karp", hit: true },
      { text: "athy", hit: false },
    ]);
  });

  // indexOf, not RegExp — so metacharacters are inert with no escaping needed.
  it("treats regex metacharacters as literal text", () => {
    expect(highlight("a.b", ".")).toEqual([
      { text: "a", hit: false },
      { text: ".", hit: true },
      { text: "b", hit: false },
    ]);
    expect(highlight("axb", ".")).toEqual([{ text: "axb", hit: false }]);
  });

  it("returns the whole string for an empty query", () => {
    expect(highlight("anything", "")).toEqual([{ text: "anything", hit: false }]);
  });
});

describe("matchReasons", () => {
  const course = {
    title: "Introduction to Neural Networks",
    description: "Builds from a single neuron to policy gradients.",
    topics: ["Deep learning", "Reinforcement learning"],
  };

  it("names the title alone", () => {
    expect(matchReasons(course, null, "neural")).toBe("matched title");
  });

  it("names the description alone", () => {
    expect(matchReasons(course, null, "policy")).toBe("matched description");
  });

  it("names a topic alone", () => {
    expect(matchReasons(course, null, "reinforcement")).toBe("matched topic");
  });

  it("joins several fields in field order", () => {
    // "learning" is in neither the title nor the description; "networks" is in
    // the title only. "neuro" would be neither. Use a term in both.
    expect(matchReasons(course, null, "n")).toBe("matched title + description + topic");
  });

  /**
   * The load-bearing case. The card shows the FIRST video's channel, so a match
   * on video 4's channel renders a card whose channel line does not contain the
   * term the visitor typed — it reads as a false positive unless this line
   * names the channel it actually matched.
   */
  it("names the channel it matched, not just 'channel'", () => {
    expect(matchReasons(course, "DeepMind", "deepmind")).toBe("matched channel · DeepMind");
  });

  it("combines a channel match with a field match", () => {
    expect(matchReasons(course, "DeepMind", "neural")).toBe("matched title + channel · DeepMind");
  });

  it("returns an empty string when nothing matched", () => {
    expect(matchReasons(course, null, "rust")).toBe("");
  });

  it("returns an empty string for an empty query", () => {
    expect(matchReasons(course, null, "  ")).toBe("");
  });
});

describe("browsableTopics", () => {
  it("keeps known topics in taxonomy order, not input order", () => {
    expect(browsableTopics(["Systems", "Machine learning"])).toEqual([
      "Machine learning",
      "Systems",
    ]);
  });

  it("drops terms outside the closed vocabulary", () => {
    expect(browsableTopics(["Machine learning", "Underwater basket weaving", "Math"])).toEqual([
      "Machine learning",
      "Math",
    ]);
  });

  it("matches case-insensitively and trims", () => {
    expect(browsableTopics(["  deep LEARNING ", "Math"])).toEqual(["Deep learning", "Math"]);
  });

  it("dedupes", () => {
    expect(browsableTopics(["Math", "Math", "Systems"])).toEqual(["Math", "Systems"]);
  });

  // An empty or one-item filter bar advertises an empty catalog.
  it("hides itself below two topics", () => {
    expect(browsableTopics([])).toEqual([]);
    expect(browsableTopics(["Math"])).toEqual([]);
    expect(browsableTopics(["Math", "Underwater basket weaving"])).toEqual([]);
  });
});
