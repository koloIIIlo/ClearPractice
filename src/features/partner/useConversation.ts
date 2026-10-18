import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { requestEngagementRefresh } from "@/features/engagement/refresh";
import { useTranscriptionQueue } from "@/features/transcription/queue";
import { useIpc } from "@/lib/ipc";
import { partnerAutoKey } from "@/lib/ipc/client";
import { keys } from "@/lib/ipc/queries";
import type { ConversationView, PartnerPreview } from "@/lib/ipc/schemas";
import { speakText } from "@/lib/speech";

export type TurnPhase =
  | "loading" | "partner_speaking" | "your_turn" | "recording" | "transcribing" | "review" | "previewing" | "sending" | "closing" | "ended" | "error";

/** The scripted partner answers after a natural pause (13.8). */
export const SCRIPTED_PAUSE_MS = 700;

/** Your answers and the text each holds: a new answer or a corrected transcript needs a new preview (A-33). */
export const bindingKey = (view: ConversationView) =>
  `${view.turns.filter((t) => t.role === "learner").map((t) => `${t.id}:${t.revisionId ?? "typed"}`).join("|")}#${view.turns.length}`;

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

export type Answer = { attemptId?: string; typedText?: string; outOfTime?: boolean };

/**
 * The turn loop (roadmap 13.4). The partner's line is spoken (offline voices
 * only) and captioned; your answer is a take, transcribed on this computer,
 * or typed. Then the partner's next turn:
 * - OpenAI: a preview straight away, sent only by Send (never by itself, not
 *   after recording, reopening or recovery; rule 3);
 * - a local model: the same, or by itself with auto-send ticked, but only for
 *   an answer given in this visit (reopening sends nothing);
 * - scripted, or the panel's questions: the next prepared line after a pause.
 */
