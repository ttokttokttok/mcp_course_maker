/**
 * The wordmark, set in type rather than shipped as an image: it stays
 * sharp at any DPI, follows the light/dark tokens, and remains selectable text.
 *
 * `course` is ink, `maker` is the brand orange. This is the one sanctioned place
 * orange appears without being the primary action — a top-left wordmark reads
 * as identity, not affordance.
 *
 * Rendered once per page, by `AppHeader`. Page kickers carry a plain label
 * ("Course", "New course") rather than repeating the mark.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={
        "font-display text-[15px] font-extrabold leading-none tracking-tight " + (className ?? "")
      }
    >
      course<span style={{ color: "var(--brand)" }}>maker</span>
    </span>
  );
}
