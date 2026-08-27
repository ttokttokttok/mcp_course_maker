"use client";

import { formatTimestamp } from "@/lib/engine/time";

/**
 * The signature object: a teal tick + mono timecode chip that is ALWAYS a
 * seek-link. Reused everywhere a timestamp is shown — player readout, active
 * outline row, chat answers, search hits, and the notes timeline.
 */
export function Timecode({
  seconds,
  videoId,
  onSeek,
  size = "sm",
  title,
}: {
  seconds: number;
  videoId?: string;
  onSeek: (seconds: number, videoId?: string) => void;
  size?: "sm" | "lg";
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title ?? `Jump to ${formatTimestamp(seconds)}`}
      onClick={() => onSeek(seconds, videoId)}
      className={
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border font-mono font-semibold tracking-tight transition-[filter] hover:brightness-[.97] focus-visible:outline-2 focus-visible:outline-offset-[3px] motion-reduce:transition-none " +
        (size === "lg" ? "px-2.5 py-1.5 text-sm" : "px-1.5 py-1 text-xs")
      }
      style={{
        color: "var(--time)",
        background: "var(--time-soft)",
        borderColor: "var(--time-line)",
        outlineColor: "var(--time)",
      }}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: "var(--time)" }}
      />
      {formatTimestamp(seconds)}
    </button>
  );
}
