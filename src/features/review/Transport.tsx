import { Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatClock } from "@/lib/format";
import type { TranscriptSegment } from "@/lib/ipc/schemas";
import type { Playback } from "./playback";

/**
 * Audio transport across the top of review (§6). The range input is the
 * keyboard-accessible alternative to dragging on a waveform (§14).
 */
export function Transport({ playback, segments }: { playback: Playback; segments: TranscriptSegment[] }) {
  const { playing, positionMs, durationMs, rate } = playback;
  return (
    <div className="rounded-panel border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="icon"
          onClick={playback.toggle}
          aria-label={playing ? "Pause" : "Play"}
          aria-keyshortcuts="Space"
        >
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </Button>
        <Button variant="ghost" size="icon" aria-label="Back 5 seconds" onClick={() => playback.skip(-5000)}>
          <RotateCcw aria-hidden />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Forward 5 seconds" onClick={() => playback.skip(5000)}>
          <RotateCw aria-hidden />
        </Button>
        <span className="ml-1 text-meta tabular-nums">
          {formatClock(positionMs)} <span className="text-muted-foreground">/ {formatClock(durationMs)}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span id="speed-label" className="text-meta text-muted-foreground">
            Speed
          </span>
          <Select value={String(rate)} onValueChange={(v) => playback.setRate(Number(v))}>
            <SelectTrigger size="sm" className="w-24" aria-labelledby="speed-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0.75, 1, 1.25].map((r) => (
                <SelectItem key={r} value={String(r)}>
                  {r}×
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="relative mt-3">
        {/* Segment bands stand in for the waveform until WaveSurfer lands in M2. */}
        <div aria-hidden className="absolute inset-x-0 top-1/2 h-6 -translate-y-1/2 overflow-hidden rounded-md bg-secondary">
          {segments.map((s) => (
            <span
              key={s.id}
              className="absolute inset-y-1 rounded-sm bg-primary/25"
              style={{ left: `${(s.startMs / durationMs) * 100}%`, width: `${((s.endMs - s.startMs) / durationMs) * 100}%` }}
            />
          ))}
          <span className="absolute inset-y-0 w-0.5 bg-primary" style={{ left: `${(positionMs / durationMs) * 100}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={durationMs}
          step={100}
          value={positionMs}
          onChange={(e) => playback.seek(Number(e.target.value))}
          aria-label="Playback position"
          aria-valuetext={`${formatClock(positionMs)} of ${formatClock(durationMs)}`}
          className="relative h-8 w-full cursor-pointer opacity-0 focus-visible:opacity-100"
        />
      </div>
    </div>
  );
}
