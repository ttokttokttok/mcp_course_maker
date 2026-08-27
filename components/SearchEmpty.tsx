"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * The empty result is the best prompt to build something the app has: it fires
 * right after you have named a specific thing you wanted and did not find.
 *
 * The name field seeds its PLACEHOLDER, not its value — a course is unnamed
 * until its transcripts are read, and `mergeDerived` (lib/roadmaps/draft.ts)
 * fills only fields nobody has written. A seeded value is a written field, so
 * it would permanently suppress the derived title. Leave it and derivation
 * names the course; type over it and that is a real title, respected as always.
 *
 * "rust async" is a search query, not a course title.
 */
export function SearchEmpty({ query }: { query: string }) {
  const [name, setName] = useState("");
  const typed = name.trim();
  const href = typed ? `/create?title=${encodeURIComponent(typed)}` : "/create";

  return (
    <div
      className="rounded-[12px] border px-5 py-6 text-center"
      style={{
        borderColor: "color-mix(in srgb, var(--brand) 42%, var(--line))",
        background: "color-mix(in srgb, var(--brand) 5%, var(--card))",
      }}
    >
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-semibold"
        style={{ color: "var(--time)", background: "var(--time-soft)" }}
      >
        Nothing covers this yet
      </span>

      {/*
       * Addressed to the one person who can act on it. This is a local catalog,
       * so "nothing covers this" is a fact about your own shelf and the fix is
       * ten seconds of pasting — which is what the field below is for.
       */}
      <h2 className="mt-3.5 font-display text-[17.5px] font-extrabold tracking-tight">
        You haven&rsquo;t built <span style={{ color: "var(--brand-ink)" }}>{query}</span> yet.
      </h2>
      <p className="mx-auto mt-2 max-w-[46ch] text-[13.5px] text-muted-foreground">
        Paste the videos you&rsquo;d have watched anyway. Every transcript gets read, and you get a
        tutor that knows all of it.
      </p>

      <div
        className="mx-auto mt-4 max-w-[430px] rounded-[10px] border bg-card p-3 text-left"
        style={{ borderColor: "var(--line)" }}
      >
        <label
          className="mb-1.5 block text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint"
          htmlFor="seed-name"
        >
          Your course
        </label>
        <input
          id="seed-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={query}
          maxLength={200}
          className="w-full rounded-[8px] border px-3 py-2.5 text-[13.5px] outline-none focus-visible:outline-2 focus-visible:outline-offset-[3px]"
          style={{ borderColor: "var(--line)", outlineColor: "var(--time)" }}
        />
        <p className="mt-2 text-[11.5px] leading-snug text-faint">
          <span className="font-semibold text-muted-foreground">Leave it as it is</span> and
          we&rsquo;ll name the course once we&rsquo;ve read the transcripts — usually better than a
          search box would.
        </p>
      </div>

      <Link
        href={href}
        className="mt-4 inline-flex items-center gap-1.5 rounded-[9px] px-4 py-3 text-[13px] font-bold focus-visible:outline-2 focus-visible:outline-offset-[3px]"
        style={{
          background: "var(--brand)",
          color: "var(--brand-on)",
          outlineColor: "var(--time)",
        }}
      >
        Start building →
      </Link>
    </div>
  );
}
