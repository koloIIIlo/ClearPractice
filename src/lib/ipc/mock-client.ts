/**
 * In-memory IpcClient used for UI development (M1) and component tests.
 * Replaced by the Tauri `invoke` client once the native commands exist (M2).
 */
import { addLocalDays, nextIntervalDays, toLocalDate } from "@/lib/phrase-schedule";
import { IpcError, type IpcClient, type PracticeContext } from "./client";
import * as data from "./mock-data";
import { EXPOSURE_TEMPLATES } from "@/content/exposure-templates";
import type { MockPartnerHost } from "./mock-partner";
import type { MockEventsHost } from "./mock-events";
import * as S from "./schemas";
import { searchLibrary } from "../search";
import { isWeekStart, RECORD_UNITS, validateUnlockInput } from "../engagement/validate";

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
  level_reached: { xp: 50 },
  achievement: { xp: 20 },
  personal_record: { xp: 25 },
  weekly_goal: { xp: 50 },
  quest: { xp: 30 },
  drill_round: { xp: 15 },
  prediction: { xp: 5, dailyCap: 5 },
  programme_step: { xp: 10 },
  catch_run: { xp: 10 },
  reanswer_skipped: { xp: 0 },
  exposure_step: { xp: 30 },
  routine: { xp: 10 },
  after_action: { xp: 20 },
  conversation: { xp: 30 },
  upgrade: { xp: 20 },
  mission: { xp: 40 },
  event_debrief: { xp: 40 },
  listener_answers: { xp: 30 },
  capsule: { xp: 20 },
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
  /** Records an event once per kind and reference; above a daily cap it is kept with 0 XP. Returns its XP, or null when not new. */
  const award = (kind: string, refId: string, localDate: string, ids: { sessionId?: string; attemptId?: string } = {}, backfilled = false): number | null => {
    if (events.some((e) => e.kind === kind && e.refId === refId)) return null;
    const rule = MOCK_XP[kind];
    const earnedToday = events.filter((e) => e.kind === kind && e.localDate === localDate && e.xp > 0).length;
    const xp = rule.dailyCap !== undefined && earnedToday >= rule.dailyCap ? 0 : rule.xp;
    events.push({ id: events.length + 1, kind, refId, localDate, sessionId: ids.sessionId ?? null, attemptId: ids.attemptId ?? null, xp, backfilled, createdAt: new Date().toISOString() });
    return xp;
  };
  // Game core (M9): what the rules recorded, as the native ledgers keep it.
  const game = { levels: [] as S.LevelRow[], achievements: [] as S.AchievementRow[], records: [] as S.RecordRow[], quests: [] as S.QuestRow[] };
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
  // Drills (M10): marks per take and results computed on request, as the native cache keeps them.
  const takeEvents = new Map<string, S.TakeEvent[]>();
  const activityResults = new Map<string, S.ActivityResult>();
  let eventId = 0;
  /**
   * Sample results for the preview: plausible, stable per take and built from
   * the same marks and settings the desktop app reads. No audio exists here.
   */
  const mockResult = (session: S.SessionDetail, attempt: S.Attempt): S.ActivityResult => {
    const base = { attemptId: attempt.id, definitionVersion: 1 };
    const marks = takeEvents.get(attempt.id) ?? [];
    const params = session.activitySnapshot?.params ?? {};
    const list = (key: string) => (Array.isArray(params[key]) ? (params[key] as string[]) : []);
    const index = attempt.step?.index ?? 0;
    const words = Math.round((attempt.durationMs / 1000) * 2.1);
    const jitter = Math.abs(wobble(attempt.id, 1));
    switch (session.exerciseType) {
      case "jam": {
        const speakingMs = Math.min(60_000, Math.max(0, attempt.durationMs - 400));
        const hesitations = 2 + Math.round(jitter * 2);
        const flags = marks.filter((m) => m.kind === "self_flag").length;
        const cleanSeconds = Math.max(0, Math.floor((speakingMs - hesitations * 1000 - 1_800 - 500 - flags * 1000) / 1000));
        return { ...base, kind: "jam", speakingMs, cleanSeconds, hesitations, longPauses: 1, longPauseMs: 1_800, repeats: 1, flags, unavailableReason: null };
      }
      case "word_bomb": {
        const shown = new Map<number, number>();
        for (const m of marks) if (m.kind === "word_shown" && typeof m.data.index === "number" && !shown.has(m.data.index)) shown.set(m.data.index, m.atMs);
        const missed = jitter > 0.6 ? [...shown.keys()].at(-1) : undefined;
        const spokenAtMs = list("words").map((_, i) => (shown.has(i) && i !== missed ? shown.get(i)! + 2_500 : -1));
        return { ...base, kind: "word_bomb", shown: shown.size, woven: spokenAtMs.filter((s) => s >= 0).length, spokenAtMs, unavailableReason: null };
      }
      case "emphasis": {
        const target = Number(list("targets")[index] ?? 0);
        const count = (list("sentences")[index] ?? "").split(" ").filter(Boolean).length;
        const hit = jitter < 0.7;
        return { ...base, kind: "emphasis", round: index, target, peakWord: hit ? target : (target + 1) % Math.max(1, count), hit, aligned: true, nuclei: count + 2, expected: count + 2, unavailableReason: null };
      }
      case "pace_ladder": {
        if (attempt.durationMs < 5_000) return { ...base, kind: "pace_ladder", rateSps: null, unavailableReason: "Needs at least 5 seconds of speech." };
        const centre = { slow: 3.3, natural: 4.3, fast: 5.3 }[attempt.step?.key ?? "natural"] ?? 4.3;
        return { ...base, kind: "pace_ladder", rateSps: round1(centre + wobble(attempt.id, 0.2)), unavailableReason: null };
      }
      case "story_cubes": {
        const icons = list("icons").length;
        const usedIcons = list("icons").map((_, i) => (i === icons - 1 && jitter > 0.5 ? 0 : 1));
        return { ...base, kind: "story_cubes", icons, used: usedIcons.filter(Boolean).length, usedIcons, unavailableReason: null };
      }
      case "story_spine": {
        const advanced = marks.filter((m) => m.kind === "card_advanced").length;
        return { ...base, kind: "story_spine", steps: Math.min(7, advanced + 1), advanced, words };
      }
      case "daily": {
        const windows = [0, 0, jitter > 0.3 ? 1 : 0, 0, jitter > 0.6 ? 2 : 0, attempt.durationMs >= 55_000 ? 0 : 3];
        const n = (code: number) => windows.filter((w) => w === code).length;
        return { ...base, kind: "daily", windows, flowing: n(0), hesitation: n(1), pause: n(2), silent: n(3), transcribed: true, unavailableReason: null };
      }
      default:
        return { ...base, kind: "basic", durationMs: attempt.durationMs, words, speechMs: Math.max(0, attempt.durationMs - 800), hesitations: 2, differentPer50: round1(36 + wobble(attempt.id, 3)) };
    }
  };
  /** A result's numbers, as `FactTake.result` carries them (booleans as 1 or 0). */
  const resultNumbers = (result: S.ActivityResult | undefined): Record<string, number> | null =>
    result
      ? Object.fromEntries(
          Object.entries(result).flatMap(([k, v]): [string, number][] => (typeof v === "number" ? [[k, v]] : typeof v === "boolean" ? [[k, v ? 1 : 0]] : [])),
        )
      : null;
  // Learning engine (M11): guesses, programme runs and Catch it runs, as the native tables keep them.
  const predictions: S.Prediction[] = [];
  const programmes: S.ProgrammeRun[] = [];
  const catchRuns: S.CatchRun[] = [];
  // Confidence pack (M12): a sample ladder from the Meetings template, with a few attempts.
  const ladderStart = Date.now() - 20 * 86_400_000;
  const exposureSteps: (S.ExposureStep & { deleted: boolean })[] = EXPOSURE_TEMPLATES[0].steps.map((title, i) => ({
    id: `step-sample-${i + 1}`, position: i + 1, title, templateId: EXPOSURE_TEMPLATES[0].id, createdAt: new Date(ladderStart).toISOString(), deleted: false,
  }));
  const sampleAttempt = (step: number, daysAgo: number, before: number, after: number): S.ExposureAttempt => ({
    id: `exposure-sample-${step}-${daysAgo}`, stepId: `step-sample-${step}`, localDate: addLocalDays(toLocalDate(new Date()), -daysAgo),
    beforeRating: before, afterRating: after, outcome: "yes", note: "", createdAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  });
  const exposureAttempts: (S.ExposureAttempt & { deleted?: boolean })[] = [sampleAttempt(1, 12, 7, 4), sampleAttempt(1, 6, 5, 3), sampleAttempt(1, 2, 3, 1), sampleAttempt(2, 1, 7, 4)];
  for (const a of exposureAttempts) award("exposure_step", a.id, a.localDate, {}, true);
  const routineRuns: S.RoutineRun[] = [];
  const segmentMarks = new Map<string, Set<number>>();
  const OUTCOME_DONE = new Set(["yes", "partly"]);
  const checkAttempt = (input: S.ExposureAttemptInput) => {
    if (!S.ExposureOutcome.options.includes(input.outcome)) throw new IpcError("invalid", "Choose whether you did it from the list.");
    if ([input.beforeRating, input.afterRating].some((r) => r != null && (r < 0 || r > 10 || !Number.isInteger(r)))) throw new IpcError("invalid", "Discomfort is rated from 0 to 10.");
    if (input.outcome === "planned" && (input.beforeRating == null || input.afterRating != null)) throw new IpcError("invalid", "A plan has a before rating only.");
    if (input.note.length > 1000) throw new IpcError("invalid", "Keep the note under 1,000 characters.");
  };
  const BUCKETS: Record<S.PredictionKind, readonly string[]> = { hesitations: S.HesitationBucket.options, pace: S.PaceBucket.options };
  const activeProgramme = () => programmes.find((r) => !r.completedAt && !r.stoppedAt) ?? null;
  const programmeById = (id: string) => {
    const run = programmes.find((r) => r.id === id);
    if (!run) throw new IpcError("not_found", "This programme doesn't exist.");
    if (run.completedAt || run.stoppedAt) throw new IpcError("invalid", "This programme has finished. Start it again to go on.");
    return run;
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
    // Drills (M10): the first saved take of a drill session, whatever its length.
    if (S.isDrillType(session.exerciseType)) award("drill_round", session.id, session.localDate, { sessionId: session.id, attemptId });
    // Upgrade loop (M13): the retell take completes it.
    if (session.exerciseType === "upgrade" && ctx.step?.key === "retell") award("upgrade", session.id, session.localDate, { sessionId: session.id, attemptId });
    // The time capsule (M14): once per capsule session.
    if (session.exerciseType === "capsule") award("capsule", session.id, session.localDate, { sessionId: session.id, attemptId });
  };
  // Conversation partner (M13): sample takes read their sample transcript; simulated takes have none.
  const sampleTakes = new Set(sessions.flatMap((s) => s.attempts.map((a) => a.id)));
  const partnerHost: MockPartnerHost = {
    sessions,
    trashed: (sessionId) => trash.has(sessionId),
    award: (kind, refId, localDate, ids) => award(kind, refId, localDate, ids),
    preferences: () => preferences,
    takeText: (attemptId) => (sampleTakes.has(attemptId) ? data.reviewForAttempt(attemptId).revisions[0].segments.map((s) => s.text).join(" ") : null),
    sample: (() => {
      const session = sessions.find((s) => s.attempts.length > 1);
      return session ? { attemptId: session.attempts[0].id, sessionId: session.id, ordinal: session.attempts[0].ordinal } : undefined;
    })(),
  };
  // Loaded on first use, so the preview's partner stays off the app's start-up path.
  let partnerLoad: Promise<ReturnType<typeof import("./mock-partner").createMockPartner>> | null = null;
  const partner = () => (partnerLoad ??= import("./mock-partner").then((m) => m.createMockPartner(partnerHost)));
  type PartnerApi = Awaited<ReturnType<typeof partner>>["methods"];
  const later = <K extends keyof PartnerApi>(name: K) =>
    (async (...args: unknown[]) => ((await partner()).methods[name] as (...a: unknown[]) => unknown)(...args)) as PartnerApi[K];
  // Real-world practice (M14), also loaded on first use.
  const eventsHost: MockEventsHost = {
    sessions,
    trashed: (sessionId) => trash.has(sessionId),
    award: (kind, refId, localDate, ids) => award(kind, refId, localDate, ids),
    takeEvents: (attemptId) => takeEvents.get(attemptId) ?? [],
    transferReviews: () => transferReviews,
    routineRuns: () => routineRuns,
    conversations: async () => (await partner()).facts(),
    takeText: (attemptId) => partnerHost.takeText(attemptId),
  };
  let eventsLoad: Promise<ReturnType<typeof import("./mock-events").createMockEvents>> | null = null;
  const realWorld = () => (eventsLoad ??= import("./mock-events").then((m) => m.createMockEvents(eventsHost)));
  type EventsApi = Awaited<ReturnType<typeof realWorld>>["methods"];
  const soon = <K extends keyof EventsApi>(name: K) =>
    (async (...args: unknown[]) => ((await realWorld()).methods[name] as (...a: unknown[]) => unknown)(...args)) as EventsApi[K];
  let socialLoad: Promise<ReturnType<typeof import("./mock-social").createMockSocial>> | null = null;
  const social = () => (socialLoad ??= import("./mock-social").then((m) => m.createMockSocial()));
  type SocialApi = Awaited<ReturnType<typeof social>>;
  const socialSoon = <K extends keyof SocialApi>(name: K) =>
    (async (...args: unknown[]) => ((await social())[name] as (...a: unknown[]) => unknown)(...args)) as SocialApi[K];

  /** Facts from the sample history (7.6): takes count as transcribed in the order the sample says. */
  const buildFacts = (conversations: S.FactConversation[], world: Pick<S.PracticeFacts, "events" | "listenerAnswers" | "missionPicks">): S.PracticeFacts => {
    const shown = sessions.filter((s) => !trash.has(s.id) && (s.attemptCount > 0 || s.status === "completed"));
    const filled = (text: string | undefined | null) => !!text && text.trim().length > 0;
    const exposure = exposureSteps.map((s) => ({
      stepId: s.id, position: s.position, deleted: s.deleted,
      attempts: exposureAttempts.filter((a) => a.stepId === s.id && !a.deleted).map((a) => ({ localDate: a.localDate, before: a.beforeRating, after: a.afterRating, outcome: a.outcome, done: OUTCOME_DONE.has(a.outcome) })),
    }));
    return S.PracticeFacts.parse({
      factsVersion: 8,
      generatedAt: new Date().toISOString(),
      today: data.today(),
      transcriptionAvailable: false,
      sessions: shown.map((s) => ({
        id: s.id, localDate: s.localDate, startedAt: s.startedAt, exerciseType: s.exerciseType, contentId: s.contentId ?? null, tags: s.tags,
        familiarity: s.conditions?.familiarity ?? null, preparationSeconds: s.conditions?.preparationSeconds ?? null, targetSeconds: s.conditions?.targetSeconds ?? null,
        audience: filled(s.conditions?.audience), followUp: s.conditions?.followUp ?? false,
        outline: [filled(s.outline.point), filled(s.outline.reason), filled(s.outline.example)],
        ease: s.ease ?? null, focus: s.focus, takeaway: filled(s.takeaway), status: s.status, takeCount: s.attemptCount, durationMs: s.durationMs, preferredTake: s.preferredTake ?? null,
        activity: s.activitySnapshot ?? null,
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
          result: resultNumbers(activityResults.get(a.id)),
          predictions: Object.fromEntries(predictions.filter((p) => p.attemptId === a.id).map((p) => [p.kind, p.predicted])),
          catchRuns: catchRuns.filter((r) => r.attemptId === a.id).map((r) => ({ caught: r.caught, total: r.total, localDate: toLocalDate(new Date(r.createdAt)) })),
        };
      })),
      transferReviews: transferReviews.map((r) => ({
        id: r.id, localDate: r.localDate, hasListenerWords: filled(r.listenerText), neededClarification: filled(r.clarification), hasSuccess: filled(r.success),
        hasNextFocus: filled(r.nextFocus) || filled(r.extra?.nextTime), flow: r.flow, tags: r.tags, kind: r.kind, missionId: r.missionId, eventId: r.extra?.eventId ?? null,
      })),
      phrases: phrases.map((p) => ({ id: p.id, createdAt: new Date().toISOString(), starter: false, deleted: false })),
      phraseReviews: [],
      progression: [],
      userPrompts: prompts.filter((p) => p.source === "user").length,
      blindComparisons: comparisons.filter((c) => c.blind).length,
      programme: activeProgramme(),
      exposure,
      conversations,
      ...world,
    });
  };

  let smallText: Promise<import("./small-text-client").SmallTextClient> | undefined;
  const localText = () => smallText ??= import("./mock-small-text").then(({ createMockSmallText }) => createMockSmallText({ preferences: () => preferences, sessions: () => sessions }));

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
    getPracticeFacts: async () => buildFacts((await partner()).facts(), (await realWorld()).facts()),
    saveClubMeeting: socialSoon("saveClubMeeting"),
    listClubMeetings: socialSoon("listClubMeetings"),
    getClubMeeting: socialSoon("getClubMeeting"),
    deleteClubMeeting: socialSoon("deleteClubMeeting"),
    saveClubSpeech: socialSoon("saveClubSpeech"),
    clubSummary: socialSoon("clubSummary"),
    exportClubSummary: socialSoon("exportClubSummary"),
    openClubLight: socialSoon("openClubLight"),
    publishClubLight: socialSoon("publishClubLight"),
    onClubLight: socialSoon("onClubLight"),
    pickMission: soon("pickMission"),
    getMissionPick: soon("getMissionPick"),
    clearMission: soon("clearMission"),
    saveEvent: soon("saveEvent"),
    saveEventPlan: soon("saveEventPlan"),
    setPlanItemDone: soon("setPlanItemDone"),
    linkEventTalk: soon("linkEventTalk"),
    getEvent: soon("getEvent"),
    listEvents: soon("listEvents"),
    deleteEvent: soon("deleteEvent"),
    saveTalk: soon("saveTalk"),
    getTalk: soon("getTalk"),
    listTalks: soon("listTalks"),
    deleteTalk: soon("deleteTalk"),
    recordRehearsal: soon("recordRehearsal"),
    rehearsalReport: soon("rehearsalReport"),
    listRehearsals: soon("listRehearsals"),
    capsuleOffer: soon("capsuleOffer"),
    dismissCapsule: soon("dismissCapsule"),
    exportListenerPack: soon("exportListenerPack"),
    importListenerAnswers: soon("importListenerAnswers"),
    listListenerPacks: soon("listListenerPacks"),
    listListenerFeedback: soon("listListenerFeedback"),
    setListenerJudgement: soon("setListenerJudgement"),
    startConversation: later("startConversation"),
    getConversation: later("getConversation"),
    listConversations: later("listConversations"),
    addLearnerTurn: later("addLearnerTurn"),
    previewPartnerTurn: later("previewPartnerTurn"),
    requestPartnerTurn: later("requestPartnerTurn"),
    sendPartnerTurnAuto: later("sendPartnerTurnAuto"),
    stopPartnerRequest: later("stopPartnerRequest"),
    nextScriptedTurn: later("nextScriptedTurn"),
    endConversation: later("endConversation"),
    setConversationLimit: later("setConversationLimit"),
    previewQaPanel: later("previewQaPanel"),
    startQaPanel: later("startQaPanel"),
    previewUpgrade: later("previewUpgrade"),
    requestUpgrade: later("requestUpgrade"),
    listUpgradeRuns: later("listUpgradeRuns"),
    getUpgradeRun: later("getUpgradeRun"),
    previewConversationFeedback: later("previewConversationFeedback"),
    requestConversationFeedback: later("requestConversationFeedback"),
    setPrediction: async (attemptId, kind, predicted) => {
      const found = attemptOf(attemptId);
      if (!found) throw new IpcError("not_found", "This take is unavailable.");
      if (!BUCKETS[kind]?.includes(predicted)) throw new IpcError("invalid", "That guess isn't one of the choices.");
      if (predictions.some((p) => p.attemptId === attemptId && p.kind === kind)) return false;
      const first = !predictions.some((p) => p.attemptId === attemptId);
      predictions.push({ attemptId, kind, predicted, createdAt: new Date().toISOString() });
      if (first) award("prediction", attemptId, found.session.localDate, { sessionId: found.session.id, attemptId });
      return true;
    },
    listPredictions: (from) => respond(S.Prediction.array(), predictions.filter((p) => !from || toLocalDate(new Date(p.createdAt)) >= from).slice().reverse()),
    getProgrammeState: () => respond(S.ProgrammeRun.nullable(), programmes.at(-1) ?? null),
    startProgramme: async (programme) => {
      if (programme !== "fillers-4w") throw new IpcError("invalid", "Unknown programme.");
      const active = activeProgramme();
      if (active) return S.ProgrammeRun.parse(active);
      const now = new Date().toISOString();
      const run: S.ProgrammeRun = { id: `prog-${Date.now()}`, programme, week: 1, startedAt: now, weekStartedAt: now, weekStartedDate: toLocalDate(new Date()), completedAt: null, stoppedAt: null, steps: [] };
      programmes.push(run);
      return S.ProgrammeRun.parse(run);
    },
    completeProgrammeStep: async (programmeId, stepId, refId) => {
      const run = programmeById(programmeId);
      if (!/^[a-z0-9_-]{1,64}$/.test(stepId)) throw new IpcError("invalid", "This step is invalid.");
      // Redoing a step in a repeated week moves its date on; it earns only the first time.
      const done = run.steps.find((s) => s.stepId === stepId);
      if (done) {
        Object.assign(done, { doneAt: new Date().toISOString(), refId: refId ?? done.refId });
        return false;
      }
      run.steps.push({ stepId, refId: refId ?? null, doneAt: new Date().toISOString() });
      award("programme_step", `${programmeId}:${stepId}`, toLocalDate(new Date()));
      return true;
    },
    setProgrammeWeek: async (programmeId, week, finished) => {
      const run = programmeById(programmeId);
      if (!Number.isInteger(week) || week < 1 || week > 12) throw new IpcError("invalid", "That week doesn't exist.");
      const now = new Date();
      Object.assign(run, { week, weekStartedAt: now.toISOString(), weekStartedDate: toLocalDate(now), completedAt: finished ? now.toISOString() : null });
      return S.ProgrammeRun.parse(run);
    },
    stopProgramme: async (programmeId) => {
      programmeById(programmeId).stoppedAt = new Date().toISOString();
    },
    saveCatchRun: async (attemptId, presses, caught, total) => {
      const found = attemptOf(attemptId);
      if (!found) throw new IpcError("not_found", "This take is unavailable.");
      if (caught > total || total > 200 || presses.length > 500 || presses.some((p) => p < 0 || p > found.attempt.durationMs)) throw new IpcError("invalid", "This Catch it result is invalid.");
      const run: S.CatchRun = { id: `catch-${attemptId}-${Date.now()}`, attemptId, presses: [...presses], caught, total, createdAt: new Date().toISOString() };
      catchRuns.push(run);
      award("catch_run", run.id, found.session.localDate, { sessionId: found.session.id, attemptId });
      return S.CatchRun.parse(run);
    },
    listCatchRuns: (attemptId) => respond(S.CatchRun.array(), catchRuns.filter((r) => !attemptId || r.attemptId === attemptId).slice().reverse()),
    listExposureSteps: () => respond(S.ExposureStep.array(), exposureSteps.filter((s) => !s.deleted).sort((a, b) => a.position - b.position).map(({ deleted: _, ...s }) => s)),
    saveExposureSteps: async (steps) => {
      if (steps.length > 30) throw new IpcError("invalid", "A ladder has up to 30 steps.");
      if (steps.some((s) => s.title.trim().length < 3 || s.title.trim().length > 160)) throw new IpcError("invalid", "Give each step a short line of 3 to 160 characters.");
      const ids = steps.flatMap((s) => (s.id ? [s.id] : []));
      if (new Set(ids).size !== ids.length) throw new IpcError("invalid", "A step appears twice.");
      const active = exposureSteps.filter((s) => !s.deleted);
      if (ids.some((id) => !active.some((s) => s.id === id))) throw new IpcError("invalid", "This step no longer exists. Reopen the ladder and try again.");
      steps.forEach((input, i) => {
        const existing = input.id ? active.find((s) => s.id === input.id) : undefined;
        if (existing) Object.assign(existing, { position: i + 1, title: input.title.trim() });
        else exposureSteps.push({ id: `step-${Date.now()}-${i}`, position: i + 1, title: input.title.trim(), templateId: input.templateId ?? null, createdAt: new Date().toISOString(), deleted: false });
      });
      for (const s of active) if (!ids.includes(s.id)) s.deleted = true;
      return S.ExposureStep.array().parse(exposureSteps.filter((s) => !s.deleted).sort((a, b) => a.position - b.position).map(({ deleted: _, ...s }) => s));
    },
    listExposureAttempts: (stepId) =>
      respond(S.ExposureAttempt.array(), exposureAttempts.filter((a) => !a.deleted && (!stepId || a.stepId === stepId)).sort((a, b) => a.localDate.localeCompare(b.localDate) || a.createdAt.localeCompare(b.createdAt)).map(({ deleted: _, ...a }) => a)),
    addExposureAttempt: async (input) => {
      checkAttempt(input);
      if (!exposureSteps.some((s) => s.id === input.stepId && !s.deleted)) throw new IpcError("not_found", "This step is no longer on your ladder.");
      const attempt: S.ExposureAttempt = { ...input, note: input.note.trim(), id: `exposure-${Date.now()}-${exposureAttempts.length}`, createdAt: new Date().toISOString() };
      exposureAttempts.push(attempt);
      if (OUTCOME_DONE.has(attempt.outcome)) award("exposure_step", attempt.id, attempt.localDate);
      return S.ExposureAttempt.parse(attempt);
    },
    updateExposureAttempt: async (id, input) => {
      checkAttempt(input);
      const attempt = exposureAttempts.find((a) => a.id === id && !a.deleted);
      if (!attempt) throw new IpcError("not_found", "This attempt no longer exists.");
      if (attempt.stepId !== input.stepId) throw new IpcError("invalid", "An attempt stays on its own step.");
      Object.assign(attempt, { ...input, note: input.note.trim() });
      if (OUTCOME_DONE.has(attempt.outcome)) award("exposure_step", attempt.id, attempt.localDate);
      const { deleted: _, ...saved } = attempt;
      return S.ExposureAttempt.parse(saved);
    },
    deleteExposureAttempt: async (id) => {
      const attempt = exposureAttempts.find((a) => a.id === id && !a.deleted);
      if (!attempt) throw new IpcError("not_found", "This attempt no longer exists.");
      attempt.deleted = true;
    },
    saveRoutineRun: async (input) => {
      const steps = [...new Set(input.steps)];
      if (steps.length === 0) throw new IpcError("invalid", "Do at least one step of the routine.");
      const note = input.keptNote?.trim() || null;
      if (note && note.length > 4000) throw new IpcError("invalid", "Keep the note under 4,000 characters.");
      const run: S.RoutineRun = { id: `routine-${Date.now()}-${routineRuns.length}`, localDate: toLocalDate(new Date()), steps, keptNote: note, eventId: input.eventId ?? null, createdAt: new Date().toISOString() };
      routineRuns.unshift(run);
      award("routine", run.id, run.localDate);
      return S.RoutineRun.parse(run);
    },
    listRoutineRuns: () => respond(S.RoutineRun.array(), routineRuns),
    deleteRoutineRun: async (id) => {
      const at = routineRuns.findIndex((r) => r.id === id);
      if (at < 0) throw new IpcError("not_found", "This routine is no longer listed.");
      routineRuns.splice(at, 1);
    },
    setSegmentMark: async (revisionId, segment, liked) => {
      const marks = segmentMarks.get(revisionId) ?? new Set<number>();
      if (liked) marks.add(segment);
      else marks.delete(segment);
      segmentMarks.set(revisionId, marks);
    },
    listSegmentMarks: async (attemptId) =>
      S.SegmentMark.array().parse([...segmentMarks.entries()].filter(([revisionId]) => revisionId.startsWith(`${attemptId}-`)).flatMap(([revisionId, marks]) => [...marks].sort((a, b) => a - b).map((segment) => ({ revisionId, segment, kind: "liked" as const })))),
    bestMoments: async (weekStart) => {
      // The preview applies the same rules to its sample transcripts (12.5).
      const end = addLocalDays(weekStart, 6);
      const candidates = sessions
        .filter((s) => s.localDate >= weekStart && s.localDate <= end)
        .flatMap((s, rank) => s.attempts.flatMap((a) => {
          const revision = data.reviewForAttempt(a.id).revisions[0];
          const liked = segmentMarks.get(revision.id) ?? new Set<number>();
          return revision.segments.flatMap((seg, i) => {
            const words = seg.text.toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z']/g, "")).filter(Boolean);
            const hesitant = revision.annotations.some((n) => n.segmentId === seg.id && n.category === "filler_candidate");
            const rule = words.length >= 8 && words.length <= 25 && !hesitant && !["and", "so"].includes(words[0]);
            if (!liked.has(i) && !rule) return [];
            const moment: S.Moment = { attemptId: a.id, sessionId: s.id, ordinal: a.ordinal, revisionId: revision.id, segment: i, text: seg.text, startMs: seg.startMs, endMs: seg.endMs, localDate: s.localDate, liked: liked.has(i) };
            return [{ moment, words: words.length, rank }];
          });
        }))
        .sort((x, y) => Number(y.moment.liked) - Number(x.moment.liked) || y.words - x.words || x.rank - y.rank || x.moment.segment - y.moment.segment);
      const chosen: number[] = [];
      const used = new Set<string>();
      // The sample sessions share their transcripts, so the preview never repeats a sentence.
      const texts = new Set<string>();
      const fresh = (i: number) => !texts.has(candidates[i].moment.text);
      const take = (i: number) => { chosen.push(i); used.add(candidates[i].moment.attemptId); texts.add(candidates[i].moment.text); };
      candidates.forEach((c, i) => { if (chosen.length < 3 && !used.has(c.moment.attemptId) && fresh(i)) take(i); });
      candidates.forEach((_, i) => { if (chosen.length < 3 && !chosen.includes(i) && fresh(i)) take(i); });
      return S.Moment.array().parse(chosen.sort((a, b) => a - b).map((i) => candidates[i].moment));
    },
    skipReanswer: async (promptId, step) => {
      if (![1, 7, 30].includes(step)) throw new IpcError("invalid", "That re-answer step doesn't exist.");
      award("reanswer_skipped", `${promptId}:${step}`, toLocalDate(new Date()));
    },
    addTakeEvents: async (attemptId, marks) => {
      const found = attemptOf(attemptId);
      if (!found) throw new IpcError("not_found", "This take is unavailable.");
      const rehearsal = found.session.exerciseType === "rehearsal";
      if (!S.isDrillType(found.session.exerciseType) && !rehearsal) throw new IpcError("invalid", "This take isn't part of a drill.");
      const parsed = marks.map((m) => S.TakeMark.parse(m));
      // A rehearsal keeps only section marks (14.3), and a drill never does.
      if (parsed.some((m) => (m.kind === "section_mark") !== rehearsal)) throw new IpcError("invalid", "A mark from this round is invalid.");
      const stored = takeEvents.get(attemptId) ?? [];
      if (stored.length + parsed.length > 200) throw new IpcError("invalid", "A round keeps at most 200 marks.");
      const createdAt = new Date().toISOString();
      takeEvents.set(attemptId, [...stored, ...parsed.map((m) => ({ id: ++eventId, attemptId, atMs: m.atMs, kind: m.kind, data: m.data, createdAt }))].sort((a, b) => a.atMs - b.atMs || a.id - b.id));
      activityResults.delete(attemptId);
      return parsed.length;
    },
    listTakeEvents: (attemptId) => respond(S.TakeEvent.array(), takeEvents.get(attemptId) ?? []),
    getActivityResult: async (attemptId) => {
      const found = attemptOf(attemptId);
      if (!found) throw new IpcError("not_found", "This take is unavailable.");
      if (!S.isDrillType(found.session.exerciseType)) throw new IpcError("invalid", "This take isn't part of a drill.");
      const result = activityResults.get(attemptId) ?? mockResult(found.session, found.attempt);
      activityResults.set(attemptId, result);
      return respond(S.ActivityResult, result);
    },
    getEngagementState: async (week) => {
      if (!isWeekStart(week)) throw new IpcError("invalid", "A week starts on a Monday or a Sunday.");
      const since = addLocalDays(week, -28);
      return S.EngagementState.parse(structuredClone({
        ...game,
        quests: game.quests.filter((q) => q.week >= since && q.week <= week).sort((a, b) => a.week.localeCompare(b.week) || a.slot - b.slot),
        goalWeeks: events.filter((e) => e.kind === "weekly_goal").map((e) => e.refId).sort(),
      }));
    },
    recordUnlocks: async (input) => {
      try {
        validateUnlockInput(input, new Set(game.levels.map((l) => `${l.area}:${l.level}`)));
      } catch (error) {
        throw new IpcError("invalid", (error as Error).message);
      }
      const now = new Date().toISOString();
      const outcome: S.UnlockOutcome = { levels: [], achievements: [], records: [], questsDone: [], weeklyGoal: null, xp: 0 };
      const earn = (kind: string, refId: string) => { outcome.xp += award(kind, refId, input.localDate) ?? 0; };
      for (const l of input.levels) {
        if (game.levels.some((x) => x.area === l.area && x.level === l.level)) continue;
        const row = { ...l, achievedAt: now };
        game.levels.push(row);
        outcome.levels.push(row);
        earn("level_reached", `${l.area}:${l.level}`);
      }
      for (const a of input.achievements) {
        if (game.achievements.some((x) => x.id === a.id)) continue;
        const row = { ...a, unlockedAt: now };
        game.achievements.push(row);
        outcome.achievements.push(row);
        earn("achievement", a.id);
      }
      for (const r of input.records) {
        const lower = RECORD_UNITS[r.record].lowerIsBetter;
        const values = game.records.filter((x) => x.record === r.record).map((x) => x.value);
        const best = values.length ? (lower ? Math.min(...values) : Math.max(...values)) : null;
        if (best !== null && (lower ? r.value >= best : r.value <= best)) continue;
        const row: S.RecordRow = { ...r, id: game.records.length + 1, previous: best, achievedAt: now };
        game.records.push(row);
        outcome.records.push(row);
        if (best !== null) earn("personal_record", `${r.record}:${row.id}`);
      }
      for (const q of input.questsDone) {
        const quest = game.quests.find((x) => x.week === q.week && x.slot === q.slot && x.completedAt === null);
        if (!quest) continue;
        quest.completedAt = now;
        outcome.questsDone.push({ ...quest });
        earn("quest", `${q.week}:${q.slot}`);
      }
      if (input.weeklyGoal) {
        const xp = award("weekly_goal", input.weeklyGoal, input.localDate);
        if (xp !== null) {
          outcome.xp += xp;
          outcome.weeklyGoal = input.weeklyGoal;
        }
      }
      return S.UnlockOutcome.parse(structuredClone(outcome));
    },
    setWeeklyQuests: async (week, quests) => {
      if (!isWeekStart(week)) throw new IpcError("invalid", "A week starts on a Monday or a Sunday.");
      for (const q of quests) {
        if (q.slot < 1 || q.slot > 3 || !/^[a-z0-9-]{2,40}$/.test(q.quest)) throw new IpcError("invalid", "Unknown quest.");
        if (!game.quests.some((x) => x.week === week && x.slot === q.slot))
          game.quests.push({ week, slot: q.slot, quest: q.quest, params: q.params, swapped: false, createdAt: new Date().toISOString(), completedAt: null });
      }
      return S.QuestRow.array().parse(structuredClone(game.quests.filter((q) => q.week === week).sort((a, b) => a.slot - b.slot)));
    },
    swapWeeklyQuest: async (week, slot, quest) => {
      if (game.quests.some((q) => q.week === week && q.swapped)) throw new IpcError("invalid", "You've already swapped a quest this week.");
      const row = game.quests.find((q) => q.week === week && q.slot === slot);
      if (!row) throw new IpcError("not_found", "This quest is no longer available.");
      if (row.completedAt) throw new IpcError("invalid", "A finished quest stays.");
      if (row.quest === quest.quest) throw new IpcError("invalid", "Choose a different quest.");
      Object.assign(row, { quest: quest.quest, params: quest.params, swapped: true });
      return S.QuestRow.parse(structuredClone(row));
    },
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
        // The preview's warm-up is always Just a Minute (the desktop app picks by your practice).
        steps: [...(preferences.warmUp ? [{ exerciseType: "jam", drillId: "jam", title: "Warm-up: Just a Minute", minutes: 2 }] : []), ...(length === "standard" ? standard : short)],
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
      const { flow = null, tags = [], kind = "reflection", extra = null, missionId = null, ...text } = input;
      if ((kind === "aar") !== (extra !== null)) throw new IpcError("invalid", "An after-action review needs its answers.");
      if (extra && [extra.planned, extra.happened, extra.why, extra.nextTime].every((v) => !v.trim())) throw new IpcError("invalid", "Answer at least one of the four questions.");
      // A mission's reflection (14.1) or an event's debrief (14.2) is checked before it is saved.
      const world = missionId || extra?.eventId ? await realWorld() : null;
      const week = world ? world.checkReview({ ...input, kind, missionId }) : null;
      const trimmed = Object.fromEntries(Object.entries(text).map(([k, v]) => [k, String(v).trim()])) as Omit<S.TransferInput, "flow" | "tags" | "kind" | "extra" | "missionId">;
      const answers = extra && { planned: extra.planned.trim(), happened: extra.happened.trim(), why: extra.why.trim(), nextTime: extra.nextTime.trim(), ...(extra.eventId ? { eventId: extra.eventId } : {}) };
      const review: S.TransferReview = { ...trimmed, flow, tags: [...new Set(tags)], kind, extra: answers, missionId, id: `transfer-${Date.now()}-${transferReviews.length}`, createdAt: new Date().toISOString() };
      transferReviews.push(review);
      award("transfer_review", review.id, review.localDate);
      if (kind === "aar") award("after_action", review.id, review.localDate);
      world?.logReview(review, week);
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
    previewPhraseSuggestionsLocal: async (sessionIds, model) => (await localText()).previewPhraseSuggestionsLocal(sessionIds, model),
    sendPhraseSuggestionsLocal: async (requestId, payloadSha256) => (await localText()).sendPhraseSuggestionsLocal(requestId, payloadSha256),
    previewClipNamesLocal: async (texts, model) => (await localText()).previewClipNamesLocal(texts, model),
    sendClipNamesLocal: async (requestId, payloadSha256) => (await localText()).sendClipNamesLocal(requestId, payloadSha256),
    previewClipPicksLocal: async (stagingId, options) => (await localText()).previewClipPicksLocal(stagingId, options),
    sendClipPicksLocal: async (stagingId, requestId, payloadSha256) => (await localText()).sendClipPicksLocal(stagingId, requestId, payloadSha256),
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
    previewDrillComparison: async (sessionId, kind, model = "gpt-6-luna") => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session || session.attempts.length < 2) throw new IpcError("invalid", "Every round needs a transcript first.");
      const word = kind === "three_ways" ? "Version" : "Round";
      return S.CoachingPreview.parse({
        version: 1, requestId: `drill-${Date.now()}`, payloadSha256: "0".repeat(64), recipient: "https://api.openai.com/v1/responses", model,
        selectedText: session.attempts.slice(0, 3).map((a, i) => `${word} ${i + 1} (${a.step?.key ?? "take"}):\nSample transcript of take ${a.ordinal} (browser preview).`).join("\n\n"),
        prompt: kind === "three_ways" ? "Did the wording change for each listener?" : "Which words carried your point?", focus: "One note and a quote per round, one tip",
        instructions: "Sample instructions (browser preview).", maximumOutputTokens: 2048, estimatedMaximumCostMicroUsd: 1800,
        priceDate: "2026-10-08", priceSource: "sample", inputUsdPerMillionTokens: "0.10", outputUsdPerMillionTokens: "0.50",
        costExplanation: "Browser preview: nothing is sent. Only the transcripts are shown here, never audio.", expiresAtMs: Date.now() + 300_000,
      });
    },
    requestDrillComparison: async () => S.DrillComparison.parse({
      notes: [
        { part: 1, note: "Short words and one everyday example suited a child.", quote: "Sample transcript of take 1" },
        { part: 2, note: "You said why it matters to them, which suits a colleague.", quote: "Sample transcript of take 2" },
      ],
      oneTip: "Open each version with the point before the details.",
    }),
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
    requestNotificationPermission: async () => false,
    showSurpriseNotification: async () => {},
    getPreferences: async () => ({ ...preferences }),
    getDataLocation: async () => ({ current: "%LOCALAPPDATA%\\com.clearpractice.app", default: "%LOCALAPPDATA%\\com.clearpractice.app", custom: false, problem: null, previous: null, previousBytes: 0 }),
    moveDataFolder: async () => { throw new IpcError("desktop_required", "The data folder can be moved in the desktop app."); },
    onDataMoveProgress: async () => () => {},
    removeOldDataCopy: async () => { throw new IpcError("desktop_required", "Available in the desktop app."); },
    restartApp: async () => {},
    setPreferences: async (next) => (preferences = S.Preferences.parse(next)),
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
