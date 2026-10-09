import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ReferenceClips } from "./ReferenceClips";
import { useIpc } from "@/lib/ipc";
import type { PhraseCard, PracticePrompt, ReferenceClip } from "@/lib/ipc/schemas";
import { ImitationOverlay } from "./ImitationOverlay";

// ── Repeat an answer (4.6) ───────────────────────────────────────────────────

/** One concrete thing to change between takes; the user may write their own. */
export const REPEAT_FOCUSES = [
  "State the main point in the first sentence",
  "Pause between ideas instead of filling the gap",
  "Give one concrete example",
  "Finish with a clear ending",
  "Slow down a little",
] as const;

/**
 * Between takes of a repeated answer: choose one thing to improve. The choice is
 * stored on the session (Your note), so review shows what each retake tried.
 * Two or three takes are enough; after the third the panel says so.
 */
export function RepeatFocus({ sessionId, takeCount, locked, native }: { sessionId: string; takeCount: number; locked: boolean; native: boolean }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const [focus, setFocus] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const save = useMutation({
    mutationFn: (value: string | null) => (native ? ipc.setSessionFocus(sessionId, value) : Promise.resolve()),
    onSuccess: (_, value) => {
      setFocus(value);
      void qc.invalidateQueries({ queryKey: ["session", sessionId] });
    },
  });
  if (takeCount === 0) return null;
  return (
    <Panel className="space-y-3" aria-labelledby="repeat-focus-heading">
      <h2 id="repeat-focus-heading" className="font-semibold">
        {takeCount >= 3 ? "Three takes is usually enough" : `Before take ${takeCount + 1}: choose one thing to improve`}
      </h2>
      {takeCount >= 3 ? (
        <p className="text-meta text-muted-foreground">
          Compare the takes by listening, then keep the one you prefer.{" "}
          {native && <Link className="underline" to={`/sessions/${sessionId}`}>Open this session</Link>}
        </p>
      ) : (
        <p className="text-meta text-muted-foreground">Listen back first. Change one thing only, so you can hear what made the difference. The wording doesn't need to match.</p>
      )}
      <fieldset disabled={locked || save.isPending} className="space-y-2">
        <legend className="sr-only">Focus for the next take</legend>
        <RadioGroup value={REPEAT_FOCUSES.includes(focus as never) ? focus! : ""} onValueChange={(f) => save.mutate(f)} className="gap-1">
          {REPEAT_FOCUSES.map((f, i) => (
            <Label key={f} htmlFor={`repeat-focus-${i}`} className="flex min-h-9 items-center gap-2 font-normal">
              <RadioGroupItem id={`repeat-focus-${i}`} value={f} /> {f}
            </Label>
          ))}
        </RadioGroup>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (custom.trim()) save.mutate(custom.trim());
          }}
        >
          <Label htmlFor="repeat-focus-custom" className="sr-only">Your own focus</Label>
          <Input id="repeat-focus-custom" className="h-9 max-w-sm" maxLength={160} placeholder="Or write your own" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <Button type="submit" variant="outline" size="sm" disabled={!custom.trim()}>Use this focus</Button>
        </form>
      </fieldset>
      <p className="text-meta" aria-live="polite">
        {focus ? `Focus for the next take: ${focus}.` : "No focus chosen yet."}
      </p>
      {save.error && <p role="alert" className="text-meta text-destructive">{save.error.message}</p>}
    </Panel>
  );
}

// ── Use a better expression (4.9) ────────────────────────────────────────────

export function expressionPrompt(phrase: PhraseCard): PracticePrompt {
  return {
    id: phrase.id,
    text: `Use “${phrase.expression}” in three sentences of your own.`,
    tags: ["daily_life"],
    conditions: { familiarity: "familiar", preparationSeconds: 30, targetSeconds: 60, audience: null, followUp: false },
    favorite: false,
    source: "bundled",
  };
}

/**
 * Use a saved expression in three new sentences (4.9): say them as takes, or type
 * drafts first. Typed sentences can be saved to the session notes once a take
 * exists. Meaning first: a different but correct phrasing is not an error.
 */
