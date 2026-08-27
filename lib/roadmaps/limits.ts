/**
 * The free-text length limits, in a module with no imports at all.
 *
 * They used to live where they were enforced — the description beside
 * `deriveMetadata`, the audience beside the PATCH that validates it — which was
 * the right home right up until the details panel needed to set the same
 * `maxLength` on its inputs. That panel is a client component, and importing
 * either constant from its old home dragged the whole server module behind it:
 * the AI SDK from `metadata.ts`, and the SQLite driver from the route, which
 * fails the browser build outright on its native binding.
 *
 * So they live here, next to `title.ts` for the same reason it exists: a pure
 * leaf both sides can import, so one number can be enforced on the server and
 * shown on the client without either end hardcoding its own copy.
 *
 * `MAX_SUMMARY_LENGTH` has no client reader and never will — it is here for
 * cohesion, so that "what caps a derived field?" has one answer and not two
 * places to look.
 */

/** What `deriveMetadata` clamps to and the metadata PATCH rejects beyond. */
export const MAX_DESCRIPTION_LENGTH = 300;

/** Audience is human-only — nothing derives it — so only the PATCH enforces this. */
export const MAX_AUDIENCE_LENGTH = 300;

/**
 * One line per video, for the tutor's course map. Never shown to a human, so
 * the cap is about prompt budget rather than layout: a 40-video course spends
 * 40 of these in every single chat request's system prompt.
 */
export const MAX_SUMMARY_LENGTH = 140;
