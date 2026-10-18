/**
 * TanStack Query hooks over the IPC client. The query cache is disposable;
 * SQLite in the native core stays authoritative (blueprint §8).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIpc, type SessionFilter } from "./index";
import { DEFAULT_PREFERENCES, type PhraseRating, type Preferences, type ProgressView, type SessionLength } from "./schemas";

export const keys = {
  status: ["status"] as const,
  today: (length: SessionLength) => ["today", length] as const,
  exercises: ["exercises"] as const,
  prompts: ["prompts"] as const,
  guides: ["guides"] as const,
  sessions: (filter: SessionFilter) => ["sessions", filter] as const,
  session: (id: string) => ["session", id] as const,
  review: (attemptId: string) => ["review", attemptId] as const,
  phrases: ["phrases"] as const,
  progress: (view: ProgressView) => ["progress", view] as const,
  search: (q: string) => ["search", q] as const,
  devices: ["devices"] as const,
  preferences: ["preferences"] as const,
  /** Everything under "engagement" is refreshed together after practice (roadmap 9.4). */
  engagementEvents: ["engagement", "events"] as const,
  facts: ["engagement", "facts"] as const,
  /** Insights (M8). */
  /** Under "phrases", so adding or changing a phrase (which rescans your takes) refreshes them too. */
  phraseUses: (phraseId?: string) => ["phrases", "uses", phraseId ?? "all"] as const,
  selfChecks: (attemptId: string) => ["engagement", "selfChecks", attemptId] as const,
  audioMeasures: (attemptId: string) => ["audio-measures", attemptId] as const,
  comparisons: (attemptId: string) => ["comparisons", attemptId] as const,
  /** Game core (M9); under "engagement", so one invalidation refreshes everything earned. */
  engagementState: (week: string) => ["engagement", "state", week] as const,
  // Drills (M10).
  activityResult: (attemptId: string) => ["drills", "result", attemptId] as const,
  takeEvents: (attemptId: string) => ["drills", "events", attemptId] as const,
  // Learning engine (M11); under "engagement", so saved practice refreshes them too.
  programme: ["engagement", "programme"] as const,
  predictions: ["engagement", "predictions"] as const,
  // Confidence pack (M12); under "engagement", so saved practice refreshes them too.
  exposureSteps: ["engagement", "exposure", "steps"] as const,
  exposureAttempts: ["engagement", "exposure", "attempts"] as const,
  routineRuns: ["engagement", "routines"] as const,
  segmentMarks: (attemptId: string) => ["engagement", "segment-marks", attemptId] as const,
  bestMoments: (weekStart: string) => ["engagement", "best-moments", weekStart] as const,
  // Conversation partner (M13).
  conversations: ["partner", "list"] as const,
  conversation: (id: string) => ["partner", "conversation", id] as const,
  upgradeRuns: (attemptId: string) => ["partner", "upgrades", attemptId] as const,
  upgradeRun: (runId: string) => ["partner", "upgrade", runId] as const,
  // Real world (M14); under "engagement", so saved practice brings plans, missions and the capsule up to date.
  missionPick: (week: string) => ["engagement", "mission", week] as const,
  /** Every event's key starts with this one, so one invalidation refreshes the list and each event. */
  realEvents: ["engagement", "real-events"] as const,
  realEvent: (id: string) => ["engagement", "real-events", id] as const,
  talks: ["talks"] as const,
  talk: (id: string) => ["talks", id] as const,
  rehearsals: (talkId: string) => ["engagement", "rehearsals", talkId] as const,
  rehearsalReport: (attemptId: string) => ["engagement", "rehearsal", attemptId] as const,
  capsule: (today: string) => ["engagement", "capsule", today] as const,
  listenerPacks: (sessionId?: string) => ["engagement", "listener-packs", sessionId ?? "all"] as const,
  listenerFeedback: (sessionId?: string) => ["engagement", "listener-answers", sessionId ?? "all"] as const,
};

/** Saved preferences; until they load, the defaults apply. */
export function usePreferences() {
  const ipc = useIpc();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: keys.preferences, queryFn: () => ipc.getPreferences() });
  const value = query.data ?? DEFAULT_PREFERENCES;
  const update = useMutation({
    mutationFn: (change: Partial<Preferences>) => ipc.setPreferences({ ...(qc.getQueryData<Preferences>(keys.preferences) ?? value), ...change }),
    onMutate: (change) => qc.setQueryData<Preferences>(keys.preferences, (old) => ({ ...(old ?? DEFAULT_PREFERENCES), ...change })),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.preferences }),
  });
  return { preferences: value, loaded: query.isSuccess, update: update.mutate };
}

export function useServiceStatus() {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.status, queryFn: () => ipc.getServiceStatus() });
}

export function useTodayPlan(length: SessionLength) {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.today(length), queryFn: () => ipc.getTodayPlan(length) });
}

export function useExercises() {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.exercises, queryFn: () => ipc.listExercises() });
}

export function usePrompts() {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.prompts, queryFn: () => ipc.listPrompts() });
}

export function useGuides() {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.guides, queryFn: () => ipc.listGuides() });
}

export function useSetPromptFavorite() {
  const ipc = useIpc();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ promptId, favorite }: { promptId: string; favorite: boolean }) =>
      ipc.setPromptFavorite(promptId, favorite),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.prompts }),
  });
}

