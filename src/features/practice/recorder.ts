/**
 * Recorder state machine (blueprint §9): Preparing → Recording → Finalizing → Saved | Interrupted.
 * Capture state is kept separate from analysis state so a failed analysis can
 * never make a valid recording look unsaved.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";

export type RecorderPhase = "idle" | "countdown" | "preparing" | "recording" | "finalizing" | "saved" | "interrupted";

export interface Take {
  ordinal: number;
  durationMs: number;
  state: "saved" | "interrupted";
}

interface State {
  phase: RecorderPhase;
  countdown: number;
  startedAt: number | null;
  elapsedMs: number;
  level: number; // 0..1, display only
  clipping: boolean;
  takes: Take[];
}

type Action =
  | { type: "countdown"; seconds: number }
  | { type: "tick_countdown" }
  | { type: "preparing" }
  | { type: "recording"; at: number }
  | { type: "tick"; now: number; level: number }
  | { type: "finalizing" }
  | { type: "saved" }
  | { type: "interrupted" }
  | { type: "reset" };

const initial: State = { phase: "idle", countdown: 0, startedAt: null, elapsedMs: 0, level: 0, clipping: false, takes: [] };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "countdown":
      return { ...s, phase: "countdown", countdown: a.seconds, elapsedMs: 0 };
    case "tick_countdown":
      return { ...s, countdown: Math.max(0, s.countdown - 1) };
    case "preparing":
      return { ...s, phase: "preparing", elapsedMs: 0, level: 0 };
    case "recording":
      return { ...s, phase: "recording", startedAt: a.at, elapsedMs: 0 };
    case "tick":
      return s.phase === "recording" && s.startedAt !== null
        ? { ...s, elapsedMs: a.now - s.startedAt, level: a.level, clipping: a.level > 0.97 }
        : s;
    case "finalizing":
      return { ...s, phase: "finalizing", level: 0 };
    case "saved":
      return {
        ...s,
        phase: "saved",
        startedAt: null,
        takes: [...s.takes, { ordinal: s.takes.length + 1, durationMs: s.elapsedMs, state: "saved" }],
      };
    case "interrupted":
      return {
        ...s,
        phase: "interrupted",
        startedAt: null,
        level: 0,
        takes: [...s.takes, { ordinal: s.takes.length + 1, durationMs: s.elapsedMs, state: "interrupted" }],
      };
    case "reset":
      return { ...s, phase: "idle", elapsedMs: 0, level: 0 };
  }
}

export interface Recorder {
  phase: RecorderPhase;
  countdown: number;
  elapsedMs: number;
  level: number;
  clipping: boolean;
  takes: Take[];
  /** True while leaving the screen would abandon a take. */
  isCapturing: boolean;
  start: (opts?: { countdownSeconds?: number }) => void;
  stopAndSave: () => Promise<void>;
  cancelCountdown: () => void;
}

/**
 * Simulated recorder for M1 — no audio is captured. In M2 this hook keeps its
 * shape but calls start_recording / stop_recording and listens to recording_level.
 */
export function useSimulatedRecorder(): Recorder {
  const [state, dispatch] = useReducer(reducer, initial);
  const timers = useRef<number[]>([]);
  const clear = () => {
    timers.current.forEach((t) => window.clearInterval(t));
    timers.current = [];
  };
  useEffect(() => clear, []);

  const begin = useCallback(() => {
    dispatch({ type: "preparing" });
    // Device open latency; the blueprint targets < 200 ms.
    timers.current.push(
      window.setTimeout(() => {
        dispatch({ type: "recording", at: performance.now() });
        let phase = 0;
        timers.current.push(
          window.setInterval(() => {
            phase += 0.35;
            const speech = Math.max(0, Math.sin(phase) * 0.5 + Math.sin(phase * 2.7) * 0.25);
            dispatch({ type: "tick", now: performance.now(), level: Math.min(0.9, speech + Math.random() * 0.1) });
          }, 100),
        );
      }, 150),
    );
  }, []);

  const start = useCallback(
    (opts?: { countdownSeconds?: number }) => {
      clear();
      const secs = opts?.countdownSeconds ?? 0;
      if (secs <= 0) return begin();
      dispatch({ type: "countdown", seconds: secs });
      let left = secs;
      timers.current.push(
        window.setInterval(() => {
          left -= 1;
          if (left <= 0) {
            clear();
            begin();
          } else dispatch({ type: "tick_countdown" });
        }, 1000),
      );
    },
    [begin],
  );

  const stopAndSave = useCallback(async () => {
    clear();
    dispatch({ type: "finalizing" });
    // Saved is reported only after durable finalisation (§9 step 6).
    await new Promise((r) => setTimeout(r, 400));
    dispatch({ type: "saved" });
  }, []);

  const cancelCountdown = useCallback(() => {
    clear();
    dispatch({ type: "reset" });
  }, []);

  return {
    ...state,
    isCapturing: state.phase === "preparing" || state.phase === "recording" || state.phase === "finalizing",
    start,
    stopAndSave,
    cancelCountdown,
  };
}
