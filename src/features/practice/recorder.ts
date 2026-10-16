import { useCallback, useEffect, useRef, useState } from "react";
import { useIpc } from "@/lib/ipc";
import type { RecordingStatus, SavedRecording } from "@/lib/ipc/schemas";
import type { PracticeContext } from "@/lib/ipc/client";
import { LEVEL_HISTORY } from "@/components/live-waveform";

export type RecorderPhase = "idle" | "countdown" | RecordingStatus["phase"];
export interface Take {
  ordinal: number;
  durationMs: number;
  state: "saved";
  asset: SavedRecording;
}
interface State {
  phase: RecorderPhase;
  countdown: number;
  elapsedMs: number;
  level: number;
  clipping: boolean;
  /** Recent input levels, oldest first, for the live waveform (one per level event, ~10/s). */
  levels: number[];
  error: string | null;
  takes: Take[];
}
const initial: State = { phase: "idle", countdown: 0, elapsedMs: 0, level: 0, clipping: false, levels: [], error: null, takes: [] };
export interface Recorder extends State {
  ready: boolean;
  isCapturing: boolean;
  closeRequested: boolean;
  /** `livePace` asks for the live pace meter's events (8.8). */
  start(opts: { countdownSeconds?: number; deviceId: string | null; livePace?: boolean }): void;
  stopAndSave(): Promise<boolean>;
  cancelCountdown(): void;
  continueRecording(): void;
  saveAndClose(): Promise<void>;
}

