import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Check, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { EvidenceLabel } from "@/components/evidence";
import { useIpc } from "@/lib/ipc";
import { usePreferences } from "@/lib/ipc/queries";
import type { CoachingModel, CoachingRun, TakeCoachingPreview } from "@/lib/ipc/schemas";
import { formatLongDay } from "@/lib/format";
import { COACHING_MODELS } from "@/features/settings/CoachingSpike";
import { money } from "./ApiTranscribe";

/** A preview addressed to a local model server rather than OpenAI. */
const isLocal = (p: TakeCoachingPreview) => !p.preview.recipient.startsWith("https://api.openai.com/");

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/**
 * AI feedback on one saved take (M5, P.9). Nothing is sent until you read the
 * exact text in the preview and press Send: the task, your focus, measured
 * summaries, the transcript (your correction if you made one) and, for timed
 * takes, each part's locally measured delivery. Never audio. Words you hide
 * are replaced before the text is built. Results are stored with the take.
 */
export function TakeCoaching({ attemptId, sessionId }: { attemptId: string; sessionId?: string }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const { preferences: prefs } = usePreferences();
  const runs = useQuery({ queryKey: ["take-coaching", attemptId], queryFn: () => ipc.listTakeCoaching(attemptId) });
  const transcript = useQuery({ queryKey: ["attempt-transcript", attemptId], queryFn: () => ipc.getAttemptTranscript(attemptId) });
  const key = useQuery({ queryKey: ["api-key-status"], queryFn: () => ipc.getApiKeyStatus(), retry: false });
  const usage = useQuery({ queryKey: ["api-usage"], queryFn: () => ipc.getApiUsageSummary(), retry: false });
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState<CoachingModel | null>(null);
  const [delivery, setDelivery] = useState<boolean | null>(null);
  const [hide, setHide] = useState("");
  const [prepared, setPrepared] = useState<TakeCoachingPreview | null>(null);
  const preparedRef = useRef<TakeCoachingPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const chosenModel = model ?? prefs.coachingModel;
  const chosenDelivery = delivery ?? prefs.deliveryImpressions;

  const discard = () => {
    if (preparedRef.current) void ipc.cancelCoachingPreview(preparedRef.current.preview.requestId).catch(() => {});
    preparedRef.current = null;
    setPrepared(null);
  };
  useEffect(() => () => { if (preparedRef.current) void ipc.cancelCoachingPreview(preparedRef.current.preview.requestId).catch(() => {}); }, [ipc, attemptId]);
  useEffect(() => {
    if (!sending) return;
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [sending]);

  if (prefs.coachingMode === "off") return null;
  const hasTranscript = !!transcript.data?.revision;
  const local = prefs.coachingMode === "local";
  const currentRevision = transcript.data?.correction?.id ?? transcript.data?.revision?.id ?? null;
  const list = runs.data ?? [];

  async function prepare() {
    discard();
    setBusy(true); setError(null);
    try {
      const terms = hide.split(",").map((t) => t.trim()).filter(Boolean);
      const next = await ipc.previewTakeCoaching(attemptId, { model: chosenModel, deliveryImpressions: chosenDelivery, hide: terms });
      preparedRef.current = next;
      setPrepared(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare the request.");
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!prepared) return;
    const { requestId, payloadSha256 } = prepared.preview;
    preparedRef.current = null;
    setPrepared(null);
    setBusy(true); setError(null); setSending(requestId);
    try {
      await ipc.requestTakeCoaching(attemptId, requestId, payloadSha256);
      await qc.invalidateQueries({ queryKey: ["take-coaching", attemptId] });
      setOpen(false);
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "The request did not finish."} Your take and notes are unchanged; prepare a new preview to try again.`);
    } finally {
      setBusy(false); setSending(null);
      void qc.invalidateQueries({ queryKey: ["api-usage"] });
    }
  }

  return (
    <section aria-label="AI feedback" className="space-y-3 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">AI feedback</h3>
        <EvidenceLabel source="ai" />
        {!open && (
          <Button className="ml-auto" variant="outline" size="sm" disabled={!hasTranscript} onClick={() => setOpen(true)}>
            <MessageSquareText aria-hidden /> {list.length > 0 ? "Ask again…" : "Get AI feedback…"}
          </Button>
        )}
      </div>
      {!hasTranscript && list.length === 0 && <p className="text-meta text-muted-foreground">Transcribe this take first. Feedback is based on its transcript and measures; audio is never sent.</p>}

      {open && (
        <div className="space-y-3 rounded-lg border p-3" role="group" aria-label="Prepare AI feedback">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:items-end">
            {local ? (
              <p className="flex h-10 items-center text-meta text-muted-foreground">Local model on this computer · free</p>
            ) : (
            <div className="space-y-1">
              <Label htmlFor={`coach-model-${attemptId}`}>Model</Label>
              <NativeSelect id={`coach-model-${attemptId}`} className="w-full" value={chosenModel} disabled={busy}
                onChange={(e) => { discard(); setModel(e.target.value as CoachingModel); }}>
                {COACHING_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </NativeSelect>
            </div>
            )}
            <div className="flex h-10 items-center gap-2">
              <Switch id={`coach-delivery-${attemptId}`} checked={chosenDelivery} disabled={busy} onCheckedChange={(v) => { discard(); setDelivery(v); }} />
              <Label htmlFor={`coach-delivery-${attemptId}`} className="font-normal">Delivery impressions (experimental)</Label>
            </div>
          </div>
          <p className="text-meta text-muted-foreground">
            {chosenDelivery
              ? "The AI may say how parts may come across to a listener, citing the measured pitch, loudness and pace. It never describes your feelings and gives no score."
              : "Feedback on wording, one improvement and your next attempt. Turn on delivery impressions to include how parts may come across."}
          </p>
          <div className="space-y-1">
            <Label htmlFor={`coach-hide-${attemptId}`}>Hide words before sending (optional, separated by commas)</Label>
            <Input id={`coach-hide-${attemptId}`} value={hide} maxLength={1000} disabled={busy} placeholder="names, places, companies"
              onChange={(e) => { discard(); setHide(e.target.value); }} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void prepare()}>Preview request</Button>
            <Button variant="ghost" disabled={busy && !!sending} onClick={() => { discard(); setOpen(false); }}>Close</Button>
          </div>
        </div>
      )}

      {prepared && (
        <div className="space-y-2 rounded-lg border p-3" role="group" aria-label="AI feedback request preview">
          <p className="font-medium">Recipient: {isLocal(prepared) ? "local model on this computer" : "OpenAI"} · {prepared.preview.model}</p>
          <p className="text-meta break-all text-muted-foreground">{prepared.preview.recipient}</p>
          {isLocal(prepared) ? (
            <p className="text-meta">{prepared.preview.costExplanation}</p>
          ) : (
            <p className="text-meta">
              Estimated upper reservation: {money(prepared.preview.estimatedMaximumCostMicroUsd)} (price checked {prepared.preview.priceDate}: ${prepared.preview.inputUsdPerMillionTokens} / ${prepared.preview.outputUsdPerMillionTokens} per million input / output tokens).
              {usage.data && ` Remaining this month: ${money(usage.data.remainingMicroUsd)} of ${money(usage.data.stopMicroUsd)}.`}
            </p>
          )}
          <p className="text-meta text-muted-foreground">
            {prepared.timedParts > 0 ? `${prepared.timedParts} timed ${prepared.timedParts === 1 ? "part" : "parts"} with measured delivery.` : "No timed parts: delivery per part is left out."}
            {prepared.corrected && " Your correction is sent instead of the automatic transcript."}
          </p>
          {prepared.answeredAt && (
            <p className="text-meta font-medium">
              You asked exactly this on {formatLongDay(prepared.answeredAt.slice(0, 10))} at {time(prepared.answeredAt)}; that answer is saved below. Asking again is a new request and may be billed.
            </p>
          )}
          <div>
            <p className="text-meta font-medium">Text that will be sent</p>
            <pre className="mt-1 max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 text-meta whitespace-pre-wrap">{prepared.preview.selectedText}</pre>
          </div>
          <details className="text-meta">
            <summary className="cursor-pointer">Instructions to the model and request details</summary>
            <p className="mt-2">{prepared.preview.instructions}</p>
            <p className="mt-2">Output cap: {prepared.preview.maximumOutputTokens} tokens. Provider storage: off. The preview expires in five minutes. {prepared.preview.costExplanation}</p>
          </details>
          {!isLocal(prepared) && key.data && !key.data.present && <p className="text-meta">Store your OpenAI key in Settings → Coaching before sending.</p>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || (!isLocal(prepared) && !key.data?.present)} onClick={() => void send()}>
              {isLocal(prepared) ? (prepared.answeredAt ? "Ask again" : "Send to the local model") : prepared.answeredAt ? "Ask again · may be billed" : "Send · may be billed"}
            </Button>
            <Button variant="outline" disabled={busy} onClick={discard}>Cancel preview</Button>
          </div>
        </div>
      )}

      {busy && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-meta">{sending ? `Waiting for ${local ? "the local model" : "OpenAI"}… ${elapsed} s` : "Preparing the text…"}</p>
          {sending && <Button variant="outline" size="sm" onClick={() => void ipc.stopTakeCoaching(sending)}>Stop waiting</Button>}
        </div>
      )}
      {error && <p role="alert" className="text-meta text-destructive">{error}</p>}

      {list[0] && <FeedbackCard run={list[0]} sessionId={sessionId} stale={!!currentRevision && list[0].revisionId !== currentRevision} />}
      {list.length > 1 && (
        <details className="text-meta">
          <summary className="cursor-pointer">Earlier feedback ({list.length - 1})</summary>
          <div className="mt-2 space-y-2">
            {list.slice(1).map((r) => <FeedbackCard key={r.id} run={r} sessionId={sessionId} stale={!!currentRevision && r.revisionId !== currentRevision} />)}
          </div>
        </details>
      )}
    </section>
  );
}

/**
 * Saves a suggestion from AI feedback as a phrase card (user request
 * 2026-10-09): new and due today, linked to the session.
 */
function SaveSuggestion({ original, expression, explanation, sessionId }: { original: string; expression: string; explanation: string; sessionId?: string }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => ipc.addPhrase({ original: original.trim() || "(a new way to say it)", expression, explanation, examples: [] }, sessionId ?? null),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["phrases"] }), qc.invalidateQueries({ queryKey: ["today"] })]),
  });
  if (save.isSuccess) return <span className="inline-flex h-8 items-center gap-1 text-meta text-muted-foreground"><Check aria-hidden className="size-4" /> Saved to Phrases</span>;
  return (
    <>
      <Button variant="outline" size="sm" disabled={save.isPending} aria-label={`Save “${expression}” to Phrases`} onClick={() => save.mutate()}>
        <BookmarkPlus aria-hidden /> Save to Phrases
      </Button>
      {save.error && <span role="alert" className="text-meta text-destructive">{save.error.message}</span>}
    </>
  );
}

function FeedbackCard({ run, stale, sessionId }: { run: CoachingRun; stale: boolean; sessionId?: string }) {
  const f = run.feedback;
  return (
    <article className="space-y-2 rounded-lg border p-3" aria-label={`AI feedback from ${formatLongDay(run.createdAt.slice(0, 10))}`}>
      <p className="text-meta text-muted-foreground">
        {run.provider === "Local LLM" ? `${run.model} (local)` : run.model} · {formatLongDay(run.createdAt.slice(0, 10))} {time(run.createdAt)}
        {run.deliveryImpressions && " · with delivery impressions"}
      </p>
      {stale && <p className="text-meta">Based on an earlier version of the transcript.</p>}
      <p>{f.summary}</p>
      <p><span className="font-medium">One improvement:</span> {f.oneImprovement}</p>
      <p><span className="font-medium">Next attempt:</span> {f.nextAttempt}</p>
      {f.corrections.length > 0 && (
        <ul className="space-y-1">
          {f.corrections.map((c, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{c.kind === "style" ? "Optional style" : "Clear error"}:</span> “{c.quote}” → “{c.suggestion}”. <span className="text-muted-foreground">{c.reason}</span>
              </span>
              <SaveSuggestion original={c.quote} expression={c.suggestion} explanation={c.reason} sessionId={sessionId} />
            </li>
          ))}
        </ul>
      )}
      {f.phrases.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium">Phrases you could use</p>
          <ul className="space-y-2">
            {f.phrases.map((p, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 flex-1">
                  “{p.expression}”{p.instead && <span className="text-muted-foreground"> instead of “{p.instead}”</span>}
                  {p.why && <span className="block text-meta text-muted-foreground">{p.why}</span>}
                </span>
                <SaveSuggestion original={p.instead} expression={p.expression} explanation={p.why} sessionId={sessionId} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {f.deliveryNotes.length > 0 && (
        <div>
          <p className="font-medium">How it may come across</p>
          <ul className="space-y-1">
            {f.deliveryNotes.map((n, i) => <li key={i}><span className="text-muted-foreground">Part {n.part}:</span> {n.note}</li>)}
          </ul>
        </div>
      )}
      <p className="text-meta text-muted-foreground">
        {run.estimatedCostMicroUsd === null ? run.costUnavailableReason : `Estimated cost ${money(run.estimatedCostMicroUsd)}`}
        {` · ${run.inputTokens ?? "unknown"} input / ${run.outputTokens ?? "unknown"} output tokens`}
      </p>
      <details className="text-meta">
        <summary className="cursor-pointer">What was sent</summary>
        <pre className="mt-1 max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 whitespace-pre-wrap">{run.sentText}</pre>
      </details>
    </article>
  );
}
