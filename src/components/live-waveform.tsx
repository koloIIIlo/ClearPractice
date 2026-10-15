import { useEffect, useRef } from "react";

/** Bars kept on screen: about 8 seconds at the native 10 level events per second. */
export const LEVEL_HISTORY = 80;

/** RMS 0–1 → 0–1 on a −50…0 dB scale, so ordinary speech is clearly visible. */
export function levelToHeight(rms: number): number {
  if (!(rms > 0)) return 0;
  return Math.min(1, Math.max(0, (20 * Math.log10(rms) + 50) / 50));
}

const BAR = 4;
const GAP = 3;
const PITCH = BAR + GAP;
/** Level events arrive about ten times a second (native capture and the monitor). */
const EVENT_MS = 100;

function reducedMotion() {
  return document.documentElement.dataset.reducedMotion === "true" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Live input waveform: rounded bars, mirrored around the centre line, glide
 * from right to left at a steady speed (drawn on a canvas every frame, so they
 * move rather than jump from slot to slot; user report 2026-10-10). Older input
 * fades out to the left. Idle, it is a still row of dots; a finished take
 * stays visible, dimmed. With reduced motion the bars step instead of gliding.
 */
export function LiveWaveform({ levels, level, active, clipping }: { levels: number[]; level: number; active: boolean; clipping: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({ levels, active, clipping, arrivedAt: 0, interval: EVENT_MS });
  const previous = useRef(levels);
  const kick = useRef<() => void>(() => {});

  // A new levels array means a new sample: note when it arrived to place the scroll.
  if (previous.current !== levels) {
    const now = performance.now();
    const s = state.current;
    if (levels.length > 0 && s.arrivedAt > 0) s.interval = Math.min(200, Math.max(60, s.interval * 0.8 + (now - s.arrivedAt) * 0.2));
    s.arrivedAt = levels.length > 0 ? now : 0;
    previous.current = levels;
  }
  state.current.levels = levels;
  state.current.active = active;
  state.current.clipping = clipping;

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext?.("2d");
    if (!el || !ctx) return;
    let frame = 0;
    let colours = { bar: "", dot: "", alert: "" };
    let coloursAt = 0;
    const draw = (now: number) => {
      const s = state.current;
      const dpr = window.devicePixelRatio || 1;
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (el.width !== Math.round(width * dpr) || el.height !== Math.round(height * dpr)) {
        el.width = Math.round(width * dpr);
        el.height = Math.round(height * dpr);
      }
      if (now - coloursAt > 500) {
        const css = getComputedStyle(el);
        colours = { bar: css.getPropertyValue("--primary").trim(), dot: css.getPropertyValue("--muted-foreground").trim(), alert: css.getPropertyValue("--destructive").trim() };
        coloursAt = now;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const slots = Math.ceil(width / PITCH) + 1;
      const recent = s.levels.slice(-slots);
      const moving = s.arrivedAt > 0 && !reducedMotion();
      const progress = moving ? Math.min(1, (now - s.arrivedAt) / s.interval) : 1;
      const mid = height / 2;
      const minBar = Math.max(BAR, height * 0.08);
      // Idle dots fill the slots that have no samples yet.
      ctx.fillStyle = colours.dot;
      ctx.globalAlpha = 0.25;
      for (let k = recent.length; k < slots; k++) {
        const x = width - BAR - k * PITCH;
        if (x < -BAR) break;
        ctx.beginPath();
        ctx.roundRect(x, mid - minBar / 2, BAR, minBar, BAR / 2);
        ctx.fill();
      }
      // Samples, newest at the right edge, sliding left by one pitch per event.
      for (let k = 0; k < recent.length; k++) {
        const value = recent[recent.length - 1 - k];
        const x = width - BAR - (k - 1 + progress) * PITCH;
        if (x > width || x < -BAR) continue;
        const h = Math.max(minBar, levelToHeight(value) * height);
        ctx.globalAlpha = s.active ? 1 : 0.4;
        ctx.fillStyle = s.active && s.clipping && k === 0 ? colours.alert : colours.bar;
        ctx.beginPath();
        ctx.roundRect(x, mid - h / 2, BAR, h, BAR / 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // Keep animating only while samples are arriving.
      if (moving && now - s.arrivedAt < s.interval * 3) frame = requestAnimationFrame(draw);
      else frame = 0;
    };
    kick.current = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    kick.current();
    const observer = new ResizeObserver(() => kick.current());
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      kick.current = () => {};
    };
  }, []);
  // Each new sample (or a change of state) wakes the drawing loop; it sleeps again when samples stop.
  useEffect(() => kick.current(), [levels, active, clipping]);

  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-1">
      <div
        role="meter"
        aria-label="Input level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(levelToHeight(level) * 100)}
        className="h-20 w-[448px] max-w-full"
      >
        <canvas ref={canvas} aria-hidden className="size-full [mask-image:linear-gradient(to_right,transparent,black_30%)]" />
      </div>
      {clipping && <span className="text-meta text-destructive">Input is very loud. Consider moving back a little.</span>}
    </div>
  );
}
