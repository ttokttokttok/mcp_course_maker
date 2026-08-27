import { useMemo, useState } from "react";
import { useCallTool, useOpenExternal, useToolContext } from "mcp-use/react";

/**
 * The course player, rendered inside the host's sandboxed iframe.
 *
 * Three things in one surface, because they are useless apart: the video, the
 * ordered outline, and search over what was actually said. Clicking a search hit
 * moves the player to that second — which is the whole reason a course of
 * lectures is worth turning into a course at all.
 *
 * Styling is inline and dependency-free. The view is compiled by mcp-use's own
 * Vite pipeline rather than by Next, so the app's Tailwind setup is not in scope
 * here, and a widget that has to ship a CSS framework to draw six boxes is worse
 * than one that does not.
 */

const INK = "#12141a";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const BRAND = "#ff5c1a";
const TIME = "#0f8b8d";

/** "1:03:12" / "4:07". The view's own copy, because it renders on the client. */
function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** "4h 22m" · "27m" · null when nothing is known. */
function runtime(sec: number | null): string | null {
  if (sec === null || sec <= 0) return null;
  const minutes = Math.max(1, Math.round(sec / 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export default function CoursePlayer() {
  const view = useToolContext<"get_course">();
  const search = useCallTool("find_concept");
  const openExternal = useOpenExternal();

  /**
   * `{ videoId, startSec }` rather than two pieces of state, because they always
   * change together: picking a video from the outline starts it at 0, and
   * picking a search hit starts a possibly-different video at a second. Two
   * `useState`s let those two updates tear, and the player briefly seeks to a
   * timestamp inside the wrong lecture — the one failure this whole surface is
   * supposed to make impossible.
   */
  const [cue, setCue] = useState<{ videoId: string; startSec: number } | null>(null);
  const [query, setQuery] = useState("");
  const [frameBlocked, setFrameBlocked] = useState(false);

  const course = view.status === "ready" ? view.toolOutput : undefined;

  // The first video that actually has a transcript, so the player does not open
  // on a lecture that is still downloading.
  const active = useMemo(() => {
    if (!course) return null;
    if (cue) return cue;
    const first = course.videos.find((v) => v.ingestStatus === "ready") ?? course.videos[0];
    return first ? { videoId: first.videoId, startSec: 0 } : null;
  }, [course, cue]);

  if (view.status === "pending") {
    return (
      <Shell>
        <p style={{ color: MUTED }}>Opening the course…</p>
      </Shell>
    );
  }
  if (view.status === "error") {
    return (
      <Shell>
        <p style={{ color: "#b42318" }}>{view.error.message}</p>
      </Shell>
    );
  }
  if (!course) return null;

  const byId = new Map(course.videos.map((v) => [v.videoId, v]));
  const hits = search.data?.structuredContent?.hits ?? [];

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    // The handle keeps `data` and `error`; the throw on a tool error is the
    // documented shape, and there is nothing extra to do with it here.
    await search.callTool({ courseId: course.courseId, query: q }).catch(() => {});
  };

  return (
    <Shell>
      <header style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em" }}>
          {course.title || "Untitled course"}
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 12.5, color: MUTED }}>
          {[
            `${course.videos.length} video${course.videos.length === 1 ? "" : "s"}`,
            runtime(course.totalDurationSec),
            course.pending > 0 ? `${course.pending} still transcribing` : null,
            course.failed > 0 ? `${course.failed} failed` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {course.description && (
          <p style={{ margin: "6px 0 0", fontSize: 13, color: INK }}>{course.description}</p>
        )}
      </header>

      {active && (
        <Player
          videoId={active.videoId}
          startSec={active.startSec}
          blocked={frameBlocked}
          onBlocked={() => setFrameBlocked(true)}
          onOpenExternal={() =>
            openExternal({
              url: `https://www.youtube.com/watch?v=${active.videoId}&t=${Math.floor(active.startSec)}s`,
            })
          }
        />
      )}

      <form onSubmit={runSearch} style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search what was actually said — e.g. “chain rule”"
          aria-label="Search the transcripts"
          style={{
            flex: 1,
            minWidth: 0,
            border: `1px solid ${LINE}`,
            borderRadius: 9,
            padding: "9px 12px",
            fontSize: 13,
            outlineColor: TIME,
          }}
        />
        <button
          type="submit"
          disabled={search.isPending}
          style={{
            border: "none",
            borderRadius: 9,
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: 700,
            background: BRAND,
            color: "#fff",
            cursor: "pointer",
            opacity: search.isPending ? 0.5 : 1,
          }}
        >
          {search.isPending ? "Searching…" : "Search"}
        </button>
      </form>

      {search.error && <p style={{ fontSize: 12.5, color: "#b42318" }}>{search.error.message}</p>}

      {search.data && hits.length === 0 && (
        <p style={{ fontSize: 12.5, color: MUTED }}>Nothing in these transcripts matches that.</p>
      )}

      {hits.length > 0 && (
        <section style={{ marginBottom: 14 }}>
          <Caption>
            {hits.length} moment{hits.length === 1 ? "" : "s"}
          </Caption>
          <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
            {hits.map((h) => (
              <li key={`${h.videoId}-${h.start}`}>
                <button
                  type="button"
                  onClick={() => setCue({ videoId: h.videoId, startSec: h.start })}
                  style={{
                    display: "flex",
                    gap: 10,
                    width: "100%",
                    textAlign: "left",
                    border: "none",
                    background: "transparent",
                    padding: "7px 4px",
                    cursor: "pointer",
                    borderBottom: `1px solid ${LINE}`,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      fontSize: 12,
                      color: TIME,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {h.timestamp}
                  </span>
                  <span style={{ minWidth: 0, fontSize: 12.5 }}>
                    <span style={{ color: INK }}>“{h.quote}”</span>
                    <span style={{ color: MUTED }}> — {h.videoTitle || h.videoId}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Caption>Contents</Caption>
      <ol style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
        {course.videos.map((v) => {
          const isActive = active?.videoId === v.videoId;
          return (
            <li key={v.videoId}>
              <button
                type="button"
                onClick={() => setCue({ videoId: v.videoId, startSec: 0 })}
                style={{
                  display: "flex",
                  gap: 10,
                  width: "100%",
                  textAlign: "left",
                  alignItems: "baseline",
                  border: "none",
                  borderLeft: `2px solid ${isActive ? BRAND : "transparent"}`,
                  background: isActive ? "#fff7f3" : "transparent",
                  padding: "8px 10px",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 11.5, color: MUTED, flexShrink: 0, minWidth: 16 }}>
                  {v.position + 1}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: isActive ? 700 : 500, color: INK }}>
                    {v.title || v.videoId}
                  </span>
                  {v.summary && (
                    <span style={{ display: "block", fontSize: 12, color: MUTED, marginTop: 2 }}>
                      {v.summary}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 11.5, color: MUTED, flexShrink: 0 }}>
                  {v.ingestStatus !== "ready"
                    ? v.ingestStatus === "pending"
                      ? "transcribing…"
                      : "failed"
                    : (runtime(v.durationSec) ?? "")}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {byId.size === 0 && (
        <p style={{ fontSize: 12.5, color: MUTED }}>This course has no videos yet.</p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        color: INK,
        padding: 16,
        maxWidth: 760,
      }}
    >
      {children}
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: MUTED,
      }}
    >
      {children}
    </div>
  );
}

/**
 * The embed, plus the answer for when it cannot be shown.
 *
 * `key` carries the cue, so choosing a new moment remounts the iframe at that
 * `start=` rather than trying to seek a player this view has no handle on.
 * Seeking through the IFrame API would mean loading YouTube's script and
 * postMessaging across an opaque sandbox origin — two more things to fail for a
 * smoother scrub. A remount always works.
 *
 * Nested iframes need `frameDomains` on the tool's view config, and a host may
 * still decline. `onError` and the manual escape hatch below mean the fallback
 * is one click from the video rather than a dead rectangle.
 */
function Player({
  videoId,
  startSec,
  blocked,
  onBlocked,
  onOpenExternal,
}: {
  videoId: string;
  startSec: number;
  blocked: boolean;
  onBlocked: () => void;
  onOpenExternal: () => void;
}) {
  const start = Math.floor(startSec);

  if (blocked) {
    return (
      <button
        type="button"
        onClick={onOpenExternal}
        style={{
          display: "block",
          width: "100%",
          border: `1px solid ${LINE}`,
          borderRadius: 10,
          overflow: "hidden",
          padding: 0,
          cursor: "pointer",
          background: "#000",
        }}
      >
        <img
          src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
          alt=""
          style={{ display: "block", width: "100%", aspectRatio: "16 / 9", objectFit: "cover" }}
        />
        <span style={{ display: "block", padding: "9px 12px", fontSize: 12.5, color: "#fff" }}>
          Open on YouTube{start > 0 ? ` at ${clock(start)}` : ""} →
        </span>
      </button>
    );
  }

  return (
    <div>
      <iframe
        key={`${videoId}-${start}`}
        src={`https://www.youtube-nocookie.com/embed/${videoId}?start=${start}&rel=0`}
        title="Course video"
        onError={onBlocked}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        style={{
          width: "100%",
          aspectRatio: "16 / 9",
          border: `1px solid ${LINE}`,
          borderRadius: 10,
          background: "#000",
        }}
      />
      <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11.5, color: MUTED }}>
          {start > 0 ? `Starting at ${clock(start)}` : ""}
        </span>
        <button
          type="button"
          onClick={onOpenExternal}
          style={{
            border: "none",
            background: "transparent",
            padding: 0,
            fontSize: 11.5,
            color: TIME,
            cursor: "pointer",
          }}
        >
          Open on YouTube →
        </button>
      </div>
    </div>
  );
}
