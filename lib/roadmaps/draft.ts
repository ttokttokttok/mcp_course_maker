/**
 * The derive's two decisions, pulled out of the component so they can be
 * tested: what the derive is allowed to overwrite, and when a refused title is
 * worth offering back. Both are pure — no fetch, no state — and the caller keeps
 * only the request and the JSX.
 *
 * They were written for a publish sheet and outlived it: `deriveAndStore` and
 * the details panel both merge through `mergeDerived` now, which is the argument
 * for having pulled them out in the first place.
 *
 * Pure and db-free like `title.ts` and `topics.ts` beside it, for the same
 * reason: this is the rule the whole feature turns on, and a rule that can only
 * be exercised by clicking through a live catalog is a rule nobody checks.
 */

/**
 * A course's human-facing fields. `audience` has no derived counterpart.
 *
 * `title` is still here because `mergeDerived` has to decide whether to keep it,
 * but the details panel does not edit it — the studio header's rename does.
 */
export type Draft = { title: string; description: string; audience: string; topics: string[] };

/** What `POST /api/roadmaps/:id/metadata` returns — the model's reading of the transcripts. */
export type Derived = { title: string; description: string; topics: string[] };

/**
 * Fill only what the owner has not written. The derive runs against a course
 * that may already have been named and described by hand, and a model that has
 * just read the transcripts is not evidence that the owner was wrong.
 *
 * Blankness is judged trimmed — a field holding only spaces is not a decision —
 * but a kept value is returned verbatim, because trimming it would edit text
 * that is still on screen under the owner's cursor.
 *
 * `audience` is passed through untouched: the transcripts say what is covered,
 * only the owner knows who it is for, so the derive never proposes one.
 */
export function mergeDerived(prev: Draft, derived: Derived): Draft {
  return {
    title: prev.title.trim() ? prev.title : derived.title,
    description: prev.description.trim() ? prev.description : derived.description,
    audience: prev.audience,
    topics: prev.topics.length > 0 ? prev.topics : derived.topics,
  };
}

/**
 * The derived title the merge just refused, if it is worth offering — otherwise
 * null.
 *
 * Dropping it silently is how "Karpathy YT Course" survives a derivation that
 * called it "Introduction to Neural Networks and Reinforcement Learning". So it
 * is offered: visible, and never applied without the owner acting on it.
 *
 * Three conditions, all necessary. The course was already named, or the merge
 * applied the derived title and there is nothing left to suggest. The derive
 * returned something. And it differs from the course's current title — compared
 * trimmed, or a suggestion differing only in whitespace would read as identical
 * to the name already on screen.
 *
 * `currentTitle` is the title as it stands at the moment of the derive, not a
 * snapshot from when the surface opened. The details panel is mounted for the
 * life of the studio and the rename sits directly above it, so the two are no
 * longer the same instant — and asking this of a stale title answers "no name
 * yet" for a course the owner has just named, suppressing the offer in exactly
 * the case it exists for.
 *
 * Returned untrimmed, so that whatever renders or applies it is offering the
 * same string this function judged; trimming here would make the offer and the
 * result two different values.
 */
export function suggestion(currentTitle: string, derivedTitle: string): string | null {
  const kept = currentTitle.trim();
  const offered = derivedTitle.trim();
  if (!kept || !offered || offered === kept) return null;
  return derivedTitle;
}
