import type { ClubKind, ClubLightState } from "@/lib/ipc/schemas";

export function lightAt(elapsedMs: number, minSeconds: number | null, maxSeconds: number | null): ClubLightState["light"] {
  if (minSeconds === null || maxSeconds === null || maxSeconds < minSeconds) return null;
  if (elapsedMs >= maxSeconds * 1000) return "red";
  if (elapsedMs * 2 >= (minSeconds + maxSeconds) * 1000) return "amber";
  return elapsedMs >= minSeconds * 1000 ? "green" : null;
}

export const DEFAULT_WINDOWS: Record<ClubKind, readonly [number, number] | null> = {
  prepared: [300, 420], table_topic: [60, 120], evaluation: [120, 180], other: null,
};
export const KIND_LABELS: Record<ClubKind, string> = { prepared: "Prepared speech", table_topic: "Table topic", evaluation: "Evaluation", other: "Other" };
export const COUNTERS = [
  { id: "um", key: "1", label: "um" }, { id: "uh", key: "2", label: "uh" },
  { id: "so", key: "3", label: "so" }, { id: "like", key: "4", label: "like" },
  { id: "you_know", key: "5", label: "you know" }, { id: "other", key: "6", label: "other" },
] as const;

export function clubClock(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
