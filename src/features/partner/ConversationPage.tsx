import { useEffect, useId, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Info, Keyboard, Mic, Pencil, Play, RotateCcw, Volume2 } from "lucide-react";
import { AudioPlayer } from "@/components/audio-player";
import { ErrorState, LoadingBlock, Page, Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PERSONAS, type PersonaId } from "@/content/scenarios";
import { CountdownRing } from "@/features/drills/CountdownRing";
import { useRecorder } from "@/features/practice/recorder";
import { RecorderPanel, useRecorderGuard } from "@/features/practice/RecorderPanel";
import { useIpc } from "@/lib/ipc";
import type { PracticeContext } from "@/lib/ipc/client";
import { keys, usePreferences } from "@/lib/ipc/queries";
import type { ConversationTurn, ConversationView, PartnerPreview } from "@/lib/ipc/schemas";
import { formatClock } from "@/lib/format";
import { pickPartnerVoice } from "@/lib/speech";
import { playCue } from "@/lib/tone";
import { ConversationSummary } from "./ConversationSummary";
import { fmtUsd, MODE_LABELS, usePartnerModes } from "./modes";
import { pressureDef } from "./pressure";
import { useConversation } from "./useConversation";
import { useOfflineVoices } from "./voices";

/** Plays one of your answers, loaded when you ask for it. */
function Listen({ attemptId, label }: { attemptId: string; label: string }) {
  const ipc = useIpc();
  const [open, setOpen] = useState(false);
  const url = useQuery({ queryKey: ["recording-playback", attemptId], queryFn: () => ipc.getRecordingPlaybackUrl(attemptId), enabled: open, retry: false });
  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setOpen(true)} aria-label={`Listen to ${label}`}>
        <Play aria-hidden /> Listen
      </Button>
    );
  }
  if (url.error) return <span className="text-meta text-muted-foreground">{url.error.message}</span>;
  return url.data ? <AudioPlayer src={url.data} label={label} className="w-full" /> : <span className="text-meta text-muted-foreground">Loading…</span>;
}

/** Fix transcript (13.4): your correction becomes a new revision and your answer's text. */
function FixTranscript({ turn, onFixed }: { turn: ConversationTurn; onFixed: () => void }) {
  const ipc = useIpc();
  const id = useId();
  const [text, setText] = useState(turn.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const current = await ipc.getAttemptTranscript(turn.attemptId!);
      if (!current.revision) throw new Error("This take has no transcript to fix yet.");
      await ipc.saveTranscriptCorrection(turn.attemptId!, current.revision.id, text.trim());
      onFixed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The correction could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 space-y-2">
      <Label htmlFor={id}>Your words, as you said them</Label>
      <Textarea id={id} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !text.trim() || text.trim() === turn.text} onClick={() => void save()}>Save the correction</Button>
      </div>
      {error && <p role="alert" className="text-meta text-destructive">{error}</p>}
    </div>
  );
}

function TurnBubble({ turn, view, takeNumber, hint, canFix, onRepeat, onFixed }: {
  turn: ConversationTurn; view: ConversationView; takeNumber: number | null; hint: string | null; canFix: boolean; onRepeat: () => void; onFixed: () => void;
}) {
  const [fixing, setFixing] = useState(false);
  if (turn.role === "partner") {
    return (
      <li className="max-w-[85%]">
        <div className="rounded-2xl rounded-tl-sm border bg-card p-3">
          <p className="text-meta text-muted-foreground">
            <Volume2 aria-hidden className="mr-1 inline size-3.5" />
            {view.conversation.scenario.personaTitle === "Panel" ? "Panel" : "Partner"}
            {turn.move === "interrupt" && " · cut in"}
          </p>
          <p className="text-lg">“{turn.text}”</p>
          {hint && <p className="mt-1 text-meta text-muted-foreground">{hint}</p>}
        </div>
        <Button size="sm" variant="ghost" className="mt-1 h-7 px-2" onClick={onRepeat} aria-label={`Repeat: ${turn.text}`}>
          <RotateCcw aria-hidden /> Repeat
        </Button>
      </li>
    );
  }
  const label = turn.typed ? "typed" : turn.takeDeleted ? "take deleted" : `take ${takeNumber ?? "?"}${turn.durationMs ? `, ${formatClock(turn.durationMs)}` : ""}`;
  return (
    <li className="ml-auto max-w-[85%]">
      <div className="rounded-2xl rounded-tr-sm border border-primary/30 bg-primary/5 p-3">
        <p className="text-meta text-muted-foreground">
          You ({label}){turn.outOfTime && " · ran out of time"}
        </p>
        <p>“{turn.text}”</p>
        {fixing && <FixTranscript turn={turn} onFixed={() => { setFixing(false); onFixed(); }} />}
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-end gap-1">
        {turn.attemptId && turn.takeAvailable && <Listen attemptId={turn.attemptId} label={`your answer, ${label}`} />}
        {canFix && !fixing && (
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setFixing(true)}>
            <Pencil aria-hidden /> Fix transcript
          </Button>
        )}
      </div>
    </li>
  );
}

