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
  PhraseInput,
  PromptInput,
  TransferInput,
  TransferReview,
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
  TranscriptionPreference,
  Preferences,
  ClipFolder,
  ClipSource,
  DataLocation,
  OpenedSource,
  ReferenceClip,
  ClipStaged,
  ClipCandidate,
  ClipName,
  PickedClip,
  LinkToolStatus,
  LinkAudio,
  TranscriptionSetup,
  ModelPack,
  IntonationContour,
  AttemptTranscript,
  TranscriptionEvent,
  MicTestFinished,
  AudioProvider,
  ProviderKeyStatus,
  AudioPreview,
  AudioResult,
  RecoverableRecording,
  RecordingStatus,
  CredentialStatus,
  BudgetSummary,
  CoachingModel,
  CoachingPreview,
  FeedbackResult,
  CoachingRun,
  TakeCoachingPreview,
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
  /** Bundled curriculum version and the prompt, passage or phrase used (4.5). */
  curriculumVersion?: number;
  contentId?: string;
}

export interface IpcClient {
  readonly recordingMode: "native" | "simulated";
  getServiceStatus(): Promise<ServiceStatus>;
  getTodayPlan(length: SessionLength): Promise<TodayPlan>;

  listExercises(): Promise<ExerciseDefinition[]>;
  listPrompts(): Promise<PracticePrompt[]>;
  listGuides(): Promise<Guide[]>;
  setPromptFavorite(promptId: string, favorite: boolean): Promise<void>;
  /** Your own prompts (4.13). Sessions keep the text they used when a prompt changes. */
  addPrompt(prompt: PromptInput): Promise<PracticePrompt>;
  /** Real-conversation reflections (4.17), newest first. */
  listTransferReviews(): Promise<TransferReview[]>;
  addTransferReview(review: TransferInput): Promise<TransferReview>;
  deleteTransferReview(reviewId: string): Promise<void>;
  updatePrompt(promptId: string, prompt: PromptInput): Promise<PracticePrompt>;
  deletePrompt(promptId: string): Promise<void>;

