import { useId, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquareText, RotateCcw, Sparkles, WandSparkles } from "lucide-react";
import { EvidenceLabel } from "@/components/evidence";
import { Panel, SectionTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatClock } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import { keys, usePreferences } from "@/lib/ipc/queries";
import { CoachingModel, type ConversationFeedbackRun, type ConversationTurn, type ConversationView } from "@/lib/ipc/schemas";
import { RequestPreviewCard, RequestStatus, useRequestPreview } from "./RequestPreview";
import { pressureDef } from "./pressure";

function FeedbackCard({ run }: { run: ConversationFeedbackRun }) {
  const f = run.feedback;
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
        <EvidenceLabel source="ai" /> {run.provider} · {run.model}
      </div>
      <p>{f.summary}</p>
      <p><span className="font-medium">One thing to change:</span> {f.oneImprovement}</p>
      <p><span className="font-medium">Next time:</span> {f.nextAttempt}</p>
      {f.corrections.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-meta">
          {f.corrections.map((c, i) => (
            <li key={i}>
              “{c.quote}” → “{c.suggestion}”: {c.reason} {c.kind === "style" && <span className="text-muted-foreground">(optional style)</span>}
            </li>
          ))}
        </ul>
      )}
      {f.phrases.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-meta">
          {f.phrases.map((p, i) => (
            <li key={i}>
              <span className="font-medium">{p.expression}</span>
              {p.instead && <> instead of “{p.instead}”</>}: {p.why}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * After a conversation (roadmap 13.11): what happened, your answers, and what
 * to do next: AI feedback on the whole conversation (previewed and sent on
 * Send), an upgrade loop for one of your answers, phrases to keep, or the same
 * conversation again. Counts and times only, never a verdict.
 */
export function ConversationSummary({ view }: { view: ConversationView }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { preferences } = usePreferences();
  const id = useId();
  const c = view.conversation;
  const answers = view.turns.filter((t) => t.role === "learner");
  const spoken = answers.filter((t) => !t.typed && t.durationMs !== null);
  const speakingMs = spoken.reduce((n, t) => n + (t.durationMs ?? 0), 0);
  const longest = spoken.reduce<ConversationTurn | null>((best, t) => (!best || (t.durationMs ?? 0) > (best.durationMs ?? 0) ? t : best), null);
  const interruptions = view.turns.filter((t, i) => t.role === "partner" && t.move === "interrupt" && view.turns[i + 1]?.role === "learner").length;
  const upgradable = spoken.filter((t) => t.takeAvailable && t.attemptId);
  const [upgradeTurn, setUpgradeTurn] = useState<string | null>(null);
  const chosenTurn = upgradable.find((t) => t.id === upgradeTurn) ?? (longest?.takeAvailable ? longest : upgradable[0]);
  const coachingOn = preferences.coachingMode !== "off";
  const local = preferences.coachingMode === "local";

  // Feedback received here shows at once; the conversation's own list follows when it reloads.
  const [received, setReceived] = useState<ConversationFeedbackRun[]>([]);
  const feedbackRuns = [...received, ...view.feedback.filter((f) => !received.some((r) => r.id === f.id))];
  const feedback = useRequestPreview({
    prepare: () => ipc.previewConversationFeedback(c.id, preferences.coachingModel),
    send: async (p) => {
      const run = await ipc.requestConversationFeedback(c.id, p.requestId, p.payloadSha256);
      setReceived((list) => [run, ...list]);
      void qc.invalidateQueries({ queryKey: keys.conversation(c.id) });
      return run;
    },
  });
  const upgrade = useRequestPreview({
    prepare: async () => (await ipc.previewUpgrade(chosenTurn!.attemptId!, preferences.coachingModel)).preview,
    send: async (p) => {
      const run = await ipc.requestUpgrade(chosenTurn!.attemptId!, p.requestId, p.payloadSha256);
      navigate(`/upgrade/${run.id}`);
      return run;
    },
  });
  const again = useMutation({
    mutationFn: () =>
      ipc.startConversation({
        scenarioId: c.scenarioId, personaId: c.personaId, pressure: c.pressure, mode: c.mode,
        modelId: c.mode === "api" && CoachingModel.safeParse(c.modelId).success ? (c.modelId as CoachingModel) : null,
        autoSendLocal: c.autoSendLocal, maxCostMicroUsd: c.maxCostMicroUsd, scenario: c.scenario,
      }),
    onSuccess: (next) => {
      void qc.invalidateQueries({ queryKey: keys.conversations });
      navigate(`/partner/${next.conversation.id}`);
    },
  });
  const takeLabel = (t: ConversationTurn, i: number) => `Answer ${i + 1}${t.durationMs ? ` (${formatClock(t.durationMs)})` : t.typed ? " (typed)" : ""}`;

  return (
    <Panel aria-labelledby="summary-heading" className="space-y-5">
      <div className="space-y-1">
        <SectionTitle id="summary-heading">Summary</SectionTitle>
        <p className="text-muted-foreground">
          {c.scenario.title} · {c.scenario.personaTitle} · Pressure {c.pressure} ({pressureDef(c.pressure).name})
        </p>
        <p>
          {answers.length} {answers.length === 1 ? "turn" : "turns"}
          {spoken.length > 0 && <> · your speaking time {formatClock(speakingMs)}</>}
          {longest?.durationMs ? <> · longest answer {formatClock(longest.durationMs)}</> : null}
          {interruptions > 0 && <> · {interruptions} {interruptions === 1 ? "interruption" : "interruptions"} handled</>}
        </p>
        {c.mode === "scripted" && <p className="text-meta text-muted-foreground">The scripted partner asked prepared questions and didn't adapt to your answers.</p>}
        {view.spentMicroUsd > 0 && <p className="text-meta text-muted-foreground">Requests for this conversation: at most ${(view.spentMicroUsd / 1_000_000).toFixed(4)} (estimated).</p>}
      </div>

      <details>
        <summary className="cursor-pointer font-medium">Your answers</summary>
        <ol className="mt-2 space-y-2">
          {answers.map((t, i) => (
            <li key={t.id} className="rounded-lg border p-3">
              <p className="text-meta text-muted-foreground">
                {takeLabel(t, i)}
                {t.takeDeleted && " · take deleted"}
              </p>
              <p>“{t.text}”</p>
              {t.attemptId && t.takeAvailable && (
                <Link className="text-meta text-primary underline underline-offset-2" to={`/sessions/${c.sessionId}`}>
                  Open in the session, with its take summary
                </Link>
              )}
            </li>
          ))}
        </ol>
      </details>

      <section aria-label="What next" className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {coachingOn && answers.length > 0 && (
            <Button variant="outline" disabled={feedback.state !== "idle"} onClick={() => void feedback.open()}>
              <MessageSquareText aria-hidden /> AI feedback on this conversation
            </Button>
          )}
          {spoken.some((t) => t.takeAvailable) && (
            <Button variant="outline" asChild>
              <Link to={`/phrases?suggest=${c.sessionId}`}>
                <Sparkles aria-hidden /> Save phrases
              </Link>
            </Button>
          )}
          {c.scenarioId !== "qa-panel" && (
            <Button variant="outline" disabled={again.isPending} onClick={() => again.mutate()}>
              <RotateCcw aria-hidden /> Try again
            </Button>
          )}
        </div>
        {feedback.preview && (
          <RequestPreviewCard preview={feedback.preview} label="Conversation feedback preview" busy={feedback.state !== "idle"} onSend={() => void feedback.approve()} onCancel={feedback.discard} />
        )}
        <RequestStatus state={feedback.state} local={local} onStop={feedback.stop} />
        {feedback.error && <p role="alert" className="text-meta text-destructive">{feedback.error}</p>}
        {again.error && <p role="alert" className="text-meta text-destructive">{again.error.message}</p>}
        {feedbackRuns.map((run) => <FeedbackCard key={run.id} run={run} />)}

        {coachingOn && chosenTurn && (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="font-medium">
              <WandSparkles aria-hidden className="mr-1 inline size-4" /> Upgrade an answer
            </p>
            <p className="text-meta text-muted-foreground">A clearer version of your own answer, with your ideas kept. Then shadow it and retell it from memory.</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor={`${id}-turn`}>Answer</Label>
                <Select value={chosenTurn.id} onValueChange={setUpgradeTurn}>
                  <SelectTrigger id={`${id}-turn`} className="w-64 max-w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {upgradable.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{takeLabel(t, answers.indexOf(t))}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" disabled={upgrade.state !== "idle"} onClick={() => void upgrade.open()}>Upgrade this answer</Button>
            </div>
            {upgrade.preview && (
              <RequestPreviewCard preview={upgrade.preview} label="Upgrade preview" busy={upgrade.state !== "idle"} onSend={() => void upgrade.approve()} onCancel={upgrade.discard} />
            )}
            <RequestStatus state={upgrade.state} local={local} onStop={upgrade.stop} />
            {upgrade.error && <p role="alert" className="text-meta text-destructive">{upgrade.error}</p>}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" asChild>
            <Link to="/partner">All conversations</Link>
          </Button>
        </div>
      </section>
    </Panel>
  );
}
