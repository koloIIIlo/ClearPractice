import { QueryView } from "@/components/page";
import { formatDay } from "@/lib/format";
import { useListenerFeedback } from "@/lib/ipc/queries";
import type { ListenerFeedback } from "@/lib/ipc/schemas";

/** One row per listener, derived only from imported answer files (15.1). */
function groupBuddies(feedback: readonly ListenerFeedback[]) {
  const groups = new Map<string, { name: string; count: number; lastDate: string }>();
  for (const file of feedback) {
    const name = file.listenerName.trim();
    const key = name.toLowerCase();
    const date = file.importedAt.slice(0, 10);
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      if (date > group.lastDate) group.lastDate = date;
    } else groups.set(key, { name: name || "Unnamed listener", count: 1, lastDate: date });
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function Buddies() {
  const feedback = useListenerFeedback();
  return (
    <section aria-label="Buddies" className="space-y-2">
      <h2 className="font-medium text-foreground">Buddies</h2>
      <QueryView query={feedback}>
        {(files) => files.length === 0 ? (
          <p>Import a listener's answer file to see them here.</p>
        ) : (
          <ul className="space-y-3">
            {groupBuddies(files).map((buddy, i) => (
              <li key={i}>
                <p className="font-medium text-foreground">{buddy.name}</p>
                <p>{buddy.count} answer {buddy.count === 1 ? "file" : "files"} · Last imported <time dateTime={buddy.lastDate}>{formatDay(buddy.lastDate)}</time></p>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </section>
  );
}
