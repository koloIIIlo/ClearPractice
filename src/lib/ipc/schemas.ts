import { APP_VERSION } from "@/lib/app-version";
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
    /** "api" = cloud transcription chosen as the default (D-26); `model` names the provider. */
    mode: z.enum(["local", "api", "off"]),
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
/** The drills of roadmap M10, each an exercise type of its own (D-30). */
export const DRILL_TYPES = ["jam", "roulette", "word_bomb", "three_ways", "emphasis", "pace_ladder", "story_spine", "story_cubes", "pitch", "steelman", "daily", "gauntlet", "boss"] as const;
export type DrillType = (typeof DRILL_TYPES)[number];
/** Core exercises, drills, saying a phrase aloud during review (M11), the partner's conversations and upgrade loops (M13), and a talk's rehearsals and the time capsule (M14). */
export const ExerciseType = z.enum(["repeat", "thought_groups", "imitate", "expression", ...DRILL_TYPES, "phrase_say_it", "conversation", "upgrade", "rehearsal", "capsule"]);
export type ExerciseType = z.infer<typeof ExerciseType>;
export const isDrillType = (type: string | null | undefined): type is DrillType => !!type && (DRILL_TYPES as readonly string[]).includes(type);

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

/** A run's settings (roadmap 7.3): seed, parameters and group, kept with its session. */
export const ActivityContext = z
  .object({
    version: z.number().int().min(1).max(1000),
    seed: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
    groupId: z.string().regex(/^[A-Za-z0-9_-]{1,96}$/).nullable().optional(),
    params: z.record(z.string().min(1).max(40), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).default({}),
  })
  .strict();
export type ActivityContext = z.infer<typeof ActivityContext>;
/** Which step of a run a take answered (7.3); the take's own prompt when a run asks several. */
export const ActivityStep = z
  .object({ index: z.number().int().min(0).max(50), key: z.string().regex(/^[a-z0-9_-]{1,40}$/), promptId: z.string().nullable().optional() })
  .strict();
export type ActivityStep = z.infer<typeof ActivityStep>;

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

/** A real-conversation reflection (4.17). `listenerText` is the listener's own words; `selfReport` is yours. */
/** How your speaking flowed in a real conversation (9.16, Your note). */
export const TransferFlow = z.enum(["smooth", "mixed", "hard"]);
export type TransferFlow = z.infer<typeof TransferFlow>;
/** What kind of conversation it was (9.16). */
export const TransferTag = z.enum(["story", "meeting", "presentation", "interview", "small_talk", "phone", "other"]);
export type TransferTag = z.infer<typeof TransferTag>;
/** An after-action review's four answers (12.4): what you planned, what happened, why, and what next time. */
export const AfterAction = z.object({ planned: z.string(), happened: z.string(), why: z.string(), nextTime: z.string(), /** The event it debriefs (14.2). */ eventId: Id.optional() }).strict();
export type AfterAction = z.infer<typeof AfterAction>;
export const TransferKind = z.enum(["reflection", "aar"]);
export type TransferKind = z.infer<typeof TransferKind>;
export const TransferReview = z.object({
  id: Id, localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), situation: z.string().min(1), preparation: z.string(),
  listenerText: z.string(), clarification: z.string(), success: z.string(), selfReport: z.string(), nextFocus: z.string(), createdAt: z.string(),
  flow: TransferFlow.nullable().default(null), tags: z.array(TransferTag).default([]),
  /** A reflection, or an after-action review with its four answers (12.4). */
  kind: TransferKind.default("reflection"), extra: AfterAction.nullable().default(null),
  /** The mission it logs (14.1). */
  missionId: z.string().nullable().default(null),
}).strict();
export type TransferReview = z.infer<typeof TransferReview>;
export type TransferInput = Omit<TransferReview, "id" | "createdAt" | "flow" | "tags" | "kind" | "extra" | "missionId"> & {
  flow?: TransferFlow | null; tags?: TransferTag[]; kind?: TransferKind; extra?: AfterAction | null; missionId?: string | null;
};
/** What you write for your own prompt (4.13). */
export type PromptInput = { text: string; tags: PromptTag[]; conditions: TaskConditions };
/** Your prompts and favourite marks, stored natively; bundled prompts come from the content pack. */
export const PromptState = z.object({
  userPrompts: z.array(z.object({ id: Id, text: z.string().min(1), tags: z.array(PromptTag), conditions: TaskConditions }).strict()),
  favorites: z.array(z.object({ promptId: Id, favorite: z.boolean() }).strict()),
}).strict();

export const GuideSection = z.object({ heading: z.string(), paragraphs: z.array(z.string()).min(1) });
export const Guide = z.object({
  id: Id,
  title: z.string(),
  summary: z.string(),
  minutes: z.number().positive(),
  /** Full offline text (4.3). */
  sections: z.array(GuideSection).min(1),
});
export type Guide = z.infer<typeof Guide>;

// ── Today (§2, §6 Today) ─────────────────────────────────────────────────────
export const PlanStep = z.object({
  exerciseType: ExerciseType,
  title: z.string(),
  minutes: z.number().positive(),
  /** A drill step (M11: warm-up, mixed set, sprint) opens /drill/<drillId>. */
  drillId: z.string().optional(),
  /** A step that opens a particular page, e.g. an imitation session on endings (11.8). */
  to: z.string().optional(),
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
  /** Takes with at least one transcript (local, cloud or your correction); absent where not computed. */
  transcribedTakes: z.number().int().nonnegative().optional(),
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

// ── Reference clips (4.4, 4.4a) ──────────────────────────────────────────────
export const ReferenceClip = z.object({
  id: Id,
  origin: z.enum(["user", "bundled"]),
  title: z.string(),
  source: z.string(),
  transcript: z.string().nullable(),
  description: z.string().nullable().optional(),
  feature: z.enum(["emphasis", "rhythm", "endings"]).nullable().optional(),
  durationMs: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAtMs: z.number().int().nonnegative(),
  /** Library folder (4.4h); null = unfiled. */
  folderId: Id.nullable().optional(),
  /** The imported recording and range it was cut from (4.4i). */
  sourceId: Id.nullable().optional(),
  sourceStartMs: z.number().int().nonnegative().nullable().optional(),
  sourceEndMs: z.number().int().nonnegative().nullable().optional(),
});
export type ReferenceClip = z.infer<typeof ReferenceClip>;
export const ClipFolder = z.object({ id: Id, name: z.string().min(1), clipCount: z.number().int().nonnegative(), createdAtMs: z.number().int().nonnegative() });
export type ClipFolder = z.infer<typeof ClipFolder>;
/** A recording in the import history (4.4i). */
export const ClipSource = z.object({
  id: Id, title: z.string(), origin: z.enum(["file", "link"]), link: z.string().nullable(), credit: z.string(), fileName: z.string(), audioFile: z.string(),
  durationMs: z.number().int().positive(), transcribedWith: z.enum(["local", "deepgram", "assemblyai"]), createdAtMs: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative(), clipCount: z.number().int().nonnegative(), pickCount: z.number().int().nonnegative(), audioAvailable: z.boolean(),
});
export type ClipSource = z.infer<typeof ClipSource>;
export const SavedRange = z.object({ clipId: Id, title: z.string(), startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative() });
export type SavedRange = z.infer<typeof SavedRange>;
/** A chosen file, decoded whole for preview before a section is kept. */
export const ClipStaged = z.object({ stagingId: Id, fileName: z.string(), durationMs: z.number().int().positive() });
export type ClipStaged = z.infer<typeof ClipStaged>;
/** A proposed clip from a long recording (4.4c): whole sentences, 8–20 s. */
export const ClipCandidate = z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(), text: z.string(), title: z.string() });
export type ClipCandidate = z.infer<typeof ClipCandidate>;
/** AI suggestion for one proposed clip (4.4c), labelled as such and editable. */
export const ClipName = z.object({ index: z.number().int().positive(), title: z.string(), description: z.string(), feature: z.enum(["emphasis", "rhythm", "endings"]) });
export type ClipName = z.infer<typeof ClipName>;
/** An AI suggestion from your own words (AI suggestion provenance): the request numbers sessions from 1. */
export const PhraseSuggestion = z.object({
  session: z.number().int().positive(),
  original: z.string().min(1),
  expression: z.string().min(1),
  explanation: z.string(),
  example: z.string(),
});
export type PhraseSuggestion = z.infer<typeof PhraseSuggestion>;
/** A passage the AI chose (4.4e), already validated into whole sentences of 5–30 s. */
export const PickedClip = z.object({
  startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(), text: z.string(), title: z.string(),
  description: z.string(), feature: z.enum(["emphasis", "rhythm", "endings"]), reason: z.string(),
});
export type PickedClip = z.infer<typeof PickedClip>;
/** An earlier AI choice for a source (4.4i). */
export const PickRun = z.object({ id: Id, model: z.string(), toneHint: z.boolean(), picks: PickedClip.array(), createdAtMs: z.number().int().nonnegative() });
export type PickRun = z.infer<typeof PickRun>;
/** A source reopened from the history: staged again with its transcript. */
export const OpenedSource = z.object({ source: ClipSource, staged: ClipStaged, candidates: ClipCandidate.array(), saved: SavedRange.array(), picks: PickRun.array() });
export type OpenedSource = z.infer<typeof OpenedSource>;
export const LinkToolStatus = z.object({ available: z.boolean(), path: z.string().nullable() });
export type LinkToolStatus = z.infer<typeof LinkToolStatus>;
/** Audio fetched from a YouTube link with the user's yt-dlp (4.4d), staged like an imported file. */
export const LinkAudio = z.object({ staged: ClipStaged, title: z.string(), uploader: z.string(), url: z.string(), source: z.string() });
export type LinkAudio = z.infer<typeof LinkAudio>;

