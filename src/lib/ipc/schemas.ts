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
  exerciseType: ExerciseType.nullable(),
  durationMs: z.number().int().nonnegative(),
  attemptCount: z.number().int().nonnegative(),
  favorite: z.boolean(),
  hasNote: z.boolean(),
  tags: z.array(z.string()),
  status: SessionStatus,
});
export type SessionSummary = z.infer<typeof SessionSummary>;

// ── Trash (§6 Sessions, plan 2.17) ───────────────────────────────────────────
export const TRASH_RETENTION_CHOICES = [1, 7, 14, 30] as const;
export const TrashRetentionDays = z.union([z.literal(1), z.literal(7), z.literal(14), z.literal(30)]);
export type TrashRetentionDays = z.infer<typeof TrashRetentionDays>;

export const TrashItem = z.object({
  id: Id,
  title: z.string(),
  localDate: z.string(),
  deletedAt: z.string(), // ISO UTC
  purgeAt: z.string(), // ISO UTC; permanent deletion happens on the first start after this
  attemptCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  audioBytes: z.number().int().nonnegative(),
  unsavedTakeCount: z.number().int().nonnegative(),
});
export type TrashItem = z.infer<typeof TrashItem>;

export const TrashList = z.object({ retentionDays: TrashRetentionDays, items: z.array(TrashItem) });
export type TrashList = z.infer<typeof TrashList>;

export const PurgeOutcome = z.object({ filesPending: z.boolean() });
export type PurgeOutcome = z.infer<typeof PurgeOutcome>;

