import { Link, useSearchParams } from "react-router";
import { Star } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ErrorState, LoadingBlock, Page, PageHeader, Panel, SectionTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/format";
import { usePreferences } from "@/lib/ipc/queries";
import { ACHIEVEMENTS } from "@/lib/engagement/achievements";
import { areaDef } from "@/lib/engagement/skills";
import { AREA_IDS, type AreaId } from "@/lib/engagement/types";
import { themeFor } from "@/content/monthly-themes";
import { freshStartNote } from "@/lib/engagement/fresh-start";
import { usePracticeStyle } from "@/features/engagement/style";
import { AreaSheet } from "./AreaSheet";
import { Companion } from "./Companion";
import { QuestList } from "./QuestList";
import { RecordsList } from "./RecordsList";
import { BestMoments } from "@/features/confidence/BestMoments";
import { MissionCard } from "@/features/events/MissionCard";
import { SkillMap } from "./SkillMap";
import { useJourney } from "./useJourney";
import { WeekGoal } from "./WeekGoal";
import { CopyMyWeek } from "@/features/social/CopyMyWeek";

/**
 * The home of the game layer (roadmap 9.1, D-29): your week, the eight areas,
 * this week's quests, achievements, records and effort. Everything is earned
 * from practice and your own notes, never a grade of how you sound.
 */
export function JourneyPage() {
  const [params, setParams] = useSearchParams();
  const { preferences } = usePreferences();
  const { playful } = usePracticeStyle();
  const { journey, isPending, error, refetch } = useJourney();
  const requested = params.get("area");
  const area = requested && (AREA_IDS as readonly string[]).includes(requested) ? (requested as AreaId) : null;
  const openArea = (id: AreaId | null) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (id) next.set("area", id);
      else next.delete("area");
      return next;
    }, { replace: true });

  return (
    <Page className="max-w-[72rem]">
      <PageHeader title="Journey" description="Levels, effort points and achievements from your practice. They reward practising and never grade how your English sounds." actions={<CopyMyWeek />} />
      {!playful && (
        <p role="note" className="mb-4 rounded-panel border border-dashed px-4 py-3 text-meta text-muted-foreground">
          You're in Calm style. This page isn't in the sidebar. <Link className="text-primary underline underline-offset-2" to="/settings/practice">Practice style</Link>
        </p>
      )}
      {isPending ? (
        <LoadingBlock rows={4} label="Loading your journey" />
      ) : error || !journey ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="space-y-6">
          <Panel className="flex flex-wrap items-center gap-5">
            {preferences.companion && <Companion stage={journey.stage} size={120} />}
            <div className="min-w-0 flex-1 space-y-2">
              {journey.facts.takes.length === 0 ? (
                <p className="font-medium">Your journey starts with your first take. Each area below shows what to try first.</p>
              ) : (
                <WeekGoal days={journey.goal.days} goal={journey.goal.goal} weeksInARow={journey.goal.weeksInARow} xp={journey.xp.week} />
              )}
              <p className="text-meta text-muted-foreground tabular-nums">
                Lifetime {journey.xp.lifetime.toLocaleString("en-GB")} XP · {journey.practiceDays} practice {journey.practiceDays === 1 ? "day" : "days"}
              </p>
              {journey.next && (
                <p className="text-meta">
                  Next:{" "}
                  <button type="button" className="text-primary underline underline-offset-2 hover:no-underline" onClick={() => openArea(journey.next!.area)}>
                    {areaDef(journey.next.area).short} {journey.next.level.level} · {journey.next.level.name}
                  </button>
                </p>
              )}
              {(() => {
                const note = freshStartNote(journey.events, journey.today, preferences.weekStartsOn);
                return note ? <p className="text-meta text-muted-foreground">{note.text}</p> : null;
              })()}
            </div>
          </Panel>

          <section aria-labelledby="skill-map">
            <SectionTitle id="skill-map">Skill map</SectionTitle>
            <SkillMap areas={journey.areas} onOpen={openArea} />
          </section>

          <Panel>
            <SectionTitle>This week's quests</SectionTitle>
            <QuestList journey={journey} />
          </Panel>

          {/* The week's mission (14.1), the same row as on Today. */}
          <section aria-labelledby="journey-mission">
            <SectionTitle id="journey-mission">This week's mission</SectionTitle>
            <ul className="rounded-panel border bg-card">
              <MissionCard />
            </ul>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel>
              <SectionTitle action={<Button variant="ghost" size="sm" asChild><Link to="/journey/achievements">All achievements</Link></Button>}>Recent achievements</SectionTitle>
              {journey.state.achievements.length === 0 ? (
                <p className="text-meta text-muted-foreground">None yet. Your first take is the first one.</p>
              ) : (
                <ul className="space-y-1.5">
                  {[...journey.state.achievements].reverse().slice(0, 5).map((a) => {
                    const def = ACHIEVEMENTS.find((d) => d.id === a.id);
                    return (
                      <li key={a.id} className="flex items-center gap-2">
                        <Star aria-hidden className="size-4 text-primary" />
                        <span className="min-w-0 flex-1">{def?.title ?? a.id}</span>
                        <span className="text-meta text-muted-foreground">{formatDay(a.unlockedAt.slice(0, 10))}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
            <Panel>
              <SectionTitle>Personal records</SectionTitle>
              <RecordsList journey={journey} />
            </Panel>
          </div>

          {/* Your own best sentences of the week (12.5), the same as on Confidence. */}
          <Panel aria-labelledby="journey-moments">
            <SectionTitle id="journey-moments">Your best moments this week</SectionTitle>
            <BestMoments />
          </Panel>

          <Panel>
            <SectionTitle>Effort</SectionTitle>
            <p className="mb-2 text-meta text-muted-foreground">XP per week, last 12 weeks · Practice days this month: {journey.practiceDaysThisMonth}</p>
            <div className="h-48" aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={journey.xp.byWeek} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} accessibilityLayer={false} tabIndex={-1}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="week" tickFormatter={formatDay} stroke="var(--muted-foreground)" fontSize={13} minTickGap={16} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={13} width={40} allowDecimals={false} />
                  <Tooltip
                    labelFormatter={(d) => `Week of ${formatDay(String(d))}`}
                    formatter={(v) => [`${v} XP`, "Effort"]}
                    contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }}
                  />
                  <Bar dataKey="xp" fill="var(--chart-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="sr-only">
              <caption>XP per week</caption>
              <thead><tr><th scope="col">Week of</th><th scope="col">XP</th></tr></thead>
              <tbody>{journey.xp.byWeek.map((w) => <tr key={w.week}><td>{formatDay(w.week)}</td><td>{w.xp}</td></tr>)}</tbody>
            </table>
            <details className="mt-3 text-meta">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">How XP works</summary>
              <p className="mt-1">
                You earn XP for practising: 10 for a take, 5 more for each retake, 20 for finishing a session, 30 for a real conversation you note, and so on. XP measures effort
                only. It never measures how you sound. A typical session earns about 80.
              </p>
              <p className="mt-1 text-muted-foreground">
                {themeFor(journey.today).title} is this month's theme ({areaDef(themeFor(journey.today).area).title}); quests lean toward it.
              </p>
            </details>
          </Panel>
          <AreaSheet area={area} journey={journey} onClose={() => openArea(null)} />
        </div>
      )}
    </Page>
  );
}
