import { useSyncExternalStore } from "react";

/** Zoom levels for Ctrl + / Ctrl − (and Settings → Appearance); 100 % is the default. */
export const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
const KEY = "cp-zoom";

function read(): number {
  try {
    const value = Number(window.localStorage.getItem(KEY));
    return (ZOOM_STEPS as readonly number[]).includes(value) ? value : 1;
  } catch {
    return 1;
  }
}

let current = read();
const listeners = new Set<() => void>();

/** The next step up (+1), down (−1), or back to 100 % (0). */
export function stepZoom(from: number, direction: 1 | -1 | 0): number {
  if (direction === 0) return 1;
  const steps = ZOOM_STEPS as readonly number[];
  const index = steps.indexOf(from) < 0 ? steps.indexOf(1) : steps.indexOf(from);
  return steps[Math.min(steps.length - 1, Math.max(0, index + direction))];
}

/** Remembered on this computer (a viewer convenience), applied by the shell through IPC. */
export function setZoomLevel(scale: number) {
  current = scale;
  try {
    window.localStorage.setItem(KEY, String(scale));
  } catch {
    /* zoom still applies for this run */
  }
  listeners.forEach((l) => l());
}

export function useZoomLevel(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
