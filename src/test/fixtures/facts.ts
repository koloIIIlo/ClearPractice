import { addLocalDays } from "@/lib/phrase-schedule";
import { PracticeFacts, type FactPhrase, type FactPhraseReview, type FactSession, type FactTake, type FactTransfer } from "@/lib/ipc/schemas";

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
  /** Following items happen this many days before today. */
  onDay(offsetDays: number): FactsBuilder;
  build(): PracticeFacts;
}

export function factsBuilder(today = "2026-10-12"): FactsBuilder {
  const facts: PracticeFacts = {
    factsVersion: 5, generatedAt: `${today}T12:00:00.000Z`, today, transcriptionAvailable: true,
    sessions: [], takes: [], transferReviews: [], phrases: [], phraseReviews: [], progression: [], userPrompts: 0, blindComparisons: 0, programme: null,
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
      facts.transferReviews.push({ id: `transfer-${n}`, localDate: day(), hasListenerWords: false, neededClarification: false, hasSuccess: false, hasNextFocus: false, flow: null, tags: [], ...p });
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
    onDay(offsetDays) {
      offset = offsetDays;
      return builder;
    },
    build: () => PracticeFacts.parse(structuredClone(facts)),
  };
  return builder;
}
