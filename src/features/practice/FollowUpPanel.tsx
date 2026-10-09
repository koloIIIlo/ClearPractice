import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircleQuestion, RefreshCw } from "lucide-react";
import { EvidenceLabel } from "@/components/evidence";
import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { followUpsFor } from "@/content/followups";
import { useIpc } from "@/lib/ipc";
import { usePreferences } from "@/lib/ipc/queries";
import type { CoachingPreview, FollowUpQuestion, PracticePrompt } from "@/lib/ipc/schemas";
import { money } from "@/features/review/ApiTranscribe";

/**
 * Interaction practice (5.11, §7): after the first answer to a prompt with a
 * follow-up, a listener's question appears in writing and you answer it in
 * the next take. Written questions work offline; an AI question is a separate
 * request with its own preview and Send. Both are labelled a simulation.
 */
export function FollowUpPanel({ prompt, sessionId, lastTakeId, takeCount, native, locked }: {
  prompt: PracticePrompt; sessionId: string; lastTakeId: string | undefined; takeCount: number; native: boolean; locked: boolean;
}) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const { preferences } = usePreferences();
  const written = followUpsFor(prompt.id);
  const [index, setIndex] = useState(0);
  const [ai, setAi] = useState<FollowUpQuestion | null>(null);
  const [preview, setPreview] = useState<CoachingPreview | null>(null);
  const previewRef = useRef<CoachingPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  const transcript = useQuery({
    queryKey: ["attempt-transcript", lastTakeId ?? ""],
    queryFn: () => ipc.getAttemptTranscript(lastTakeId!),
    enabled: native && !!lastTakeId,
  });
  useEffect(() => () => { if (previewRef.current) void ipc.cancelCoachingPreview(previewRef.current.requestId).catch(() => {}); }, [ipc]);

  if (!prompt.conditions.followUp || takeCount === 0) return null;
  const question = ai?.question ?? written[index % written.length];
  const canAskAi = native && preferences.coachingMode !== "off" && !!lastTakeId;
  const local = preferences.coachingMode === "local";
  const hasTranscript = !!transcript.data?.revision;

  const discard = () => {
    if (previewRef.current) void ipc.cancelCoachingPreview(previewRef.current.requestId).catch(() => {});
    previewRef.current = null;
    setPreview(null);
  };
  async function prepare() {
    discard();
    setBusy(true); setError(null);
    try {
      const next = await ipc.previewFollowUp(lastTakeId!, preferences.coachingModel);
      previewRef.current = next;
      setPreview(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare the request.");
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!preview) return;
    const { requestId, payloadSha256 } = preview;
    previewRef.current = null;
    setPreview(null);
    setBusy(true); setError(null); setSending(requestId);
    try {
      setAi(await ipc.requestFollowUp(lastTakeId!, requestId, payloadSha256));
      setKept(false);
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "The request did not finish."} A written question is still shown.`);
    } finally {
      setBusy(false); setSending(null);
      void qc.invalidateQueries({ queryKey: ["api-usage"] });
    }
  }
  async function keep() {
    const s = await ipc.getSession(sessionId);
    const line = `Follow-up question (simulated${ai ? ", AI" : ""}): ${question}`;
    await ipc.updateSession(sessionId, { title: s.title, notes: s.notes ? `${s.notes}\n${line}` : line, tags: s.tags, favorite: s.favorite });
    setKept(true);
  }

  return (
    <Panel className="space-y-3" aria-labelledby="follow-up-heading">
      <div className="flex flex-wrap items-center gap-2">
        <MessageCircleQuestion aria-hidden className="size-5 text-muted-foreground" />
        <h2 id="follow-up-heading" className="font-semibold">A listener asks</h2>
        <span className="text-meta text-muted-foreground">Simulation</span>
        {ai && <EvidenceLabel source="ai" />}
      </div>
      <p className="text-lg">“{question}”</p>
      {ai?.why && <p className="text-meta text-muted-foreground">{ai.why}</p>}
      <p className="text-meta text-muted-foreground">Answer it in your next take, without preparing first. Then compare how you adjusted.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={locked} onClick={() => { setAi(null); setIndex((i) => i + 1); setKept(false); }}>
          <RefreshCw aria-hidden /> Another question
        </Button>
        {native && (
          <Button variant="ghost" size="sm" disabled={locked || kept} onClick={() => void keep().catch((e) => setError(e instanceof Error ? e.message : "Could not save the question."))}>
            {kept ? "Kept in the session notes" : "Keep with the session notes"}
          </Button>
        )}
        {canAskAi && (
          hasTranscript
            ? <Button variant="ghost" size="sm" className="ml-auto" disabled={busy || locked} onClick={() => void prepare()}>Ask AI for a question…</Button>
            : <span className="ml-auto text-meta text-muted-foreground">For an AI question, <Link className="underline" to={`/sessions/${sessionId}`}>transcribe take {takeCount}</Link> first.</span>
        )}
      </div>
      {preview && (
        <div className="space-y-2 rounded-lg border p-3" role="group" aria-label="Follow-up request preview">
          <p className="font-medium">
            {local ? `Recipient: local model on this computer · ${preview.model} · free` : `Recipient: OpenAI · ${preview.model} · estimated upper reservation ${money(preview.estimatedMaximumCostMicroUsd)}`}
          </p>
          <p className="text-meta font-medium">Text that will be sent</p>
          <pre className="max-h-56 overflow-auto rounded-md border bg-muted/40 p-3 text-meta whitespace-pre-wrap">{preview.selectedText}</pre>
          <details className="text-meta"><summary className="cursor-pointer">Instructions to the model</summary><p className="mt-2">{preview.instructions}</p></details>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void send()}>{local ? "Send to the local model" : "Send · may be billed"}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={discard}>Cancel preview</Button>
          </div>
        </div>
      )}
      {busy && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-meta">{sending ? `Waiting for ${local ? "the local model" : "OpenAI"}…` : "Preparing the text…"}</p>
          {sending && <Button variant="outline" size="sm" onClick={() => void ipc.stopTakeCoaching(sending)}>Stop waiting</Button>}
        </div>
      )}
      {error && <p role="alert" className="text-meta text-destructive">{error}</p>}
    </Panel>
  );
}
