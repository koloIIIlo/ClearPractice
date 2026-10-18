import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useIpc } from "@/lib/ipc";
import type { CoachingPreview } from "@/lib/ipc/schemas";
import { fmtUsd } from "./modes";

/**
 * Preview, then Send (D-33): exactly what will be sent, to whom and at most
 * what cost. Nothing is sent until Send; the approval is single-use, so a
 * failed request needs a new preview. Stop waiting is offered while it runs.
 */
export function useRequestPreview<T>({ prepare, send }: { prepare: () => Promise<CoachingPreview>; send: (preview: CoachingPreview) => Promise<T> }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const [preview, setPreview] = useState<CoachingPreview | null>(null);
  const current = useRef<CoachingPreview | null>(null);
  const [state, setState] = useState<"idle" | "preparing" | "sending">("idle");
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { if (current.current) void ipc.cancelCoachingPreview(current.current.requestId).catch(() => {}); }, [ipc]);

  const discard = () => {
    if (current.current) void ipc.cancelCoachingPreview(current.current.requestId).catch(() => {});
    current.current = null;
    setPreview(null);
  };
  const open = async () => {
    discard();
    setState("preparing");
    setError(null);
    try {
      const next = await prepare();
      current.current = next;
      setPreview(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare the request.");
    } finally {
      setState("idle");
    }
  };
  const approve = async (): Promise<T | null> => {
    const approved = current.current;
    if (!approved) return null;
    current.current = null;
    setPreview(null);
    setState("sending");
    setSending(approved.requestId);
    setError(null);
    try {
      return await send(approved);
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "The request did not finish."} Preview again to retry.`);
      return null;
    } finally {
      setState("idle");
      setSending(null);
      void qc.invalidateQueries({ queryKey: ["api-usage"] });
    }
  };
  const stop = () => {
    if (sending) void ipc.stopPartnerRequest(sending).catch(() => {});
  };
  return { preview, state, error, open, approve, discard, stop };
}

export function RequestPreviewCard({ preview, label, busy, onSend, onCancel }: { preview: CoachingPreview; label: string; busy: boolean; onSend: () => void; onCancel: () => void }) {
  const local = preview.estimatedMaximumCostMicroUsd === 0 && !preview.recipient.startsWith("https://api.openai.com");
  return (
    <div className="space-y-2 rounded-lg border p-3" role="group" aria-label={label}>
      <p className="font-medium">
        {local
          ? `Recipient: the local model on this computer · ${preview.model} · free`
          : `Recipient: OpenAI · ${preview.model} · at most ${fmtUsd(preview.estimatedMaximumCostMicroUsd)}`}
      </p>
      <p className="text-meta text-muted-foreground">{preview.focus}</p>
      <details className="text-meta" open>
        <summary className="cursor-pointer font-medium">Exactly what is sent</summary>
        <pre className="mt-2 max-h-56 overflow-auto rounded-md border bg-muted/40 p-3 whitespace-pre-wrap">{preview.selectedText}</pre>
      </details>
      <details className="text-meta">
        <summary className="cursor-pointer">Instructions to the model</summary>
        <p className="mt-2">{preview.instructions}</p>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={onSend}>{local ? "Send to the local model" : "Send · may be billed"}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>Cancel preview</Button>
      </div>
    </div>
  );
}

/** "Waiting for …" with Stop waiting, or "Preparing the text…". */
export function RequestStatus({ state, local, onStop }: { state: "idle" | "preparing" | "sending"; local: boolean; onStop: () => void }) {
  if (state === "idle") return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p role="status" className="text-meta">{state === "sending" ? `Waiting for ${local ? "the local model" : "OpenAI"}…` : "Preparing the text…"}</p>
      {state === "sending" && <Button variant="outline" size="sm" onClick={onStop}>Stop waiting</Button>}
    </div>
  );
}
