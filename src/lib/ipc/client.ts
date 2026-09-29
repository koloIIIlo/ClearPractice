/**
 * The UI's only door to the native core. Method names mirror the Rust
 * commands in blueprint §15; the frontend sends IDs and small values and
 * never resolves file paths itself.
 */
import type {
  AttemptReview,
  ExerciseDefinition,
  Guide,
  InputDevice,
  PhraseCard,
  PhraseRating,
  PracticePrompt,
  ProgressSummary,
  ProgressView,
  SearchHit,
  ServiceStatus,
  SessionDetail,
  SessionLength,
  SessionSummary,
  TodayPlan,
} from "./schemas";

export interface SessionFilter {
  query?: string;
  exerciseType?: SessionSummary["exerciseType"];
  favoritesOnly?: boolean;
}

export interface IpcClient {
  getServiceStatus(): Promise<ServiceStatus>;
  getTodayPlan(length: SessionLength): Promise<TodayPlan>;

  listExercises(): Promise<ExerciseDefinition[]>;
  listPrompts(): Promise<PracticePrompt[]>;
  listGuides(): Promise<Guide[]>;
  setPromptFavorite(promptId: string, favorite: boolean): Promise<void>;

  listSessions(filter?: SessionFilter): Promise<SessionSummary[]>;
  getSession(sessionId: string): Promise<SessionDetail>;
  getAttemptReview(attemptId: string): Promise<AttemptReview>;

  listPhrases(): Promise<PhraseCard[]>;
  reviewPhrase(phraseId: string, rating: PhraseRating): Promise<PhraseCard>;

  getProgress(view: ProgressView): Promise<ProgressSummary>;
  searchContent(query: string): Promise<SearchHit[]>;
  listInputDevices(): Promise<InputDevice[]>;
}

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
