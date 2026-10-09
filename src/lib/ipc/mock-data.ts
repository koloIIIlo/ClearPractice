/**
 * Illustrative sample content for developing the UI before the native core
 * exists (M1). Nothing here is a real recording or a real analysis result.
 */
import { GUIDES } from "@/content/guides";
import { PROMPTS } from "@/content/prompts";
import { addLocalDays, toLocalDate } from "@/lib/phrase-schedule";
import type {
  Annotation,
  AttemptReview,
  ExerciseDefinition,
  Guide,
  PhraseCard,
  PracticePrompt,
  ProgressSummary,
  ProgressView,
  SessionDetail,
  TranscriptSegment,
} from "./schemas";

export const today = () => toLocalDate(new Date());
const daysAgo = (n: number) => addLocalDays(today(), -n);
const isoAt = (localDate: string, hh: number, mm: number) => {
  const [y, m, d] = localDate.split("-").map(Number);
  return new Date(y, m - 1, d, hh, mm).toISOString();
};

export const exercises: ExerciseDefinition[] = [
  {
    id: "ex-repeat",
    type: "repeat",
    version: 1,
    title: "Repeat an answer",
    purpose: "Say the same idea twice and make the second take clearer.",
    typicalMinutes: 6,
    example: "Describe one habit using point, reason, example.",
    instructions: [
      "Write up to three keywords: point, reason, example.",
      "Record about 60 seconds.",
      "Listen back and choose one thing to improve.",
      "Record the same answer again. The wording doesn't need to match.",
    ],
    attention: "Did you state your point early?",
  },
  {
    id: "ex-thought-groups",
    type: "thought_groups",
    version: 1,
    title: "Thought groups",
    purpose: "Finish one thought and leave space before the next.",
    typicalMinutes: 2,
    example: "Read a short passage with pause marks, then explain it freely.",
    instructions: [
      "Listen to or read the passage.",
      "Read it aloud, pausing at the marks.",
      "Hide the text and explain the idea in your own words.",
    ],
    attention: "Did you finish each thought before starting another?",
  },
  {
    id: "ex-imitate",
    type: "imitate",
    version: 1,
    title: "Listen and imitate",
    purpose: "Notice one feature of natural speech and try it yourself.",
    typicalMinutes: 3,
    example: "Repeat a 15-second clip, focusing on where the stress falls.",
    instructions: [
      "Listen to the clip once or twice.",
      "Choose one feature: emphasis, phrase rhythm, or clear endings.",
      "Record your repetition.",
      "Compare the two by listening, not by looking at waveforms.",
    ],
    attention: "Pick one feature. Ignore the rest for now.",
  },
  {
    id: "ex-expression",
    type: "expression",
    version: 1,
    title: "Use a better expression",
    purpose: "Make a saved expression your own by using it in new sentences.",
    typicalMinutes: 2,
    example: "Use “stumble over words” in three different sentences.",
    instructions: [
      "Read the expression and its explanation.",
      "Say or type three sentences that use it in different situations.",
      "Check that each sentence keeps the meaning you intended.",
    ],
    attention: "Can you use it in a situation you actually expect?",
  },
];

const cond = (
  familiarity: "familiar" | "unfamiliar",
  preparationSeconds: number,
  targetSeconds: number,
  audience: string | null = null,
  followUp = false,
) => ({ familiarity, preparationSeconds, targetSeconds, audience, followUp });

// A copy, so favourites and your own prompts never change the bundled pack.
export const prompts: PracticePrompt[] = PROMPTS.map((p) => ({ ...p }));

export const guides: Guide[] = GUIDES;

type SessionSeed = Omit<SessionDetail, "attempts"> & { attemptDurations: number[] };

