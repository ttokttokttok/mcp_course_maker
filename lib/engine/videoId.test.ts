import { describe, it, expect } from "vitest";
import { parseVideoId } from "./videoId";

describe("parseVideoId", () => {
  it("accepts bare ID", () => {
    expect(parseVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("parses watch URL", () => {
    expect(parseVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("parses youtu.be", () => {
    expect(parseVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("parses shorts", () => {
    expect(parseVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("rejects invalid", () => {
    expect(() => parseVideoId("not a video")).toThrow(/Invalid YouTube/);
  });
});
