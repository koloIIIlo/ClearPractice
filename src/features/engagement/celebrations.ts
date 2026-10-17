import { formatDay } from "@/lib/format";
import { ACHIEVEMENTS } from "@/lib/engagement/achievements";
import { recordDef } from "@/lib/engagement/records";
import { areaDef, LEVELS } from "@/lib/engagement/skills";
import { questTemplate } from "@/lib/engagement/quests";
import type { AreaId } from "@/lib/engagement/types";
import type { RecordRow, UnlockOutcome } from "@/lib/ipc/schemas";
import type { Celebration } from "./queue";

/**
 * What reaching something looks like (roadmap 9.10, appendix D.4): brief,
 * about the task and never the person, then out of the way. Quiet ones (a
 * quest, Sprout, a low-key record) are only ever a toast.
 */
export type { Celebration } from "./queue";
export { celebrationQueue } from "./queue";

const ORDER: Celebration["kind"][] = ["level", "weeklyGoal", "achievement", "record", "quest", "companion"];
const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

export function recordLine(row: RecordRow, history: readonly RecordRow[] = []): string {
  const def = recordDef(row.record);
  const value = def ? def.format(row.value) : `${row.value} ${row.unit}`;
  if (row.previous == null) return `${def?.title ?? row.record}: ${value}`;
  const before = [...history].reverse().find((r) => r.record === row.record && r.id !== row.id && r.value === row.previous);
  const previous = def ? def.format(row.previous) : String(row.previous);
  return `${def?.title ?? row.record}: ${value} (previous ${previous.replace(/ words$| phrases$/, "")}${before ? `, ${formatDay(before.achievedAt.slice(0, 10))}` : ""})`;
}

/** Celebrations for what was recorded, in a fixed order. Starting points of records are silent. */
export function celebrationsFrom(
  outcome: UnlockOutcome,
  extra: { goal?: { days: number; goal: number; weeksInARow: number }; companionGrew?: boolean; history?: readonly RecordRow[] } = {},
): Celebration[] {
  const out: Celebration[] = [];
  for (const l of outcome.levels) {
    const def = LEVELS[l.area as AreaId]?.[l.level - 1];
    if (!def) continue;
    out.push({ kind: "level", headline: clip(`${areaDef(l.area as AreaId).short} · level ${l.level} · ${def.name}`, 40), because: clip(`${def.criteria.map((c) => c.label).join("; ")}.`, 90), quiet: false });
  }
  if (outcome.weeklyGoal && extra.goal) {
    const { days, goal, weeksInARow } = extra.goal;
    out.push({ kind: "weeklyGoal", headline: "Weekly goal reached", because: `${days} of ${goal} days. ${weeksInARow >= 2 ? `That's ${weeksInARow} weeks in a row.` : "Rest well."}`, quiet: false });
  }
  for (const a of outcome.achievements) {
    const def = ACHIEVEMENTS.find((d) => d.id === a.id);
    if (def) out.push({ kind: "achievement", headline: clip(`Achievement: ${def.title}`, 40), because: clip(def.description, 90), quiet: false });
  }
  for (const r of outcome.records) {
    if (r.previous == null) continue;
    const def = recordDef(r.record);
    const quiet = def?.celebrate !== "card";
    out.push(quiet
      ? { kind: "record", headline: clip(`New best: ${(def?.title ?? r.record).toLowerCase()}, ${def ? def.format(r.value) : r.value}`, 90), because: null, quiet: true }
      : { kind: "record", headline: "New personal record", because: clip(`${recordLine(r, extra.history)}.`, 90), quiet: false });
  }
  for (const q of outcome.questsDone) {
    out.push({ kind: "quest", headline: `Quest done: ${questTemplate(q.quest)?.title ?? q.quest} · +30 XP`, because: null, quiet: true });
  }
  if (extra.companionGrew) out.push({ kind: "companion", headline: "Sprout grew a new leaf", because: null, quiet: true });
  return out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

/** At most three per refresh; the rest are summarised (appendix D.4 "And 2 more in Journey"). */
export function limitBatch(items: Celebration[], max = 3): Celebration[] {
  if (items.length <= max) return items;
  const rest = items.length - max;
  return [...items.slice(0, max), { kind: "achievement", headline: `And ${rest} more in Journey`, because: null, quiet: true }];
}
