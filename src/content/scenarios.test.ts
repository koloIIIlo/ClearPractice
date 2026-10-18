import { describe, expect, it } from "vitest";
import { ScenarioText } from "@/lib/ipc/schemas";
import { offending } from "@/test/no-scores";
import { BOSSES } from "./bosses";
import { duplicates, ID_PATTERN } from "./content-checks";
import {
  BOSS_PARTNERS, BOSS_SCENARIOS, GENERAL_FOLLOW_UPS, PANEL, PANEL_PERSONAS, PERSONAS, PERSONA_IDS, SCENARIOS, panelScenarioText, scenarioById, scenarioText, scriptedLines,
} from "./scenarios";

const ALL = [...SCENARIOS, ...BOSS_SCENARIOS];

describe("scenarios and personas (13.2)", () => {
  it("have unique IDs, an opening, 6 or more scripted lines, 4 to 12 turns and no score or mood words", () => {
    expect(SCENARIOS).toHaveLength(8);
    expect(new Set(ALL.map((s) => s.id)).size).toBe(ALL.length);
    for (const s of ALL) {
      expect(s.id).toMatch(ID_PATTERN);
      expect(s.opening.trim(), s.id).not.toBe("");
      expect(s.scripted.length, s.id).toBeGreaterThanOrEqual(6);
      expect(duplicates(s.scripted), s.id).toEqual([]);
      expect([s.title, s.summary, s.partnerRole, s.learnerGoal, s.opening, ...s.scripted].flatMap((t) => offending(t)), s.id).toEqual([]);
      // What is sent fits the desktop app's limits.
      expect(ScenarioText.safeParse(scenarioText(s, s.defaultPersona)).success, s.id).toBe(true);
    }
    for (const s of SCENARIOS) {
      expect(s.maxTurns, s.id).toBeGreaterThanOrEqual(4);
      expect(s.maxTurns, s.id).toBeLessThanOrEqual(12);
    }
  });

  it("persona styles never ask for scores or feedback", () => {
    expect(PERSONA_IDS).toHaveLength(6);
    for (const id of PERSONA_IDS) {
      const p = PERSONAS[id];
      expect(`${p.style} ${p.description}`, id).not.toMatch(/scor|grade|feedback|correct|prais|rating/i);
      expect(offending(`${p.style}. ${p.description}`), id).toEqual([]);
    }
  });

  it("the scripted partner has a line for every answer but the last, with one general follow-up mixed in", () => {
    for (const s of ALL) {
      const lines = scriptedLines(s, () => 0.5);
      expect(lines.length, s.id).toBeGreaterThanOrEqual(s.maxTurns - 1);
      expect(lines.filter((l) => GENERAL_FOLLOW_UPS.includes(l.text)).length, s.id).toBeLessThanOrEqual(1);
      expect(lines.every((l) => l.move === "follow_up")).toBe(true);
    }
    expect(scriptedLines(SCENARIOS[0], () => 0)[0].text, "never first").toBe(SCENARIOS[0].scripted[0]);
    expect(duplicates(GENERAL_FOLLOW_UPS)).toEqual([]);
    expect(GENERAL_FOLLOW_UPS.flatMap((t) => offending(t))).toEqual([]);
  });

  it("every boss maps to a scenario", () => {
    for (const b of BOSSES) {
      const mapping = BOSS_PARTNERS[b.id];
      expect(scenarioById(mapping.scenarioId), b.id).toBeDefined();
      expect(PERSONAS[mapping.persona], b.id).toBeDefined();
      const text = scenarioText(scenarioById(mapping.scenarioId)!, mapping.persona, { guidance: mapping.guidance, bossId: b.id });
      expect(ScenarioText.safeParse(text).success, b.id).toBe(true);
      expect(text.bossId).toBe(b.id);
    }
    expect(BOSS_PARTNERS["job-interview"]).toMatchObject({ scenarioId: "job-interview", persona: "interviewer", pressure: 2 });
    expect(BOSS_PARTNERS.meeting).toMatchObject({ scenarioId: "meeting-update", persona: "neutral", pressure: 3 });
  });

  it("the offline panel asks one general question per listener, in the listeners' order (13.9)", () => {
    const s = panelScenarioText(["expert", "newcomer"], () => 0);
    expect(s.opening).toBe(PANEL.newcomer.questions[0]);
    expect(s.script).toEqual([{ text: PANEL.expert.questions[0], move: "follow_up" }]);
    expect(s.maxTurns).toBe(2);
    const all = panelScenarioText([...PANEL_PERSONAS], () => 0);
    expect(all.script.map((l) => l.move)).toEqual(["challenge", "follow_up"]);
    expect(ScenarioText.safeParse(all).success).toBe(true);
    expect(PANEL_PERSONAS.flatMap((p) => [...PANEL[p].questions, PANEL[p].description]).flatMap((t) => offending(t))).toEqual([]);
  });
});
