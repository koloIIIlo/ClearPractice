import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Heart, Mic, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { EmptyState, Page, PageHeader, QueryView } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useExercises, useGuides, usePrompts, useSetPromptFavorite } from "@/lib/ipc/queries";
import { PromptTag, type PracticePrompt } from "@/lib/ipc/schemas";
import { EXERCISE_IDS, EXERCISE_TYPE_INFO } from "@/content/exercises";
import { cn } from "@/lib/utils";
import { useIpc } from "@/lib/ipc";
import { TAG_LABELS, describeDemands } from "./describe";
import { PromptForm } from "./PromptForm";
import { DrillsTab } from "@/features/drills/DrillsTab";

type Tab = "exercises" | "drills" | "prompts" | "guides";

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
        description="Four core exercises, short drills, a collection of prompts and guides. Everything here works offline."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="exercises">Exercises</TabsTrigger>
          <TabsTrigger value="drills">Drills</TabsTrigger>
          <TabsTrigger value="prompts">Prompts</TabsTrigger>
          <TabsTrigger value="guides">Guides</TabsTrigger>
        </TabsList>
        <TabsContent value="exercises">
          <ExerciseList />
        </TabsContent>
        <TabsContent value="drills">
          <DrillsTab />
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
            {list.map((ex) => {
              // One recognisable icon per exercise, so the cards can be told apart at a glance (§3.5).
              const Icon = EXERCISE_TYPE_INFO[ex.type].icon;
              return (
              <li key={ex.id} className="flex flex-col rounded-panel border bg-card p-5">
                <div className="flex items-center gap-3">
                  <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
                    <Icon className="size-5" />
                  </span>
                  <h2 className="min-w-0 flex-1 text-lg font-semibold">{ex.title}</h2>
                  <span className="text-meta text-muted-foreground tabular-nums">~{ex.typicalMinutes} min</span>
                </div>
                <p className="mt-1">{ex.purpose}</p>
                <p className="mt-2 text-meta text-muted-foreground">Example: {ex.example}</p>
                {/* Four equal choices: no solid buttons competing; Start leads within each card (§3.4). */}
                <div className="mt-auto flex gap-2 pt-5">
                  <Button variant="outline" asChild>
                    <Link to={`/practice/${ex.id}`} state={{ section: "exercises" }}>
                      <Mic aria-hidden /> Start
                    </Link>
                  </Button>
                  <Button variant="ghost" asChild>
                    <Link to={`/exercises/${ex.id}`}>Instructions</Link>
                  </Button>
                </div>
              </li>
              );
            })}
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

const PREPARATION = [
  { value: "none", label: "No preparation", test: (s: number) => s === 0 },
  { value: "short", label: "Up to 15 s", test: (s: number) => s > 0 && s <= 15 },
  { value: "long", label: "30 s or more", test: (s: number) => s >= 30 },
] as const;

const DEMANDS = [
  { value: "audience", label: "Named audience" },
  { value: "followup", label: "Follow-up question" },
  { value: "mine", label: "Your prompts" },
] as const;