export function ExpressionPanel({ phrase, phrases, sessionId, hasTake, locked, native, onChoose }: {
  phrase: PhraseCard;
  phrases: PhraseCard[];
  sessionId: string;
  hasTake: boolean;
  locked: boolean;
  native: boolean;
  onChoose: (id: string) => void;
}) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const [sentences, setSentences] = useState(["", "", ""]);
  const save = useMutation({
    mutationFn: async () => {
      const session = await ipc.getSession(sessionId);
      const written = sentences.map((s) => s.trim()).filter(Boolean);
      const block = [`Sentences with “${phrase.expression}”:`, ...written.map((s, i) => `${i + 1}. ${s}`)].join("\n");
      const notes = session.notes.trim() ? `${session.notes.trim()}\n\n${block}` : block;
      await ipc.updateSession(sessionId, { title: session.title, notes, tags: session.tags, favorite: session.favorite });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session", sessionId] }),
  });
  const written = sentences.filter((s) => s.trim()).length;
  return (
    <Panel className="space-y-4" aria-labelledby="expression-heading">
      <div className="space-y-1">
        <Label htmlFor="expression-choice">Expression</Label>
        <Select value={phrase.id} onValueChange={onChoose} disabled={locked || hasTake}>
          <SelectTrigger id="expression-choice" className="h-10 w-full max-w-md"><SelectValue /></SelectTrigger>
          <SelectContent>
            {phrases.map((p) => <SelectItem key={p.id} value={p.id}>{p.expression}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <h2 id="expression-heading" className="text-lg font-semibold">“{phrase.expression}”</h2>
        <p>{phrase.explanation}</p>
        {phrase.examples.length > 0 && (
          <details className="text-meta text-muted-foreground">
            <summary className="cursor-pointer">Examples</summary>
            <ul className="mt-1 list-disc pl-5">{phrase.examples.map((e) => <li key={e}>{e}</li>)}</ul>
          </details>
        )}
      </div>
      <p className="text-meta text-muted-foreground">
        Say three sentences about situations you actually expect, as one take or one take per sentence. You can type drafts first. Keep the meaning you
        intend; another correct way to say it is a style choice, not a mistake.
      </p>
      <div className="space-y-2">
        {sentences.map((value, i) => (
          <div key={i} className="space-y-1">
            <Label htmlFor={`expression-sentence-${i}`}>Sentence {i + 1}</Label>
            <Textarea
              id={`expression-sentence-${i}`}
              rows={2}
              maxLength={400}
              value={value}
              onChange={(e) => setSentences((all) => all.map((s, j) => (j === i ? e.target.value : s)))}
            />
          </div>
        ))}
      </div>
      {native && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={!hasTake || written === 0 || save.isPending} onClick={() => save.mutate()}>
            Save sentences to session notes
          </Button>
          {!hasTake && <span className="text-meta text-muted-foreground">Record a take first; the sentences are saved with that session.</span>}
          {save.isSuccess && <span role="status" className="text-meta">Saved to the session notes.</span>}
          {save.error && <span role="alert" className="text-meta text-destructive">{save.error.message}</span>}
        </div>
      )}
    </Panel>
  );
}

// ── Listen and imitate (4.8) ─────────────────────────────────────────────────

export const IMITATION_FEATURES = ["Emphasis: which word carries the stress", "Phrase rhythm", "Clear endings: where the voice falls"] as const;

/**
 * Listen and imitate (4.8): pick a bundled or imported clip (4.4a), choose the
 * one feature to listen for (stored as the session focus), then record. The
 * contour overlay (P.5) comes later; comparison is by ear.
 */
export function ImitationPanel({ sessionId, hasTake, locked, native, lastTakeAssetId }: { sessionId: string; hasTake: boolean; locked: boolean; native: boolean; lastTakeAssetId?: string }) {
  const ipc = useIpc();
  const [feature, setFeature] = useState<string | null>(null);
  const [clip, setClip] = useState<ReferenceClip | null>(null);
  const save = useMutation({ mutationFn: (value: string) => (native && hasTake ? ipc.setSessionFocus(sessionId, value) : Promise.resolve()) });
  // A feature chosen before the first take is stored once that take creates the session.
  const { mutate } = save;
  useEffect(() => {
    if (hasTake && feature) mutate(feature);
  }, [hasTake]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Panel className="space-y-3" aria-labelledby="imitation-heading">
      <h2 id="imitation-heading" className="font-semibold">Choose one feature to imitate</h2>
      <fieldset disabled={locked} className="space-y-2">
        <legend className="sr-only">Feature</legend>
        <RadioGroup value={feature ?? ""} onValueChange={(f) => { setFeature(f as typeof feature); save.mutate(f); }} className="gap-1" disabled={locked}>
          {IMITATION_FEATURES.map((f, i) => (
            <Label key={f} htmlFor={`imitation-feature-${i}`} className="flex min-h-9 items-center gap-2 font-normal">
              <RadioGroupItem id={`imitation-feature-${i}`} value={f} /> {f}
            </Label>
          ))}
        </RadioGroup>
      </fieldset>
      <ReferenceClips locked={locked} native={native} onSelect={setClip} />
      <p role="note" className="rounded-lg border border-dashed px-3 py-2 text-meta text-muted-foreground">
        Listen to the clip once or twice, then record your repetition with the clip stopped, so only your voice is recorded. Compare the two by
        listening, not by looking at waveforms.
      </p>
      {feature && <p className="text-meta" aria-live="polite">Listening for: {feature}.{hasTake ? "" : " It is saved with the session after your first take."}</p>}
      {/* After listening (P.5): both pitch lines, for the feature you chose. */}
      {native && clip && lastTakeAssetId && !locked && <ImitationOverlay key={`${clip.id}-${lastTakeAssetId}`} clip={clip} takeAssetId={lastTakeAssetId} />}
    </Panel>
  );
}
