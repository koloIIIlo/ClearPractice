import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useIpc } from "@/lib/ipc";
import type { CoachingPreview, FeedbackResult } from "@/lib/ipc/schemas";
import { UI_LOCALE } from "@/lib/format";

const money = (micro: number) => new Intl.NumberFormat(UI_LOCALE, { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(micro / 1_000_000);

export function CoachingSpike() {
  const ipc = useIpc();
  const queries = useQueryClient();
  const native = ipc.recordingMode === "native";
  const key = useQuery({queryKey: ["api-key-status"], queryFn: () => ipc.getApiKeyStatus(), enabled: native, retry: false});
  const [text, setText] = useState("I want to explain how a database index works. It makes searching more fast, but updates can take longer. I want my explanation to be more clear.");
  const [preview, setPreview] = useState<CoachingPreview | null>(null);
  const previewRef = useRef<CoachingPreview | null>(null);
  const [feedback, setFeedback] = useState<FeedbackResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { if (previewRef.current) void ipc.cancelCoachingPreview(previewRef.current.requestId).catch(() => {}); }, [ipc]);
  function discard() {
    if (previewRef.current) void ipc.cancelCoachingPreview(previewRef.current.requestId).catch(() => {});
    previewRef.current = null;
    setPreview(null);
  }
  async function prepare() {
    setBusy(true); setError(null); setFeedback(null); discard();
    try {
      const value = await ipc.previewCoachingRequest(text);
      previewRef.current = value; setPreview(value);
    } catch { setError("Could not prepare the preview. Check the sample text and desktop connection."); }
    finally { setBusy(false); }
  }
  async function send() {
    if (!preview || !key.data?.present) return;
    const approved = preview;
    previewRef.current = null; setPreview(null); setBusy(true); setError(null);
    try { setFeedback(await ipc.requestCoaching(approved.requestId, approved.payloadSha256)); }
    catch { setError("The feedback test did not finish. Check your key, model access and tracked usage. A submitted request may still be charged; prepare a new preview to retry."); }
    finally { setBusy(false); void queries.invalidateQueries({queryKey: ["api-usage"]}); }
  }
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">Sample-text feedback test</h3>
      <p className="text-meta text-muted-foreground">Development candidate: GPT-6 Luna. Review its correction quality before selecting a default. This test sends the text below to OpenAI when you approve Send.</p>
      <Label htmlFor="coaching-sample">Text to review</Label>
      <Textarea id="coaching-sample" value={text} disabled={!native || busy} onChange={(event) => { discard(); setText(event.target.value); }} rows={5} />
      <Button variant="outline" disabled={!native || busy || !text.trim()} onClick={() => void prepare()}>Preview feedback test</Button>
      {!native && <p className="text-meta">Run the desktop app to prepare and send a test.</p>}
      {!key.data?.present && native && <p className="text-meta">Store your API key above before approving Send.</p>}
      {preview && <div className="space-y-3 rounded-lg border p-3" aria-label="Feedback request preview">
        <p className="font-medium">Recipient: OpenAI · {preview.model}</p>
        <p className="text-meta break-all">{preview.recipient}</p>
        <p className="text-meta">Estimated upper reservation: {money(preview.estimatedMaximumCostMicroUsd)} within the shared monthly limit. Price checked {preview.priceDate}: ${preview.inputUsdPerMillionTokens}/million input tokens, ${preview.outputUsdPerMillionTokens}/million output tokens.</p>
        <p className="text-meta text-muted-foreground">{preview.costExplanation}</p>
        <p className="text-meta">Focus: {preview.focus} · Prompt: {preview.prompt}</p>
        <blockquote className="whitespace-pre-wrap rounded border p-3 text-sm">{preview.selectedText}</blockquote>
        <details className="text-meta"><summary>Coaching instructions and request details</summary><p className="mt-2">{preview.instructions}</p><p className="mt-2">Output cap: {preview.maximumOutputTokens} tokens. Schema: FeedbackResult v1. Comparison context: none. Provider storage option: off. Preview expires in five minutes.</p><p className="mt-2">{preview.priceSource}</p></details>
        <p className="text-meta">OpenAI's data-retention terms apply. <a className="underline" href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noreferrer">Provider privacy details</a></p>
        <div className="flex flex-wrap gap-2"><Button disabled={busy || !key.data?.present} onClick={() => void send()}>Send sample text · may be billed</Button><Button variant="outline" disabled={busy} onClick={discard}>Cancel preview</Button></div>
      </div>}
      {busy && <p role="status" className="text-meta">Working…</p>}
      {error && <p role="alert" className="text-meta text-destructive">{error}</p>}
      {feedback && <div className="space-y-2 rounded-lg border p-3">
        <p className="font-medium">AI suggestion · {feedback.model}</p><p>{feedback.feedback.summary}</p>
        <p><strong>One improvement:</strong> {feedback.feedback.oneImprovement}</p><p><strong>Next attempt:</strong> {feedback.feedback.nextAttempt}</p>
        {feedback.feedback.corrections.map((c, i) => <p key={i} className="text-sm"><strong>{c.kind === "style" ? "Optional style" : "Clear error"}:</strong> “{c.quote}” → “{c.suggestion}”. {c.reason}</p>)}
        <p className="text-meta">Estimated cost: {feedback.estimatedCostMicroUsd === null ? feedback.costUnavailableReason : money(feedback.estimatedCostMicroUsd)}. Input tokens: {feedback.inputTokens ?? "unavailable"}; output tokens: {feedback.outputTokens ?? "unavailable"}.</p>
      </div>}
    </div>
  );
}
