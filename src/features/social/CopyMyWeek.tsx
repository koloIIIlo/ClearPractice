import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { QueryView } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { weekStart } from "@/lib/engagement/weekly";
import { formatDay } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import { usePracticeEvents, usePracticeFacts, usePreferences } from "@/lib/ipc/queries";
import { addLocalDays } from "@/lib/phrase-schedule";
import { buildWeekNote } from "@/lib/social/week-note";

/** Nothing is copied until you have picked an optional highlight and seen the exact note. */
export function CopyMyWeek() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><Copy aria-hidden /> Copy my week</Button>
      {open && <WeekNoteDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function WeekNoteDialog({ onClose }: { onClose: () => void }) {
  const ipc = useIpc();
  const id = useId();
  const facts = usePracticeFacts();
  const events = usePracticeEvents();
  const { preferences } = usePreferences();
  const reviews = useQuery({ queryKey: ["transfer-reviews"], queryFn: () => ipc.listTransferReviews() });
  const [selection, setSelection] = useState("none");
  const [highlight, setHighlight] = useState("");
  const [copying, setCopying] = useState(false);
  const start = facts.data ? weekStart(facts.data.today, preferences.weekStartsOn) : "";
  const end = start ? addLocalDays(start, 6) : "";
  const reflections = (reviews.data ?? []).filter((r) => r.localDate >= start && r.localDate <= end);
  const note = facts.data && events.data ? buildWeekNote(facts.data, events.data, preferences.weekStartsOn, highlight) : null;
  const copy = async () => {
    if (note === null) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(note);
      toast.success("Your week was copied.");
      onClose();
    } catch {
      toast.error("The clipboard isn't available here.");
    } finally {
      setCopying(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !copying && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Copy my week</DialogTitle>
          <DialogDescription>A private note you can share with someone you choose. Pick a highlight or leave it out.</DialogDescription>
        </DialogHeader>
        <QueryView query={facts}>
          {() => <QueryView query={events}>
            {() => (
              <div className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor={`${id}-highlight`}>Highlight (optional)</Label>
                  <Select value={selection} onValueChange={(value) => {
                    setSelection(value);
                    setHighlight(reflections.find((r) => r.id === value)?.situation ?? "");
                  }}>
                    <SelectTrigger id={`${id}-highlight`} className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No highlight</SelectItem>
                      {reflections.map((r) => <SelectItem key={r.id} value={r.id}>{formatDay(r.localDate)}: {r.situation}</SelectItem>)}
                      <SelectItem value="custom">Write my own</SelectItem>
                    </SelectContent>
                  </Select>
                  {reviews.isPending && <p role="status" className="text-meta text-muted-foreground">Loading reflections…</p>}
                  {reviews.error && <p role="alert" className="text-meta text-destructive">Reflections couldn't be loaded. You can still write a highlight.</p>}
                </div>
                {selection !== "none" && (
                  <div className="space-y-1">
                    <Label htmlFor={`${id}-text`}>Your highlight</Label>
                    <Input id={`${id}-text`} value={highlight} maxLength={2000} onChange={(e) => {
                      setSelection("custom");
                      setHighlight(e.target.value);
                    }} />
                  </div>
                )}
                <section aria-label="Note preview" className="space-y-2">
                  <h2 className="font-medium">Preview</h2>
                  <p className="whitespace-pre-line rounded-lg border bg-muted p-3">{note}</p>
                  <p className="text-meta text-muted-foreground">Measured: days, recording time and takes. Estimated: clean seconds. Your note: real conversations and the highlight you choose.</p>
                </section>
              </div>
            )}
          </QueryView>}
        </QueryView>
        <DialogFooter>
          <Button variant="outline" disabled={copying} onClick={onClose}>Cancel</Button>
          <Button disabled={note === null || copying} onClick={() => void copy()}><Copy aria-hidden /> Copy</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
