"use client";

import { useMemo, type FC } from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  makeAssistantTool,
  makeAssistantToolUI,
} from "@assistant-ui/react";
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import { z } from "zod";
import { MarkdownText } from "@/components/markdown-text";
import { Timecode } from "@/components/Timecode";
import { usePlayerStore } from "@/components/player-store";

/**
 * `ingestStatus` was always here at runtime — `Studio` has passed whole rows
 * since the outline started showing status pills — but this type omitted it, so
 * the chat could not see the one field that decides whether it can answer.
 */
export type StudioVideo = {
  videoId: string;
  position: number;
  title: string;
  ingestStatus: string;
};

/** Seek the shared player; used by every Timecode in the chat column. */
function seekTo(seconds: number, videoId?: string) {
  const s = usePlayerStore.getState();
  s.seek(videoId ?? s.activeVideoId ?? "", seconds);
}

/* ---------------- tool result types ---------------- */
type ConceptHit = {
  start: number;
  timestamp: string;
  quote: string;
  score: number;
  videoId: string;
};

/* ---------------- tool UIs ---------------- */
function useFindConceptToolUI(videoMeta: Map<string, { index: number; title: string }>) {
  return useMemo(
    () =>
      makeAssistantToolUI<
        { query?: string; scope?: string },
        { hits?: ConceptHit[]; error?: string }
      >({
        toolName: "find_concept",
        render: ({ args, result, status }) => {
          if (status.type === "running" || !result) {
            return (
              <div
                className="self-start rounded-lg border px-2.5 py-1.5 font-mono text-[11px] tracking-tight"
                style={{
                  color: "var(--time)",
                  background: "var(--time-soft)",
                  borderColor: "var(--time-line)",
                }}
              >
                find_concept · searching “{args?.query ?? ""}”…
              </div>
            );
          }
          const hits = result.hits ?? [];
          if (hits.length === 0) {
            return (
              <div className="self-start text-xs text-muted-foreground">
                No matches for “{args?.query ?? ""}”.
              </div>
            );
          }
          return (
            <div className="flex flex-col gap-2 self-stretch">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">
                {hits.length} {hits.length === 1 ? "match" : "matches"}
                {args?.scope === "roadmap" ? " · whole course" : ""}
              </div>
              {hits.map((hit, i) => {
                const meta = videoMeta.get(hit.videoId);
                return (
                  <div
                    key={`${hit.videoId}-${hit.start}-${i}`}
                    className="rounded-[10px] border bg-card p-3"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="min-w-0 flex-1 truncate">
                        {meta ? `Video ${meta.index + 1} · ${meta.title}` : hit.videoId}
                      </span>
                      <Timecode seconds={hit.start} videoId={hit.videoId} onSeek={seekTo} />
                    </div>
                    <div className="text-[13px] leading-snug">{hit.quote}</div>
                  </div>
                );
              })}
            </div>
          );
        },
      }),
    [videoMeta],
  );
}

/* ---------------- tools ---------------- */
/**
 * Lets the agent move the player instead of only pointing at a moment.
 *
 * `frontendTools(...)` was already wired in app/api/chat/route.ts — the
 * plumbing existed and nobody had registered a tool through it.
 *
 * Bounded to this course's videos on purpose: the model must not be able to
 * point the player at arbitrary YouTube content.
 *
 * NOTE the field is `parameters`, not `inputSchema`. That is the opposite of
 * the AI SDK's `tool()` used by the backend tutor tools, and verified against
 * the installed @assistant-ui/react rather than the docs.
 *
 * `makeAssistantTool` is marked @deprecated in 0.14.28 in favour of
 * `defineToolkit` + `Tools({ toolkit })` registered through `useAui`. Still
 * exported and still working; the migration is deferred until that API settles,
 * and this note is here so the deprecation is not rediscovered as a surprise.
 */
