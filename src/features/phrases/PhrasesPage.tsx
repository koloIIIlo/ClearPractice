import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpenText, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { PhraseSuggestions } from "./PhraseSuggestions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useIpc } from "@/lib/ipc";
import type { PhraseInput, PhraseUse } from "@/lib/ipc/schemas";
import { EmptyState, LoadingBlock, Page, PageHeader, Panel, QueryView, SectionTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import { formatRelativeDay } from "@/lib/format";
import { usePhrases, usePhraseUses, usePracticeFacts, useReviewPhrase, useSessions } from "@/lib/ipc/queries";
import { formatDay } from "@/lib/format";
import type { PhraseCard, PhraseRating } from "@/lib/ipc/schemas";
import { INTERVAL_LADDER, toLocalDate } from "@/lib/phrase-schedule";
import { cn } from "@/lib/utils";

export function PhrasesPage() {
  const phrases = usePhrases();
  const [params] = useSearchParams();
  // ?review=1 (Ctrl+K "Review due phrases") opens the review straight away.
  const [practising, setPractising] = useState(params.get("review") === "1");
  const [adding, setAdding] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const focus = params.get("focus");
  const localToday = toLocalDate(new Date());

  return (
    <Page>
      <QueryView query={phrases} loading={<LoadingBlock rows={5} label="Loading phrases" />}>
        {(list) => {
          const due = list.filter((p) => p.dueDate <= localToday);
          return (
            <>
              <PageHeader
                title="Phrases"
                description="Expressions you've chosen to keep. Recall each one before you see it again."
                actions={
                  !practising ? (
                    <div data-tour="phrases-actions" className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => setSuggesting(true)} disabled={suggesting}>
                        <Sparkles aria-hidden /> Suggest with AI
                      </Button>
                      <Button variant="outline" onClick={() => setAdding(true)} disabled={adding}>
                        <Plus aria-hidden /> Add a phrase
                      </Button>
                      {due.length > 0 && (
                        <Button onClick={() => setPractising(true)}>
                          Practise {due.length} due {due.length === 1 ? "phrase" : "phrases"}
                        </Button>
                      )}
                    </div>
                  ) : undefined
                }
              />
              {practising && due.length > 0 ? (
                <PhraseReview due={due} onDone={() => setPractising(false)} />
              ) : (
                <>
                  {suggesting && <PhraseSuggestions onDone={() => setSuggesting(false)} />}
                  {adding && <PhraseForm onDone={() => setAdding(false)} />}
                  <PhraseList list={list} focus={focus} today={localToday} />
                </>
              )}
            </>
          );
        }}
      </QueryView>
    </Page>
  );
}

