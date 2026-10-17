import { describe, expect, it } from "vitest";
import { DRILL_TYPES, ExerciseDefinition, PromptTag } from "@/lib/ipc/schemas";
import { AREA_IDS } from "@/lib/engagement/types";
import { offending } from "@/test/no-scores";
import { BOSSES, INTERRUPTIONS, SKEPTICAL_QUESTIONS } from "./bosses";
import { duplicates, ID_PATTERN, LIMITS, normalize, tooLong } from "./content-checks";
import { DAILY_EPOCH, DAILY_PROMPTS } from "./daily-prompts";
import { DRILL_EXERCISES, DRILLS, drillById, drillForType } from "./drills";
import { EMPHASIS_SENTENCES } from "./emphasis-sentences";
import { JAM_TOPICS } from "./jam-topics";
import { ROULETTE_CATEGORIES, ROULETTE_TOPICS } from "./roulette-topics";
import { STAR_QUESTIONS } from "./star-questions";
import { SPINE_CARDS, STORY_ICONS, STORY_SEEDS } from "./story";
import { WORD_BOMB_WORDS } from "./word-bomb-words";

/** Content checks shared by every list (roadmap 10.15, appendix C). */
function expectValidList(items: readonly { id: string; text: string }[], count: number, max: number, idFormat: RegExp) {
  expect(items).toHaveLength(count);
  expect(new Set(items.map((i) => i.id)).size).toBe(count);
  for (const item of items) {
    expect(item.id).toMatch(ID_PATTERN);
    expect(item.id).toMatch(idFormat);
  }
  const texts = items.map((i) => i.text);
  expect(duplicates(texts)).toEqual([]);
  expect(tooLong(texts, max)).toEqual([]);
  expect(texts.flatMap((t) => offending(t))).toEqual([]);
  expect(texts.filter((t) => t.trim() !== t || t.length === 0)).toEqual([]);
}

describe("drill definitions (C.1)", () => {
  it("defines the thirteen drills, one per drill type, with stored exercises", () => {
    expect(DRILLS.map((d) => d.type)).toEqual([...DRILL_TYPES]);
    expect(new Set(DRILLS.map((d) => d.id)).size).toBe(13);
    for (const d of DRILLS) {
      expect(d.id).toMatch(ID_PATTERN);
      expect(d.exerciseId).toBe(`ex-${d.id}`);
      expect(d.areas.length).toBeGreaterThan(0);
      expect(d.areas.every((a) => (AREA_IDS as readonly string[]).includes(a))).toBe(true);
      expect(tooLong([d.tagline, ...d.rules], LIMITS.instruction)).toEqual([]);
      expect([d.title, d.tagline, ...d.rules].flatMap((t) => offending(t))).toEqual([]);
      if (d.recommendedAfter) expect(d.recommendedAfter.level).toBeGreaterThanOrEqual(1);
      expect(drillById(d.id)).toBe(d);
      expect(drillForType(d.type)).toBe(d);
    }
    for (const e of DRILL_EXERCISES) expect(() => ExerciseDefinition.parse(e), e.id).not.toThrow();
  });
});

