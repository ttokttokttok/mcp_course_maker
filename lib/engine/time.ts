export function parseTimestamp(input: string | number): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) {
      throw new Error(`Invalid timestamp: ${input}`);
    }
    return input;
  }

  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const parts = trimmed.split(":");
  if (parts.length === 2) {
    const [mm, ss] = parts;
    if (!/^\d+$/.test(mm) || !/^\d+$/.test(ss)) {
      throw new Error(`Invalid timestamp: ${input}`);
    }
    const minutes = Number(mm);
    const seconds = Number(ss);
    if (seconds >= 60) {
      throw new Error(`Invalid timestamp: ${input}`);
    }
    return minutes * 60 + seconds;
  }

  if (parts.length === 3) {
    const [hh, mm, ss] = parts;
    if (!/^\d+$/.test(hh) || !/^\d+$/.test(mm) || !/^\d+$/.test(ss)) {
      throw new Error(`Invalid timestamp: ${input}`);
    }
    const hours = Number(hh);
    const minutes = Number(mm);
    const seconds = Number(ss);
    if (minutes >= 60 || seconds >= 60) {
      throw new Error(`Invalid timestamp: ${input}`);
    }
    return hours * 3600 + minutes * 60 + seconds;
  }

  throw new Error(`Invalid timestamp: ${input}`);
}

export function formatTimestamp(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
