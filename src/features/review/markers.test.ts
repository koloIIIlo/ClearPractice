import { describe, expect, it } from "vitest";
import type { AttemptTranscript, TranscriptMeasures } from "@/lib/ipc/schemas";
import { markersFromTranscript, nextMarker } from "./markers";

function transcript(measures: Partial<TranscriptMeasures>): AttemptTranscript {
  return {
    attemptId: "take-1", correction: null, job: null,
    revision: {
      id: "rev-1", source: "local", provider: null, modelId: "base", backend: "cpu", prompt: null, language: "en", text: "…", workerElapsedMs: 1, createdAt: "2026-10-16T08:00:00Z", segments: [],
      measures: {
        definitionVersion: 2, source: "Estimated", wordCount: 40, speechSpanMs: 30_000, paceWpm: 110, paceUnavailableReason: null, pauseThresholdMs: 700,
        pauses: [{ afterSegment: 0, startMs: 5_000, durationMs: 800 }], pausesUnavailableReason: null, repeatedWords: [], untimedSegments: 0, voice: null,
        fillers: [
          { segment: 1, word: "um", segmentStartMs: 31_000, wordStartMs: null, wordEndMs: null, decision: null },
          { segment: 2, word: "uh", segmentStartMs: 40_000, wordStartMs: 41_200, wordEndMs: 41_500, decision: "confirmed" },
          { segment: 2, word: "er", segmentStartMs: 40_000, wordStartMs: null, wordEndMs: null, decision: "dismissed" },
        ],
        ...measures,
      },
    },
  };
}

describe("waveform markers", () => {
  it("prefers voice pauses and marks filler candidates as approximate", () => {
    const voice = { method: "peak-energy-v1", source: "Estimated" as const, speechStartMs: 0, speechEndMs: 50_000, pauses: [{ afterSegment: 0, startMs: 12_000, durationMs: 1_200 }], unavailableReason: null };
    const markers = markersFromTranscript(transcript({ voice }));
    expect(markers.map((m) => [m.kind, m.startMs, m.approximate, m.label])).toEqual([
      ["pause", 12_000, false, "Pause 1.2 s at 0:12"],
      ["filler", 31_000, true, "Hesitation candidate near 0:31"],
      ["filler", 41_200, false, "Hesitation candidate “uh” at 0:41"],
    ]);
    expect(markers[0].endMs).toBe(13_200);
    // Without the recording's own silences, the gaps between segments; a dismissed candidate is left out.
    expect(markersFromTranscript(transcript({})).filter((m) => m.kind === "pause").map((m) => m.startMs)).toEqual([5_000]);
    expect(markersFromTranscript(transcript({ pausesUnavailableReason: "Segment timings are unavailable.", pauses: [] })).some((m) => m.kind === "pause")).toBe(false);
    expect(markersFromTranscript(null)).toEqual([]);
  });

  it("finds the next and previous marker", () => {
    const markers = markersFromTranscript(transcript({}));
    expect(nextMarker(markers, 0, 1)?.startMs).toBe(5_000);
    expect(nextMarker(markers, 5_000, 1)?.startMs).toBe(31_000);
    expect(nextMarker(markers, 31_000, -1)?.startMs).toBe(5_000);
    expect(nextMarker(markers, 4_000, -1)).toBeNull();
    expect(nextMarker(markers, 41_200, 1)).toBeNull();
  });
});
