"use client";

import { create } from "zustand";

/**
 * Shared player state. The YouTubePlayer writes `positionSec` on a timer and
 * consumes `pendingSeek`; the chat body-getter and NotesPanel read
 * `activeVideoId`/`positionSec`. `seek` switches the active video (if needed)
 * and queues a seek the player picks up.
 */
export type PlayerStore = {
  activeVideoId: string | null;
  positionSec: number;
  /** Set by `seek`, consumed by the player once it has moved. */
  pendingSeek: { videoId: string; seconds: number } | null;

  setActiveVideo: (videoId: string) => void;
  setPosition: (seconds: number) => void;
  seek: (videoId: string, seconds: number) => void;
  consumePendingSeek: () => void;
};

export const usePlayerStore = create<PlayerStore>((set) => ({
  activeVideoId: null,
  positionSec: 0,
  pendingSeek: null,

  setActiveVideo: (videoId) =>
    set((s) => (s.activeVideoId === videoId ? s : { activeVideoId: videoId, positionSec: 0 })),

  setPosition: (seconds) => set({ positionSec: seconds }),

  seek: (videoId, seconds) => set({ activeVideoId: videoId, pendingSeek: { videoId, seconds } }),

  consumePendingSeek: () => set({ pendingSeek: null }),
}));
