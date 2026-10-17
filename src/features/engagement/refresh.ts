/**
 * Asks the engagement provider to evaluate again (roadmap 9.4). Places that
 * aren't mutations (a saved take, a finished transcription, an intonation
 * track) call this; tagged mutations are picked up by the provider itself.
 */
export type RefreshReason = "start" | "take" | "transcript" | "review" | "reflection" | "phrase" | "activity" | "manual";

const listeners = new Set<(reason: RefreshReason) => void>();

export function requestEngagementRefresh(reason: RefreshReason): void {
  listeners.forEach((l) => l(reason));
}

export function onEngagementRefresh(listener: (reason: RefreshReason) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
