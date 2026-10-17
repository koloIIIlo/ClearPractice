import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useIpc } from "@/lib/ipc";
import { keys } from "@/lib/ipc/queries";
import type { TakeMark } from "@/lib/ipc/schemas";
import type { Recorder } from "@/features/practice/recorder";
import { setDrillBusy } from "./busy";
import type { DrillPlan, DrillRound, DrillTake, Mark } from "./drill-module";

/**
 * The drill clock (roadmap 10.1). The recorder does the timing that matters
 * for audio: a round's think time is the recorder's own countdown, so nothing
 * records before you press Start round and leaving during it creates no take.
 * The clock stops the take at its limit (once), announces 30, 10 and 5
 * seconds left, buffers marks and writes them once the take is saved, moves
 * to the next round and marks the drill busy so celebrations wait.
 */
export type DrillPhase = "ready" | "think" | "speak" | "saving" | "between" | "done";
export const ANNOUNCE_LEFT_S = [30, 10, 5] as const;
const MAX_MARKS = 200;

/** When a round's take stops by itself, or null when you stop it. */
export function roundLimitMs(round: DrillRound): number | null {
  return round.speakSeconds === null ? null : (round.speakSeconds + (round.graceSeconds ?? 0)) * 1000;
}

export function drillPhase(phase: Recorder["phase"], finished: boolean, takes: number): DrillPhase {
  if (phase === "countdown") return "think";
  if (phase === "preparing" || phase === "recording") return "speak";
  if (phase === "finalizing") return "saving";
  if (finished) return "done";
  return takes > 0 ? "between" : "ready";
}

export type DrillClock = {
  phase: DrillPhase;
  round: DrillRound;
  takes: DrillTake[];
  /** Think: seconds before speaking; speak: time left (or elapsed when open-ended). */
  remainingMs: number;
  limitMs: number | null;
  announcement: string;
  /** A mark could not be saved; the result says so. */
  marksLost: boolean;
  /** For the recorder's onBeforeStart. */
  beforeStart: () => void;
  /** Another take of the first round in this session ("Same topic"). */
  again: () => void;
  mark: (m: Mark) => void;
};

export function useDrillClock(plan: DrillPlan, rec: Recorder, roundIndex: number, setRoundIndex: (index: number) => void): DrillClock {
  const ipc = useIpc();
  const qc = useQueryClient();
  const [takes, setTakes] = useState<DrillTake[]>([]);
  const [finished, setFinished] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [marksLost, setMarksLost] = useState(false);
  const round = plan.rounds[Math.min(roundIndex, plan.rounds.length - 1)];
  const active = useRef<DrillRound>(round);
  const buffered = useRef<TakeMark[]>([]);
  const recRef = useRef(rec);
  recRef.current = rec;
  const stopRequested = useRef(false);
  const announced = useRef(new Set<number>());
  const seen = useRef(rec.takes.length);
  const phase = drillPhase(rec.phase, finished, takes.length);
  const current = phase === "think" || phase === "speak" || phase === "saving" ? active.current : round;

  const beforeStart = useCallback(() => {
    active.current = round;
    buffered.current = [];
    stopRequested.current = false;
    announced.current = new Set();
    setAnnouncement(`Round ${round.index + 1} of ${plan.rounds.length}. ${round.thinkSeconds > 0 ? `Think for ${round.thinkSeconds} seconds; recording starts after.` : "Recording starts now."}`);
  }, [round, plan.rounds.length]);

  // Stop at the limit, once; announce 30, 10 and 5 seconds left (never every second).
  useEffect(() => {
    if (rec.phase !== "recording") return;
    const limit = roundLimitMs(active.current);
    if (limit === null) return;
    const left = limit - rec.elapsedMs;
    for (const s of ANNOUNCE_LEFT_S) {
      if (left <= s * 1000 && limit > s * 1000 + 1000 && !announced.current.has(s)) {
        announced.current.add(s);
        setAnnouncement(`${s} seconds left.`);
        break;
      }
    }
    if (left <= 0 && !stopRequested.current) {
      stopRequested.current = true;
      void recRef.current.stopAndSave();
    }
  }, [rec.phase, rec.elapsedMs]);

  // A saved take: write its marks once, then move on.
  useEffect(() => {
    if (rec.takes.length <= seen.current) return;
    const fresh = rec.takes.slice(seen.current);
    seen.current = rec.takes.length;
    const r = active.current;
    const added = fresh.map((t): DrillTake => ({ round: r, attemptId: t.asset.attemptId, durationMs: t.durationMs }));
    setTakes((previous) => [...previous, ...added]);
    const marks = buffered.current;
    buffered.current = [];
    for (const take of added) {
      void (marks.length > 0 ? ipc.addTakeEvents(take.attemptId, marks) : Promise.resolve(0))
        .catch(() => setMarksLost(true))
        .finally(() => void qc.invalidateQueries({ queryKey: keys.activityResult(take.attemptId) }));
    }
    const next = r.index + 1;
    if (next < plan.rounds.length) {
      setRoundIndex(next);
      setAnnouncement(`Round ${r.index + 1} saved. Next is round ${next + 1}.`);
    } else {
      setFinished(true);
      setAnnouncement("Round saved. That was the last round.");
    }
  }, [rec.takes.length]);

  // Celebrations wait while a round thinks, speaks or saves (9.10).
  useEffect(() => setDrillBusy(phase === "think" || phase === "speak" || phase === "saving"), [phase]);
  useEffect(() => () => setDrillBusy(false), []);

  const mark = useCallback((m: Mark) => {
    const r = recRef.current;
    if (r.phase !== "recording" || buffered.current.length >= MAX_MARKS) return;
    buffered.current.push({ atMs: Math.max(0, Math.round(r.elapsedMs)), kind: m.kind, data: m.data ?? {} });
  }, []);

  const again = useCallback(() => {
    setFinished(false);
    setRoundIndex(0);
  }, [setRoundIndex]);

  const limitMs = roundLimitMs(current);
  const remainingMs = phase === "think" ? rec.countdown * 1000 : phase === "speak" ? (limitMs === null ? rec.elapsedMs : Math.max(0, limitMs - rec.elapsedMs)) : (limitMs ?? 0);
  return { phase, round: current, takes, remainingMs, limitMs, announcement, marksLost, beforeStart, again, mark };
}
