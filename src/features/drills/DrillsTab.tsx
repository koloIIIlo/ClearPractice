import { useId, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Layers, Play, Shuffle } from "lucide-react";
import { startMixedSet } from "@/features/learning/sprint";
import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DRILLS, type DrillDef } from "@/content/drills";
import { addLocalDays } from "@/lib/phrase-schedule";
import { formatDay } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import { keys, usePracticeFacts, usePreferences, useServiceStatus } from "@/lib/ipc/queries";
import type { PracticeFacts } from "@/lib/ipc/schemas";
import { toLocalDate } from "@/lib/phrase-schedule";
import { seededRandom } from "@/lib/engagement/random";
import { drillPlays } from "@/lib/engagement/drills";
import { areaDef } from "@/lib/engagement/skills";
import type { AreaId } from "@/lib/engagement/types";
import { recommendation } from "@/lib/engagement/unlocks";
import { weekStart } from "@/lib/engagement/weekly";
import { usePracticeStyle } from "@/features/engagement/style";
import { dailyFor } from "./daily";

/**
 * Exercises → Drills (roadmap 10.14): today's daily, a filter by area, a
 * random drill and one card per drill. Playful style adds your best and the
 * level a drill is recommended after; nothing is ever locked.
 */
const FILTERS: readonly { id: AreaId; label: string }[] = [
  { id: "fluency", label: "Fluency" },
  { id: "spontaneity", label: "Spontaneity" },
  { id: "voice", label: "Voice" },
  { id: "storytelling", label: "Stories" },
  { id: "structure", label: "Structure" },
  { id: "vocabulary", label: "Vocabulary" },
  { id: "courage", label: "Courage" },
];
const LATELY_DAYS = 14;

/** A drill's best so far, for its card (Playful style). */
const BESTS: Partial<Record<DrillDef["type"], { key: string; format: (v: number) => string }>> = {
  jam: { key: "cleanSeconds", format: (v) => `Best: ${v} clean seconds` },
  word_bomb: { key: "woven", format: (v) => `Best: ${v} words woven in` },
  emphasis: { key: "estimatedHits", format: (v) => `Best: ${v} sentences on the beat` },
  pace_ladder: { key: "range", format: (v) => `Widest range: ${v.toFixed(1)} syllables a second` },
  gauntlet: { key: "roundsCompleted", format: (v) => `Best: ${v} rounds in one go` },
};

export type DrillStats = { plays: number; best: number | null; lastPlayed: string | null };

export function drillStats(facts: PracticeFacts | undefined, drill: DrillDef): DrillStats {
  if (!facts) return { plays: 0, best: null, lastPlayed: null };
  const plays = drillPlays(facts, drill.type);
  const key = BESTS[drill.type]?.key;
  const values = key ? plays.map((p) => p.result[key]).filter((v): v is number => v !== undefined) : [];
  return { plays: plays.length, best: values.length ? Math.max(...values) : null, lastPlayed: plays.map((p) => p.session.localDate).sort().at(-1) ?? null };
}

/** A drill not played in the last two weeks if there is one, chosen by the time of day. */
export function randomDrill(facts: PracticeFacts | undefined, today: string, seed: string): DrillDef {
  const since = addLocalDays(today, -LATELY_DAYS);
  const fresh = DRILLS.filter((d) => {
    const last = drillStats(facts, d).lastPlayed;
    return !last || last <= since;
  });
  const pool = fresh.length > 0 ? fresh : DRILLS;
  return pool[Math.floor(seededRandom(seed)() * pool.length) % pool.length];
}

function useLevels() {
  const ipc = useIpc();
  const { preferences } = usePreferences();
  const week = weekStart(toLocalDate(new Date()), preferences.weekStartsOn);
  const state = useQuery({ queryKey: keys.engagementState(week), queryFn: () => ipc.getEngagementState(week) });
  return useMemo(() => {
    const current = new Map<string, number>();
    for (const l of state.data?.levels ?? []) current.set(l.area, Math.max(current.get(l.area) ?? 0, l.level));
    return [...current].map(([area, c]) => ({ area: area as AreaId, current: c as 0 | 1 | 2 | 3 | 4 | 5, levels: [], next: null }));
  }, [state.data]);
}

