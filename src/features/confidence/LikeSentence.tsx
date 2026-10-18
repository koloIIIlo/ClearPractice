import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIpc } from "@/lib/ipc";
import { keys } from "@/lib/ipc/queries";
import { cn } from "@/lib/utils";

/** The sentences you liked in one take (12.5), as `revisionId:segment`, and a toggle. */
export function useLikedSentences(attemptId: string, enabled = true) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const marks = useQuery({ queryKey: keys.segmentMarks(attemptId), queryFn: () => ipc.listSegmentMarks(attemptId), enabled: enabled && !!attemptId });
  const toggle = useMutation({
    mutationFn: ({ revisionId, segment, liked }: { revisionId: string; segment: number; liked: boolean }) => ipc.setSegmentMark(revisionId, segment, liked),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: keys.segmentMarks(attemptId) }), qc.invalidateQueries({ queryKey: ["engagement", "best-moments"] })]),
  });
  const liked = new Set((marks.data ?? []).map((m) => `${m.revisionId}:${m.segment}`));
  return { liked, toggle, ready: marks.isSuccess };
}

/**
 * ♡ Like on a transcript sentence (12.5): shown on hover and focus, always on
 * touch screens and once liked. Liked sentences lead the week's best moments.
 */
export function LikeButton({ liked, sentence, disabled, onToggle }: { liked: boolean; sentence: string; disabled?: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-pressed={liked}
      aria-label={`${liked ? "Unlike" : "Like"}: ${sentence.length > 60 ? `${sentence.slice(0, 57)}…` : sentence}`}
      title={liked ? "You liked this sentence" : "Like this sentence"}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "shrink-0 text-muted-foreground transition-opacity",
        liked ? "text-primary opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
      )}
    >
      <Heart aria-hidden className={cn(liked && "fill-current")} />
    </Button>
  );
}