describe("topic and word lists (C.2)", () => {
  it("has 120 Just a Minute topics", () => {
    expectValidList(JAM_TOPICS, 120, LIMITS.topic, /^jam-\d{3}$/);
  });

  it("has eight roulette categories of twenty, none repeating a Just a Minute topic", () => {
    expect(ROULETTE_CATEGORIES.map((c) => c.id)).toEqual(["daily_life", "work", "opinions", "storytelling", "unexpected", "explanations", "hypotheticals", "memories"]);
    const all = ROULETTE_CATEGORIES.flatMap((c) => {
      expect(ROULETTE_TOPICS[c.id], c.id).toHaveLength(20);
      return ROULETTE_TOPICS[c.id];
    });
    expectValidList(all, 160, LIMITS.topic, /^rt-[a-z-]+-\d{2}$/);
    const jam = new Set(JAM_TOPICS.map((t) => normalize(t.text)));
    expect(all.filter((t) => jam.has(normalize(t.text))).map((t) => t.text)).toEqual([]);
  });

  it("has 200 concrete nouns with their plurals", () => {
    expect(WORD_BOMB_WORDS).toHaveLength(200);
    const forms = WORD_BOMB_WORDS.flatMap((w) => [w.singular, w.plural]);
    expect(duplicates(forms)).toEqual([]);
    for (const w of WORD_BOMB_WORDS) {
      expect(w.id).toBe(`wb-${w.singular}`);
      expect(w.singular).toMatch(/^[a-z]+$/);
      expect(w.plural).toMatch(/^[a-z]+$/);
      expect(w.plural).not.toBe(w.singular);
    }
  });

  it("has 20 emphasis sentences whose targets each change the meaning", () => {
    expectValidList(EMPHASIS_SENTENCES, 20, LIMITS.prompt, /^es-\d{2}$/);
    for (const s of EMPHASIS_SENTENCES) {
      const words = s.text.split(" ");
      expect(words.length, s.id).toBeGreaterThanOrEqual(6);
      expect(words.length, s.id).toBeLessThanOrEqual(9);
      expect(s.text, s.id).toMatch(/^[A-Z][A-Za-z' ]+[.?]$/);
      expect(s.targets.length, s.id).toBeGreaterThanOrEqual(2);
      expect(s.targets.length, s.id).toBeLessThanOrEqual(4);
      expect(new Set(s.targets.map((t) => t.word)).size, s.id).toBe(s.targets.length);
      for (const t of s.targets) {
        expect(t.word, s.id).toBeGreaterThanOrEqual(0);
        expect(t.word, s.id).toBeLessThan(words.length);
        expect(tooLong([t.meaning], LIMITS.instruction)).toEqual([]);
        expect(offending(t.meaning)).toEqual([]);
      }
    }
  });

  it("has 60 story seeds and 60 picture cubes with distinct words", () => {
    expectValidList(STORY_SEEDS, 60, LIMITS.topic, /^seed-\d{2}$/);
    expect(STORY_ICONS).toHaveLength(60);
    expect(new Set(STORY_ICONS.map((i) => i.id)).size).toBe(60);
    const words = STORY_ICONS.flatMap((i) => i.synonyms);
    expect(duplicates(words)).toEqual([]);
    for (const i of STORY_ICONS) {
      expect(i.id).toMatch(ID_PATTERN);
      expect(i.icon, i.id).toBeTruthy();
      expect(i.synonyms[0]).toBe(i.label.toLowerCase());
      expect(i.synonyms.length, i.id).toBeGreaterThanOrEqual(2);
      expect(i.synonyms.length, i.id).toBeLessThanOrEqual(6);
      for (const s of i.synonyms) expect(s, i.id).toMatch(/^\p{Ll}+$/u);
    }
    expect(SPINE_CARDS).toHaveLength(7);
  });

  it("has 365 daily prompts with balanced tags", () => {
    expectValidList(DAILY_PROMPTS, 365, LIMITS.prompt, /^daily-\d{3}$/);
    expect(DAILY_EPOCH).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const p of DAILY_PROMPTS) {
      expect(p.text, p.id).toMatch(/[.?]$/);
      expect(PromptTag.options).toContain(p.tag);
    }
    for (const tag of PromptTag.options) {
      const share = DAILY_PROMPTS.filter((p) => p.tag === tag).length / DAILY_PROMPTS.length;
      expect(share, tag).toBeLessThanOrEqual(0.3);
      expect(share, tag).toBeGreaterThanOrEqual(0.1);
    }
    // Interleaved: no two days in a row share a tag.
    expect(DAILY_PROMPTS.slice(1).filter((p, i) => p.tag === DAILY_PROMPTS[i].tag)).toEqual([]);
  });

  it("has 30 behavioural interview questions", () => {
    expectValidList(STAR_QUESTIONS, 30, LIMITS.prompt, /^star-\d{2}$/);
  });
});

describe("bosses (C.3)", () => {
  it("has the four bosses with rounds, a final check and a recommended level", () => {
    expect(BOSSES.map((b) => b.id)).toEqual(["job-interview", "skeptical-qa", "toast", "meeting"]);
    for (const b of BOSSES) {
      expect(b.rounds.length).toBeGreaterThan(0);
      expect(b.recommendedAfter.level).toBe(3);
      expect((AREA_IDS as readonly string[]).includes(b.recommendedAfter.area)).toBe(true);
      expect(tooLong([b.description, b.finalCheck], LIMITS.instruction)).toEqual([]);
      expect([b.title, b.description, b.finalCheck].flatMap((t) => offending(t))).toEqual([]);
      for (const r of b.rounds) {
        expect(r.key).toMatch(/^[a-z0-9_-]{1,40}$/);
        expect(r.thinkSeconds).toBeGreaterThan(0);
        expect(r.speakSeconds).toBeGreaterThan(0);
        expect((r.cards ?? []).flatMap((c) => offending(c))).toEqual([]);
        if (r.kind === "drawn") expect(r.count).toBeGreaterThanOrEqual(1);
        if (r.kind === "fixed") {
          expect(tooLong([r.prompt], LIMITS.prompt)).toEqual([]);
          if (r.interruptAtSeconds !== undefined) expect(r.interruptAtSeconds).toBeLessThan(r.speakSeconds);
        }
      }
    }
    expectValidList(SKEPTICAL_QUESTIONS, SKEPTICAL_QUESTIONS.length, LIMITS.prompt, /^skeptic-\d{2}$/);
    expectValidList(INTERRUPTIONS, INTERRUPTIONS.length, LIMITS.prompt, /^interrupt-\d{2}$/);
    expect(SKEPTICAL_QUESTIONS.length).toBeGreaterThanOrEqual(12);
    expect(INTERRUPTIONS.length).toBeGreaterThanOrEqual(8);
  });
});
