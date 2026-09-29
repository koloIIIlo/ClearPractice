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
  return new Promise((resolve) => setTimeout(() => resolve(schema.parse(structuredClone(value))), LATENCY_MS));
}

const includes = (hay: string, needle: string) => hay.toLowerCase().includes(needle.toLowerCase());

export function createMockClient(): IpcClient {
  const phrases = structuredClone(data.phrases);
  const prompts = structuredClone(data.prompts);

  return {
    getServiceStatus: () =>
      respond(S.ServiceStatus, {
        transcription: { mode: "local", model: "base.en", state: "needs_setup" },
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
        data.sessions
          .filter((s) => !filter.exerciseType || s.exerciseType === filter.exerciseType)
          .filter((s) => !filter.favoritesOnly || s.favorite)
          .filter((s) => !filter.query || includes(s.title, filter.query) || includes(s.notes, filter.query))
          .map(({ prompt: _p, outline: _o, focus: _f, notes: _n, conditions: _c, attempts: _a, ...summary }) => summary),
      ),

    getSession: (sessionId) => {
      const s = data.sessions.find((x) => x.id === sessionId);
      if (!s) return Promise.reject(new IpcError("not_found", "This session no longer exists."));
      return respond(S.SessionDetail, s);
    },

    getAttemptReview: (attemptId) => respond(S.AttemptReview, data.reviewForAttempt(attemptId)),

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
  };
}
