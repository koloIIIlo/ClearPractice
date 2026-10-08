import { Link, useSearchParams } from "react-router";
import { BookOpen, Heart, Search } from "lucide-react";
import { EmptyState, Page, PageHeader, QueryView } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useExercises, useGuides, usePrompts, useSetPromptFavorite } from "@/lib/ipc/queries";
import { PromptTag, type PracticePrompt } from "@/lib/ipc/schemas";
import { cn } from "@/lib/utils";
import { TAG_LABELS, describeDemands } from "./describe";

type Tab = "exercises" | "prompts" | "guides";

export function ExercisesPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) ?? (params.get("prompt") ? "prompts" : "exercises");
  const setTab = (t: string) =>
    setParams(
      (p) => {
        p.set("tab", t);
        return p;
      },
      { replace: true },
    );

  return (
    <Page>
      <PageHeader
        title="Exercises"
        description="Four core exercises, a collection of prompts, and short guides. Everything here works offline."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="exercises">Exercises</TabsTrigger>
          <TabsTrigger value="prompts">Prompts</TabsTrigger>
          <TabsTrigger value="guides">Guides</TabsTrigger>
        </TabsList>
        <TabsContent value="exercises">
          <ExerciseList />
        </TabsContent>
        <TabsContent value="prompts">
          <PromptCollection />
        </TabsContent>
        <TabsContent value="guides">
          <GuideList highlight={params.get("guide")} />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

function ExerciseList() {
  const exercises = useExercises();
  return (
    <QueryView query={exercises}>
      {(list) =>
        list.length === 0 ? (
          <EmptyState title="No exercises are available">
            The bundled exercises could not be found. Reinstalling the app restores them; your sessions and recordings are not affected.
          </EmptyState>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {list.map((ex) => (
              <li key={ex.id} className="flex flex-col rounded-panel border bg-card p-5">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-lg font-semibold">{ex.title}</h2>
                  <span className="text-meta text-muted-foreground tabular-nums">~{ex.typicalMinutes} min</span>
                </div>
                <p className="mt-1">{ex.purpose}</p>
                <p className="mt-2 text-meta text-muted-foreground">Example: {ex.example}</p>
                <div className="mt-4 flex gap-2 pt-1">
                  <Button asChild>
                    <Link to={`/practice/${ex.id}`} state={{ section: "exercises" }}>
                      Start
                    </Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link to={`/exercises/${ex.id}`}>Instructions</Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )
      }
    </QueryView>
  );
}

const FAMILIARITY = [
  { value: "familiar", label: "Familiar" },
  { value: "unfamiliar", label: "Unfamiliar" },
] as const;

function PromptCollection() {
  const [params, setParams] = useSearchParams();
  const prompts = usePrompts();
  const setFavorite = useSetPromptFavorite();

  const q = params.get("q") ?? "";
  const tags = params.getAll("tag");
  const familiarity = params.get("familiarity") ?? "";
  const favoritesOnly = params.get("fav") === "1";
  const highlight = params.get("prompt");

  const update = (fn: (p: URLSearchParams) => void) =>
    setParams(
      (p) => {
        fn(p);
        return p;
      },
      { replace: true },
    );

  const matches = (p: PracticePrompt) =>
    (!q || p.text.toLowerCase().includes(q.toLowerCase())) &&
    (tags.length === 0 || tags.some((t) => p.tags.includes(t as PracticePrompt["tags"][number]))) &&
    (!familiarity || p.conditions.familiarity === familiarity) &&
    (!favoritesOnly || p.favorite);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-sm">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search prompts"
            placeholder="Search prompts"
            className="h-10 pl-9"
            value={q}
            onChange={(e) => update((p) => (e.target.value ? p.set("q", e.target.value) : p.delete("q")))}
          />
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          aria-label="Topic familiarity"
          value={familiarity}
          onValueChange={(v) => update((p) => (v ? p.set("familiarity", v) : p.delete("familiarity")))}
        >
          {FAMILIARITY.map((f) => (
            <ToggleGroupItem key={f.value} value={f.value} className="h-10 px-3">
              {f.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button
          variant={favoritesOnly ? "secondary" : "outline"}
          aria-pressed={favoritesOnly}
          onClick={() => update((p) => (favoritesOnly ? p.delete("fav") : p.set("fav", "1")))}
        >
          <Heart aria-hidden className={cn(favoritesOnly && "fill-current")} /> Favorites
        </Button>
      </div>

      <ToggleGroup
        type="multiple"
        variant="outline"
        aria-label="Situations"
        className="flex-wrap justify-start"
        value={tags}
        onValueChange={(v) =>
          update((p) => {
            p.delete("tag");
            v.forEach((t) => p.append("tag", t));
          })
        }
      >
        {PromptTag.options.map((t) => (
          <ToggleGroupItem key={t} value={t} size="sm" className="h-9 px-3">
            {TAG_LABELS[t]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <QueryView query={prompts}>
        {(list) => {
          const shown = list.filter(matches);
          if (shown.length === 0)
            return (
              <EmptyState title="No prompts match these filters">
                Clear a filter, or add your own prompt (coming in a later build).
              </EmptyState>
            );
          return (
            <ul className="divide-y rounded-panel border bg-card">
              {shown.map((p) => (
                <li
                  key={p.id}
                  className={cn("flex flex-wrap items-start gap-3 px-4 py-3", p.id === highlight && "bg-secondary")}
                >
                  <div className="min-w-0 flex-1">
                    <p>{p.text}</p>
                    <p className="mt-1 text-meta text-muted-foreground">
                      {describeDemands(p.conditions).join(" · ")} ·{" "}
                      {p.tags.map((t) => TAG_LABELS[t]).join(", ")}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={p.favorite ? "Remove from favorites" : "Add to favorites"}
                    aria-pressed={p.favorite}
                    onClick={() => setFavorite.mutate({ promptId: p.id, favorite: !p.favorite })}
                  >
                    <Heart aria-hidden className={cn(p.favorite && "fill-primary text-primary")} />
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/practice/ex-repeat?prompt=${p.id}`} state={{ section: "exercises" }}>
                      Practise
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          );
        }}
      </QueryView>
    </div>
  );
}

function GuideList({ highlight }: { highlight: string | null }) {
  const guides = useGuides();
  return (
    <QueryView query={guides}>
      {(list) => (
        <ul className="grid gap-3 md:grid-cols-2">
          {list.map((g) => (
            <li
              key={g.id}
              className={cn("flex gap-3 rounded-panel border bg-card p-4", g.id === highlight && "border-primary")}
            >
              <BookOpen aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div>
                <h2 className="font-medium">{g.title}</h2>
                <p className="text-meta text-muted-foreground">
                  {g.summary} · {g.minutes} min read
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </QueryView>
  );
}
