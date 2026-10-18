import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ear, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useIpc } from "@/lib/ipc";
import { keys } from "@/lib/ipc/queries";

/** The questions a pack starts with (14.4); you can change them. */
export const DEFAULT_QUESTIONS = ["What was my main point?", "Where did you get lost, if anywhere?", "What helped you follow?"] as const;
export const QUESTION_PRESETS = [
  { id: "listener", title: "Listener", questions: DEFAULT_QUESTIONS },
  { id: "buddy", title: "Buddy feedback", questions: ["What did I do well?", "One thing I could do better?", "Another thing that worked?", "Anything else? (optional)"] },
  { id: "teacher", title: "Teacher check", questions: ["Any wording that sounded unnatural?", "Any sounds that were hard to understand?", "One thing to practise next?"] },
] as const;

/** Presets are recognised from the pack's questions; nothing extra is stored. */
export function questionPreset(questions: readonly string[]) {
  return QUESTION_PRESETS.find((p) => p.questions.length === questions.length && p.questions.every((q, i) => q === questions[i].trim()));
}

export const MAX_QUESTIONS = 5;
const MAX_QUESTION_CHARS = 160;

/**
 * Ask a listener (roadmap 14.4, D-35): a pack for one take that a friend,
 * colleague or teacher opens in any browser. They listen, answer your
 * questions and save an answer file to send back. There is no server, upload
 * or account; the pack is a file you save and send however you like.
 */
export function ListenerPackDialog({ attemptId, open, onOpenChange }: { attemptId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const id = useId();
  const [questions, setQuestions] = useState<string[]>([...DEFAULT_QUESTIONS]);
  const [preset, setPreset] = useState("listener");
  const editQuestions = (change: (list: string[]) => string[]) => {
    setPreset("custom");
    setQuestions(change);
  };
  const [from, setFrom] = useState("");
  const [transcript, setTranscript] = useState(false);
  const save = useMutation({
    mutationFn: () => ipc.exportListenerPack(attemptId, questions.map((q) => q.trim()), from.trim(), transcript),
    onSuccess: async (pack) => {
      // Cancelling the save dialog keeps this one open.
      if (!pack) return;
      toast.success(ipc.recordingMode === "native" ? "Pack saved. Send the .zip to your listener." : "Pack made. In the desktop app it is saved as a .zip you choose where to keep.");
      await qc.invalidateQueries({ queryKey: keys.listenerPacks(pack.sessionId) });
      await qc.invalidateQueries({ queryKey: keys.listenerPacks() });
      onOpenChange(false);
    },
  });
  const valid = questions.length > 0 && questions.every((q) => q.trim().length > 0 && q.trim().length <= MAX_QUESTION_CHARS);
  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Ask a listener</DialogTitle>
          <DialogDescription>
            A file a friend, colleague or teacher opens in any browser. They listen to this take, answer your questions and send an answer file back. Nothing is uploaded and no account is needed.
          </DialogDescription>
        </DialogHeader>
        <form
          id={`${id}-form`}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          <fieldset className="space-y-2">
            <legend className="mb-1 font-medium">Questions</legend>
            <Select value={preset} onValueChange={(value) => {
              setPreset(value);
              const chosen = QUESTION_PRESETS.find((p) => p.id === value);
              if (chosen) setQuestions([...chosen.questions]);
            }}>
              <SelectTrigger aria-label="Questions" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {QUESTION_PRESETS.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
            {questions.map((q, i) => (
              <div key={i} className="flex items-center gap-2">
                <span aria-hidden className="w-5 shrink-0 text-right text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <Input
                  value={q}
                  maxLength={MAX_QUESTION_CHARS}
                  aria-label={`Question ${i + 1}`}
                  onChange={(e) => editQuestions((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove question ${i + 1}`}
                  disabled={questions.length === 1}
                  onClick={() => editQuestions((list) => list.filter((_, j) => j !== i))}
                >
                  <X aria-hidden />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" disabled={questions.length >= MAX_QUESTIONS} onClick={() => editQuestions((list) => [...list, ""])}>
              <Plus aria-hidden /> Add a question
            </Button>
            <p className="text-meta text-muted-foreground">Up to {MAX_QUESTIONS} questions of up to {MAX_QUESTION_CHARS} characters.</p>
          </fieldset>
          <div className="space-y-1">
            <Label htmlFor={`${id}-from`}>Your first name (optional, shown to the listener)</Label>
            <Input id={`${id}-from`} value={from} maxLength={60} autoComplete="given-name" onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id={`${id}-transcript`} checked={transcript} onCheckedChange={(v) => setTranscript(v === true)} className="mt-0.5" />
            <div>
              <Label htmlFor={`${id}-transcript`} className="font-normal">Include the transcript</Label>
              <p className="text-meta text-muted-foreground">Off by default: the listener should listen, not read.</p>
            </div>
          </div>
          {save.error && <p role="alert" className="text-meta text-destructive">{save.error.message}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" disabled={save.isPending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form={`${id}-form`} disabled={!valid || save.isPending}>
            {save.isPending ? "Saving…" : "Save the pack…"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Ask a listener… on a take (14.4). */
export function AskListenerButton({ attemptId, size = "sm" }: { attemptId: string; size?: "sm" | "default" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size={size} onClick={() => setOpen(true)}>
        <Ear aria-hidden /> Ask a listener…
      </Button>
      {open && <ListenerPackDialog attemptId={attemptId} open={open} onOpenChange={setOpen} />}
    </>
  );
}
