"use client";

import { useEffect, useRef, useState } from "react";
import { YouTubePlayer } from "@/components/YouTubePlayer";
import { StudioChat, type StudioVideo } from "@/components/StudioChat";
import { Timecode } from "@/components/Timecode";
import { usePlayerStore } from "@/components/player-store";
import { CourseDetails } from "@/components/CourseDetails";
import { MAX_TITLE_LENGTH } from "@/lib/roadmaps/title";

/**
 * No longer a superset — the chat needs `ingestStatus` too, so `StudioVideo`
 * carries it. Kept as a name because the page and the videos route both speak
 * in rows, and renaming that vocabulary is not what this change is about.
 */
export type StudioVideoRow = StudioVideo;

/**
 * `failed` is the only status that is also an offer. Before the retry endpoint
 * existed, a transient 429 killed a video permanently and the only escape was
 * delete-and-re-add — so the failure and its remedy now live in the same place.
 *
 * Not orange. The one `--brand` on this screen is the tutor's Send button in
 * `StudioChat` — a retry offer inside a status pill is not competing for it.
 */
function StatusPill({
  status,
  title,
  onRetry,
}: {
  status: string;
  title: string;
  onRetry?: () => void;
}) {
  const map: Record<string, { label: string; color: string; blink?: boolean }> = {
    ready: { label: "ready", color: "var(--good)" },
    pending: { label: "transcribing", color: "var(--muted-foreground)", blink: true },
    failed: { label: "failed", color: "var(--bad)" },
  };
  const s = map[status] ?? map.pending;
  const retryable = status === "failed" && onRetry !== undefined;
  const body = (
    <>
      <span
        aria-hidden
        className={"h-1.5 w-1.5 rounded-full " + (s.blink ? "motion-safe:animate-pulse" : "")}
        style={{ background: "currentColor" }}
      />
      {s.label}
      {retryable && <span className="font-normal"> · retry</span>}
    </>
  );
  const className =
    "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold";
  const style = {
    color: s.color,
    background: "color-mix(in srgb, currentColor 13%, transparent)",
  } as const;

  if (!retryable) {
    return (
      <span className={className} style={style}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onRetry}
      // Named for its row, like the remove button beside it: the visible text is
      // the same three words on every failed video, so a screen reader tabbing a
      // long outline would otherwise hear "failed · retry" N times over.
      aria-label={`Retry transcribing ${title}`}
      title="Try transcribing this video again"
      className={`${className} focus-visible:outline-2 focus-visible:outline-offset-[3px]`}
      style={{ ...style, outlineColor: "var(--time)" }}
    >
      {body}
    </button>
  );
}

