import type { Segment } from "./types";

function parseVttTimestamp(ts: string): number {
  const [timePart, msPart = "0"] = ts.trim().split(".");
  const parts = timePart.split(":").map(Number);
  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (parts.length === 3) {
    [hours, minutes, seconds] = parts;
  } else if (parts.length === 2) {
    [minutes, seconds] = parts;
  } else {
    [seconds] = parts;
  }

  const ms = Number(msPart.padEnd(3, "0").slice(0, 3));
  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

function stripVttTags(text: string): string {
  return text.replace(/<[^>]+>/g, "");
}

const CUE_TIMING_RE =
  /^(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?)\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?)/;

export function parseVtt(contents: string): Segment[] {
  const segments: Segment[] = [];
  const lines = contents.replace(/\r\n/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (
      !line ||
      line.startsWith("WEBVTT") ||
      line.startsWith("NOTE") ||
      line.includes("::cue") ||
      line.startsWith("STYLE")
    ) {
      i++;
      continue;
    }

    const timingMatch = line.match(CUE_TIMING_RE);
    if (!timingMatch) {
      i++;
      continue;
    }

    const start = parseVttTimestamp(timingMatch[1]);
    const end = parseVttTimestamp(timingMatch[2]);
    i++;

    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      textLines.push(stripVttTags(lines[i].trim()));
      i++;
    }

    const text = textLines.join(" ").trim();
    if (text) {
      segments.push({ start, duration: end - start, text });
    }
  }

  return segments;
}