export function useSessions(filter: SessionFilter) {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.sessions(filter), queryFn: () => ipc.listSessions(filter) });
}

export function useSession(id: string | undefined) {
  const ipc = useIpc();
  return useQuery({
    queryKey: keys.session(id ?? ""),
    queryFn: () => ipc.getSession(id!),
    enabled: !!id,
    retry: false,
  });
}

export function useAttemptReview(attemptId: string | undefined) {
  const ipc = useIpc();
  return useQuery({
    queryKey: keys.review(attemptId ?? ""),
    queryFn: () => ipc.getAttemptReview(attemptId!),
    enabled: !!attemptId,
  });
}

export function usePhrases() {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.phrases, queryFn: () => ipc.listPhrases() });
}

export function useReviewPhrase() {
  const ipc = useIpc();
  const qc = useQueryClient();
  return useMutation({ meta: { engagement: "phrase" },
    mutationFn: ({ phraseId, rating }: { phraseId: string; rating: PhraseRating }) =>
      ipc.reviewPhrase(phraseId, rating),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.phrases });
      qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

export function useProgress(view: ProgressView) {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.progress(view), queryFn: () => ipc.getProgress(view) });
}

export function useSearch(query: string) {
  const ipc = useIpc();
  return useQuery({
    queryKey: keys.search(query),
    queryFn: () => ipc.searchContent(query),
    enabled: query.trim().length > 0,
    placeholderData: (prev) => prev,
  });
}

export function useInputDevices() {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.devices, queryFn: () => ipc.listInputDevices() });
}

/** Effort points from practice events (7.4). */
export function usePracticeEvents(from?: string) {
  const ipc = useIpc();
  return useQuery({ queryKey: [...keys.engagementEvents, from ?? "all"], queryFn: () => ipc.listPracticeEvents(from) });
}

/** The facts snapshot for the rule engines (7.6). */
export function usePracticeFacts() {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.facts, queryFn: () => ipc.getPracticeFacts() });
}

/** The latest guided programme run, active or not (11.6). */
export function useProgrammeState() {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.programme, queryFn: () => ipc.getProgrammeState() });
}

/** Your guesses before seeing takes' measures (11.5). */
export function usePredictions() {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.predictions, queryFn: () => ipc.listPredictions() });
}

/** Your exposure ladder and every attempt on it (12.2). */
export function useExposure() {
  const ipc = useIpc();
  const steps = useQuery({ queryKey: keys.exposureSteps, queryFn: () => ipc.listExposureSteps() });
  const attempts = useQuery({ queryKey: keys.exposureAttempts, queryFn: () => ipc.listExposureAttempts() });
  return { steps, attempts };
}

/** Your practice conversations, newest first (13.3). */
export function useConversations() {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.conversations, queryFn: () => ipc.listConversations() });
}

/** A take's upgrades, newest first (13.10). */
export function useUpgradeRuns(attemptId: string | null | undefined) {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.upgradeRuns(attemptId ?? ""), queryFn: () => ipc.listUpgradeRuns(attemptId!), enabled: !!attemptId });
}

/** This week's mission pick (14.1), or null; `week` is the week's first day. */
export function useMissionPick(week: string) {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.missionPick(week), queryFn: () => ipc.getMissionPick(week) });
}

/** Your events with their plans, soonest first (14.2). */
export function useEvents() {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.realEvents, queryFn: () => ipc.listEvents() });
}

export function useEvent(eventId: string | undefined) {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.realEvent(eventId ?? ""), queryFn: () => ipc.getEvent(eventId!), enabled: !!eventId });
}

/** Your talks, the one changed last first (14.3). */
export function useTalks() {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.talks, queryFn: () => ipc.listTalks() });
}

export function useTalk(talkId: string | undefined) {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.talk(talkId ?? ""), queryFn: () => ipc.getTalk(talkId!), enabled: !!talkId });
}

/** A talk's rehearsal reports, oldest first (14.3). */
export function useRehearsals(talkId: string | undefined) {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.rehearsals(talkId ?? ""), queryFn: () => ipc.listRehearsals(talkId!), enabled: !!talkId });
}

/** This month's time capsule (14.5); asking starts its week on offer. */
export function useCapsuleOffer(today: string) {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.capsule(today), queryFn: () => ipc.capsuleOffer(today) });
}

/** Listener packs (14.4) of a session, or all of them. */
export function useListenerPacks(sessionId?: string) {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.listenerPacks(sessionId), queryFn: () => ipc.listListenerPacks(sessionId) });
}

/** Listeners' answers (14.4) about a session's takes, or all of them. */
export function useListenerFeedback(sessionId?: string) {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.listenerFeedback(sessionId), queryFn: () => ipc.listListenerFeedback(sessionId) });
}

/** Where saved phrases turned up in your takes (8.2): one phrase, or all of them. */
export function usePhraseUses(phraseId?: string) {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.phraseUses(phraseId), queryFn: () => ipc.listPhraseUses(phraseId) });
}

/** Speech rate from a take's audio (8.8), computed once in the desktop app. */
export function useAudioMeasures(attemptId: string | null | undefined, enabled = true) {
  const ipc = useIpc();
  return useQuery({ queryKey: keys.audioMeasures(attemptId ?? ""), queryFn: () => ipc.getAudioMeasures(attemptId!), enabled: enabled && !!attemptId, staleTime: Infinity });
}
