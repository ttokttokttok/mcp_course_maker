import { backfillTitles } from "@/lib/transcripts/backfill";
import { OEmbedVideoMetaProvider } from "@/lib/transcripts/meta";

async function main() {
  const r = await backfillTitles({ metaProvider: new OEmbedVideoMetaProvider() });
  console.log(`backfill:titles — scanned ${r.scanned}, updated ${r.updated}, skipped ${r.skipped}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("backfill:titles failed", e);
  process.exit(1);
});