/** Add or edit a card (4.15). Editing changes the text only; the schedule stays. */
export function PhraseForm({ card, onDone, initialOriginal = "", sourceSessionId = null }: { card?: PhraseCard; onDone: () => void; initialOriginal?: string; sourceSessionId?: string | null }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const [original, setOriginal] = useState(card?.original ?? initialOriginal);
  const [expression, setExpression] = useState(card?.expression ?? "");
  const [explanation, setExplanation] = useState(card?.explanation ?? "");
  const [examples, setExamples] = useState((card?.examples ?? []).join("\n"));
  const save = useMutation({ meta: { engagement: "phrase" },
    mutationFn: (input: PhraseInput) => (card ? ipc.updatePhrase(card.id, input) : ipc.addPhrase(input, sourceSessionId)),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["phrases"] }), qc.invalidateQueries({ queryKey: ["today"] })]);
      onDone();
    },
  });
  const id = card?.id ?? "new";
  return (
    <Panel className="mb-4 space-y-3">
      <SectionTitle>{card ? "Edit phrase" : "Add a phrase"}</SectionTitle>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ original, expression, explanation, examples: examples.split("\n") });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`original-${id}`}>What you said</Label>
            <Input id={`original-${id}`} maxLength={500} placeholder="I want to say my opinion" value={original} onChange={(e) => setOriginal(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`expression-${id}`}>A better way to say it</Label>
            <Input id={`expression-${id}`} maxLength={200} placeholder="I'd like to share my view" value={expression} onChange={(e) => setExpression(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`explanation-${id}`}>Why (optional)</Label>
          <Input id={`explanation-${id}`} maxLength={500} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`examples-${id}`}>Examples (optional, one per line)</Label>
          <Textarea id={`examples-${id}`} rows={2} maxLength={1500} value={examples} onChange={(e) => setExamples(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={save.isPending || !original.trim() || !expression.trim()}>{card ? "Save changes" : "Add phrase"}</Button>
          <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
          {!card && <span className="text-meta text-muted-foreground">New phrases are due today.</span>}
        </div>
        {save.error && <p role="alert" className="text-meta text-destructive">{save.error.message}</p>}
      </form>
    </Panel>
  );
}

type UseLink = PhraseUse & { title: string; ordinal: number | null };

/** "Used in 2 takes" (roadmap 8.2): where the phrase turned up in your takes, newest first. */
function PhraseUses({ uses }: { uses: UseLink[] }) {
  if (uses.length === 0) return null;
  return (
    <details className="text-meta">
      <summary className="cursor-pointer text-primary hover:underline">Used in {uses.length} {uses.length === 1 ? "take" : "takes"}</summary>
      <ul className="mt-1 space-y-0.5 pl-3">
        {uses.map((u) => (
          <li key={u.attemptId}>
            <Link className="text-primary hover:underline" to={u.ordinal ? `/sessions/${u.sessionId}/attempt/${u.ordinal}` : `/sessions/${u.sessionId}`}>
              {u.title} · {formatDay(u.localDate)}{u.ordinal ? ` · take ${u.ordinal}` : ""}
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-muted-foreground">Matched by words, so a different meaning can match too.</p>
    </details>
  );
}

function PhraseRow({ p, focus, today, uses = [] }: { p: PhraseCard; focus: string | null; today: string; uses?: UseLink[] }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const remove = useMutation({
    mutationFn: () => ipc.deletePhrase(p.id),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["phrases"] }), qc.invalidateQueries({ queryKey: ["today"] })]),
  });
  if (editing) return <li className="px-2 pt-2"><PhraseForm card={p} onDone={() => setEditing(false)} /></li>;
  return (
    <li className={cn("grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto]", p.id === focus && "bg-secondary")}>
      <div className="min-w-0">
        <p className="font-medium">{p.expression}</p>
        <p className="text-meta text-muted-foreground">
          Instead of “{p.original}”{p.explanation ? ` · ${p.explanation}` : ""}
        </p>
        {p.sourceSessionId && (
          <Link to={`/sessions/${p.sourceSessionId}`} className="text-meta text-primary hover:underline">
            From a session<span className="sr-only">: where you first used “{p.expression}”</span>
          </Link>
        )}
        <PhraseUses uses={uses} />
        {confirm && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-meta">
            Remove “{p.expression}” from practice? Its review history is kept.
            <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
          </p>
        )}
        {remove.error && <p role="alert" className="text-meta text-destructive">{remove.error.message}</p>}
      </div>
      <div className="flex items-start gap-3 sm:justify-end">
        <div className="text-meta text-muted-foreground sm:text-right">
          {p.dueDate <= today ? (
            <span className="inline-flex h-6 items-center rounded-md bg-highlight px-2 font-medium text-highlight-foreground">Due now</span>
          ) : (
            // Only the relative words go lower case mid-sentence; dates keep their capitals ("Due Wed 21 Oct").
            <div>Due {formatRelativeDay(p.dueDate, today).replace(/^(Tomorrow|In )/, (w) => w.toLowerCase())}</div>
          )}
          <div className="tabular-nums">{p.intervalDays === 0 ? "New" : `Every ${p.intervalDays} ${p.intervalDays === 1 ? "day" : "days"}`}</div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${p.expression}`} onClick={() => setEditing(true)}><Pencil aria-hidden /></Button>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Remove ${p.expression}`} onClick={() => setConfirm(true)}><Trash2 aria-hidden /></Button>
      </div>
    </li>
  );
}

