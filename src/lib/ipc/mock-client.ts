/**
 * In-memory IpcClient used for UI development (M1) and component tests.
 * Replaced by the Tauri `invoke` client once the native commands exist (M2).
 */
import { addLocalDays, nextIntervalDays, toLocalDate } from "@/lib/phrase-schedule";
import { IpcError, type IpcClient, type PracticeContext } from "./client";
import * as data from "./mock-data";
import * as S from "./schemas";
import { searchLibrary } from "../search";

const LATENCY_MS = 120;

function respond<T>(schema: { parse: (v: unknown) => T }, value: unknown): Promise<T> {
  // Parse through the same schemas the real client will use, so the mock can't drift from the contract.
  return new Promise<void>((resolve) => setTimeout(resolve, LATENCY_MS)).then(() => schema.parse(structuredClone(value)));
}

const includes = (hay: string, needle: string) => hay.toLowerCase().includes(needle.toLowerCase());

/**
 * Effort points for the preview, mirroring `engagement::EventKind::xp` and its
 * daily caps in the native core (roadmap 7.4, appendix B). Keep them in step.
 */
export const MOCK_XP: Record<string, { xp: number; dailyCap?: number }> = {
  take_saved: { xp: 10 },
  retake: { xp: 5 },
  sequence_completed: { xp: 20 },
  reflection_saved: { xp: 10 },
  transcript_reviewed: { xp: 10 },
  phrase_saved: { xp: 5, dailyCap: 5 },
  phrase_reviewed: { xp: 2, dailyCap: 10 },
  transfer_review: { xp: 30 },
  baseline_saved: { xp: 20 },
};
/** Takes shorter than this earn nothing; only the first six takes of a session count. */
const MIN_TAKE_MS = 10_000;
const MAX_COUNTED_ORDINAL = 6;

/** A stable small number from an ID, so sample measures differ per take but never change. */
function wobble(id: string, spread: number): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 997;
  return ((h / 997) * 2 - 1) * spread;
}
const round1 = (n: number) => Math.round(n * 10) / 10;

function cleanPhrase(input: S.PhraseInput) {
  return {
    original: input.original.trim(),
    expression: input.expression.trim(),
    explanation: input.explanation.trim(),
    examples: input.examples.map((e) => e.trim()).filter(Boolean),
  };
}

