import { useSyncExternalStore } from "react";

/**
 * Whether a drill round is thinking, speaking or saving (roadmap 10.1).
 * Celebrations wait while it is set (9.10): a think countdown records nothing,
 * so the recorder's own events don't cover it.
 */
let busy = false;
const listeners = new Set<() => void>();

export function setDrillBusy(value: boolean) {
  if (busy === value) return;
  busy = value;
  listeners.forEach((listener) => listener());
}

export const isDrillBusy = () => busy;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useDrillBusy(): boolean {
  return useSyncExternalStore(subscribe, isDrillBusy, isDrillBusy);
}
