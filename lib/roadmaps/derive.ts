import { db, now } from "@/db";
import { getRoadmap, listRoadmapVideos } from "./roadmaps";
import { getTranscriptsByIds } from "@/lib/transcripts/store";
import { deriveMetadata, isDerivable } from "./metadata";
import { mergeDerived } from "./draft";

/**
 * Derive whatever this course is still missing, and store it.
 *
 * Called at the end of ingestion and after a successful retry, rather than from
 * a button: a course nobody thought to re-derive never got a name that way, so
 * you never saw the feature at all and reasonably concluded it did not exist.
 *
 * Deliberately conservative, because it runs without anybody asking:
 *  - course fields only when the course has never been derived, and then only
 *    through `mergeDerived`, which fills what nobody has written;
 *  - summaries only onto rows that have none;
 *  - no model call at all when neither is missing.
 *
 * "Re-derive" in the studio is the explicit path and is NOT this function — a
 * person pressing a button on purpose should always get a fresh answer.
 */
export async function deriveAndStore(roadmapId: string): Promise<void> {
  try {
    const rm = await getRoadmap(roadmapId);
    if (!rm) return;

    const rows = await listRoadmapVideos(roadmapId);
    const docs = await getTranscriptsByIds(rows.map((r) => r.videoId));
    const byId = new Map(docs.map((d) => [d.videoId, d]));

    // Course order, not storage order. `getTranscriptsByIds` is an unordered
    // `where video_id in (...)`, and the prompt labels these "## Video 1, 2, 3"
    // — which asserts a running order to a model being asked to describe a
    // course whose order IS the course. Videos still ingesting drop out.
    //
    // `isDerivable`, not "a transcript row exists": the provider maps an empty
    // caption list without complaint and ingest writes that video down as ready,
    // so the two are different sets, and `deriveMetadata` numbers its headings
    // from the segment-bearing one. Filtering on the wider set here would map
    // every index back onto a row one too early. Imported rather than restated
    // for exactly that reason.
    //
    // The pair is carried through the filter rather than the row and the doc
    // being filtered separately: two lists narrowed by the same rule in two
    // places is the same drift by another route.
    const ready = rows.flatMap((row) => {
      const doc = byId.get(row.videoId);
      return doc && isDerivable(doc) ? [{ row, doc }] : [];
    });
    if (ready.length === 0) return;

    const needsCourse = rm.metadataDerivedAt === null;
    const needsSummaries = ready.some((r) => r.row.summary === "");
    if (!needsCourse && !needsSummaries) return;

    const derived = await deriveMetadata({
      videos: ready.map((r) => ({
        title: r.doc.title,
        channel: r.doc.channel,
        segments: r.doc.segments,
      })),
    });

    // One transaction: a course marked derived with its summaries missing would
    // never be revisited by the `metadata_derived_at` gate, and the gap would be
    // permanent. better-sqlite3 runs the callback inside BEGIN/COMMIT and rolls
    // the whole thing back if it throws — which is why every statement in here
    // is synchronous, and why the model call is above it rather than inside.
    db.transaction(() => {
      if (needsCourse) {
        // Re-read, because `rm` is a snapshot from before a model call that
        // takes seconds, and you can rename the course inside that window.
        // Merging against the stale copy reads your new title as "nobody has
        // written this" and overwrites it — the exact loss rule 2 exists to
        // prevent, just through a narrower door than the concurrent-derive race.
        const fresh = db
          .prepare("SELECT title, description, audience, topics FROM roadmaps WHERE id = ?")
          .get(roadmapId) as
          | { title: string; description: string; audience: string; topics: string }
          | undefined;
        // Deleted mid-derive; ingestion outlives the course. Returning abandons
        // the summary writes too, which is right — those rows cascaded away with
        // it, and writing to them is at best a no-op.
        if (!fresh) return;

        const merged = mergeDerived(
          {
            title: fresh.title,
            description: fresh.description,
            audience: fresh.audience,
            topics: JSON.parse(fresh.topics) as string[],
          },
          derived,
        );
        // Stamped only if the course actually got a name. A model that returned
        // nothing useful must not close the door on the next attempt, or the
        // course keeps its first video's title forever.
        if (merged.title.trim() !== "") {
          db.prepare(
            `UPDATE roadmaps
             SET title = ?, description = ?, topics = ?, metadata_derived_at = ?
             WHERE id = ? AND metadata_derived_at IS NULL`,
            // The `IS NULL` is in the WHERE, not an `if` on the row just read:
            // two ingestions finishing together both read null and both decide
            // to write, so the decision has to be the same statement as the
            // write. The database is the only arbiter that sees both.
          ).run(merged.title, merged.description, JSON.stringify(merged.topics), now(), roadmapId);
        }
      }

      const setSummary = db.prepare("UPDATE roadmap_videos SET summary = ? WHERE id = ?");
      for (const { index, summary } of derived.videoSummaries) {
        // 1-based, matching the `## Video N` headings the model was shown.
        // `deriveMetadata` already dropped out-of-range indexes; this is the
        // second half of the same guard, and it is cheap.
        const target = ready[index - 1];
        if (!target || target.row.summary !== "") continue;
        setSummary.run(summary, target.row.id);
      }
    })();
  } catch (e) {
    // Never throws. This runs inside fire-and-forget ingestion, where an
    // exception would reject the background promise — a course whose videos are
    // all ready must not be reported as broken because a title could not be
    // written. It keeps its fallback name until the next attempt or Re-derive.
    console.error("derive failed", { roadmapId, error: e });
  }
}

/**
 * Write derived summaries onto the given rows, by 1-based index.
 *
 * Exported for the Re-derive route, which deliberately does NOT go through
 * `deriveAndStore`: that function is the automatic path and declines to touch a
 * course it has already derived, whereas a person pressing a button on purpose
 * should always get a fresh answer. The two share the model call, not the write
 * policy.
 *
 * Unlike the automatic path, this OVERWRITES an existing summary — that is what
 * "re-derive" means.
 *
 * `orderedRows` has to be the same transcript-bearing, course-ordered list the
 * model was shown, because that is the list its indexes are numbered against.
 * This function cannot check that, so its caller carries the row and the doc
 * through one filter together rather than narrowing two lists by the same rule
 * in two places.
 */
export async function storeVideoSummaries(
  roadmapId: string,
  orderedRows: { id: string }[],
  summaries: { index: number; summary: string }[],
): Promise<void> {
  for (const { index, summary } of summaries) {
    // 1-based, matching the `## Video N` headings the model was shown.
    // `deriveMetadata` already dropped out-of-range indexes; this is the second
    // half of the same guard, and it is cheap.
    const target = orderedRows[index - 1];
    if (!target) continue;
    // Scoped to the course as well as the row: `id` alone is sufficient, but this
    // is the one write in the feature that overwrites a value a caller supplied
    // the addressing for, and the whole hazard here is a list that does not mean
    // what the writer thinks it means. Out-of-course is then a no-op rather than
    // a stranger's course silently rewritten.
    db.prepare("UPDATE roadmap_videos SET summary = ? WHERE id = ? AND roadmap_id = ?").run(
      summary,
      target.id,
      roadmapId,
    );
  }
}
