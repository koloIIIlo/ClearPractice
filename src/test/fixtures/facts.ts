import { addLocalDays } from "@/lib/phrase-schedule";
import {
  PracticeFacts, type FactConversation, type FactEvent, type FactListenerAnswer, type FactMissionPick, type FactPhrase, type FactPhraseReview, type FactSession, type FactTake, type FactTransfer,
} from "@/lib/ipc/schemas";

/**
 * Builds valid practice facts for rule-engine tests (roadmap 7.7). Items are
 * added on "today minus the current offset" (`onDay`); a take joins the last
 * session. `build()` parses the result with the same schema as the IPC client.
 */
export interface FactsBuilder {
  session(p?: Partial<FactSession>): FactsBuilder;
  take(p?: Partial<FactTake>): FactsBuilder;
  transfer(p?: Partial<FactTransfer>): FactsBuilder;
  phrase(p?: Partial<FactPhrase>): FactsBuilder;
  phraseReview(p?: Partial<FactPhraseReview>): FactsBuilder;
  /** A practice conversation with the partner (M13), ended by default. */
  conversation(p?: Partial<FactConversation>): FactsBuilder;
  /** An event you prepare for (M14), without its debrief by default. */
  event(p?: Partial<FactEvent>): FactsBuilder;
  /** A listener's answer file (M14) for the last take. */
  listenerAnswer(p?: Partial<FactListenerAnswer>): FactsBuilder;
  /** A week's mission (M14), picked and not yet done by default. */
  missionPick(p?: Partial<FactMissionPick>): FactsBuilder;
  /** Following items happen this many days before today. */
  onDay(offsetDays: number): FactsBuilder;
  build(): PracticeFacts;
}

export function factsBuilder(today = "2026-10-12"): FactsBuilder {
  const facts: PracticeFacts = {
    factsVersion: 8, generatedAt: `${today}T12:00:00.000Z`, today, transcriptionAvailable: true,
    sessions: [], takes: [], transferReviews: [], phrases: [], phraseReviews: [], progression: [], userPrompts: 0, blindComparisons: 0, programme: null, exposure: [],
    conversations: [], events: [], listenerAnswers: [], missionPicks: [],
  };
  let offset = 0;
  let n = 0;
  const day = () => addLocalDays(today, -offset);
  const at = () => `${day()}T08:${String(n % 60).padStart(2, "0")}:00.000Z`;
  const builder: FactsBuilder = {
    session(p = {}) {
      n += 1;
      facts.sessions.push({
        id: `session-${n}`, localDate: day(), startedAt: at(), exerciseType: "repeat", contentId: null, tags: [],
        familiarity: "familiar", preparationSeconds: 15, targetSeconds: 60, audience: false, followUp: false,
        outline: [false, false, false], ease: null, focus: null, takeaway: false, status: "completed",
        takeCount: 0, durationMs: 0, preferredTake: null, activity: null, ...p,
      });
      return builder;
    },
    take(p = {}) {
      if (facts.sessions.length === 0) builder.session();
      const session = facts.sessions[facts.sessions.length - 1];
      n += 1;
      const ordinal = facts.takes.filter((t) => t.sessionId === session.id).length + 1;
      const take: FactTake = {
        id: `take-${n}`, sessionId: session.id, ordinal, localDate: session.localDate, createdAt: at(), durationMs: 60_000,
        stepKey: null, transcribed: false, revisionId: null, words: null, paceWpm: null, speechSpanMs: null,
        fillerCandidates: null, fillersConfirmed: null, fillersReviewed: false, pausesOverThreshold: null,
        prosodyViewed: false, hasAiFeedback: false, meanRun: null, longestRun: null, midClausePauses: null, boundaryPauses: null,
        watchPer100: null, hedgesPer100: null, differentPer50: null, phraseIds: [], checks: {}, pitchRangeSt: null, rateSps: null, result: null, predictions: {}, catchRuns: [], ...p,
      };
      facts.takes.push(take);
      session.takeCount += 1;
      session.durationMs += take.durationMs;
      return builder;
    },
    transfer(p = {}) {
      n += 1;
      facts.transferReviews.push({ id: `transfer-${n}`, localDate: day(), hasListenerWords: false, neededClarification: false, hasSuccess: false, hasNextFocus: false, flow: null, tags: [], kind: "reflection", missionId: null, eventId: null, ...p });
      return builder;
    },
    phrase(p = {}) {
      n += 1;
      facts.phrases.push({ id: `phrase-${n}`, createdAt: at(), starter: false, deleted: false, ...p });
      return builder;
    },
    phraseReview(p = {}) {
      if (facts.phrases.length === 0) builder.phrase();
      facts.phraseReviews.push({ cardId: facts.phrases[facts.phrases.length - 1].id, localDate: day(), rating: "good", ...p });
      return builder;
    },
    conversation(p = {}) {
      n += 1;
      facts.conversations.push({ id: `conversation-${n}`, scenarioId: "small-talk", pressure: 1, mode: "scripted", learnerTurns: 3, localDate: day(), endedAt: `${day()}T09:00:00.000Z`, bossId: null, ...p });
      return builder;
    },
    event(p = {}) {
      n += 1;
      facts.events.push({ id: `event-${n}`, kind: "talk", localDate: day(), debriefDone: false, ...p });
      return builder;
    },
    listenerAnswer(p = {}) {
      n += 1;
      facts.listenerAnswers.push({ id: `listener-${n}`, attemptId: facts.takes.at(-1)?.id ?? "take-0", localDate: day(), mainPointAnswered: false, ...p });
      return builder;
    },
    missionPick(p = {}) {
      facts.missionPicks.push({ week: day(), missionId: "ask-in-meeting", done: false, ...p });
      return builder;
    },
    onDay(offsetDays) {
      offset = offsetDays;
      return builder;
    },
    build: () => PracticeFacts.parse(structuredClone(facts)),
  };
  return builder;
}