function DailyCard({ facts, today }: { facts: PracticeFacts | undefined; today: string }) {
  const { number, prompt } = dailyFor(today);
  const titleId = useId();
  const played = new Set((facts?.sessions ?? []).filter((s) => s.exerciseType === "daily" && s.takeCount > 0).map((s) => s.localDate));
  const days = Array.from({ length: 30 }, (_, i) => addLocalDays(today, i - 29));
  return (
    <Panel aria-labelledby={titleId} className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} className="text-meta font-medium text-muted-foreground">
            Today's daily · #{number}
          </h2>
          <p className="text-lg font-semibold text-balance">{prompt.text}</p>
          <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
            {played.has(today) ? (
              <>
                <Check aria-hidden className="size-4 text-primary" /> Done today. More takes count as practice.
              </>
            ) : (
              "One official try a day. Think for 10 seconds, then speak for a minute."
            )}
          </p>
        </div>
        <Button asChild>
          <Link to="/drill/daily">
            <Play aria-hidden /> {played.has(today) ? "Open" : "Play"}
          </Link>
        </Button>
      </div>
      {/* The last 30 days, done or not. No streak to keep. */}
      <ol className="flex flex-wrap gap-1" aria-label="Daily prompts in the last 30 days">
        {days.map((d) => (
          <li key={d}>
            <span aria-hidden className={played.has(d) ? "block size-3 rounded-sm bg-primary" : "block size-3 rounded-sm border border-muted-foreground/50"} />
            <span className="sr-only">
              {formatDay(d)}: {played.has(d) ? "played" : "not played"}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function DrillCard({ drill, stats, playful, rec, transcriptionMissing }: { drill: DrillDef; stats: DrillStats; playful: boolean; rec: ReturnType<typeof recommendation>; transcriptionMissing: boolean }) {
  const Icon = drill.icon;
  const best = BESTS[drill.type];
  return (
    <li className="flex flex-col rounded-panel border bg-card p-5">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
          <Icon className="size-5" />
        </span>
        <h3 className="min-w-0 flex-1 text-lg font-semibold">{drill.title}</h3>
        <span className="text-meta text-muted-foreground tabular-nums">~{drill.minutes} min</span>
      </div>
      <p className="mt-1 text-meta text-muted-foreground">{drill.areas.map((a) => areaDef(a).short).join(" · ")}</p>
      <p className="mt-1">{drill.tagline}</p>
      <div className="mt-2 space-y-1 text-meta text-muted-foreground">
        {playful && best && stats.best !== null ? <p>{best.format(stats.best)}</p> : stats.plays > 0 ? <p>Played {stats.plays} {stats.plays === 1 ? "time" : "times"}</p> : <p>Not played yet</p>}
        {playful && rec && !rec.met && <p>Recommended after {areaDef(rec.area).short} {rec.level}. You can play it now.</p>}
        {drill.needsTranscript && transcriptionMissing && (
          <p>
            Full result needs local transcription. <Link className="text-primary underline underline-offset-2" to="/settings/transcription">Set it up</Link>
          </p>
        )}
      </div>
      <div className="mt-auto pt-4">
        <Button variant="outline" asChild>
          <Link to={`/drill/${drill.id}`} aria-label={`Play ${drill.title}`}>
            <Play aria-hidden /> Play
          </Link>
        </Button>
      </div>
    </li>
  );
}

export function DrillsTab() {
  const navigate = useNavigate();
  const facts = usePracticeFacts();
  const status = useServiceStatus();
  const { playful } = usePracticeStyle();
  const levels = useLevels();
  const [filter, setFilter] = useState<"all" | AreaId>("all");
  const today = toLocalDate(new Date());
  const filterId = useId();
  const transcriptionMissing = status.data?.transcription.state === "needs_setup";
  const shown = DRILLS.filter((d) => d.type !== "daily" && (filter === "all" || d.areas.includes(filter)));
  return (
    <div className="space-y-6">
      <DailyCard facts={facts.data} today={today} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span id={filterId} className="text-meta text-muted-foreground">Filter</span>
          <ToggleGroup type="single" variant="outline" aria-labelledby={filterId} value={filter} onValueChange={(v) => setFilter((v || "all") as typeof filter)} className="flex-wrap">
            <ToggleGroupItem value="all" size="sm" className="h-9 px-3">All</ToggleGroupItem>
            {FILTERS.map((f) => (
              <ToggleGroupItem key={f.id} value={f.id} size="sm" className="h-9 px-3">
                {f.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" title="Three different short drills in a row" onClick={() => startMixedSet(navigate)}>
            <Layers aria-hidden /> Mixed set
          </Button>
          <Button variant="outline" onClick={() => navigate(`/drill/${randomDrill(facts.data, today, new Date().toISOString()).id}`)}>
            <Shuffle aria-hidden /> Random drill
          </Button>
        </div>
      </div>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Drills">
        {shown.map((d) => (
          <DrillCard key={d.id} drill={d} stats={drillStats(facts.data, d)} playful={playful} rec={recommendation(d.id, levels)} transcriptionMissing={transcriptionMissing} />
        ))}
      </ul>
    </div>
  );
}
