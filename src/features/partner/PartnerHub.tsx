import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Check, CircleSlash, MessagesSquare } from "lucide-react";
import { ErrorState, LoadingBlock, Page, PageHeader, Panel, SectionTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import type { BossId } from "@/content/bosses";
import { BOSS_PARTNERS, SCENARIOS, scenarioById, type Scenario } from "@/content/scenarios";
import { areaDef } from "@/lib/engagement/skills";
import { formatClock, formatDay } from "@/lib/format";
import { useConversations } from "@/lib/ipc/queries";
import { MODE_LABELS, usePartnerModes } from "./modes";
import { pressureDef } from "./pressure";
import { StartDialog, type StartPreset } from "./StartDialog";

function ModeChip({ label, available, reason }: { label: string; available: boolean; reason: string | null }) {
  const Icon = available ? Check : CircleSlash;
  return (
    <li className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-meta" title={reason ?? undefined}>
      <Icon aria-hidden className={available ? "size-3.5 text-primary" : "size-3.5 text-muted-foreground"} />
      <span className={available ? undefined : "text-muted-foreground"}>{label}</span>
      <span className="sr-only">{available ? ", available" : `, not available: ${reason}`}</span>
    </li>
  );
}

/**
 * The practice partner's hub (roadmap 13.3): scenarios to start, your recent
 * conversations, and which modes are ready. A boss played with the partner
 * (13.6) arrives as /partner?boss=… and opens its start dialog; an event's mock
 * (14.2) arrives as /partner?scenario=….
 */
export function PartnerHubPage() {
  const [search, setSearch] = useSearchParams();
  const modes = usePartnerModes();
  const conversations = useConversations();
  const [starting, setStarting] = useState<{ scenario: Scenario; preset?: StartPreset } | null>(null);
  const bossId = search.get("boss");
  const scenarioId = search.get("scenario");
  useEffect(() => {
    if (!bossId && !scenarioId) return;
    const mapping = bossId ? BOSS_PARTNERS[bossId as BossId] : undefined;
    const scenario = mapping ? scenarioById(mapping.scenarioId) : scenarioId ? scenarioById(scenarioId) : undefined;
    if (mapping && scenario) setStarting({ scenario, preset: { persona: mapping.persona, pressure: mapping.pressure, guidance: mapping.guidance, bossId: bossId! } });
    else if (scenario) setStarting({ scenario });
    setSearch(
      (s) => {
        s.delete("boss");
        s.delete("scenario");
        return s;
      },
      { replace: true },
    );
  }, [bossId, scenarioId, setSearch]);

  return (
    <Page>
      <PageHeader
        title="Partner"
        description="Practise conversations. Your turns are recorded and transcribed on this computer; only the text of your answers is sent, and only when you press Send."
      />
      <div className="space-y-6">
        <section aria-label="Modes" className="flex flex-wrap items-center gap-2">
          <span className="text-meta text-muted-foreground">Who can play the partner:</span>
          <ul className="flex flex-wrap gap-2">
            <ModeChip label={`${MODE_LABELS.api} · ${modes.preferences.coachingModel}`} available={modes.api} reason={modes.apiReason} />
            <ModeChip label={MODE_LABELS.local} available={modes.local} reason={modes.localReason} />
            <ModeChip label={MODE_LABELS.scripted} available reason={null} />
          </ul>
          {(!modes.api || !modes.local) && (
            <Link className="text-meta underline underline-offset-2" to="/settings/coaching">
              Coaching settings
            </Link>
          )}
        </section>

        <section aria-labelledby="scenarios-heading">
          <SectionTitle id="scenarios-heading">Scenarios</SectionTitle>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SCENARIOS.map((s) => (
              <li key={s.id}>
                <Panel className="flex h-full flex-col gap-2 p-4">
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="text-meta text-muted-foreground">{s.partnerRole}</p>
                  <p className="flex-1 text-meta">{s.summary}</p>
                  <p className="text-meta text-muted-foreground">
                    {s.maxTurns} turns · {areaDef(s.area).short}
                  </p>
                  <div>
                    <Button size="sm" onClick={() => setStarting({ scenario: s })} aria-label={`Start ${s.title}`}>
                      Start
                    </Button>
                  </div>
                </Panel>
              </li>
            ))}
          </ul>
        </section>

        <Panel aria-labelledby="recent-heading">
          <SectionTitle id="recent-heading">Recent conversations</SectionTitle>
          {conversations.error ? (
            <ErrorState error={conversations.error} onRetry={() => void conversations.refetch()} />
          ) : !conversations.data ? (
            <LoadingBlock rows={2} label="Loading your conversations" />
          ) : conversations.data.length === 0 ? (
            <p className="text-muted-foreground">
              <MessagesSquare aria-hidden className="mr-1 inline size-4" /> Your conversations appear here. Scripted mode is a good first try: it works offline.
            </p>
          ) : (
            <ul className="divide-y" aria-label="Recent conversations">
              {conversations.data.slice(0, 20).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{c.title}</span>
                    <span className="text-meta text-muted-foreground">
                      {" · "}
                      {formatDay(c.localDate)} · {c.learnerTurns} {c.learnerTurns === 1 ? "turn" : "turns"}
                      {c.speakingMs > 0 && ` · ${formatClock(c.speakingMs)} speaking`} · {MODE_LABELS[c.mode]} · pressure {c.pressure} ({pressureDef(c.pressure).name})
                    </span>
                  </span>
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/partner/${c.id}`} aria-label={`${c.status === "active" ? "Continue" : "Open"} ${c.title}, ${formatDay(c.localDate)}`}>
                      {c.status === "active" ? "Continue" : "Open"}
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {starting && <StartDialog scenario={starting.scenario} preset={starting.preset} onClose={() => setStarting(null)} />}
    </Page>
  );
}
