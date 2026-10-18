import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { EvidenceLabel } from "@/components/evidence";
import { Panel, SectionTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { COACHING_MODELS } from "@/features/settings/CoachingSpike";
import { formatDay } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import { usePhrases, usePreferences, useSessions } from "@/lib/ipc/queries";
import type { CoachingModel, CoachingPreview, PhraseSuggestion, SessionSummary } from "@/lib/ipc/schemas";

const money = (micro: number) => `$${(micro / 1_000_000).toFixed(micro < 10_000 ? 4 : 2)}`;

/**
 * AI phrase suggestions from your own sessions (user request 2026-10-10): pick
 * transcribed sessions (the latest day's are ticked), see exactly what would be
 * sent, send it, then keep the suggestions you like as phrases. Only titles and
 * transcripts are sent, never audio, and only after Send; each suggestion
 * quotes words you actually said.
 */
export function PhraseSuggestions({ onDone, preselect }: { onDone: () => void; preselect?: string[] }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const { preferences } = usePreferences();
  const local = preferences.coachingMode === "local";
  const sessions = useSessions({});
  const saved = usePhrases();
  const known = useMemo(() => new Set((saved.data ?? []).map((p) => p.expression.trim().toLowerCase())), [saved.data]);
  const isKnown = (s: PhraseSuggestion) => known.has(s.expression.trim().toLowerCase());
  const transcribed = useMemo(
    () => (sessions.data ?? []).filter((s) => (s.transcribedTakes ?? s.attemptCount) > 0).slice(0, 20),
    [sessions.data],
  );
  const latestDay = transcribed[0]?.localDate;
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const preselected = transcribed.filter((s) => preselect?.includes(s.id)).map((s) => s.id);
  const chosen = picked ?? new Set(preselected.length > 0 ? preselected : transcribed.filter((s) => s.localDate === latestDay).map((s) => s.id));
  const [model, setModel] = useState<CoachingModel>(preferences.coachingModel);
  const [preview, setPreview] = useState<CoachingPreview | null>(null);
  const [results, setResults] = useState<{ items: PhraseSuggestion[]; sessions: SessionSummary[] } | null>(null);
  const [kept, setKept] = useState<Set<number>>(new Set());
  const order = transcribed.filter((s) => chosen.has(s.id));

  const prepare = useMutation({
    mutationFn: () => local ? ipc.previewPhraseSuggestionsLocal(order.map((s) => s.id), model) : ipc.previewPhraseSuggestions(order.map((s) => s.id), model),
    onSuccess: setPreview,
  });
  const send = useMutation({
    mutationFn: (p: CoachingPreview) => p.recipient === "https://api.openai.com/v1/responses" ? ipc.requestPhraseSuggestions(p.requestId, p.payloadSha256) : ipc.sendPhraseSuggestionsLocal(p.requestId, p.payloadSha256),
    onSuccess: (items) => {
      setPreview(null);
      setResults({ items, sessions: order });
      // Ticked to start with, except expressions you already keep.
      setKept(new Set(items.flatMap((s, i) => (isKnown(s) ? [] : [i]))));
    },
  });
  const add = useMutation({ meta: { engagement: "phrase" },
    mutationFn: async () => {
      const chosenItems = results!.items.filter((_, i) => kept.has(i));
      for (const s of chosenItems) {
        await ipc.addPhrase({ original: s.original, expression: s.expression, explanation: s.explanation, examples: s.example ? [s.example] : [] }, results!.sessions[s.session - 1]?.id ?? null);
      }
      return chosenItems.length;
    },
    onSuccess: async (count) => {
      await qc.invalidateQueries({ queryKey: ["phrases"] });
      toast.success(`Added ${count} ${count === 1 ? "phrase" : "phrases"}. They come up for review today.`);
      onDone();
    },
  });
  const cancelPreview = () => {
    if (preview) void ipc.cancelCoachingPreview(preview.requestId).catch(() => {});
    setPreview(null);
  };

  if (preferences.coachingMode === "off")
    return (
      <Panel className="space-y-2">
        <SectionTitle>Suggest phrases with AI</SectionTitle>
        <p className="text-muted-foreground">
          AI suggestions are turned off. {" "}
          <Link className="text-primary hover:underline" to="/settings/coaching">Choose in Settings → Coaching</Link>.
        </p>
        <Button variant="ghost" onClick={onDone}>Close</Button>
      </Panel>
    );

  return (
    <Panel className="space-y-4" aria-labelledby="suggest-heading">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="suggest-heading" className="font-semibold">Suggest phrases with AI</h2>
          <p className="text-meta text-muted-foreground">
            Finds places in your own words that could sound more natural. You see exactly what would be sent first; only transcripts are sent, never audio.
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close suggestions" onClick={() => { cancelPreview(); onDone(); }}>
          <X aria-hidden />
        </Button>
      </div>

      {results ? (
        <div className="space-y-3">
          <ul className="space-y-2">
            {results.items.map((s, i) => (
              <li key={i}>
                <Label htmlFor={`suggestion-${i}`} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary">
                  <Checkbox
                    id={`suggestion-${i}`}
                    className="mt-1"
                    checked={kept.has(i)}
                    onCheckedChange={(on) => setKept((k) => { const next = new Set(k); if (on === true) next.add(i); else next.delete(i); return next; })}
                  />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {s.expression}
                        {isKnown(s) && <span className="ml-2 text-meta font-normal text-muted-foreground">Already in your phrases</span>}
                      </span>
                      <EvidenceLabel source="ai" />
                    </span>
                    <span className="block text-meta text-muted-foreground">
                      You said: “{s.original}” · {results.sessions[s.session - 1]?.title ?? "a session"}
                    </span>
                    <span className="block">{s.explanation}</span>
                    {s.example && <span className="block text-meta text-muted-foreground">Example: {s.example}</span>}
                  </span>
                </Label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button disabled={kept.size === 0 || add.isPending} onClick={() => add.mutate()}>
              {add.isPending ? "Adding…" : `Add ${kept.size} ${kept.size === 1 ? "phrase" : "phrases"}`}
            </Button>
            <Button variant="ghost" onClick={onDone}>Discard</Button>
          </div>
          {add.error && <p role="alert" className="text-meta text-destructive">{add.error.message}</p>}
        </div>
      ) : preview ? (
        <div className="space-y-3 rounded-lg border p-3" role="group" aria-label="Request preview">
          <p className="text-meta">
            {preview.recipient === "https://api.openai.com/v1/responses" ? `Recipient: OpenAI · ${preview.model} · at most ${money(preview.estimatedMaximumCostMicroUsd)}` : "Recipient: local model on this computer · free"}
          </p>
          <p className="text-meta">Model: {preview.model}</p>
          <p className="text-meta text-muted-foreground">{preview.costExplanation}</p>
          <details className="text-meta">
            <summary>Exactly what will be sent ({order.length} {order.length === 1 ? "session" : "sessions"})</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 font-sans whitespace-pre-wrap">{preview.selectedText}</pre>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button disabled={send.isPending} onClick={() => send.mutate(preview)}>
              <Send aria-hidden /> {send.isPending ? "Waiting for the answer…" : (preview.recipient === "https://api.openai.com/v1/responses" ? "Send · may be billed" : "Send to the local model")}
            </Button>
            <Button variant="ghost" disabled={send.isPending} onClick={cancelPreview}>Cancel</Button>
          </div>
          {send.error && <p role="alert" className="text-meta text-destructive">{send.error.message}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {transcribed.length === 0 ? (
            <p className="text-muted-foreground">
              No transcribed sessions yet. Transcribe takes in the studio, or tick sessions in <Link className="text-primary hover:underline" to="/sessions">Sessions</Link> and transcribe them all.
            </p>
          ) : (
            <fieldset className="space-y-1">
              <legend className="mb-1 text-meta font-medium">Sessions to look at ({chosen.size} chosen)</legend>
              <ul className="max-h-72 divide-y overflow-auto rounded-lg border">
                {transcribed.map((s) => (
                  <li key={s.id}>
                    <Label htmlFor={`suggest-${s.id}`} className="flex min-h-10 cursor-pointer items-center gap-3 px-3 py-2 font-normal">
                      <Checkbox
                        id={`suggest-${s.id}`}
                        checked={chosen.has(s.id)}
                        onCheckedChange={(on) => setPicked(() => { const next = new Set(chosen); if (on === true) next.add(s.id); else next.delete(s.id); return next; })}
                      />
                      <span className="min-w-0 flex-1 truncate">{s.title}</span>
                      <span className="shrink-0 text-meta text-muted-foreground tabular-nums">
                        {formatDay(s.localDate)}
                        {s.transcribedTakes !== undefined && s.transcribedTakes < s.attemptCount ? ` · ${s.transcribedTakes} of ${s.attemptCount} transcribed` : ""}
                      </span>
                    </Label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          {!local && <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="suggest-model" className="text-meta">Model</Label>
            <NativeSelect id="suggest-model" compact value={model} onChange={(e) => setModel(e.target.value as CoachingModel)}>
              {COACHING_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.note}</option>)}
            </NativeSelect>
          </div>}
          <Button disabled={chosen.size === 0 || chosen.size > 12 || prepare.isPending} onClick={() => prepare.mutate()}>
            <Sparkles aria-hidden /> {prepare.isPending ? "Preparing…" : "Preview the request"}
          </Button>
          {chosen.size > 12 && <p className="text-meta text-muted-foreground">Choose up to 12 sessions at a time.</p>}
          {prepare.error && <p role="alert" className="text-meta text-destructive">{prepare.error.message}</p>}
        </div>
      )}
    </Panel>
  );
}
