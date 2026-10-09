import { useQuery } from "@tanstack/react-query";
import { useIpc } from "@/lib/ipc";

const LABELS: Record<string, string> = {
  startup: "Start-up (app start to first screen)",
  recordResponse: "Record response (press to microphone running)",
  search: "Search",
};
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n} ms`);

/** Performance on this computer during this run (6.5), against the release targets. */
export function Performance() {
  const ipc = useIpc();
  const timings = useQuery({ queryKey: ["timings"], queryFn: () => ipc.getTimings(), enabled: ipc.recordingMode === "native", refetchInterval: 5000 });
  if (ipc.recordingMode !== "native") return <p className="text-meta text-muted-foreground">Measured in the desktop app.</p>;
  const data = timings.data ?? {};
  return (
    <table className="w-full text-left text-meta">
      <caption className="sr-only">Performance this run</caption>
      <thead className="text-muted-foreground">
        <tr><th scope="col" className="py-1 font-medium">Measure</th><th scope="col" className="py-1 text-right font-medium">Latest</th><th scope="col" className="py-1 text-right font-medium">Best / worst</th><th scope="col" className="py-1 text-right font-medium">Target</th></tr>
      </thead>
      <tbody className="divide-y">
        {Object.entries(LABELS).map(([key, label]) => {
          const m = data[key];
          return (
            <tr key={key}>
              <th scope="row" className="py-2 pr-3 font-normal">{label}</th>
              <td className="py-2 text-right tabular-nums">{m ? <span className={m.latestMs > m.targetMs ? "font-medium text-destructive" : undefined}>{ms(m.latestMs)}</span> : "Not measured yet"}</td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">{m ? `${ms(m.bestMs)} / ${ms(m.worstMs)} (${m.count}×)` : "—"}</td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">{m ? `< ${ms(m.targetMs)}` : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
