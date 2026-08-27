"use client";

import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

/**
 * `q` comes from the server page rather than `useSearchParams()`: reading
 * search params in a client component drags a Suspense boundary into every
 * page that renders the header, including ones that have no query at all.
 *
 * A plain GET <form> and not an onSubmit handler — the URL is the state, which
 * is what makes the back button, a shared link and a topic chip all behave.
 */
export function AppHeader({ q }: { q?: string }) {
  return (
    <header
      className="flex items-center gap-3 border-b px-5 py-3"
      style={{ borderColor: "var(--line)" }}
    >
      {/* The way back to the catalog from any page — the studio has no other. */}
      <Link
        href="/"
        aria-label="Course Maker home"
        className="shrink-0 rounded-[6px] focus-visible:outline-2 focus-visible:outline-offset-[3px]"
        style={{ outlineColor: "var(--time)" }}
      >
        <Wordmark />
      </Link>

      <form action="/search" method="get" className="min-w-0 flex-1">
        <label className="sr-only" htmlFor="site-search">
          Search courses
        </label>
        <input
          id="site-search"
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search courses"
          className="w-full rounded-full border px-4 py-2 text-[13px] outline-none focus-visible:outline-2 focus-visible:outline-offset-[3px]"
          style={{
            borderColor: q ? "color-mix(in srgb, var(--time) 40%, var(--line))" : "var(--line)",
            background: q ? "var(--card)" : "var(--muted)",
            outlineColor: "var(--time)",
          }}
        />
      </form>

      <div className="flex shrink-0 items-center gap-2">
        <Link
          href="/create"
          className="rounded-[9px] border px-3 py-1.5 text-[13px] font-bold focus-visible:outline-2 focus-visible:outline-offset-[3px]"
          style={{
            borderColor: "color-mix(in srgb, var(--brand) 50%, var(--line))",
            color: "var(--brand-ink)",
            outlineColor: "var(--time)",
          }}
        >
          + New course
        </Link>
      </div>
    </header>
  );
}