/** One line to send the next turn (appendix D.8), with exactly what is sent one click away. */
function SendBar({ preview, spent, onSend, busy }: { preview: PartnerPreview; spent: number; onSend: () => void; busy: boolean }) {
  const local = preview.estimatedMaximumCostMicroUsd === 0 && !preview.recipient.startsWith("https://api.openai.com");
  // Ctrl+Enter sends when no text field has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) || e.target.isContentEditable);
      if (e.key === "Enter" && e.ctrlKey && !typing && !busy) {
        e.preventDefault();
        onSend();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSend, busy]);
  return (
    <Panel className="space-y-2 p-4" aria-label="Send bar">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1">
          {local
            ? "Send to the local model on this computer · free"
            : `Send your answer to OpenAI · ${preview.model} · at most ${fmtUsd(preview.estimatedMaximumCostMicroUsd)}${preview.capMicroUsd !== null ? ` · this conversation ${fmtUsd(spent)} of ${fmtUsd(preview.capMicroUsd)}` : ""}`}
        </p>
        <Button disabled={busy} onClick={onSend} aria-keyshortcuts="Control+Enter">
          Send
        </Button>
      </div>
      <details className="text-meta">
        <summary className="cursor-pointer">Exactly what is sent</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 whitespace-pre-wrap">{preview.selectedText}</pre>
        <p className="mt-2 text-muted-foreground">Instructions to the model: {preview.instructions}</p>
      </details>
    </Panel>
  );
}

function TypedAnswer({ onAnswer, busy }: { onAnswer: (text: string) => void; busy: boolean }) {
  const id = useId();
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return;
    onAnswer(text.trim());
    setText("");
  };
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Your answer</Label>
      <Textarea id={id} rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); submit(); } }} />
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || !text.trim()} onClick={submit}>Answer</Button>
        <span className="text-meta text-muted-foreground">Typed answers count as practice; they have no audio measures.</span>
      </div>
    </div>
  );
}

/**
 * A conversation with the practice partner (roadmap 13.4), at
 * /partner/:conversationId. You can leave and come back: reopening shows where
 * you were and sends nothing by itself.
 */