const sessionSeeds: SessionSeed[] = [
  {
    id: "s-01", title: "A habit I want to change", localDate: daysAgo(0), startedAt: isoAt(daysAgo(0), 8, 5),
    exerciseType: "repeat", durationMs: 0, attemptCount: 0, favorite: true, hasNote: true, tags: ["daily"],
    status: "completed", prompt: "Describe a habit you would like to change and why.",
    outline: { point: "phone in the morning", reason: "loses time", example: "late for meeting" },
    focus: "State your point before explaining it.",
    notes: "Second take opened with the point. Still restarted once in the middle.",
    conditions: cond("familiar", 15, 60), attemptDurations: [28_400, 24_900],
  },
  {
    id: "s-02", title: "Preparing for a busy day", localDate: daysAgo(1), startedAt: isoAt(daysAgo(1), 19, 40),
    exerciseType: "repeat", durationMs: 0, attemptCount: 0, favorite: false, hasNote: false, tags: [],
    status: "completed", prompt: "Explain how you prepare for a busy day.",
    outline: { point: "plan the night before", reason: "calmer morning", example: "packed bag" },
    focus: "Finish each thought before starting another.", notes: "",
    conditions: cond("familiar", 15, 60), attemptDurations: [61_200, 57_800, 55_100],
  },
  {
    id: "s-03", title: "Explaining a work tool", localDate: daysAgo(3), startedAt: isoAt(daysAgo(3), 12, 15),
    exerciseType: "repeat", durationMs: 0, attemptCount: 0, favorite: false, hasNote: true, tags: ["unfamiliar", "work"],
    status: "completed", prompt: "Explain a tool you use at work to someone who has never seen it.",
    outline: { point: "", reason: "", example: "" },
    focus: "Adapt vocabulary to a beginner.", notes: "Hard without preparation, but the listener check helped.",
    conditions: cond("unfamiliar", 30, 90, "A beginner"), attemptDurations: [84_300],
  },
  {
    id: "s-04", title: "Thought groups: city parks", localDate: daysAgo(4), startedAt: isoAt(daysAgo(4), 7, 50),
    exerciseType: "thought_groups", durationMs: 0, attemptCount: 0, favorite: false, hasNote: false, tags: [],
    status: "completed", prompt: "Read the passage about city parks, then explain it.",
    outline: { point: "", reason: "", example: "" }, focus: null, notes: "",
    conditions: cond("familiar", 0, 60), attemptDurations: [41_000],
  },
  {
    id: "s-05", title: "Imitation: news headline", localDate: daysAgo(6), startedAt: isoAt(daysAgo(6), 18, 30),
    exerciseType: "imitate", durationMs: 0, attemptCount: 0, favorite: false, hasNote: false, tags: [],
    status: "completed", prompt: "Repeat the clip, focusing on phrase rhythm.",
    outline: { point: "", reason: "", example: "" }, focus: "Phrase rhythm", notes: "",
    conditions: cond("familiar", 0, 20), attemptDurations: [14_200, 13_900],
  },
  {
    id: "s-06", title: "A mistake that taught me something", localDate: daysAgo(8), startedAt: isoAt(daysAgo(8), 20, 5),
    exerciseType: "repeat", durationMs: 0, attemptCount: 0, favorite: true, hasNote: true, tags: ["story"],
    status: "completed", prompt: "Tell a short story about a mistake that taught you something.",
    outline: { point: "missed flight", reason: "didn't check", example: "" },
    focus: "Keep the story in order.", notes: "Good sequence in take 2.",
    conditions: cond("familiar", 30, 120), attemptDurations: [102_000, 96_500],
  },
  {
    id: "s-07", title: "Baseline", localDate: daysAgo(12), startedAt: isoAt(daysAgo(12), 9, 0),
    exerciseType: "repeat", durationMs: 0, attemptCount: 0, favorite: false, hasNote: false, tags: ["baseline"],
    status: "completed", prompt: "Describe something you would like to get better at and why.",
    outline: { point: "", reason: "", example: "" }, focus: null, notes: "",
    conditions: cond("unfamiliar", 0, 60), attemptDurations: [59_700],
  },
];

