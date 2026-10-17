import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";

export type AudioPlayerHandle = {
  /** Plays `fromMs..toMs` and pauses at the end (clip previews). */
  playRange: (fromMs: number, toMs: number) => void;
  /** Current position in milliseconds. */
  positionMs: () => number;
  /** For A/B listening (8.5): play, pause and seek from outside. */
  play: () => void;
  pause: () => void;
  seek: (ms: number) => void;
  isPlaying: () => boolean;
};

/** Only one player sounds at a time across the app. */
let active: HTMLAudioElement | null = null;

/**
 * The app's audio player for clips and previews: the same controls and look as
 * the take player (play, 5-second skips, time, a seek bar in the accent colour,
 * pitch-preserving speed), instead of the browser's built-in controls.
 */
export function AudioPlayer({ src, label, speeds, className, ref, volume = 1, onPositionChange, onPlayingChange, onEnded }: {
  src: string;
  /** Names what is played, for screen readers: "Play <label>". */
  label: string;
  /** Offer a speed choice, for example [0.75, 1, 1.25]. */
  speeds?: readonly number[];
  className?: string;
  ref?: Ref<AudioPlayerHandle>;
  /** Playback gain from 0 to 1 (level matching only ever turns a take down). */
  volume?: number;
  onPositionChange?: (ms: number) => void;
  /** Called when playback starts or stops (Catch it counts presses only while playing). */
  onPlayingChange?: (playing: boolean) => void;
  /** Called when playback reaches the end. */
  onEnded?: () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const stopAt = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    el.preservesPitch = true;
    el.playbackRate = rate;
  }, [rate, src]);
  useEffect(() => {
    if (audio.current) audio.current.volume = Math.min(1, Math.max(0, volume));
  }, [volume, src]);
  useEffect(() => () => { if (active === audio.current) active = null; }, []);

  const play = async () => {
    const el = audio.current;
    if (!el) return;
    if (active && active !== el) active.pause();
    active = el;
    try {
      setError(null);
      await el.play();
    } catch {
      setError("Playback could not start.");
    }
  };
  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      stopAt.current = null;
      void play();
    } else el.pause();
  };
  const seek = (ms: number) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = Math.min(duration || el.duration || 0, Math.max(0, ms)) / 1000;
    setPosition(el.currentTime * 1000);
  };
  useImperativeHandle(ref, () => ({
    playRange: (fromMs, toMs) => {
      seek(fromMs);
      stopAt.current = toMs / 1000;
      void play();
    },
    positionMs: () => (audio.current?.currentTime ?? 0) * 1000,
    play: () => void play(),
    pause: () => audio.current?.pause(),
    seek,
    isPlaying: () => !!audio.current && !audio.current.paused,
  }));

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex flex-wrap items-center gap-2 rounded-panel border bg-card p-2">
        <audio
          ref={audio}
          src={src}
          preload="metadata"
          className="hidden"
          onLoadedMetadata={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration * 1000 : 0)}
          onDurationChange={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration * 1000 : 0)}
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            if (stopAt.current !== null && el.currentTime >= stopAt.current) {
              el.pause();
              stopAt.current = null;
            }
            setPosition(el.currentTime * 1000);
            onPositionChange?.(el.currentTime * 1000);
          }}
          onPlay={() => { setPlaying(true); onPlayingChange?.(true); }}
          onPause={() => { setPlaying(false); onPlayingChange?.(false); }}
          onEnded={() => { setPlaying(false); onPlayingChange?.(false); onEnded?.(); }}
          onError={() => setError("This audio could not be loaded.")}
        />
        <Button size="icon" onClick={toggle} aria-label={playing ? `Pause ${label}` : `Play ${label}`}>
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </Button>
        <Button variant="ghost" className="px-3" aria-label="Back 5 seconds" onClick={() => seek(position - 5000)}>
          <RotateCcw aria-hidden /> <span className="tabular-nums">5 s</span>
        </Button>
        <Button variant="ghost" className="px-3" aria-label="Forward 5 seconds" onClick={() => seek(position + 5000)}>
          <RotateCw aria-hidden /> <span className="tabular-nums">5 s</span>
        </Button>
        <Slider
          className="min-w-32 flex-1"
          min={0}
          max={Math.max(1, Math.round(duration))}
          step={100}
          value={[Math.min(Math.round(position), Math.max(1, Math.round(duration)))]}
          onValueChange={([ms]) => seek(ms)}
          aria-label={`Position in ${label}`}
          aria-valuetext={`${formatClock(position)} of ${formatClock(duration)}`}
        />
        <span className="text-meta tabular-nums">
          {formatClock(position)} <span className="text-muted-foreground">/ {formatClock(duration)}</span>
        </span>
        {speeds && (
          <Select value={String(rate)} onValueChange={(v) => setRate(Number(v))}>
            <SelectTrigger className="w-20" aria-label={`Speed of ${label}`}><SelectValue /></SelectTrigger>
            <SelectContent>{speeds.map((s) => <SelectItem key={s} value={String(s)}>{s}×</SelectItem>)}</SelectContent>
          </Select>
        )}
      </div>
      {error && <p role="alert" className="text-meta text-destructive">{error}</p>}
    </div>
  );
}
