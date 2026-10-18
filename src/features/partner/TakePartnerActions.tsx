import { useId, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MessagesSquare, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PANEL, PANEL_PERSONAS, panelScenarioText } from "@/content/scenarios";
import { formatDay } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import { keys, usePreferences, useUpgradeRuns } from "@/lib/ipc/queries";
import type { PanelPersona } from "@/lib/ipc/schemas";
import { RequestPreviewCard, RequestStatus, useRequestPreview } from "./RequestPreview";

/**
 * Questions from a panel (13.9): three listeners each ask one question about
 * this take, which you then answer as a conversation. With AI (previewed and
 * sent on Send) the questions come from your transcript; offline, the panel
 * asks general questions.
 */
function QaPanel({ attemptId, onClose }: { attemptId: string; onClose: () => void }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { preferences } = usePreferences();
  const id = useId();
  const [personas, setPersonas] = useState<PanelPersona[]>([...PANEL_PERSONAS]);
  const ai = preferences.coachingMode !== "off";
  const opened = (conversationId: string) => {
    void qc.invalidateQueries({ queryKey: keys.conversations });
    navigate(`/partner/${conversationId}`);
  };
  const request = useRequestPreview({
    prepare: async () => (await ipc.previewQaPanel(attemptId, personas, preferences.coachingModel)).preview,
    send: async (p) => {
      const view = await ipc.startQaPanel(attemptId, personas, p.requestId, p.payloadSha256);
      opened(view.conversation.id);
      return view;
    },
  });
  const scripted = useMutation({
    mutationFn: () =>
      ipc.startConversation({ scenarioId: "qa-panel", personaId: "panel", pressure: 0, mode: "scripted", scenario: panelScenarioText(personas), sourceAttemptId: attemptId }),
    onSuccess: (view) => opened(view.conversation.id),
  });
  const toggle = (p: PanelPersona, on: boolean) => setPersonas((list) => PANEL_PERSONAS.filter((x) => (x === p ? on : list.includes(x))));
  return (
    <div className="space-y-3 rounded-lg border p-3" role="group" aria-label="Questions from a panel">
      <fieldset className="space-y-2">
        <legend className="font-medium">Who asks</legend>
        {PANEL_PERSONAS.map((p) => (
          <div key={p} className="flex items-start gap-2">
            <Checkbox id={`${id}-${p}`} checked={personas.includes(p)} onCheckedChange={(v) => toggle(p, v === true)} className="mt-0.5" />
            <Label htmlFor={`${id}-${p}`} className="font-normal">
              <span className="font-medium">{PANEL[p].title}</span>: {PANEL[p].description}
            </Label>
          </div>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        {ai && (
          <Button size="sm" disabled={personas.length === 0 || request.state !== "idle"} onClick={() => void request.open()}>
            Preview questions from your answer
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={personas.length === 0 || scripted.isPending} onClick={() => scripted.mutate()}>
          Scripted questions (offline)
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
      {request.preview && (
        <RequestPreviewCard preview={request.preview} label="Panel questions preview" busy={request.state !== "idle"} onSend={() => void request.approve()} onCancel={request.discard} />
      )}
      <RequestStatus state={request.state} local={preferences.coachingMode === "local"} onStop={request.stop} />
      {(request.error || scripted.error) && <p role="alert" className="text-meta text-destructive">{request.error ?? scripted.error?.message}</p>}
    </div>
  );
}

/** Upgrade this answer (13.10): previewed, sent on Send, then the loop. */
function Upgrade({ attemptId }: { attemptId: string }) {
  const ipc = useIpc();
  const navigate = useNavigate();
  const { preferences } = usePreferences();
  const runs = useUpgradeRuns(attemptId);
  const request = useRequestPreview({
    prepare: async () => (await ipc.previewUpgrade(attemptId, preferences.coachingModel)).preview,
    send: async (p) => {
      const run = await ipc.requestUpgrade(attemptId, p.requestId, p.payloadSha256);
      navigate(`/upgrade/${run.id}`);
      return run;
    },
  });
  return (
    <>
      <Button size="sm" variant="outline" disabled={request.state !== "idle"} onClick={() => void request.open()}>
        <WandSparkles aria-hidden /> Upgrade this answer
      </Button>
      {(runs.data ?? []).slice(0, 3).map((run) => (
        <Link key={run.id} className="text-meta text-primary underline underline-offset-2" to={`/upgrade/${run.id}`}>
          Upgrade of {formatDay(run.createdAt.slice(0, 10))}
        </Link>
      ))}
      {request.preview && (
        <div className="w-full">
          <RequestPreviewCard preview={request.preview} label="Upgrade preview" busy={request.state !== "idle"} onSend={() => void request.approve()} onCancel={request.discard} />
        </div>
      )}
      <div className="w-full">
        <RequestStatus state={request.state} local={preferences.coachingMode === "local"} onStop={request.stop} />
        {request.error && <p role="alert" className="text-meta text-destructive">{request.error}</p>}
      </div>
    </>
  );
}

/** The partner's actions on a transcribed take (13.9, 13.10). */
export function TakePartnerActions({ attemptId }: { attemptId: string }) {
  const { preferences } = usePreferences();
  const [panel, setPanel] = useState(false);
  return (
    <div className="mt-3 space-y-2 border-t pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setPanel((v) => !v)} aria-expanded={panel}>
          <MessagesSquare aria-hidden /> Questions from a panel
        </Button>
        {preferences.coachingMode !== "off" && <Upgrade attemptId={attemptId} />}
      </div>
      {panel && <QaPanel attemptId={attemptId} onClose={() => setPanel(false)} />}
    </div>
  );
}