/** All capture and filesystem behavior is behind IPC, including the browser simulation. */
export function useRecorder(title: string, context?: PracticeContext): Recorder {
  const ipc = useIpc();
  const [state, setState] = useState<State>(initial);
  const [ready, setReady] = useState(false);
  const [closeRequested, setCloseRequested] = useState(false);
  const attemptId = useRef<string | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const starting = useRef<Promise<void> | null>(null);
  const stopping = useRef<Promise<boolean> | null>(null);
  const lastLevelAt = useRef(-1);
  // The latest context, read when the take really starts (after any countdown), so an
  // activity's step set just before Record is never stale (roadmap 7.3).
  const contextRef = useRef(context);
  contextRef.current = context;

  const apply = useCallback((status: RecordingStatus) => {
    if (!alive.current || (attemptId.current && status.attemptId !== attemptId.current)) return;
    if (!attemptId.current && ["saved", "interrupted"].includes(status.phase)) return;
    attemptId.current = status.attemptId;
    busy.current = ["preparing", "recording", "finalizing"].includes(status.phase);
    // Each level event carries a newer monotonic time; replies and repeats don't add samples.
    const sample = status.phase === "recording" && status.monotonicMs > 0 && status.monotonicMs > lastLevelAt.current;
    if (sample) lastLevelAt.current = status.monotonicMs;
    setState((previous) => ({
      ...previous, phase: status.phase, elapsedMs: Math.max(status.elapsedMs, status.phase === "recording" ? previous.elapsedMs : 0),
      level: status.level, clipping: status.clipping, error: status.error,
      levels: sample ? [...previous.levels, status.level].slice(-LEVEL_HISTORY) : previous.levels,
      takes: status.asset && !previous.takes.some((take) => take.asset.assetId === status.asset!.assetId)
        ? [...previous.takes, { ordinal: previous.takes.length + 1, durationMs: status.asset.durationMs, state: "saved", asset: status.asset }]
        : previous.takes,
    }));
  }, []);

  useEffect(() => {
    alive.current = true;
    let disposed = false;
    const removers: (() => void)[] = [];
    const register = (remove: () => void) => { if (disposed) remove(); else removers.push(remove); };
    void (async () => {
      try {
        register(await ipc.onRecordingEvent((status) => apply(status)));
        register(await ipc.onRecordingCloseRequested(() => setCloseRequested(true)));
        const current = await ipc.getRecordingStatus();
        if (disposed) return;
        if (current && ["preparing", "recording", "finalizing"].includes(current.phase)) apply(current);
        setReady(true);
      } catch (error) {
        if (!disposed) setState((s) => ({ ...s, error: error instanceof Error ? error.message : "Recording could not be initialized." }));
      }
    })();
    return () => {
      disposed = true;
      alive.current = false;
      clearInterval(countdownTimer.current);
      removers.forEach((remove) => remove());
    };
  }, [ipc, apply]);

  const begin = useCallback((deviceId: string | null, livePace = false) => {
    const id = crypto.randomUUID();
    attemptId.current = id;
    lastLevelAt.current = -1;
    setState((s) => ({ ...s, phase: "preparing", elapsedMs: 0, level: 0, clipping: false, levels: [], error: null }));
    const pressed = performance.now();
    starting.current = ipc.startRecording({ attemptId: id, idempotencyKey: crypto.randomUUID(), deviceId, title, livePace, context: contextRef.current })
      .then((status) => {
        // 6.5: Record pressed → microphone running.
        if (status.phase === "recording" && ipc.recordingMode === "native") void ipc.recordTiming("recordResponse", performance.now() - pressed).catch(() => {});
        apply(status);
      })
      .catch((error: unknown) => {
        busy.current = false;
        if (alive.current) setState((s) => ({ ...s, phase: "interrupted", level: 0, error: error instanceof Error ? error.message : "The microphone could not be opened." }));
      });
  }, [ipc, title, apply]);

  const start = useCallback((opts: { countdownSeconds?: number; deviceId: string | null; livePace?: boolean }) => {
    if (busy.current || !ready) return;
    busy.current = true;
    let remaining = opts.countdownSeconds ?? 0;
    if (remaining <= 0) { begin(opts.deviceId, opts.livePace); return; }
    setState((s) => ({ ...s, phase: "countdown", countdown: remaining, elapsedMs: 0, error: null }));
    countdownTimer.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) { clearInterval(countdownTimer.current); begin(opts.deviceId, opts.livePace); }
      else setState((s) => ({ ...s, countdown: remaining }));
    }, 1000);
  }, [ready, begin]);

  const cancelCountdown = useCallback(() => {
    clearInterval(countdownTimer.current);
    busy.current = false;
    setState((s) => ({ ...s, phase: "idle", countdown: 0, level: 0 }));
  }, []);

  const stopAndSave = useCallback((): Promise<boolean> => {
    if (state.phase === "countdown") { cancelCountdown(); return Promise.resolve(true); }
    if (stopping.current) return stopping.current;
    stopping.current = (async () => {
      await starting.current;
      const id = attemptId.current;
      if (!id) return false;
      setState((s) => ({ ...s, phase: "finalizing", level: 0 }));
      try {
        const asset = await ipc.stopRecording(id);
        apply({ attemptId: id, phase: "saved", elapsedMs: asset.durationMs, monotonicMs: asset.durationMs, level: 0, clipping: false, error: null, asset });
        return true;
      } catch (error) {
        busy.current = false;
        if (alive.current) setState((s) => ({ ...s, phase: "interrupted", level: 0, error: error instanceof Error ? error.message : "The take could not be saved. Captured chunks are kept for recovery." }));
        return false;
      } finally {
        stopping.current = null;
      }
    })();
    return stopping.current;
  }, [state.phase, cancelCountdown, ipc, apply]);

  // Browser refreshes are guarded too. Desktop window close is intercepted by Rust.
  const isCapturing = ["countdown", "preparing", "recording", "finalizing"].includes(state.phase);
  useEffect(() => {
    if (!isCapturing) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [isCapturing]);

  return {
    ...state, ready, isCapturing, closeRequested, start, stopAndSave, cancelCountdown,
    continueRecording: () => setCloseRequested(false),
    saveAndClose: async () => {
      if (await stopAndSave()) {
        try { await ipc.closeAfterRecording(); }
        catch (error) { setState((s) => ({ ...s, error: error instanceof Error ? error.message : "Cannot close the window." })); }
      }
    },
  };
}
