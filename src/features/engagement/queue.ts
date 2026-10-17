/**
 * The celebration queue (roadmap 9.10), apart from the definitions in
 * celebrations.ts so the host that drains it loads with the app shell and the
 * catalogue doesn't.
 */
export type Celebration = {
  kind: "level" | "weeklyGoal" | "achievement" | "record" | "quest" | "companion";
  headline: string;
  because: string | null;
  /** Toast only, whatever the style. */
  quiet: boolean;
};

// A small store the provider fills and the host drains.
type Listener = () => void;
let queue: Celebration[] = [];
const listeners = new Set<Listener>();
export const celebrationQueue = {
  enqueue(items: Celebration[]) {
    if (items.length === 0) return;
    queue = [...queue, ...items];
    listeners.forEach((l) => l());
  },
  take(): Celebration[] {
    const items = queue;
    queue = [];
    return items;
  },
  peek: () => queue,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  clear() {
    queue = [];
  },
};