export const sessions: SessionDetail[] = sessionSeeds.map(({ attemptDurations, ...s }) => ({
  ...s,
  durationMs: attemptDurations.reduce((a, b) => a + b, 0),
  attemptCount: attemptDurations.length,
  attempts: attemptDurations.map((durationMs, i) => ({
    id: `${s.id}-a${i + 1}`,
    ordinal: i + 1,
    captureState: "saved" as const,
    analysisState: "completed" as const,
    durationMs,
    createdAt: s.startedAt,
    firstTake: i === 0,
  })),
}));

/** Finds the n-th occurrence of `needle` so sample annotations can't drift from their text. */
function span(segment: TranscriptSegment, needle: string, occurrence = 1) {
  let from = -1;
  for (let i = 0; i < occurrence; i++) {
    from = segment.text.indexOf(needle, from + 1);
    if (from < 0) throw new Error(`Sample annotation "${needle}" not found in ${segment.id}`);
  }
  return { segmentId: segment.id, start: from, end: from + needle.length };
}

function sampleReview(attemptId: string, take: 1 | 2): AttemptReview {
  const segs: TranscriptSegment[] =
    take === 1
      ? [
          { id: `${attemptId}-g1`, startMs: 400, endMs: 5_200, text: "So, um, I think the habit I want to change is, uh, checking my phone in the morning.", alignment: "segment" },
          { id: `${attemptId}-g2`, startMs: 5_200, endMs: 12_800, text: "Because when I wake up I, I usually take the phone and I read messages and news and like it takes a lot of time.", alignment: "segment" },
          { id: `${attemptId}-g3`, startMs: 12_800, endMs: 19_500, text: "For example yesterday I was reading for maybe forty minutes and then I was late for, for a meeting.", alignment: "segment" },
          { id: `${attemptId}-g4`, startMs: 21_400, endMs: 27_900, text: "So I would like to, um, leave the phone in the kitchen at night.", alignment: "segment" },
        ]
      : [
          { id: `${attemptId}-g1`, startMs: 300, endMs: 4_100, text: "I want to stop checking my phone first thing in the morning.", alignment: "segment" },
          { id: `${attemptId}-g2`, startMs: 4_900, endMs: 11_600, text: "When I read messages in bed, I lose track of time, sometimes forty minutes.", alignment: "segment" },
          { id: `${attemptId}-g3`, startMs: 12_400, endMs: 18_200, text: "Yesterday it made me late for a meeting, which was, um, embarrassing.", alignment: "segment" },
          { id: `${attemptId}-g4`, startMs: 19_300, endMs: 24_500, text: "So my plan is to leave the phone in the kitchen overnight.", alignment: "segment" },
        ];

  const ann = (id: string, s: ReturnType<typeof span>, category: Annotation["category"]): Annotation => ({
    id: `${attemptId}-${id}`,
    ...s,
    category,
    reviewState: "candidate",
  });

  const annotations: Annotation[] =
    take === 1
      ? [
          ann("n1", span(segs[0], "um"), "filler_candidate"),
          ann("n2", span(segs[0], "uh"), "filler_candidate"),
          ann("n3", span(segs[1], "I, I"), "repetition_candidate"),
          ann("n4", span(segs[1], "like"), "filler_candidate"),
          ann("n5", span(segs[2], "for, for"), "repetition_candidate"),
          ann("n6", span(segs[3], "um"), "filler_candidate"),
        ]
      : [ann("n1", span(segs[2], "um"), "filler_candidate")];

  const words = segs.reduce((n, s) => n + s.text.split(/\s+/).length, 0);
  const intervalMs = segs[segs.length - 1].endMs - segs[0].startMs;

  return {
    attemptId,
    revisions: [{ id: `${attemptId}-raw`, kind: "raw", parentId: null, segments: segs, annotations }],
    metrics: [
      { key: "duration", label: "Recording duration", value: take === 1 ? 28.4 : 24.9, unit: "s", source: "measured", unavailableReason: null },
      { key: "pace", label: "Estimated pace", value: Math.round(words / (intervalMs / 60_000)), unit: "words/min", source: "estimated", unavailableReason: null },
      { key: "pauses", label: "Pauses over 0.7 s", value: take === 1 ? 2 : 3, unit: "", source: "estimated", unavailableReason: null },
      { key: "fillers_reviewed", label: "Reviewed fillers per 100 words", value: null, unit: "", source: "estimated", unavailableReason: "Review the candidates to see a confirmed rate." },
    ],
    observations:
      take === 1
        ? [
            { id: `${attemptId}-o1`, source: "ai", title: "Try opening with your main point", detail: "The point arrives after a warm-up phrase. Say what you want to change in the first sentence.", quote: "So, um, I think the habit I want to change is, uh, checking my phone", segmentId: segs[0].id, nextAction: "Start take 2 with: “I want to stop …”" },
            { id: `${attemptId}-o2`, source: "estimated", title: "Two longer pauses", detail: "Pauses are not mistakes. The one before your conclusion gave the listener time to follow.", quote: null, segmentId: segs[3].id, nextAction: null },
          ]
        : [
            { id: `${attemptId}-o1`, source: "note", title: "Point stated first", detail: "The first sentence now carries the main point.", quote: "I want to stop checking my phone first thing in the morning.", segmentId: segs[0].id, nextAction: "Next: keep the example to one sentence." },
          ],
  };
}

