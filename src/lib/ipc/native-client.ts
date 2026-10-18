import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { z } from "zod";
import { IpcError, type IpcClient } from "./client";
import { createMockClient } from "./mock-client";
import * as S from "./schemas";
import { buildProgressFromFacts, buildTodayPlan, highlightSessionId } from "../today-plan";
import { schedule, tuning } from "../scheduler";
import { searchLibrary } from "../search";
import { toLocalDate } from "../phrase-schedule";
import { PROMPTS } from "@/content/prompts";

async function command<T>(name: string, schema: { parse(value: unknown): T }, args?: Record<string, unknown>): Promise<T> {
  try {
    return schema.parse(await invoke(name, args));
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new IpcError("recording_failed", typeof error === "string" ? error : "Recording is unavailable. Please try again.");
  }
}

/** Native history and recording; curriculum/analysis previews remain separate. */
export function createNativeClient(): IpcClient {
  const preview = createMockClient();
  const client: IpcClient = {
    ...preview,
    recordingMode: "native",
    listSessions: (filter) => command("list_sessions", S.SessionSummary.array(), { filter: filter ?? null }),
    getSession: (sessionId) => command("get_session", S.SessionDetail, { sessionId }),
    listTrash: () => command("list_trash", S.TrashList),
    moveSessionToTrash: async (sessionId) => { await command("move_session_to_trash", z.null(), { sessionId }); },
    restoreSession: async (sessionId) => { await command("restore_session", z.null(), { sessionId }); },
    deleteSessionsPermanently: (sessionIds) => command("delete_sessions_permanently", S.PurgeOutcome, { sessionIds }),
    emptyTrash: () => command("empty_trash", S.PurgeOutcome),
    chooseClipFile: () => command("choose_clip_file", S.ClipStaged.nullable()),
    getClipStagingUrl: async (stagingId) => convertFileSrc(await command("get_clip_staging_path", z.string(), { stagingId })),
    discardClipStaging: async (stagingId) => { await command("discard_clip_staging", z.null(), { stagingId }); },
    saveClip: (details) => command("save_clip", S.ReferenceClip, { ...details, folderId: details.folderId ?? null }),
    listClipFolders: () => command("list_clip_folders", S.ClipFolder.array()),
    createClipFolder: (name) => command("create_clip_folder", S.ClipFolder, { name }),
    renameClipFolder: async (folderId, name) => { await command("rename_clip_folder", z.null(), { folderId, name }); },
    deleteClipFolder: async (folderId) => { await command("delete_clip_folder", z.null(), { folderId }); },
    moveClips: async (clipIds, folderId) => { await command("move_clips", z.null(), { clipIds, folderId }); },
    updateClip: async (clipId, { title, description, feature }) => { await command("update_clip", z.null(), { clipId, title, description, feature }); },
    listClipSources: () => command("list_clip_sources", S.ClipSource.array()),
    openClipSource: (sourceId) => command("open_clip_source", S.OpenedSource, { sourceId }),
    updateClipSource: async (sourceId, { title, credit }) => { await command("update_clip_source", z.null(), { sourceId, title, credit }); },
    deleteClipSource: async (sourceId) => { await command("delete_clip_source", z.null(), { sourceId }); },
    listClips: () => command("list_clips", S.ReferenceClip.array()),
    getClipPlaybackUrl: async (clipId) => convertFileSrc(await command("get_clip_playback_path", z.string(), { clipId })),
    deleteClip: async (clipId) => { await command("delete_clip", z.null(), { clipId }); },
    splitClipSource: (stagingId) => command("split_clip_source", S.ClipCandidate.array(), { stagingId }),
    previewSplitTranscription: (stagingId, provider) => command("preview_split_transcription", S.AudioPreview, { stagingId, provider }),
    requestSplitTranscription: (requestId, payloadSha256) => command("request_split_transcription", S.ClipCandidate.array(), { requestId, payloadSha256 }),
    onClipSplitProgress: (listener) => listen<number>("clip_split_progress", (e) => listener(z.number().int().min(0).max(100).parse(e.payload))),
    cancelClipWork: async () => { await command("cancel_clip_work", z.null()); },
    saveClipSections: (stagingId, sections, folderId) => command("save_clip_sections", S.ReferenceClip.array(), { stagingId, sections, folderId: folderId ?? null }),
    previewClipNames: (texts, model) => command("preview_clip_names", S.CoachingPreview, { texts, model: model ?? null }),
    requestClipNames: (requestId, payloadSha256) => command("request_clip_names", S.ClipName.array(), { requestId, payloadSha256 }),
    previewPhraseSuggestions: (sessionIds, model) => command("preview_phrase_suggestions", S.CoachingPreview, { sessionIds, model: model ?? null }),
    requestPhraseSuggestions: (requestId, payloadSha256) => command("request_phrase_suggestions", S.PhraseSuggestion.array(), { requestId, payloadSha256 }),
    measureClipSource: (stagingId) => command("measure_clip_source", z.number().int().nonnegative(), { stagingId }),
    onClipMeasureProgress: (listener) =>
      listen("clip_measure_progress", (e) => listener(z.object({ stage: z.enum(["preparing", "measuring"]), percent: z.number().int().min(0).max(100).nullable() }).parse(e.payload))),
    previewClipPicks: (stagingId, { model, toneHint, wanted }) => command("preview_clip_picks", S.CoachingPreview, { stagingId, model: model ?? null, toneHint, wanted }),
    requestClipPicks: (stagingId, requestId, payloadSha256) => command("request_clip_picks", S.PickedClip.array(), { stagingId, requestId, payloadSha256 }),
    getLinkToolStatus: () => command("get_link_tool_status", S.LinkToolStatus),
    chooseLinkTool: () => command("choose_link_tool", S.LinkToolStatus),
    fetchLinkAudio: (url) => command("fetch_link_audio", S.LinkAudio, { url }),
    downloadLinkTool: () => command("download_link_tool", S.LinkToolStatus),
    onLinkToolDownload: (listener) =>
      listen("link_tool_download", (e) => listener(z.object({ received: z.number().nonnegative(), total: z.number().nonnegative().nullable() }).parse(e.payload))),
    moveTakeToTrash: async (attemptId) => { await command("move_take_to_trash", z.null(), { attemptId }); },
    restoreTake: async (attemptId) => { await command("restore_take", z.null(), { attemptId }); },
    deleteTakesPermanently: (attemptIds) => command("delete_takes_permanently", S.PurgeOutcome, { attemptIds }),
    setTrashRetention: async (days) => { await command("set_trash_retention", z.null(), { days }); },
    getBackupStatus: () => command("get_backup_status", S.BackupStatus),
    chooseBackupDestination: () => command("choose_backup_destination", S.BackupStatus),
    createBackup: () => command("create_backup", S.BackupSummary),
    setAutoBackup: (enabled, keep) => command("set_auto_backup", S.BackupStatus, { enabled, keep }),
    previewRestore: () => command("preview_restore", S.RestorePreview.nullable()),
    discardRestorePreview: async (stagingId) => { await command("discard_restore_preview", z.null(), { stagingId }); },
    restoreBackup: (stagingId) => command("restore_backup", S.RestoreOutcome, { stagingId }),
    exportSession: (sessionId) => command("export_session", S.ExportSummary.nullable(), { sessionId }),
    getTakeProsody: (attemptId) => command("get_take_prosody", S.IntonationContour, { attemptId }),
    getClipProsody: (clipId) => command("get_clip_prosody", S.IntonationContour, { clipId }),
    listModelPacks: () => command("list_model_packs", S.ModelPack.array()),
    importModelPack: () => command("import_model_pack", S.ModelPack.array()),
    getTranscriptionSetup: () => command("get_transcription_setup", S.TranscriptionSetup),
    getPreferences: () => command("get_preferences", S.Preferences),
    // Bundled prompts with your favourite marks, then your own prompts (4.13).
    listPrompts: async () => {
      const state = await command("get_prompt_state", S.PromptState);
      const marks = new Map(state.favorites.map((f) => [f.promptId, f.favorite]));
      const mine: S.PracticePrompt[] = state.userPrompts.map((p) => ({ ...p, favorite: marks.get(p.id) ?? false, source: "user" }));
      return [...mine, ...PROMPTS.map((p) => ({ ...p, favorite: marks.get(p.id) ?? p.favorite }))];
    },
    setPromptFavorite: async (promptId, favorite) => { await command("set_prompt_favorite", z.null(), { promptId, favorite }); },
    addPrompt: async (prompt) => ({ ...(await command("add_user_prompt", S.PromptState.shape.userPrompts.element, { prompt })), favorite: false, source: "user" as const }),
    updatePrompt: async (promptId, prompt) => ({ ...(await command("update_user_prompt", S.PromptState.shape.userPrompts.element, { promptId, prompt })), favorite: false, source: "user" as const }),
    deletePrompt: async (promptId) => { await command("delete_user_prompt", z.null(), { promptId }); },
    listTransferReviews: () => command("list_transfer_reviews", S.TransferReview.array()),
    recordProgression: (kind, reason) => command("record_progression", S.ProgressionEvent, { kind, reason }),
    addTransferReview: (review) => command("add_transfer_review", S.TransferReview, { review }),
    deleteTransferReview: async (reviewId) => { await command("delete_transfer_review", z.null(), { reviewId }); },
    listPhrases: () => command("list_phrases", S.PhraseCard.array()),
    // The status line from your real settings, not sample data (4.12).
    getServiceStatus: async () => {
      const labels = { deepgram: "Deepgram", assemblyai: "AssemblyAI" } as const;
      const [preference, setup, keys, openai, prefs, backups] = await Promise.all([
        command("get_transcription_preference", S.TranscriptionPreference),
        command("get_transcription_setup", S.TranscriptionSetup).catch(() => null),
        command("get_transcription_api_keys", S.ProviderKeyStatus.array()).catch(() => []),
        command("get_api_key_status", S.CredentialStatus).catch(() => null),
        command("get_preferences", S.Preferences).catch(() => S.DEFAULT_PREFERENCES),
        command("get_backup_status", S.BackupStatus).catch(() => null),
      ]);
      const transcription = preference.mode === "off"
        ? { mode: "off" as const, model: null, state: "ready" as const }
        : preference.mode === "api"
          ? { mode: "api" as const, model: labels[preference.provider], state: keys.some((k) => k.provider === preference.provider && k.present) ? ("ready" as const) : ("needs_setup" as const) }
          : { mode: "local" as const, model: setup?.modelId ?? null, state: setup?.configured ? ("ready" as const) : ("needs_setup" as const) };
      const coaching = prefs.coachingMode === "off"
        ? { mode: "off" as const, providerLabel: null, state: "ready" as const }
        : prefs.coachingMode === "local"
          ? { mode: "local_llm" as const, providerLabel: prefs.localModel || "Local model", state: "ready" as const }
          : { mode: "api" as const, providerLabel: "OpenAI", state: openai?.present ? ("ready" as const) : ("needs_setup" as const) };
      const lastBackup = backups?.backups.filter((b) => b.status === "verified").map((b) => b.createdAt).sort().at(-1) ?? null;
      return S.ServiceStatus.parse({ transcription, coaching, storage: { lastBackupAt: lastBackup } });
    },
    // Progress from your own sessions (4.16; one facts call since roadmap 8.6). Pace is the
    // Estimated pace of the latest transcribed take, or for unfamiliar tasks of the first take
    // only, before any retry (A-18). Only the highlighted session is read for its text.
    getProgress: async (view) => {
      const facts = await command("get_practice_facts", S.PracticeFacts);
      const highlight = highlightSessionId(view, facts);
      const texts: Record<string, { title: string; takeaway: string | null }> = {};
      if (highlight) {
        const d = await command("get_session", S.SessionDetail, { sessionId: highlight }).catch(() => null);
        if (d) texts[d.id] = { title: d.title, takeaway: d.takeaway ?? null };
      }
      return S.ProgressSummary.parse(buildProgressFromFacts(view, facts, texts));
    },
    // Today's plan from your own sessions and phrases plus the curriculum rotation (4.12).
    listPracticeEvents: (from) => command("list_practice_events", S.PracticeEvent.array(), { from: from ?? null }),
    recordSequenceCompleted: (sessionIds, localDate) => command("record_sequence_completed", S.PracticeEvent.nullable(), { sessionIds, localDate }),
    getPracticeFacts: () => command("get_practice_facts", S.PracticeFacts),
    addTakeEvents: (attemptId, marks) => command("add_take_events", z.number().int().nonnegative(), { attemptId, events: marks.map((m) => S.TakeMark.parse(m)) }),
    listTakeEvents: (attemptId) => command("list_take_events", S.TakeEvent.array(), { attemptId }),
    getActivityResult: (attemptId) => command("get_activity_result", S.ActivityResult, { attemptId }),
    previewDrillComparison: (sessionId, kind, model) => command("preview_drill_comparison", S.CoachingPreview, { sessionId, kind, model: model ?? null }),
    requestDrillComparison: (requestId, payloadSha256) => command("request_drill_comparison", S.DrillComparison, { requestId, payloadSha256 }),
    setPrediction: (attemptId, kind, predicted) => command("set_prediction", z.boolean(), { attemptId, kind, predicted }),
    listPredictions: (from) => command("list_predictions", S.Prediction.array(), { from: from ?? null }),
    getProgrammeState: () => command("get_programme_state", S.ProgrammeRun.nullable()),
    startProgramme: (programme) => command("start_programme", S.ProgrammeRun, { programme }),
    completeProgrammeStep: (programmeId, stepId, refId) => command("complete_programme_step", z.boolean(), { programmeId, stepId, refId: refId ?? null }),
    setProgrammeWeek: (programmeId, week, finished) => command("set_programme_week", S.ProgrammeRun, { programmeId, week, finished }),
    stopProgramme: async (programmeId) => { await command("stop_programme", z.null(), { programmeId }); },
    saveCatchRun: (attemptId, presses, caught, total) => command("save_catch_run", S.CatchRun, { attemptId, presses, caught, total }),
    listCatchRuns: (attemptId) => command("list_catch_runs", S.CatchRun.array(), { attemptId: attemptId ?? null }),
    skipReanswer: async (promptId, step) => { await command("skip_reanswer", z.null(), { promptId, step }); },
    listExposureSteps: () => command("list_exposure_steps", S.ExposureStep.array()),
    saveExposureSteps: (steps) => command("save_exposure_steps", S.ExposureStep.array(), { steps: steps.map((s) => ({ id: s.id ?? null, title: s.title, templateId: s.templateId ?? null })) }),
    listExposureAttempts: (stepId) => command("list_exposure_attempts", S.ExposureAttempt.array(), { stepId: stepId ?? null }),
    addExposureAttempt: (input) => command("add_exposure_attempt", S.ExposureAttempt, { input }),
    updateExposureAttempt: (id, input) => command("update_exposure_attempt", S.ExposureAttempt, { id, input }),
    deleteExposureAttempt: async (id) => { await command("delete_exposure_attempt", z.null(), { id }); },
    saveRoutineRun: (input) => command("save_routine_run", S.RoutineRun, { input: { steps: input.steps, keptNote: input.keptNote, eventId: input.eventId ?? null } }),
    listRoutineRuns: () => command("list_routine_runs", S.RoutineRun.array()),
    deleteRoutineRun: async (id) => { await command("delete_routine_run", z.null(), { id }); },
    setSegmentMark: async (revisionId, segment, liked) => { await command("set_segment_mark", z.null(), { revisionId, segment, liked }); },
    listSegmentMarks: (attemptId) => command("list_segment_marks", S.SegmentMark.array(), { attemptId }),
    bestMoments: (weekStart) => command("best_moments", S.Moment.array(), { weekStart }),
    startConversation: (input) => command("start_conversation", S.ConversationView, { input }),
    getConversation: (conversationId) => command("get_conversation", S.ConversationView, { conversationId }),
    listConversations: () => command("list_conversations", S.ConversationSummary.array()),
    addLearnerTurn: (conversationId, { attemptId, typedText, outOfTime }) =>
      command("add_learner_turn", S.ConversationView, { conversationId, attemptId: attemptId ?? null, typedText: typedText ?? null, outOfTime: outOfTime ?? false }),
    previewPartnerTurn: (conversationId) => command("preview_partner_turn", S.PartnerPreview, { conversationId }),
    requestPartnerTurn: (conversationId, requestId, payloadSha256) => command("request_partner_turn", S.ConversationView, { conversationId, requestId, payloadSha256 }),
    sendPartnerTurnAuto: (conversationId) => command("send_partner_turn_auto", S.ConversationView, { conversationId }),
    stopPartnerRequest: async (key) => { await invoke("cancel_api_transcription", { requestId: key }); },
    nextScriptedTurn: (conversationId) => command("next_scripted_turn", S.ConversationView, { conversationId }),
    endConversation: (conversationId) => command("end_conversation", S.ConversationView, { conversationId }),
    setConversationLimit: (conversationId, maxCostMicroUsd) => command("set_conversation_limit", S.ConversationView, { conversationId, maxCostMicroUsd }),
    previewQaPanel: (attemptId, personas, model) => command("preview_qa_panel", S.TakePartnerPreview, { attemptId, personas, model: model ?? null }),
    startQaPanel: (attemptId, personas, requestId, payloadSha256) => command("start_qa_panel", S.ConversationView, { attemptId, personas, requestId, payloadSha256 }),
    previewUpgrade: (attemptId, model) => command("preview_upgrade", S.TakePartnerPreview, { attemptId, model: model ?? null }),
    requestUpgrade: (attemptId, requestId, payloadSha256) => command("request_upgrade", S.UpgradeRun, { attemptId, requestId, payloadSha256 }),
    listUpgradeRuns: (attemptId) => command("list_upgrade_runs", S.UpgradeRun.array(), { attemptId }),
    getUpgradeRun: (runId) => command("get_upgrade_run", S.UpgradeRun, { runId }),
    previewConversationFeedback: (conversationId, model) => command("preview_conversation_feedback", S.CoachingPreview, { conversationId, model: model ?? null }),
    requestConversationFeedback: (conversationId, requestId, payloadSha256) =>
      command("request_conversation_feedback", S.ConversationFeedbackRun, { conversationId, requestId, payloadSha256 }),
    listPhraseUses: (phraseId) => command("list_phrase_uses", S.PhraseUse.array(), { cardId: phraseId ?? null }),
    setSelfCheck: async (attemptId, checkId, value) => {
      await command("set_self_check", z.null(), { attemptId, checkId, value });
    },
    listSelfChecks: (attemptId) => command("list_self_checks", S.SelfCheck.array(), { attemptId }),
    getAudioMeasures: (attemptId) => command("get_audio_measures", S.AudioMeasures, { attemptId }),
    onLivePace: (listener) => listen("live_pace", ({ payload }) => {
      const parsed = S.LivePace.safeParse(payload);
      if (parsed.success) listener(parsed.data);
    }),
    saveComparison: (aAttempt, bAttempt, preferred, blind) => command("save_comparison", S.Comparison, { aAttempt, bAttempt, preferred, blind }),
    listComparisons: (attemptId) => command("list_comparisons", S.Comparison.array(), { attemptId }),
    getEngagementState: (week) => command("get_engagement_state", S.EngagementState, { week }),
    recordUnlocks: (input) => command("record_unlocks", S.UnlockOutcome, { input }),
    setWeeklyQuests: (week, quests) => command("set_weekly_quests", S.QuestRow.array(), { week, quests }),
    swapWeeklyQuest: (week, slot, quest) => command("swap_weekly_quest", S.QuestRow, { week, slot, quest }),
    getTodayPlan: async (length) => {
      const [sessions, phrases, reviews, events, prompts, preferences] = await Promise.all([
        command("list_sessions", S.SessionSummary.array(), { filter: null }),
        command("list_phrases", S.PhraseCard.array()),
        command("list_transfer_reviews", S.TransferReview.array()).catch(() => []),
        command("list_progression_events", S.ProgressionEvent.array()).catch(() => []),
        client.listPrompts().catch(() => PROMPTS),
        command("get_preferences", S.Preferences).catch(() => S.DEFAULT_PREFERENCES),
      ]);
      const newest = sessions.find((s) => s.status === "completed") ?? sessions.find((s) => s.status !== "interrupted" && s.attemptCount > 0);
      const latest = newest ? await command("get_session", S.SessionDetail, { sessionId: newest.id }).catch(() => null) : null;
      // The scheduler reads your recent sessions with takes (4.18).
      const recentIds = sessions.filter((s) => s.status !== "interrupted" && s.attemptCount > 0).slice(0, 12).map((s) => s.id);
      const recent = (await Promise.all(recentIds.map((id) => command("get_session", S.SessionDetail, { sessionId: id }).catch(() => null))))
        .filter((d): d is S.SessionDetail => d !== null);
      const plan = schedule({ recent, events, prompts });
      const localDate = toLocalDate(new Date());
      const bias = preferences.challengeBias;
      const programme = await command("get_programme_state", S.ProgrammeRun.nullable()).catch(() => null);
      // The warm-up pick reads the game engine, so it loads only when the warm-up is on (11.3).
      let warmUp: S.TodayPlan["steps"][number] | null = null;
      if (preferences.warmUp) {
        const facts = await command("get_practice_facts", S.PracticeFacts).catch(() => null);
        if (facts) {
          const [{ pickWarmUp, warmUpStep }, { areaActivity }, { evalContext }] = await Promise.all([import("../learning/interleave"), import("../engagement/quests"), import("../engagement/criteria")]);
          warmUp = warmUpStep(pickWarmUp(facts, areaActivity(facts, localDate, evalContext(facts, localDate, prompts)), localDate));
        }
      }
      return S.TodayPlan.parse(buildTodayPlan({
        localDate, length, sessions, phrases, latest, reviews, plan, prompts, goals: preferences.goals,
        bias, warmUp, tuned: tuning(recent, plan.stage, bias),
        // The programme's text loads only while one runs, off the start-up path.
        programmeFocus: programme && !programme.completedAt && !programme.stoppedAt ? (await import("@/content/programmes")).weekFocus(programme) : null,
      }));
    },
    reviewPhrase: (phraseId, rating) => command("review_phrase", S.PhraseCard, { phraseId, rating }),
    addPhrase: (phrase, sourceSessionId) => command("add_phrase", S.PhraseCard, { phrase, sourceSessionId: sourceSessionId ?? null }),
    updatePhrase: (phraseId, phrase) => command("update_phrase", S.PhraseCard, { phraseId, phrase }),
    deletePhrase: async (phraseId) => { await command("delete_phrase", z.null(), { phraseId }); },
    getDataLocation: () => command("get_data_location", S.DataLocation),
    moveDataFolder: (toDefault) => command("move_data_folder", z.string().nullable(), { toDefault }),
    onDataMoveProgress: (listener) =>
      listen("data_move_progress", (e) => listener(z.object({ done: z.number().nonnegative(), total: z.number().nonnegative() }).parse(e.payload))),
    removeOldDataCopy: async () => { await command("remove_old_data_copy", z.null()); },
    restartApp: async () => { await command("restart_app", z.null()); },
    setPreferences: (preferences) => command("set_preferences", S.Preferences, { preferences }),
    getTranscriptionPreference: () => command("get_transcription_preference", S.TranscriptionPreference),
    setTranscriptionPreference: (preference) => command("set_transcription_preference", S.TranscriptionPreference, { preference }),
    chooseTranscriptionSetup: () => command("choose_transcription_setup", S.TranscriptionSetup),
    // Sessions from the native full-text index; your phrases, all prompts and the guides' text here (3.13).
    searchContent: async (query) => {
      const [sessions, phrases, prompts, guides] = await Promise.all([
        command("search_content", S.SearchHit.array(), { query }),
        command("list_phrases", S.PhraseCard.array()).catch(() => []),
        client.listPrompts().catch(() => []),
        preview.listGuides().catch(() => []),
      ]);
      return [...sessions, ...searchLibrary(query, phrases, prompts, guides)];
    },
    getAttemptTranscript: (attemptId) => command("get_attempt_transcript", S.AttemptTranscript, { attemptId }),
    saveTranscriptCorrection: (attemptId, parentRevisionId, text) => command("save_transcript_correction", S.Id, { attemptId, parentRevisionId, text }),
    setFillerDecision: async (revisionId, candidate, word, decision) => { await command("set_filler_decision", z.null(), { revisionId, candidate, word, decision }); },
    transcribeAttempt: (attemptId) => command("transcribe_attempt", S.Id, { attemptId }),
    cancelTranscription: () => command("cancel_transcription", S.Id.nullable()),
    getTranscriptionApiKeys: () => command("get_transcription_api_keys", S.ProviderKeyStatus.array()),
    storeTranscriptionApiKey: (provider, key) => command("store_transcription_api_key", S.ProviderKeyStatus, { provider, key }),
    removeTranscriptionApiKey: (provider) => command("remove_transcription_api_key", S.ProviderKeyStatus, { provider }),
    previewApiTranscription: (attemptId, provider) => command("preview_api_transcription", S.AudioPreview, { attemptId, provider }),
    cancelApiTranscriptionPreview: async (requestId) => { await command("cancel_api_transcription_preview", z.null(), { requestId }); },
    cancelApiTranscription: async (requestId) => { await command("cancel_api_transcription", z.null(), { requestId }); },
    getApiPreviewAudioUrl: async (requestId) => convertFileSrc(await command("get_api_preview_audio_path", z.string(), { requestId })),
    requestApiTranscription: (requestId, payloadSha256) => command("request_api_transcription", S.AudioResult, { requestId, payloadSha256 }),
    startMicTest: (deviceId) => command("start_mic_test", S.RecordingStatus, { deviceId }),
    getWhisperDownloadOptions: () => command("whisper_download_options", S.WhisperDownloadOptions),
    downloadWhisper: (choice) => command("download_whisper", S.TranscriptionSetup, { choice }),
    cancelWhisperDownload: async () => { await command("cancel_whisper_download", z.null()); },
    onWhisperDownloadProgress: (listener) => listen("whisper_download_progress", ({ payload }) => {
      const parsed = S.WhisperDownloadProgress.safeParse(payload);
      if (parsed.success) listener(parsed.data);
    }),
    startLevelMonitor: async (deviceId) => { await command("start_level_monitor", z.null(), { deviceId }); },
    stopLevelMonitor: async () => { await command("stop_level_monitor", z.null()); },
    minimizeWindow: () => getCurrentWindow().minimize(),
    toggleMaximizeWindow: () => getCurrentWindow().toggleMaximize(),
    closeWindow: () => getCurrentWindow().close(),
    isWindowMaximized: () => getCurrentWindow().isMaximized(),
    onWindowResized: (listener) => getCurrentWindow().onResized(() => listener()),
    setZoom: (scale) => getCurrentWebview().setZoom(scale),
    onInputLevel: (listener) => listen("input_level", ({ payload }) => {
      const parsed = S.InputLevel.safeParse(payload);
      if (parsed.success) listener(parsed.data);
    }),
    getMicTestPlaybackUrl: async (attemptId) => convertFileSrc(await command("get_mic_test_playback_path", S.Id, { attemptId })),
    onMicTestEvent: async (onLevel, onFinished) => {
      const removers: (() => void)[] = [];
      try {
        removers.push(await listen("mic_test_level", ({ payload }) => {
          const parsed = S.RecordingStatus.safeParse(payload);
          if (parsed.success) onLevel(parsed.data);
        }));
        removers.push(await listen("mic_test_finished", ({ payload }) => {
          const parsed = S.MicTestFinished.safeParse(payload);
          if (parsed.success) onFinished(parsed.data);
        }));
      } catch (error) {
        removers.forEach((remove) => remove());
        throw error;
      }
      return () => removers.forEach((remove) => remove());
    },
    onTranscriptionEvent: async (listener) => {
      const removers: (() => void)[] = [];
      try {
        for (const event of ["transcription_progress", "transcription_finished"]) {
          removers.push(await listen(event, ({ payload }) => {
            const parsed = S.TranscriptionEvent.safeParse(payload);
            if (parsed.success) listener(parsed.data);
          }));
        }
      } catch (error) {
        removers.forEach((remove) => remove());
        throw error;
      }
      return () => removers.forEach((remove) => remove());
    },
    setSessionReflection: async (sessionId, ease, takeaway) => { await command("set_session_reflection", z.null(), { sessionId, ease, takeaway }); },
    setSessionFocus: async (sessionId, focus) => { await command("set_session_focus", z.null(), { sessionId, focus }); },
    setPreferredTake: async (sessionId, preferred) => { await command("set_preferred_take", z.null(), { sessionId, preferred }); },
    updateSession: async (sessionId, details) => { await command("update_session", S.Id.nullable(), { sessionId, ...details }); },
    getSavedRecording: (assetId) => command("get_saved_recording", S.SavedRecording, { assetId }),
    getAttemptReview: async () => { throw new IpcError("analysis_pending", "Transcription and analysis are not connected to saved sessions yet."); },
    getApiKeyStatus: () => command("get_api_key_status", S.CredentialStatus),
    getApiUsageSummary: () => command("get_api_usage_summary", S.BudgetSummary),
    previewCoachingRequest: (selectedText, model) => command("preview_coaching_request", S.CoachingPreview, { selectedText, model: model ?? null }),
    cancelCoachingPreview: async (requestId) => { await invoke("cancel_coaching_preview", { requestId }); },
    requestCoaching: (requestId, payloadSha256) => command("request_coaching", S.FeedbackResult, { requestId, payloadSha256 }),
    previewTakeCoaching: (attemptId, { model, deliveryImpressions, hide }) =>
      command("preview_take_coaching", S.TakeCoachingPreview, { attemptId, model, deliveryImpressions, hide }),
    requestTakeCoaching: (attemptId, requestId, payloadSha256) => command("request_take_coaching", S.CoachingRun, { attemptId, requestId, payloadSha256 }),
    stopTakeCoaching: async (requestId) => { await invoke("cancel_api_transcription", { requestId }); },
    listTakeCoaching: (attemptId) => command("list_take_coaching", S.CoachingRun.array(), { attemptId }),
    getStorageUsage: () => command("get_storage_usage", S.StorageCategory.array()),
    testLocalLlm: (endpoint) => command("test_local_llm", z.string().array(), { endpoint }),
    appUptimeMs: () => command("app_uptime_ms", z.number()),
    recordTiming: async (kind, ms) => { await command("record_timing", z.null(), { kind, ms: Math.max(0, Math.round(ms)) }); },
    getTimings: () => command("get_timings", S.Timings),
    buildDiagnostics: () => command("build_diagnostics", z.string()),
    saveDiagnostics: (text) => command("save_diagnostics", z.string().nullable(), { text }),
    clearCache: () => command("clear_cache", z.number().int().nonnegative()),
    previewFollowUp: (attemptId, model) => command("preview_follow_up", S.CoachingPreview, { attemptId, model }),
    requestFollowUp: (attemptId, requestId, payloadSha256) => command("request_follow_up", S.FollowUpQuestion, { attemptId, requestId, payloadSha256 }),
    storeApiKey: (key) => command("store_api_key", S.CredentialStatus, { key }),
    removeApiKey: () => command("remove_api_key", S.CredentialStatus),
    listInputDevices: () => command("list_input_devices", S.InputDevice.array()),
    startRecording: ({ context, livePace, ...request }) => command("start_recording", S.RecordingStatus, { request: { ...request, livePace: livePace ?? false }, context: context ?? null }),
    stopRecording: (attemptId) => command("stop_recording", S.SavedRecording, { attemptId }),
    getRecordingStatus: () => command("get_recording_status", S.RecordingStatus.nullable()),
    onRecordingEvent: async (listener) => {
      const removers: (() => void)[] = [];
      try {
        for (const event of ["recording_status", "recording_level", "recording_saved"]) {
          removers.push(await listen(event, ({ payload }) => {
            const parsed = S.RecordingStatus.safeParse(payload);
            if (parsed.success) listener(parsed.data);
          }));
        }
      } catch (error) {
        removers.forEach((remove) => remove());
        throw error;
      }
      return () => removers.forEach((remove) => remove());
    },
    onRecordingCloseRequested: (listener) => listen("recording_close_requested", listener),
    closeAfterRecording: async () => { await invoke("close_after_recording"); },
    listRecordings: () => command("list_recordings", S.SavedRecording.array()),
    listRecoverableRecordings: () => command("list_recoverable_recordings", S.RecoverableRecording.array()),
    recoverRecording: (attemptId) => command("recover_recording", S.SavedRecording, { attemptId }),
    discardRecoverableRecording: async (attemptId) => { await command("discard_recoverable_recording", z.null(), { attemptId }); },
    getRecordingPlaybackUrl: async (assetId) => convertFileSrc(await command("get_recording_playback_path", S.Id, { assetId })),
    getRecordingWaveform: (assetId) => command("get_recording_waveform", S.WaveformPeaks, { assetId }),
  };
  return client;
}

export function createAppClient(): IpcClient {
  return isTauri() ? createNativeClient() : createMockClient();
}
