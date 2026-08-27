import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { parseVtt } from "./vtt";

describe("parseVtt", () => {
  it("parses sample fixture into 3 segments", async () => {
    const fixturePath = path.join(import.meta.dirname, "fixtures", "sample.en.vtt");
    const contents = await fs.readFile(fixturePath, "utf8");
    const segments = parseVtt(contents);

    expect(segments).toHaveLength(3);
    expect(segments[1].start).toBe(750);
    expect(segments[1].text).toContain("Attention");
  });
});
