import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { z } from "zod";
import { IpcError, type IpcClient } from "./client";
import { createMockClient } from "./mock-client";
import * as S from "./schemas";
import { buildProgress, buildTodayPlan } from "../today-plan";
import { toLocalDate } from "../phrase-schedule";

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
  return {
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
    listPhrases: () => command("list_phrases", S.PhraseCard.array()),
    // The status line from your real settings, not sample data (4.12).
    getServiceStatus: async () => {
      const labels = { deepgram: "Deepgram", assemblyai: "AssemblyAI" } as const;
      const [preference, setup, keys, openai] = await Promise.all([
        command("get_transcription_preference", S.TranscriptionPreference),
        command("get_transcription_setup", S.TranscriptionSetup).catch(() => null),
        command("get_transcription_api_keys", S.ProviderKeyStatus.array()).catch(() => []),
        command("get_api_key_status", S.CredentialStatus).catch(() => null),
      ]);
      const cloud = preference.mode === "api";
      const transcription = cloud
        ? { mode: "api" as const, model: labels[preference.provider], state: keys.some((k) => k.provider === preference.provider && k.present) ? ("ready" as const) : ("needs_setup" as const) }
        : { mode: "local" as const, model: setup?.modelId ?? null, state: setup?.configured ? ("ready" as const) : ("needs_setup" as const) };
      return S.ServiceStatus.parse({
        transcription,
        coaching: { mode: "api", providerLabel: "OpenAI", state: openai?.present ? "ready" : "needs_setup" },
        storage: { lastBackupAt: null },
      });
    },
    // Progress from your own sessions (4.16, first part): the 60 most recent are read.
    getProgress: async (view) => {
      const sessions = await command("list_sessions", S.SessionSummary.array(), { filter: null });
      const details = await Promise.all(
        sessions.filter((s) => s.status !== "interrupted" && s.attemptCount > 0).slice(0, 60).map((s) => command("get_session", S.SessionDetail, { sessionId: s.id }).catch(() => null)),
      );
      return S.ProgressSummary.parse(buildProgress(view, details.filter((d): d is S.SessionDetail => d !== null)));
    },
    // Today's plan from your own sessions and phrases plus the curriculum rotation (4.12).
    getTodayPlan: async (length) => {
      const [sessions, phrases] = await Promise.all([
        command("list_sessions", S.SessionSummary.array(), { filter: null }),
        command("list_phrases", S.PhraseCard.array()),
      ]);
      const newest = sessions.find((s) => s.status === "completed") ?? sessions.find((s) => s.status !== "interrupted" && s.attemptCount > 0);
      const latest = newest ? await command("get_session", S.SessionDetail, { sessionId: newest.id }).catch(() => null) : null;
      return S.TodayPlan.parse(buildTodayPlan({ localDate: toLocalDate(new Date()), length, sessions, phrases, latest }));
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
    // Sessions come from SQLite; prompts, guides and phrases are still sample curriculum (M4).
    searchContent: async (query) => {
      const [sessions, curriculum] = await Promise.all([
        command("search_content", S.SearchHit.array(), { query }),
        preview.searchContent(query),
      ]);
      return [...sessions, ...curriculum.filter((hit) => hit.kind !== "session")];
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
    updateSession: async (sessionId, details) => { await command("update_session", S.Id.nullable(), { sessionId, ...details }); },
    getSavedRecording: (assetId) => command("get_saved_recording", S.SavedRecording, { assetId }),
    getAttemptReview: async () => { throw new IpcError("analysis_pending", "Transcription and analysis are not connected to saved sessions yet."); },
    getApiKeyStatus: () => command("get_api_key_status", S.CredentialStatus),
    getApiUsageSummary: () => command("get_api_usage_summary", S.BudgetSummary),
    previewCoachingRequest: (selectedText, model) => command("preview_coaching_request", S.CoachingPreview, { selectedText, model: model ?? null }),
    cancelCoachingPreview: async (requestId) => { await invoke("cancel_coaching_preview", { requestId }); },
    requestCoaching: (requestId, payloadSha256) => command("request_coaching", S.FeedbackResult, { requestId, payloadSha256 }),
    storeApiKey: (key) => command("store_api_key", S.CredentialStatus, { key }),
    removeApiKey: () => command("remove_api_key", S.CredentialStatus),
    listInputDevices: () => command("list_input_devices", S.InputDevice.array()),
    startRecording: ({ context, ...request }) => command("start_recording", S.RecordingStatus, { request, context: context ?? null }),
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
}

export function createAppClient(): IpcClient {
  return isTauri() ? createNativeClient() : createMockClient();
}
