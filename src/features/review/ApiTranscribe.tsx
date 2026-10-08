import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { formatClock, formatLongDay, UI_LOCALE } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import type { AudioPreview, AudioProvider, AudioResult } from "@/lib/ipc/schemas";

/**
 * API mode on takes stays off until the plan's "API transcription enablement
 * gate" passes (live consented request, provider contract tests, failures,
 * restore). Until then only the Settings test panel can send, after a preview.
 */
export const API_MODE_ENABLED = false;

export const API_LABELS: Record<AudioProvider, string> = { deepgram: "Deepgram Nova-3", assemblyai: "AssemblyAI Universal-3.5 Pro" };
export const money = (micro: number) =>
  new Intl.NumberFormat(UI_LOCALE, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(micro / 1_000_000);

/**
 * Preview → explicit Send for one saved take (3.15). Nothing leaves the computer
 * until the user reads the preview and presses Send; the approval is single-use
 * and bound to the exact audio, settings, recipient and price. The result is
 * saved with the take as its own transcript (3.16). A repeat of an identical
 * request is labelled Retranscribe, because it is a new paid run.
 */
export function ApiRequestFlow({ attemptId, provider, hasKey, keyHint }: { attemptId: string; provider: AudioProvider; hasKey: boolean; keyHint: string }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const usage = useQuery({ queryKey: ["api-usage"], queryFn: () => ipc.getApiUsageSummary(), retry: false });
  const [preview, setPreview] = useState<AudioPreview | null>(null);
  const previewRef = useRef<AudioPreview | null>(null);
  const [result, setResult] = useState<AudioResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const discard = () => {
    if (previewRef.current) void ipc.cancelApiTranscriptionPreview(previewRef.current.requestId);
    previewRef.current = null;
    setPreview(null);
  };
  // A different take or provider, or leaving the page, invalidates the preview.
  useEffect(() => () => { if (previewRef.current) void ipc.cancelApiTranscriptionPreview(previewRef.current.requestId); previewRef.current = null; setPreview(null); }, [ipc, attemptId, provider]);

  async function prepare() {
    discard();
    setBusy(true); setError(null); setResult(null);
    try {
      const next = await ipc.previewApiTranscription(attemptId, provider);
      previewRef.current = next;
      setPreview(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare the preview.");
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!preview) return;
    const approved = preview;
    previewRef.current = null;
    setPreview(null);
    setBusy(true); setError(null);
    try {
      setResult(await ipc.requestApiTranscription(approved.requestId, approved.payloadSha256));
      void qc.invalidateQueries({ queryKey: ["attempt-transcript", approved.attemptId] });
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "The request did not finish."} Prepare a new preview to try again.`);
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ["api-usage"] });
    }
  }

  return (
    <div className="space-y-3">
      <Button variant="outline" disabled={busy || !attemptId} onClick={() => void prepare()}>Preview request</Button>
      {preview && (
        <div className="space-y-2 rounded-lg border p-3" role="group" aria-label="API transcription request preview">
          <p className="font-medium">Recipient: {preview.providerLabel} · {preview.recipient} · {preview.model}</p>
          <p className="text-meta">
            Sends this take as prepared 16 kHz mono WAV: {formatClock(preview.durationMs)}, {(preview.bytes / 1024).toFixed(0)} KB, SHA-256{" "}
            <code>{preview.audioSha256.slice(0, 12)}…</code>
          </p>
          <p className="text-meta">
            Estimated charge: {money(preview.estimatedCostMicroUsd)} (list price checked {preview.priceDate}, billed per started minute).
            {usage.data && ` Remaining this month: ${money(usage.data.remainingMicroUsd)} of ${money(usage.data.stopMicroUsd)}.`}
          </p>
          {preview.previousRunAt && (
            <p className="text-meta font-medium">
              This exact take was already transcribed with these settings on {formatLongDay(preview.previousRunAt.slice(0, 10))}; that transcript is saved with the take. Sending again is a new paid run.
            </p>
          )}
          <details className="text-meta">
            <summary>Exact settings sent with the audio</summary>
            <pre className="mt-1 whitespace-pre-wrap">{JSON.stringify(preview.settings, null, 2)}</pre>
            <p><a className="underline" href={preview.priceSource} target="_blank" rel="noreferrer">Price source</a></p>
          </details>
          <p className="text-meta text-muted-foreground">{preview.dataHandling}</p>
          {!hasKey && <p className="text-meta">{keyHint}</p>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !hasKey} onClick={() => void send()}>
              {preview.previousRunAt ? "Retranscribe · may be billed" : "Send take · may be billed"}
            </Button>
            <Button variant="outline" disabled={busy} onClick={discard}>Cancel preview</Button>
          </div>
        </div>
      )}
      {busy && <p role="status" className="text-meta">Working… a hosted transcription can take up to a few minutes.</p>}
      {error && <p role="alert" className="text-meta text-destructive">{error}</p>}
      {result && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="font-medium">{API_LABELS[result.provider]} result · as transcribed</p>
          <p className="whitespace-pre-wrap">{result.text}</p>
          <p className="text-meta">
            {result.wordCount} words · {result.fillerCount} filler candidates · word timings {result.wordTimings ? "returned (Estimated)" : `unavailable: ${result.wordTimingsUnavailableReason}`}
            {" · "}estimated cost {money(result.estimatedCostMicroUsd)}
            {result.providerRequestId ? ` · request ${result.providerRequestId}` : ""}
          </p>
          <p className="text-meta text-muted-foreground">Saved with this take as a separate transcript; it now shows under the take. Your local transcript and corrections are unchanged.</p>
        </div>
      )}
    </div>
  );
}

/**
 * Optional "Transcribe via API" on a saved take (3.15), shown only once a
 * provider key is stored in Settings and API mode is enabled. Opening it sends
 * nothing.
 */
export function TakeApiTranscribe({ attemptId }: { attemptId: string }) {
  const ipc = useIpc();
  const native = ipc.recordingMode === "native";
  const keys = useQuery({ queryKey: ["transcription-api-keys"], queryFn: () => ipc.getTranscriptionApiKeys(), enabled: native, retry: false });
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<AudioProvider | null>(null);
  const stored = keys.data?.filter((k) => k.present).map((k) => k.provider) ?? [];
  if (stored.length === 0) return null;
  const chosen = provider && stored.includes(provider) ? provider : stored[0];
  if (!open)
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Transcribe via API…
      </Button>
    );
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">Transcribe via API</p>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      <p className="text-meta text-muted-foreground">
        Sends this whole take to a hosted service after you review the preview. Your local transcript and corrections stay as they are.
      </p>
      {stored.length > 1 && (
        <fieldset className="flex flex-wrap gap-4 text-meta">
          <legend className="sr-only">Provider</legend>
          {stored.map((p) => (
            <label key={p} className="flex min-h-10 items-center gap-2">
              <input type="radio" name={`api-provider-${attemptId}`} checked={chosen === p} onChange={() => setProvider(p)} /> {API_LABELS[p]}
            </label>
          ))}
        </fieldset>
      )}
      <ApiRequestFlow attemptId={attemptId} provider={chosen} hasKey keyHint="" />
    </div>
  );
}
