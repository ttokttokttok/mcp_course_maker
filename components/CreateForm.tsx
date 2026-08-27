"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function CreateForm({ initialTitle }: { initialTitle: string }) {
  const router = useRouter();
  /**
   * Seeded by the empty-search pitch. State, not a derived read: the visitor can
   * clear it, and a course with no title is the normal case — derivation names
   * it. Kept as a LINE rather than an input on purpose; /create deliberately
   * stopped asking for a name on 2026-07-30, and a silently-applied title would
   * be worse than no title at all.
   */
  const [seededTitle, setSeededTitle] = useState(initialTitle);
  const [draft, setDraft] = useState("");
  const [urls, setUrls] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragIndex = useRef<number | null>(null);

  const addUrl = () => {
    const v = draft.trim();
    if (!v) return;
    setUrls((prev) => [...prev, v]);
    setDraft("");
  };

  const removeUrl = (i: number) => setUrls((prev) => prev.filter((_, idx) => idx !== i));

  const onDrop = (to: number) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === to) return;
    setUrls((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const create = async () => {
    setError(null);
    if (urls.length === 0) {
      setError("Add at least one YouTube link.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/roadmaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(seededTitle ? { urls, title: seededTitle } : { urls }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Failed to create course.");
        setSubmitting(false);
        return;
      }
      router.push(`/roadmap/${data.id}`);
    } catch {
      setError("Network error creating course.");
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-6 flex flex-col gap-3">
      {seededTitle && (
        <div
          className="flex items-center gap-2 rounded-[8px] border px-3 py-2 text-[13px]"
          style={{ borderColor: "var(--line)" }}
        >
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            Naming it &ldquo;<span className="font-semibold text-foreground">{seededTitle}</span>
            &rdquo;
          </span>
          <button
            type="button"
            onClick={() => setSeededTitle("")}
            aria-label="Clear the name and let us name it from the transcripts"
            className="text-faint hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[3px]"
            style={{ outlineColor: "var(--time)" }}
          >
            ✕
          </button>
        </div>
      )}
      <div className="flex gap-2.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addUrl();
            }
          }}
          placeholder="Paste a YouTube URL or video ID…"
          aria-label="YouTube URL"
          className="flex-1 rounded-[9px] border bg-card px-3 py-3 text-[14px] outline-none focus-visible:outline-2 focus-visible:outline-offset-[3px]"
          style={{ borderColor: "var(--line)", outlineColor: "var(--time)" }}
        />
        <button
          type="button"
          onClick={addUrl}
          className="rounded-[9px] border px-4 text-[13.5px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-[3px]"
          style={{ borderColor: "var(--line)", outlineColor: "var(--time)" }}
        >
          Add
        </button>
      </div>

      {urls.length > 0 && (
        <div className="mt-2 border-t pt-3" style={{ borderColor: "var(--line)" }}>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
            {urls.length} {urls.length === 1 ? "video" : "videos"} · drag to reorder
          </div>
          <ul className="flex flex-col gap-1.5">
            {urls.map((u, i) => (
              <li
                key={`${u}-${i}`}
                draggable
                onDragStart={() => (dragIndex.current = i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(i)}
                className="flex items-center gap-3 rounded-[8px] bg-muted px-2.5 py-2 text-[13.5px]"
              >
                <span
                  aria-hidden
                  className="cursor-grab select-none text-base leading-none text-faint"
                  title="Drag to reorder"
                >
                  ⠿
                </span>
                <span className="min-w-0 flex-1 truncate">{u}</span>
                <button
                  type="button"
                  onClick={() => removeUrl(i)}
                  aria-label="Remove"
                  className="text-faint hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[3px]"
                  style={{ outlineColor: "var(--time)" }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className="text-[13px]" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={create}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 rounded-[9px] px-5 py-3 text-[14px] font-bold disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-[3px]"
          style={{
            background: "var(--brand)",
            color: "var(--brand-on)",
            outlineColor: "var(--time)",
          }}
        >
          {submitting ? "Creating…" : "Create course →"}
        </button>
      </div>
    </div>
  );
}
