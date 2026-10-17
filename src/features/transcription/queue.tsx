import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { requestEngagementRefresh } from "@/features/engagement/refresh";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useIpc } from "@/lib/ipc";
import { keys } from "@/lib/ipc/queries";

export type QueueItem = { attemptId: string; sessionId?: string };
type Snapshot = { current: QueueItem | null; waiting: QueueItem[]; done: number; failed: number; total: number };

/** A take that fails or is cancelled (a new recording takes priority) is retried once. */
const MAX_TRIES = 2;
const EMPTY: Snapshot = { current: null, waiting: [], done: 0, failed: 0, total: 0 };

interface Queue extends Snapshot {
  /** Local Whisper is set up and transcription isn't turned off. */
  available: boolean;
  unavailableReason: string | null;
  /** Adds takes that aren't queued yet; returns how many were added. */
  enqueue: (items: QueueItem[]) => number;
  cancel: () => void;
  busySession: (sessionId: string) => boolean;
}

const QueueContext = createContext<Queue | null>(null);

/**
 * One queue for every local transcription the app starts by itself or in bulk
 * (user request 2026-10-10): takes run one at a time on this computer, pause
 * while a take is recording (recording always comes first), and continue on any
 * page. Cloud transcription is never queued: each cloud take is previewed and
 * sent by hand. Takes that already have a transcript are skipped.
 */
export function TranscriptionQueueProvider({ children }: { children: ReactNode }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const native = ipc.recordingMode === "native";
  const preference = useQuery({ queryKey: ["transcription-preference"], queryFn: () => ipc.getTranscriptionPreference(), staleTime: 60_000, enabled: native });
  const setup = useQuery({ queryKey: ["transcription-setup"], queryFn: () => ipc.getTranscriptionSetup(), staleTime: 60_000, enabled: native });
  const available = native && preference.data?.mode !== "off" && setup.data?.configured === true;
  const unavailableReason = !native
    ? "Local transcription runs in the desktop app."
    : preference.data?.mode === "off"
      ? "Transcription is turned off in Settings → Transcription."
      : setup.data && !setup.data.configured
        ? "Local Whisper isn't set up yet. Download it in Settings → Transcription."
        : null;

  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const state = useRef<Snapshot & { tries: Map<string, number>; capturing: boolean }>({ ...EMPTY, tries: new Map(), capturing: false });
  const publish = () => {
    const { current, waiting, done, failed, total } = state.current;
    setSnapshot({ current, waiting: [...waiting], done, failed, total });
  };

  const finishBatch = () => {
    const s = state.current;
    if (s.current || s.waiting.length || s.total === 0) return;
    if (s.total > 1 || s.failed) {
      toast(s.failed ? `Transcribed ${s.done} of ${s.total} takes. ${s.failed} could not be transcribed.` : `Transcribed ${s.done} takes on this computer.`);
    }
    Object.assign(s, { done: 0, failed: 0, total: 0 });
  };

  const pump = useRef<() => Promise<void>>(async () => {});
  pump.current = async () => {
    const s = state.current;
    if (!available || s.current || s.capturing) return;
    while (s.waiting.length) {
      const next = s.waiting.shift()!;
      const transcript = await qc.fetchQuery({ queryKey: ["attempt-transcript", next.attemptId], queryFn: () => ipc.getAttemptTranscript(next.attemptId), staleTime: 0 }).catch(() => null);
      if (transcript?.revision) {
        s.done += 1;
        continue;
      }
      if (transcript?.job?.state === "running") {
        s.waiting.push(next); // someone else is transcribing it; check again after it finishes
        publish();
        return;
      }
      s.tries.set(next.attemptId, (s.tries.get(next.attemptId) ?? 0) + 1);
      s.current = next;
      publish();
      try {
        await ipc.transcribeAttempt(next.attemptId);
        void qc.invalidateQueries({ queryKey: ["attempt-transcript", next.attemptId] });
      } catch {
        // Usually another transcription is running; wait for its finish and try again.
        s.current = null;
        if ((s.tries.get(next.attemptId) ?? 0) < MAX_TRIES) s.waiting.unshift(next);
        else s.failed += 1;
        publish();
      }
      return;
    }
    publish();
    finishBatch();
  };

  useEffect(() => {
    if (!native) return;
    let disposed = false;
    const removers: (() => void)[] = [];
    void ipc
      .onTranscriptionEvent(async (event) => {
        if (event.phase !== "finished") return;
        const s = state.current;
        const finished = s.current?.attemptId === event.attemptId ? s.current : null;
        if (finished) {
          s.current = null;
          const transcript = await qc.fetchQuery({ queryKey: ["attempt-transcript", finished.attemptId], queryFn: () => ipc.getAttemptTranscript(finished.attemptId), staleTime: 0 }).catch(() => null);
          if (transcript?.revision) s.done += 1;
          else if ((s.tries.get(finished.attemptId) ?? 0) < MAX_TRIES) s.waiting.unshift(finished);
          else s.failed += 1;
        }
        void qc.invalidateQueries({ queryKey: ["sessions"] });
        if (finished?.sessionId) void qc.invalidateQueries({ queryKey: ["session", finished.sessionId] });
        // A drill take's result is worked out now, so records see it without opening the result (10.1).
        // Other takes have none; the call simply fails.
        await ipc.getActivityResult(event.attemptId).catch(() => null);
        void qc.invalidateQueries({ queryKey: keys.activityResult(event.attemptId) });
        requestEngagementRefresh("transcript");
        publish();
        void pump.current();
      })
      .then((remove) => (disposed ? remove() : removers.push(remove)))
      .catch(() => {});
    void ipc
      .onRecordingEvent((status) => {
        const capturing = ["preparing", "recording", "finalizing"].includes(status.phase);
        if (capturing === state.current.capturing) return;
        state.current.capturing = capturing;
        if (!capturing) void pump.current();
      })
      .then((remove) => (disposed ? remove() : removers.push(remove)))
      .catch(() => {});
    return () => {
      disposed = true;
      removers.forEach((r) => r());
    };
  }, [ipc, qc, native]);

  useEffect(() => {
    if (available) void pump.current();
  }, [available]);

  const enqueue = useCallback((items: QueueItem[]) => {
    const s = state.current;
    const known = new Set([s.current?.attemptId, ...s.waiting.map((i) => i.attemptId)]);
    const fresh = items.filter((i) => !known.has(i.attemptId) && known.add(i.attemptId));
    if (!fresh.length) return 0;
    s.waiting.push(...fresh);
    s.total += fresh.length;
    publish();
    void pump.current();
    return fresh.length;
  }, []);

  const cancel = useCallback(() => {
    const s = state.current;
    const running = !!s.current;
    // Forget the running take first, so its "finished" event isn't taken as a failure to retry.
    Object.assign(s, { current: null, waiting: [], done: 0, failed: 0, total: 0 });
    publish();
    if (running) void ipc.cancelTranscription().catch(() => {});
  }, [ipc]);

  const value = useMemo<Queue>(() => ({
    ...snapshot,
    available,
    unavailableReason,
    enqueue,
    cancel,
    busySession: (id) => snapshot.current?.sessionId === id || snapshot.waiting.some((i) => i.sessionId === id),
  }), [snapshot, available, unavailableReason, enqueue, cancel]);

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

/** Outside the app shell (isolated screens in tests) there is no queue: nothing is transcribed by itself. */
const NO_QUEUE: Queue = { ...EMPTY, available: false, unavailableReason: null, enqueue: () => 0, cancel: () => {}, busySession: () => false };

export function useTranscriptionQueue(): Queue {
  return useContext(QueueContext) ?? NO_QUEUE;
}
