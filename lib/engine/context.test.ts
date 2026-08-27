import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { parseVtt } from "./vtt";
import { getContextWindow } from "./context";

describe("getContextWindow", () => {
  it("includes overlapping segments within half window", async () => {
    const fixturePath = path.join(import.meta.dirname, "fixtures", "sample.en.vtt");
    const contents = await fs.readFile(fixturePath, "utf8");
    const segments = parseVtt(contents);

    const window = getContextWindow(segments, 754, 60);

    expect(window.positionSec).toBe(754);
    expect(window.startSec).toBe(694);
    expect(window.endSec).toBe(814);
    expect(window.segments).toHaveLength(1);
    expect(window.segments[0].text).toContain("Attention");
  });
});