function useSeekTool(videoIds: Set<string>) {
  return useMemo(
    () =>
      makeAssistantTool({
        toolName: "seek_to",
        type: "frontend",
        description:
          "Move the video player to a moment. Use this when the learner asks to be taken " +
          "somewhere, rather than only telling them the timestamp.",
        parameters: z.object({
          videoId: z.string().describe("A video in this course"),
          seconds: z.number().describe("Position in seconds from the start of that video"),
        }),
        execute: async ({ videoId, seconds }) => {
          if (!videoIds.has(videoId)) {
            return { ok: false, error: `video ${videoId} is not in this course` };
          }
          const target = Math.max(0, Math.floor(seconds));
          usePlayerStore.getState().seek(videoId, target);
          // Echoed back so the model can confirm what it did rather than
          // guessing. The player moving is the human-visible feedback, so there
          // is deliberately no tool UI.
          return { ok: true, videoId, seconds: target };
        },
      }),
    [videoIds],
  );
}

/* ---------------- what the tutor can actually do ---------------- */
type TutorGate = {
  /** One line, beside the composer it explains. */
  short: string;
  /** The same refusal with its reason, for an empty thread. */
  full: string;
};

/**
 * Decided by ONE status — the active video's — because that is the only one
 * `get_context` reads by default. A course with nine videos still transcribing
 * answers perfectly well about the one that is ready, so a blanket "anything
 * pending" check would shut the tutor for minutes over videos nobody asked
 * about.
 *
 * Something has to say this out loud. Until now the composer invited a question
 * the tools could not serve: `get_context` returns
 * `{ error: "transcript not ready for this video" }` and the learner gets a
 * vague non-answer with no reason attached. Ingestion is sequential now (a
 * deliberate trade against a vendor rate limit), so that window is minutes, not
 * seconds.
 *
 * Unknown statuses fall through to the transcribing branch, matching what the
 * outline's `StatusPill` does with the same input — one unrecognised status
 * should not produce two different stories on one screen.
 */
function tutorGate(status: string | undefined): TutorGate | null {
  if (status === "ready") return null;
  if (status === "failed") {
    return {
      short: "This video's transcript failed — retry it in the outline.",
      full:
        "This video's transcript failed, so the tutor has nothing to read here. " +
        "Waiting will not fix it: retry the video in the outline, or move to one that is ready.",
    };
  }
  // No row for the active id — an empty course. Not a wait, so it must not be
  // dressed as one.
  if (status === undefined) {
    return {
      short: "No video to ask about yet.",
      full: "There is no video in this course yet, so there is nothing for the tutor to read.",
    };
  }
  return {
    short: "Still transcribing this video — the tutor cannot read it yet.",
    full:
      "The tutor cannot answer about this video yet — its transcript is still being made. " +
      "Videos are transcribed one at a time, so a new course comes online over a few minutes. " +
      "The player works now; this will too.",
  };
}

/* ---------------- thread pieces ---------------- */
const UserMessage: FC = () => (
  <MessagePrimitive.Root className="flex flex-col">
    <div
      className="ml-auto max-w-[92%] rounded-xl px-3 py-2 text-[13px] leading-relaxed"
      style={{ background: "var(--foreground)", color: "var(--background)" }}
    >
      <MessagePrimitive.Parts />
    </div>
  </MessagePrimitive.Root>
);

const AssistantMessage: FC = () => (
  <MessagePrimitive.Root className="flex flex-col gap-2">
    <div
      className="max-w-[95%] self-start rounded-xl border bg-card px-3 py-2 text-[13px] leading-relaxed [&_p]:my-0"
      style={{ borderColor: "var(--line)" }}
    >
      <MessagePrimitive.Parts
        components={{ Text: MarkdownText, tools: { Fallback: () => null } }}
      />
    </div>
    {/*
     * Until now a refused prompt rendered NOTHING. At FREE_LIMIT = 1
     * a model provider's own refusal produced
     * silence, and search is what sends strangers here — so the silence was
     * about to become the default first impression rather than a corner case.
     */}
    <MessagePrimitive.Error>
      <div
        className="max-w-[95%] self-start rounded-xl border px-3 py-2 text-[13px] leading-relaxed"
        style={{
          borderColor: "color-mix(in srgb, var(--bad) 35%, var(--line))",
          background: "color-mix(in srgb, var(--bad) 6%, var(--card))",
          color: "var(--bad)",
        }}
      >
        <ErrorPrimitive.Root>
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </div>
    </MessagePrimitive.Error>
  </MessagePrimitive.Root>
);

