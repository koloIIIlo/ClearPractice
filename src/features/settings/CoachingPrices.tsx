import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePreferences } from "@/lib/ipc/queries";
import { toLocalDate } from "@/lib/phrase-schedule";
import { BUILT_IN_PRICE_DATE, COACHING_MODELS } from "./CoachingSpike";

const valid = (p: string) => /^\d{1,4}(\.\d{1,6})?$/.test(p) && Number(p) > 0 && Number(p) <= 1000;

/**
 * Coaching prices (5.9): the built-in prices were checked on OpenAI's model
 * pages; if they change, enter the new ones here with today's date. Previews
 * and the shared budget then use your prices. An invalid price is never used.
 */
export function CoachingPrices() {
  const { preferences, update } = usePreferences();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ input: "", output: "" });
  return (
    <div className="space-y-2">
      <h3 className="font-medium">Prices per million tokens</h3>
      <table className="w-full text-left text-meta">
        <thead className="text-muted-foreground">
          <tr><th scope="col" className="py-1 font-medium">Model</th><th scope="col" className="py-1 font-medium">Input / output (USD)</th><th scope="col" className="py-1 font-medium">Checked</th><th scope="col" className="py-1"><span className="sr-only">Actions</span></th></tr>
        </thead>
        <tbody className="divide-y">
          {COACHING_MODELS.map((m) => {
            const own = preferences.coachingPrices[m.id];
            const price = own ?? { input: m.input, output: m.output, checkedOn: BUILT_IN_PRICE_DATE };
            const isEditing = editing === m.id;
            return (
              <tr key={m.id}>
                <th scope="row" className="py-2 pr-3 font-normal">{m.label}</th>
                <td className="py-2 pr-3 tabular-nums">
                  {isEditing ? (
                    <span className="flex items-center gap-1">
                      <Input aria-label={`${m.label} input price`} inputMode="decimal" className="h-9 w-20" value={draft.input} onChange={(e) => setDraft((d) => ({ ...d, input: e.target.value.trim() }))} />
                      <span>/</span>
                      <Input aria-label={`${m.label} output price`} inputMode="decimal" className="h-9 w-20" value={draft.output} onChange={(e) => setDraft((d) => ({ ...d, output: e.target.value.trim() }))} />
                    </span>
                  ) : `$${price.input} / $${price.output}`}
                </td>
                <td className="py-2 pr-3 text-muted-foreground">{own ? `${price.checkedOn} · entered by you` : `${price.checkedOn} · built in`}</td>
                <td className="py-2 text-right whitespace-nowrap">
                  {isEditing ? (
                    <>
                      <Button size="sm" disabled={!valid(draft.input) || !valid(draft.output)}
                        onClick={() => { update({ coachingPrices: { ...preferences.coachingPrices, [m.id]: { ...draft, checkedOn: toLocalDate(new Date()) } } }); setEditing(null); }}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="ghost" aria-label={`Edit the ${m.label} price`} onClick={() => { setDraft({ input: price.input, output: price.output }); setEditing(m.id); }}>Edit</Button>
                      {own && (
                        <Button size="sm" variant="ghost" aria-label={`Use the built-in ${m.label} price`}
                          onClick={() => { const { [m.id]: _drop, ...rest } = preferences.coachingPrices; update({ coachingPrices: rest }); }}>Reset</Button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-meta text-muted-foreground">If OpenAI changes a price, enter the new one; it is dated today. Requests reserve at the higher of the two prices, so the budget never undercounts.</p>
    </div>
  );
}
