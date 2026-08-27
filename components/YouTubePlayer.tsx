"use client";

import { useEffect, useRef } from "react";
import { usePlayerStore } from "@/components/player-store";

/* ---- minimal YouTube IFrame Player API typings ---- */
type YTPlayer = {
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  cueVideoById: (videoId: string, startSeconds?: number) => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  getCurrentTime: () => number;
  destroy: () => void;
};
type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId?: string;
      playerVars?: Record<string, number | string>;
      events?: { onReady?: () => void };
    },
  ) => YTPlayer;
};
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") return new Promise(() => {});
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  });
  return apiPromise;
}

/**
 * Embeds a YouTube video via the IFrame Player API. Publishes the current
 * playback time to the shared store (~500ms) and consumes queued seeks —
 * loading the target video first when the seek targets a different video.
 */
export function YouTubePlayer({ initialVideoId }: { initialVideoId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const loadedVideoRef = useRef<string>(initialVideoId);

  useEffect(() => {
    usePlayerStore.getState().setActiveVideo(initialVideoId);
  }, [initialVideoId]);

  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | undefined;

    loadYouTubeApi().then((YT) => {
      if (cancelled || !hostRef.current) return;
      const inner = document.createElement("div");
      hostRef.current.appendChild(inner);

      playerRef.current = new YT.Player(inner, {
        videoId: initialVideoId,
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            poll = setInterval(() => {
              const p = playerRef.current;
              if (!p) return;
              const t = p.getCurrentTime?.();
              if (typeof t === "number" && !Number.isNaN(t)) {
                usePlayerStore.getState().setPosition(t);
              }
            }, 500);
          },
        },
      });
    });

    // React to queued seeks (from Timecode clicks / find_concept hits).
    const unsub = usePlayerStore.subscribe((state) => {
      const seek = state.pendingSeek;
      const p = playerRef.current;
      if (!seek || !p) return;
      if (seek.videoId !== loadedVideoRef.current) {
        loadedVideoRef.current = seek.videoId;
        p.loadVideoById(seek.videoId, seek.seconds);
      } else {
        p.seekTo(seek.seconds, true);
        p.playVideo();
      }
      usePlayerStore.getState().consumePendingSeek();
    });

    return () => {
      cancelled = true;
      unsub();
      if (poll) clearInterval(poll);
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="aspect-video w-full overflow-hidden rounded-[10px] bg-[#0b0e13] [&>div]:h-full [&>div]:w-full [&_iframe]:h-full [&_iframe]:w-full"
      ref={hostRef}
    />
  );
}