function PhraseList({ list, focus, today }: { list: PhraseCard[]; focus: string | null; today: string }) {
  const uses = usePhraseUses();
  const sessions = useSessions({});
  const facts = usePracticeFacts();
  const usesOf = (id: string): UseLink[] =>
    (uses.data ?? [])
      .filter((u) => u.phraseId === id)
      .map((u) => ({ ...u, title: sessions.data?.find((s) => s.id === u.sessionId)?.title ?? "A session", ordinal: facts.data?.takes.find((t) => t.id === u.attemptId)?.ordinal ?? null }));
  if (list.length === 0)
    return (
      <EmptyState icon={BookOpenText} title="No saved phrases yet">
        Add a phrase you want to use more naturally, for example one you noticed in a recording.
      </EmptyState>
    );
  const sorted = [...list].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return (
    <>
      <ul className="divide-y rounded-panel border bg-card">
        {sorted.map((p) => <PhraseRow key={p.id} p={p} focus={focus} today={today} uses={usesOf(p.id)} />)}
      </ul>
      <p className="mt-4 text-meta text-muted-foreground">
        Schedule: {INTERVAL_LADDER.join(", ")} days after each successful recall. “Again” brings a phrase back tomorrow,
        “Hard” keeps the same interval. It's a simple, transparent rule, not an optimised algorithm.
      </p>
    </>
  );
}

const RATINGS: { value: PhraseRating; label: string; hint: string }[] = [
  { value: "again", label: "Again", hint: "Back tomorrow" },
  { value: "hard", label: "Hard", hint: "Same interval" },
  { value: "good", label: "Good", hint: "Longer interval" },
];

function PhraseReview({ due, onDone }: { due: PhraseCard[]; onDone: () => void }) {
  // Snapshot the queue so re-fetches after each rating don't reshuffle it.
  const [queue] = useState(due);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const review = useReviewPhrase();
  const card = queue[index];

  if (!card)
    return (
      <Panel className="text-center">
        <p className="text-lg font-medium">All due phrases reviewed</p>
        <p className="mt-1 text-muted-foreground">Try using one of them in your next recording.</p>
        <Button className="mt-4" variant="outline" onClick={onDone}>
          Back to phrases
        </Button>
      </Panel>
    );

  const rate = async (rating: PhraseRating) => {
    await review.mutateAsync({ phraseId: card.id, rating });
    setRevealed(false);
    setIndex((i) => i + 1);
  };

  return (
    <Panel className="mx-auto max-w-2xl p-6 sm:p-8" aria-live="polite">
      <p className="text-meta text-muted-foreground tabular-nums">
        {index + 1} of {queue.length}
      </p>
      <SectionTitle>How would you say this more naturally?</SectionTitle>
      <p className="text-transcript">“{card.original}”</p>
      <p className="mt-3 text-muted-foreground">Say your version aloud before revealing.</p>

      {revealed ? (
        <div className="mt-6 space-y-3 border-t pt-4">
          <p className="text-2xl font-semibold">{card.expression}</p>
          <p className="text-muted-foreground">{card.explanation}</p>
          {card.examples.length > 0 && (
            <ul className="list-disc pl-5 text-muted-foreground">
              {card.examples.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <fieldset className="pt-2">
            <legend className="mb-2 text-meta font-medium">How easily did it come to you?</legend>
            <div className="flex flex-wrap gap-2">
              {RATINGS.map((r) => (
                <Button key={r.value} variant="outline" disabled={review.isPending} onClick={() => rate(r.value)}>
                  {r.label} <span className="text-meta text-muted-foreground">· {r.hint}</span>
                </Button>
              ))}
            </div>
          </fieldset>
        </div>
      ) : (
        <Button className="mt-6" onClick={() => setRevealed(true)}>
          Reveal
        </Button>
      )}
    </Panel>
  );
}
