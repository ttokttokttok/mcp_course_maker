import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CourseCardLink } from "@/components/CourseCardLink";
import { listRoadmaps, listTopics } from "@/lib/roadmaps/roadmaps";
import { browsableTopics } from "@/lib/roadmaps/search";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [courses, rawTopics] = await Promise.all([listRoadmaps(), listTopics()]);
  const chips = browsableTopics(rawTopics).slice(0, 3);
  const count = `${courses.length} ${courses.length === 1 ? "course" : "courses"}`;

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-[1000px] px-5 pb-20">
        {/*
         * The headline promises the tutor, not the search box. An earlier draft
         * promised to "find the minute it's explained" — a transcript promise
         * that metadata search cannot keep.
         */}
        <section className="border-b px-6 py-14 text-center" style={{ borderColor: "var(--line)" }}>
          <h1 className="mx-auto max-w-[21ch] font-display text-[clamp(23px,3.2vw,32px)] font-extrabold leading-[1.08] tracking-tight">
            Every course here comes with a tutor that watched it.
          </h1>
          <p className="mx-auto mt-3 max-w-[54ch] text-[14.5px] text-muted-foreground">
            You assemble the videos. yt-dlp pulls every transcript onto this machine, so you can ask
            questions about any of it and get answers with timestamps.
          </p>

          <form
            action="/search"
            method="get"
            className="mx-auto mt-6 flex max-w-[570px] items-center gap-2.5 rounded-[12px] border-[1.5px] bg-card p-2.5 pl-4"
            style={{ borderColor: "color-mix(in srgb, var(--time) 48%, var(--line))" }}
          >
            <label className="sr-only" htmlFor="hero-search">
              Search courses
            </label>
            <input
              id="hero-search"
              type="search"
              name="q"
              placeholder="Search courses by topic, title or teacher"
              className="min-w-0 flex-1 bg-transparent text-[14.5px] outline-none"
            />
            <button
              type="submit"
              className="shrink-0 rounded-[9px] px-3.5 py-2.5 text-[12.5px] font-bold focus-visible:outline-2 focus-visible:outline-offset-[3px]"
              style={{
                background: "var(--brand)",
                color: "var(--brand-on)",
                outlineColor: "var(--time)",
              }}
            >
              Search
            </button>
          </form>

          {/*
           * Browse, not "Try:". Suggested phrases only made sense against
           * transcripts; against metadata the useful shortcut is a topic — and
           * because the vocabulary is closed, every chip is guaranteed to
           * return something.
           */}
          {chips.length > 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {chips.map((topic) => (
                <Link
                  key={topic}
                  href={`/search?q=${encodeURIComponent(topic)}`}
                  className="rounded-full border px-3 py-1.5 text-[12px] text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-[3px]"
                  style={{ borderColor: "var(--line)", outlineColor: "var(--time)" }}
                >
                  Browse: <span className="font-semibold text-foreground">{topic}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/*
         * ONE shelf. "Featured" beside "Recently added" showing the same single
         * course reads as a bug — pinned courses already sort first
         * (`listRoadmaps` orders on featured_at) and carry a flag on the card.
         * The split arrives with the inventory, not before it.
         */}
        <section className="mt-9">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-[14.5px] font-extrabold tracking-tight">
              The catalog
            </h2>
            <span className="text-[12px] text-muted-foreground">{count}</span>
          </div>
          <p className="mt-1.5 text-[12.5px] text-faint">
            Every course on this machine. Pinned picks get their own shelf once there&rsquo;s enough
            to pick from.
          </p>

          {courses.length === 0 ? (
            <div
              className="mt-5 rounded-[12px] border bg-card px-6 py-14 text-center"
              style={{ borderColor: "var(--border)" }}
            >
              <h3 className="font-display text-xl font-bold">No courses yet</h3>
              <p className="mx-auto mt-2 max-w-[42ch] text-[14px] text-muted-foreground">
                Turn a set of YouTube videos into a course you can navigate by time — and get a
                tutor that has read all of it.
              </p>
            </div>
          ) : (
            <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {courses.map((c) => (
                <CourseCardLink key={c.id} course={c} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
