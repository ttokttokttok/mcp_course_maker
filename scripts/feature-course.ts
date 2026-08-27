import { setFeatured } from "@/lib/roadmaps/roadmaps";
import { isRoadmapId } from "@/lib/roadmaps/id";

const USAGE = "usage: npm run feature -- <roadmapId> [--unfeature]";

async function main() {
  const args = process.argv.slice(2);
  const [id, flag] = args;
  // Accept exactly two shapes: `<id>` (feature) or `<id> --unfeature`. Anything else is a
  // typo, and defaulting a typo to "feature" would silently invert what you meant.
  if (!id || args.length > 2 || (flag !== undefined && flag !== "--unfeature")) {
    console.error(USAGE);
    process.exit(1);
  }
  // Shape-checked so the "no roadmap with id" message below is the one you get,
  // and to catch the common slip of running `npm run feature -- --unfeature`
  // with the id omitted, which would otherwise read the flag as the roadmap id.
  if (!isRoadmapId(id)) {
    console.error(`not a roadmap id: ${id}\n${USAGE}`);
    process.exit(1);
  }
  const featured = flag !== "--unfeature";
  // An id that matches no row updates nothing; without this check the script
  // reported success for a typo'd UUID.
  const updated = await setFeatured(id, featured);
  if (updated.length === 0) {
    console.error(`no roadmap with id ${id}`);
    process.exit(1);
  }
  console.log(`${featured ? "featured" : "unfeatured"} "${updated[0].title}" (${id})`);
  process.exit(0);
}

main().catch((e) => {
  console.error("feature failed", e);
  process.exit(1);
});
