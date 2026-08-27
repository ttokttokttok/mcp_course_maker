/**
 * Course ids are UUIDs. Every public entry point takes one straight from a URL
 * or a request body, and a malformed one names nothing — so checking the shape
 * here lets a route answer 404 immediately instead of querying for a row that
 * cannot exist.
 *
 * Pure and database-free on purpose: route tests import it directly, and mocking
 * `@/lib/roadmaps/roadmaps` in those tests does not stub the check away.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `unknown` on purpose: the chat route's `roadmapId` is destructured from an
 * unvalidated JSON body, so it can be a number, an object, or null despite its
 * declared type. Anything that is not a UUID-shaped string is rejected without
 * throwing, and the caller treats it exactly like a missing course.
 */
export function isRoadmapId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
