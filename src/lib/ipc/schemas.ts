/**
 * Data contracts between the UI and the native core (blueprint §15).
 * Every value crossing the IPC boundary is parsed with these schemas,
 * so a malformed native response fails loudly instead of rendering wrong data.
 */
import { z } from "zod";

export const Id = z.string().min(1);

// ── Evidence provenance (§6 Session review, §11) ─────────────────────────────
export const EvidenceSource = z.enum(["measured", "estimated", "note", "ai"]);
export type EvidenceSource = z.infer<typeof EvidenceSource>;

// ── Services (§6 Today header, §10) ──────────────────────────────────────────
export const ServiceState = z.enum(["ready", "needs_setup", "unavailable", "busy"]);
export const ServiceStatus = z.object({
  transcription: z.object({
    mode: z.enum(["local", "off"]),
    model: z.string().nullable(),
    state: ServiceState,
  }),
  coaching: z.object({
    mode: z.enum(["api", "local_llm", "off"]),
    providerLabel: z.string().nullable(),
    state: ServiceState,
  }),
  storage: z.object({ lastBackupAt: z.string().nullable() }),
});
export type ServiceStatus = z.infer<typeof ServiceStatus>;

// ── Curriculum (§7) ──────────────────────────────────────────────────────────
export const ExerciseType = z.enum(["repeat", "thought_groups", "imitate", "expression"]);
export type ExerciseType = z.infer<typeof ExerciseType>;

export const ExerciseDefinition = z.object({
  id: Id,
  type: ExerciseType,
  version: z.number().int().positive(),
  title: z.string(),
  purpose: z.string(),
  typicalMinutes: z.number().positive(),
  example: z.string(),
  instructions: z.array(z.string()),
  attention: z.string(),
});
export type ExerciseDefinition = z.infer<typeof ExerciseDefinition>;

export const Familiarity = z.enum(["familiar", "unfamiliar"]);
export type Familiarity = z.infer<typeof Familiarity>;

export const PromptTag = z.enum([
  "daily_life",
  "explanations",
  "opinions",
  "work",
  "storytelling",
  "unexpected",
]);
export type PromptTag = z.infer<typeof PromptTag>;

/** Task demands, described concretely instead of as a level badge (§6 Exercises). */
export const TaskConditions = z.object({
  familiarity: Familiarity,
  preparationSeconds: z.number().int().nonnegative(),
  targetSeconds: z.number().int().positive(),
  audience: z.string().nullable(),
  followUp: z.boolean(),
});
export type TaskConditions = z.infer<typeof TaskConditions>;

export const PracticePrompt = z.object({
  id: Id,
  text: z.string(),
  tags: z.array(PromptTag),
  conditions: TaskConditions,
  favorite: z.boolean(),
  source: z.enum(["bundled", "user"]),
});
export type PracticePrompt = z.infer<typeof PracticePrompt>;

export const Guide = z.object({
  id: Id,
  title: z.string(),
  summary: z.string(),
  minutes: z.number().positive(),
});
export type Guide = z.infer<typeof Guide>;

// ── Today (§2, §6 Today) ─────────────────────────────────────────────────────
export const PlanStep = z.object({
  exerciseType: ExerciseType,
  title: z.string(),
  minutes: z.number().positive(),
});

export const SessionLength = z.enum(["standard", "short"]);
export type SessionLength = z.infer<typeof SessionLength>;

// ── Sessions & attempts (§12) ────────────────────────────────────────────────
export const CaptureState = z.enum(["preparing", "recording", "finalizing", "saved", "interrupted"]);
export type CaptureState = z.infer<typeof CaptureState>;

export const AnalysisState = z.enum(["queued", "running", "completed", "failed", "canceled"]);
export type AnalysisState = z.infer<typeof AnalysisState>;

export const SessionStatus = z.enum(["in_progress", "completed", "interrupted"]);

export const SessionSummary = z.object({
  id: Id,
  title: z.string(),
  localDate: z.string(), // YYYY-MM-DD in the user's calendar
  startedAt: z.string(), // ISO UTC
  exerciseType: ExerciseType,
  durationMs: z.number().int().nonnegative(),
  attemptCount: z.number().int().nonnegative(),
  favorite: z.boolean(),
  hasNote: z.boolean(),
  tags: z.array(z.string()),
  status: SessionStatus,
});
export type SessionSummary = z.infer<typeof SessionSummary>;

export const Attempt = z.object({
  id: Id,
  ordinal: z.number().int().positive(),
  captureState: CaptureState,
  analysisState: AnalysisState.nullable(),
  durationMs: z.number().int().nonnegative(),
  createdAt: z.string(),
  firstTake: z.boolean(),
});
export type Attempt = z.infer<typeof Attempt>;

