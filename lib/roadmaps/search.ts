/**
 * Every rule catalog search turns on, kept pure for the same reason
 * `lib/roadmaps/draft.ts` and `lib/roadmaps/topics.ts` are: vitest only
 * collects `*.test.ts`, so a rule that lives in a page component can only be
 * exercised by clicking through a live catalog — which means nobody checks it.
 *
 * Deliberately imports nothing from `roadmaps.ts`: that module imports THIS one
 * for `likePattern`, and a structural parameter type keeps the dependency
 * pointing one way.
 */

import { TOPICS } from "./topics";

/** Long enough for any real search, short enough that nobody probes with it. */
export const MAX_QUERY = 100;

/**
 * `unknown` on purpose — the only caller destructures this from `searchParams`,
 * where a repeated `?q=a&q=b` arrives as an array. Returns null for "nothing to
 * search", which the page renders as a prompt rather than as the whole catalog.
 */
export function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (collapsed === "") return null;
  return collapsed.slice(0, MAX_QUERY);
}

/**
 * A bound LIKE pattern with the wildcards in the query neutralised, so a search
 * for "100%" matches the literal characters instead of every row in the table.
 *
 * Backslash is the escape character, which SQLite only honours when the query
 * says `ESCAPE` — see `searchRoadmaps`. Escaping here without that clause
 * there would leave the backslashes in the pattern as literals to match.
 *
 * The backslash must be replaced FIRST — doing it in one pass with a character
 * class is what guarantees that, since a second pass over the output would
 * re-escape the backslashes this one just added.
 */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export type Segment = { text: string; hit: boolean };

/**
 * Splits `text` into runs for `<mark>`ing. Uses `indexOf` rather than a RegExp,
 * so every character in the query is inert and there is nothing to escape —
 * the alternative is building a pattern from user input, which is one forgotten
 * escape away from a crash or a match on the wrong thing.
 */
export function highlight(text: string, q: string): Segment[] {
  if (q === "") return [{ text, hit: false }];
  const needle = q.toLowerCase();
  const hay = text.toLowerCase();
  const out: Segment[] = [];
  let i = 0;
  for (;;) {
    const at = hay.indexOf(needle, i);
    if (at === -1) break;
    if (at > i) out.push({ text: text.slice(i, at), hit: false });
    // Sliced from `text`, not `hay`: the mark keeps the source's own casing.
    out.push({ text: text.slice(at, at + needle.length), hit: true });
    i = at + needle.length;
  }
  if (i < text.length) out.push({ text: text.slice(i), hit: false });
  return out.length > 0 ? out : [{ text, hit: false }];
}

/**
 * Structural, not `CourseCard`. `roadmaps.ts` imports `likePattern` from this
 * module, so importing its types back would make the dependency circular for
 * no benefit — these three fields are all the why-line reads.
 */
export type MatchTarget = {
  title: string;
  description: string;
  topics: string[];
};

/**
 * One line telling the visitor how the tool thinks, so that when something does
 * NOT come back the absence is legible rather than mysterious.
 *
 * `matchedChannel` is the channel the SQL actually matched, which is not
 * necessarily the one on the card — the card shows the first video's channel,
 * and a course matches on ANY of its videos' channels (decided 2026-07-31,
 * commit ad11d46). Naming it is what stops a legitimate hit reading as a false
 * positive.
 *
 * Known gap, tolerated: the SQL matches `array_to_string(topics, ' ')`, which
 * can match ACROSS the join character — a query of "learning math" matches a
 * course topic'd ['Deep learning', 'Math'] in SQL, while `course.topics.some`
 * below checks each topic individually and finds no single topic containing
 * that substring. The result: `parts` can come back empty for a row SQL
 * legitimately matched, and this returns "". Left as-is because the caller
 * guards with `{reason && …}`, so the card just renders without a why-line
 * rather than a wrong one — a silent degrade, not a bug worth the complexity
 * of re-deriving what SQL matched.
 */
export function matchReasons(
  course: MatchTarget,
  matchedChannel: string | null,
  q: string,
): string {
  const needle = q.trim().toLowerCase();
  if (needle === "") return "";
  const has = (s: string) => s.toLowerCase().includes(needle);
  const parts: string[] = [];
  if (has(course.title)) parts.push("title");
  if (has(course.description)) parts.push("description");
  if (course.topics.some(has)) parts.push("topic");
  if (matchedChannel) parts.push(`channel · ${matchedChannel}`);
  if (parts.length === 0) return "";
  return `matched ${parts.join(" + ")}`;
}

/**
 * The topics that have at least one public course, in taxonomy order.
 *
 * Returns [] below two, because a filter bar with one chip — or none —
 * advertises an empty catalog rather than offering navigation. The row appears
 * on its own once the catalog earns it.
 */
export function browsableTopics(raw: string[]): string[] {
  const present = new Set(raw.map((t) => t.trim().toLowerCase()));
  const kept = TOPICS.filter((t) => present.has(t.toLowerCase()));
  return kept.length < 2 ? [] : kept;
}
