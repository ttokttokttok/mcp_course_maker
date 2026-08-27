# Course Maker

Turn a pile of YouTube lectures into a course you can navigate by time — and
hand it to an AI assistant as an **MCP server**, so the assistant can search
what was actually said and show you the moment it was said.

Paste some YouTube links. `yt-dlp` pulls the captions onto your machine and the
app builds a course: an ordered outline, a player, and search over every word of
every transcript. Then either use it as a web app with its own tutor, or connect
it to ChatGPT, Claude or any MCP client and let _that_ model do the teaching.

Everything runs locally. One SQLite file, no accounts, no database server,
nothing to deploy.

---

## Two front doors, one core

The interesting part is the split. `lib/` and `db/` know nothing about Next.js or
about MCP — they ingest YouTube, store transcripts, and answer questions about
them. Two thin adapters sit on top:

|                             |                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| **The web app** (`app/`)    | Ships its own tutor — assistant-ui + the Vercel AI SDK. Needs an OpenAI key.             |
| **The MCP server** (`mcp/`) | Ships **no** model. ChatGPT or Claude _is_ the tutor; this just gives it tools and a UI. |

Adding a third door — a CLI, a Discord bot — means writing another adapter, not
another copy of the logic.

## What it does

- **Ingests transcripts with `yt-dlp`.** Real captions where they exist, YouTube's
  machine ones otherwise. Cached by video id, so the same lecture in two courses
  is downloaded once.
- **Names the course for you.** Once the transcripts land, one model call derives
  a title, a description, topics, and a line on each video. It fills in only what
  you have not written yourself, and never overwrites you.
- **Answers with timestamps.** Concept search runs over the transcripts and
  returns real quotes with the second they were said at — in one video or across
  the whole course.
- **Renders a player inside the conversation.** The MCP `get_course` tool is
  bound to an interactive View: video, outline, and a search box that seeks the
  player to whatever it finds.

## What it is not

- Not multi-user. There is no sign-in and no notion of "someone else's course" —
  everything in the database is yours.
- Not a hosted service. It is a local app that happens to speak HTTP.
- Not a transcript search _engine_. Catalog search covers course metadata;
  searching inside transcripts is `find_concept`, scoped to one course.

---

## Requirements

|                       |                                                                               |
| --------------------- | ----------------------------------------------------------------------------- |
| **Node**              | 22.22 or newer (mcp-use requires it)                                          |
| **`yt-dlp`**          | on your `PATH` — this is how transcripts are fetched                          |
| **An OpenAI API key** | only for the _built-in_ tutor and course naming. The MCP server needs no key. |

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

cp .env.example .env.local   # add OPENAI_API_KEY if you want the built-in tutor
npm run dev                  # http://localhost:3000
```

The database is created on first run at `data/app.db`. There is no migration step
and nothing to provision — delete the file and you have a clean install.

Then either open the app and hit **+ New course**, or connect an MCP client and
ask it to make one.

> **Windows and WSL: pick one and stay there.** This project has two native
> dependencies — `better-sqlite3` and the `rolldown` binary behind mcp-use's view
> build — and npm only downloads binaries for the platform you install on. A
> checkout under `/mnt/c` that you `npm install` from WSL and then run from
> Windows (or the reverse) gets a missing or mismatched `.node` and fails with
> something unhelpful, such as:
>
> ```
> value `"builtin:vite-wasm-fallback"` does not match any variant of
> enum `BindingBuiltinPluginName`
> ```
>
> The fix is always the same: `rm -rf node_modules && npm install`, run from
> whichever OS you intend to run `npm run dev` from.

---

## Using it as an MCP server

The server is mounted at **`http://localhost:3000/api/mcp`** (streamable HTTP)
whenever the app is running. It speaks the [MCP Apps](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)
extension, so hosts that support it render the course player inline.

**Claude Code:**

```bash
claude mcp add --transport http course-maker http://localhost:3000/api/mcp
```

**Anything else:** point your client at the same URL. For ChatGPT, which only
connects to remote HTTPS endpoints, put a tunnel in front of it
(`cloudflared tunnel --url http://localhost:3000`) or deploy the app.

**Poke at it directly:**

```bash
npx @modelcontextprotocol/inspector http://localhost:3000/api/mcp
```

### The tools

| Tool                                             |                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `list_courses`                                   | Every course, pinned first then newest                                 |
| `search_courses`                                 | Over titles, descriptions, topics and channels                         |
| `get_course`                                     | One course's outline and ingest progress — **renders the player View** |
| `find_concept`                                   | Search _inside_ the transcripts; returns timestamped quotes            |
| `get_transcript`                                 | Read the transcript around a moment                                    |
| `create_course`                                  | Build a course from YouTube links                                      |
| `add_videos` · `remove_video` · `reorder_videos` | Edit a course                                                          |
| `retry_video`                                    | Requeue a transcript download that failed                              |

Ingestion is fire-and-forget: `create_course` returns immediately with videos
still `pending`, and the tool descriptions tell the model to call `get_course`
again to watch them land.

### The View

`get_course` is bound to `mcp/views/course-player/`, a React component the host
renders in a sandboxed iframe. It shows the video, the ordered outline, and a
search box that calls `find_concept` back through the same MCP connection —
clicking a hit moves the player to that second.

The YouTube embed is a **nested** iframe, which the MCP Apps sandbox forbids
unless the view declares the origin. That declaration lives on the tool's `view`
config in `mcp/server.ts`:

