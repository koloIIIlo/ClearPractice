import { useEffect, useState } from "react";
import { useIpc } from "@/lib/ipc";
import type { ClubLightState } from "@/lib/ipc/schemas";
import { clubClock } from "@/lib/social/club";

/** The word and the colour always travel together; no flashing or animation. */
export function TimingLight({ state }: { state: ClubLightState }) {
  return (
    <div className="flex w-full flex-col items-center gap-6 text-center">
      {/* Before the minimum there is no light: a quiet placeholder, not a shout. */}
      <div role="status" aria-label="Timing light"
        className={state.light ? "flex min-h-48 w-full items-center justify-center rounded-panel border p-8 text-[clamp(1.5rem,7vw,6rem)] font-bold" : "flex min-h-48 w-full items-center justify-center rounded-panel border border-dashed p-8 text-[clamp(1.25rem,3vw,2rem)] text-muted-foreground"}
        style={state.light ? { backgroundColor: `var(--cp-light-${state.light})`, color: "var(--cp-app-bg)" } : undefined}>
        {state.light?.toUpperCase() ?? "No light yet"}
      </div>
      <p aria-label="Elapsed time" className="text-[clamp(2rem,10vw,6rem)] font-semibold tabular-nums">{clubClock(state.elapsedMs)}</p>
    </div>
  );
}

export function ClubLight() {
  const ipc = useIpc();
  const [state, setState] = useState<ClubLightState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    void ipc.onClubLight((next) => { if (!disposed) setState(next); }).then((remove) => {
      if (disposed) remove(); else off = remove;
    }).catch(() => { if (!disposed) setError("The timing light could not connect. Reopen this window to try again."); });
    return () => { disposed = true; off?.(); };
  }, [ipc]);
  return <main className="flex min-h-dvh items-center justify-center bg-background p-8 text-foreground">
    <h1 className="sr-only">Club timing light</h1>
    {error ? <p role="alert">{error}</p> : state ? <TimingLight state={state} /> : <p role="status" className="text-3xl">Waiting for the timer…</p>}
  </main>;
}
