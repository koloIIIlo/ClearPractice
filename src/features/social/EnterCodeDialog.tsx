import { useId, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { challengeProblem, decodeChallenge } from "@/lib/social/codes";

export function EnterCodeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const id = useId();
  const problem = code.trim() ? challengeProblem(code) : null;
  const challenge = decodeChallenge(code);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Enter a code</DialogTitle>
          <DialogDescription>Play the same drill as a friend.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          if (!challenge) return;
          const search = new URLSearchParams({ seed: challenge.seed });
          for (const [key, value] of Object.entries(challenge.params)) search.set(key, String(value));
          onOpenChange(false);
          navigate(`/drill/${challenge.drillId}?${search}`);
        }}>
          <div className="space-y-1.5">
            <Label htmlFor={id}>Challenge code</Label>
            <Input id={id} className="h-10" value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} aria-invalid={!!problem} aria-describedby={problem ? `${id}-problem` : undefined} />
            {problem && <p id={`${id}-problem`} aria-live="polite" className="text-meta text-destructive">{problem}</p>}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={!challenge}>Play</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