export function ConversationPage() {
  const { conversationId = "" } = useParams();
  const [search] = useSearchParams();
  const ipc = useIpc();
  const native = ipc.recordingMode === "native";
  const { preferences } = usePreferences();
  const modes = usePartnerModes();
  const voices = useOfflineVoices();
  const query = useQuery({ queryKey: keys.conversation(conversationId), queryFn: () => ipc.getConversation(conversationId) });
  const view = query.data;
  const persona = view ? PERSONAS[view.conversation.personaId as PersonaId] : undefined;
  const voice = pickPartnerVoice(voices, preferences.partnerVoice, persona?.voiceHint ?? "any");
  const pressure = pressureDef(view?.conversation.pressure ?? 0);
  const [typed, setTyped] = useState(search.get("typed") === "1");
  const typedAnswers = typed || !modes.spoken;
  const last = view?.turns[view.turns.length - 1];
  const nextOrdinal = !view ? 1 : last?.role === "learner" ? last.ordinal : (last?.ordinal ?? 0) + 1;
  const context: PracticeContext | undefined = view
    ? {
        sessionId: view.conversation.sessionId,
        exerciseId: "ex-conversation",
        exerciseVersion: 1,
        exerciseType: "conversation",
        prompt: view.conversation.sessionPrompt,
        outline: { point: "", reason: "", example: "" },
        conditions: { familiarity: "unfamiliar", preparationSeconds: 0, targetSeconds: pressure.limitSeconds ?? 120, audience: view.conversation.scenario.partnerRole.slice(0, 500), followUp: true },
        step: { index: Math.min(nextOrdinal, 50), key: "turn" },
      }
    : undefined;
  const rec = useRecorder(view?.conversation.sessionPrompt ?? "Conversation", context);
  const conv = useConversation(conversationId, { voice, rate: preferences.partnerRate, recording: rec.isCapturing });
  const guard = useRecorderGuard(rec);
  const [clockNote, setClockNote] = useState("");

  // The pressure level's limit (13.5): a chime first at high stakes; at the limit the take stops and saves, once.
  const outOfTime = useRef(false);
  const stopRequested = useRef(false);
  const chimed = useRef(false);
  useEffect(() => {
    if (rec.phase !== "recording" || pressure.limitSeconds === null) return;
    if (pressure.chimeSeconds !== null && !chimed.current && rec.elapsedMs >= pressure.chimeSeconds * 1000) {
      chimed.current = true;
      playCue("tick");
      setClockNote(`${pressure.limitSeconds - pressure.chimeSeconds} seconds left.`);
    }
    if (rec.elapsedMs >= pressure.limitSeconds * 1000 && !stopRequested.current) {
      stopRequested.current = true;
      outOfTime.current = true;
      setClockNote("Time. Your answer was saved.");
      void rec.stopAndSave();
    }
  }, [rec.phase, rec.elapsedMs, pressure.limitSeconds, pressure.chimeSeconds]);
  const seenTakes = useRef(rec.takes.length);
  useEffect(() => {
    if (rec.takes.length <= seenTakes.current) return;
    seenTakes.current = rec.takes.length;
    conv.takeSaved(rec.takes[rec.takes.length - 1].asset.attemptId, outOfTime.current);
  }, [rec.takes.length]);
  const beforeStart = () => {
    conv.stopSpeech();
    outOfTime.current = false;
    stopRequested.current = false;
    chimed.current = false;
    setClockNote("");
  };

  // Take numbers in the session, for the bubbles.
  const session = useQuery({ queryKey: keys.session(view?.conversation.sessionId ?? ""), queryFn: () => ipc.getSession(view!.conversation.sessionId), enabled: !!view && native });
  const takeNumber = (attemptId: string | null) => (attemptId ? (session.data?.attempts.find((a) => a.id === attemptId)?.ordinal ?? null) : null);
  useEffect(() => {
    if (rec.takes.length) void session.refetch();
  }, [rec.takes.length]);

  if (query.error) {
    return (
      <Page className="max-w-4xl">
        <ErrorState error={query.error} title="This conversation couldn't be opened" onRetry={() => void query.refetch()} />
      </Page>
    );
  }
  if (!view) {
    return (
      <Page className="max-w-4xl">
        <LoadingBlock rows={3} label="Opening the conversation" />
      </Page>
    );
  }
  const c = view.conversation;
  const answering = conv.phase === "your_turn" || conv.phase === "partner_speaking" || conv.phase === "recording" || conv.phase === "review" || conv.phase === "error";
  const turnNumber = Math.min(view.learnerTurns + (view.next === "learner" ? 1 : 0), c.scenario.maxTurns);
  const waiting = last?.role === "learner" && view.next === "partner" ? last : null;
  const hints = c.scenario.hints;
  let partnerIndex = -1;
  return (
    <Page className="max-w-4xl">
      <div aria-live="polite" className="sr-only">{conv.announcement}</div>
      <div aria-live="polite" className="sr-only">{clockNote}</div>
      <header className="mb-6 space-y-1">
        <p className="text-meta text-muted-foreground">
          {MODE_LABELS[c.mode]} · {c.scenario.personaTitle} · Pressure {c.pressure} ({pressure.name}) · {turnNumber} of {c.scenario.maxTurns} turns
        </p>
        <h1 className="text-title font-semibold tracking-tight">{c.scenario.title}</h1>
        <p className="text-muted-foreground">Your goal: {c.scenario.learnerGoal}</p>
        {c.mode === "scripted" && <p role="note" className="text-meta text-muted-foreground">Scripted (offline): the partner asks prepared questions and doesn't adapt to your answers.</p>}
        {!voice && view.next !== "ended" && (
          <p role="note" className="text-meta text-muted-foreground">
            No offline English voice found on this computer, so the partner's lines show as captions. You can add a voice in Windows: Settings → Time & language → Speech.
          </p>
        )}
        {!native && (
          <p role="note" className="flex items-center gap-2 text-meta text-muted-foreground">
            <Info aria-hidden className="size-4 shrink-0" /> Browser preview: recording is simulated and the partner's answers are canned.
          </p>
        )}
      </header>

      <ol aria-label="Conversation" className="mb-6 flex flex-col gap-3">
        {view.turns.map((t) => {
          if (t.role === "partner") partnerIndex += 1;
          return (
            <TurnBubble
              key={t.id}
              turn={t}
              view={view}
              takeNumber={takeNumber(t.attemptId)}
              hint={t.role === "partner" ? (hints[partnerIndex] ?? null) : null}
              canFix={waiting?.id === t.id && !t.typed && t.takeAvailable && conv.phase !== "sending"}
              onRepeat={() => conv.repeat(t.text)}
              onFixed={() => void conv.answer({ attemptId: t.attemptId!, outOfTime: t.outOfTime })}
            />
          );
        })}
      </ol>

      {view.next !== "ended" && view.next !== "closing" && (
        <div className="space-y-4">
          {conv.phase === "transcribing" && (
            <Panel className="space-y-2 p-4">
              <p role="status">{conv.pending && !conv.transcriptionAvailable ? "This take can't be transcribed here." : "Transcribing your answer on this computer…"}</p>
              {conv.pending && !conv.transcriptionAvailable && (
                <p className="text-meta text-muted-foreground">
                  {modes.spokenReason} <Link className="underline underline-offset-2" to="/settings/transcription">Transcription settings</Link>
                </p>
              )}
              {conv.pending && (
                <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => { setTyped(true); conv.cancelPending(); }}>
                  <Keyboard aria-hidden /> Type the answer instead
                </Button>
              )}
            </Panel>
          )}
          {conv.phase === "previewing" && <p role="status" className="text-meta">Preparing the partner's turn…</p>}
          {conv.phase === "sending" && (
            <div className="flex flex-wrap items-center gap-2">
              <p role="status">
                {c.mode === "scripted" || c.scenarioId === "qa-panel" ? "The partner is thinking…" : c.mode === "local" ? "Sending to the local model…" : "Waiting for OpenAI…"}
              </p>
              {c.mode !== "scripted" && c.scenarioId !== "qa-panel" && <Button size="sm" variant="outline" onClick={conv.stop}>Stop waiting</Button>}
            </div>
          )}
          {conv.preview && conv.phase === "review" && <SendBar preview={conv.preview} spent={view.spentMicroUsd} busy={false} onSend={() => void conv.send()} />}
          {conv.error && (
            <div className="flex flex-wrap items-center gap-2">
              <p role="alert" className="text-destructive">{conv.error}</p>
              {view.next === "partner" && <Button size="sm" variant="outline" onClick={conv.retry}>Preview again</Button>}
              {view.next === "partner" && c.mode === "api" && /cost limit/.test(conv.error) && c.maxCostMicroUsd !== null && c.maxCostMicroUsd * 2 <= 5_000_000 && (
                <Button size="sm" variant="ghost" onClick={() => void ipc.setConversationLimit(c.id, c.maxCostMicroUsd! * 2).then(() => { void query.refetch(); conv.retry(); })}>
                  Raise the limit to {fmtUsd(c.maxCostMicroUsd * 2)}
                </Button>
              )}
            </div>
          )}

          {answering && (
            <section aria-label={waiting ? "Answer again" : "Your answer"} className="space-y-2">
              {waiting && <p className="text-meta text-muted-foreground">Not happy with your answer? Answer again before you send it.</p>}
              {typedAnswers ? (
                <TypedAnswer busy={false} onAnswer={(text) => void conv.typeAnswer(text)} />
              ) : (
                <RecorderPanel
                  rec={rec}
                  compact
                  hideCountdown
                  onBeforeStart={beforeStart}
                  labels={{
                    record: conv.speaking ? "Stop the partner and record" : waiting ? "Record again" : "Record your answer",
                    again: conv.speaking ? "Stop the partner and record" : waiting ? "Record again" : "Record your answer",
                    stop: "Stop and save",
                  }}
                  clock={
                    pressure.limitSeconds === null ? (
                      <CountdownRing totalMs={null} remainingMs={rec.elapsedMs} caption="Speaking" />
                    ) : (
                      <CountdownRing totalMs={pressure.limitSeconds * 1000} remainingMs={Math.max(0, pressure.limitSeconds * 1000 - (rec.phase === "recording" ? rec.elapsedMs : 0))} caption="Time left" />
                    )
                  }
                  footer={
                    <p className="text-meta text-muted-foreground">
                      {pressure.limitSeconds === null ? "Stop when you're done. Ctrl+Enter starts and stops." : `Your answer stops by itself after ${pressure.limitSeconds} seconds.`}
                    </p>
                  }
                />
              )}
              {modes.spoken && (
                <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setTyped((v) => !v)} disabled={rec.isCapturing}>
                  {typedAnswers ? <><Mic aria-hidden /> Answer by voice instead</> : <><Keyboard aria-hidden /> Type instead</>}
                </Button>
              )}
            </section>
          )}
          <div>
            <Button variant="outline" onClick={() => void conv.end()} disabled={rec.isCapturing}>End conversation</Button>
          </div>
        </div>
      )}

      {view.next === "closing" && <p role="status">The conversation is over. Here's your summary…</p>}
      {view.next === "ended" && <ConversationSummary view={view} />}
      {guard}
    </Page>
  );
}