export const TranscriptSegment = z.object({
  id: Id,
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
  alignment: z.enum(["segment", "approximate"]),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegment>;

export const Annotation = z.object({
  id: Id,
  segmentId: Id,
  /** Character offsets within the segment text. */
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  category: z.enum(["filler_candidate", "repetition_candidate", "note"]),
  reviewState: z.enum(["candidate", "confirmed", "dismissed", "manual"]),
});
export type Annotation = z.infer<typeof Annotation>;

export const TranscriptRevision = z.object({
  id: Id,
  kind: z.enum(["raw", "user", "suggested"]),
  parentId: Id.nullable(),
  segments: z.array(TranscriptSegment),
  annotations: z.array(Annotation),
});
export type TranscriptRevision = z.infer<typeof TranscriptRevision>;

/** A value that can be missing for a stated reason — never silently zero (§11). */
export const MetricValue = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number().nullable(),
  unit: z.string(),
  source: EvidenceSource,
  unavailableReason: z.string().nullable(),
});
export type MetricValue = z.infer<typeof MetricValue>;

export const Observation = z.object({
  id: Id,
  source: EvidenceSource,
  title: z.string(),
  detail: z.string(),
  quote: z.string().nullable(),
  segmentId: Id.nullable(),
  nextAction: z.string().nullable(),
});
export type Observation = z.infer<typeof Observation>;

export const AttemptReview = z.object({
  attemptId: Id,
  revisions: z.array(TranscriptRevision),
  metrics: z.array(MetricValue),
  observations: z.array(Observation),
});
export type AttemptReview = z.infer<typeof AttemptReview>;

export const SessionDetail = SessionSummary.extend({
  prompt: z.string(),
  outline: z.object({ point: z.string(), reason: z.string(), example: z.string() }),
  focus: z.string().nullable(),
  notes: z.string(),
  conditions: TaskConditions,
  attempts: z.array(Attempt),
});
export type SessionDetail = z.infer<typeof SessionDetail>;

// ── Phrases (§6 Phrases) ─────────────────────────────────────────────────────
export const PhraseRating = z.enum(["again", "hard", "good"]);
export type PhraseRating = z.infer<typeof PhraseRating>;

export const PhraseCard = z.object({
  id: Id,
  original: z.string(),
  expression: z.string(),
  explanation: z.string(),
  examples: z.array(z.string()),
  dueDate: z.string(), // YYYY-MM-DD, local calendar
  intervalDays: z.number().int().nonnegative(),
  sourceSessionId: Id.nullable(),
});
export type PhraseCard = z.infer<typeof PhraseCard>;

// ── Progress (§6 Progress) ───────────────────────────────────────────────────
export const ProgressView = z.enum(["rehearsed", "unfamiliar", "real"]);
export type ProgressView = z.infer<typeof ProgressView>;

export const ProgressPoint = z.object({
  date: z.string(),
  sessionId: Id.nullable(),
  estimatedPaceWpm: z.number().nullable(),
  ease: z.number().int().min(1).max(5).nullable(),
});

export const ProgressSummary = z.object({
  view: ProgressView,
  practiceMinutes: z.number().nonnegative(),
  completedSessions: z.number().int().nonnegative(),
  points: z.array(ProgressPoint),
  highlight: z
    .object({ sessionId: Id, title: z.string(), improvement: z.string(), listenerFeedback: z.string().nullable() })
    .nullable(),
});
export type ProgressSummary = z.infer<typeof ProgressSummary>;

export const TodayPlan = z.object({
  localDate: z.string(),
  focus: z.string(),
  focusReason: z.string(),
  length: SessionLength,
  steps: z.array(PlanStep),
  resumable: SessionSummary.nullable(),
  lastCompleted: SessionSummary.nullable(),
  recentReflection: z.string().nullable(),
  duePhrase: PhraseCard.nullable(),
  weekly: z.object({
    newSituation: z.object({ promptId: Id, text: z.string(), familiarity: Familiarity, reason: z.string() }),
    realConversation: z.object({ task: z.string(), done: z.boolean() }),
  }),
});
export type TodayPlan = z.infer<typeof TodayPlan>;

// ── Search (§3 command palette) ──────────────────────────────────────────────
export const SearchHit = z.object({
  kind: z.enum(["session", "phrase", "prompt", "guide"]),
  id: Id,
  title: z.string(),
  excerpt: z.string().nullable(),
  href: z.string(),
});
export type SearchHit = z.infer<typeof SearchHit>;

// ── Audio devices (§6 Settings / onboarding) ─────────────────────────────────
export const InputConfig = z.object({
  channels: z.number().int().positive(),
  minSampleRate: z.number().int().positive(),
  maxSampleRate: z.number().int().positive(),
  sampleFormat: z.string().min(1),
});
export type InputConfig = z.infer<typeof InputConfig>;

export const InputDevice = z.object({
  id: Id,
  name: z.string(),
  isDefault: z.boolean(),
  available: z.boolean(),
  supportedConfigs: z.array(InputConfig),
});
export type InputDevice = z.infer<typeof InputDevice>;
