import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatClock, UI_LOCALE } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import type { AudioPreview, AudioProvider, AudioResult } from "@/lib/ipc/schemas";

const LABELS: Record<AudioProvider, string> = { deepgram: "Deepgram Nova-3", assemblyai: "AssemblyAI Universal-3.5 Pro" };
const money = (micro: number) =>
  new Intl.NumberFormat(UI_LOCALE, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(micro / 1_000_000);

/** One provider's key: presence only, never echoed back (shared rule 5). */
function ProviderKey({ provider, present }: { provider: AudioProvider; present: boolean }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const id = `key-${provider}`;
  async function change(action: "store" | "remove") {
    const submitted = key;
    setKey("");
    setBusy(true);
    setMessage(null);
    try {
      if (action === "store") await ipc.storeTranscriptionApiKey(provider, submitted);
      else await ipc.removeTranscriptionApiKey(provider);
      await qc.invalidateQueries({ queryKey: ["transcription-api-keys"] });
      setMessage(action === "store" ? "Saved in Windows Credential Manager." : "Removed.");
    } catch {
      setMessage("Could not update Windows Credential Manager.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); void change("store"); }}>
      <Label htmlFor={id}>{LABELS[provider]} key · {present ? "stored, hidden" : "not stored"}</Label>
      <div className="flex flex-wrap gap-2">
        <Input id={id} type="password" autoComplete="off" spellCheck={false} className="max-w-xs" value={key} maxLength={2560} disabled={busy} onChange={(e) => setKey(e.target.value)} />
        <Button type="submit" variant="outline" disabled={busy || !key.trim()}>{present ? "Replace" : "Save"}</Button>
        <Button type="button" variant="ghost" disabled={busy || !present} onClick={() => void change("remove")}>Remove</Button>
      </div>
      {message && <p role="status" className="text-meta">{message}</p>}
    </form>
  );
}

/**
 * Optional API transcription test (M0 0.22): sends one saved take to the
 * chosen provider only after a full preview and an explicit Send. The result
 * is shown here for comparison; it does not replace your local transcript.
 */
export function ApiTranscriptionTest() {
  const ipc = useIpc();
  const qc = useQueryClient();
  const native = ipc.recordingMode === "native";
  const keys = useQuery({ queryKey: ["transcription-api-keys"], queryFn: () => ipc.getTranscriptionApiKeys(), enabled: native, retry: false });
  const takes = useQuery({ queryKey: ["recordings"], queryFn: () => ipc.listRecordings(), enabled: native });
  const usage = useQuery({ queryKey: ["api-usage"], queryFn: () => ipc.getApiUsageSummary(), enabled: native, retry: false });
  const [provider, setProvider] = useState<AudioProvider>("deepgram");
  const [take, setTake] = useState("");
  const [preview, setPreview] = useState<AudioPreview | null>(null);
  const previewRef = useRef<AudioPreview | null>(null);
  const [result, setResult] = useState<AudioResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = take || takes.data?.[0]?.assetId || "";
  const hasKey = !!keys.data?.find((k) => k.provider === provider)?.present;

  useEffect(() => () => { if (previewRef.current) void ipc.cancelApiTranscriptionPreview(previewRef.current.requestId); }, [ipc]);
  function discard() {
    if (previewRef.current) void ipc.cancelApiTranscriptionPreview(previewRef.current.requestId);
    previewRef.current = null;
    setPreview(null);
  }
  async function prepare() {
    discard();
    setBusy(true); setError(null); setResult(null);
    try {
      const next = await ipc.previewApiTranscription(selected, provider);
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
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "The request did not finish."} Prepare a new preview to try again.`);
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ["api-usage"] });
    }
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <h3 className="font-medium">API transcription test (optional)</h3>
      <p className="text-meta text-muted-foreground">
        Compares a hosted service with local Whisper on one of your saved takes. Nothing is sent until you review the preview and choose
        Send. The cost counts against the shared monthly limit, even while a provider's free credit covers it.
      </p>
      {!native && <p className="text-meta">Run the desktop app to store keys and send a test.</p>}
      {native && (
        <>
          <div className="space-y-3">
            {(["deepgram", "assemblyai"] as const).map((p) => (
              <ProviderKey key={p} provider={p} present={!!keys.data?.find((k) => k.provider === p)?.present} />
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="api-test-provider">Provider</Label>
              <Select value={provider} onValueChange={(v) => { discard(); setProvider(v as AudioProvider); }}>
                <SelectTrigger id="api-test-provider" className="h-10 w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["deepgram", "assemblyai"] as const).map((p) => <SelectItem key={p} value={p}>{LABELS[p]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="api-test-take">Saved take</Label>
              <Select value={selected} onValueChange={(v) => { discard(); setTake(v); }} disabled={!takes.data?.length}>
                <SelectTrigger id="api-test-take" className="h-10 w-64"><SelectValue placeholder="No saved takes yet" /></SelectTrigger>
                <SelectContent>
                  {takes.data?.map((t) => (
                    <SelectItem key={t.assetId} value={t.assetId}>
                      {t.title || "Untitled take"} · {formatClock(t.durationMs)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" disabled={busy || !selected} onClick={() => void prepare()}>Preview request</Button>
          </div>
        </>
      )}
      {preview && (
        <div className="space-y-2 rounded-lg border p-3" aria-label="API transcription request preview">
          <p className="font-medium">Recipient: {preview.providerLabel} · {preview.recipient} · {preview.model}</p>
          <p className="text-meta">
            Sends this take as prepared 16 kHz mono WAV: {formatClock(preview.durationMs)}, {(preview.bytes / 1024).toFixed(0)} KB, SHA-256{" "}
            <code>{preview.audioSha256.slice(0, 12)}…</code>
          </p>
          <p className="text-meta">
            Estimated charge: {money(preview.estimatedCostMicroUsd)} (list price checked {preview.priceDate}, billed per started minute).
            {usage.data && ` Remaining this month: ${money(usage.data.remainingMicroUsd)} of ${money(usage.data.stopMicroUsd)}.`}
          </p>
          <details className="text-meta">
            <summary>Exact settings sent with the audio</summary>
            <pre className="mt-1 whitespace-pre-wrap">{JSON.stringify(preview.settings, null, 2)}</pre>
            <p><a className="underline" href={preview.priceSource} target="_blank" rel="noreferrer">Price source</a></p>
          </details>
          <p className="text-meta text-muted-foreground">{preview.dataHandling}</p>
          {!hasKey && <p className="text-meta">Store your {LABELS[preview.provider]} key above before sending.</p>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !hasKey} onClick={() => void send()}>Send take · may be billed</Button>
            <Button variant="outline" disabled={busy} onClick={discard}>Cancel preview</Button>
          </div>
        </div>
      )}
      {busy && <p role="status" className="text-meta">Working… a hosted transcription can take up to a few minutes.</p>}
      {error && <p role="alert" className="text-meta text-destructive">{error}</p>}
      {result && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="font-medium">{LABELS[result.provider]} result · as transcribed</p>
          <p className="whitespace-pre-wrap">{result.text}</p>
          <p className="text-meta">
            {result.wordCount} words · {result.fillerCount} filler candidates · word timings {result.wordTimings ? "returned (Estimated)" : `unavailable: ${result.wordTimingsUnavailableReason}`}
            {" · "}estimated cost {money(result.estimatedCostMicroUsd)}
            {result.providerRequestId ? ` · request ${result.providerRequestId}` : ""}
          </p>
          <p className="text-meta text-muted-foreground">Saved on this computer for comparison. Your local transcript is unchanged.</p>
        </div>
      )}
    </div>
  );
}
