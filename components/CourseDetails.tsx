"use client";

import { useState } from "react";
import { MAX_TOPICS, TOPICS } from "@/lib/roadmaps/topics";
import { MAX_AUDIENCE_LENGTH, MAX_DESCRIPTION_LENGTH } from "@/lib/roadmaps/limits";
import { mergeDerived, suggestion, type Derived, type Draft } from "@/lib/roadmaps/draft";

/**
 * The derive is one `gpt-4o-mini` call over a bounded transcript sample, so this
 * is headroom for a cold start, not a working budget.
 *
 * It exists because a request that never settles is a worse failure than one
 * that fails: `deriving` disables both buttons and is only cleared when the
 * promise resolves OR rejects, and a socket that hangs open does neither. The
 * abort rejects into the same catch a 502 takes, which is the path already
 * proven to leave every field editable and saveable.
 */
const DERIVE_TIMEOUT_MS = 30_000;

/** A non-JSON error body (an HTML 502 page, say) must not read as a network failure. */
async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The course's details, edited in place.
 *
 * This was a modal behind a publish step, which meant a course nobody published
 * never got a name and you never saw the feature. Metadata is derived at
 * creation now, so this is purely an editing surface — always reachable.
 *
 * Title is deliberately absent: it is edited by the inline rename in the studio
 * header, so there is exactly one title writer. The modal had two, and a rename
 * committed behind the overlay was silently overwritten by the sheet's PATCH.
 *
 * Neither button here is orange. This is a secondary surface — collapsed by
 * default, and about editing rather than doing — and the studio's one `--brand`
 * is already spent on the tutor's Send button in `StudioChat`.
 */
