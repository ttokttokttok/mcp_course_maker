/**
 * A closed vocabulary, not freeform tags. Freeform fragments on contact — ml,
 * ML, machine-learning, deep learning — and browse rows built on it stop being
 * reliable the moment two people spell the same topic differently.
 *
 * Order matters: it is the order topics render in, so the list reads as a
 * deliberate taxonomy rather than whatever order a model happened to emit.
 */
export const TOPICS = [
  "Machine learning",
  "Deep learning",
  "Transformers",
  "Computer vision",
  "Reinforcement learning",
  "Math",
  "Statistics",
  "Programming",
  "Web development",
  "Systems",
  "Databases",
  "Security",
  "DevOps",
  "Data engineering",
  "Product & design",
] as const;

export const MAX_TOPICS = 4;

const BY_LOWER = new Map(TOPICS.map((t) => [t.toLowerCase(), t]));

/**
 * `unknown` on purpose: every caller destructures this from an unvalidated JSON
 * body or a model response. Returns null ONLY for "not a list" — a caller turns
 * that into a 400. Unknown members are dropped, not fatal, so one bad topic
 * never costs the creator the good ones.
 */
export function normalizeTopics(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const kept = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const canonical = BY_LOWER.get(raw.trim().toLowerCase());
    if (canonical) kept.add(canonical);
  }
  return TOPICS.filter((t) => kept.has(t)).slice(0, MAX_TOPICS);
}
