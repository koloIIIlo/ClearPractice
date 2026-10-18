/**
 * Talk templates (roadmap 14.3, appendix C.10): section lists with default
 * target times. Classic and Story are for a 5-minute talk; the others are as
 * long as they say. You can rename, retime, add and remove sections.
 */
export type TalkTemplate = { id: string; title: string; summary: string; sections: readonly { title: string; targetSeconds: number }[] };

export const TALK_TEMPLATES: readonly TalkTemplate[] = [
  {
    id: "classic", title: "Classic", summary: "Opening, three points and a close (5 min).",
    sections: [{ title: "Opening", targetSeconds: 30 }, { title: "Point 1", targetSeconds: 80 }, { title: "Point 2", targetSeconds: 80 }, { title: "Point 3", targetSeconds: 80 }, { title: "Close", targetSeconds: 30 }],
  },
  {
    id: "story", title: "Story", summary: "Situation, complication, resolution and the lesson (5 min).",
    sections: [{ title: "Situation", targetSeconds: 45 }, { title: "Complication", targetSeconds: 90 }, { title: "Resolution", targetSeconds: 105 }, { title: "Lesson", targetSeconds: 60 }],
  },
  {
    id: "star", title: "STAR answer", summary: "Situation, task, action and result, for an interview answer (2 min).",
    sections: [{ title: "Situation", targetSeconds: 20 }, { title: "Task", targetSeconds: 15 }, { title: "Action", targetSeconds: 65 }, { title: "Result", targetSeconds: 20 }],
  },
  {
    id: "pitch", title: "Pitch", summary: "Problem, solution, why now and the ask (2 min).",
    sections: [{ title: "Problem", targetSeconds: 30 }, { title: "Solution", targetSeconds: 45 }, { title: "Why now", targetSeconds: 20 }, { title: "Ask", targetSeconds: 25 }],
  },
  {
    id: "toast", title: "Toast", summary: "Who you are, a story, a wish and raising a glass (90 s).",
    sections: [{ title: "Who you are", targetSeconds: 15 }, { title: "A story", targetSeconds: 45 }, { title: "A wish", targetSeconds: 20 }, { title: "Raise a glass", targetSeconds: 10 }],
  },
  {
    id: "update", title: "Update", summary: "Done, next and blockers (2 min).",
    sections: [{ title: "Done", targetSeconds: 50 }, { title: "Next", targetSeconds: 40 }, { title: "Blockers", targetSeconds: 30 }],
  },
];

export const talkTemplate = (id: string | null | undefined) => TALK_TEMPLATES.find((t) => t.id === id);

/** The template an event's outline starts from (14.2): STAR answers for an interview, an update for a meeting. */
export function templateForEvent(kind: string): string {
  return ({ interview: "star", meeting: "update", toast: "toast", pitch: "pitch" } as Record<string, string>)[kind] ?? "classic";
}