/** A single take in Trash whose session is still in use (2.23). */
export const TrashTake = z.object({
  id: Id,
  sessionId: Id,
  sessionTitle: z.string(),
  ordinal: z.number().int().positive(),
  deletedAt: z.string(),
  purgeAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  audioBytes: z.number().int().nonnegative(),
});
export type TrashTake = z.infer<typeof TrashTake>;

export const TrashList = z.object({ retentionDays: TrashRetentionDays, items: z.array(TrashItem), takes: z.array(TrashTake) });
export type TrashList = z.infer<typeof TrashList>;

export const PurgeOutcome = z.object({ filesPending: z.boolean() });
export type PurgeOutcome = z.infer<typeof PurgeOutcome>;

// ── Backups (§13, plan 2.18–2.19) ────────────────────────────────────────────
export const BackupRecord = z.object({
  id: Id,
  createdAt: z.string(), // ISO UTC
  fileName: z.string(),
  status: z.enum(["verified", "failed"]),
});
export type BackupRecord = z.infer<typeof BackupRecord>;

export const BACKUP_KEEP_CHOICES = [2, 4, 8, 12] as const;
export const BackupKeep = z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(12)]);
export type BackupKeep = z.infer<typeof BackupKeep>;

export const BackupStatus = z.object({
  destination: z.string().nullable(), // display only; never sent back to the native core
  destinationAvailable: z.boolean(),
  backups: z.array(BackupRecord),
  autoEnabled: z.boolean(),
  keep: BackupKeep,
  nextDueAtMs: z.number().int().nonnegative().nullable(), // 0 = as soon as possible; null = off or no folder
});
export type BackupStatus = z.infer<typeof BackupStatus>;

export const BackupSummary = z.object({
  id: Id,
  fileName: z.string(),
  createdAtMs: z.number().int().nonnegative(),
  recordings: z.number().int().nonnegative(),
  unavailableRecordings: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
});
export type BackupSummary = z.infer<typeof BackupSummary>;

export const RestorePreview = z.object({
  stagingId: Id,
  backupId: Id,
  createdAtMs: z.number().int().nonnegative(),
  appVersion: z.string(),
  schemaVersion: z.number().int().positive(),
  sessions: z.number().int().nonnegative(),
  trashedSessions: z.number().int().nonnegative(),
  recordings: z.number().int().nonnegative(),
  audioBytes: z.number().int().nonnegative(),
  unavailableRecordings: z.number().int().nonnegative(),
});
export type RestorePreview = z.infer<typeof RestorePreview>;

export const RestoreOutcome = z.object({ rollbackFolder: z.string() });

export const ExportSummary = z.object({
  fileName: z.string(),
  recordings: z.number().int().nonnegative(),
  unavailableRecordings: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
});
export type ExportSummary = z.infer<typeof ExportSummary>;
export type RestoreOutcome = z.infer<typeof RestoreOutcome>;

// ── Local transcription in the app (plan 3.1–3.4, 3.8) ──────────────────────
export const TranscriptionSetup = z.object({
  configured: z.boolean(),
  modelId: z.string().nullable(),
  backend: z.enum(["cpu", "cuda"]).nullable(),
  prompt: z.string().nullable(),
  unavailableReason: z.string().nullable(),
});
export type TranscriptionSetup = z.infer<typeof TranscriptionSetup>;

/** One-click local Whisper (pinned whisper.cpp 1.9.1 and model, verified before install). */
export const WhisperBackend = z.enum(["cpu", "cuda"]);
export const WhisperModelChoice = z.enum(["large-v3-turbo-q5_0", "base"]);
export const WhisperChoice = z.object({ backend: WhisperBackend, model: WhisperModelChoice });
export type WhisperChoice = z.infer<typeof WhisperChoice>;
export const WhisperDownloadOptions = z.object({
  nvidiaGpu: z.boolean(),
  sizes: z.array(WhisperChoice.extend({ downloadBytes: z.number().int().nonnegative() })),
});
export type WhisperDownloadOptions = z.infer<typeof WhisperDownloadOptions>;
export const WhisperDownloadProgress = z.object({
  stage: z.enum(["runtime", "gpu-libraries", "model", "installing"]),
  received: z.number().nonnegative(),
  total: z.number().nonnegative(),
});
export type WhisperDownloadProgress = z.infer<typeof WhisperDownloadProgress>;

/** Pitch and loudness contour (milestone P); None values are gaps, never zero. */
export const IntonationContour = z.object({
  algorithm: z.string(),
  source: z.literal("Estimated"),
  hopMs: z.number().int().positive(),
  sampleRate: z.number().int().positive(),
  f0Hz: z.array(z.number().positive().nullable()),
  rmsDb: z.array(z.number().nullable()),
  medianF0Hz: z.number().positive().nullable(),
  rangeSemitones: z.number().nonnegative().nullable(),
  loudnessRangeDb: z.number().nonnegative().nullable().default(null),
  unavailableReason: z.string().nullable(),
});
export type IntonationContour = z.infer<typeof IntonationContour>;

export const ModelPack = z.object({
  id: Id,
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  license: z.string(),
  language: z.string(),
  source: z.string(),
  installed: z.boolean(),
});
export type ModelPack = z.infer<typeof ModelPack>;

export const SavedSegment = z.object({
  text: z.string(),
  startMs: z.number().int().nonnegative().nullable(),
  endMs: z.number().int().nonnegative().nullable(),
  timingSource: z.enum(["Measured", "Estimated"]),
  timingUnavailableReason: z.string().nullable(),
});
export type SavedSegment = z.infer<typeof SavedSegment>;

/** A word or phrase you use often, or a hedge, with the segments it was heard in (8.1). */
export const WordCount = z.object({ word: z.string(), count: z.number().int().positive(), segments: z.array(z.number().int().nonnegative()) }).strict();
export type WordCount = z.infer<typeof WordCount>;
/** The opening or ending sentence, quoted for your self-check (8.1, 8.3). */
export const Edge = z
  .object({ text: z.string(), segment: z.number().int().nonnegative(), hint: z.enum(["starts_with_hesitation", "trails_off"]).nullable() })
  .strict();
