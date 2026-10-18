import { useId, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PERSONAS, PERSONA_IDS, scenarioText, type PersonaId, type Scenario } from "@/content/scenarios";
import { useIpc } from "@/lib/ipc";
import { keys } from "@/lib/ipc/queries";
import { CoachingModel, type ConversationMode } from "@/lib/ipc/schemas";
import { MODE_LABELS, usePartnerModes } from "./modes";
import { PressureDial } from "./PressureDial";
import type { PressureLevel } from "./pressure";

/** A boss played with the partner (13.6) comes with its persona, pressure and guidance. */
export type StartPreset = { persona?: PersonaId; pressure?: PressureLevel; guidance?: string; bossId?: string };

function ModeOption({ id, value, label, note, disabled, reason }: { id: string; value: ConversationMode; label: string; note: string; disabled: boolean; reason: string | null }) {
  return (
    <div className="flex items-start gap-3">
      <RadioGroupItem id={id} value={value} disabled={disabled} className="mt-1" aria-describedby={`${id}-note`} />
      <div className="min-w-0">
        <Label htmlFor={id} className={disabled ? "text-muted-foreground" : undefined}>{label}</Label>
        <p id={`${id}-note`} className="text-meta text-muted-foreground">
          {disabled && reason ? (
            <>
              {reason} <Link className="underline underline-offset-2" to="/settings/coaching">Open Settings</Link>
            </>
          ) : (
            note
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * Starting a conversation (roadmap 13.3): the partner's manner, the pressure,
 * who plays the partner, and how you answer. Scripted is always there; your
 * spoken answers need local transcription, otherwise you type them.
 */
export function StartDialog({ scenario, preset, onClose }: { scenario: Scenario; preset?: StartPreset; onClose: () => void }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const modes = usePartnerModes();
  const id = useId();
  const prefs = modes.preferences;
  const [persona, setPersona] = useState<PersonaId>(preset?.persona ?? scenario.defaultPersona);
  const [pressure, setPressure] = useState<PressureLevel>(preset?.pressure ?? 1);
  const [mode, setMode] = useState<ConversationMode | null>(null);
  const [model, setModel] = useState<CoachingModel | null>(null);
  const [limit, setLimit] = useState<string | null>(null);
  const [autoSend, setAutoSend] = useState<boolean | null>(null);
  const [typed, setTyped] = useState(false);
  // Until you choose, the best available mode: your OpenAI key, a local model, else scripted.
  const chosen: ConversationMode = mode && (mode === "scripted" || modes[mode]) ? mode : modes.api ? "api" : modes.local ? "local" : "scripted";
  const chosenModel = model ?? prefs.coachingModel;
  const limitText = limit ?? (prefs.partnerMaxCostMicroUsd / 1_000_000).toFixed(2);
  const chosenAuto = autoSend ?? prefs.partnerAutoSendLocal;
  const typedAnswers = typed || !modes.spoken;

  const start = useMutation({
    mutationFn: async () => {
      const cap = Math.round(Number(limitText) * 1_000_000);
      if (chosen === "api" && (!Number.isFinite(cap) || cap < 10_000 || cap > 5_000_000)) throw new Error("Choose a cost limit between $0.01 and $5.00.");
      return ipc.startConversation({
        scenarioId: scenario.id,
        personaId: persona,
        pressure,
        mode: chosen,
        modelId: chosen === "api" ? chosenModel : null,
        autoSendLocal: chosen === "local" && chosenAuto,
        maxCostMicroUsd: chosen === "api" ? cap : null,
        scenario: scenarioText(scenario, persona, { guidance: preset?.guidance, bossId: preset?.bossId }),
      });
    },
    onSuccess: (view) => {
      void qc.invalidateQueries({ queryKey: keys.conversations });
      navigate(`/partner/${view.conversation.id}${typedAnswers ? "?typed=1" : ""}`);
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{scenario.title}</DialogTitle>
          <DialogDescription>
            The partner: {scenario.partnerRole.charAt(0).toLowerCase() + scenario.partnerRole.slice(1)}. Your goal: {scenario.learnerGoal.charAt(0).toLowerCase() + scenario.learnerGoal.slice(1)}. Up to {scenario.maxTurns} answers.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-1">
            <Label htmlFor={`${id}-persona`}>The partner's manner</Label>
            <Select value={persona} onValueChange={(v) => setPersona(v as PersonaId)}>
              <SelectTrigger id={`${id}-persona`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERSONA_IDS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PERSONAS[p].title}: {PERSONAS[p].description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <PressureDial value={pressure} onChange={setPressure} />
          <fieldset className="space-y-2">
            <legend className="font-medium">Who plays the partner</legend>
            <RadioGroup value={chosen} onValueChange={(v) => setMode(v as ConversationMode)} className="gap-3">
              <ModeOption id={`${id}-api`} value="api" label={`${MODE_LABELS.api}, with your key`} disabled={!modes.api} reason={modes.apiReason}
                note="Only the text of your answers is sent, one turn at a time, when you press Send." />
              <ModeOption id={`${id}-local`} value="local" label={MODE_LABELS.local} disabled={!modes.local} reason={modes.localReason}
                note="A model on this computer: nothing leaves it and nothing is billed." />
              <ModeOption id={`${id}-scripted`} value="scripted" label={MODE_LABELS.scripted} disabled={false} reason={null}
                note="Prepared questions: the partner doesn't adapt to your answers. Works offline and sends nothing." />
            </RadioGroup>
          </fieldset>
          {chosen === "api" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`${id}-model`}>Model</Label>
                <Select value={chosenModel} onValueChange={(v) => setModel(v as CoachingModel)}>
                  <SelectTrigger id={`${id}-model`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CoachingModel.options.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${id}-limit`}>Cost limit for this conversation (USD)</Label>
                <Input id={`${id}-limit`} type="number" inputMode="decimal" min={0.01} max={5} step={0.01} value={limitText} onChange={(e) => setLimit(e.target.value)} />
              </div>
            </div>
          )}
          {chosen === "local" && (
            <div className="flex items-start gap-2">
              <Checkbox id={`${id}-auto`} checked={chosenAuto} onCheckedChange={(v) => setAutoSend(v === true)} className="mt-0.5" />
              <Label htmlFor={`${id}-auto`} className="font-normal">Send turns to the local model without asking</Label>
            </div>
          )}
          {modes.spoken ? (
            <div className="flex items-start gap-2">
              <Checkbox id={`${id}-typed`} checked={typed} onCheckedChange={(v) => setTyped(v === true)} className="mt-0.5" />
              <Label htmlFor={`${id}-typed`} className="font-normal">Type my answers instead</Label>
            </div>
          ) : (
            <p role="note" className="rounded-lg border p-3 text-meta">
              Spoken answers are transcribed on this computer first. {modes.spokenReason ?? "Local transcription isn't ready."}{" "}
              <Link className="underline underline-offset-2" to="/settings/transcription">Transcription settings</Link>. Until then, you type your answers.
            </p>
          )}
          {start.error && <p role="alert" className="text-meta text-destructive">{start.error.message}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={start.isPending} onClick={() => start.mutate()}>Start</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
