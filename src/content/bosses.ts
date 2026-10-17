import type { AreaId } from "@/lib/engagement/types";

/**
 * Boss levels (roadmap 10.13, appendix C.3): bigger challenges, fully offline.
 * Questions are written in advance; version 2 (13.6) lets the AI partner play
 * the other person. Each ends with a question you answer yourself (Your note).
 */
export type BossRound =
  | { kind: "fixed"; key: string; prompt: string; thinkSeconds: number; speakSeconds: number; cards?: readonly string[]; interruptAtSeconds?: number }
  | { kind: "drawn"; key: string; from: "star" | "skeptical" | "interruption"; count: number; thinkSeconds: number; speakSeconds: number; cards?: readonly string[] };

export type BossId = "job-interview" | "skeptical-qa" | "toast" | "meeting";
export type BossDef = {
  id: BossId;
  title: string;
  description: string;
  recommendedAfter: { area: AreaId; level: 3 };
  finalCheck: string;
  rounds: readonly BossRound[];
};

export const BOSSES: readonly BossDef[] = [
  {
    id: "job-interview",
    title: "Job interview",
    description: "Introduce yourself, then answer three behavioural questions with a situation, a task, what you did and the result.",
    recommendedAfter: { area: "structure", level: 3 },
    finalCheck: "Would you hire yourself on these answers?",
    rounds: [
      { kind: "fixed", key: "about", prompt: "Tell me about yourself.", thinkSeconds: 10, speakSeconds: 90 },
      { kind: "drawn", key: "star", from: "star", count: 3, thinkSeconds: 10, speakSeconds: 120, cards: ["Situation", "Task", "Action", "Result"] },
    ],
  },
  {
    id: "skeptical-qa",
    title: "Sceptical Q&A",
    description: "Make a claim about something you know well, then answer three sceptical questions about it.",
    recommendedAfter: { area: "spontaneity", level: 3 },
    finalCheck: "Did you answer the question that was asked?",
    rounds: [
      { kind: "fixed", key: "claim", prompt: "State something you believe about a topic you know well, and give your main reason.", thinkSeconds: 15, speakSeconds: 60 },
      { kind: "drawn", key: "question", from: "skeptical", count: 3, thinkSeconds: 5, speakSeconds: 60 },
    ],
  },
  {
    id: "toast",
    title: "Wedding toast",
    description: "Give a 90-second toast at a friend's wedding: who you are, a story, a wish, and a raised glass.",
    recommendedAfter: { area: "storytelling", level: 3 },
    finalCheck: "Would the couple smile at your story?",
    rounds: [
      { kind: "fixed", key: "toast", prompt: "Give a toast at a friend's wedding.", thinkSeconds: 30, speakSeconds: 90, cards: ["Who you are", "A story", "A wish", "Raise a glass"] },
    ],
  },
  {
    id: "meeting",
    title: "Meeting update, interrupted",
    description: "Give a one-minute status update. Someone interrupts with a question; answer it, then get back to your point.",
    recommendedAfter: { area: "courage", level: 3 },
    finalCheck: "Did you get back to your point after the interruption?",
    rounds: [
      { kind: "fixed", key: "update", prompt: "Give a one-minute status update on something you are working on.", thinkSeconds: 15, speakSeconds: 60, interruptAtSeconds: 40 },
      { kind: "drawn", key: "answer", from: "interruption", count: 1, thinkSeconds: 5, speakSeconds: 30 },
    ],
  },
];

export function bossById(id: string): BossDef | undefined {
  return BOSSES.find((b) => b.id === id);
}

const list = (prefix: string, texts: readonly string[]) => texts.map((text, i) => ({ id: `${prefix}-${String(i + 1).padStart(2, "0")}`, text }));

/** General sceptical follow-ups for the Q&A boss. */
export const SKEPTICAL_QUESTIONS: readonly { id: string; text: string }[] = list("skeptic", [
  "What's your evidence for that?",
  "Who would disagree with you, and why?",
  "What would change your mind?",
  "Isn't that just one example?",
  "What's the strongest argument against your view?",
  "How do you know that's true for most people?",
  "What would happen if you were wrong?",
  "Can you give me a concrete example?",
  "Why should anyone care about this?",
  "What are you leaving out?",
  "Is there a simpler explanation?",
  "How would you test that idea?",
  "What does it cost, and who pays?",
  "Has this ever failed before?",
]);

/** Polite interruptions for the meeting boss. */
export const INTERRUPTIONS: readonly { id: string; text: string }[] = list("interrupt", [
  "Sorry, can I ask what the deadline is?",
  "Sorry, who is responsible for that part?",
  "Can I stop you there? How much will this cost?",
  "Sorry, what does that mean for my team?",
  "Before you go on, has the client agreed to this?",
  "Can I ask what happens if we miss that date?",
  "Sorry, which version are we talking about?",
  "One quick question: who else knows about this?",
  "Sorry, can you go back to the numbers for a moment?",
  "Before you continue, what do you need from us?",
]);
