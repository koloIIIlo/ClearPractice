import { useEffect, useState } from "react";
import { LEVEL_HISTORY } from "@/components/live-waveform";
import { useIpc } from "@/lib/ipc";

// Start and stop calls go out one after another, so a quick device change or
// remount never leaves a stop arriving after the next start.
let queue: Promise<unknown> = Promise.resolve();
const serial = (op: () => Promise<unknown>) => (queue = queue.then(op, op));

/**
 * Live microphone level while the Studio is Ready (user request 2026-10-10):
 * the recorder's waveform reacts to your voice before you record. The
 * microphone is opened only to measure loudness, nothing is recorded, and it
 * is released when recording starts, the page closes, the window is hidden,
 * or `enabled` turns off.
 */
export function useLevelMonitor(deviceId: string | null, enabled: boolean) {
  const ipc = useIpc();
  const [levels, setLevels] = useState<number[]>([]);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLevels([]);
    setLevel(0);
    if (!enabled) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void ipc
      .onInputLevel((l) => {
        if (disposed) return;
        setLevel(l.level);
        setLevels((previous) => [...previous, l.level].slice(-LEVEL_HISTORY));
      })
      .then((remove) => (disposed ? remove() : (unlisten = remove)))
      .catch(() => {});
    const start = () =>
      serial(() =>
        ipc.startLevelMonitor(deviceId).then(
          () => !disposed && setError(null),
          (e: unknown) => !disposed && setError(e instanceof Error ? e.message : String(e)),
        ),
      );
    const stop = () => serial(() => ipc.stopLevelMonitor().catch(() => {}));
    const onVisibility = () => (document.visibilityState === "visible" ? void start() : void stop());
    if (document.visibilityState === "visible") void start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      unlisten?.();
      document.removeEventListener("visibilitychange", onVisibility);
      void stop();
    };
  }, [ipc, deviceId, enabled]);

  return { levels, level, error };
}
