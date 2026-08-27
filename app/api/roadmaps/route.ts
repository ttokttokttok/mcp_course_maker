import { NextRequest, NextResponse } from "next/server";
import { createRoadmap } from "@/lib/roadmaps/roadmaps";
import { normalizeTitle } from "@/lib/roadmaps/title";

export async function POST(req: NextRequest) {
  const { title, urls } = await req.json();
  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ error: "a non-empty urls[] is required" }, { status: 400 });
  }

  /**
   * A course is not named until someone names it.
   *
   * An ABSENT title stores "" — deliberately, not as a fallback. Derivation
   * fills the title only when you have not written one, so any placeholder
   * invented here (the first video's name, "Untitled course") would permanently
   * suppress the derived title on every course. Blank has to mean blank for that
   * rule to work.
   *
   * A SUPPLIED title still has to be usable: "" is legal to create and illegal
   * to rename to, and every other write path keeps rejecting it.
   */
  const normalizedTitle = title === undefined ? "" : normalizeTitle(title);
  if (normalizedTitle === null) {
    return NextResponse.json({ error: "title must be 1–200 characters" }, { status: 400 });
  }

  const result = await createRoadmap({ title: normalizedTitle, urls });
  if (result.videos.length === 0) {
    return NextResponse.json(
      { error: "no valid YouTube URLs/IDs found in urls[]" },
      { status: 400 },
    );
  }
  return NextResponse.json(result, { status: 201 });
}