  listSessions(filter?: SessionFilter): Promise<SessionSummary[]>;
  getSession(sessionId: string): Promise<SessionDetail>;
  /** The one thing to improve in the next take (4.6), or the imitated feature (4.8); null clears it. */
  setSessionFocus(sessionId: string, focus: string | null): Promise<void>;
  /** Which take felt clearer (4.14): a take ID, "same", or null to clear. */
  setPreferredTake(sessionId: string, preferred: string | null): Promise<void>;
  /** End-of-practice reflection (4.11): ease 1–5 and a takeaway; null leaves a value unchanged. */
  setSessionReflection(sessionId: string, ease: number | null, takeaway: string | null): Promise<void>;
  updateSession(sessionId: string, details: { title: string; notes: string; tags: string[]; favorite: boolean }): Promise<void>;
  listTrash(): Promise<TrashList>;
  moveSessionToTrash(sessionId: string): Promise<void>;
  restoreSession(sessionId: string): Promise<void>;
  deleteSessionsPermanently(sessionIds: string[]): Promise<PurgeOutcome>;
  emptyTrash(): Promise<PurgeOutcome>;
  /** Reference clips (4.4a): pick a local audio file (null if cancelled), preview it, keep a 3–30 s section. */
  chooseClipFile(): Promise<ClipStaged | null>;
  getClipStagingUrl(stagingId: string): Promise<string>;
  discardClipStaging(stagingId: string): Promise<void>;
  saveClip(details: { stagingId: string; startMs: number; endMs: number; title: string; source: string; transcript: string | null; folderId?: string | null }): Promise<ReferenceClip>;
  /** Clip library folders (4.4h). */
  listClipFolders(): Promise<ClipFolder[]>;
  createClipFolder(name: string): Promise<ClipFolder>;
  renameClipFolder(folderId: string, name: string): Promise<void>;
  /** The folder's clips stay, unfiled. */
  deleteClipFolder(folderId: string): Promise<void>;
  moveClips(clipIds: string[], folderId: string | null): Promise<void>;
  updateClip(clipId: string, details: { title: string; description: string | null; feature: "emphasis" | "rhythm" | "endings" | null }): Promise<void>;
  /** Import history (4.4i). */
  listClipSources(): Promise<ClipSource[]>;
  openClipSource(sourceId: string): Promise<OpenedSource>;
  updateClipSource(sourceId: string, details: { title: string; credit: string }): Promise<void>;
  deleteClipSource(sourceId: string): Promise<void>;
  listClips(): Promise<ReferenceClip[]>;
  getClipPlaybackUrl(clipId: string): Promise<string>;
  deleteClip(clipId: string): Promise<void>;
  /** Transcribes a staged long recording locally and proposes whole-sentence clips (4.4c). */
  splitClipSource(stagingId: string): Promise<ClipCandidate[]>;
  /** Cloud split (4.4c): previews the recording for a provider; nothing is sent. */
  previewSplitTranscription(stagingId: string, provider: AudioProvider): Promise<AudioPreview>;
  /** Sends an approved split preview and returns proposed clips. */
  requestSplitTranscription(requestId: string, payloadSha256: string): Promise<ClipCandidate[]>;
  onClipSplitProgress(listener: (percent: number) => void): Promise<() => void>;
  /** Stops a running split or link download. */
  cancelClipWork(): Promise<void>;
  saveClipSections(stagingId: string, sections: { startMs: number; endMs: number; title: string; source: string; transcript: string | null; description?: string | null; feature?: "emphasis" | "rhythm" | "endings" | null }[], folderId?: string | null): Promise<ReferenceClip[]>;
  /** Optional AI titles for proposed clips: previews a text-only request (transcripts only). */
  previewClipNames(texts: string[], model?: CoachingModel): Promise<CoachingPreview>;
  requestClipNames(requestId: string, payloadSha256: string): Promise<ClipName[]>;
  /** AI chooses the best passages (4.4e): previews the transcript annotated with measured delivery (text only). */
  /** Measures each sentence of a staged recording's transcript in the background (4.4g). Returns the sentence count. */
  measureClipSource(stagingId: string): Promise<number>;
  onClipMeasureProgress(listener: (progress: { stage: "preparing" | "measuring"; percent: number | null }) => void): Promise<() => void>;
  previewClipPicks(stagingId: string, options: { model?: CoachingModel; toneHint: boolean; wanted: number }): Promise<CoachingPreview>;
  requestClipPicks(stagingId: string, requestId: string, payloadSha256: string): Promise<PickedClip[]>;
  getLinkToolStatus(): Promise<LinkToolStatus>;
  chooseLinkTool(): Promise<LinkToolStatus>;
  fetchLinkAudio(url: string): Promise<LinkAudio>;
  /** Downloads the official yt-dlp.exe after an explicit click and verifies its checksum (4.4f). */
  downloadLinkTool(): Promise<LinkToolStatus>;
  onLinkToolDownload(listener: (progress: { received: number; total: number | null }) => void): Promise<() => void>;
  /** Moves one saved take to Trash; its session and other takes stay (2.23). */
  moveTakeToTrash(attemptId: string): Promise<void>;
  restoreTake(attemptId: string): Promise<void>;
  deleteTakesPermanently(attemptIds: string[]): Promise<PurgeOutcome>;
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
  getPreferences(): Promise<Preferences>;
  /** Data folder (2.25). `moveDataFolder` asks for a folder (or uses the default) and returns the new folder, or null when cancelled. */
  getDataLocation(): Promise<DataLocation>;
  moveDataFolder(toDefault: boolean): Promise<string | null>;
  onDataMoveProgress(listener: (progress: { done: number; total: number }) => void): Promise<() => void>;
  removeOldDataCopy(): Promise<void>;
  restartApp(): Promise<void>;
  setPreferences(preferences: Preferences): Promise<Preferences>;
  getTranscriptionPreference(): Promise<TranscriptionPreference>;
  /** Stores the default mode; choosing cloud sends nothing. */
  setTranscriptionPreference(preference: TranscriptionPreference): Promise<TranscriptionPreference>;
  listModelPacks(): Promise<ModelPack[]>;
  getTakeProsody(attemptId: string): Promise<IntonationContour>;
  /** A reference clip's pitch line (P.6), measured once and kept. */
  getClipProsody(clipId: string): Promise<IntonationContour>;
  /** Opens the native picker; installs a known pack only after size and checksum match. */
  importModelPack(): Promise<ModelPack[]>;
  /** Opens the native file picker and verifies the Whisper runtime and model before storing the setup. */
  chooseTranscriptionSetup(): Promise<TranscriptionSetup>;
  getAttemptTranscript(attemptId: string): Promise<AttemptTranscript>;
  /** Saves corrected wording as a new revision; resolves with its ID. */
  saveTranscriptCorrection(attemptId: string, parentRevisionId: string, text: string): Promise<string>;
  /** Confirms or dismisses filler candidate `candidate` (its index), or clears the decision with null. */
  setFillerDecision(revisionId: string, candidate: number, word: string, decision: "confirmed" | "dismissed" | null): Promise<void>;
  /** Starts a background local transcription; resolves with its job ID. */
  transcribeAttempt(attemptId: string): Promise<string>;
  /** Cancels the running transcription; resolves with its attempt ID, or null when none was running. */
  cancelTranscription(): Promise<string | null>;
  onTranscriptionEvent(listener: (event: TranscriptionEvent) => void): Promise<() => void>;
  /** Records five seconds for playback; nothing is added to session history. */
  startMicTest(deviceId: string | null): Promise<RecordingStatus>;
  getTranscriptionApiKeys(): Promise<ProviderKeyStatus[]>;
  storeTranscriptionApiKey(provider: AudioProvider, key: string): Promise<ProviderKeyStatus>;
  removeTranscriptionApiKey(provider: AudioProvider): Promise<ProviderKeyStatus>;
  /** Shows exactly what would be sent; sends nothing and reserves nothing. */
  previewApiTranscription(attemptId: string, provider: AudioProvider): Promise<AudioPreview>;
  cancelApiTranscriptionPreview(requestId: string): Promise<void>;
  /** Stops waiting for a sent request; a dispatched one keeps an Uncertain charge. */
  cancelApiTranscription(requestId: string): Promise<void>;
  /** Playable URL of an open preview's prepared audio (exactly what Send uploads). */
  getApiPreviewAudioUrl(requestId: string): Promise<string>;
  /** Sends one previewed take; the approval is single-use and bound to the payload fingerprint. */
  requestApiTranscription(requestId: string, payloadSha256: string): Promise<AudioResult>;
  getMicTestPlaybackUrl(attemptId: string): Promise<string>;
  onMicTestEvent(onLevel: (status: RecordingStatus) => void, onFinished: (result: MicTestFinished) => void): Promise<() => void>;
  getSavedRecording(assetId: string): Promise<SavedRecording>;
  getAttemptReview(attemptId: string): Promise<AttemptReview>;

