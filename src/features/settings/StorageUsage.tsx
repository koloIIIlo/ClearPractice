import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useIpc } from "@/lib/ipc";

export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`;

/**
 * Storage by category (6.6). Clear cache removes only what the app rebuilds
 * by itself; recordings, clips, imports, the database and saved provider
 * results are never touched.
 */
export function StorageUsage() {
  const ipc = useIpc();
  const qc = useQueryClient();
  const native = ipc.recordingMode === "native";
  const usage = useQuery({ queryKey: ["storage-usage"], queryFn: () => ipc.getStorageUsage(), enabled: native, retry: false });
  const [confirm, setConfirm] = useState(false);
  const clear = useMutation({
    mutationFn: () => ipc.clearCache(),
    onSuccess: () => { setConfirm(false); void qc.invalidateQueries({ queryKey: ["storage-usage"] }); },
  });
  if (!native) return <p className="text-meta text-muted-foreground">Storage is measured in the desktop app.</p>;
  if (usage.isPending) return <p role="status" className="text-meta text-muted-foreground">Measuring…</p>;
  if (usage.error) return <p role="alert" className="text-meta text-destructive">{usage.error.message}</p>;
  const list = usage.data;
  const total = list.reduce((n, c) => n + c.bytes, 0);
  const cache = list.find((c) => c.clearable);
  return (
    <div className="space-y-3">
      <table className="w-full text-left">
        <caption className="sr-only">Storage by category</caption>
        <tbody className="divide-y">
          {list.map((c) => (
            <tr key={c.key}>
              <th scope="row" className="py-2 pr-4 font-normal">
                <span className="block">{c.label}</span>
                <span className="block text-meta text-muted-foreground">{c.note}</span>
              </th>
              <td className="py-2 text-right tabular-nums whitespace-nowrap">{formatBytes(c.bytes)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="py-2 pr-4 font-medium">Total</th>
            <td className="py-2 text-right font-medium tabular-nums">{formatBytes(total)}</td>
          </tr>
        </tbody>
      </table>
      {cache && (
        <div className="flex flex-wrap items-center gap-2">
          {!confirm ? (
            <Button variant="outline" disabled={cache.bytes === 0} onClick={() => setConfirm(true)}>Clear cache…</Button>
          ) : (
            <>
              <span className="text-meta">Remove {formatBytes(cache.bytes)} of rebuildable files? Recordings and everything you saved stay.</span>
              <Button variant="destructive" size="sm" disabled={clear.isPending} onClick={() => clear.mutate()}>Clear cache</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Keep</Button>
            </>
          )}
          {clear.data !== undefined && !confirm && <p role="status" className="text-meta text-muted-foreground">Freed {formatBytes(clear.data)}.</p>}
          {clear.error && <p role="alert" className="text-meta text-destructive">{clear.error.message}</p>}
        </div>
      )}
    </div>
  );
}
