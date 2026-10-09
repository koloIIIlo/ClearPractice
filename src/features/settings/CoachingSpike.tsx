import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useIpc } from "@/lib/ipc";
import type { CoachingModel, CoachingPreview, FeedbackResult } from "@/lib/ipc/schemas";
import { UI_LOCALE } from "@/lib/format";

/** Official IDs and standard text prices per million tokens (input / output), checked 2026-10-08. */
export const COACHING_MODELS: { id: CoachingModel; label: string; note: string; input: string; output: string }[] = [
  { id: "gpt-6-luna", label: "GPT-6 Luna", note: "most efficient · $0.10 / $0.50 per M tokens", input: "0.10", output: "0.50" },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", note: "near-flagship · $2 / $10 per M tokens", input: "2", output: "10" },
  { id: "gpt-6-astra", label: "GPT-6 Astra", note: "flagship · $10 / $50 per M tokens", input: "10", output: "50" },
];
/** The day the built-in prices were checked on OpenAI's model pages. */
export const BUILT_IN_PRICE_DATE = "2026-10-08";

const money = (micro: number) => new Intl.NumberFormat(UI_LOCALE, { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(micro / 1_000_000);

export function CoachingSpike() {
  const ipc = useIpc();
  const queries = useQueryClient();
  const native = ipc.recordingMode === "native";
  const key = useQuery({queryKey: ["api-key-status"], queryFn: () => ipc.getApiKeyStatus(), enabled: native, retry: false});
  const [text, setText] = useState("I want to explain how a database index works. It makes searching more fast, but updates can take longer. I want my explanation to be more clear.");
  const [model, setModel] = useState<CoachingModel>("gpt-6-luna");
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
      const value = await ipc.previewCoachingRequest(text, model);
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
      <p className="text-meta text-muted-foreground">Compare the models' correction quality before choosing a default. This test sends the text below to OpenAI when you approve Send; larger models cost more per request.</p>
      <div className="space-y-1">
        <Label htmlFor="coaching-model">Model</Label>
        <Select value={model} onValueChange={(v) => { discard(); setModel(v as CoachingModel); }} disabled={!native || busy}>
          <SelectTrigger id="coaching-model" className="h-10 w-full max-w-md"><SelectValue /></SelectTrigger>
          <SelectContent>
            {COACHING_MODELS.map((m) => <SelectItem key={m.id} value={m.id}>{m.label} · {m.note}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
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