```ts
csp: {
  frameDomains: ["https://www.youtube.com", "https://www.youtube-nocookie.com"],
  resourceDomains: ["https://i.ytimg.com"],
}
```

Hosts may still decline to render a subframe — OpenAI notes that `frameDomains`
triggers stricter review — so the view degrades to a thumbnail that opens
YouTube at the right timestamp rather than to a dead rectangle.

> Restart the dev server after editing `mcp/server.ts` or a view. The mcp-use
> build runs when Next evaluates `next.config.ts`, which is once per start.

---

## Configuration

Everything except `OPENAI_API_KEY` is optional and has a working default. The
full list, with comments, is in [`.env.example`](.env.example).

| Variable                     | Default         | What it's for                                             |
| ---------------------------- | --------------- | --------------------------------------------------------- |
| `OPENAI_API_KEY`             | —               | The built-in tutor and course naming. Not needed for MCP. |
| `OPENAI_MODEL`               | `gpt-4o-mini`   | What the prompts are tuned for                            |
| `DATABASE_PATH`              | `./data/app.db` | Move the database elsewhere                               |
| `YTDLP_PATH`                 | `yt-dlp`        | If the binary is not on your `PATH`                       |
| `YTDLP_SUB_LANGS`            | `en.*,en`       | Ingest courses in another language                        |
| `YTDLP_COOKIES_FROM_BROWSER` | —               | See below                                                 |
| `SUPADATA_API_KEY`           | —               | Optional hosted fallback; see below                       |

### When YouTube says "sign in to confirm you're not a bot"

YouTube throws this at IP addresses it does not like — datacenter ranges
especially, so it shows up quickly if you host this rather than run it locally.
Point yt-dlp at a browser where you are already signed in:

```bash
YTDLP_COOKIES_FROM_BROWSER=firefox
```

The same setting is what gets age-gated videos through.

### The hosted fallback

If you set `SUPADATA_API_KEY`, [Supadata](https://supadata.ai) is tried as a
second attempt for any video yt-dlp could not fetch. Entirely optional: with the
key unset the app uses yt-dlp alone, which is the default and needs no account.

---

## How it fits together

```
mcp/
  server.ts               10 MCP tools over lib/ — no model, no prompts
  views/course-player/    the React View get_course renders
app/
  page.tsx                the catalog: search box + every course you have
  search/  create/        results; paste links and drag to order
  roadmap/[id]/           the studio: player, outline, built-in tutor
  api/mcp/[[...path]]/    mounts the MCP server
  api/chat/               the built-in tutor's streaming endpoint
lib/
  transcripts/
    ytdlp.ts              the default provider: spawns yt-dlp, parses the VTT
    supadata.ts           the optional hosted fallback
    provider.ts           the interface, the fallback wrapper, the factory
    store.ts              the transcript cache, keyed by video id
  engine/                 pure transcript logic: VTT parsing, search, windows
  roadmaps/               course CRUD, catalog search, metadata derivation
  tutor/retrieval.ts      what may be read, and by whom — shared by both doors
db/index.ts               the entire schema, and the SQLite handle
```

Three ideas carry most of the design:

**Transcripts are cached by video id alone**, not per course. Adding a lecture
someone already ingested is instant, and removing a video from a course unlinks
it rather than deleting a transcript another course may be using.

**A course is not named until something names it.** A new course stores an empty
title deliberately, so derivation can tell "nobody has written this" from "leave
this alone". That rule is why the model never overwrites your words.

**One authority per rule.** `lib/tutor/retrieval.ts` decides whether a video
belongs to a course; both the built-in tutor and the MCP server go through it.
The id is model-supplied in both cases, and two copies of that check is how one
comes to trust what the other rejects.

### Adding another transcript source

`TranscriptProvider` is one method:

```ts
interface TranscriptProvider {
  fetchTranscript(videoId: string): Promise<TranscriptDoc>;
}
```

Implement it and compose it in `createTranscriptProvider()` in
`lib/transcripts/provider.ts`. `FallbackTranscriptProvider` chains two, and
`RetryingTranscriptProvider` adds backoff for sources that rate-limit.

## Development

**This project uses npm.** `package-lock.json` is committed and the `overrides`
field below is npm syntax, which pnpm and yarn silently ignore — installing with
one of those resolves a different dependency tree than the one that is tested.

```bash
npm run dev        # app + MCP server + view build
npm test           # vitest — no network, no API key
npm run lint       # oxlint + oxfmt
npm run build      # production build
```

The tests run against a real in-memory SQLite database built from the same DDL
the app uses, so the catalog queries, the derivation transaction, the ingestion
bookkeeping and the shared retrieval guards are all actually exercised. Nothing
in the suite touches the network — yt-dlp and the model are faked at their seams.

One script is worth knowing about:

```bash
npm run feature -- <courseId>              # pin a course to the top of the catalog
npm run feature -- <courseId> --unfeature
```

### Why `overrides.vite` exists

`package.json` pins a single `vite` for the whole tree. Without it, mcp-use's CLI
brings its own `vite` (and therefore its own `rolldown` native binary) while
vitest brings another. Two copies means two sets of platform binaries to keep in
sync, and when only one of them has a binary for your OS, Node resolves *upward*
and loads the wrong one — which fails as a confusing enum mismatch rather than as
a missing file. One vite, one binary, one thing to get right.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind 4 · [mcp-use](https://mcp-use.com)
· MCP Apps · assistant-ui · Vercel AI SDK · better-sqlite3 · yt-dlp · vitest

## License

[MIT](LICENSE) — use it, change it, ship it, sell it. Just keep the copyright
notice in copies of the source.