export type Edge = z.infer<typeof Edge>;
export const Runs = z
  .object({
    meanWords: z.number().nonnegative(),
    longestWords: z.number().int().nonnegative(),
    longestFromSegment: z.number().int().nonnegative(),
    longestToSegment: z.number().int().nonnegative(),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type Runs = z.infer<typeof Runs>;

/** Transcript-derived review measures (plan 3.6–3.7; v2 in roadmap 8.1); all Estimated, missing values carry a reason. */
export const TranscriptMeasures = z.object({
  definitionVersion: z.number().int().positive(),
  source: z.literal("Estimated"),
  wordCount: z.number().int().nonnegative(),
  speechSpanMs: z.number().int().nonnegative().nullable(),
  paceWpm: z.number().nonnegative().nullable(),
  paceUnavailableReason: z.string().nullable(),
  pauseThresholdMs: z.number().int().positive(),
  pauses: z.array(z.object({ afterSegment: z.number().int().nonnegative(), startMs: z.number().int().nonnegative(), durationMs: z.number().int().nonnegative() })),
  pausesUnavailableReason: z.string().nullable(),
  fillers: z.array(
    z.object({
      segment: z.number().int().nonnegative(),
      word: z.string(),
      segmentStartMs: z.number().int().nonnegative().nullable(),
      /** The word's own time, when a cloud transcript timed every filler (Estimated); else null. */
      wordStartMs: z.number().int().nonnegative().nullable().default(null),
      wordEndMs: z.number().int().nonnegative().nullable().default(null),
      /** Your review of this candidate; null until you decide. */
      decision: z.enum(["confirmed", "dismissed"]).nullable().default(null),
    }),
  ),
  repeatedWords: z.array(z.string()),
  untimedSegments: z.number().int().nonnegative(),
  // Measures v2 (8.1). Optional, so v1 measures still parse.
  /** Speech between pauses (mean length of run). */
  runs: Runs.nullable().optional(),
  runsUnavailableReason: z.string().nullable().optional(),
  /** Parallel to `pauses`: between clauses or inside one. */
  pauseKinds: z.array(z.enum(["boundary", "mid_clause"])).optional(),
  watchWords: z.array(WordCount).optional(),
  hedges: z.array(WordCount).optional(),
  wordsUnavailableReason: z.string().nullable().optional(),
  /** Different words in every 50 (moving window). */
  differentPer50: z.number().nonnegative().nullable().optional(),
  vocabularyUnavailableReason: z.string().nullable().optional(),
  opener: Edge.nullable().optional(),
  ending: Edge.nullable().optional(),
  /** Pauses found in the recording's own waveform (plan 3.5); preferred over segment gaps. */
  voice: z
    .object({
      method: z.string(),
      source: z.literal("Estimated"),
      speechStartMs: z.number().int().nonnegative().nullable(),
      speechEndMs: z.number().int().nonnegative().nullable(),
      pauses: z.array(z.object({ afterSegment: z.number().int().nonnegative(), startMs: z.number().int().nonnegative(), durationMs: z.number().int().nonnegative() })),
      unavailableReason: z.string().nullable(),
    })
    .nullable()
    .default(null),
});
export type TranscriptMeasures = z.infer<typeof TranscriptMeasures>;

export const TranscriptJob = z.object({
  id: Id,
  state: z.enum(["running", "completed", "failed", "canceled", "interrupted"]),
  errorMessage: z.string().nullable(),
  createdAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type TranscriptJob = z.infer<typeof TranscriptJob>;

export const AttemptTranscript = z.object({
  attemptId: Id,
  revision: z
    .object({
      id: Id,
      source: z.enum(["local", "api", "user"]),
      provider: z.string().nullable(),
      modelId: z.string().nullable(),
      backend: z.string().nullable(),
      prompt: z.string().nullable(),
      language: z.string().nullable(),
      text: z.string(),
      workerElapsedMs: z.number().int().nonnegative().nullable(),
      createdAt: z.string(),
      segments: z.array(SavedSegment),
      measures: TranscriptMeasures,
    })
    .nullable(),
  /** Your corrected wording (a child revision); the machine transcript above is never changed. */
  correction: z
    .object({ id: Id, parentId: Id, text: z.string(), createdAt: z.string(), fillerCount: z.number().int().nonnegative(), wordCount: z.number().int().nonnegative() })
    .nullable()
    .default(null),
  job: TranscriptJob.nullable(),
});
export type AttemptTranscript = z.infer<typeof AttemptTranscript>;

export const TranscriptionEvent = z.object({
  jobId: Id,
  attemptId: Id,
  phase: z.string(),
  percent: z.number().int().min(0).max(100).nullable(),
});
export type TranscriptionEvent = z.infer<typeof TranscriptionEvent>;

export const Attempt = z.object({
  id: Id,
  ordinal: z.number().int().positive(),
  captureState: CaptureState,
  analysisState: AnalysisState.nullable(),
  durationMs: z.number().int().nonnegative(),
  createdAt: z.string(),
  firstTake: z.boolean(),
  audioUnavailableReason: z.string().nullable().optional(),
  /** The take's step within a run (7.3); null for ordinary practice. */
  step: ActivityStep.nullable().optional(),
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
  /** Curriculum version and item the session used (4.5); null for older sessions. */
  curriculumVersion: z.number().int().positive().nullable().optional(),
  contentId: z.string().nullable().optional(),
  /** Completion reflection (4.11): the user's own ease rating and takeaway. */
  ease: z.number().int().min(1).max(5).nullable().optional(),
  takeaway: z.string().nullable().optional(),
  /** Attempt comparison (4.14): the take that felt clearer to you, or "same". Your own judgement. */
  preferredTake: z.string().nullable().optional(),
  /** A run's settings (7.3); null for ordinary practice. */
  activitySnapshot: ActivityContext.nullable().optional(),
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
/** What the user writes for a phrase card (4.15). */
export type PhraseInput = { original: string; expression: string; explanation: string; examples: string[] };

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

/** One stage choice (4.18): advance, go easier or stay, with the reason shown at the time. */
export const ProgressionEvent = z.object({
  kind: z.enum(["advance", "easier", "stay"]), stageFrom: z.number().int().min(1).max(5), stageTo: z.number().int().min(1).max(5),
  reason: z.string(), createdAt: z.string(),
}).strict();
export type ProgressionEvent = z.infer<typeof ProgressionEvent>;

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
    newSituation: z.object({
      promptId: Id, text: z.string(), familiarity: Familiarity, reason: z.string(),
      /** Set when the challenge dial is on Harder (11.2): half the prompt's own preparation time. */
      preparationSeconds: z.number().int().nonnegative().optional(),
    }),
    realConversation: z.object({ task: z.string(), done: z.boolean() }),
  }),
  /** The rules-based scheduler (4.18): your stage, any offer, and suggestions, each with a reason. */
  progression: z.object({
    stage: z.number().int().min(1).max(5), title: z.string(), demand: z.string(), evidence: z.string(),
    offer: z.object({ stage: z.number().int().min(2).max(5), title: z.string(), reason: z.string() }).nullable(),
  }).optional(),
  suggestions: z.array(z.object({ text: z.string(), reason: z.string() })).optional(),
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

/** Live microphone level before recording (Studio Ready state); nothing is recorded. */
export const InputLevel = z.object({ level: z.number().min(0).max(1), clipping: z.boolean() });
export type InputLevel = z.infer<typeof InputLevel>;

/** End of a five-second microphone test (plan 2.12); exactly one of durationMs/error is set. */
export const MicTestFinished = z.object({
  attemptId: Id,
  durationMs: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
});
export type MicTestFinished = z.infer<typeof MicTestFinished>;

// ── Optional API transcription test (M0 0.22, D-21) ─────────────────────────
export const AudioProvider = z.enum(["deepgram", "assemblyai"]);
export type AudioProvider = z.infer<typeof AudioProvider>;

/** Default way to transcribe takes (§10). Cloud never sends by itself: each take is previewed and sent on Send. */
/** Where the data lives (2.25). */
export const DataLocation = z.object({
  current: z.string(), default: z.string(), custom: z.boolean(), problem: z.string().nullable(), previous: z.string().nullable(), previousBytes: z.number().int().nonnegative(),
});
export type DataLocation = z.infer<typeof DataLocation>;

/** Settings that change how the app behaves (stored natively in app_settings). */
export const CoachingModel = z.enum(["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"]);
export type CoachingModel = z.infer<typeof CoachingModel>;

export const FirstLanguage = z.enum(["russian", "ukrainian", "polish", "german", "french", "spanish", "portuguese", "arabic", "hindi", "mandarin", "japanese", "korean"]);
export const SurpriseDay = z.enum(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]);
export const HalfHour = z.string().regex(/^(?:[01]\d|2[0-3]):(?:00|30)$/);

export const Preferences = z
  .object({
    recordingSounds: z.boolean(),
    recordingShortcuts: z.boolean(),
    /** The Studio's Ready state shows the live microphone level; nothing is recorded. */
    levelBeforeRecording: z.boolean(),
    /** New takes are transcribed on this computer as soon as they are saved (local mode only). */
    autoTranscribe: z.boolean(),
    inputDeviceId: z.string().min(1).max(512).nullable(),
    sessionLength: SessionLength,
    coachingMode: z.enum(["api", "local", "off"]),
    coachingModel: CoachingModel,
    deliveryImpressions: z.boolean(),
    onboarded: z.boolean(),
    /** The guided tour was finished or skipped; Help → Guided tour starts it again. */
    tourDone: z.boolean(),
    goals: z.array(z.enum(["clarity", "hesitation", "phrasing", "confidence"])).max(4),
    goalNote: z.string().max(300),
    difficultyLanguage: z.enum(["english", "both"]).nullable(),
    /** Local LLM (5.4): a server on this computer only. */
    localEndpoint: z.string().min(1),
    localModel: z.string(),
    budgetWarningMicroUsd: z.number().int().min(100_000).max(5_000_000),
    lastSeenVersion: z.string().min(1).max(40).nullable().default(null),
    firstLanguage: FirstLanguage.nullable().default(null),
    surpriseEnabled: z.boolean().default(false),
    surpriseStart: HalfHour.default("09:00"),
    surpriseEnd: HalfHour.default("18:00"),
    surpriseDays: z.array(SurpriseDay).max(7).default(["monday", "tuesday", "wednesday", "thursday", "friday"]),
    surpriseNotifications: z.boolean().default(false),
    reminderTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
    /** Coaching prices you entered (5.9), USD per million tokens; other models use the built-in prices. */
    coachingPrices: z.record(z.string(), z.object({ input: z.string(), output: z.string(), checkedOn: z.string() }).strict()),
    /** Playful shows levels, effort points and celebrations; Calm hides them. Progress is kept either way (7.5, D-32). */
    practiceStyle: z.enum(["playful", "calm"]),
    /** The one-time Playful-or-Calm choice was made. */
    styleChosen: z.boolean(),
    /** Reduced motion turns "full" into "subtle". */
    celebrations: z.enum(["full", "subtle", "off"]),
    celebrationSounds: z.boolean(),
    /** A live pace meter from the audio while recording (8.8). */
    livePace: z.boolean(),
    /** Your own words to watch (8.11): lowercase, at most 30 characters each, at most 20. */
    watchWords: z.array(z.string().min(1).max(30)).max(20),
    /** Practise on this many days of each week (9.8). */
    weeklyGoalDays: z.number().int().min(1).max(7),
    weekStartsOn: z.enum(["monday", "sunday"]),
    /** Sprout, the plant that grows with your practice days (9.11). */
    companion: z.boolean(),
    /** Accent colour (9.12). */
    accent: z.enum(["green", "ocean", "amber", "violet", "rose", "graphite"]),
    /** The challenge dial (11.2): -1 easier, 0 just right, 1 harder. It never changes your stage. */
    challengeBias: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    /** Start today's practice with a 2-minute warm-up game (11.3). */
    warmUp: z.boolean(),
    /** When to show measures (11.4). */
    measuresTiming: z.enum(["always", "on_request", "fade"]),
    /** Guess hesitations and pace before seeing a take's measures (11.5). */
    predictFirst: z.boolean(),
    predictTipSeen: z.boolean(),
    /** The name the pre-talk routine encourages you with (12.3); empty says "you". */
    displayName: z.string().max(40),
    /** The partner's offline voice (13.7), by name; null picks one for the persona. */
    partnerVoice: z.string().min(1).max(200).nullable(),
    /** The partner's speaking speed (13.7). */
    partnerRate: z.number().min(0.8).max(1.2),
    /** New local-model conversations send turns without asking (13.3, D-33). */
    partnerAutoSendLocal: z.boolean(),
    /** The cost limit a new OpenAI conversation starts with (13.1). */
    partnerMaxCostMicroUsd: z.number().int().min(10_000).max(5_000_000),
  })
  .strict()
  .refine((p) => p.surpriseStart < p.surpriseEnd, { message: "Choose a window ending after it starts.", path: ["surpriseEnd"] });
export type Preferences = z.infer<typeof Preferences>;
export const DEFAULT_PREFERENCES: Preferences = {
  lastSeenVersion: APP_VERSION,
  firstLanguage: null,
  surpriseEnabled: false, surpriseStart: "09:00", surpriseEnd: "18:00", surpriseDays: ["monday", "tuesday", "wednesday", "thursday", "friday"], surpriseNotifications: false,
  recordingSounds: true, recordingShortcuts: true, levelBeforeRecording: true, autoTranscribe: true, inputDeviceId: null, sessionLength: "standard",
  coachingMode: "api", coachingModel: "gpt-6-luna", deliveryImpressions: false,
  onboarded: false, tourDone: false, goals: [], goalNote: "", difficultyLanguage: null,
  localEndpoint: "http://127.0.0.1:8080", localModel: "", budgetWarningMicroUsd: 4_000_000, reminderTime: null, coachingPrices: {},
  practiceStyle: "playful", styleChosen: false, celebrations: "full", celebrationSounds: false,
  livePace: false, watchWords: [],
  weeklyGoalDays: 3, weekStartsOn: "monday", companion: true, accent: "green",
  challengeBias: 0, warmUp: false, measuresTiming: "always", predictFirst: false, predictTipSeen: false,
  displayName: "",
  partnerVoice: null, partnerRate: 1, partnerAutoSendLocal: false, partnerMaxCostMicroUsd: 50_000,
};

export const TranscriptionPreference = z.object({ mode: z.enum(["local", "api", "off"]), provider: AudioProvider }).strict();
export type TranscriptionPreference = z.infer<typeof TranscriptionPreference>;

export const ProviderKeyStatus = z.object({ provider: AudioProvider, present: z.boolean() });
export type ProviderKeyStatus = z.infer<typeof ProviderKeyStatus>;

export const AudioPreview = z.object({
  requestId: Id,
  provider: AudioProvider,
  providerLabel: z.string(),
  model: z.string(),
  recipient: z.string(),
  attemptId: Id,
  durationMs: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  audioSha256: z.string().regex(/^[a-f0-9]{64}$/),
  settings: z.record(z.string(), z.unknown()),
  estimatedCostMicroUsd: z.number().int().positive(),
  priceSource: z.string().url(),
  priceDate: z.string(),
  dataHandling: z.string(),
  payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  /** Set when this exact audio + provider/model/settings was transcribed before (3.16). */
  previousRunAt: z.string().nullish(),
});
export type AudioPreview = z.infer<typeof AudioPreview>;

export const AudioResult = z.object({
  requestId: Id,
  provider: AudioProvider,
  model: z.string(),
  text: z.string(),
  wordCount: z.number().int().nonnegative(),
  fillerCount: z.number().int().nonnegative(),
  wordTimings: z.boolean(),
  wordTimingsUnavailableReason: z.string().nullable(),
  providerRequestId: z.string().nullable(),
  audioDurationMs: z.number().int().nonnegative().nullable(),
  estimatedCostMicroUsd: z.number().int().nonnegative(),
});
export type AudioResult = z.infer<typeof AudioResult>;

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
  settledMicroUsd: MicroUsd,
  reservedMicroUsd: MicroUsd,
  remainingMicroUsd: MicroUsd,
  warning: z.boolean(),
}).strict();
export type BudgetSummary = z.infer<typeof BudgetSummary>;

/** OpenAI models offered for coaching (IDs and prices checked 2026-10-08). */

export const CoachingPreview = z.object({
  version: z.literal(1), requestId: Id, payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  /** OpenAI's endpoint, or a local model server's address on this computer (5.4). */
  recipient: z.string().min(1), model: z.string().min(1),
  selectedText: z.string().min(1), prompt: z.string(), focus: z.string(), instructions: z.string(),
  maximumOutputTokens: z.number().int().positive(), estimatedMaximumCostMicroUsd: MicroUsd,
  priceDate: z.string(), priceSource: z.string(), inputUsdPerMillionTokens: z.string(), outputUsdPerMillionTokens: z.string(),
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

/** AI feedback on one take (M5, P.9). Delivery notes appear only when you opted in. */
export const TakeFeedback = z.object({
  summary: z.string().min(1), oneImprovement: z.string().min(1), nextAttempt: z.string().min(1),
  corrections: z.array(z.object({kind: z.enum(["clear-error", "style"]), quote: z.string().min(1), suggestion: z.string().min(1), reason: z.string().min(1)}).strict()).max(3),
  /** Expressions to keep, each with the words it replaces ("" for a new idea). Older answers have none. */
  phrases: z.array(z.object({ instead: z.string(), expression: z.string().min(1), why: z.string() }).strict()).max(3).default([]),
  deliveryNotes: z.array(z.object({part: z.number().int().positive(), note: z.string().min(1)}).strict()).max(3),
}).strict();
export type TakeFeedback = z.infer<typeof TakeFeedback>;

export const CoachingRun = z.object({
  id: Id, attemptId: Id, revisionId: Id, provider: z.enum(["OpenAI", "Local LLM"]), model: z.string().min(1),
  payloadSha256: z.string().regex(/^[a-f0-9]{64}$/), sentText: z.string().min(1), transcriptText: z.string().min(1),
  deliveryImpressions: z.boolean(), feedback: TakeFeedback,
  inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(),
  estimatedCostMicroUsd: MicroUsd.nullable(), costUnavailableReason: z.string().nullable(), createdAt: z.string().min(1), // ISO UTC
}).strict().refine((v) => (v.estimatedCostMicroUsd === null) === (v.costUnavailableReason !== null), "Missing cost needs a reason");
export type CoachingRun = z.infer<typeof CoachingRun>;

/** A simulated listener's follow-up question (5.11), labelled as a simulation. */
export const FollowUpQuestion = z.object({
  question: z.string().min(1), why: z.string(), model: z.string(), estimatedCostMicroUsd: MicroUsd.nullable(),
}).strict();
export type FollowUpQuestion = z.infer<typeof FollowUpQuestion>;

/** Storage by category (6.6). Only the rebuildable cache can be cleared. */
export const StorageCategory = z.object({
  key: z.string(), label: z.string(), note: z.string(), bytes: z.number().int().nonnegative(), files: z.number().int().nonnegative(), clearable: z.boolean(),
}).strict();
export type StorageCategory = z.infer<typeof StorageCategory>;

/** Performance on this computer during this run (6.5). */
export const Measure = z.object({ latestMs: z.number(), bestMs: z.number(), worstMs: z.number(), count: z.number(), targetMs: z.number() }).strict();
export const Timings = z.record(z.string(), Measure);
export type Timings = z.infer<typeof Timings>;

export const TakeCoachingPreview = z.object({
  preview: CoachingPreview,
  /** When this exact request was already answered for the take (asking again may be billed). */
  answeredAt: z.string().nullable(),
  timedParts: z.number().int().nonnegative(),
  corrected: z.boolean(),
  /** The transcript revision the text was built from; a newer one makes the preview stale (A-17). */
  revisionId: z.string().min(1),
}).strict();
export type TakeCoachingPreview = z.infer<typeof TakeCoachingPreview>;

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

// ── Engagement (roadmap 7.4, 7.6) ────────────────────────────────────────────
/** Something you did that earned effort points; never removed (D-31). */
export const PracticeEvent = z
  .object({
    id: z.number().int(),
    kind: z.string().min(1),
    refId: z.string().min(1),
    localDate: z.string(),
    sessionId: z.string().nullable(),
    attemptId: z.string().nullable(),
    xp: z.number().int().min(0),
    backfilled: z.boolean(),
    createdAt: z.string(),
  })
  .strict();
export type PracticeEvent = z.infer<typeof PracticeEvent>;

export const FactSession = z
  .object({
    id: Id,
    localDate: z.string(),
    startedAt: z.string(),
    exerciseType: ExerciseType.nullable(),
    contentId: z.string().nullable(),
    tags: z.array(z.string()),
    familiarity: Familiarity.nullable(),
    preparationSeconds: z.number().int().nonnegative().nullable(),
    targetSeconds: z.number().int().nonnegative().nullable(),
    audience: z.boolean(),
    followUp: z.boolean(),
    /** Point, reason and example filled in the outline. */
    outline: z.tuple([z.boolean(), z.boolean(), z.boolean()]),
    ease: z.number().int().min(1).max(5).nullable(),
    focus: z.string().nullable(),
    takeaway: z.boolean(),
    status: SessionStatus,
    takeCount: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    preferredTake: z.string().nullable(),
    /** Facts v4 (M10): a run's settings (7.3), as stored with the session. */
    activity: ActivityContext.nullable(),
  })
  .strict();
export type FactSession = z.infer<typeof FactSession>;

/** A saved take in history with the measures of its newest machine revision (Estimated). */
/** Your quick yes/no notes about a take (8.3); drills add the later ones (M10). */
export const SelfCheckId = z.enum(["point_first", "clear_ending", "varied_voice", "concrete_detail", "fair_other_side", "kept_main_point", "used_all_icons", "fit_child", "fit_colleague", "fit_expert", "stressed_target", "final_check"]);
export type SelfCheckId = z.infer<typeof SelfCheckId>;
export const SelfCheck = z.object({ attemptId: Id, checkId: SelfCheckId, value: z.boolean(), createdAt: z.string() }).strict();
export type SelfCheck = z.infer<typeof SelfCheck>;

/** A saved phrase spotted in a take's current transcript (8.2). IDs only, no text. */
export const PhraseUse = z
  .object({ phraseId: Id, attemptId: Id, sessionId: Id, revisionId: Id, segment: z.number().int().nonnegative(), localDate: z.string() })
  .strict();
export type PhraseUse = z.infer<typeof PhraseUse>;

/** Speech rate from the take's audio (8.8, method nuclei-v1); all Estimated. */
export const AudioMeasures = z
  .object({
    attemptId: Id,
    method: z.literal("nuclei-v1"),
    syllables: z.number().int().nonnegative().nullable(),
    spanMs: z.number().int().nonnegative().nullable(),
    phonationMs: z.number().int().nonnegative().nullable(),
    rateSps: z.number().nonnegative().nullable(),
    articulationSps: z.number().nonnegative().nullable(),
    unavailableReason: z.string().nullable(),
  })
  .strict();
export type AudioMeasures = z.infer<typeof AudioMeasures>;

/** About once a second while recording with the live pace meter on (8.8). Nothing is stored. */
export const LivePace = z
  .object({ attemptId: Id, syllablesPerSecond: z.number().nonnegative().nullable(), voicedMs: z.number().int().nonnegative(), windowMs: z.number().int().positive() })
  .strict();
export type LivePace = z.infer<typeof LivePace>;

/** Your A/B choice between takes of two sessions (8.5), labelled Your note. */
export const Comparison = z
  .object({ id: Id, aAttempt: Id, bAttempt: Id, preferred: z.enum(["a", "b", "same"]), blind: z.boolean(), createdAt: z.string() })
  .strict();
export type Comparison = z.infer<typeof Comparison>;

// ── Learning engine (roadmap M11) ────────────────────────────────────────────
/** Your guess before seeing a take's measures (11.5), Your note. */
export const PredictionKind = z.enum(["hesitations", "pace"]);
export type PredictionKind = z.infer<typeof PredictionKind>;
export const HesitationBucket = z.enum(["0-1", "2-4", "5+"]);
export type HesitationBucket = z.infer<typeof HesitationBucket>;
export const PaceBucket = z.enum(["slower", "usual", "faster"]);
export type PaceBucket = z.infer<typeof PaceBucket>;
export const Prediction = z.object({ attemptId: Id, kind: PredictionKind, predicted: z.string(), createdAt: z.string() }).strict();
export type Prediction = z.infer<typeof Prediction>;
/** A guided programme run (11.6). */
export const ProgrammeRun = z
  .object({
    id: Id, programme: z.string(), week: z.number().int().min(1).max(12), startedAt: z.string(), weekStartedAt: z.string(), weekStartedDate: z.string(),
    completedAt: z.string().nullable(), stoppedAt: z.string().nullable(),
    steps: z.array(z.object({ stepId: z.string(), refId: z.string().nullable(), doneAt: z.string() }).strict()),
  })
  .strict();
export type ProgrammeRun = z.infer<typeof ProgrammeRun>;
/** A Catch it run (11.6): your presses (ms into the take) and how many fillers they caught (Estimated). */
export const CatchRun = z
  .object({ id: Id, attemptId: Id, presses: z.array(z.number().int().nonnegative()), caught: z.number().int().nonnegative(), total: z.number().int().nonnegative(), createdAt: z.string() })
  .strict();
export type CatchRun = z.infer<typeof CatchRun>;

// ── Confidence pack (roadmap M12) ───────────────────────────────────────────
/** A step of your exposure ladder (12.2). */
export const ExposureStep = z.object({ id: Id, position: z.number().int().min(1).max(30), title: z.string().min(1), templateId: z.string().nullable(), createdAt: z.string() }).strict();
export type ExposureStep = z.infer<typeof ExposureStep>;
/** A step as you save the ladder: an existing one keeps its ID. */
export type ExposureStepInput = { id?: string | null; title: string; templateId?: string | null };
/** Planned (a before rating only), done, done in part, or not this time. */
export const ExposureOutcome = z.enum(["planned", "yes", "partly", "not_this_time"]);
export type ExposureOutcome = z.infer<typeof ExposureOutcome>;
const Rating = z.number().int().min(0).max(10);
/** An attempt with your discomfort before and after, 0 to 10 (Your note). */
export const ExposureAttempt = z
  .object({ id: Id, stepId: Id, localDate: z.string(), beforeRating: Rating.nullable(), afterRating: Rating.nullable(), outcome: ExposureOutcome, note: z.string(), createdAt: z.string() })
  .strict();
export type ExposureAttempt = z.infer<typeof ExposureAttempt>;
export type ExposureAttemptInput = { stepId: string; localDate: string; beforeRating: number | null; afterRating: number | null; outcome: ExposureOutcome; note: string };
/** The pre-talk routine's steps (12.3). */
export const RoutineStepId = z.enum(["breathe", "warm_up", "reframe", "unload", "encourage"]);
export type RoutineStepId = z.infer<typeof RoutineStepId>;
export const RoutineRun = z
  .object({ id: Id, localDate: z.string(), steps: z.array(RoutineStepId), keptNote: z.string().nullable(), eventId: z.string().nullable(), createdAt: z.string() })
  .strict();
export type RoutineRun = z.infer<typeof RoutineRun>;
export type RoutineInput = { steps: RoutineStepId[]; keptNote: string | null; eventId?: string | null };
/** A sentence you liked in a transcript (12.5). */
export const SegmentMark = z.object({ revisionId: Id, segment: z.number().int().nonnegative(), kind: z.literal("liked") }).strict();
export type SegmentMark = z.infer<typeof SegmentMark>;
/** A sentence for the week's reel, with its stored segment times (12.5). */
export const Moment = z
  .object({
    attemptId: Id, sessionId: Id, ordinal: z.number().int().positive(), revisionId: Id, segment: z.number().int().nonnegative(), text: z.string(),
    startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative(), localDate: z.string(), liked: z.boolean(),
  })
  .strict();
export type Moment = z.infer<typeof Moment>;

// ── Conversation partner (roadmap M13) ──────────────────────────────────────
/** What a partner turn does (13.1); the opening comes from the scenario. */
export const PartnerMove = z.enum(["opening", "follow_up", "challenge", "clarify", "interrupt", "wrap_up"]);
export type PartnerMove = z.infer<typeof PartnerMove>;
/** Your OpenAI account (every turn previewed and sent on Send), a local model on this computer, or prepared lines offline (13.3). */
export const ConversationMode = z.enum(["api", "local", "scripted"]);
export type ConversationMode = z.infer<typeof ConversationMode>;
/** Listeners the Q&A panel may include (13.9). */
export const PanelPersona = z.enum(["newcomer", "skeptic", "expert"]);
export type PanelPersona = z.infer<typeof PanelPersona>;
/** A scenario as it was played (13.2), kept with the conversation. */
export const ScenarioText = z
  .object({
    title: z.string().min(1).max(120), partnerRole: z.string().min(1).max(1000), learnerGoal: z.string().min(1).max(1000), opening: z.string().min(1).max(1000),
    personaTitle: z.string().min(1).max(60), personaStyle: z.string().min(1).max(1000), maxTurns: z.number().int().min(1).max(12),
    /** Prepared partner lines: the scripted partner's (13.8) or the panel's questions (13.9). */
    script: z.array(z.object({ text: z.string().min(1).max(600), move: PartnerMove }).strict()).max(24),
    /** A boss's questions as guidance for the partner (13.6). */
    guidance: z.string().max(1000).nullable(),
    bossId: z.string().nullable(),
    /** A short note per prepared line, opening first: the panel's "why". */
    hints: z.array(z.string().max(200)).max(25),
  })
  .strict();
export type ScenarioText = z.infer<typeof ScenarioText>;
export const Conversation = z
  .object({
    id: Id, sessionId: Id, scenarioId: z.string().min(1), personaId: z.string().min(1), pressure: z.number().int().min(0).max(3), mode: ConversationMode,
    modelId: z.string().nullable(), autoSendLocal: z.boolean(), maxCostMicroUsd: z.number().int().nonnegative().nullable(), status: z.enum(["active", "ended"]),
    scenario: ScenarioText,
    /** Every take of the conversation is recorded with exactly this prompt. */
    sessionPrompt: z.string(),
    sourceAttemptId: Id.nullable(), startedAt: z.string(), endedAt: z.string().nullable(),
  })
  .strict();
export type Conversation = z.infer<typeof Conversation>;
export const ConversationTurn = z
  .object({
    id: Id, ordinal: z.number().int().positive(), role: z.enum(["partner", "learner"]),
    /** A partner line, or your answer as it was sent (your transcript or what you typed). */
    text: z.string(),
    move: PartnerMove.nullable(), endsConversation: z.boolean(), typed: z.boolean(), outOfTime: z.boolean(),
    attemptId: Id.nullable(), revisionId: z.string().nullable(),
    /** The take exists and is not in Trash. */
    takeAvailable: z.boolean(),
    /** A spoken turn whose take was deleted for good; its text stays. */
    takeDeleted: z.boolean(),
    durationMs: z.number().int().nonnegative().nullable(), estimatedCostMicroUsd: z.number().int().nonnegative().nullable(), createdAt: z.string(),
  })
  .strict();
export type ConversationTurn = z.infer<typeof ConversationTurn>;
/** AI feedback on a whole conversation (13.11), an AI suggestion. */
export const ConversationFeedbackRun = z
  .object({ id: Id, provider: z.enum(["OpenAI", "Local LLM"]), model: z.string().min(1), sentText: z.string(), feedback: TakeFeedback, estimatedCostMicroUsd: z.number().int().nonnegative().nullable(), createdAt: z.string() })
  .strict();
export type ConversationFeedbackRun = z.infer<typeof ConversationFeedbackRun>;
/** Your turn, waiting for the partner, over (End shows the summary), or ended. */
export const ConversationNext = z.enum(["learner", "partner", "closing", "ended"]);
export type ConversationNext = z.infer<typeof ConversationNext>;
export const ConversationView = z
  .object({
    conversation: Conversation, turns: z.array(ConversationTurn), learnerTurns: z.number().int().nonnegative(),
    /** Settled estimates of the partner's turns; a turn without usage counts its preview's maximum. */
    spentMicroUsd: z.number().int().nonnegative(),
    next: ConversationNext, feedback: z.array(ConversationFeedbackRun),
  })
  .strict();
export type ConversationView = z.infer<typeof ConversationView>;
export const ConversationSummary = z
  .object({
    id: Id, sessionId: Id, scenarioId: z.string(), title: z.string(), personaId: z.string(), personaTitle: z.string(), pressure: z.number().int().min(0).max(3),
    mode: ConversationMode, status: z.enum(["active", "ended"]), learnerTurns: z.number().int().nonnegative(), speakingMs: z.number().int().nonnegative(),
    localDate: z.string(), startedAt: z.string(), endedAt: z.string().nullable(),
  })
  .strict();
export type ConversationSummary = z.infer<typeof ConversationSummary>;
export type NewConversation = {
  scenarioId: string; personaId: string; pressure: number; mode: ConversationMode; modelId?: CoachingModel | null; autoSendLocal?: boolean;
  maxCostMicroUsd?: number | null; scenario: ScenarioText; sourceAttemptId?: string | null;
};
/** A partner turn's preview and what the conversation has spent (13.1). */
export const PartnerPreview = CoachingPreview.extend({ conversationSpentMicroUsd: z.number().int().nonnegative(), capMicroUsd: z.number().int().nonnegative().nullable() }).strict();
export type PartnerPreview = z.infer<typeof PartnerPreview>;
/** A take's request (the panel or an upgrade) and the transcript revision it was built from. */
export const TakePartnerPreview = z.object({ preview: CoachingPreview, revisionId: z.string().min(1) }).strict();
export type TakePartnerPreview = z.infer<typeof TakePartnerPreview>;
export const UpgradeChange = z.object({ from: z.string().min(1), to: z.string().min(1), why: z.string() }).strict();
export type UpgradeChange = z.infer<typeof UpgradeChange>;
/** A clearer version of one take's answer (13.10), an AI suggestion; it goes with its take. */
export const UpgradeRun = z
  .object({
    id: Id, attemptId: Id, sessionId: Id, takeOrdinal: z.number().int().positive(), revisionId: z.string().min(1), provider: z.enum(["OpenAI", "Local LLM"]),
    model: z.string().min(1), sentText: z.string(), transcriptText: z.string(), upgraded: z.string().min(1), changes: z.array(UpgradeChange).max(6),
    estimatedCostMicroUsd: z.number().int().nonnegative().nullable(),
    /** The session the shadow and retell takes are recorded in. */
    loopSessionId: Id,
    createdAt: z.string(),
  })
  .strict();
export type UpgradeRun = z.infer<typeof UpgradeRun>;

// ── Real world (roadmap M14) ────────────────────────────────────────────────
/** What you prepare for (14.2). */
export const RealEventKind = z.enum(["talk", "interview", "meeting", "toast", "pitch", "other"]);
export type RealEventKind = z.infer<typeof RealEventKind>;
/** A step of an event's plan (14.2). */
export const EventItemKind = z.enum(["outline", "run_through", "qa_drill", "mock", "dress_rehearsal", "routine", "debrief"]);
export type EventItemKind = z.infer<typeof EventItemKind>;
/** The rest of M14's IPC shapes load with the first real-world call, off the start-up path. */
export type { CapsuleOffer, EventInput, EventPlanItem, EventPlanItemInput, EventView, ListenerFeedback, ListenerImport, ListenerPack, MissionPick, PlannedEvent, RehearsalReport, RehearsalSection, Talk, TalkInput, TalkSection, TalkSectionInput, TalkView } from "./schemas-real-world";
/** Club mode (M15.2), loaded on the first Club call. */
export type { ClubCounter, ClubKind, ClubLightState, ClubMeeting, ClubMeetingInput, ClubMeetingSummary, ClubMeetingView, ClubSpeech, ClubSpeechInput, ClubSpeechResult } from "./schemas-social";

// ── Drills (roadmap M10) ─────────────────────────────────────────────────────
/** A mark made during a take (10.1): the time into the take, a kind, and keys or numbers. Never words you said. A rehearsal's move to the next cue card is a `section_mark` (14.3). */
export const TakeMarkKind = z.enum(["word_shown", "self_flag", "card_advanced", "cue_shown", "section_mark"]);
export type TakeMarkKind = z.infer<typeof TakeMarkKind>;
const MarkData = z.record(z.string().regex(/^[A-Za-z0-9_]{1,40}$/), z.union([z.number(), z.string().regex(/^[a-z0-9_-]{1,40}$/), z.boolean()]));
export const TakeMark = z.object({ atMs: z.number().int().nonnegative(), kind: TakeMarkKind, data: MarkData.default({}) }).strict();
export type TakeMark = z.infer<typeof TakeMark>;
export const TakeEvent = z.object({ id: z.number().int(), attemptId: Id, atMs: z.number().int().nonnegative(), kind: z.string(), data: MarkData, createdAt: z.string() }).strict();
export type TakeEvent = z.infer<typeof TakeEvent>;

/** A drill take's result (10.1), computed natively from what is stored; all Estimated. Missing values are null with a reason. */
const resultBase = { attemptId: Id, definitionVersion: z.number().int().positive() };
const count = z.number().int().nonnegative();
const reason = z.string().nullable();
export const JamResult = z
  .object({ ...resultBase, kind: z.literal("jam"), speakingMs: count, cleanSeconds: count.nullable(), hesitations: count.nullable(), longPauses: count, longPauseMs: count, repeats: count.nullable(), flags: count, unavailableReason: reason })
  .strict();
export const WordBombResult = z
  .object({ ...resultBase, kind: z.literal("word_bomb"), shown: count, woven: count.nullable(), spokenAtMs: z.array(z.number().int()).nullable(), unavailableReason: reason })
  .strict();
export const EmphasisResult = z
  .object({ ...resultBase, kind: z.literal("emphasis"), round: count, target: count.nullable(), peakWord: count.nullable(), hit: z.boolean().nullable(), aligned: z.boolean(), nuclei: count, expected: count, unavailableReason: reason })
  .strict();
export const PaceLadderResult = z.object({ ...resultBase, kind: z.literal("pace_ladder"), rateSps: z.number().nonnegative().nullable(), unavailableReason: reason }).strict();
export const StoryCubesResult = z
  .object({ ...resultBase, kind: z.literal("story_cubes"), icons: count, used: count.nullable(), usedIcons: z.array(z.number().int().min(0).max(1)).nullable(), unavailableReason: reason })
  .strict();
export const StorySpineResult = z.object({ ...resultBase, kind: z.literal("story_spine"), steps: count, advanced: count, words: count.nullable() }).strict();
/** Six 10-second windows: 0 flowing, 1 hesitation, 2 pause, 3 silent. */
export const DailyResult = z
  .object({
    ...resultBase, kind: z.literal("daily"), windows: z.array(z.number().int().min(0).max(3)).nullable(),
    flowing: count.nullable(), hesitation: count.nullable(), pause: count.nullable(), silent: count.nullable(), transcribed: z.boolean(), unavailableReason: reason,
  })
  .strict();
export const BasicResult = z
  .object({ ...resultBase, kind: z.literal("basic"), durationMs: count, words: count.nullable(), speechMs: count.nullable(), hesitations: count.nullable(), differentPer50: z.number().nonnegative().nullable() })
  .strict();
/** An optional AI comparison of a drill's rounds (10.5, 10.9): one note per version or round, quoting your own words. AI suggestion. */
export const DrillComparisonKind = z.enum(["three_ways", "pitch"]);
export type DrillComparisonKind = z.infer<typeof DrillComparisonKind>;
export const DrillComparison = z
  .object({ notes: z.array(z.object({ part: z.number().int().positive(), note: z.string().min(1), quote: z.string().min(1) }).strict()).min(1), oneTip: z.string() })
  .strict();
export type DrillComparison = z.infer<typeof DrillComparison>;

export const ActivityResult = z.discriminatedUnion("kind", [JamResult, WordBombResult, EmphasisResult, PaceLadderResult, StoryCubesResult, StorySpineResult, DailyResult, BasicResult]);
export type ActivityResult = z.infer<typeof ActivityResult>;

export const FactTake = z
  .object({
    id: Id,
    sessionId: Id,
    ordinal: z.number().int().positive(),
    localDate: z.string(),
    createdAt: z.string(),
    durationMs: z.number().int().nonnegative(),
    stepKey: z.string().nullable(),
    transcribed: z.boolean(),
    revisionId: z.string().nullable(),
    words: z.number().int().nonnegative().nullable(),
    paceWpm: z.number().nullable(),
    speechSpanMs: z.number().int().nonnegative().nullable(),
    fillerCandidates: z.number().int().nonnegative().nullable(),
    fillersConfirmed: z.number().int().nonnegative().nullable(),
    fillersReviewed: z.boolean(),
    pausesOverThreshold: z.number().int().nonnegative().nullable(),
    prosodyViewed: z.boolean(),
    hasAiFeedback: z.boolean(),
    // Facts v2 (M8): measures v2 of the same revision, phrases spotted in the
    // current transcript, your self-checks, pitch range and speech rate from the audio.
    meanRun: z.number().nonnegative().nullable(),
    longestRun: z.number().int().nonnegative().nullable(),
    midClausePauses: z.number().int().nonnegative().nullable(),
    boundaryPauses: z.number().int().nonnegative().nullable(),
    watchPer100: z.number().nonnegative().nullable(),
    hedgesPer100: z.number().nonnegative().nullable(),
    differentPer50: z.number().nonnegative().nullable(),
    phraseIds: z.array(Id),
    checks: z.partialRecord(SelfCheckId, z.boolean()),
    pitchRangeSt: z.number().nonnegative().nullable(),
    rateSps: z.number().nonnegative().nullable(),
    /** Facts v4 (M10): a drill take's result for its current transcript, numbers only (booleans as 1 or 0). */
    result: z.record(z.string(), z.number()).nullable(),
    /** Facts v5 (M11): your guesses before seeing the measures, Your note. */
    predictions: z.partialRecord(PredictionKind, z.string()),
    /** Facts v5 (M11): Catch it runs on this take. */
    catchRuns: z.array(z.object({ caught: z.number().int().nonnegative(), total: z.number().int().nonnegative(), localDate: z.string() }).strict()),
  })
  .strict();
export type FactTake = z.infer<typeof FactTake>;

export const FactTransfer = z
  .object({
    id: Id, localDate: z.string(), hasListenerWords: z.boolean(), neededClarification: z.boolean(), hasSuccess: z.boolean(), hasNextFocus: z.boolean(),
    // Facts v3 (9.16): Your note.
    flow: TransferFlow.nullable(), tags: z.array(TransferTag),
    /** Facts v6 (12.4). */
    kind: TransferKind,
    /** Facts v8 (M14): the mission it logs and the event it debriefs. */
    missionId: z.string().nullable(),
    eventId: z.string().nullable(),
  })
  .strict();
export type FactTransfer = z.infer<typeof FactTransfer>;
/** Facts v6 (12.2): a ladder step, deleted or not, with its attempts (your own ratings). */
export const FactExposureAttempt = z
  .object({ localDate: z.string(), before: z.number().int().min(0).max(10).nullable(), after: z.number().int().min(0).max(10).nullable(), outcome: z.enum(["planned", "yes", "partly", "not_this_time"]), done: z.boolean() })
  .strict();
export type FactExposureAttempt = z.infer<typeof FactExposureAttempt>;
export const FactExposureStep = z.object({ stepId: Id, position: z.number().int().min(1).max(30), deleted: z.boolean(), attempts: z.array(FactExposureAttempt) }).strict();
export type FactExposureStep = z.infer<typeof FactExposureStep>;
/** Facts v7 (13.11): a practice conversation (not in Trash) and how many times you answered. */
export const FactConversation = z
  .object({ id: Id, scenarioId: z.string(), pressure: z.number().int().min(0).max(3), mode: ConversationMode, learnerTurns: z.number().int().nonnegative(), localDate: z.string(), endedAt: z.string().nullable(), bossId: z.string().nullable() })
  .strict();
export type FactConversation = z.infer<typeof FactConversation>;
/** Facts v8 (14.2): an event you prepare for, and whether its debrief is written. */
export const FactEvent = z.object({ id: Id, kind: RealEventKind, localDate: z.string(), debriefDone: z.boolean() }).strict();
export type FactEvent = z.infer<typeof FactEvent>;
/** Facts v8 (14.4): one imported answer file; whether they got your main point is your judgement. */
export const FactListenerAnswer = z.object({ id: Id, attemptId: Id, localDate: z.string(), mainPointAnswered: z.boolean() }).strict();
export type FactListenerAnswer = z.infer<typeof FactListenerAnswer>;
/** Facts v8 (14.1): a week's mission, or the week skipped. */
export const FactMissionPick = z.object({ week: z.string(), missionId: z.string().nullable(), done: z.boolean() }).strict();
export type FactMissionPick = z.infer<typeof FactMissionPick>;
export const FactPhrase = z.object({ id: Id, createdAt: z.string(), starter: z.boolean(), deleted: z.boolean() }).strict();
export type FactPhrase = z.infer<typeof FactPhrase>;
export const FactPhraseReview = z.object({ cardId: Id, localDate: z.string(), rating: PhraseRating }).strict();
export type FactPhraseReview = z.infer<typeof FactPhraseReview>;

/** One snapshot of your practice for the rule engines (7.6). Sessions and takes in Trash are left out. */
export const PracticeFacts = z
  .object({
    factsVersion: z.number().int().positive(),
    generatedAt: z.string(),
    today: z.string(),
    transcriptionAvailable: z.boolean(),
    sessions: z.array(FactSession),
    takes: z.array(FactTake),
    transferReviews: z.array(FactTransfer),
    phrases: z.array(FactPhrase),
    phraseReviews: z.array(FactPhraseReview),
    progression: z.array(ProgressionEvent),
    /** Facts v3 (M9 achievements): prompts you wrote and blind A/B choices you saved. */
    userPrompts: z.number().int().nonnegative(),
    blindComparisons: z.number().int().nonnegative(),
    /** Facts v5 (M11): the programme you are running, if any. */
    programme: ProgrammeRun.nullable(),
    /** Facts v6 (M12): your exposure ladder. */
    exposure: z.array(FactExposureStep),
    /** Facts v7 (M13): your practice conversations. */
    conversations: z.array(FactConversation),
    /** Facts v8 (M14): events, listeners' answer files and the weeks' missions. */
    events: z.array(FactEvent),
    listenerAnswers: z.array(FactListenerAnswer),
    missionPicks: z.array(FactMissionPick),
  })
  .strict();
export type PracticeFacts = z.infer<typeof PracticeFacts>;

// ── Game core (roadmap M9) ──────────────────────────────────────────────────
/** Evidence holds IDs and numbers only (A-30). */
const Evidence = z.unknown();
export const LevelRow = z.object({ area: z.string(), level: z.number().int().min(1).max(5), definitionVersion: z.number().int().positive(), evidence: Evidence, achievedAt: z.string() }).strict();
export type LevelRow = z.infer<typeof LevelRow>;
export const AchievementRow = z.object({ id: z.string(), definitionVersion: z.number().int().positive(), evidence: Evidence, unlockedAt: z.string() }).strict();
export type AchievementRow = z.infer<typeof AchievementRow>;
export const RecordRow = z
  .object({
    id: z.number().int(), record: z.string(), value: z.number().nonnegative(), unit: z.string(), previous: z.number().nullable(),
    attemptId: z.string().nullable(), sessionId: z.string().nullable(), definitionVersion: z.number().int().positive(), achievedAt: z.string(),
  })
  .strict();
export type RecordRow = z.infer<typeof RecordRow>;
export const QuestRow = z
  .object({ week: z.string(), slot: z.number().int().min(1).max(3), quest: z.string(), params: z.unknown(), swapped: z.boolean(), createdAt: z.string(), completedAt: z.string().nullable() })
  .strict();
export type QuestRow = z.infer<typeof QuestRow>;
export const EngagementState = z
  .object({ levels: z.array(LevelRow), achievements: z.array(AchievementRow), records: z.array(RecordRow), quests: z.array(QuestRow), goalWeeks: z.array(z.string()) })
  .strict();
export type EngagementState = z.infer<typeof EngagementState>;
export type NewLevel = { area: string; level: number; definitionVersion: number; evidence: Record<string, unknown> };
export type NewAchievement = { id: string; definitionVersion: number; evidence: Record<string, unknown> };
export type NewRecord = { record: string; value: number; unit: string; attemptId: string | null; sessionId: string | null; definitionVersion: number };
export type QuestInput = { slot: number; quest: string; params: Record<string, unknown> };
export type UnlockInput = {
  levels: NewLevel[]; achievements: NewAchievement[]; records: NewRecord[]; questsDone: { week: string; slot: number }[]; weeklyGoal: string | null; localDate: string;
};
export const UnlockOutcome = z
  .object({ levels: z.array(LevelRow), achievements: z.array(AchievementRow), records: z.array(RecordRow), questsDone: z.array(QuestRow), weeklyGoal: z.string().nullable(), xp: z.number().int().nonnegative() })
  .strict();
export type UnlockOutcome = z.infer<typeof UnlockOutcome>;
