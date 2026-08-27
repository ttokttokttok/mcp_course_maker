/**
 * Course-title validation, shared by every path that accepts a title so they
 * cannot drift apart.
 *
 * One asymmetry, and it is deliberate: a course is not named until someone names
 * it, so `POST /api/roadmaps` stores "" when the request carries NO title key at
 * all — it never calls this for that case. That is the whole point. The publish
 * sheet fills the title only when the owner has not written one, so a placeholder
 * invented at creation would suppress the derived title forever.
 *
 * The exemption is the ABSENCE of the key and nothing else. A title that is
 * supplied — at creation, at rename, or through the metadata PATCH — still comes
 * through here, and "" is still rejected. An empty title is legal to create and
 * illegal to rename to; do not "fix" the create path into calling this
 * unconditionally, and do not add an absent-means-empty branch to any other.
 *
 * Lives beside `access.ts` and `id.ts` — the other pure, db-free guards the
 * roadmap routes import — so route tests can use it without a pg pool, and so
 * mocking `@/lib/roadmaps/roadmaps` in those tests does not stub the check away.
 */
export const MAX_TITLE_LENGTH = 200;

/**
 * `unknown` on purpose: every caller destructures this from an unvalidated JSON
 * body, so it can be a number, an object, or null despite its declared type.
 * Returns the trimmed title, or null for anything unusable — a caller treats
 * null as a 400 and never has to test the shape itself.
 */
export function normalizeTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_TITLE_LENGTH) return null;
  return trimmed;
}
