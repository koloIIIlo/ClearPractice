import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { useIpc } from "@/lib/ipc";
import { packCounts, validateContentPack } from "@/lib/content-pack";
import { keys } from "@/lib/ipc/queries";

export function ContentSettings() {
  const ipc = useIpc();
  const qc = useQueryClient();
  const packs = useQuery({ queryKey: ["content-packs"], queryFn: () => ipc.listContentPacks() });
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["content-packs"] });
    await qc.invalidateQueries({ queryKey: keys.prompts });
  };
  const add = useMutation({ mutationFn: () => ipc.importContentPack(), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => ipc.removeContentPack(id), onSuccess: refresh });
  const error = packs.error ?? add.error ?? remove.error;
  return <Panel title="Content packs">
    <div className="space-y-4">
      <p className="text-meta text-muted-foreground">Add prompts, drill topics, partner scenarios and missions from a .cppack.json file, up to 1 MB. Packs stay on this computer and are included in backups. Saved sessions keep their wording when you remove a pack.</p>
      <Button variant="outline" disabled={add.isPending || remove.isPending} onClick={() => add.mutate()}>Import a content pack…</Button>
      {packs.isPending && <p role="status">Loading content packs…</p>}
      {packs.data?.length === 0 && <p className="text-meta text-muted-foreground">No imported packs yet.</p>}
      <ul className="divide-y">{packs.data?.map((row) => {
        const pack = validateContentPack(row.json);
        const counts = packCounts(pack);
        return <li key={pack.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div><p className="font-medium">{pack.title}</p><p className="text-meta text-muted-foreground">{counts.prompts} prompts · {counts.drillTopics} drill topics · {counts.scenarios} scenarios · {counts.missions} missions</p></div>
          <Button variant="outline" disabled={remove.isPending || add.isPending} aria-label={`Remove ${pack.title}`} onClick={() => remove.mutate(pack.id)}>Remove</Button>
        </li>;
      })}</ul>
      {error && <p role="alert" className="text-destructive">{error.message}</p>}
    </div>
  </Panel>;
}