function PromptCollection() {
  const [params, setParams] = useSearchParams();
  const prompts = usePrompts();
  const setFavorite = useSetPromptFavorite();

  const q = params.get("q") ?? "";
  const tags = params.getAll("tag");
  const familiarity = params.get("familiarity") ?? "";
  const favoritesOnly = params.get("fav") === "1";
  const prep = params.get("prep") ?? "";
  const demands = params.getAll("demand");
  const highlight = params.get("prompt");
  const [adding, setAdding] = useState(false);

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
    (!favoritesOnly || p.favorite) &&
    (!prep || !!PREPARATION.find((x) => x.value === prep)?.test(p.conditions.preparationSeconds)) &&
    (!demands.includes("audience") || !!p.conditions.audience) &&
    (!demands.includes("followup") || p.conditions.followUp) &&
    (!demands.includes("mine") || p.source === "user");

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
        <Button className="ml-auto" variant="outline" disabled={adding} onClick={() => setAdding(true)}>
          <Plus aria-hidden /> Add your own prompt
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <ToggleGroup
          type="single"
          variant="outline"
          aria-label="Preparation time"
          value={prep}
          onValueChange={(v) => update((p) => (v ? p.set("prep", v) : p.delete("prep")))}
        >
          {PREPARATION.map((x) => (
            <ToggleGroupItem key={x.value} value={x.value} size="sm" className="h-9 px-3">
              {x.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          type="multiple"
          variant="outline"
          aria-label="Task demands"
          value={demands}
          onValueChange={(v) =>
            update((p) => {
              p.delete("demand");
              v.forEach((d) => p.append("demand", d));
            })
          }
        >
          {DEMANDS.map((x) => (
            <ToggleGroupItem key={x.value} value={x.value} size="sm" className="h-9 px-3">
              {x.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
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

      {adding && <PromptForm onDone={() => setAdding(false)} />}

      <QueryView query={prompts}>
        {(list) => {
          const shown = list.filter(matches);
          if (shown.length === 0)
            return (
              <EmptyState title="No prompts match these filters">
                Clear a filter, or add your own prompt.
              </EmptyState>
            );
          return (
            <ul className="divide-y rounded-panel border bg-card">
              {shown.map((p) => (
                <PromptRow key={p.id} p={p} highlight={p.id === highlight} onFavorite={() => setFavorite.mutate({ promptId: p.id, favorite: !p.favorite })} />
              ))}
            </ul>
          );
        }}
      </QueryView>
    </div>
  );
}

function PromptRow({ p, highlight, onFavorite }: { p: PracticePrompt; highlight: boolean; onFavorite: () => void }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const remove = useMutation({
    mutationFn: () => ipc.deletePrompt(p.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prompts"] }),
  });
  if (editing) return <li className="p-2"><PromptForm prompt={p} onDone={() => setEditing(false)} /></li>;
  const tags = p.tags.map((t) => TAG_LABELS[t]).join(", ");
  return (
    <li className={cn("flex flex-wrap items-center gap-2 px-4 py-3", highlight && "bg-secondary")}>
      <div className="min-w-0 flex-1">
        <p>{p.text}</p>
        <p className="mt-1 text-meta text-muted-foreground">
          {p.source === "user" && <span className="font-medium text-foreground">Your prompt · </span>}
          {describeDemands(p.conditions).join(" · ")}
          {tags && ` · ${tags}`}
        </p>
        {confirm && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-meta">
            Remove this prompt? Sessions that used it keep their text.
            <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
          </p>
        )}
        {remove.error && <p role="alert" className="text-meta text-destructive">{remove.error.message}</p>}
      </div>
      <div className="flex items-center gap-1">
        {p.source === "user" && (
          <>
            <Button variant="ghost" size="icon-sm" aria-label={`Edit ${p.text}`} onClick={() => setEditing(true)}><Pencil aria-hidden /></Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${p.text}`} onClick={() => setConfirm(true)}><Trash2 aria-hidden /></Button>
          </>
        )}
        <Button variant="ghost" size="icon-sm" aria-label={p.favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={p.favorite} onClick={onFavorite}>
          <Heart aria-hidden className={cn(p.favorite && "fill-primary text-primary")} />
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/practice/${EXERCISE_IDS.repeat}?prompt=${p.id}`} state={{ section: "exercises" }}>
            Practise
          </Link>
        </Button>
      </div>
    </li>
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
              className={cn("rounded-panel border bg-card p-4", g.id === highlight && "border-primary md:col-span-2")}
            >
              <details open={g.id === highlight} className="group">
                <summary className="flex cursor-pointer list-none gap-3">
                  <BookOpen aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  <div>
                    <h2 className="font-medium">{g.title}</h2>
                    <p className="text-meta text-muted-foreground">
                      {g.summary} · {g.minutes} min read ·{" "}
                      <span className="underline group-open:hidden">Read</span>
                      <span className="hidden underline group-open:inline">Close</span>
                    </p>
                  </div>
                </summary>
                <article className="mt-4 max-w-prose space-y-4 pl-8">
                  {g.sections.map((section) => (
                    <section key={section.heading} className="space-y-2">
                      <h3 className="font-medium">{section.heading}</h3>
                      {section.paragraphs.map((p, i) => (
                        <p key={i}>{p}</p>
                      ))}
                    </section>
                  ))}
                </article>
              </details>
            </li>
          ))}
        </ul>
      )}
    </QueryView>
  );
}
