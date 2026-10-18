/**
 * The UI's only door to the native core. Method names mirror the Rust
 * commands in blueprint §15; the frontend sends IDs and small values and
 * never resolves file paths itself.
 */
import type {
  ClubLightState,
  ClubMeetingInput,
  ClubMeetingSummary,
  ClubMeetingView,
  ClubSpeechResult,
  CapsuleOffer,
  EventInput,
  EventPlanItemInput,
  EventView,
  ListenerFeedback,
  ListenerImport,
  ListenerPack,
  MissionPick,
  PlannedEvent,
  RehearsalReport,
  TalkInput,
  TalkView,
  ActivityContext,
  ActivityResult,
  CatchRun,
  ConversationFeedbackRun,
  ConversationSummary,
  ConversationView,
  NewConversation,
  PanelPersona,
  PartnerPreview,
  TakePartnerPreview,
  UpgradeRun,
  ExposureAttempt,
  ExposureAttemptInput,
  ExposureStep,
  ExposureStepInput,
  Moment,
  RoutineInput,
  RoutineRun,
  SegmentMark,
  Prediction,
  PredictionKind,
  ProgrammeRun,
  DrillComparison,
  DrillComparisonKind,
  ActivityStep,
  TakeEvent,
  TakeMark,
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
  previewPhraseSuggestionsLocal(sessionIds: string[], model?: CoachingModel): Promise<CoachingPreview>;
  sendPhraseSuggestionsLocal(requestId: string, payloadSha256: string): Promise<PhraseSuggestion[]>;
  previewClipNamesLocal(texts: string[], model?: CoachingModel): Promise<CoachingPreview>;
  sendClipNamesLocal(requestId: string, payloadSha256: string): Promise<ClipName[]>;
  previewClipPicksLocal(stagingId: string, options: { model?: CoachingModel; toneHint: boolean; wanted: number }): Promise<CoachingPreview>;
  sendClipPicksLocal(stagingId: string, requestId: string, payloadSha256: string): Promise<PickedClip[]>;
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
  requestNotificationPermission(): Promise<boolean>;
  showSurpriseNotification(prompt: string): Promise<void>;
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
  /** Drills (M10): stores a saved take's marks; at most 200 per take, keys and numbers only. */
  addTakeEvents(attemptId: string, marks: TakeMark[]): Promise<number>;
  listTakeEvents(attemptId: string): Promise<TakeEvent[]>;
  /** A drill take's result, computed once and kept until its transcript changes. */
  getActivityResult(attemptId: string): Promise<ActivityResult>;
  /** Optional AI comparison of a drill's rounds: previews the text-only request (transcripts only). Nothing is sent. */
  previewDrillComparison(sessionId: string, kind: DrillComparisonKind, model?: CoachingModel): Promise<CoachingPreview>;
  requestDrillComparison(requestId: string, payloadSha256: string): Promise<DrillComparison>;
  /** Learning engine (M11): your guess before seeing a take's measures; the first guess stands. Resolves with whether it was new. */
  setPrediction(attemptId: string, kind: PredictionKind, predicted: string): Promise<boolean>;
  listPredictions(from?: string): Promise<Prediction[]>;
  /** The latest guided programme run, active or not. */
  getProgrammeState(): Promise<ProgrammeRun | null>;
  startProgramme(programme: string): Promise<ProgrammeRun>;
  completeProgrammeStep(programmeId: string, stepId: string, refId?: string | null): Promise<boolean>;
  setProgrammeWeek(programmeId: string, week: number, finished: boolean): Promise<ProgrammeRun>;
  stopProgramme(programmeId: string): Promise<void>;
  saveCatchRun(attemptId: string, presses: number[], caught: number, total: number): Promise<CatchRun>;
  listCatchRuns(attemptId?: string): Promise<CatchRun[]>;
  /** "Not this one" on a re-answer: it won't come back, and it earns nothing. */
  skipReanswer(promptId: string, step: number): Promise<void>;
  /** Confidence pack (M12): your exposure ladder, lowest step first. */
  listExposureSteps(): Promise<ExposureStep[]>;
  /** Saves the whole ladder in order; steps left out are deleted softly and keep their attempts. */
  saveExposureSteps(steps: ExposureStepInput[]): Promise<ExposureStep[]>;
  listExposureAttempts(stepId?: string): Promise<ExposureAttempt[]>;
  /** A plan or an attempt; done, fully or in part, earns effort once. */
  addExposureAttempt(input: ExposureAttemptInput): Promise<ExposureAttempt>;
  updateExposureAttempt(id: string, input: ExposureAttemptInput): Promise<ExposureAttempt>;
  deleteExposureAttempt(id: string): Promise<void>;
  /** A finished pre-talk routine; the worry note only when you kept it. */
  saveRoutineRun(input: RoutineInput): Promise<RoutineRun>;
  listRoutineRuns(): Promise<RoutineRun[]>;
  /** Removes a routine run and the note kept with it (soft delete). */
  deleteRoutineRun(id: string): Promise<void>;
  /** Likes or unlikes one sentence of a machine transcript. */
  setSegmentMark(revisionId: string, segment: number, liked: boolean): Promise<void>;
  listSegmentMarks(attemptId: string): Promise<SegmentMark[]>;
  /** The week's best moments from `weekStart` (local date), with stored segment times only. */
  bestMoments(weekStart: string): Promise<Moment[]>;
  /** Conversation partner (M13): starts a conversation, its session and the partner's opening. */
  startConversation(input: NewConversation): Promise<ConversationView>;
  getConversation(conversationId: string): Promise<ConversationView>;
  listConversations(): Promise<ConversationSummary[]>;
  /** Your answer: a transcribed take of the conversation, or typed text. An answer still waiting for the partner is replaced. */
  addLearnerTurn(conversationId: string, answer: { attemptId?: string; typedText?: string; outOfTime?: boolean }): Promise<ConversationView>;
  /** Previews the partner's next turn; nothing is sent. Refused when it would pass the conversation's cost limit. */
  previewPartnerTurn(conversationId: string): Promise<PartnerPreview>;
  /** Sends an approved turn: single-use and bound to your answers as they were previewed (A-33). */
  requestPartnerTurn(conversationId: string, requestId: string, payloadSha256: string): Promise<ConversationView>;
  /** A local model's turn without asking: only with auto-send ticked and a server on this computer. Stop it with `stopPartnerRequest(partnerAutoKey(id))`. */
  sendPartnerTurnAuto(conversationId: string): Promise<ConversationView>;
  /** Stops waiting for a partner, panel, upgrade or feedback request (before dispatch nothing is billed). */
  stopPartnerRequest(key: string): Promise<void>;
  /** The scripted partner's next line, or the panel's next question. No request is made. */
  nextScriptedTurn(conversationId: string): Promise<ConversationView>;
  /** Ends the conversation; three or more answers earn effort once. */
  endConversation(conversationId: string): Promise<ConversationView>;
  setConversationLimit(conversationId: string, maxCostMicroUsd: number): Promise<ConversationView>;
  /** Previews questions from a panel of listeners about a transcribed take (13.9). */
  previewQaPanel(attemptId: string, personas: PanelPersona[], model?: CoachingModel): Promise<TakePartnerPreview>;
  /** Sends an approved panel preview and starts its conversation. */
  startQaPanel(attemptId: string, personas: PanelPersona[], requestId: string, payloadSha256: string): Promise<ConversationView>;
  /** Previews a clearer version of a transcribed take's answer (13.10). */
  previewUpgrade(attemptId: string, model?: CoachingModel): Promise<TakePartnerPreview>;
  requestUpgrade(attemptId: string, requestId: string, payloadSha256: string): Promise<UpgradeRun>;
  listUpgradeRuns(attemptId: string): Promise<UpgradeRun[]>;
  getUpgradeRun(runId: string): Promise<UpgradeRun>;
  /** Previews AI feedback on a whole conversation (13.11): your turns, with the partner's lines as context. */
  previewConversationFeedback(conversationId: string, model?: CoachingModel): Promise<CoachingPreview>;
  requestConversationFeedback(conversationId: string, requestId: string, payloadSha256: string): Promise<ConversationFeedbackRun>;
  /** Real world (M14): picks this week's mission, or skips the week with `null`. `week` is the week's first day. */
  pickMission(week: string, missionId: string | null): Promise<MissionPick>;
  getMissionPick(week: string): Promise<MissionPick | null>;
  /** Takes back this week's pick or skip, so the offers show again; a done week stays. */
  clearMission(week: string): Promise<void>;
  /** Creates or changes an event you prepare for (14.2). */
  saveEvent(input: EventInput): Promise<PlannedEvent>;
  /** Replaces the plan items that are not done; done ones stay and all are numbered by day. */
  saveEventPlan(eventId: string, items: EventPlanItemInput[]): Promise<EventView>;
  /** Ticks or unticks a plan item by hand; it no longer ticks itself. */
  setPlanItemDone(itemId: string, done: boolean): Promise<EventView>;
  linkEventTalk(eventId: string, talkId: string): Promise<EventView>;
  /** An event with its plan, brought up to date with the work you did. */
  getEvent(eventId: string): Promise<EventView>;
  /** Your events, soonest first. */
  listEvents(): Promise<EventView[]>;
  /** Deletes an event softly; its talk and rehearsal takes stay. */
  deleteEvent(eventId: string): Promise<void>;
  /** Creates or changes a talk (14.3); its sections replace the old ones in order. */
  saveTalk(input: TalkInput): Promise<TalkView>;
  getTalk(talkId: string): Promise<TalkView>;
  listTalks(): Promise<TalkView[]>;
  deleteTalk(talkId: string): Promise<void>;
  /** Links a saved rehearsal take to its talk with a snapshot of the sections; recording it again keeps the first. */
  recordRehearsal(talkId: string, attemptId: string): Promise<RehearsalReport>;
  rehearsalReport(attemptId: string): Promise<RehearsalReport>;
  /** A talk's rehearsals, oldest first. */
  listRehearsals(talkId: string): Promise<RehearsalReport[]>;
  /** This month's time capsule (14.5); the first call in a month starts its seven days on offer. */
  capsuleOffer(today: string): Promise<CapsuleOffer>;
  /** Not this month. */
  dismissCapsule(month: string): Promise<void>;
  /** Saves a listener pack for one take where you choose (14.4); null when you cancel. Nothing is sent anywhere. */
  exportListenerPack(attemptId: string, questions: string[], from: string, includeTranscript: boolean): Promise<ListenerPack | null>;
  /** Imports a listener's answer file you choose; null when you cancel. The same file twice changes nothing. */
  importListenerAnswers(): Promise<ListenerImport | null>;
  listListenerPacks(sessionId?: string): Promise<ListenerPack[]>;
  listListenerFeedback(sessionId?: string): Promise<ListenerFeedback[]>;
  /** Your judgement of whether the listener got your main point; null clears it. */
  setListenerJudgement(feedbackId: string, understood: boolean | null): Promise<ListenerFeedback>;
  /** Club mode (M15.2): only times, counts and your notes; nobody is recorded. */
  saveClubMeeting(input: ClubMeetingInput): Promise<ClubMeetingView>;
  listClubMeetings(): Promise<ClubMeetingSummary[]>;
  getClubMeeting(id: string): Promise<ClubMeetingView>;
  deleteClubMeeting(id: string): Promise<void>;
  saveClubSpeech(meetingId: string, speechId: string, result: ClubSpeechResult): Promise<ClubMeetingView>;
  clubSummary(id: string): Promise<string>;
  exportClubSummary(id: string): Promise<string | null>;
  openClubLight(): Promise<void>;
  publishClubLight(state: ClubLightState): Promise<void>;
  onClubLight(listener: (state: ClubLightState) => void): Promise<() => void>;
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

/** The key Stop waiting uses for a local conversation's automatic partner turn (D-33). */
export const partnerAutoKey = (conversationId: string) => `partner-auto-${conversationId}`;

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