export function useConversation(id: string, { voice, rate, recording }: { voice: SpeechSynthesisVoice | null; rate: number; recording: boolean }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const queue = useTranscriptionQueue();
  const query = useQuery({ queryKey: keys.conversation(id), queryFn: () => ipc.getConversation(id) });
  const view = query.data ?? null;
  const [preview, setPreview] = useState<PartnerPreview | null>(null);
  const previewRef = useRef<PartnerPreview | null>(null);
  const [busy, setBusy] = useState<null | "previewing" | "sending" | "answering">(null);
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [pending, setPending] = useState<{ attemptId: string; outOfTime: boolean } | null>(null);
  const speech = useRef<AbortController | null>(null);
  const seen = useRef<Set<string> | null>(null);
  // Only an answer you gave in this visit may send a local model's turn by itself.
  const answeredHere = useRef(false);
  // The binding a partner step was started for, so each answer gets one step.
  const prepared = useRef<string | null>(null);
  const ending = useRef(false);

  const apply = useCallback(
    (next: ConversationView) => {
      qc.setQueryData(keys.conversation(id), next);
      void qc.invalidateQueries({ queryKey: keys.conversations });
    },
    [qc, id],
  );

  const stopSpeech = useCallback(() => {
    speech.current?.abort();
    speech.current = null;
    setSpeaking(false);
  }, []);
  useEffect(() => () => speech.current?.abort(), []);

  const speak = useCallback(
    async (text: string) => {
      speech.current?.abort();
      if (!voice) return; // captions only
      const controller = new AbortController();
      speech.current = controller;
      setSpeaking(true);
      await speakText(text, { voice, rate, signal: controller.signal });
      if (speech.current === controller) {
        speech.current = null;
        setSpeaking(false);
      }
    },
    [voice, rate],
  );

  const discardPreview = useCallback(() => {
    if (previewRef.current) void ipc.cancelCoachingPreview(previewRef.current.requestId).catch(() => {});
    previewRef.current = null;
    setPreview(null);
  }, [ipc]);
  useEffect(() => () => { if (previewRef.current) void ipc.cancelCoachingPreview(previewRef.current.requestId).catch(() => {}); }, [ipc]);

  // A new partner line: spoken once and announced once. A reopened conversation waits for Repeat.
  useEffect(() => {
    if (!view) return;
    const partner = view.turns.filter((t) => t.role === "partner");
    if (seen.current === null) seen.current = new Set(view.learnerTurns === 0 && view.next === "learner" ? [] : partner.map((t) => t.id));
    const fresh = partner.filter((t) => !seen.current!.has(t.id));
    fresh.forEach((t) => seen.current!.add(t.id));
    const latest = fresh[fresh.length - 1];
    if (!latest) return;
    setAnnouncement(`${view.conversation.scenario.personaTitle} partner: ${latest.text}`);
    if (!recording) void speak(latest.text);
  }, [view, speak, recording]);

  const answer = useCallback(
    async (input: Answer) => {
      discardPreview();
      setPending(null);
      setBusy("answering");
      setError(null);
      try {
        const next = await ipc.addLearnerTurn(id, input);
        answeredHere.current = true;
        apply(next);
      } catch (e) {
        setError(message(e));
      } finally {
        setBusy(null);
      }
    },
    [ipc, id, apply, discardPreview],
  );

  // A saved take waits for its transcript (queued first), then becomes your answer.
  const transcript = useQuery({
    queryKey: ["attempt-transcript", pending?.attemptId ?? ""],
    queryFn: () => ipc.getAttemptTranscript(pending!.attemptId),
    enabled: !!pending,
    refetchInterval: (q) => (q.state.data?.revision ? false : 2_000),
  });
  useEffect(() => {
    if (!pending || !transcript.data?.revision) return;
    const { attemptId, outOfTime } = pending;
    setPending(null);
    void answer({ attemptId, outOfTime });
  }, [pending, transcript.data?.revision?.id, answer]);

  const takeSaved = useCallback(
    (attemptId: string, outOfTime: boolean) => {
      setError(null);
      setPending({ attemptId, outOfTime });
      if (queue.available && view) queue.enqueue([{ attemptId, sessionId: view.conversation.sessionId }], { first: true });
    },
    [queue, view],
  );

  const scripted = useCallback(async () => {
    setBusy("sending");
    try {
      apply(await ipc.nextScriptedTurn(id));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }, [ipc, id, apply]);

  const openPreview = useCallback(
    async (forKey: string) => {
      discardPreview();
      setBusy("previewing");
      setError(null);
      try {
        const next = await ipc.previewPartnerTurn(id);
        if (prepared.current !== forKey) {
          void ipc.cancelCoachingPreview(next.requestId).catch(() => {});
          return;
        }
        previewRef.current = next;
        setPreview(next);
      } catch (e) {
        setError(message(e));
      } finally {
        setBusy(null);
      }
    },
    [ipc, id, discardPreview],
  );

  const autoSend = useCallback(async () => {
    setBusy("sending");
    setSendingKey(partnerAutoKey(id));
    setError(null);
    try {
      apply(await ipc.sendPartnerTurnAuto(id));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
      setSendingKey(null);
    }
  }, [ipc, id, apply]);

  // The partner's next step, once per answer.
  const key = view ? bindingKey(view) : "";
  useEffect(() => {
    if (!view || view.next !== "partner" || busy || error || pending || recording || prepared.current === key) return;
    prepared.current = key;
    const c = view.conversation;
    if (c.mode === "scripted" || c.scenarioId === "qa-panel") {
      let fired = false;
      const timer = setTimeout(() => {
        fired = true;
        void scripted();
      }, SCRIPTED_PAUSE_MS);
      return () => {
        if (!fired) {
          clearTimeout(timer);
          prepared.current = null;
        }
      };
    }
    if (c.mode === "local" && c.autoSendLocal && answeredHere.current) void autoSend();
    else void openPreview(key);
  }, [view, key, busy, error, pending, recording, scripted, autoSend, openPreview]);

  const send = useCallback(async () => {
    const approved = previewRef.current;
    if (!approved || busy) return;
    previewRef.current = null;
    setPreview(null);
    setBusy("sending");
    setSendingKey(approved.requestId);
    setError(null);
    try {
      apply(await ipc.requestPartnerTurn(id, approved.requestId, approved.payloadSha256));
    } catch (e) {
      setError(`${message(e)} Your answer is kept.`);
    } finally {
      setBusy(null);
      setSendingKey(null);
      void qc.invalidateQueries({ queryKey: ["api-usage"] });
    }
  }, [ipc, id, apply, busy, qc]);

  /** Stop waiting: before dispatch nothing is billed; after it the charge stays uncertain. */
  const stop = useCallback(() => {
    if (sendingKey) void ipc.stopPartnerRequest(sendingKey).catch(() => {});
  }, [ipc, sendingKey]);

  /** After an error: a fresh preview (or the next step) for the same answer. */
  const retry = useCallback(() => {
    setError(null);
    prepared.current = null;
  }, []);

  const end = useCallback(async () => {
    stopSpeech();
    discardPreview();
    try {
      apply(await ipc.endConversation(id));
      requestEngagementRefresh("activity");
    } catch (e) {
      setError(message(e));
    }
  }, [ipc, id, apply, stopSpeech, discardPreview]);

  // Over: the partner closed it or you used every answer; the summary follows.
  useEffect(() => {
    if (view?.next !== "closing" || ending.current) return;
    ending.current = true;
    void end();
  }, [view?.next, end]);

  const phase: TurnPhase = !view
    ? query.error
      ? "error"
      : "loading"
    : view.next === "ended"
      ? "ended"
      : view.next === "closing"
        ? "closing"
        : recording
          ? "recording"
          : pending || busy === "answering"
            ? "transcribing"
            : view.next === "learner"
              ? speaking
                ? "partner_speaking"
                : "your_turn"
              : busy === "sending"
                ? "sending"
                : error
                  ? "error"
                  : preview
                    ? "review"
                    : "previewing";

  return {
    view, query, phase, preview, speaking, pending, error, announcement,
    /** Pressing Record stops the partner's speech first. */
    stopSpeech,
    repeat: (text: string) => void speak(text),
    takeSaved, answer, typeAnswer: (text: string) => answer({ typedText: text }),
    /** Stops waiting for a take's transcript (you type the answer instead); the take stays in the session. */
    cancelPending: () => setPending(null),
    send, stop, retry, end, transcriptionAvailable: queue.available,
  };
}
