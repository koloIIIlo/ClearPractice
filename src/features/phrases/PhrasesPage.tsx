import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { BookOpenText } from "lucide-react";
import { EmptyState, LoadingBlock, Page, PageHeader, Panel, QueryView, SectionTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import { formatRelativeDay } from "@/lib/format";
import { usePhrases, useReviewPhrase } from "@/lib/ipc/queries";
import type { PhraseCard, PhraseRating } from "@/lib/ipc/schemas";
import { INTERVAL_LADDER, toLocalDate } from "@/lib/phrase-schedule";
import { cn } from "@/lib/utils";

export function PhrasesPage() {
  const phrases = usePhrases();
  const [params] = useSearchParams();
  const [practising, setPractising] = useState(false);
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
                  !practising && due.length > 0 ? (
                    <Button size="lg" onClick={() => setPractising(true)}>
                      Practise {due.length} due {due.length === 1 ? "phrase" : "phrases"}
                    </Button>
                  ) : undefined
                }
              />
              {practising ? (
                <PhraseReview due={due} onDone={() => setPractising(false)} />
              ) : (
                <PhraseList list={list} focus={focus} today={localToday} />
              )}
            </>
          );
        }}
      </QueryView>
    </Page>
  );
}

function PhraseList({ list, focus, today }: { list: PhraseCard[]; focus: string | null; today: string }) {
  if (list.length === 0)
    return (
      <EmptyState icon={BookOpenText} title="No saved phrases yet">
        While reviewing a session, select some text and choose “Save a phrase”.
      </EmptyState>
    );
  const sorted = [...list].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return (
    <>
      <ul className="divide-y rounded-panel border bg-card">
        {sorted.map((p) => (
          <li key={p.id} className={cn("grid gap-1 px-4 py-3 sm:grid-cols-[1fr_auto]", p.id === focus && "bg-secondary")}>
            <div className="min-w-0">
              <p className="font-medium">{p.expression}</p>
              <p className="text-meta text-muted-foreground">
                Instead of “{p.original}” · {p.explanation}
              </p>
              {p.sourceSessionId && (
                <Link to={`/sessions/${p.sourceSessionId}`} className="text-meta text-primary hover:underline">
                  From a session
                </Link>
              )}
            </div>
            <div className="text-meta text-muted-foreground sm:text-right">
              <div className={cn(p.dueDate <= today && "font-medium text-foreground")}>
                {p.dueDate <= today ? "Due now" : `Due ${formatRelativeDay(p.dueDate, today).toLowerCase()}`}
              </div>
              <div className="tabular-nums">Every {p.intervalDays} {p.intervalDays === 1 ? "day" : "days"}</div>
            </div>
          </li>
        ))}
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
          <p className="text-xl font-semibold">{card.expression}</p>
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