export function StudioChat({ roadmapId, videos }: { roadmapId: string; videos: StudioVideo[] }) {
  const videoMeta = useMemo(() => {
    const m = new Map<string, { index: number; title: string }>();
    videos.forEach((v, i) => m.set(v.videoId, { index: i, title: v.title }));
    return m;
  }, [videos]);

  const videoIds = useMemo(() => new Set(videos.map((v) => v.videoId)), [videos]);

  const firstVideoId = videos[0]?.videoId ?? "";

  // Subscribed here, unlike the body-getter below which reads `getState()` on
  // demand: the gate is rendered, so it has to re-run when the learner switches
  // video. Deliberately not `positionSec` — that ticks every second and nothing
  // on this side of the screen depends on it.
  //
  // Same `?? firstVideoId` fallback the request body uses: the store is null
  // until `Studio`'s mount effect names a video, and the two must not disagree
  // about which video is being talked about.
  const activeVideoId = usePlayerStore((s) => s.activeVideoId);
  const activeId = activeVideoId ?? firstVideoId;
  const gate = tutorGate(videos.find((v) => v.videoId === activeId)?.ingestStatus);

  // `pending` only, and never the active video: a failed video is not "still
  // transcribing", and promising it will be searched later would be a worse lie
  // than saying nothing.
  const othersTranscribing = videos.filter(
    (v) => v.videoId !== activeId && v.ingestStatus === "pending",
  ).length;

  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({
      api: "/api/chat",
      // Resolvable body: re-read on every send so positionSec/videoId are CURRENT.
      body: () => {
        const s = usePlayerStore.getState();
        return {
          roadmapId,
          videoId: s.activeVideoId ?? firstVideoId,
          positionSec: Math.floor(s.positionSec),
        };
      },
      // On a non-OK response, `ai`'s HttpChatTransport does
      // `throw new Error(await response.text())` — the RAW body, never parsed as JSON
      // (node_modules/ai/dist/index.js). Every route in this app replies with
      // `{ error: "..." }` (app/api/chat/route.ts:76,80,83,91-95 among others), so without
      // this wrapper the tutor would show that literal JSON blob, braces and all, instead of
      // the sentence inside it. Unwrap it here, client-side, rather than making this one
      // route reply in plain text and break the `{ error }` shape every other route and
      // app/api/chat/route.test.ts rely on. Non-JSON bodies fall through unchanged.
      fetch: async (input, init) => {
        const res = await fetch(input, init);
        if (res.ok) return res;
        const body = await res.text();
        try {
          const parsed = JSON.parse(body);
          if (typeof parsed?.error === "string") {
            // No `headers` here: `res.headers` describes the original JSON body
            // (content-type: application/json, a content-length that no longer
            // matches, and any content-encoding), none of which is true of this
            // shorter plain-text body. Inert today — the sole consumer reads
            // only `.ok` and `.text()` — but there is no reason to carry false
            // headers on a Response we are constructing ourselves.
            return new Response(parsed.error, { status: res.status });
          }
        } catch {
          // Not JSON — fall through and preserve the original body verbatim.
        }
        return new Response(body, { status: res.status, headers: res.headers });
      },
    }),
  });

  const FindConceptToolUI = useFindConceptToolUI(videoMeta);
  const SeekTool = useSeekTool(videoIds);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {/* register tools and tool UIs */}
      <FindConceptToolUI />
      <SeekTool />

      <ThreadPrimitive.Root className="flex h-full min-h-[420px] flex-col rounded-[10px] bg-muted p-3">
        <div className="px-1 pb-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">Tutor</div>
          {/*
           * Nothing else on this screen says this. The outline's pills report a
           * video's status; they do not tell you that the whole-course search
           * you just ran quietly skipped those videos — the only tutor ability a
           * pending video ELSEWHERE narrows. Suppressed while `gate` is up,
           * where it would be a second, smaller piece of bad news about a wait
           * already being explained.
           */}
          {!gate && othersTranscribing > 0 && (
            <p className="mt-1 text-[11.5px] leading-snug text-faint">
              {othersTranscribing} more {othersTranscribing === 1 ? "video is" : "videos are"} still
              transcribing — a whole-course search will not cover{" "}
              {othersTranscribing === 1 ? "it" : "them"} yet.
            </p>
          )}
        </div>
        <ThreadPrimitive.Viewport className="flex flex-1 flex-col gap-2.5 overflow-y-auto scroll-smooth">
          <ThreadPrimitive.Empty>
            <div className="my-auto px-1 text-[13px] leading-relaxed text-muted-foreground">
              {gate ? (
                gate.full
              ) : (
                <>
                  Ask about this moment — the tutor knows the video and the second you&apos;re on.
                  Every answer hands back a{" "}
                  <span className="font-mono font-semibold" style={{ color: "var(--time)" }}>
                    ◦ time
                  </span>{" "}
                  you can click to jump.
                </>
              )}
            </div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        </ThreadPrimitive.Viewport>

        {/*
         * Always mounted, empty when there is nothing to say. A `role="status"`
         * region has to exist BEFORE its text changes for the change to be
         * announced, and this text arrives mid-session — the learner clicks a
         * video that is still transcribing and the composer shuts under them.
         * Hence no `empty:hidden` either: display:none takes the region out of
         * the accessibility tree, which is the same problem wearing a hat. An
         * empty block box is zero-height on its own, so only the margin is
         * withheld until there is something to separate.
         *
         * On screen rather than on the control: a `title` or `aria-describedby`
         * on a DISABLED textarea reaches nobody, since it can be neither
         * focused nor hovered by keyboard. The empty state above carries the
         * same refusal, but only until the thread has one message in it — after
         * that this line is the only thing explaining the shut composer.
         */}
        <p
          role="status"
          className="px-1 text-[12px] leading-snug text-muted-foreground [&:not(:empty)]:mt-2"
        >
          {gate?.short}
        </p>

        <ComposerPrimitive.Root className="mt-2 flex items-end gap-2">
          <ComposerPrimitive.Input
            rows={1}
            autoFocus
            disabled={gate !== null}
            // Not "waiting for the transcript": the same placeholder covers a
            // failure and an empty course, and only the line above knows which.
            placeholder={gate ? "Tutor unavailable" : "Ask about this moment…"}
            aria-label="Ask the tutor"
            className="max-h-32 min-h-[42px] flex-1 resize-none rounded-[9px] border bg-card px-3 py-2.5 text-[13.5px] outline-none focus-visible:outline-2 focus-visible:outline-offset-[3px] disabled:opacity-60"
            style={{ borderColor: "var(--line)", outlineColor: "var(--time)" }}
          />
          {/*
           * Disabled independently of the input, not as belt-and-braces: text
           * typed while a ready video was active SURVIVES a switch to a pending
           * one, so Send would otherwise stay live over a composer nobody can
           * edit — one click, one non-answer.
           */}
          <ComposerPrimitive.Send
            disabled={gate !== null}
            className="inline-flex h-[42px] items-center gap-1.5 rounded-[9px] px-4 text-[13.5px] font-bold disabled:opacity-50"
            style={{ background: "var(--brand)", color: "var(--brand-on)" }}
          >
            Send
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
