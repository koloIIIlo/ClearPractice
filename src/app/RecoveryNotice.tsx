import { Link, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useIpc } from "@/lib/ipc";

/**
 * After a crash or power loss (6.3): interrupted takes are announced on every
 * screen until you recover or discard them on Today, so they are never missed.
 * Nothing is recovered or deleted without your choice.
 */
export function RecoveryNotice() {
  const ipc = useIpc();
  const { pathname } = useLocation();
  const native = ipc.recordingMode === "native";
  const interrupted = useQuery({ queryKey: ["recording-recovery"], queryFn: () => ipc.listRecoverableRecordings(), enabled: native });
  const count = interrupted.data?.length ?? 0;
  if (!native || count === 0) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 border-b bg-secondary/60 px-4 py-2 text-meta">
      <AlertTriangle aria-hidden className="size-4 shrink-0" />
      <span>
        {count === 1 ? "One take was interrupted before it finished saving." : `${count} takes were interrupted before they finished saving.`} The completed audio can be recovered.
      </span>
      {pathname === "/" ? (
        <span className="text-muted-foreground">Recover or discard {count === 1 ? "it" : "them"} under Your recordings below.</span>
      ) : (
        <Link className="font-medium underline" to="/">Recover or discard on Today</Link>
      )}
    </div>
  );
}
