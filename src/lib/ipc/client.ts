/**
 * The UI's only door to the native core. Method names mirror the Rust
 * commands in blueprint §15; the frontend sends IDs and small values and
 * never resolves file paths itself.
 */
import type {
  ActivityContext,
  ActivityStep,
  EngagementState,
  QuestInput,
  QuestRow,
  UnlockInput,
  UnlockOutcome,
  AudioMeasures,
  Comparison,
  LivePace,
  PhraseUse,
  SelfCheck,
  SelfCheckId,
  AttemptReview,
  PracticeEvent,
  PracticeFacts,
  ExerciseDefinition,
  Guide,
  InputDevice,
  InputLevel,
  PhraseSuggestion,
  WhisperChoice,
  WhisperDownloadOptions,
  WhisperDownloadProgress,
  PhraseCard,
  PhraseRating,
  PhraseInput,
  PromptInput,
  TransferInput,
  TransferReview,
  ProgressionEvent,
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
  FollowUpQuestion,
  StorageCategory,
  Timings,
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
  /** A run's settings (7.3), fixed by the session's first take. */
  activity?: ActivityContext;
  /** This take's step within the run (7.3). */
  step?: ActivityStep;
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
  /** Records your stage choice (4.18); the app never advances by itself. */
  recordProgression(kind: ProgressionEvent["kind"], reason: string): Promise<ProgressionEvent>;
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
  /** What a one-click Whisper setup would download (already installed parts are skipped). */
  getWhisperDownloadOptions(): Promise<WhisperDownloadOptions>;
  /** Downloads, verifies and installs local Whisper after an explicit click, then stores the setup. */
  downloadWhisper(choice: WhisperChoice): Promise<TranscriptionSetup>;
  cancelWhisperDownload(): Promise<void>;
  onWhisperDownloadProgress(listener: (progress: WhisperDownloadProgress) => void): Promise<() => void>;
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
  /** Opens the microphone only to measure its level (Studio Ready state); nothing is recorded. */
  startLevelMonitor(deviceId: string | null): Promise<void>;
  stopLevelMonitor(): Promise<void>;
  onInputLevel(listener: (level: InputLevel) => void): Promise<() => void>;
  /** The custom title bar's window controls (the window has no system frame). No-ops outside the desktop app. */
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  /** Asks to close; a running take still triggers the "A take is still recording" guard. */
  closeWindow(): Promise<void>;
  isWindowMaximized(): Promise<boolean>;
  onWindowResized(listener: () => void): Promise<() => void>;
  /** Page zoom (Ctrl + / − / 0, Settings → Appearance). The browser preview leaves zoom to the browser. */
  setZoom(scale: number): Promise<void>;
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
  /** `livePace` turns on the live pace meter's events for this take (8.8); nothing of it is stored. */
  startRecording(request: { attemptId: string; deviceId: string | null; idempotencyKey: string; title: string; livePace?: boolean; context?: PracticeContext }): Promise<RecordingStatus>;
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
  /** Storage by category; clearing removes only the rebuildable cache (6.6). Returns bytes freed. */
  getStorageUsage(): Promise<StorageCategory[]>;
  /** Test connection to a local model server on this computer (5.4, 5.10); returns its models. */
  testLocalLlm(endpoint: string): Promise<string[]>;
  /** Performance on this computer (6.5): start-up and record response are measured by the interface. */
  appUptimeMs(): Promise<number>;
  recordTiming(kind: "startup" | "recordResponse", ms: number): Promise<void>;
  getTimings(): Promise<Timings>;
  /** Diagnostic report (6.7): counts, versions, states; no personal content. Read it, then save it. */
  buildDiagnostics(): Promise<string>;
  /** Returns the saved file's name, or null when cancelled. */
  saveDiagnostics(text: string): Promise<string | null>;
  clearCache(): Promise<number>;
  /** An AI follow-up question after a take (5.11): a separate request, a simulation. */
  previewFollowUp(attemptId: string, model: CoachingModel): Promise<CoachingPreview>;
  /** AI phrase suggestions from chosen sessions: previews the text-only request (titles and transcripts). */
  previewPhraseSuggestions(sessionIds: string[], model?: CoachingModel): Promise<CoachingPreview>;
  /** Sends an approved preview; only suggestions that quote your own words come back. */
  requestPhraseSuggestions(requestId: string, payloadSha256: string): Promise<PhraseSuggestion[]>;
  requestFollowUp(attemptId: string, requestId: string, payloadSha256: string): Promise<FollowUpQuestion>;
  /** Effort (roadmap 7.4): practice events from a local date on, oldest first. */
  listPracticeEvents(from?: string): Promise<PracticeEvent[]>;
  /** Practice complete: one event per finished sequence that has a take; null otherwise. */
  recordSequenceCompleted(sessionIds: string[], localDate: string): Promise<PracticeEvent | null>;
  /** One snapshot of your practice for the rule engines (7.6). */
  getPracticeFacts(): Promise<PracticeFacts>;
  /** Insights (M8): where saved phrases turned up in takes (one phrase, or all). */
  listPhraseUses(phraseId?: string): Promise<PhraseUse[]>;
  /** Your yes/no note about a take; null clears it. */
  setSelfCheck(attemptId: string, checkId: SelfCheckId, value: boolean | null): Promise<void>;
  listSelfChecks(attemptId: string): Promise<SelfCheck[]>;
  /** Speech rate from the take's audio, computed once on this computer. */
  getAudioMeasures(attemptId: string): Promise<AudioMeasures>;
  /** About once a second while a take records with `livePace` on. */
  onLivePace(listener: (pace: LivePace) => void): Promise<() => void>;
  /** Your A/B choice between takes of two different sessions. */
  saveComparison(aAttempt: string, bAttempt: string, preferred: "a" | "b" | "same", blind: boolean): Promise<Comparison>;
  listComparisons(attemptId: string): Promise<Comparison[]>;
  /** Game core (M9): levels, achievements, records, recent quests and goal weeks. `week` is the week's first day. */
  getEngagementState(week: string): Promise<EngagementState>;
  /** Records what the rules found new, once, with its XP; returns what was actually new. */
  recordUnlocks(input: UnlockInput): Promise<UnlockOutcome>;
  /** Stores this week's quests the first time they are shown (stored slots stay). */
  setWeeklyQuests(week: string, quests: QuestInput[]): Promise<QuestRow[]>;
  /** One swap a week, never for a finished quest. */
  swapWeeklyQuest(week: string, slot: number, quest: QuestInput): Promise<QuestRow>;
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
