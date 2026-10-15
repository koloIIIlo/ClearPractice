import { useEffect, useRef } from "react";
import { useTranscriptionQueue } from "@/features/transcription/queue";

/**
 * Sends this visit's new takes to the app's transcription queue as soon as
 * each is saved (user request 2026-10-10), so the take summary appears without
 * a click. It uses local Whisper whenever it is set up, also when Cloud is the
 * default for transcribing by hand; cloud transcription is never started by
 * itself. Returns whether takes are being transcribed automatically.
 */
export function useAutoTranscribe(takeIds: string[], sessionId: string, { enabled }: { enabled: boolean }) {
  const queue = useTranscriptionQueue();
  const sent = useRef(new Set<string>());
  const active = enabled && queue.available;
  useEffect(() => {
    if (!active) return;
    const fresh = takeIds.filter((id) => !sent.current.has(id));
    fresh.forEach((id) => sent.current.add(id));
    if (fresh.length) queue.enqueue(fresh.map((attemptId) => ({ attemptId, sessionId })));
  }, [takeIds.join(","), active, sessionId]);
  return active;
}
