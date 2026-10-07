import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIpc } from "@/lib/ipc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Keep secrets out of query/mutation caches and persisted browser state. */
export function ApiCredentialSettings() {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const native = ipc.recordingMode === "native";
  const status = useQuery({ queryKey: ["api-key-status"], queryFn: () => ipc.getApiKeyStatus(), enabled: native, retry: false });
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function change(action: "store" | "remove") {
    if (pending) return;
    setPending(true);
    setError(null);
    setMessage(null);
    const submitted = key;
    setKey("");
    try {
      await queryClient.cancelQueries({ queryKey: ["api-key-status"] });
      const next = action === "store" ? await ipc.storeApiKey(submitted) : await ipc.removeApiKey();
      queryClient.setQueryData(["api-key-status"], next);
      setMessage(next.present ? "API key saved in Windows Credential Manager." : "API key removed.");
    } catch {
      // A provider key must never be echoed by a raw transport error.
      setError("Could not update Windows Credential Manager. Try again after checking your Windows sign-in.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-meta text-muted-foreground">OpenAI keys are stored in Windows Credential Manager. Saving a key does not send a request.</p>
      {!native && <p className="text-meta text-muted-foreground">Open the desktop app to manage API keys.</p>}
      {native && status.isPending && <p role="status" className="text-meta">Checking stored key…</p>}
      {status.error && <p role="alert" className="text-meta text-destructive">Could not check Windows Credential Manager.</p>}
      {status.data && <p className="text-meta">{status.data.present ? "Key stored · hidden" : "No key stored"}</p>}
      <form onSubmit={(event) => { event.preventDefault(); void change("store"); }} className="space-y-2">
        <Label htmlFor="openai-key">{status.data?.present ? "Replacement API key" : "API key"}</Label>
        <Input id="openai-key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(event) => setKey(event.target.value)} disabled={!native || pending} maxLength={2560} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline" disabled={!native || pending || !key.trim()}>{pending ? "Updating…" : status.data?.present ? "Replace key" : "Save key"}</Button>
          <Button type="button" variant="outline" disabled={!native || pending || !status.data?.present} onClick={() => { void change("remove"); }}>Remove key</Button>
        </div>
      </form>
      {error && <p role="alert" className="text-meta text-destructive">{error}</p>}
      {message && <p role="status" className="text-meta">{message}</p>}
    </div>
  );
}
