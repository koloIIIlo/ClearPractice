import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { formatClock, formatLongDay, UI_LOCALE } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import type { AudioPreview, AudioProvider, AudioResult } from "@/lib/ipc/schemas";

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
export function ApiRequestFlow({ attemptId, provider, hasKey, keyHint, previewFn, sendFn, sendLabel }: {
  attemptId: string;
  provider: AudioProvider;
  hasKey: boolean;
  keyHint: string;
  /** Other audio than a saved take (e.g. a recording being split, 4.4c). */
  previewFn?: (provider: AudioProvider) => Promise<AudioPreview>;
  /** Replaces the take request; its result is handled by the caller. */
  sendFn?: (requestId: string, payloadSha256: string) => Promise<void>;
  sendLabel?: string;
}) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const usage = useQuery({ queryKey: ["api-usage"], queryFn: () => ipc.getApiUsageSummary(), retry: false });
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<AudioPreview | null>(null);
  const previewRef = useRef<AudioPreview | null>(null);
  const [result, setResult] = useState<AudioResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
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
      const next = previewFn ? await previewFn(provider) : await ipc.previewApiTranscription(attemptId, provider);
      previewRef.current = next;
      setPreview(next);
      setAudioUrl(await ipc.getApiPreviewAudioUrl(next.requestId).catch(() => null));
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
    setBusy(true); setError(null); setSending(approved.requestId);
    try {
      if (sendFn) {
        await sendFn(approved.requestId, approved.payloadSha256);
      } else {
        setResult(await ipc.requestApiTranscription(approved.requestId, approved.payloadSha256));
        void qc.invalidateQueries({ queryKey: ["attempt-transcript", approved.attemptId] });
      }
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "The request did not finish."} Prepare a new preview to try again.`);
    } finally {
      setBusy(false);
      setSending(null);
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
          {audioUrl && (
            <audio controls preload="none" src={audioUrl} className="h-10 w-full max-w-md" aria-label="Listen to exactly the audio that Send uploads" />
          )}
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
              {preview.previousRunAt ? "Retranscribe · may be billed" : (sendLabel ?? "Send take · may be billed")}
            </Button>
            <Button variant="outline" disabled={busy} onClick={discard}>Cancel preview</Button>
          </div>
        </div>
      )}
      {busy && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-meta">Working… a hosted transcription can take up to a few minutes.</p>
          {sending && (
            <Button variant="outline" size="sm" onClick={() => void ipc.cancelApiTranscription(sending)}>
              Stop waiting
            </Button>
          )}
        </div>
      )}
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
 * Cloud transcription of one saved take (3.15), shown when the take's
 * Transcribe choice is Cloud. Nothing is sent until the user reviews the
 * preview and presses Send; the provider defaults to the one in Settings.
 */
export function CloudTranscribe({ attemptId, defaultProvider }: { attemptId: string; defaultProvider: AudioProvider }) {
  const ipc = useIpc();
  const keys = useQuery({ queryKey: ["transcription-api-keys"], queryFn: () => ipc.getTranscriptionApiKeys(), retry: false });
  const [provider, setProvider] = useState<AudioProvider | null>(null);
  if (keys.isPending) return <p role="status" className="text-meta text-muted-foreground">Checking stored API keys…</p>;
  const stored = keys.data?.filter((k) => k.present).map((k) => k.provider) ?? [];
  if (stored.length === 0)
    return (
      <p className="text-meta text-muted-foreground">
        Cloud transcription needs a Deepgram or AssemblyAI key.{" "}
        <Link className="underline" to="/settings/transcription">Store one in Settings → Transcription</Link>; it stays in Windows Credential Manager.
      </p>
    );
  const preferred = provider ?? defaultProvider;
  const chosen = stored.includes(preferred) ? preferred : stored[0];
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-meta text-muted-foreground">
        Sends this whole take to {API_LABELS[chosen]} after you review the preview. Your local transcript and corrections stay as they are.
      </p>
      {stored.length > 1 && (
        <fieldset className="flex flex-wrap gap-4 text-meta">
          <legend className="sr-only">Cloud provider</legend>
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
