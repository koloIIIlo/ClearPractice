/**
 * In-memory IpcClient used for UI development (M1) and component tests.
 * Replaced by the Tauri `invoke` client once the native commands exist (M2).
 */
import { addLocalDays, nextIntervalDays } from "@/lib/phrase-schedule";
import { IpcError, type IpcClient } from "./client";
import * as data from "./mock-data";
import * as S from "./schemas";

const LATENCY_MS = 120;

function respond<T>(schema: { parse: (v: unknown) => T }, value: unknown): Promise<T> {
  // Parse through the same schemas the real client will use, so the mock can't drift from the contract.
  return new Promise<void>((resolve) => setTimeout(resolve, LATENCY_MS)).then(() => schema.parse(structuredClone(value)));
}

const includes = (hay: string, needle: string) => hay.toLowerCase().includes(needle.toLowerCase());

export function createMockClient(): IpcClient {
  const phrases = structuredClone(data.phrases);
  const prompts = structuredClone(data.prompts);
  const sessions = structuredClone(data.sessions);
  const trash = new Map<string, { session: (typeof sessions)[number]; deletedAtMs: number }>();
  let retentionDays: S.TrashRetentionDays = 30;
  let preferences: S.Preferences = { ...S.DEFAULT_PREFERENCES };
  let transcriptionPreference: S.TranscriptionPreference = { mode: "local", provider: "deepgram" };
  const recordingListeners = new Set<(status: S.RecordingStatus) => void>();
  let recording: S.RecordingStatus | null = null;
  let started = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const notify = () => { if (recording) recordingListeners.forEach((listener) => listener(structuredClone(recording!))); };

  return {
    recordingMode: "simulated",
    getApiKeyStatus: async () => S.CredentialStatus.parse({ provider: "OpenAI", present: false }),
    getApiUsageSummary: async () => S.BudgetSummary.parse({ currency: "USD", month: "2026-10", stopMicroUsd: 5_000_000, warningMicroUsd: 4_000_000, countedMicroUsd: 0, coachingMicroUsd: 0, transcriptionMicroUsd: 0, uncertainMicroUsd: 0, remainingMicroUsd: 5_000_000, warning: false }),
    storeApiKey: async () => { throw new IpcError("desktop_required", "API key storage is available in the desktop app."); },
    removeApiKey: async () => { throw new IpcError("desktop_required", "API key storage is available in the desktop app."); },
    previewCoachingRequest: async () => { throw new IpcError("desktop_required", "API previews are available in the desktop app."); },
    cancelCoachingPreview: async () => {},
    requestCoaching: async () => { throw new IpcError("desktop_required", "API feedback is available in the desktop app."); },
    getServiceStatus: () =>
      respond(S.ServiceStatus, {
        transcription: { mode: "local", model: "large-v3-turbo-q5_0", state: "needs_setup" },
        coaching: { mode: "api", providerLabel: null, state: "needs_setup" },
        storage: { lastBackupAt: null },
      }),

    getTodayPlan: (length) => {
      const standard = [
        { exerciseType: "repeat", title: "Record and repeat", minutes: 6 },
        { exerciseType: "thought_groups", title: "Thought groups", minutes: 2 },
        { exerciseType: "imitate", title: "Listen and imitate", minutes: 3 },
        { exerciseType: "expression", title: "Expression practice", minutes: 2 },
      ];
      const short = [{ exerciseType: "repeat", title: "Record and repeat, two short takes", minutes: 5 }];
      const completed = data.sessions.filter((s) => s.status === "completed");
      return respond(S.TodayPlan, {
        localDate: data.today(),
        focus: "State your point before explaining it.",
        focusReason: "You chose clarity as a goal, and your last two sessions opened with a warm-up phrase.",
        length,
        steps: length === "standard" ? standard : short,
        resumable: null,
        lastCompleted: completed[0] ?? null,
        recentReflection: completed.find((s) => s.notes)?.notes ?? null,
        duePhrase: phrases.find((p) => p.dueDate <= data.today()) ?? null,
        weekly: {
          newSituation: {
            promptId: "p-tool",
            text: "Explain a tool you use at work to someone who has never seen it.",
            familiarity: "unfamiliar",
            reason: "Same demand as last week, with a new topic. One change at a time.",
          },
          realConversation: { task: "Explain a recent decision to someone and ask what they understood.", done: false },
        },
      });
    },

    listExercises: () => respond(S.ExerciseDefinition.array(), data.exercises),
    listPrompts: () => respond(S.PracticePrompt.array(), prompts),
    listGuides: () => respond(S.Guide.array(), data.guides),
    setPromptFavorite: async (promptId, favorite) => {
      const p = prompts.find((x) => x.id === promptId);
      if (!p) throw new IpcError("not_found", "Prompt not found");
      p.favorite = favorite;
    },

    listSessions: (filter = {}) =>
      respond(
        S.SessionSummary.array(),
        sessions
          .filter((s) => !filter.exerciseType || s.exerciseType === filter.exerciseType)
          .filter((s) => !filter.favoritesOnly || s.favorite)
          .filter((s) => !filter.query || includes(s.title, filter.query) || includes(s.notes, filter.query))
          .map(({ prompt: _p, outline: _o, focus: _f, notes: _n, conditions: _c, attempts: _a, ...summary }) => summary),
      ),

    getSession: (sessionId) => {
      const s = sessions.find((x) => x.id === sessionId);
      if (!s) return Promise.reject(new IpcError("not_found", "This session no longer exists."));
      return respond(S.SessionDetail, s);
    },

    listTrash: () => {
      const items = [...trash.values()]
        .sort((a, b) => b.deletedAtMs - a.deletedAtMs)
        .map(({ session: s, deletedAtMs }) => ({
          id: s.id, title: s.title, localDate: s.localDate,
          deletedAt: new Date(deletedAtMs).toISOString(),
          purgeAt: new Date(deletedAtMs + retentionDays * 86_400_000).toISOString(),
          attemptCount: s.attemptCount, durationMs: s.durationMs, audioBytes: 0, unsavedTakeCount: 0,
        }));
      return respond(S.TrashList, { retentionDays, items, takes: [] });
    },
    moveSessionToTrash: async (sessionId) => {
      const index = sessions.findIndex((s) => s.id === sessionId);
      if (index < 0) throw new IpcError("not_found", "This session is unavailable.");
      const [session] = sessions.splice(index, 1);
      trash.set(sessionId, { session, deletedAtMs: Date.now() });
    },
    restoreSession: async (sessionId) => {
      const entry = trash.get(sessionId);
      if (!entry) throw new IpcError("not_found", "This session is no longer in Trash.");
      trash.delete(sessionId);
      sessions.push(entry.session);
      sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },
    deleteSessionsPermanently: async (sessionIds) => {
      if (sessionIds.some((id) => !trash.has(id))) throw new IpcError("invalid", "Only sessions in Trash can be deleted permanently.");
      sessionIds.forEach((id) => trash.delete(id));
      return { filesPending: false };
    },
    chooseClipFile: async () => { throw new IpcError("desktop_required", "Clips can be imported in the desktop app."); },
    getClipStagingUrl: async () => { throw new IpcError("desktop_required", "Clips can be imported in the desktop app."); },
    discardClipStaging: async () => {},
    saveClip: async () => { throw new IpcError("desktop_required", "Clips can be imported in the desktop app."); },
    listClips: async () => [],
    listClipFolders: async () => [],
    createClipFolder: async () => { throw new IpcError("desktop_required", "Folders work in the desktop app."); },
    renameClipFolder: async () => { throw new IpcError("desktop_required", "Folders work in the desktop app."); },
    deleteClipFolder: async () => { throw new IpcError("desktop_required", "Folders work in the desktop app."); },
    moveClips: async () => { throw new IpcError("desktop_required", "Folders work in the desktop app."); },
    updateClip: async () => { throw new IpcError("desktop_required", "Clips can be edited in the desktop app."); },
    listClipSources: async () => [],
    openClipSource: async () => { throw new IpcError("desktop_required", "The import history works in the desktop app."); },
    updateClipSource: async () => { throw new IpcError("desktop_required", "The import history works in the desktop app."); },
    deleteClipSource: async () => { throw new IpcError("desktop_required", "The import history works in the desktop app."); },
    getClipPlaybackUrl: async () => { throw new IpcError("desktop_required", "Clips play in the desktop app."); },
    splitClipSource: async () => { throw new IpcError("desktop_required", "Splitting runs in the desktop app."); },
    onClipSplitProgress: async () => () => {},
    previewSplitTranscription: async () => { throw new IpcError("desktop_required", "Cloud transcription runs in the desktop app."); },
    requestSplitTranscription: async () => { throw new IpcError("desktop_required", "Cloud transcription runs in the desktop app."); },
    cancelClipWork: async () => {},
    saveClipSections: async () => { throw new IpcError("desktop_required", "Clips can be saved in the desktop app."); },
    previewClipNames: async () => { throw new IpcError("desktop_required", "AI suggestions run in the desktop app."); },
    requestClipNames: async () => { throw new IpcError("desktop_required", "AI suggestions run in the desktop app."); },
    measureClipSource: async () => { throw new IpcError("desktop_required", "Measuring runs in the desktop app."); },
    onClipMeasureProgress: async () => () => {},
    previewClipPicks: async () => { throw new IpcError("desktop_required", "AI choices run in the desktop app."); },
    requestClipPicks: async () => { throw new IpcError("desktop_required", "AI choices run in the desktop app."); },
    getLinkToolStatus: async () => ({ available: false, path: null }),
    chooseLinkTool: async () => { throw new IpcError("desktop_required", "Links work in the desktop app."); },
    downloadLinkTool: async () => { throw new IpcError("desktop_required", "yt-dlp can be downloaded in the desktop app."); },
    onLinkToolDownload: async () => () => {},
    fetchLinkAudio: async () => { throw new IpcError("desktop_required", "Links work in the desktop app."); },
    deleteClip: async () => { throw new IpcError("desktop_required", "Clips can be deleted in the desktop app."); },
    moveTakeToTrash: async () => { throw new IpcError("desktop_required", "Takes can be moved to Trash in the desktop app."); },
    restoreTake: async () => { throw new IpcError("desktop_required", "Takes can be restored in the desktop app."); },
    deleteTakesPermanently: async () => { throw new IpcError("desktop_required", "Takes can be deleted in the desktop app."); },
    emptyTrash: async () => {
      trash.clear();
      return { filesPending: false };
    },
    setTrashRetention: async (days) => {
      retentionDays = S.TrashRetentionDays.parse(days);
    },
    getBackupStatus: () => respond(S.BackupStatus, { destination: null, destinationAvailable: false, backups: [], autoEnabled: true, keep: 4, nextDueAtMs: null }),
    setAutoBackup: async () => { throw new IpcError("desktop_required", "Backups are available in the desktop app."); },
    chooseBackupDestination: async () => { throw new IpcError("desktop_required", "Backups are available in the desktop app."); },
    createBackup: async () => { throw new IpcError("desktop_required", "Backups are available in the desktop app."); },
    previewRestore: async () => { throw new IpcError("desktop_required", "Restore is available in the desktop app."); },
    discardRestorePreview: async () => {},
    restoreBackup: async () => { throw new IpcError("desktop_required", "Restore is available in the desktop app."); },
    exportSession: async () => { throw new IpcError("desktop_required", "Export is available in the desktop app."); },
    listModelPacks: async () => [],
    getTakeProsody: async () => { throw new IpcError("desktop_required", "Intonation runs in the desktop app."); },
    importModelPack: async () => { throw new IpcError("desktop_required", "Model packs are managed in the desktop app."); },
    getPreferences: async () => ({ ...preferences }),
    getDataLocation: async () => ({ current: "%LOCALAPPDATA%\\com.clearpractice.app", default: "%LOCALAPPDATA%\\com.clearpractice.app", custom: false, problem: null, previous: null, previousBytes: 0 }),
    moveDataFolder: async () => { throw new IpcError("desktop_required", "The data folder can be moved in the desktop app."); },
    onDataMoveProgress: async () => () => {},
    removeOldDataCopy: async () => { throw new IpcError("desktop_required", "Available in the desktop app."); },
    restartApp: async () => {},
    setPreferences: async (next) => (preferences = { ...next }),
    getTranscriptionPreference: async () => ({ ...transcriptionPreference }),
    setTranscriptionPreference: async (preference) => (transcriptionPreference = { ...preference }),
    getTranscriptionSetup: () => respond(S.TranscriptionSetup, { configured: false, modelId: null, backend: null, prompt: null, unavailableReason: "Local transcription runs in the desktop app." }),
    chooseTranscriptionSetup: async () => { throw new IpcError("desktop_required", "Local transcription runs in the desktop app."); },
    getAttemptTranscript: (attemptId) => respond(S.AttemptTranscript, { attemptId, revision: null, correction: null, job: null }),
    transcribeAttempt: async () => { throw new IpcError("desktop_required", "Local transcription runs in the desktop app."); },
    setFillerDecision: async () => { throw new IpcError("desktop_required", "Transcripts are available in the desktop app."); },
    saveTranscriptCorrection: async () => { throw new IpcError("desktop_required", "Transcripts are available in the desktop app."); },
    cancelTranscription: async () => null,
    onTranscriptionEvent: async () => () => {},
    getTranscriptionApiKeys: async () => [{ provider: "deepgram", present: false }, { provider: "assemblyai", present: false }],
    storeTranscriptionApiKey: async () => { throw new IpcError("desktop_required", "API keys are managed in the desktop app."); },
    removeTranscriptionApiKey: async () => { throw new IpcError("desktop_required", "API keys are managed in the desktop app."); },
    previewApiTranscription: async () => { throw new IpcError("desktop_required", "API transcription runs in the desktop app."); },
    cancelApiTranscriptionPreview: async () => {},
    cancelApiTranscription: async () => {},
    getApiPreviewAudioUrl: async () => { throw new IpcError("desktop_required", "API transcription runs in the desktop app."); },
    requestApiTranscription: async () => { throw new IpcError("desktop_required", "API transcription runs in the desktop app."); },
    startMicTest: async () => { throw new IpcError("desktop_required", "The microphone test runs in the desktop app."); },
    getMicTestPlaybackUrl: async () => { throw new IpcError("desktop_required", "The microphone test runs in the desktop app."); },
    onMicTestEvent: async () => () => {},
    getAttemptReview: (attemptId) => respond(S.AttemptReview, data.reviewForAttempt(attemptId)),
    setSessionReflection: async (id, ease, takeaway) => {
      const session = sessions.find((s) => s.id === id);
      if (!session) throw new IpcError("not_found", "This session is unavailable.");
      Object.assign(session, ease === null ? {} : { ease }, takeaway === null ? {} : { takeaway });
    },
    setSessionFocus: async (id, focus) => {
      const session = sessions.find((s) => s.id === id);
      if (!session) throw new IpcError("not_found", "This session is unavailable.");
      session.focus = focus;
    },
    updateSession: async (id, details) => {
      const session = sessions.find((s) => s.id === id);
      if (!session) throw new IpcError("not_found", "This session is unavailable.");
      Object.assign(session, details, { hasNote: details.notes.length > 0 });
    },
    getSavedRecording: async () => { throw new IpcError("desktop_required", "Saved audio is available in the desktop app."); },

    listPhrases: () => respond(S.PhraseCard.array(), phrases),
    reviewPhrase: (phraseId, rating) => {
      const p = phrases.find((x) => x.id === phraseId);
      if (!p) return Promise.reject(new IpcError("not_found", "Phrase not found"));
      p.intervalDays = nextIntervalDays(p.intervalDays, rating);
      p.dueDate = addLocalDays(data.today(), p.intervalDays);
      return respond(S.PhraseCard, p);
    },

    getProgress: (view) => respond(S.ProgressSummary, data.progressFor(view)),

    searchContent: (query) => {
      const q = query.trim();
      if (!q) return respond(S.SearchHit.array(), []);
      const hits = [
        ...data.sessions
          .filter((s) => includes(s.title, q) || includes(s.notes, q) || includes(s.prompt, q))
          .map((s) => ({ kind: "session", id: s.id, title: s.title, excerpt: s.notes || s.prompt, href: `/sessions/${s.id}` })),
        ...phrases
          .filter((p) => includes(p.expression, q) || includes(p.original, q))
          .map((p) => ({ kind: "phrase", id: p.id, title: p.expression, excerpt: p.explanation, href: `/phrases?focus=${p.id}` })),
        ...prompts
          .filter((p) => includes(p.text, q))
          .map((p) => ({ kind: "prompt", id: p.id, title: p.text, excerpt: null, href: `/exercises?prompt=${p.id}` })),
        ...data.guides
          .filter((g) => includes(g.title, q) || includes(g.summary, q))
          .map((g) => ({ kind: "guide", id: g.id, title: g.title, excerpt: g.summary, href: `/exercises?tab=guides&guide=${g.id}` })),
      ];
      return respond(S.SearchHit.array(), hits);
    },

    listInputDevices: () =>
      respond(S.InputDevice.array(), [
        {
          id: "dev-default",
          name: "Microphone Array (Realtek Audio)",
          isDefault: true,
          available: true,
          supportedConfigs: [{ channels: 2, minSampleRate: 44100, maxSampleRate: 48000, sampleFormat: "F32" }],
        },
        { id: "dev-usb", name: "USB Headset Microphone", isDefault: false, available: false, supportedConfigs: [] },
      ]),
    startRecording: async (request) => {
      if (recording?.attemptId === request.attemptId) return S.RecordingStatus.parse(recording);
      if (recording?.phase === "recording") throw new IpcError("busy", "Another recording is already active.");
      started = performance.now();
      recording = S.RecordingStatus.parse({
        attemptId: request.attemptId, phase: "recording", elapsedMs: 0, monotonicMs: 0,
        level: 0, clipping: false, error: null, asset: null,
      });
      timer = setInterval(() => {
        if (!recording || recording.phase !== "recording") return;
        recording.elapsedMs = Math.round(performance.now() - started);
        recording.monotonicMs = recording.elapsedMs;
        recording.level = Math.max(0, Math.sin(recording.elapsedMs / 500) * 0.5);
        notify();
      }, 100);
      notify();
      return S.RecordingStatus.parse(recording);
    },
    stopRecording: async (attemptId) => {
      if (!recording || recording.attemptId !== attemptId) throw new IpcError("not_found", "Take not found.");
      if (recording.asset) return recording.asset;
      clearInterval(timer);
      recording.phase = "finalizing";
      notify();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const asset = S.SavedRecording.parse({
        attemptId, assetId: attemptId, title: "Simulated take", createdAtMs: Date.now(),
        durationMs: Math.round(performance.now() - started), sampleRate: 48000, channels: 1,
        sourceChannels: 2, sourceFormat: "F32", bytes: 0, sha256: "0".repeat(64), recovered: false,
      });
      recording = { ...recording, phase: "saved", elapsedMs: asset.durationMs, level: 0, asset };
      notify();
      return asset;
    },
    getRecordingStatus: async () => recording ? S.RecordingStatus.parse(recording) : null,
    onRecordingEvent: async (listener) => {
      // Wrap so registering the same function twice gives two independent registrations.
      const registration = (status: S.RecordingStatus) => listener(status);
      recordingListeners.add(registration);
      return () => { recordingListeners.delete(registration); };
    },
    onRecordingCloseRequested: async () => () => {},
    closeAfterRecording: async () => {},
    listRecordings: async () => [],
    listRecoverableRecordings: async () => [],
    discardRecoverableRecording: async () => {},
    recoverRecording: async () => { throw new IpcError("unavailable", "Recovery is available in the desktop app."); },
    getRecordingPlaybackUrl: async () => { throw new IpcError("unavailable", "Simulated takes contain no audio."); },
    getRecordingWaveform: async () => { throw new IpcError("unavailable", "Simulated takes contain no audio."); },
  };
}
