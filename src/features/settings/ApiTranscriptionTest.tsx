import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatClock } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import type { AudioProvider } from "@/lib/ipc/schemas";
import { API_LABELS as LABELS, ApiRequestFlow } from "@/features/review/ApiTranscribe";


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
 * Optional API transcription test (M0 0.22): per-provider keys and the preview →
 * explicit Send flow (shared with the take-level option that stays off until
 * the enablement gate passes). The result is saved with the take as its own
 * transcript (3.16); local text and corrections stay.
 */
export function ApiTranscriptionTest() {
  const ipc = useIpc();
  const native = ipc.recordingMode === "native";
  const keys = useQuery({ queryKey: ["transcription-api-keys"], queryFn: () => ipc.getTranscriptionApiKeys(), enabled: native, retry: false });
  const takes = useQuery({ queryKey: ["recordings"], queryFn: () => ipc.listRecordings(), enabled: native });
  const [provider, setProvider] = useState<AudioProvider>("deepgram");
  const [take, setTake] = useState("");
  const selected = take || takes.data?.[0]?.assetId || "";
  const hasKey = !!keys.data?.find((k) => k.provider === provider)?.present;

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
              <Select value={provider} onValueChange={(v) => setProvider(v as AudioProvider)}>
                <SelectTrigger id="api-test-provider" className="h-10 w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["deepgram", "assemblyai"] as const).map((p) => <SelectItem key={p} value={p}>{LABELS[p]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="api-test-take">Saved take</Label>
              <Select value={selected} onValueChange={setTake} disabled={!takes.data?.length}>
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
          </div>
          <ApiRequestFlow attemptId={selected} provider={provider} hasKey={hasKey} keyHint={`Store your ${LABELS[provider]} key above before sending.`} />
        </>
      )}
    </div>
  );
}
