import type { AreaId } from "@/lib/engagement/types";

/**
 * One theme a month (roadmap 9.13, appendix C.9). In the first week of a month
 * Journey and Today mention it, and the third weekly quest leans toward its
 * area. A suggestion only: every area stays open.
 */
export const MONTHLY_THEMES: Record<number, { title: string; area: AreaId; note: string }> = {
  1: { title: "Clear openings", area: "structure", note: "Quests lean toward opening with your point." },
  2: { title: "Stories", area: "storytelling", note: "Quests lean toward stories." },
  3: { title: "Thinking on your feet", area: "spontaneity", note: "Quests lean toward unfamiliar questions." },
  4: { title: "Your voice", area: "voice", note: "Quests lean toward endings and rhythm." },
  5: { title: "Real conversations", area: "courage", note: "Quests lean toward real conversations." },
  6: { title: "Better phrases", area: "vocabulary", note: "Quests lean toward phrases." },
  7: { title: "Listening and copying", area: "listening", note: "Quests lean toward imitation." },
  8: { title: "Steady flow", area: "fluency", note: "Quests lean toward pausing instead of filling." },
  9: { title: "Back to structure", area: "structure", note: "Quests lean toward point, reason and example." },
  10: { title: "Storytelling month", area: "storytelling", note: "Quests lean toward stories." },
  11: { title: "Under pressure", area: "spontaneity", note: "Quests lean toward short notice." },
  12: { title: "Looking back", area: "courage", note: "Quests lean toward real conversations and looking back." },
};

export const themeFor = (localDate: string) => MONTHLY_THEMES[Number(localDate.slice(5, 7))];
