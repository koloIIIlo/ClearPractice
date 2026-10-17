import { useState } from "react";
import { ErrorState, LoadingBlock, Page, PageHeader } from "@/components/page";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDay } from "@/lib/format";
import { usePreferences } from "@/lib/ipc/queries";
import { achievementProgress, ACHIEVEMENTS, CATEGORY_TITLES, type AchievementCategory } from "@/lib/engagement/achievements";
import { cn } from "@/lib/utils";
import { useJourney } from "./useJourney";

type Filter = "all" | "unlocked" | "progress";

/**
 * Every achievement, none hidden (roadmap 9.6): unlocked ones with their date,
 * the others with progress, so they are goals as well as rewards.
 */
export function AchievementsPage() {
  const { journey, isPending, error, refetch } = useJourney();
  const { preferences } = usePreferences();
  const [filter, setFilter] = useState<Filter>("all");
  return (
    <Page className="max-w-[72rem]">
      <PageHeader title="Achievements" description="Firsts, habits, craft and courage. All are visible; none are hidden." />
      {isPending ? (
        <LoadingBlock rows={4} label="Loading achievements" />
      ) : error || !journey ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        (() => {
          const unlocked = new Map(journey.state.achievements.map((a) => [a.id, a.unlockedAt]));
          const input = { facts: journey.facts, state: journey.state, events: journey.events, ctx: journey.ctx, areas: journey.areas, prefs: preferences };
          const cards = ACHIEVEMENTS.map((def) => ({ def, at: unlocked.get(def.id) ?? null, progress: achievementProgress(def, input) })).filter(
            (c) => filter === "all" || (filter === "unlocked" ? c.at !== null : c.at === null),
          );
          const categories = [...new Set(cards.map((c) => c.def.category))] as AchievementCategory[];
          return (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-3">
                <span id="achievement-filter" className="text-meta text-muted-foreground">Show</span>
                <ToggleGroup type="single" variant="outline" aria-labelledby="achievement-filter" value={filter} onValueChange={(v) => v && setFilter(v as Filter)}>
                  <ToggleGroupItem value="all" className="h-9 px-3">All</ToggleGroupItem>
                  <ToggleGroupItem value="unlocked" className="h-9 px-3">Unlocked</ToggleGroupItem>
                  <ToggleGroupItem value="progress" className="h-9 px-3">In progress</ToggleGroupItem>
                </ToggleGroup>
                <span className="text-meta text-muted-foreground tabular-nums">{journey.state.achievements.length} of {ACHIEVEMENTS.length} unlocked</span>
              </div>
              {categories.length === 0 && <p className="text-muted-foreground">Nothing here yet.</p>}
              {categories.map((category) => (
                <section key={category} aria-labelledby={`cat-${category}`} className="space-y-2">
                  <h2 id={`cat-${category}`} className="font-semibold">{CATEGORY_TITLES[category]}</h2>
                  <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {cards.filter((c) => c.def.category === category).map(({ def, at, progress }) => (
                      <li key={def.id} className={cn("flex gap-3 rounded-panel border bg-card p-4", !at && "border-dashed bg-transparent")}>
                        <def.icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", at ? "text-primary" : "text-muted-foreground")} />
                        <div className="min-w-0">
                          <p className="font-medium">{def.title}</p>
                          <p className="text-meta text-muted-foreground">{def.description}</p>
                          <p className="mt-1 text-meta tabular-nums">{at ? `Unlocked ${formatDay(at.slice(0, 10))}` : `${progress.done} of ${progress.needed}`}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          );
        })()
      )}
    </Page>
  );
}
