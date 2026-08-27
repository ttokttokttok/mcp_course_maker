import { describe, it, expect } from "vitest";
import { formatDuration, thumbnailUrl } from "./card";

describe("formatDuration", () => {
  it("renders hours and minutes for a long course", () => {
    expect(formatDuration(15720)).toBe("4h 22m");
  });

  it("renders minutes alone under an hour", () => {
    expect(formatDuration(1626)).toBe("27m");
  });

  // Rounds up rather than down: a 40-second video reading "0m" looks broken,
  // and no card is improved by the distinction between 0 and 1 minutes.
  it("never renders zero minutes", () => {
    expect(formatDuration(40)).toBe("1m");
  });

  it("drops a zero minute remainder", () => {
    expect(formatDuration(7200)).toBe("2h");
  });

  // null means "no video has a transcript yet" — the card omits the field and
  // its separator rather than claiming a duration of nothing.
  it("returns null for null and for nonsense", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(-5)).toBeNull();
  });
});

describe("thumbnailUrl", () => {
  // mqdefault is the 16:9 crop. hqdefault is 4:3 and arrives letterboxed;
  // maxresdefault 404s on plenty of videos.
  it("builds the mqdefault URL", () => {
    expect(thumbnailUrl("kCc8FmEb1nY")).toBe("https://i.ytimg.com/vi/kCc8FmEb1nY/mqdefault.jpg");
  });

  it("returns null when the course has no videos", () => {
    expect(thumbnailUrl(null)).toBeNull();
    expect(thumbnailUrl("")).toBeNull();
  });
});
