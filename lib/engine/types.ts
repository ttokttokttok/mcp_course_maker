export type Segment = { start: number; duration: number; text: string };

export type TranscriptDoc = {
  videoId: string;
  title: string;
  channel: string;
  source: "captions" | "asr";
  language: string;
  fetchedAt: string;
  durationSec?: number;
  segments: Segment[];
};

export type SessionState = {
  activeVideoId: string | null;
  positionSec: number | null;
  updatedAt: string;
};