export function reviewForAttempt(attemptId: string): AttemptReview {
  return sampleReview(attemptId, attemptId.endsWith("a1") ? 1 : 2);
}

export const phrases: PhraseCard[] = [
  { id: "ph-1", original: "I was reading for maybe forty minutes", expression: "I lost track of time", explanation: "A natural way to say time passed without you noticing.", examples: ["I lost track of time while cooking."], dueDate: today(), intervalDays: 3, sourceSessionId: "s-01" },
  { id: "ph-2", original: "I say the words wrong when nervous", expression: "I stumble over my words", explanation: "To speak with small hesitations or mistakes, often when nervous.", examples: [], dueDate: today(), intervalDays: 1, sourceSessionId: null },
  { id: "ph-3", original: "It is more better to plan", expression: "It's better to plan ahead", explanation: "“More better” doubles the comparison; “better” is enough.", examples: ["It's better to plan ahead before a trip."], dueDate: addLocalDays(today(), 2), intervalDays: 7, sourceSessionId: "s-02" },
  { id: "ph-4", original: "I want to say my opinion", expression: "I'd like to share my view", explanation: "Softer and more natural in a meeting. Both are understandable.", examples: [], dueDate: addLocalDays(today(), 5), intervalDays: 7, sourceSessionId: null },
  { id: "ph-5", original: "At the end I understood", expression: "In the end, I realised", explanation: "“In the end” means finally; “at the end” refers to the end of something specific.", examples: ["In the end, I realised the map was upside down."], dueDate: addLocalDays(today(), 11), intervalDays: 14, sourceSessionId: "s-06" },
];

export function progressFor(view: ProgressView): ProgressSummary {
  const done = sessions.filter((s) => s.status === "completed");
  const pick = (pred: (s: SessionDetail) => boolean) => done.filter(pred);
  const subset =
    view === "rehearsed"
      ? pick((s) => s.conditions?.familiarity === "familiar")
      : view === "unfamiliar"
        ? pick((s) => s.conditions?.familiarity === "unfamiliar")
        : [];
  const paces = [128, 131, null, 124, 136, 133, 129, 138];
  return {
    view,
    practiceMinutes: Math.round(subset.reduce((n, s) => n + s.durationMs, 0) / 60_000) + subset.length * 6,
    completedSessions: subset.length,
    points: subset
      .slice()
      .reverse()
      .map((s, i) => ({ date: s.localDate, sessionId: s.id, estimatedPaceWpm: paces[i % paces.length], ease: ((i % 3) + 2) as 2 | 3 | 4 })),
    highlight:
      view === "unfamiliar"
        ? { sessionId: "s-03", title: "Explaining a work tool", improvement: "Checked whether the listener followed before adding detail.", listenerFeedback: null }
        : view === "rehearsed"
          ? { sessionId: "s-01", title: "A habit I want to change", improvement: "Second take opened with the main point.", listenerFeedback: null }
          : null,
  };
}
