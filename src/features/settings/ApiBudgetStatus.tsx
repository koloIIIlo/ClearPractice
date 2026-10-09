import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useIpc } from "@/lib/ipc";
import { usePreferences } from "@/lib/ipc/queries";
import { UI_LOCALE } from "@/lib/format";

const money = (micro: number) => new Intl.NumberFormat(UI_LOCALE, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(micro / 1_000_000);
const WARNINGS = [500_000, 1_000_000, 2_000_000, 3_000_000, 4_000_000, 4_500_000];

/**
 * One shared monthly budget for transcription and coaching (3.17, 5.9, D-22).
 * Billed (settled from reported usage), still open (reserved or on their way)
 * and uncertain (sent, no usage reported) are shown apart; unknown is never 0.
 * The warning level is yours; the USD 5 stop is fixed.
 */
export function ApiBudgetStatus() {
  const ipc = useIpc();
  const native = ipc.recordingMode === "native";
  const { preferences, update } = usePreferences();
  const usage = useQuery({ queryKey: ["api-usage"], queryFn: () => ipc.getApiUsageSummary(), enabled: native, retry: false });
  if (!native) return null;
  if (usage.isPending) return <p role="status" className="text-meta">Checking tracked API usage…</p>;
  if (usage.error) return <p role="alert" className="text-meta text-destructive">API usage is unavailable. Check the app's accounting before sending a request.</p>;
  const value = usage.data;
  const warning = preferences.budgetWarningMicroUsd;
  const warn = value.countedMicroUsd >= warning;
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <h3 className="font-medium">Shared transcription and coaching budget</h3>
      <p className="text-meta text-muted-foreground">Estimated · {value.month} (UTC) · This app's tracked requests. Your provider's account usage is separate.</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-meta">
        <dt>Coaching</dt><dd className="text-right tabular-nums">{money(value.coachingMicroUsd)}</dd>
        <dt>Transcription</dt><dd className="text-right tabular-nums">{money(value.transcriptionMicroUsd)}</dd>
        <dt className="border-t pt-1 text-muted-foreground">Billed, from reported usage</dt><dd className="border-t pt-1 text-right tabular-nums">{money(value.settledMicroUsd)}</dd>
        <dt className="text-muted-foreground">Still open (being prepared or sent)</dt><dd className="text-right tabular-nums">{money(value.reservedMicroUsd)}</dd>
        <dt className="text-muted-foreground">Uncertain (sent, no usage reported; kept counted)</dt><dd className="text-right tabular-nums">{money(value.uncertainMicroUsd)}</dd>
        <dt className="border-t pt-1 font-medium">Counted total</dt><dd className="border-t pt-1 text-right font-medium tabular-nums">{money(value.countedMicroUsd)}</dd>
        <dt>Remaining within {money(value.stopMicroUsd)} stop limit</dt><dd className="text-right tabular-nums">{money(value.remainingMicroUsd)}</dd>
      </dl>
      {value.uncertainMicroUsd > 0 && <p className="text-meta">{money(value.uncertainMicroUsd)} has an uncertain charge and stays counted.</p>}
      <div className="flex flex-wrap items-center gap-2 text-meta">
        <Label htmlFor="budget-warning" className="font-normal">Warn me at</Label>
        <NativeSelect id="budget-warning" compact value={warning} onChange={(e) => update({ budgetWarningMicroUsd: Number(e.target.value) })}>
          {[...new Set([...WARNINGS, warning])].sort((a, b) => a - b).map((w) => <option key={w} value={w}>{money(w)}</option>)}
        </NativeSelect>
        <span className="text-muted-foreground">a month. New requests stop at {money(value.stopMicroUsd)}.</span>
      </div>
      {warn && <p role="status" className="text-meta">The {money(warning)} warning threshold has been reached.</p>}
    </div>
  );
}
