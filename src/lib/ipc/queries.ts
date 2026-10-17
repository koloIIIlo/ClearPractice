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