export const Attempt = z.object({
  id: Id,
  ordinal: z.number().int().positive(),
  captureState: CaptureState,
  analysisState: AnalysisState.nullable(),
  durationMs: z.number().int().nonnegative(),
  createdAt: z.string(),
  firstTake: z.boolean(),
  audioUnavailableReason: z.string().nullable().optional(),
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
  conditions: TaskConditions.nullable(),
  attempts: z.array(Attempt),
  conditionsUnavailableReason: z.string().nullable().optional(),
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

// ── Durable recording spike (§9, §15) ────────────────────────────────────────
export const SavedRecording = z.object({
  attemptId: Id,
  assetId: Id,
  title: z.string(),
  createdAtMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  sampleRate: z.number().int().positive(),
  channels: z.literal(1),
  sourceChannels: z.number().int().positive(),
  sourceFormat: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  recovered: z.boolean(),
});
export type SavedRecording = z.infer<typeof SavedRecording>;

/** Native peaks cache (plan 2.15): bucket maxima 0–32767 for one verified take. */
export const WaveformPeaks = z.object({
  version: z.number().int().positive(),
  assetId: Id,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sampleRate: z.number().int().positive(),
  durationMs: z.number().int().nonnegative(),
  samplesPerPeak: z.number().int().positive(),
  peaks: z.array(z.number().int().min(0).max(32767)),
});
export type WaveformPeaks = z.infer<typeof WaveformPeaks>;

export const RecoverableRecording = z.object({
  attemptId: Id,
  title: z.string(),
  createdAtMs: z.number().int().nonnegative().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  unavailableReason: z.string().nullable(),
});
export type RecoverableRecording = z.infer<typeof RecoverableRecording>;

export const RecordingStatus = z.object({
  attemptId: Id,
  phase: CaptureState,
  elapsedMs: z.number().int().nonnegative(),
  monotonicMs: z.number().int().nonnegative(),
  level: z.number().min(0).max(1),
  clipping: z.boolean(),
  error: z.string().nullable(),
  asset: SavedRecording.nullable(),
});
export type RecordingStatus = z.infer<typeof RecordingStatus>;

export const CredentialStatus = z.object({
  provider: z.literal("OpenAI"),
  present: z.boolean(),
}).strict();
export type CredentialStatus = z.infer<typeof CredentialStatus>;

const MicroUsd = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const BudgetSummary = z.object({
  currency: z.literal("USD"),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  stopMicroUsd: MicroUsd,
  warningMicroUsd: MicroUsd,
  countedMicroUsd: MicroUsd,
  coachingMicroUsd: MicroUsd,
  transcriptionMicroUsd: MicroUsd,
  uncertainMicroUsd: MicroUsd,
  remainingMicroUsd: MicroUsd,
  warning: z.boolean(),
}).strict();
export type BudgetSummary = z.infer<typeof BudgetSummary>;

export const CoachingPreview = z.object({
  version: z.literal(1), requestId: Id, payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  recipient: z.literal("https://api.openai.com/v1/responses"), model: z.string().min(1),
  selectedText: z.string().min(1), prompt: z.string(), focus: z.string(), instructions: z.string(),
  maximumOutputTokens: z.number().int().positive(), estimatedMaximumCostMicroUsd: MicroUsd,
  priceDate: z.string(), priceSource: z.url(), inputUsdPerMillionTokens: z.string(), outputUsdPerMillionTokens: z.string(),
  costExplanation: z.string(), expiresAtMs: z.number().int().nonnegative(),
}).strict();
export type CoachingPreview = z.infer<typeof CoachingPreview>;

export const FeedbackResult = z.object({
  version: z.literal(1), requestId: Id, providerRequestId: z.string().nullable(), provider: z.literal("OpenAI"), model: z.string(),
  transcriptRevisionId: Id, inputSha256: z.string().regex(/^[a-f0-9]{64}$/), provenance: z.literal("AI suggestion"), finishState: z.literal("completed"),
  feedback: z.object({ summary: z.string().min(1), oneImprovement: z.string().min(1), nextAttempt: z.string().min(1),
    corrections: z.array(z.object({kind: z.enum(["clear-error", "style"]), quote: z.string().min(1), suggestion: z.string().min(1), reason: z.string().min(1)}).strict()).max(3),
  }).strict(), inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(),
  usageUnavailableReason: z.string().nullable(), estimatedCostMicroUsd: MicroUsd.nullable(), costUnavailableReason: z.string().nullable(), createdAtMs: z.number().int().nonnegative(),
}).strict().superRefine((value, ctx) => {
  if ((value.inputTokens === null || value.outputTokens === null) && !value.usageUnavailableReason) ctx.addIssue({code:"custom",message:"Missing usage needs a reason"});
  if (value.estimatedCostMicroUsd === null && !value.costUnavailableReason) ctx.addIssue({code:"custom",message:"Missing cost needs a reason"});
});
export type FeedbackResult = z.infer<typeof FeedbackResult>;

const available = <T extends z.ZodType>(value: T) => z.object({
  value: value.nullable(), unavailableReason: z.string().min(1).max(512).nullable(),
}).strict().refine((v) => "value" in v && v.value !== undefined && (v.value === null) === (v.unavailableReason !== null), "Missing values require a reason; known values must not have one");
const TimedText = z.object({text: z.string().min(1), startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative(), provenance: z.literal("Estimated")})
  .strict().refine((v) => v.endMs >= v.startMs, "Timing end precedes start");
export const TranscriptionResult = z.object({
  version: z.literal(1), adapterVersion: z.string().min(1), provider: z.enum(["local-whisper", "openai"]),
  runId: Id, requestId: available(z.string().min(1)), assetId: Id,
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), preparedSha256: z.string().regex(/^[a-f0-9]{64}$/),
  modelId: z.string().min(1), modelSha256: available(z.string().regex(/^[a-f0-9]{64}$/)), language: available(z.string().min(1)),
  rawText: z.string().min(1), capabilities: z.object({segmentTimings: z.boolean(), wordTimings: z.boolean(), speakerLabels: z.boolean()}).strict(),
  segments: available(z.array(TimedText)), words: available(z.array(TimedText)), speakers: available(z.array(z.string().min(1))),
  settings: z.record(z.string(), z.unknown()), usage: z.object({inputTokens: available(z.number().int().nonnegative()), outputTokens: available(z.number().int().nonnegative()),
    audioDurationMs: available(z.number().int().nonnegative()), estimatedCostMicroUsd: available(MicroUsd)}).strict(),
  createdAtMs: z.number().int().nonnegative(),
}).strict().superRefine((v, ctx) => {
  if (v.words.value !== null && !v.capabilities.wordTimings || v.segments.value !== null && !v.capabilities.segmentTimings || v.speakers.value !== null && !v.capabilities.speakerLabels) {
    ctx.addIssue({code:"custom", message:"Result claims an unsupported capability"});
  }
});
export type TranscriptionResult = z.infer<typeof TranscriptionResult>;
