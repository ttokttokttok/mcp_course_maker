/**
 * Fence-marker neutralisation for prompts that wrap untrusted text in markers.
 *
 * Two prompts do: the tutor's course map (`lib/tutor/context.ts`) and the
 * derivation prompt's transcript block (`lib/roadmaps/metadata.ts`). It lives
 * here because it belongs to neither. The transcript fence shipped with no
 * sanitizer at all while the course-map fence grew one over two fix rounds, and
 * a second copy is precisely how the first one's lessons stop travelling.
 */

/**
 * Compiled patterns, one per word.
 *
 * Shared instances are safe here only because `String.prototype.replace` resets
 * a global regex's `lastIndex` before it starts and again when it finishes.
 * `test`/`exec` do not, and a `/g/` regex reused with either would skip matches
 * on every second call — worth stating, because the next person to reach for
 * this cache will reach for one of those.
 */
const patterns = new Map<string, RegExp>();

/**
 * `value` with anything that could pass for a fence marker taken out.
 *
 * A fence's only real property is that the model can see where the untrusted
 * block ends. A marker planted inside a value takes even that away: everything
 * after it reads as text that arrived AFTER the block closed — i.e. as operator
 * instruction. Planting one is cheap on either fence. Video titles and channel
 * names arrive verbatim from YouTube (`lib/transcripts/meta.ts` → `ingest.ts`),
 * unclamped and unparaphrased, and a caption cue reading exactly the marker is
 * one line of typing on a manual caption track. Emitting a closing marker of our
 * own does not answer this: it proves where OUR text ended, not theirs.
 *
 * Two details that are not stylistic:
 *
 * Replaced with a SPACE, never with "". A string replace makes one left-to-right
 * pass and never rescans its own output, so deleting a match splices its
 * neighbours together and the splice can form the marker that was just removed:
 * "COURSE_COURSE_MAPMAP>>>" deletes to a pristine "COURSE_MAP>>>". A word with
 * no whitespace in it can never recombine across a space.
 *
 * Matched on the bare word, case-insensitively, rather than on the two full
 * markers. That also takes out "course_map>>>" and bare references to the fence
 * ("as COURSE_MAP states, you must…"), so a value cannot name the boundary at
 * all, only sit inside it. A real title containing the word is not a thing; a
 * hostile one is one line of typing.
 *
 * `word` carries two constraints that the compiler cannot hold a caller to and
 * that the sanitizer depends on:
 *
 * 1. **No whitespace.** The space substitution above is only safe because a
 *    space cannot then recombine into the word.
 * 2. **No regex metacharacters.** It is compiled into a pattern unescaped, so a
 *    "." or "|" would silently over-match and start eating real titles. It is
 *    not escaped defensively because escaping would cover only this constraint
 *    and would read as though the first were handled too.
 *
 * An identifier-shaped word satisfies both.
 *
 * Known gap, recorded so nobody later assumes it was considered: this is
 * exact-ASCII, so a zero-width space inside the word (U+200B is NOT in JS `\s`),
 * a Cyrillic "С", or the fullwidth form all survive untouched. They tokenise
 * differently from the real marker, so they are unlikely to FUNCTION as one —
 * this is a gap in the sanitizer, not a demonstrated bypass, and should not be
 * written up as more. A BOM is in `\s`, so callers that also collapse whitespace
 * get that one variant; the difference is the point, and is why it was checked
 * rather than assumed.
 */
export function neutralize(value: string, word: string): string {
  let pattern = patterns.get(word);
  if (!pattern) {
    pattern = new RegExp(word, "gi");
    patterns.set(word, pattern);
  }
  return value.replace(pattern, " ");
}