export function Studio({
  roadmapId,
  title: initialTitle,
  videos: initialVideos,
  description,
  audience,
  topics,
}: {
  roadmapId: string;
  title: string;
  videos: StudioVideoRow[];
  description: string;
  audience: string;
  topics: string[];
}) {
  const [videos, setVideos] = useState<StudioVideoRow[]>(initialVideos);
  const [meta, setMeta] = useState({ description, audience, topics });
  const [title, setTitle] = useState(initialTitle);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(initialTitle);
  // Escape has to cancel, but it reaches the input's blur handler as an ordinary
  // blur. This flag is how blur tells "committed with Enter" from "abandoned".
  const cancelTitleEdit = useRef(false);
  const [addUrl, setAddUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const activeVideoId = usePlayerStore((s) => s.activeVideoId);
  const positionSec = usePlayerStore((s) => s.positionSec);
  const seek = usePlayerStore((s) => s.seek);
  const dragIndex = useRef<number | null>(null);

  const firstVideoId = videos[0]?.videoId ?? "";

  // A course is unnamed until someone names it, so `title` is legitimately ""
  // on a fresh course. Show what it contains instead. This is display only: the
  // rename field opens with `title`, so a fallback can never be committed as
  // though the owner had typed it.
  //
  // `video.title` is never empty — the page substitutes the raw videoId when no
  // transcript title exists yet, and the provider itself stores `title: videoId`
  // as a placeholder until backfill enriches it. Naming a course "VMj-3S1tku0"
  // is worse than admitting it has no name, so treat that sentinel as absent.
  //
  // `find`, not `videos[0]`: the catalog card falls back to the first video with
  // a real title (roadmaps.ts filters placeholders before its limit), and a
  // course whose first video is still mid-ingest must not answer to two
  // different names depending on which page you are looking at.
  const firstTitle = videos.find((v) => v.title !== v.videoId)?.title ?? "";
  const displayTitle = title.trim() || firstTitle || "Untitled course";

  useEffect(() => {
    if (!usePlayerStore.getState().activeVideoId && firstVideoId) {
      usePlayerStore.getState().setActiveVideo(firstVideoId);
    }
  }, [firstVideoId]);

  const persistOrder = async (ordered: StudioVideoRow[]) => {
    try {
      await fetch(`/api/roadmaps/${roadmapId}/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedVideoIds: ordered.map((v) => v.videoId) }),
      });
    } catch {
      /* best-effort */
    }
  };

  /**
   * A newly added video lands as `pending` and flips to `ready` when ingestion
   * finishes server-side, which the client has no way to hear about. So poll —
   * but ONLY while something is actually pending, and stop the moment nothing
   * is. Ingestion always resolves (ready or failed), so this terminates; it is
   * not the idle-tab-forever poll the notes panel used to run.
   */
  const hasPending = videos.some((v) => v.ingestStatus === "pending");
  useEffect(() => {
    if (!hasPending) return;
    let cancelled = false;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/roadmaps/${roadmapId}/videos`);
        if (!res.ok) return;
        const data = (await res.json()) as { videos: StudioVideoRow[] };
        if (!cancelled) setVideos(data.videos);
      } catch {
        /* transient; the next tick retries */
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [hasPending, roadmapId]);

  const addVideo = async () => {
    const url = addUrl.trim();
    if (!url || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/roadmaps/${roadmapId}/videos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: [url] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error ?? "Could not add that video.");
        return;
      }
      setVideos(data.videos);
      // Parsed fine but every id was already here — say so rather than looking
      // like nothing happened.
      if (data.added.length === 0) setAddError("That video is already in this course.");
      else setAddUrl("");
    } catch {
      setAddError("Could not add that video.");
    } finally {
      setAdding(false);
    }
  };

  const commitTitle = async () => {
    const next = draftTitle.trim();
    if (next === "" || next === title) {
      setDraftTitle(title); // reject a blank rename rather than erasing the name
      return;
    }
    const prev = title;
    setTitle(next); // optimistic
    try {
      const res = await fetch(`/api/roadmaps/${roadmapId}/title`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) {
        setTitle(prev);
        setDraftTitle(prev);
      }
    } catch {
      setTitle(prev);
      setDraftTitle(prev);
    }
  };

  const removeVideo = async (videoId: string) => {
    const prev = videos;
    const next = videos.filter((v) => v.videoId !== videoId);
    setVideos(next); // optimistic

    // The player would otherwise sit on a video the course no longer has.
    if (usePlayerStore.getState().activeVideoId === videoId && next[0]) {
      seek(next[0].videoId, 0);
    }

    try {
      const res = await fetch(`/api/roadmaps/${roadmapId}/videos/${videoId}`, {
        method: "DELETE",
      });
      if (!res.ok) setVideos(prev);
    } catch {
      setVideos(prev);
    }
  };

  /**
   * Optimistically flips to `pending`, which also restarts the poll that
   * reports the outcome — `hasPending` is what gates it.
   *
   * Both writes are per-video rather than a snapshot-and-restore of the whole
   * list, unlike the other optimistic handlers here: this is the one that
   * deliberately starts the poll, so a stale `prev` array put back on failure
   * could undo statuses the poll has already learned for other videos. The
   * button only renders on `failed`, so that is what a failure reverts to.
   */
  const retryVideo = async (videoId: string) => {
    const set = (ingestStatus: string) =>
      setVideos((vs) => vs.map((v) => (v.videoId === videoId ? { ...v, ingestStatus } : v)));
    set("pending");
    try {
      const res = await fetch(`/api/roadmaps/${roadmapId}/videos/${videoId}/retry`, {
        method: "POST",
      });
      // 409 means the server is already fetching this one, so `pending` is the
      // truth and the optimistic write stands. Reverting on it would be a
      // double loss: the row would read `failed` for a video that is actively
      // being transcribed, AND clearing the last `pending` stops the poll, so
      // nothing would ever correct it. Reachable with two tabs open on one
      // course — the second tab is not polling, so it still offers the button.
      if (!res.ok && res.status !== 409) set("failed");
    } catch {
      set("failed");
    }
  };

  const onDrop = (to: number) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === to) return;
    setVideos((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      void persistOrder(next);
      return next;
    });
  };

  return (
    <main className="mx-auto w-full max-w-[1100px] px-5 py-8">
      <header
        className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b pb-4"
        style={{ borderColor: "var(--line)" }}
      >
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">
            Course
          </div>
          {editingTitle ? (
            <input
              value={draftTitle}
              autoFocus
              maxLength={MAX_TITLE_LENGTH}
              aria-label="Course title"
              onChange={(e) => setDraftTitle(e.target.value)}
              // Enter and Escape both just blur; the blur handler is the single
              // commit path, so a keypress can never save twice.
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  cancelTitleEdit.current = true;
                  e.currentTarget.blur();
                }
              }}
              onBlur={() => {
                setEditingTitle(false);
                if (cancelTitleEdit.current) {
                  cancelTitleEdit.current = false;
                  setDraftTitle(title);
                  return;
                }
                void commitTitle();
              }}
              className="mt-1 w-full min-w-0 rounded-[7px] border bg-card px-2 py-0.5 font-display text-2xl font-extrabold tracking-tight outline-none focus-visible:outline-2 focus-visible:outline-offset-[3px]"
              style={{ borderColor: "var(--line)", outlineColor: "var(--time)" }}
            />
          ) : (
            <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-extrabold tracking-tight">
              {displayTitle}
              <button
                type="button"
                onClick={() => {
                  setDraftTitle(title);
                  setEditingTitle(true);
                }}
                aria-label="Rename this course"
                title="Rename this course"
                className="shrink-0 rounded-[6px] px-1 text-[15px] leading-none text-faint hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[3px]"
                style={{ outlineColor: "var(--time)" }}
              >
                ✎
              </button>
            </h1>
          )}
          {/* Under the heading rather than in a modal, so it reads as part of
              the course rather than as a gate on the way to anything else. */}
          <CourseDetails
            roadmapId={roadmapId}
            initial={{
              title,
              description: meta.description,
              audience: meta.audience,
              topics: meta.topics,
            }}
            onSaved={(saved) => setMeta(saved)}
          />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_1fr]">
        {/* left column: player + scrub + outline */}
        <div className="flex min-w-0 flex-col gap-3">
          {firstVideoId ? (
            <YouTubePlayer initialVideoId={firstVideoId} />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-[10px] bg-[#0b0e13] text-sm text-white/60">
              No videos in this course.
            </div>
          )}

          {/* scrub readout — shares the teal timecode vocabulary */}
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] text-faint">00:00</span>
            <Timecode
              seconds={positionSec}
              videoId={activeVideoId ?? firstVideoId}
              onSeek={(sec, vid) => seek(vid ?? activeVideoId ?? firstVideoId, sec)}
              size="lg"
              title="Current position"
            />
            <span className="font-mono text-[11px] text-faint">live</span>
          </div>

          {/* outline */}
          <div className="rounded-[10px] bg-muted p-1.5">
            {videos.map((v, i) => {
              const active = v.videoId === activeVideoId;
              return (
                <div
                  key={v.videoId}
                  draggable
                  onDragStart={() => (dragIndex.current = i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(i)}
                  className={
                    "flex items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-[13px] " +
                    (active ? "bg-card shadow-sm font-semibold" : "")
                  }
                >
                  <span
                    aria-hidden
                    className="cursor-grab select-none text-base leading-none text-faint"
                    title="Drag to reorder"
                  >
                    ⠿
                  </span>
                  <span className="w-3.5 font-mono text-[11px] text-faint">{i + 1}</span>
                  <button
                    type="button"
                    onClick={() => seek(v.videoId, 0)}
                    className="min-w-0 flex-1 truncate text-left focus-visible:outline-2 focus-visible:outline-offset-[3px]"
                    style={{ outlineColor: "var(--time)" }}
                    title={v.title}
                  >
                    {v.title}
                  </button>
                  {/*
                   * `failed` outranks `active`, or the retry button is missing
                   * exactly where it is needed most. The active row normally
                   * shows a scrubber instead of a status, but `videos[0]` is
                   * auto-activated on mount — so on a one-video course whose
                   * only video failed, that row is always active and the button
                   * never rendered at all. On a longer course, clicking the
                   * failed video to investigate it made the remedy disappear.
                   * A failed video has no transcript to scrub anyway, so the
                   * Timecode was the less useful of the two here regardless.
                   */}
                  {active && v.ingestStatus !== "failed" ? (
                    <Timecode
                      seconds={positionSec}
                      videoId={v.videoId}
                      onSeek={(sec, vid) => seek(vid ?? v.videoId, sec)}
                    />
                  ) : (
                    <StatusPill
                      status={v.ingestStatus}
                      title={v.title}
                      onRetry={() => void retryVideo(v.videoId)}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removeVideo(v.videoId)}
                    aria-label={`Remove ${v.title} from this course`}
                    title="Remove from this course"
                    className="shrink-0 rounded-[6px] px-1.5 text-base leading-none text-faint hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[3px]"
                    style={{ outlineColor: "var(--time)" }}
                  >
                    ×
                  </button>
                </div>
              );
            })}

            <div className="flex items-center gap-2 px-2.5 pb-1 pt-2">
              <input
                value={addUrl}
                onChange={(e) => {
                  setAddUrl(e.target.value);
                  setAddError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addVideo();
                }}
                placeholder="Paste a YouTube link to add…"
                aria-label="YouTube link to add to this course"
                className="min-w-0 flex-1 rounded-[7px] border bg-card px-2.5 py-1.5 text-[13px] outline-none focus-visible:outline-2 focus-visible:outline-offset-[3px]"
                style={{ borderColor: "var(--line)", outlineColor: "var(--time)" }}
              />
              <button
                type="button"
                onClick={() => void addVideo()}
                disabled={adding || addUrl.trim() === ""}
                className="shrink-0 rounded-[7px] border px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
                style={{ borderColor: "var(--line)" }}
              >
                {adding ? "Adding…" : "Add"}
              </button>
            </div>
            {addError && (
              <p className="px-2.5 pb-1.5 text-[12px]" style={{ color: "var(--bad)" }}>
                {addError}
              </p>
            )}
          </div>
        </div>

        {/* right column: chat */}
        <div className="min-w-0">
          <StudioChat roadmapId={roadmapId} videos={videos} />
        </div>
      </div>
    </main>
  );
}
