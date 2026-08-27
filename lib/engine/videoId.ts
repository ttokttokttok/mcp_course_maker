const VIDEO_ID_PATTERN = /^[\w-]{11}$/;

function extractFromUrl(input: string): string | null {
  try {
    const url = new URL(input);
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = url.pathname.slice(1).split("/")[0];
      return VIDEO_ID_PATTERN.test(id) ? id : null;
    }

    if (host === "youtube.com" || host === "m.youtube.com") {
      const watchId = url.searchParams.get("v");
      if (watchId && VIDEO_ID_PATTERN.test(watchId)) {
        return watchId;
      }

      const shortsMatch = url.pathname.match(/^\/shorts\/([\w-]{11})/);
      if (shortsMatch) {
        return shortsMatch[1];
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function parseVideoId(input: string): string {
  const trimmed = input.trim();

  if (VIDEO_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const fromUrl = extractFromUrl(trimmed);
  if (fromUrl) {
    return fromUrl;
  }

  throw new Error(`Invalid YouTube URL or video ID: ${input}`);
}
