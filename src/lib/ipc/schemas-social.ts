import { z } from "zod";

const Id = z.string().regex(/^[a-z0-9_-]{1,64}$/);
const Seconds = z.number().int().min(0).max(3600).nullable();
const line = (max: number) => z.string().transform((s) => s.trim().replace(/\s+/g, " ")).pipe(z.string().max(max).refine((s) => !/[\x00-\x1f\x7f]/.test(s), "Use a single line."));
export const ClubKind = z.enum(["prepared", "table_topic", "evaluation", "other"]);
export type ClubKind = z.infer<typeof ClubKind>;
export const ClubCounter = z.enum(["um", "uh", "so", "like", "you_know", "other"]);
export type ClubCounter = z.infer<typeof ClubCounter>;
const Counts = z.partialRecord(ClubCounter, z.number().int().min(0).max(999));
export const ClubSpeechInput = z.object({
  id: Id.nullable().optional(), speaker: line(60).refine(Boolean, "Give each speaker a name."), kind: ClubKind,
  targetMinSeconds: Seconds.default(null), targetMaxSeconds: Seconds.default(null),
}).strict().refine((s) => s.targetMinSeconds === null && s.targetMaxSeconds === null || s.targetMinSeconds !== null && s.targetMaxSeconds !== null && s.targetMinSeconds < s.targetMaxSeconds,
  "A time window needs a minimum below its maximum, up to an hour.");
export type ClubSpeechInput = z.input<typeof ClubSpeechInput>;
export const ClubMeetingInput = z.object({
  id: Id.nullable().optional(), title: line(120).refine((s) => s.length >= 2, "Give the meeting a title of 2 to 120 characters."),
  localDate: z.iso.date(), wordOfTheDay: line(60).default(""), speeches: ClubSpeechInput.array().max(30),
}).strict().refine((m) => {
  const ids = m.speeches.flatMap((s) => s.id ? [s.id] : []);
  return new Set(ids).size === ids.length;
}, "A speaker is listed twice.");
export type ClubMeetingInput = z.input<typeof ClubMeetingInput>;
export const ClubSpeechResult = z.object({
  seconds: z.number().int().min(0).max(21600), counts: Counts.default({}), wordUsed: z.boolean().nullable().default(null),
  notes: z.string().max(2000).refine((s) => !s.includes("\0")).default(""),
}).strict();
export type ClubSpeechResult = z.input<typeof ClubSpeechResult>;
export const ClubSpeech = z.object({
  id: Id, position: z.number().int().positive(), speaker: z.string().min(1).max(60), kind: ClubKind,
  targetMinSeconds: Seconds, targetMaxSeconds: Seconds, seconds: z.number().int().min(0).max(21600).nullable(),
  counts: Counts, wordUsed: z.boolean().nullable(), notes: z.string().max(2000),
}).strict();
export type ClubSpeech = z.infer<typeof ClubSpeech>;
export const ClubMeeting = z.object({ id: Id, title: z.string().min(2).max(120), localDate: z.iso.date(), wordOfTheDay: z.string().max(60), createdAt: z.string() }).strict();
export type ClubMeeting = z.infer<typeof ClubMeeting>;
export const ClubMeetingView = z.object({ meeting: ClubMeeting, speeches: ClubSpeech.array().max(30) }).strict();
export type ClubMeetingView = z.infer<typeof ClubMeetingView>;
export const ClubMeetingSummary = z.object({ id: Id, title: z.string(), localDate: z.iso.date(), speeches: z.number().int().nonnegative(), timed: z.number().int().nonnegative() }).strict();
export type ClubMeetingSummary = z.infer<typeof ClubMeetingSummary>;
export const ClubLightState = z.object({ elapsedMs: z.number().nonnegative().max(21600000), light: z.enum(["green", "amber", "red"]).nullable(), running: z.boolean() }).strict();
export type ClubLightState = z.infer<typeof ClubLightState>;
