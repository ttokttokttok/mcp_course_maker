import { AppHeader } from "@/components/AppHeader";
import { CreateForm } from "@/components/CreateForm";

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ title?: string | string[] }>;
}) {
  // A repeated ?title=a&title=b arrives as an array — only a single string is
  // ever a real seeded title.
  const { title: rawTitle } = await searchParams;
  const initialTitle = typeof rawTitle === "string" ? rawTitle.trim() : "";

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-[600px] px-5 py-12">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">New</div>
        <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight">New course</h1>
        <p className="mt-2 text-[14px] text-muted-foreground">
          Paste YouTube links, drag to reorder. Order is the whole point of a course. You
          don&rsquo;t have to name it — once the transcripts are in, it names itself.
        </p>

        <CreateForm initialTitle={initialTitle} />
      </main>
    </>
  );
}
