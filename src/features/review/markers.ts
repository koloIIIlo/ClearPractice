import { formatClock } from "@/lib/format";
import type { AttemptTranscript } from "@/lib/ipc/schemas";

/**
 * Things that happened in a take, drawn over its waveform (roadmap 8.4): pauses
 * and hesitation candidates now; liked sentences (12.4), section marks (14.3)
 * and word-bomb words (10.4) later. A marker is `approximate` when its time is
 * only the start of the segment it was heard in.
 */
export type WaveMarkerKind = "pause" | "filler" | "liked" | "section" | "word";
export type WaveMarker = { id: string; kind: WaveMarkerKind; startMs: number; endMs?: number; label: string; approximate: boolean };

export const MARKER_KIND_LABELS: Record<WaveMarkerKind, string> = { pause: "Pauses", filler: "Hesitations", liked: "Liked", section: "Sections", word: "Words" };

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/**
 * Pauses from the recording's own silences when they were found, else from the
 * gaps between transcript segments; hesitation candidates at their own time
 * when a cloud transcript timed them, else near the start of their segment.
 */
export function markersFromTranscript(t: AttemptTranscript | null | undefined): WaveMarker[] {
  const m = t?.revision?.measures;
  if (!m) return [];
  const voice = m.voice && !m.voice.unavailableReason ? m.voice.pauses : null;
  const pauses = voice ?? (m.pausesUnavailableReason ? [] : m.pauses);
  const markers: WaveMarker[] = pauses.map((p, i) => ({
    id: `pause-${i}`,
    kind: "pause",
    startMs: p.startMs,
    endMs: p.startMs + p.durationMs,
    label: `Pause ${seconds(p.durationMs)} at ${formatClock(p.startMs)}`,
    approximate: false,
  }));
  m.fillers.forEach((f, i) => {
    if (f.decision === "dismissed") return;
    const timed = f.wordStartMs != null;
    const at = timed ? f.wordStartMs! : f.segmentStartMs;
    if (at == null) return;
    markers.push({
      id: `filler-${i}`,
      kind: "filler",
      startMs: at,
      endMs: timed && f.wordEndMs != null ? f.wordEndMs : undefined,
      label: timed ? `Hesitation candidate “${f.word}” at ${formatClock(at)}` : `Hesitation candidate near ${formatClock(at)}`,
      approximate: !timed,
    });
  });
  return markers.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}

/** The first marker after (dir 1) or before (dir −1) a position; 0.3 s of slack so a repeated key moves on. */
export function nextMarker(markers: readonly WaveMarker[], atMs: number, dir: 1 | -1): WaveMarker | null {
  const sorted = [...markers].sort((a, b) => a.startMs - b.startMs);
  return dir === 1 ? (sorted.find((m) => m.startMs > atMs + 300) ?? null) : ([...sorted].reverse().find((m) => m.startMs < atMs - 300) ?? null);
}