  listPhrases(): Promise<PhraseCard[]>;
  reviewPhrase(phraseId: string, rating: PhraseRating): Promise<PhraseCard>;
  /** New cards are due today (4.15). */
  addPhrase(phrase: PhraseInput, sourceSessionId?: string | null): Promise<PhraseCard>;
  /** Changes the text; the schedule and review history stay. */
  updatePhrase(phraseId: string, phrase: PhraseInput): Promise<PhraseCard>;
  /** Removes a card from practice; its review history is kept. */
  deletePhrase(phraseId: string): Promise<void>;

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
  /** Permanently removes an interrupted take's unrecovered chunks. */
  discardRecoverableRecording(attemptId: string): Promise<void>;
  getRecordingPlaybackUrl(assetId: string): Promise<string>;
  getRecordingWaveform(assetId: string): Promise<WaveformPeaks>;
  getApiKeyStatus(): Promise<CredentialStatus>;
  storeApiKey(key: string): Promise<CredentialStatus>;
  removeApiKey(): Promise<CredentialStatus>;
  getApiUsageSummary(): Promise<BudgetSummary>;
  previewCoachingRequest(selectedText: string, model?: CoachingModel): Promise<CoachingPreview>;
  cancelCoachingPreview(requestId: string): Promise<void>;
  requestCoaching(requestId: string, payloadSha256: string): Promise<FeedbackResult>;
  /** Builds the text for AI feedback on a take (M5, P.9); nothing is sent. Hidden words never leave the computer. */
  previewTakeCoaching(attemptId: string, options: { model: CoachingModel; deliveryImpressions: boolean; hide: string[] }): Promise<TakeCoachingPreview>;
  /** Sends one approved take preview; the answer is stored with the take. */
  requestTakeCoaching(attemptId: string, requestId: string, payloadSha256: string): Promise<CoachingRun>;
  /** Stops waiting for a sent request; a dispatched one keeps its possible charge. */
  stopTakeCoaching(requestId: string): Promise<void>;
  listTakeCoaching(attemptId: string): Promise<CoachingRun[]>;
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
