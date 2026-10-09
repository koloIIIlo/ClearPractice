import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useIpc } from "@/lib/ipc";

/**
 * Diagnostic report (6.7): prepared on this computer, shown in full, and saved
 * only to a file you choose. It holds versions, counts, states and sizes; no
 * recordings, transcripts, notes, paths, device names or keys. Nothing is sent.
 */
export function DiagnosticReport() {
  const ipc = useIpc();
  const build = useMutation({ mutationFn: () => ipc.buildDiagnostics() });
  const save = useMutation({ mutationFn: (text: string) => ipc.saveDiagnostics(text) });
  if (ipc.recordingMode !== "native") return <p className="text-meta text-muted-foreground">Diagnostic reports are made in the desktop app.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={build.isPending} onClick={() => { save.reset(); build.mutate(); }}>
          {build.data ? "Prepare again" : "Prepare a diagnostic report"}
        </Button>
        {build.data && <Button disabled={save.isPending} onClick={() => save.mutate(build.data)}>Save to a file…</Button>}
      </div>
      {build.data && (
        <>
          <p className="text-meta text-muted-foreground">This is the whole report. It stays on this computer unless you share the file yourself.</p>
          <pre aria-label="Diagnostic report" className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 text-meta whitespace-pre-wrap">{build.data}</pre>
        </>
      )}
      {save.data && <p role="status" className="text-meta">Saved as {save.data}.</p>}
      {(build.error ?? save.error) && <p role="alert" className="text-meta text-destructive">{(build.error ?? save.error)!.message}</p>}
    </div>
  );
}
