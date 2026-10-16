import { expect } from "vitest";

/**
 * The no-score check shared by A-22 and A-26 (roadmap 7.7): no filler, prosody,
 * imitation or game value is shown as a score, a grade, a percentage or a mood
 * label. Sentences that say there is none ("never a score") are the exception.
 */

/** Scores and grades, and words that label a mood or feeling. */
export const GRADE = /\b(scores?|scored|scoring|grades?|graded|out of (10|100))\b|\b\d+\s?\/\s?(10|100)\b/i;
/** A percentage shown next to a measure (source code also has CSS percentages, so rendered text only). */
export const PERCENT = /\b\d{1,3}\s?%/;
export const MOOD = /\b(moods?|emotions?|emotional|happy|sad|angry|anxious|nervous|stressed|frustrated|confident|insecure|excited|bored)\b/i;
export const NEGATION = /\b(no|not|never|nothing|without|nor|isn't|aren't)\b/i;

/** Sentences that label a value as a score, grade or mood (not those that say there is none). */
export function offending(text: string, rendered = true): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?:])\s+|\n/)
    .filter((sentence) => (GRADE.test(sentence) || MOOD.test(sentence) || (rendered && PERCENT.test(sentence))) && !NEGATION.test(sentence));
}

/** Fails with the offending sentences of a rendered screen. */
export function expectNoScores(container: HTMLElement = document.body): void {
  expect(offending(container.textContent ?? "")).toEqual([]);
}
