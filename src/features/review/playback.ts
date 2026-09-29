import { useCallback, useEffect, useRef, useState } from "react";

export interface Playback {
  playing: boolean;
  positionMs: number;
  durationMs: number;
  rate: number;
  toggle: () => void;
  seek: (ms: number) => void;
  skip: (deltaMs: number) => void;
  setRate: (r: number) => void;
}

/**
 * Simulated transport for M1. In M2 the same interface wraps WaveSurfer.js
 * playing the saved WAV through the scoped asset protocol.
 */
export function useSimulatedPlayback(durationMs: number): Playback {
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [rate, setRate] = useState(1);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const step = (now: number) => {
      const prev = last.current ?? now;
      last.current = now;
      setPositionMs((p) => {
        const next = p + (now - prev) * rate;
        if (next >= durationMs) {
          setPlaying(false);
          return durationMs;
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      last.current = null;
    };
  }, [playing, rate, durationMs]);

  const clamp = useCallback((ms: number) => Math.min(durationMs, Math.max(0, ms)), [durationMs]);

  return {
    playing,
    positionMs,
    durationMs,
    rate,
    toggle: () => {
      if (!playing && positionMs >= durationMs) setPositionMs(0);
      setPlaying((p) => !p);
    },
    seek: (ms) => setPositionMs(clamp(ms)),
    skip: (d) => setPositionMs((p) => clamp(p + d)),
    setRate,
  };
}

/** Space toggles playback unless focus is in a text field or another control (§14). */
export function useSpaceToPlay(toggle: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, button, a, [role=button], [role=tab], [contenteditable=true], [role=dialog]"))
        return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
}
