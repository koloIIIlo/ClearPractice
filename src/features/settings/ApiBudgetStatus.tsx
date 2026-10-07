import { useQuery } from "@tanstack/react-query";
import { useIpc } from "@/lib/ipc";
import { UI_LOCALE } from "@/lib/format";

const money = (micro: number) => new Intl.NumberFormat(UI_LOCALE, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(micro / 1_000_000);

export function ApiBudgetStatus() {
  const ipc = useIpc();
  const native = ipc.recordingMode === "native";
  const usage = useQuery({ queryKey: ["api-usage"], queryFn: () => ipc.getApiUsageSummary(), enabled: native, retry: false });
  if (!native) return null;
  if (usage.isPending) return <p role="status" className="text-meta">Checking tracked API usage…</p>;
  if (usage.error) return <p role="alert" className="text-meta text-destructive">API usage is unavailable. Check the app's accounting before sending a request.</p>;
  const value = usage.data;
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <h3 className="font-medium">Shared transcription and coaching budget</h3>
      <p className="text-meta text-muted-foreground">Estimated · {value.month} (UTC) · This app's tracked requests. Your provider's account usage is separate.</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-meta">
        <dt>Coaching</dt><dd>{money(value.coachingMicroUsd)}</dd>
        <dt>Transcription</dt><dd>{money(value.transcriptionMicroUsd)}</dd>
        <dt>Counted total, including reservations</dt><dd>{money(value.countedMicroUsd)}</dd>
        <dt>Remaining within {money(value.stopMicroUsd)} stop limit</dt><dd>{money(value.remainingMicroUsd)}</dd>
      </dl>
      {value.uncertainMicroUsd > 0 && <p className="text-meta">{money(value.uncertainMicroUsd)} has an uncertain charge and stays counted.</p>}
      {value.warning && <p role="status" className="text-meta">The {money(value.warningMicroUsd)} warning threshold has been reached.</p>}
    </div>
  );
}