export function createMockClient(): IpcClient {
  const phrases = structuredClone(data.phrases);
  const prompts = structuredClone(data.prompts);
  const sessions = structuredClone(data.sessions);
  const transferReviews: S.TransferReview[] = [];
  const events: S.PracticeEvent[] = [];
  /** Records an event once per kind and reference; above a daily cap it is kept with 0 XP. */
  const award = (kind: string, refId: string, localDate: string, ids: { sessionId?: string; attemptId?: string } = {}, backfilled = false) => {
    if (events.some((e) => e.kind === kind && e.refId === refId)) return;
    const rule = MOCK_XP[kind];
    const earnedToday = events.filter((e) => e.kind === kind && e.localDate === localDate && e.xp > 0).length;
    const xp = rule.dailyCap !== undefined && earnedToday >= rule.dailyCap ? 0 : rule.xp;
    events.push({ id: events.length + 1, kind, refId, localDate, sessionId: ids.sessionId ?? null, attemptId: ids.attemptId ?? null, xp, backfilled, createdAt: new Date().toISOString() });
  };
  const awardTake = (session: S.SessionDetail, attempt: S.Attempt, backfilled = false) => {
    if (attempt.durationMs < MIN_TAKE_MS || attempt.ordinal > MAX_COUNTED_ORDINAL) return;
    award("take_saved", attempt.id, session.localDate, { sessionId: session.id, attemptId: attempt.id }, backfilled);
    if (attempt.ordinal >= 2) award("retake", attempt.id, session.localDate, { sessionId: session.id, attemptId: attempt.id }, backfilled);
  };
  // The sample history already counts, as the native backfill does after the upgrade.
  for (const session of sessions) {
    for (const attempt of session.attempts) awardTake(session, attempt, true);
    if (session.ease != null || session.takeaway) award("reflection_saved", session.id, session.localDate, { sessionId: session.id }, true);
  }
  const trash = new Map<string, { session: (typeof sessions)[number]; deletedAtMs: number }>();
  // Insights (M8): your self-checks and A/B choices; one saved phrase spotted in the sample history.
  const selfChecks = new Map<string, Map<S.SelfCheckId, string>>();
  const checkValues = new Map<string, boolean>();
  const comparisons: S.Comparison[] = [];
  const sampleTake = sessions.find((s) => s.attempts.length > 0);
  const phraseUses: { phraseId: string; attemptId: string; sessionId: string; segment: number }[] =
    sampleTake && phrases[0] ? [{ phraseId: phrases[0].id, attemptId: sampleTake.attempts[0].id, sessionId: sampleTake.id, segment: 1 }] : [];
  const livePaceListeners = new Set<(pace: S.LivePace) => void>();
  const attemptOf = (attemptId: string) => {
    for (const session of sessions) {
      if (trash.has(session.id)) continue;
      const attempt = session.attempts.find((a) => a.id === attemptId);
      if (attempt) return { session, attempt };
    }
    return null;
  };
  /** Speech rate from the audio, as the desktop app computes it from a take (8.8). */
  const audioMeasures = (attemptId: string, durationMs: number): S.AudioMeasures => {
    if (durationMs < 5_000)
      return { attemptId, method: "nuclei-v1", syllables: null, spanMs: null, phonationMs: null, rateSps: null, articulationSps: null, unavailableReason: "Needs at least 5 seconds of speech." };
    const rate = round1(4.1 + wobble(attemptId, 0.5));
    const spanMs = durationMs - 1_500;
    return {
      attemptId, method: "nuclei-v1", syllables: Math.round((rate * spanMs) / 1000), spanMs, phonationMs: Math.round(spanMs * 0.82),
      rateSps: rate, articulationSps: round1(rate / 0.82), unavailableReason: null,
    };
  };
  let retentionDays: S.TrashRetentionDays = 30;
  let preferences: S.Preferences = { ...S.DEFAULT_PREFERENCES };
  let transcriptionPreference: S.TranscriptionPreference = { mode: "local", provider: "deepgram" };
  const recordingListeners = new Set<(status: S.RecordingStatus) => void>();
  let recording: S.RecordingStatus | null = null;
  let started = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let recordingFor: { title: string; context?: PracticeContext } | null = null;
  let lastPaceSecond = 0;
  const levelListeners = new Set<(level: S.InputLevel) => void>();
  let monitorTimer: ReturnType<typeof setInterval> | undefined;
  const notify = () => { if (recording) recordingListeners.forEach((listener) => listener(structuredClone(recording!))); };

  /**
   * A simulated take joins its practice session (created on the first take), as a
   * real take does, so the preview's sessions, Practice complete and focus panels
   * behave like the desktop app. No audio exists; review shows sample data.
   */
  const addSimulatedTake = (attemptId: string, durationMs: number) => {
    const ctx = recordingFor?.context;
    if (!ctx) return;
    let session = sessions.find((s) => s.id === ctx.sessionId);
    if (!session) {
      const now = new Date();
      session = S.SessionDetail.parse({
        id: ctx.sessionId, title: recordingFor!.title, localDate: toLocalDate(now), startedAt: now.toISOString(),
        exerciseType: ctx.exerciseType, durationMs: 0, attemptCount: 0, favorite: false, hasNote: false, tags: [],
        status: "completed", prompt: ctx.prompt, outline: ctx.outline, focus: null, notes: "", conditions: ctx.conditions,
        attempts: [], curriculumVersion: ctx.curriculumVersion ?? null, contentId: ctx.contentId ?? null, activitySnapshot: ctx.activity ?? null,
      });
      sessions.unshift(session);
    } else if (ctx.activity && session.activitySnapshot && JSON.stringify(session.activitySnapshot) !== JSON.stringify(ctx.activity)) {
      return;
    }
    const attempt: S.Attempt = { id: attemptId, ordinal: session.attempts.length + 1, captureState: "saved", analysisState: null, durationMs, createdAt: new Date().toISOString(), firstTake: session.attempts.length === 0, step: ctx.step ?? null };
    session.attempts.push(attempt);
    session.attemptCount = session.attempts.length;
    session.durationMs += durationMs;
    awardTake(session, attempt);
  };

  /** Facts from the sample history (7.6): takes count as transcribed in the order the sample says. */
  const buildFacts = (): S.PracticeFacts => {
    const shown = sessions.filter((s) => !trash.has(s.id) && (s.attemptCount > 0 || s.status === "completed"));
    const filled = (text: string | undefined | null) => !!text && text.trim().length > 0;
    return S.PracticeFacts.parse({
      factsVersion: 2,
      generatedAt: new Date().toISOString(),
      today: data.today(),
      transcriptionAvailable: false,
      sessions: shown.map((s) => ({
        id: s.id, localDate: s.localDate, startedAt: s.startedAt, exerciseType: s.exerciseType, contentId: s.contentId ?? null, tags: s.tags,
        familiarity: s.conditions?.familiarity ?? null, preparationSeconds: s.conditions?.preparationSeconds ?? null, targetSeconds: s.conditions?.targetSeconds ?? null,
        audience: filled(s.conditions?.audience), followUp: s.conditions?.followUp ?? false,
        outline: [filled(s.outline.point), filled(s.outline.reason), filled(s.outline.example)],
        ease: s.ease ?? null, focus: s.focus, takeaway: filled(s.takeaway), status: s.status, takeCount: s.attemptCount, durationMs: s.durationMs, preferredTake: s.preferredTake ?? null,
      })),
      takes: shown.flatMap((s) => s.attempts.map((a, i) => {
        const transcribed = i < (s.transcribedTakes ?? 0);
        return {
          id: a.id, sessionId: s.id, ordinal: a.ordinal, localDate: s.localDate, createdAt: a.createdAt, durationMs: a.durationMs, stepKey: a.step?.key ?? null,
          transcribed, revisionId: transcribed ? `${a.id}--1` : null,
          words: transcribed ? 128 : null, paceWpm: transcribed ? 126 : null, speechSpanMs: transcribed ? Math.max(0, a.durationMs - 2000) : null,
          fillerCandidates: transcribed ? 3 : null, fillersConfirmed: transcribed ? 0 : null, fillersReviewed: false, pausesOverThreshold: transcribed ? 2 : null,
          prosodyViewed: false, hasAiFeedback: false,
          meanRun: transcribed ? round1(7.2 + wobble(a.id, 1.6)) : null, longestRun: transcribed ? Math.round(15 + wobble(a.id, 4)) : null,
          midClausePauses: transcribed ? Math.round(1 + wobble(a.id, 1)) : null, boundaryPauses: transcribed ? 4 : null,
          watchPer100: transcribed ? round1(1.6 + wobble(a.id, 0.8)) : null, hedgesPer100: transcribed ? round1(2.4 + wobble(a.id, 1)) : null,
          differentPer50: transcribed ? round1(36 + wobble(a.id, 3)) : null,
          phraseIds: phraseUses.filter((u) => u.attemptId === a.id && phrases.some((p) => p.id === u.phraseId)).map((u) => u.phraseId),
          checks: Object.fromEntries([...(selfChecks.get(a.id)?.keys() ?? [])].map((check) => [check, checkValues.get(`${a.id}:${check}`)])),
          pitchRangeSt: null,
          rateSps: audioMeasures(a.id, a.durationMs).rateSps,
        };
      })),
      transferReviews: transferReviews.map((r) => ({ id: r.id, localDate: r.localDate, hasListenerWords: filled(r.listenerText), neededClarification: filled(r.clarification), hasSuccess: filled(r.success), hasNextFocus: filled(r.nextFocus) })),
      phrases: phrases.map((p) => ({ id: p.id, createdAt: new Date().toISOString(), starter: false, deleted: false })),
      phraseReviews: [],
      progression: [],
    });
  };

  return {
    recordingMode: "simulated",
    getApiKeyStatus: async () => S.CredentialStatus.parse({ provider: "OpenAI", present: false }),
    getApiUsageSummary: async () => S.BudgetSummary.parse({ currency: "USD", month: "2026-10", stopMicroUsd: 5_000_000, warningMicroUsd: 4_000_000, countedMicroUsd: 0, coachingMicroUsd: 0, transcriptionMicroUsd: 0, uncertainMicroUsd: 0, settledMicroUsd: 0, reservedMicroUsd: 0, remainingMicroUsd: 5_000_000, warning: false }),
    storeApiKey: async () => { throw new IpcError("desktop_required", "API key storage is available in the desktop app."); },
    removeApiKey: async () => { throw new IpcError("desktop_required", "API key storage is available in the desktop app."); },
    previewCoachingRequest: async () => { throw new IpcError("desktop_required", "API previews are available in the desktop app."); },
    cancelCoachingPreview: async () => {},
    requestCoaching: async () => { throw new IpcError("desktop_required", "API feedback is available in the desktop app."); },
    previewTakeCoaching: async () => { throw new IpcError("desktop_required", "AI feedback on takes is available in the desktop app."); },
    requestTakeCoaching: async () => { throw new IpcError("desktop_required", "AI feedback on takes is available in the desktop app."); },
    stopTakeCoaching: async () => {},
    listTakeCoaching: async () => [],
    appUptimeMs: async () => Math.round(performance.now()),
    recordTiming: async () => {},
    getTimings: async () => ({}),
    testLocalLlm: async () => { throw new IpcError("desktop_required", "A local model is tested from the desktop app."); },
    buildDiagnostics: async () => { throw new IpcError("desktop_required", "Diagnostic reports are made in the desktop app."); },
    saveDiagnostics: async () => null,
    getStorageUsage: async () => { throw new IpcError("desktop_required", "Storage is measured in the desktop app."); },
    clearCache: async () => { throw new IpcError("desktop_required", "Available in the desktop app."); },
    previewFollowUp: async () => { throw new IpcError("desktop_required", "AI follow-up questions are available in the desktop app."); },
    requestFollowUp: async () => { throw new IpcError("desktop_required", "AI follow-up questions are available in the desktop app."); },
    listPracticeEvents: async (from) =>
      S.PracticeEvent.array().parse(structuredClone(events.filter((e) => !from || e.localDate >= from).sort((a, b) => a.localDate.localeCompare(b.localDate) || a.id - b.id))),
    recordSequenceCompleted: async (sessionIds, localDate) => {
      if (sessionIds.length === 0 || sessionIds.length > 10) throw new IpcError("invalid", "A sequence has between 1 and 10 sessions.");
      if (!sessionIds.some((id) => sessions.find((s) => s.id === id)?.attemptCount)) return null;
      const refId = `${localDate}:${sessionIds[0]}`;
      award("sequence_completed", refId, localDate, { sessionId: sessionIds[0] });
      return S.PracticeEvent.parse(structuredClone(events.find((e) => e.kind === "sequence_completed" && e.refId === refId)));
    },
    getPracticeFacts: async () => buildFacts(),
    listPhraseUses: (phraseId) =>
      respond(
        S.PhraseUse.array(),
        phraseUses
          .filter((u) => (!phraseId || u.phraseId === phraseId) && phrases.some((p) => p.id === u.phraseId) && attemptOf(u.attemptId))
          .map((u) => ({ ...u, revisionId: `${u.attemptId}--1`, localDate: attemptOf(u.attemptId)!.session.localDate })),
      ),
    setSelfCheck: async (attemptId, checkId, value) => {
      if (!attemptOf(attemptId)) throw new IpcError("not_found", "This take is unavailable.");
      const checks = selfChecks.get(attemptId) ?? new Map<S.SelfCheckId, string>();
      if (value === null) checks.delete(checkId);
      else {
        checks.set(checkId, new Date().toISOString());
        checkValues.set(`${attemptId}:${checkId}`, value);
      }
      selfChecks.set(attemptId, checks);
    },
    listSelfChecks: (attemptId) =>
      respond(
        S.SelfCheck.array(),
        [...(selfChecks.get(attemptId)?.entries() ?? [])].sort(([a], [b]) => a.localeCompare(b)).map(([checkId, createdAt]) => ({ attemptId, checkId, value: checkValues.get(`${attemptId}:${checkId}`), createdAt })),
      ),
    getAudioMeasures: (attemptId) => {
      const found = attemptOf(attemptId);
      if (!found) return Promise.reject(new IpcError("not_found", "This take is unavailable."));
      return respond(S.AudioMeasures, audioMeasures(attemptId, found.attempt.durationMs));
    },
    onLivePace: async (listener) => {
      const registration = (pace: S.LivePace) => listener(pace);
      livePaceListeners.add(registration);
      return () => { livePaceListeners.delete(registration); };
    },
    saveComparison: async (aAttempt, bAttempt, preferred, blind) => {
      const a = attemptOf(aAttempt);
      const b = attemptOf(bAttempt);
      if (!a || !b) throw new IpcError("not_found", "One of these takes is unavailable.");
      if (a.session.id === b.session.id) throw new IpcError("invalid", "Both takes are in one session: choose the preferred take there.");
      const comparison = S.Comparison.parse({ id: `cmp-${Date.now()}-${comparisons.length}`, aAttempt, bAttempt, preferred, blind, createdAt: new Date().toISOString() });
      comparisons.unshift(comparison);
      return structuredClone(comparison);
    },
    listComparisons: (attemptId) => respond(S.Comparison.array(), comparisons.filter((c) => c.aAttempt === attemptId || c.bAttempt === attemptId)),
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
    recordProgression: async () => { throw new IpcError("desktop_required", "Stages are kept in the desktop app."); },
    listTransferReviews: async () => [...transferReviews].sort((a, b) => b.localDate.localeCompare(a.localDate) || b.createdAt.localeCompare(a.createdAt)),
    addTransferReview: async (input) => {
      if (input.situation.trim().length < 3) throw new IpcError("invalid", "Describe the situation in a few words.");
      const trimmed = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v.trim()])) as S.TransferInput;
      const review: S.TransferReview = { ...trimmed, id: `transfer-${Date.now()}-${transferReviews.length}`, createdAt: new Date().toISOString() };
      transferReviews.push(review);
      award("transfer_review", review.id, review.localDate);
      return review;
    },
    deleteTransferReview: async (reviewId) => {
      const at = transferReviews.findIndex((r) => r.id === reviewId);
      if (at < 0) throw new IpcError("not_found", "This reflection no longer exists.");
      transferReviews.splice(at, 1);
    },
    addPrompt: async (input) => {
      const prompt: S.PracticePrompt = { id: `user-prompt-${Date.now()}`, text: input.text.trim(), tags: [...new Set(input.tags)], conditions: { ...input.conditions }, favorite: false, source: "user" };
      prompts.unshift(prompt);
      return prompt;
    },
    updatePrompt: async (promptId, input) => {
      const p = prompts.find((x) => x.id === promptId && x.source === "user");
      if (!p) throw new IpcError("not_found", "This prompt no longer exists.");
      Object.assign(p, { text: input.text.trim(), tags: [...new Set(input.tags)], conditions: { ...input.conditions } });
      return p;
    },
    deletePrompt: async (promptId) => {
      const at = prompts.findIndex((x) => x.id === promptId && x.source === "user");
      if (at < 0) throw new IpcError("not_found", "This prompt no longer exists.");
      prompts.splice(at, 1);
    },

    listSessions: (filter = {}) =>
      respond(
        S.SessionSummary.array(),
        sessions
          .filter((s) => !filter.exerciseType || s.exerciseType === filter.exerciseType)
          .filter((s) => !filter.favoritesOnly || s.favorite)
          .filter((s) => !filter.query || includes(s.title, filter.query) || includes(s.notes, filter.query))
          .map(({ prompt: _p, outline: _o, focus: _f, notes: _n, conditions: _c, attempts: _a, ...summary }) => ({
            ...summary,
            // Sample data shows every transcript state: all, some and none (simulated takes have none).
            transcribedTakes: summary.title === "Simulated take" || !data.sessions.some((d) => d.id === summary.id) ? 0
              : summary.id === "s-03" ? 0 : summary.id === "s-02" ? Math.max(0, summary.attemptCount - 1) : summary.attemptCount,
          })),
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
    // Sample data so the preview can show the whole flow; nothing is sent anywhere.
    previewPhraseSuggestions: async (sessionIds, model = "gpt-6-luna") => {
      const chosen = sessions.filter((s) => sessionIds.includes(s.id));
      if (!chosen.length) throw new IpcError("invalid", "Choose between 1 and 12 transcribed sessions.");
      return S.CoachingPreview.parse({
        version: 1, requestId: `phrases-${Date.now()}`, payloadSha256: "0".repeat(64), recipient: "https://api.openai.com/v1/responses", model,
        selectedText: chosen.map((s, i) => `Session ${i + 1}: ${s.title}\n${s.notes || s.prompt}`).join("\n\n"),
        prompt: "Suggest more natural phrasing from your sessions", focus: "Your words, a more natural expression, why, an example",
        instructions: "Sample instructions (browser preview).", maximumOutputTokens: 3072, estimatedMaximumCostMicroUsd: 2400,
        priceDate: "2026-10-08", priceSource: "sample", inputUsdPerMillionTokens: "0.10", outputUsdPerMillionTokens: "0.50",
        costExplanation: "Browser preview: nothing is sent. Only the session titles and transcripts are shown here, never audio.", expiresAtMs: Date.now() + 300_000,
      });
    },
    requestPhraseSuggestions: async () => S.PhraseSuggestion.array().parse([
      { session: 1, original: "I was reading for maybe forty minutes", expression: "I lost track of time", explanation: "A natural way to say time passed without you noticing.", example: "I lost track of time while cooking." },
      { session: 1, original: "first thing in the morning", expression: "the moment I wake up", explanation: "Sounds more personal and vivid in spoken English.", example: "I check the weather the moment I wake up." },
    ]),
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
    getClipProsody: async () => { throw new IpcError("desktop_required", "Intonation runs in the desktop app."); },
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
    // A speech-like level, so the preview's Ready state shows a live meter too.
    startLevelMonitor: async () => {
      if (monitorTimer) return;
      const began = performance.now();
      monitorTimer = setInterval(() => {
        const t = (performance.now() - began) / 1000;
        const voiced = Math.sin(t * 1.3) > 0.1;
        const level = voiced ? 0.05 + 0.12 * Math.abs(Math.sin(t * 7)) * (0.6 + 0.4 * Math.sin(t * 2.3)) : 0.004;
        levelListeners.forEach((listener) => listener({ level, clipping: false }));
      }, 100);
    },
    getWhisperDownloadOptions: async () => S.WhisperDownloadOptions.parse({
      nvidiaGpu: true,
      sizes: [
        { backend: "cpu", model: "large-v3-turbo-q5_0", downloadBytes: 582_023_296 },
        { backend: "cpu", model: "base", downloadBytes: 155_933_566 },
        { backend: "cuda", model: "large-v3-turbo-q5_0", downloadBytes: 1_273_448_874 },
        { backend: "cuda", model: "base", downloadBytes: 847_359_144 },
      ],
    }),
    downloadWhisper: async () => { throw new IpcError("desktop_required", "Whisper is downloaded and set up in the desktop app."); },
    cancelWhisperDownload: async () => {},
    onWhisperDownloadProgress: async () => () => {},
    // The browser preview keeps the browser's own frame: no window controls.
    minimizeWindow: async () => {},
    toggleMaximizeWindow: async () => {},
    closeWindow: async () => {},
    isWindowMaximized: async () => false,
    onWindowResized: async () => () => {},
    setZoom: async () => {},
    stopLevelMonitor: async () => {
      clearInterval(monitorTimer);
      monitorTimer = undefined;
    },
    onInputLevel: async (listener) => {
      const registration = (level: S.InputLevel) => listener(level);
      levelListeners.add(registration);
      return () => { levelListeners.delete(registration); };
    },
    getAttemptReview: (attemptId) => respond(S.AttemptReview, data.reviewForAttempt(attemptId)),
    setSessionReflection: async (id, ease, takeaway) => {
      const session = sessions.find((s) => s.id === id);
      if (!session) throw new IpcError("not_found", "This session is unavailable.");
      Object.assign(session, ease === null ? {} : { ease }, takeaway === null ? {} : { takeaway });
      if (ease !== null || takeaway?.trim()) award("reflection_saved", id, data.today(), { sessionId: id });
    },
    setPreferredTake: async (id, preferred) => {
      const session = sessions.find((s) => s.id === id);
      if (!session) throw new IpcError("not_found", "This session is unavailable.");
      session.preferredTake = preferred;
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
      if (details.tags.includes("baseline")) award("baseline_saved", id, session.localDate, { sessionId: id });
    },
    getSavedRecording: async () => { throw new IpcError("desktop_required", "Saved audio is available in the desktop app."); },

    listPhrases: () => respond(S.PhraseCard.array(), phrases),
    reviewPhrase: (phraseId, rating) => {
      const p = phrases.find((x) => x.id === phraseId);
      if (!p) return Promise.reject(new IpcError("not_found", "Phrase not found"));
      p.intervalDays = nextIntervalDays(p.intervalDays, rating);
      p.dueDate = addLocalDays(data.today(), p.intervalDays);
      award("phrase_reviewed", `review-${phraseId}-${Date.now()}-${events.length}`, data.today());
      return respond(S.PhraseCard, p);
    },

    addPhrase: (input, sourceSessionId) => {
      const card: S.PhraseCard = { id: `ph-${Date.now()}`, ...cleanPhrase(input), dueDate: data.today(), intervalDays: 0, sourceSessionId: sourceSessionId ?? null };
      phrases.push(card);
      award("phrase_saved", card.id, data.today());
      return respond(S.PhraseCard, card);
    },
    updatePhrase: (phraseId, input) => {
      const p = phrases.find((x) => x.id === phraseId);
      if (!p) return Promise.reject(new IpcError("not_found", "Phrase not found"));
      Object.assign(p, cleanPhrase(input));
      return respond(S.PhraseCard, p);
    },
    deletePhrase: async (phraseId) => {
      const at = phrases.findIndex((x) => x.id === phraseId);
      if (at < 0) throw new IpcError("not_found", "Phrase not found");
      phrases.splice(at, 1);
    },

    getProgress: (view) => respond(S.ProgressSummary, data.progressFor(view)),

    searchContent: (query) => {
      const q = query.trim();
      if (!q) return respond(S.SearchHit.array(), []);
      const hits = [
        ...data.sessions
          .filter((s) => includes(s.title, q) || includes(s.notes, q) || includes(s.prompt, q))
          .map((s) => ({ kind: "session", id: s.id, title: s.title, excerpt: s.notes || s.prompt, href: `/sessions/${s.id}` })),
        ...searchLibrary(q, phrases, prompts, data.guides),
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
      lastPaceSecond = 0;
      started = performance.now();
      recordingFor = { title: request.title, context: request.context };
      const livePace = request.livePace === true;
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
        // Live pace (8.8): a gently varying rate around 4.2 a second, once a second, after 3 s of speech.
        const second = Math.floor(recording.elapsedMs / 1000);
        if (livePace && second > 0 && second !== lastPaceSecond) {
          lastPaceSecond = second;
          const voicedMs = Math.round(recording.elapsedMs * 0.8);
          const pace = S.LivePace.parse({
            attemptId: recording.attemptId,
            syllablesPerSecond: voicedMs >= 3_000 ? round1(4.2 + Math.sin(second / 3) * 0.4) : null,
            voicedMs,
            windowMs: 8_000,
          });
          livePaceListeners.forEach((listener) => listener(pace));
        }
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
      addSimulatedTake(attemptId, asset.durationMs);
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
