import { Link, useNavigate, useSearchParams } from "react-router";
import { Heart, History, NotebookPen, Search } from "lucide-react";
import { EmptyState, LoadingBlock, Page, PageHeader, QueryView } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatClock, formatDay } from "@/lib/format";
import { useSessions } from "@/lib/ipc/queries";
import { ExerciseType } from "@/lib/ipc/schemas";
import { cn } from "@/lib/utils";

export const EXERCISE_LABELS: Record<ExerciseType, string> = {
  repeat: "Repeat an answer",
  thought_groups: "Thought groups",
  imitate: "Listen and imitate",
  expression: "Better expression",
};

export function SessionsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get("q") ?? "";
  const type = params.get("type") as ExerciseType | null;
  const favoritesOnly = params.get("fav") === "1";

  // Filters live in the URL so Back restores them (§3).
  const update = (fn: (p: URLSearchParams) => void) =>
    setParams(
      (p) => {
        fn(p);
        return p;
      },
      { replace: true },
    );

  const sessions = useSessions({ query: q || undefined, exerciseType: type ?? undefined, favoritesOnly });

  return (
    <Page>
      <PageHeader title="Sessions" description="Everything you've recorded, newest first. Stored on this computer." />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search titles and notes"
            placeholder="Search titles and notes"
            className="h-10 pl-9"
            value={q}
            onChange={(e) => update((p) => (e.target.value ? p.set("q", e.target.value) : p.delete("q")))}
          />
        </div>
        <Select
          value={type ?? "all"}
          onValueChange={(v) => update((p) => (v === "all" ? p.delete("type") : p.set("type", v)))}
        >
          <SelectTrigger className="h-10 w-52" aria-label="Exercise">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All exercises</SelectItem>
            {ExerciseType.options.map((t) => (
              <SelectItem key={t} value={t}>
                {EXERCISE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={favoritesOnly ? "secondary" : "outline"}
          aria-pressed={favoritesOnly}
          onClick={() => update((p) => (favoritesOnly ? p.delete("fav") : p.set("fav", "1")))}
        >
          <Heart aria-hidden className={cn(favoritesOnly && "fill-current")} /> Favorites
        </Button>
      </div>

      <QueryView query={sessions} loading={<LoadingBlock rows={6} label="Loading sessions" />}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon={History} title={q || type || favoritesOnly ? "No sessions match" : "No sessions yet"}>
              {q || type || favoritesOnly
                ? "Try clearing a filter."
                : "Sessions appear here after your first recording."}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-panel border bg-card">
              <table className="w-full text-left">
                <caption className="sr-only">Practice sessions</caption>
                <thead className="border-b text-meta text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">Title</th>
                    <th scope="col" className="px-4 py-2 font-medium">Date</th>
                    <th scope="col" className="hidden px-4 py-2 font-medium lg:table-cell">Exercise</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">Duration</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">Takes</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {list.map((s) => (
                    <tr
                      key={s.id}
                      className="cursor-pointer hover:bg-secondary/60"
                      onClick={() => navigate(`/sessions/${s.id}`)}
                    >
                      <td className="px-4 py-2.5">
                        <Link to={`/sessions/${s.id}`} className="inline-flex items-center gap-2 font-medium hover:underline">
                          {s.title}
                        </Link>
                        <span className="ml-2 inline-flex gap-1 align-middle text-muted-foreground">
                          {s.favorite && <Heart aria-label="Favorite" className="size-3.5 fill-primary text-primary" />}
                          {s.hasNote && <NotebookPen aria-label="Has a note" className="size-3.5" />}
                        </span>
                        {s.tags.length > 0 && (
                          <span className="ml-2 text-meta text-muted-foreground">{s.tags.map((t) => `#${t}`).join(" ")}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{formatDay(s.localDate)}</td>
                      <td className="hidden px-4 py-2.5 text-muted-foreground lg:table-cell">{EXERCISE_LABELS[s.exerciseType]}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatClock(s.durationMs)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{s.attemptCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </QueryView>
    </Page>
  );
}
