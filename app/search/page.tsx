import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CourseCardLink } from "@/components/CourseCardLink";
import { SearchEmpty } from "@/components/SearchEmpty";
import { listTopics, searchRoadmaps } from "@/lib/roadmaps/roadmaps";
import { browsableTopics, matchReasons, normalizeQuery } from "@/lib/roadmaps/search";

export const dynamic = "force-dynamic";

/** Shared by "Related topics" and "Browse instead" — same row, different label. */
function TopicRow({ label, topics }: { label: string; topics: string[] }) {
  if (topics.length === 0) return null;
  return (
    <>
      <div className="my-5 h-px" style={{ background: "var(--line)" }} />
      <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
        {label}
      </div>
      <div className="flex flex-wrap gap-2">
        {topics.map((topic) => (
          <Link
            key={topic}
            href={`/search?q=${encodeURIComponent(topic)}`}
            className="rounded-full border px-2.5 py-1.5 text-[10.5px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-[3px]"
            style={{
              borderColor: "var(--time-line)",
              background: "var(--time-soft)",
              color: "var(--time)",
              outlineColor: "var(--time)",
            }}
          >
            {topic}
          </Link>
        ))}
      </div>
    </>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q: raw } = await searchParams;
  const q = normalizeQuery(raw);

  // No query is not an empty result — listing the whole catalog here would make
  // the search box look like it did nothing.
  if (q === null) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto w-full max-w-[1000px] px-5 py-14 text-center">
          <h1 className="font-display text-xl font-bold">Search the catalog</h1>
          <p className="mx-auto mt-2 max-w-[46ch] text-[14px] text-muted-foreground">
            Try a topic, a course title, or the name of a teacher.
          </p>
        </main>
      </>
    );
  }

  const results = await searchRoadmaps(q);

  // Related topics come from what actually came back; only when nothing did do
  // we fall back to the whole catalog's vocabulary.
  const related =
    results.length > 0
      ? browsableTopics(results.flatMap((r) => r.topics))
      : browsableTopics(await listTopics());

  return (
    <>
      <AppHeader q={q} />
      <main className="mx-auto w-full max-w-[1000px] px-5 py-6">
        <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
          <span>Courses</span>
          <span className="font-mono text-foreground">{results.length}</span>
        </div>

        {results.length === 0 ? (
          <SearchEmpty query={q} />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {results.map((r) => (
              <CourseCardLink
                key={r.id}
                course={r}
                query={q}
                reason={matchReasons(r, r.matchedChannel, q)}
              />
            ))}
          </ul>
        )}

        <TopicRow
          label={results.length === 0 ? "Browse instead" : "Related topics"}
          topics={related}
        />
      </main>
    </>
  );
}
