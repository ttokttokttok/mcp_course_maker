# Course Maker

Turn a pile of YouTube lectures into a course you can navigate by time — with a
tutor that has read every transcript.

Paste some YouTube links. `yt-dlp` pulls the captions onto your machine, the app
reads them, and you get a course: an ordered outline, a player, and a chat panel
that can answer "where does he actually derive that?" with a timestamp you can
click.

Everything runs locally. One SQLite file, one OpenAI key, no accounts, no
database server, nothing to deploy.

---

## What it does

- **Ingests transcripts with `yt-dlp`.** Real captions where they exist, YouTube's
  machine ones otherwise. Cached by video id, so the same lecture in two courses
  is downloaded once.
- **Names the course for you.** Once the transcripts land, one model call derives
  a title, a one-line description, topics, and a one-line summary of each video.
  It fills in only what you have not written yourself, and never overwrites you.
- **Answers with timestamps.** The tutor has two tools: read the transcript around
  a moment, and find where a concept comes up — in this video or across the whole
  course. Every quote it uses is one it actually read.
- **Searches your catalog.** Over titles, descriptions, topics and the channels
  the videos came from, with a line on each result saying why it matched.

## What it is not

- Not multi-user. There is no sign-in, and no notion of "someone else's course" —
  everything in the database is yours.
- Not a transcript search engine. The catalog search is over course metadata;
  searching _inside_ transcripts is the tutor's job, scoped to one course.
- Not hosted. It is a local app that happens to be a web app.

---

## Requirements

|                       |                                                      |
| --------------------- | ---------------------------------------------------- |
| **Node**              | 20 or newer                                          |
| **`yt-dlp`**          | on your `PATH` — this is how transcripts are fetched |
| **An OpenAI API key** | for the tutor and the metadata derivation            |

Installing `yt-dlp`:

```bash
brew install yt-dlp          # macOS
pipx install yt-dlp          # anywhere with Python
winget install yt-dlp        # Windows
```

Keep it updated (`yt-dlp -U`). YouTube changes things; yt-dlp's whole job is
keeping up, and an old copy is the most common cause of a video that will not
ingest.

## Getting started

```bash
git clone https://github.com/ttokttokttok/mcp_course_maker.git
cd mcp_course_maker
npm install

cp .env.example .env.local   # add your OPENAI_API_KEY
npm run dev                  # http://localhost:3000
```

The database is created on first run at `data/app.db`. There is no migration
step and nothing to provision — delete the file and you have a clean install.

Then: **+ New course** → paste a few YouTube links → **Create course**. Videos
transcribe one at a time and the outline updates as each lands.

---

## Configuration

Everything except `OPENAI_API_KEY` is optional and has a working default. The
full list, with comments, is in [`.env.example`](.env.example). The ones worth
knowing about:

| Variable                     | Default         | What it's for                                   |
| ---------------------------- | --------------- | ----------------------------------------------- |
| `OPENAI_API_KEY`             | —               | **Required.** The tutor and metadata derivation |
| `OPENAI_MODEL`               | `gpt-4o-mini`   | What the prompts are tuned for                  |
| `DATABASE_PATH`              | `./data/app.db` | Move the database elsewhere                     |
| `YTDLP_PATH`                 | `yt-dlp`        | If the binary is not on your `PATH`             |
| `YTDLP_SUB_LANGS`            | `en.*,en`       | Ingest courses in another language              |
| `YTDLP_COOKIES_FROM_BROWSER` | —               | See below                                       |
| `SUPADATA_API_KEY`           | —               | Optional hosted fallback; see below             |

### When YouTube says "sign in to confirm you're not a bot"

YouTube throws this at IP addresses it does not like — datacenter ranges
especially, so it shows up quickly if you run this on a VPS. Point yt-dlp at a
browser where you are already signed in:

```bash
YTDLP_COOKIES_FROM_BROWSER=firefox
```

The same setting is what gets age-gated videos through.

### The hosted fallback

If you set `SUPADATA_API_KEY`, [Supadata](https://supadata.ai) is tried as a
second attempt for any video yt-dlp could not fetch — useful if you are running
somewhere YouTube blocks and cookies are not an option. It is entirely optional:
with the key unset the app uses yt-dlp alone, which is the default and needs no
account.

---

## How it fits together

```
app/
  page.tsx                the catalog: search box + every course you have
  search/                 results, with a why-line on each card
  create/                 paste links, drag to order
  roadmap/[id]/           the studio: player, outline, tutor
  api/
    chat/                 the tutor's streaming endpoint + its system prompt
    roadmaps/             create, rename, reorder, add/remove videos, retry
lib/
  transcripts/            fetching and caching
    ytdlp.ts              the default provider: spawns yt-dlp, parses the VTT
    supadata.ts           the optional hosted fallback
    provider.ts           the interface, the fallback wrapper, the factory
    store.ts              the transcript cache, keyed by video id
  engine/                 pure transcript logic: VTT parsing, search, windows
  roadmaps/               course CRUD, catalog search, metadata derivation
  tutor/                  the tools the model can call, and the course map
db/index.ts               the entire schema, and the SQLite handle
```

Two ideas carry most of the design:

**Transcripts are cached by video id alone**, not per course. Adding a lecture
someone already ingested is instant, and removing a video from a course unlinks
it rather than deleting the transcript another course may be using.

**A course is not named until something names it.** A new course stores an empty
title deliberately, so the derivation can tell "nobody has written this" from "I
should leave this alone". That rule is why the model never overwrites your words.

### Adding another transcript source

`TranscriptProvider` is one method:

```ts
interface TranscriptProvider {
  fetchTranscript(videoId: string): Promise<TranscriptDoc>;
}
```

Implement it, and compose it in `createTranscriptProvider()` in
`lib/transcripts/provider.ts`. `FallbackTranscriptProvider` chains two, and
`RetryingTranscriptProvider` adds backoff for sources that rate-limit.

---

## Development

```bash
npm run dev        # dev server
npm test           # vitest, 270 tests, no network and no API key needed
npm run lint       # oxlint + oxfmt
npm run build      # production build
```

The tests run against a real in-memory SQLite database built from the same DDL
the app uses, so the catalog queries, the derivation transaction and the
ingestion bookkeeping are all actually exercised. Nothing in the suite touches
the network — yt-dlp and the model are faked at their seams.

One script is worth knowing about:

```bash
npm run feature -- <courseId>              # pin a course to the top of the catalog
npm run feature -- <courseId> --unfeature
```

## Stack

Next.js 16 (App Router) · React 19 · Tailwind 4 · assistant-ui · Vercel AI SDK ·
better-sqlite3 · yt-dlp · vitest

## License

[MIT](LICENSE) — use it, change it, ship it, sell it. Just keep the copyright
notice in copies of the source.
