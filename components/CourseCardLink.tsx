import Link from "next/link";
import { formatDuration, thumbnailUrl } from "@/lib/roadmaps/card";
import { highlight } from "@/lib/roadmaps/search";
import type { CourseCard } from "@/lib/roadmaps/roadmaps";

/**
 * Server component, like its parent — `highlight` is pure, so marking costs no
 * client JS. Keys are indexes because the segments ARE positional: they are a
 * partition of one string and never reorder.
 */
function Marked({ text, query }: { text: string; query?: string }) {
  if (!query) return <>{text}</>;
  return (
    <>
      {highlight(text, query).map((seg, i) =>
        seg.hit ? (
          <mark
            key={i}
            className="rounded-[3px] px-0.5"
            style={{
              background: "color-mix(in srgb, var(--brand) 24%, transparent)",
              color: "inherit",
            }}
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

export function CourseCardLink({
  course,
  query,
  reason,
}: {
  course: CourseCard;
  /** When present, title and description mark their matches. */
  query?: string;
  /** The why-line, e.g. "matched channel · DeepMind". Search only. */
  reason?: string;
}) {
  const duration = formatDuration(course.durationSec);
  const thumb = thumbnailUrl(course.coverVideoId);
  const videoLabel = `${course.videoCount} ${course.videoCount === 1 ? "video" : "videos"}`;
  // A course carries no name until someone names it, so an empty title is the
  // normal state, not an error. Fall back to what the course actually contains —
  // the first video's title — rather than to the id, which named nothing.
  const named = course.title?.trim();
  const displayTitle = named || course.videoTitles[0] || "Untitled course";
  // When the heading IS the first video's title, listing it again directly below
  // prints the same string twice — and an unnamed course is now the normal state
  // of a new one, so that would be the usual rendering rather than an edge case.
  const contents = named ? course.videoTitles : course.videoTitles.slice(1);

  return (
    <li>
      <Link
        href={`/roadmap/${course.id}`}
        className="group flex h-full flex-col overflow-hidden rounded-[12px] border bg-card transition-colors hover:border-[color-mix(in_srgb,var(--time)_45%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-[3px]"
        style={{ borderColor: "var(--border)", outlineColor: "var(--time)" }}
      >
        {/* The <img> sits ON the dark block rather than replacing it, so a 404
            or a dropped request degrades to the fallback with no error handler
            and no layout shift. */}
        <div className="relative aspect-[16/9] w-full" style={{ background: "#0b0e13" }}>
          {thumb && (
            <img
              src={thumb}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          {course.featuredAt && (
            <span
              className="absolute right-2 top-2 rounded-[4px] px-1.5 py-1 text-[9px] font-bold uppercase tracking-wider"
              style={{ background: "var(--brand)", color: "var(--brand-on)" }}
            >
              Featured
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col px-4 py-3.5">
          <h3 className="font-display text-[16px] font-bold leading-snug">
            <Marked text={displayTitle} query={query} />
          </h3>
          {course.channel && (
            <div className="mt-1 text-[13px] text-muted-foreground">{course.channel}</div>
          )}

          {contents.length > 0 && (
            <ul
              className="mt-2.5 flex flex-col gap-0.5 border-l-2 pl-2.5"
              style={{ borderColor: "var(--border)" }}
            >
              {contents.map((t, i) => (
                <li key={`${t}-${i}`} className="truncate text-[11.5px] text-muted-foreground">
                  {t}
                </li>
              ))}
            </ul>
          )}

          {course.description && (
            <p className="mt-2.5 line-clamp-2 text-[12.5px] leading-snug text-muted-foreground">
              <Marked text={course.description} query={query} />
            </p>
          )}

          {course.topics.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {course.topics.map((topic) => (
                <span
                  key={topic}
                  className="rounded-full border px-2 py-1 text-[10.5px] font-semibold"
                  style={{
                    borderColor: "var(--time-line)",
                    background: "var(--time-soft)",
                    color: "var(--time)",
                  }}
                >
                  {topic}
                </span>
              ))}
            </div>
          )}

          <div className="mt-auto flex items-center gap-1 pt-3.5 text-[12px] text-faint">
            <span>{videoLabel}</span>
            {duration && (
              <>
                <span aria-hidden> · </span>
                <span>{duration}</span>
              </>
            )}
            {reason && (
              <span className="ml-auto font-mono text-[11px]" style={{ color: "var(--brand-ink)" }}>
                {reason}
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}
