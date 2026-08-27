import { describe, it, expect } from "vitest";
import { parseTimestamp, formatTimestamp } from "./time";

describe("parseTimestamp", () => {
  it("parses mm:ss", () => {
    expect(parseTimestamp("12:34")).toBe(754);
  });
  it("parses h:mm:ss", () => {
    expect(parseTimestamp("1:02:03")).toBe(3723);
  });
  it("parses numeric seconds", () => {
    expect(parseTimestamp(90)).toBe(90);
    expect(parseTimestamp("90")).toBe(90);
  });
  it("rejects garbage", () => {
    expect(() => parseTimestamp("nope")).toThrow(/Invalid timestamp/);
  });
});

describe("formatTimestamp", () => {
  it("formats under an hour", () => {
    expect(formatTimestamp(754)).toBe("12:34");
  });
  it("formats over an hour", () => {
    expect(formatTimestamp(3723)).toBe("1:02:03");
  });
});
