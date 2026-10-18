/**
 * IPC shapes of real-world practice (roadmap M14): missions, events and their
 * plans, talks and rehearsal reports, the time capsule and listener packs.
 * Kept apart from `schemas.ts` so they load with the first real-world call,
 * not at start-up; `schemas.ts` re-exports their types.
 */
import { z } from "zod";
import { EventItemKind, Id, RealEventKind } from "./schemas";

const LocalDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** This week's mission (14.1), or the week skipped (no mission); done once its reflection is saved. */
export const MissionPick = z.object({ week: LocalDay, missionId: z.string().nullable(), pickedAt: z.string(), reviewId: z.string().nullable(), doneAt: z.string().nullable() }).strict();
export type MissionPick = z.infer<typeof MissionPick>;
/** An event you prepare for: your own content, deleted softly. */
export const PlannedEvent = z
  .object({
    id: Id, title: z.string().min(2).max(120), kind: RealEventKind, localDate: LocalDay, startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
    minutes: z.number().int().min(1).max(480).nullable(), audience: z.string(), goal: z.string(), talkId: z.string().nullable(), createdAt: z.string(),
  })
  .strict();
export type PlannedEvent = z.infer<typeof PlannedEvent>;
export type EventInput = { id?: string | null; title: string; kind: RealEventKind; localDate: string; startTime?: string | null; minutes?: number | null; audience: string; goal: string };
/** A plan item: ticked when its work appears, or by hand (then it no longer ticks itself). */
export const EventPlanItem = z
  .object({ id: Id, position: z.number().int().positive(), localDate: LocalDay, kind: EventItemKind, title: z.string().min(1), doneAt: z.string().nullable(), refId: z.string().nullable(), byHand: z.boolean() })
  .strict();
export type EventPlanItem = z.infer<typeof EventPlanItem>;
export type EventPlanItemInput = { localDate: string; kind: EventItemKind; title: string };
export const EventView = z.object({ event: PlannedEvent, items: z.array(EventPlanItem), debriefDone: z.boolean() }).strict();
export type EventView = z.infer<typeof EventView>;
/** A talk's outline (14.3): sections with up to three keywords and a target time. */
export const TalkSection = z
  .object({ id: Id, position: z.number().int().positive(), title: z.string().min(1).max(80), keywords: z.array(z.string()).max(3), notes: z.string(), targetSeconds: z.number().int().min(5).max(3600) })
  .strict();
export type TalkSection = z.infer<typeof TalkSection>;
export const Talk = z.object({ id: Id, title: z.string().min(2).max(120), template: z.string().nullable(), createdAt: z.string(), updatedAt: z.string() }).strict();
export type Talk = z.infer<typeof Talk>;
export const TalkView = z.object({ talk: Talk, sections: z.array(TalkSection).min(1), targetSeconds: z.number().int().nonnegative(), rehearsals: z.number().int().nonnegative() }).strict();
export type TalkView = z.infer<typeof TalkView>;
export type TalkSectionInput = { id?: string | null; title: string; keywords: string[]; notes: string; targetSeconds: number };
export type TalkInput = { id?: string | null; title: string; template?: string | null; sections: TalkSectionInput[] };
/** One section of a rehearsal (14.3): its span from your section marks; words, pace and hesitation candidates from segments that start in it (Estimated). */
export const RehearsalSection = z
  .object({
    sectionId: z.string(), title: z.string(), targetSeconds: z.number().int().nonnegative(), reached: z.boolean(), actualMs: z.number().int().nonnegative(),
    words: z.number().int().nonnegative().nullable(), paceWpm: z.number().nonnegative().nullable(), hesitations: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type RehearsalSection = z.infer<typeof RehearsalSection>;
/** A rehearsal's time per section, read from the sections as they were when you rehearsed. Never a verdict. */
export const RehearsalReport = z
  .object({
    attemptId: Id, talkId: Id, sessionId: Id, localDate: LocalDay, createdAt: z.string(), sections: z.array(RehearsalSection),
    totalTargetSeconds: z.number().int().nonnegative(), totalActualMs: z.number().int().nonnegative(), note: z.string().nullable(), transcribed: z.boolean(),
  })
  .strict();
export type RehearsalReport = z.infer<typeof RehearsalReport>;
/** This month's time capsule (14.5): offered for 7 days from the first app day of the month. */
export const CapsuleOffer = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), offeredOn: LocalDay, done: z.boolean(), dismissed: z.boolean(), show: z.boolean() }).strict();
export type CapsuleOffer = z.infer<typeof CapsuleOffer>;
/** A listener pack you saved for one take (14.4). */
export const ListenerPack = z
  .object({
    id: Id, sessionId: Id, attemptId: Id, questions: z.array(z.string().min(1).max(160)).min(1).max(5), from: z.string(), includeTranscript: z.boolean(),
    createdAt: z.string(), answerFiles: z.number().int().nonnegative(),
  })
  .strict();
export type ListenerPack = z.infer<typeof ListenerPack>;
/** A listener's words about a take, kept apart from your own notes; whether they got your main point is your judgement. */
export const ListenerFeedback = z
  .object({
    id: Id, packId: Id, sessionId: Id, attemptId: Id, listenerName: z.string(), answers: z.array(z.object({ question: z.string(), answer: z.string() }).strict()),
    answeredAt: z.string().nullable(), importedAt: z.string(), mainPointUnderstood: z.boolean().nullable(),
  })
  .strict();
export type ListenerFeedback = z.infer<typeof ListenerFeedback>;
/** An import: the same answer file a second time changes nothing. */
export const ListenerImport = z.object({ feedback: ListenerFeedback, alreadyImported: z.boolean() }).strict();
export type ListenerImport = z.infer<typeof ListenerImport>;
