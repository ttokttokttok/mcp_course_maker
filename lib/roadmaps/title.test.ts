import { describe, it, expect } from "vitest";
import { MAX_TITLE_LENGTH, normalizeTitle } from "./title";

describe("normalizeTitle", () => {
  it("trims and keeps a usable title", () => {
    expect(normalizeTitle("  RL from scratch  ")).toBe("RL from scratch");
    expect(normalizeTitle("a")).toBe("a");
    expect(normalizeTitle("x".repeat(MAX_TITLE_LENGTH))).toBe("x".repeat(MAX_TITLE_LENGTH));
  });

  it("rejects a title that is empty once trimmed", () => {
    expect(normalizeTitle("")).toBeNull();
    expect(normalizeTitle("   ")).toBeNull();
    expect(normalizeTitle("\n\t ")).toBeNull();
  });

  it("rejects a title past the cap — measured AFTER trimming", () => {
    expect(normalizeTitle("x".repeat(MAX_TITLE_LENGTH + 1))).toBeNull();
    // Padding must not push an otherwise-fine title over the limit.
    expect(normalizeTitle(`  ${"x".repeat(MAX_TITLE_LENGTH)}  `)).toBe(
      "x".repeat(MAX_TITLE_LENGTH),
    );
  });

  it("rejects anything that is not a string — bodies are unvalidated JSON", () => {
    expect(normalizeTitle(undefined)).toBeNull();
    expect(normalizeTitle(null)).toBeNull();
    expect(normalizeTitle(7)).toBeNull();
    expect(normalizeTitle({ title: "nope" })).toBeNull();
    expect(normalizeTitle(["nope"])).toBeNull();
  });
});
