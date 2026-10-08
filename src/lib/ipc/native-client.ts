import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { z } from "zod";
import { IpcError, type IpcClient } from "./client";
import { createMockClient } from "./mock-client";
import * as S from "./schemas";

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
    listModelPacks: () => command("list_model_packs", S.ModelPack.array()),
    importModelPack: () => command("import_model_pack", S.ModelPack.array()),
    getTranscriptionSetup: () => command("get_transcription_setup", S.TranscriptionSetup),
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
