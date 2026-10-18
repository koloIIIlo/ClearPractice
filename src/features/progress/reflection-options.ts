import type { TransferFlow, TransferTag } from "@/lib/ipc/schemas";
import { toLocalDate } from "@/lib/phrase-schedule";

/** Today and the 13 days before it, newest first. */
export const RECENT_DAYS = () => Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - i); return toLocalDate(d); });

/** The reflection fields used by levels (9.16): your own reading, Your note. */
export const FLOWS: { value: TransferFlow; label: string }[] = [
  { value: "smooth", label: "Smoothly" },
  { value: "mixed", label: "Mixed" },
  { value: "hard", label: "With effort" },
];
export const KINDS: { value: TransferTag; label: string }[] = [
  { value: "story", label: "Story" },
  { value: "meeting", label: "Meeting" },
  { value: "presentation", label: "Presentation" },
  { value: "interview", label: "Interview" },
  { value: "small_talk", label: "Small talk" },
  { value: "phone", label: "Phone call" },
  { value: "other", label: "Other" },
];

/** The four after-action questions (12.4), in plain words. */
export const AAR_QUESTIONS = [
  { key: "planned", label: "What did you plan to do?" },
  { key: "happened", label: "What actually happened?" },
  { key: "why", label: "Why was there a difference, if any?" },
  { key: "nextTime", label: "What will you do next time?" },
] as const;
