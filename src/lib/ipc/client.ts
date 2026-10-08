/**
 * The UI's only door to the native core. Method names mirror the Rust
 * commands in blueprint §15; the frontend sends IDs and small values and
 * never resolves file paths itself.
 */
import type {
  AttemptReview,
  ExerciseDefinition,
  Guide,
  InputDevice,
  PhraseCard,
  PhraseRating,
  PracticePrompt,
  ProgressSummary,
  ProgressView,
  SearchHit,
  ServiceStatus,
  SessionDetail,
  SessionLength,
  SessionSummary,
  TodayPlan,
  SavedRecording,
  WaveformPeaks,
  TrashList,
  TrashRetentionDays,
  PurgeOutcome,
  BackupStatus,
  BackupKeep,
  BackupSummary,
  RestorePreview,
  RestoreOutcome,
  ExportSummary,
  TranscriptionSetup,
  AttemptTranscript,
  TranscriptionEvent,
  RecoverableRecording,
  RecordingStatus,
  CredentialStatus,
  BudgetSummary,
  CoachingPreview,
  FeedbackResult,
} from "./schemas";

export interface SessionFilter {
  query?: string;
  exerciseType?: SessionSummary["exerciseType"];
  favoritesOnly?: boolean;
}
export interface PracticeContext {
  sessionId: string;
  exerciseId: string;
  exerciseVersion: number;
  exerciseType: ExerciseDefinition["type"];
  prompt: string;
  outline: SessionDetail["outline"];
  conditions: PracticePrompt["conditions"];
}

export interface IpcClient {
  readonly recordingMode: "native" | "simulated";
  getServiceStatus(): Promise<ServiceStatus>;
  getTodayPlan(length: SessionLength): Promise<TodayPlan>;

  listExercises(): Promise<ExerciseDefinition[]>;
  listPrompts(): Promise<PracticePrompt[]>;
  listGuides(): Promise<Guide[]>;
  setPromptFavorite(promptId: string, favorite: boolean): Promise<void>;

  listSessions(filter?: SessionFilter): Promise<SessionSummary[]>;
  getSession(sessionId: string): Promise<SessionDetail>;
  updateSession(sessionId: string, details: { title: string; notes: string; tags: string[]; favorite: boolean }): Promise<void>;
  listTrash(): Promise<TrashList>;
  moveSessionToTrash(sessionId: string): Promise<void>;
  restoreSession(sessionId: string): Promise<void>;
  deleteSessionsPermanently(sessionIds: string[]): Promise<PurgeOutcome>;
  emptyTrash(): Promise<PurgeOutcome>;
  setTrashRetention(days: TrashRetentionDays): Promise<void>;
  getBackupStatus(): Promise<BackupStatus>;
  /** Opens the native folder picker; cancelling keeps the current folder. */
  chooseBackupDestination(): Promise<BackupStatus>;
  createBackup(): Promise<BackupSummary>;
  setAutoBackup(enabled: boolean, keep: BackupKeep): Promise<BackupStatus>;
  /** Opens the native file picker and validates the backup into staging; null when cancelled. */
  previewRestore(): Promise<RestorePreview | null>;
  discardRestorePreview(stagingId: string): Promise<void>;
  /** Replaces the current data with a checked backup; the previous data is kept as rollback material. */
  restoreBackup(stagingId: string): Promise<RestoreOutcome>;
  /** Opens the native Save dialog and writes a readable session ZIP; null when cancelled. */
  exportSession(sessionId: string): Promise<ExportSummary | null>;
  getTranscriptionSetup(): Promise<TranscriptionSetup>;
  /** Opens the native file picker and verifies the Whisper runtime and model before storing the setup. */
  chooseTranscriptionSetup(): Promise<TranscriptionSetup>;
  getAttemptTranscript(attemptId: string): Promise<AttemptTranscript>;
  /** Saves corrected wording as a new revision; resolves with its ID. */
  saveTranscriptCorrection(attemptId: string, parentRevisionId: string, text: string): Promise<string>;
  /** Starts a background local transcription; resolves with its job ID. */
  transcribeAttempt(attemptId: string): Promise<string>;
  /** Cancels the running transcription; resolves with its attempt ID, or null when none was running. */
  cancelTranscription(): Promise<string | null>;
  onTranscriptionEvent(listener: (event: TranscriptionEvent) => void): Promise<() => void>;
  getSavedRecording(assetId: string): Promise<SavedRecording>;
  getAttemptReview(attemptId: string): Promise<AttemptReview>;

  listPhrases(): Promise<PhraseCard[]>;
  reviewPhrase(phraseId: string, rating: PhraseRating): Promise<PhraseCard>;

  getProgress(view: ProgressView): Promise<ProgressSummary>;
  searchContent(query: string): Promise<SearchHit[]>;
  listInputDevices(): Promise<InputDevice[]>;
  startRecording(request: { attemptId: string; deviceId: string | null; idempotencyKey: string; title: string; context?: PracticeContext }): Promise<RecordingStatus>;
  stopRecording(attemptId: string): Promise<SavedRecording>;
  getRecordingStatus(): Promise<RecordingStatus | null>;
  onRecordingEvent(listener: (status: RecordingStatus) => void): Promise<() => void>;
  onRecordingCloseRequested(listener: () => void): Promise<() => void>;
  closeAfterRecording(): Promise<void>;
  listRecordings(): Promise<SavedRecording[]>;
  listRecoverableRecordings(): Promise<RecoverableRecording[]>;
  recoverRecording(attemptId: string): Promise<SavedRecording>;
  getRecordingPlaybackUrl(assetId: string): Promise<string>;
  getRecordingWaveform(assetId: string): Promise<WaveformPeaks>;
  getApiKeyStatus(): Promise<CredentialStatus>;
  storeApiKey(key: string): Promise<CredentialStatus>;
  removeApiKey(): Promise<CredentialStatus>;
  getApiUsageSummary(): Promise<BudgetSummary>;
  previewCoachingRequest(selectedText: string): Promise<CoachingPreview>;
  cancelCoachingPreview(requestId: string): Promise<void>;
  requestCoaching(requestId: string, payloadSha256: string): Promise<FeedbackResult>;
}

/** A command failed in a way the UI should explain in context (§14). */
export class IpcError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "IpcError";
  }
}
