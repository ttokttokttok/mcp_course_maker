/**
 * Pure display helpers for a course card. Deliberately db-free and
 * network-free, in the same spirit as `title.ts` and `access.ts`: vitest only
 * collects `*.test.ts`, so any logic worth testing has to live outside the
 * `.tsx` component.
 */

/** "4h 22m" · "27m" · null when nothing is known. */
export function formatDuration(sec: number | null): string | null {
  if (sec === null || !Number.isFinite(sec) || sec <= 0) return null;
  const totalMinutes = Math.max(1, Math.round(sec / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/**
 * YouTube's public thumbnail CDN — no key, no quota. Served straight to an
 * <img>; routing an already-optimised 320px JPEG through Next's image optimiser
 * would spend CPU per card for nothing.
 */
export function thumbnailUrl(videoId: string | null): string | null {
  if (!videoId) return null;
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}