export function CourseDetails({
  roadmapId,
  initial,
  onSaved,
}: {
  roadmapId: string;
  /** `title` is read for the Re-derive suggestion only; never edited here. */
  initial: Draft;
  onSaved: (saved: Omit<Draft, "title">) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(initial);
  const [deriving, setDeriving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestedTitle, setSuggestedTitle] = useState<string | null>(null);

  const toggleTopic = (topic: string) =>
    setDraft((d) => ({
      ...d,
      topics: d.topics.includes(topic)
        ? d.topics.filter((t) => t !== topic)
        : d.topics.length >= MAX_TOPICS
          ? d.topics
          : [...d.topics, topic],
    }));

  /**
   * Always calls the model, however many times it has run before — the button
   * is a person asking on purpose. The automatic path (`deriveAndStore`) is the
   * conservative one; this is not it.
   */
  const rederive = async () => {
    setDeriving(true);
    setError(null);
    // Announced, not just implied by the button's label: that label sits on a
    // `disabled` button, which most screen readers skip entirely, so without
    // this a non-sighted owner presses Re-derive and hears nothing at all for
    // however long the model takes.
    setStatus("Reading the transcripts…");
    try {
      const res = await fetch(`/api/roadmaps/${roadmapId}/metadata`, {
        method: "POST",
        signal: AbortSignal.timeout(DERIVE_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error("derive failed");
      const d = (await res.json()) as Derived;
      // Both rules live in lib/roadmaps/draft.ts, where they are tested: the
      // merge fills only what the owner has not written, and the suggestion is
      // the derived title the merge refused — offered rather than dropped.
      //
      // Read from the prop at the moment of the click rather than snapshotted at
      // mount, which is what the sheet did: the sheet mounted when it opened, so
      // the two were the same instant. This panel is mounted for the life of the
      // studio, and the header's rename sits directly above it — a snapshot here
      // would ask "does this course have a name?" of a course as it stood before
      // the owner named it, and answer no.
      const titleNow = initial.title;
      setSuggestedTitle(suggestion(titleNow, d.title));
      setDraft((prev) => mergeDerived({ ...prev, title: titleNow }, d));
      setStatus("Filled in from the transcripts. Change anything that's wrong, then save.");
    } catch {
      setError("We couldn't read the transcripts — fill these in yourself.");
    } finally {
      setDeriving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setStatus("Saving…"); // same reason as the derive: the button is disabled
    try {
      const res = await fetch(`/api/roadmaps/${roadmapId}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // No `title`, even though the route still accepts one: the header's
        // rename owns that field, and sending a stale copy from here is exactly
        // how the sheet used to clobber a rename made while it was open.
        body: JSON.stringify({
          description: draft.description,
          audience: draft.audience,
          topics: draft.topics,
        }),
      });
      if (!res.ok) {
        setError(await readError(res, "Could not save those details."));
        return;
      }
      // The route echoes what it stored — trimmed, canonical topics — and that
      // is what the studio should hold, not the raw draft.
      const echoed = (await res.json().catch(() => ({}))) as Partial<Draft>;
      const stored = {
        description:
          typeof echoed.description === "string" ? echoed.description : draft.description,
        audience: typeof echoed.audience === "string" ? echoed.audience : draft.audience,
        topics: Array.isArray(echoed.topics) ? echoed.topics : draft.topics,
      };
      setDraft((d) => ({ ...d, ...stored }));
      onSaved(stored);
      setStatus("Saved.");
    } catch {
      setError("Network error. Nothing was saved.");
    } finally {
      setSaving(false);
    }
  };

  // Every caption below is a real <label> (or, for the chip row, the group's
  // aria-labelledby) rather than a div paired with an aria-label. An aria-label
  // that disagrees with the visible text — "One line" shown, "Description"
  // announced — leaves a voice-control user saying what they can see and
  // matching nothing.
  const caption = "text-[11px] font-semibold uppercase tracking-wider text-faint";
  const input =
    "w-full rounded-[9px] border bg-card px-3 py-2.5 text-[14px] outline-none focus-visible:outline-2 focus-visible:outline-offset-[3px]";
  const inputStyle = { borderColor: "var(--line)", outlineColor: "var(--time)" } as const;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="course-details"
        className="rounded-[7px] px-1 text-[13px] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[3px]"
        style={{ outlineColor: "var(--time)" }}
      >
        {/* Decorative: `aria-expanded` already says which way this is pointing,
            and unhidden the glyph joins the accessible name — leaving a
            voice-control user unable to say what the button is called. */}
        <span aria-hidden>{open ? "▾" : "▸"}</span> Details
      </button>

      {/*
       * Hidden rather than unmounted, for two reasons that are really one.
       * `aria-controls` above has to name an element that exists, and the live
       * region at the bottom has to be in the DOM before its text changes — a
       * region that arrives already holding its message is unreliably announced.
       *
       * The display toggle is a class swap and not the `hidden` attribute alone:
       * `[hidden] { display: none }` comes from the user-agent sheet, and any
       * author rule beats it, so Tailwind's `flex` would quietly keep this open.
       * The attribute stays for the semantics; the class is what enforces them.
       */}
      <div
        id="course-details"
        hidden={!open}
        className={open ? "mt-2 flex flex-col gap-4 rounded-[10px] border bg-card p-4" : "hidden"}
        style={{ borderColor: "var(--line)" }}
      >
        <div>
          <label htmlFor="details-description" className={`${caption} block`}>
            One line
          </label>
          <input
            id="details-description"
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            maxLength={MAX_DESCRIPTION_LENGTH}
            placeholder="What does this course do?"
            className={`${input} mt-1.5`}
            style={inputStyle}
          />
        </div>

        <div>
          {/* No input to label, so the caption names a group instead. */}
          <div id="details-topics-label" className={caption}>
            Topics · up to {MAX_TOPICS}
          </div>
          <div
            role="group"
            aria-labelledby="details-topics-label"
            className="mt-2 flex flex-wrap gap-1.5"
          >
            {TOPICS.map((topic) => {
              const on = draft.topics.includes(topic);
              return (
                <button
                  key={topic}
                  type="button"
                  onClick={() => toggleTopic(topic)}
                  aria-pressed={on}
                  className="rounded-full border px-2.5 py-1.5 text-[12px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-[3px]"
                  style={{
                    borderColor: on ? "var(--time-line)" : "var(--line)",
                    background: on ? "var(--time-soft)" : "transparent",
                    color: on ? "var(--time)" : "var(--muted-foreground)",
                    outlineColor: "var(--time)",
                  }}
                >
                  {topic}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label htmlFor="details-audience" className={`${caption} block`}>
            Who&apos;s it for?
          </label>
          <input
            id="details-audience"
            value={draft.audience}
            onChange={(e) => setDraft((d) => ({ ...d, audience: e.target.value }))}
            maxLength={MAX_AUDIENCE_LENGTH}
            placeholder="e.g. Assumes you know Python and basic calculus"
            className={`${input} mt-1.5`}
            style={inputStyle}
          />
          <p className="mt-1.5 text-[12px] text-faint">
            The transcripts say what&apos;s covered. Only you know who should watch it — and the
            tutor reads this before deciding how much to re-explain.
          </p>
        </div>

        {suggestedTitle && (
          <div className="flex items-start justify-between gap-3">
            {/* Shown rather than applied: the rename above is the only title
                  writer, so this offer points at it instead of duplicating it. */}
            <p className="text-[12px] text-faint">
              Suggested title: <span className="text-muted-foreground">{suggestedTitle}</span>
              <br />
              Rename the course above to use it.
            </p>
            <button
              type="button"
              onClick={() => setSuggestedTitle(null)}
              aria-label="Dismiss the suggested title"
              className="shrink-0 rounded-[7px] border px-2.5 py-1 text-[12px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-[3px]"
              style={{ borderColor: "var(--line)", outlineColor: "var(--time)" }}
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2.5">
          {/*
           * One live region, always present, with only its text conditional.
           *
           * Its attributes never change either. The obvious version swaps in
           * `role="alert"` for failures — a failure IS more of an interruption
           * than "Saved." — but changing a live region's role or politeness
           * after it exists is the same unsupported move as creating it with
           * its message already inside, and this one has to carry both kinds.
           * A polite announcement that always arrives beats an assertive one
           * that sometimes does; sighted owners get the distinction from
           * `--bad` anyway.
           *
           * It sits in the button row rather than above it so that the empty
           * idle case cannot open a `gap-4` hole in the panel. `mr-auto`
           * absorbs the row's own gap, so the buttons stay hard right.
           */}
          <p
            className="mr-auto text-[13px]"
            aria-live="polite"
            aria-atomic="true"
            style={error ? { color: "var(--bad)" } : undefined}
          >
            {error ?? status ?? ""}
          </p>
          <button
            type="button"
            onClick={() => void rederive()}
            disabled={deriving || saving}
            className="rounded-[9px] border px-4 py-2 text-[13.5px] font-semibold disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-[3px]"
            style={{ borderColor: "var(--line)", outlineColor: "var(--time)" }}
          >
            {deriving ? "Reading the transcripts…" : "Re-derive ⟳"}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || deriving}
            className="rounded-[9px] border px-4 py-2 text-[13.5px] font-bold disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-[3px]"
            style={{ borderColor: "var(--line)", outlineColor: "var(--time)" }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
