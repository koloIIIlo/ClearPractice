import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIpc } from "@/lib/ipc";
import { PromptTag, type PracticePrompt, type PromptInput } from "@/lib/ipc/schemas";
import { TAG_LABELS, describeDemands } from "./describe";

const PREP = [0, 15, 30, 45, 60, 120];
const TARGET = [30, 60, 90, 120, 180, 300];
const seconds = (s: number) => (s === 0 ? "No preparation" : s >= 120 ? `${s / 60} min` : `${s} s`);

/** Add or edit one of your own prompts (4.13). Sessions keep the text they used. */
export function PromptForm({ prompt, onDone }: { prompt?: PracticePrompt; onDone: () => void }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const [text, setText] = useState(prompt?.text ?? "");
  const [tags, setTags] = useState<PromptTag[]>(prompt?.tags ?? []);
  const [familiarity, setFamiliarity] = useState(prompt?.conditions.familiarity ?? "unfamiliar");
  const [prep, setPrep] = useState(prompt?.conditions.preparationSeconds ?? 30);
  const [target, setTarget] = useState(prompt?.conditions.targetSeconds ?? 90);
  const [audience, setAudience] = useState(prompt?.conditions.audience ?? "");
  const [followUp, setFollowUp] = useState(prompt?.conditions.followUp ?? false);
  const save = useMutation({
    mutationFn: (input: PromptInput) => (prompt ? ipc.updatePrompt(prompt.id, input) : ipc.addPrompt(input)),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["prompts"] });
      onDone();
    },
  });
  const id = prompt?.id ?? "new";
  const conditions = { familiarity, preparationSeconds: prep, targetSeconds: target, audience: audience.trim() || null, followUp };
  const options = (values: number[], current: number) => [...new Set([...values, current])].sort((a, b) => a - b);
  return (
    <Panel className="space-y-4">
      <h2 className="font-semibold">{prompt ? "Edit your prompt" : "Add your own prompt"}</h2>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ text, tags, conditions });
        }}
      >
        <div className="space-y-1">
          <Label htmlFor={`prompt-text-${id}`}>Prompt</Label>
          <Textarea id={`prompt-text-${id}`} rows={2} maxLength={500} value={text} placeholder="Explain a decision your team made last month to a new colleague." onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="space-y-1">
          <p className="text-meta font-medium" id={`prompt-tags-${id}`}>Situations (optional)</p>
          <ToggleGroup type="multiple" variant="outline" aria-label="Situations for this prompt" className="flex-wrap justify-start" value={tags} onValueChange={(v) => setTags(v as PromptTag[])}>
            {PromptTag.options.map((t) => <ToggleGroupItem key={t} value={t} size="sm" className="h-9 px-3">{TAG_LABELS[t]}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor={`prompt-fam-${id}`}>Topic</Label>
            <NativeSelect id={`prompt-fam-${id}`} className="w-full" value={familiarity} onChange={(e) => setFamiliarity(e.target.value as "familiar" | "unfamiliar")}>
              <option value="unfamiliar">Unfamiliar</option>
              <option value="familiar">Familiar</option>
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`prompt-prep-${id}`}>Preparation</Label>
            <NativeSelect id={`prompt-prep-${id}`} className="w-full" value={prep} onChange={(e) => setPrep(Number(e.target.value))}>
              {options(PREP, prep).map((s) => <option key={s} value={s}>{seconds(s)}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`prompt-target-${id}`}>Speaking time</Label>
            <NativeSelect id={`prompt-target-${id}`} className="w-full" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
              {options(TARGET, target).map((s) => <option key={s} value={s}>{seconds(s)}</option>)}
            </NativeSelect>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor={`prompt-aud-${id}`}>Audience (optional)</Label>
            <Input id={`prompt-aud-${id}`} maxLength={80} value={audience} placeholder="A new colleague" onChange={(e) => setAudience(e.target.value)} />
          </div>
          <div className="flex h-10 items-center gap-2">
            <Switch id={`prompt-fu-${id}`} checked={followUp} onCheckedChange={setFollowUp} />
            <Label htmlFor={`prompt-fu-${id}`} className="font-normal">Answer a follow-up question</Label>
          </div>
        </div>
        <p className="text-meta text-muted-foreground">Demands: {describeDemands(conditions).join(" · ")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={save.isPending || text.trim().length < 5}>{prompt ? "Save changes" : "Add prompt"}</Button>
          <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        </div>
        {save.error && <p role="alert" className="text-meta text-destructive">{save.error.message}</p>}
      </form>
    </Panel>
  );
}
