import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useIpc } from "@/lib/ipc";
import { formatBytes } from "./StorageUsage";

export function DatabaseHealth() {
  const ipc = useIpc();
  const qc = useQueryClient();
  const health = useQuery({ queryKey: ["database-health"], queryFn: () => ipc.getDatabaseHealth() });
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["database-health"] });
    await qc.invalidateQueries({ queryKey: ["storage-usage"] });
  };
  const compact = useMutation({ mutationFn: () => ipc.compactDatabase(), onSuccess: refresh });
  const dismiss = useMutation({ mutationFn: () => ipc.dismissDatabaseCompaction(), onSuccess: refresh });
  const error = health.error ?? compact.error ?? dismiss.error;
  if (health.error) return <p role="alert" className="text-destructive">{health.error.message}</p>;
  if (!health.data?.offerCompact) return null;
  const data = health.data;
  return <div className="space-y-3 rounded-md border p-4">
    <p>Compact the database</p>
    <p className="text-meta text-muted-foreground">Measured: {data.freePages} free pages of {data.pageCount} ({formatBytes(data.freePages * data.pageSize)} available to reclaim). This can take a little while. Finish recording first.</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={compact.isPending || dismiss.isPending} onClick={() => compact.mutate()}>Compact the database</Button>
      <Button variant="ghost" disabled={compact.isPending || dismiss.isPending} onClick={() => dismiss.mutate()}>Not this month</Button>
    </div>
    {error && <p role="alert" className="text-destructive">{error.message}</p>}
    {compact.isPending && <p role="status">Compacting the database…</p>}
  </div>;
}
