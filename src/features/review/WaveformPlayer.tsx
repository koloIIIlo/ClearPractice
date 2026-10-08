import { useEffect, useId, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/plugins/regions";
import { Pause, Play, Repeat, RotateCcw, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatClock } from "@/lib/format";
import type { WaveformPeaks } from "@/lib/ipc/schemas";
import type { PlayerLink } from "./player-link";
import {
  formatClockTenths,
  loopSeekTarget,
  normalizeLoop,
  parseClock,
  toChannelPeaks,
  type LoopRange,
} from "./waveform";

/** Only one take plays at a time across the app (§6 attempt comparison). */
let activePlayer: WaveSurfer | null = null;

const REGION_COLOR = "color-mix(in srgb, var(--cp-accent) 16%, transparent)";

/** Canvas can't resolve var(), so read the current token values. */
function tokenColors() {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim() || undefined;
  return { waveColor: token("--cp-text-2"), progressColor: token("--cp-accent"), cursorColor: token("--cp-accent") };
}

/**
 * Review player for a saved take (plan 2.14): native peaks drawn by WaveSurfer,
 * audio streamed from the scoped asset URL, seek, pitch-preserving speed, and a
 * loop range. Every pointer action has a keyboard equivalent (§14): position
 * slider, skip buttons, and start/end fields for the loop.
 */
export function WaveformPlayer({ url, peaks, label, link }: { url: string; peaks: WaveformPeaks; label: string; link?: PlayerLink }) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const loopRef = useRef<LoopRange | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState<LoopRange | null>(null);
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const durationMs = peaks.durationMs;

  const showLoop = (range: LoopRange | null) => {
    loopRef.current = range;
    setLoop(range);
    setStartText(range ? formatClockTenths(range.startMs) : "");
    setEndText(range ? formatClockTenths(range.endMs) : "");
    setFieldError(null);
  };

  useEffect(() => {
    const container = containerRef.current;
    const media = audioRef.current;
    if (!container || !media) return;
    const regions = RegionsPlugin.create();
    const ws = WaveSurfer.create({
      container,
      media,
      peaks: toChannelPeaks(peaks),
      duration: peaks.durationMs / 1000,
      height: 64,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      normalize: true,
      dragToSeek: true,
      plugins: [regions],
      ...tokenColors(),
    });
    wsRef.current = ws;
    regionsRef.current = regions;

    const adopt = (region: Region) => {
      regions.getRegions().forEach((r) => r !== region && r.remove());
      const range = normalizeLoop(region.start * 1000, region.end * 1000, peaks.durationMs);
      if (range) showLoop(range);
      else region.remove();
    };
    regions.enableDragSelection({ color: REGION_COLOR });
    regions.on("region-created", adopt);
    regions.on("region-updated", adopt);
    regions.on("region-removed", () => {
      if (regions.getRegions().length === 0) showLoop(null);
    });

    ws.on("play", () => {
      if (activePlayer && activePlayer !== ws) activePlayer.pause();
      activePlayer = ws;
      setPlaying(true);
      setPlayError(null);
    });
    ws.on("pause", () => setPlaying(false));
    ws.on("timeupdate", (seconds) => {
      const ms = seconds * 1000;
      setPositionMs(ms);
      link?.publish(ms);
      const target = ws.isPlaying() ? loopSeekTarget(ms, loopRef.current) : null;
      if (target !== null) ws.setTime(target / 1000);
    });
    ws.on("finish", () => {
      const range = loopRef.current;
      if (!range) return setPlaying(false);
      ws.setTime(range.startMs / 1000);
      void ws.play();
    });
    ws.on("error", () => setPlayError("This recording could not be played. The saved file is unchanged."));

    // Follow light/dark theme switches.
    const theme = new MutationObserver(() => ws.setOptions(tokenColors()));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });

    const detach = link?.attach((ms) => ws.setTime(Math.min(peaks.durationMs, Math.max(0, ms)) / 1000));

    return () => {
      detach?.();
      theme.disconnect();
      if (activePlayer === ws) activePlayer = null;
      ws.destroy();
      wsRef.current = null;
      regionsRef.current = null;
    };
  }, [peaks, link]);

  const ws = () => wsRef.current;
  const seek = (ms: number) => ws()?.setTime(Math.min(durationMs, Math.max(0, ms)) / 1000);
  const toggle = () => {
    const player = ws();
    if (!player) return;
    if (!player.isPlaying()) {
      const target = loopSeekTarget(positionMs, loopRef.current, true);
      if (target !== null) player.setTime(target / 1000);
    }
    player.playPause().catch(() => setPlayError("Playback could not start. The saved file is unchanged."));
  };
  const changeRate = (value: number) => {
    setRate(value);
    ws()?.setPlaybackRate(value, true);
  };

  const placeLoop = (range: LoopRange) => {
    const regions = regionsRef.current;
    if (!regions) return;
    const [existing] = regions.getRegions();
    if (existing) {
      existing.setOptions({ start: range.startMs / 1000, end: range.endMs / 1000 });
      showLoop(range);
    } else {
      regions.addRegion({ start: range.startMs / 1000, end: range.endMs / 1000, color: REGION_COLOR });
    }
  };
  const applyFields = (start = startText, end = endText) => {
    const startMs = parseClock(start);
    const endMs = parseClock(end);
    if (startMs === null || endMs === null) {
      setFieldError("Enter times as m:ss, for example 0:12.5.");
      return;
    }
    const range = normalizeLoop(startMs, endMs, durationMs);
    if (!range) {
      setFieldError(`Choose a range of at least 0.3 s within ${formatClockTenths(durationMs)}.`);
      return;
    }
    placeLoop(range);
  };
  const markAt = (edge: "start" | "end") => {
    const here = formatClockTenths(positionMs);
    const fallbackEnd = formatClockTenths(Math.min(durationMs, positionMs + 5000));
    if (edge === "start") applyFields(here, endText || fallbackEnd);
    else applyFields(startText || formatClockTenths(Math.max(0, positionMs - 5000)), here);
  };
  const clearLoop = () => {
    regionsRef.current?.clearRegions();
    showLoop(null);
  };

  return (
    <div className="space-y-3 rounded-panel border bg-card p-3">
      <audio ref={audioRef} src={url} preload="metadata" aria-hidden className="hidden" />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" onClick={toggle} aria-label={playing ? `Pause ${label}` : `Play ${label}`}>
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </Button>
        <Button variant="ghost" size="icon" aria-label="Back 5 seconds" onClick={() => seek(positionMs - 5000)}>
          <RotateCcw aria-hidden />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Forward 5 seconds" onClick={() => seek(positionMs + 5000)}>
          <RotateCw aria-hidden />
        </Button>
        <span className="ml-1 text-meta tabular-nums">
          {formatClock(positionMs)} <span className="text-muted-foreground">/ {formatClock(durationMs)}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span id={`${id}-speed`} className="text-meta text-muted-foreground">Speed</span>
          <Select value={String(rate)} onValueChange={(v) => changeRate(Number(v))}>
            <SelectTrigger size="sm" className="w-24" aria-labelledby={`${id}-speed`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => (
                <SelectItem key={r} value={String(r)}>{r}×</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div ref={containerRef} className="cursor-pointer" aria-hidden />
      <input
        type="range"
        min={0}
        max={durationMs}
        step={100}
        value={Math.min(positionMs, durationMs)}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label={`Playback position, ${label}`}
        aria-valuetext={`${formatClock(positionMs)} of ${formatClock(durationMs)}`}
        className="w-full accent-primary"
      />

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          applyFields();
        }}
      >
        <div className="space-y-1">
          <label htmlFor={`${id}-start`} className="text-meta text-muted-foreground">Loop start</label>
          <Input id={`${id}-start`} className="w-24 tabular-nums" inputMode="decimal" placeholder="0:00.0" value={startText} onChange={(e) => setStartText(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-end`} className="text-meta text-muted-foreground">Loop end</label>
          <Input id={`${id}-end`} className="w-24 tabular-nums" inputMode="decimal" placeholder={formatClockTenths(durationMs)} value={endText} onChange={(e) => setEndText(e.target.value)} />
        </div>
        <Button type="submit" variant="outline">
          <Repeat aria-hidden /> Loop range
        </Button>
        <Button type="button" variant="ghost" onClick={() => markAt("start")}>Start here</Button>
        <Button type="button" variant="ghost" onClick={() => markAt("end")}>End here</Button>
        {loop && (
          <Button type="button" variant="ghost" onClick={clearLoop}>
            <X aria-hidden /> Stop looping
          </Button>
        )}
      </form>
      <p className="text-meta text-muted-foreground" aria-live="polite">
        {loop
          ? `Looping ${formatClockTenths(loop.startMs)}–${formatClockTenths(loop.endMs)}.`
          : "Drag across the waveform or enter times to loop a range."}
      </p>
      {fieldError && <p role="alert" className="text-meta text-destructive">{fieldError}</p>}
      {playError && <p role="alert" className="text-meta text-destructive">{playError}</p>}
    </div>
  );
}
