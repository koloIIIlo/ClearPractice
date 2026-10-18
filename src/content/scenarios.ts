import { INTERRUPTIONS, SKEPTICAL_QUESTIONS, type BossId } from "@/content/bosses";
import { STAR_QUESTIONS } from "@/content/star-questions";
import type { AreaId } from "@/lib/engagement/types";
import type { PanelPersona, PartnerMove, ScenarioText } from "@/lib/ipc/schemas";

/**
 * The conversation partner's content (roadmap 13.2, appendix C.4). A
 * scenario's role, goal and opening and a persona's style are sent to the
 * model as practice content, never as instructions; the scripted lines are
 * the offline partner's (13.8), asked in order with one general follow-up
 * mixed in. Nothing here asks for scores, feedback or praise.
 */
export type PersonaId = "friendly" | "neutral" | "skeptic" | "newcomer" | "expert" | "interviewer";
export type Persona = {
  title: string;
  /** One line for the start dialog. */
  description: string;
  /** Sent as the partner's manner. */
  style: string;
  voiceHint: "any" | "lower" | "higher";
};

export const PERSONAS: Record<PersonaId, Persona> = {
  friendly: { title: "Friendly", description: "Warm and patient, with open questions.", style: "warm, encouraging, patient; asks open questions", voiceHint: "any" },
  neutral: { title: "Neutral", description: "Polite and professional, with direct questions.", style: "polite and professional; asks direct questions", voiceHint: "any" },
  skeptic: { title: "Sceptical", description: "Polite but doubtful; wants evidence and examples.", style: "polite but doubtful; asks for evidence and examples", voiceHint: "lower" },
  newcomer: { title: "Newcomer", description: "Curious and new to the topic; asks basic questions.", style: "curious, knows little about the topic; asks basic questions", voiceHint: "higher" },
  expert: { title: "Expert", description: "Knowledgeable; asks precise, technical questions.", style: "knowledgeable; asks precise, technical questions", voiceHint: "lower" },
  interviewer: { title: "Interviewer", description: "Formal and structured; follows up on vague answers.", style: "formal and structured; follows up on vague answers", voiceHint: "any" },
};
export const PERSONA_IDS = Object.keys(PERSONAS) as PersonaId[];

export type Scenario = {
  id: string;
  title: string;
  summary: string;
  area: AreaId;
  partnerRole: string;
  learnerGoal: string;
  opening: string;
  /** Your answers before the conversation ends (4 to 12). */
  maxTurns: number;
  /** At least 6 natural follow-ups for the offline partner, asked in order. */
  scripted: string[];
  defaultPersona: PersonaId;
  recommendedAfter?: { area: AreaId; level: number };
};

export const SCENARIOS: Scenario[] = [
  {
    id: "job-interview",
    title: "Job interview",
    summary: "A behavioural interview: your background, then examples of what you did.",
    area: "structure",
    partnerRole: "A hiring manager at a software company",
    learnerGoal: "Show your experience with clear examples",
    opening: "Thanks for coming in. To start, could you walk me through your background?",
    maxTurns: 8,
    scripted: [
      "What made you interested in this role?",
      "Tell me about a project you're proud of. What was your part in it?",
      "Can you describe a time something went wrong at work? What did you do?",
      "How do you usually handle a disagreement with a colleague?",
      "Tell me about a time you had to learn something new quickly.",
      "What would your last manager say is your biggest strength?",
      "Where would you like to be in a few years?",
    ],
    defaultPersona: "interviewer",
    recommendedAfter: { area: "structure", level: 2 },
  },
  {
    id: "small-talk",
    title: "Small talk at a meetup",
    summary: "Meet someone new and keep a friendly conversation going.",
    area: "courage",
    partnerRole: "Someone you just met at a tech meetup",
    learnerGoal: "Keep a friendly conversation going and ask questions back",
    opening: "Hi! First time at one of these? What brings you here?",
    maxTurns: 6,
    scripted: [
      "Oh nice, how long have you been doing that?",
      "What do you like most about it?",
      "Have you been to the cafe on the corner? I hear it's good.",
      "Are you working on anything interesting at the moment?",
      "How did you get into that in the first place?",
      "Do you have any plans for the weekend?",
    ],
    defaultPersona: "friendly",
  },
  {
    id: "meeting-update",
    title: "Meeting status update",
    summary: "Give your team a clear update and handle their questions.",
    area: "structure",
    partnerRole: "Your team lead",
    learnerGoal: "Give a clear update and handle questions",
    opening: "Okay, can you give us a quick update on your part?",
    maxTurns: 5,
    scripted: [
      "Thanks. What's the biggest risk right now?",
      "When do you expect that part to be finished?",
      "Is there anything blocking you?",
      "What do you need from the rest of the team?",
      "If we had to cut something, what would you drop first?",
      "Great. What will you focus on this week?",
    ],
    defaultPersona: "neutral",
    recommendedAfter: { area: "structure", level: 3 },
  },
  {
    id: "negotiate-deadline",
    title: "Negotiating a deadline",
    summary: "Ask your manager for more time, with good reasons.",
    area: "spontaneity",
    partnerRole: "Your manager",
    learnerGoal: "Ask for more time with good reasons",
    opening: "I hear you wanted to talk about the release date?",
    maxTurns: 6,
    scripted: [
      "I see. Why do you need more time?",
      "The client is expecting it on Friday. What can we deliver by then?",
      "How sure are you about the new date?",
      "What happens if we keep the original date?",
      "Could anyone else help you finish sooner?",
      "Okay. What should I tell the client?",
    ],
    defaultPersona: "neutral",
  },
  {
    id: "complaint-call",
    title: "Customer complaint call",
    summary: "Calm a difficult call down and agree on next steps.",
    area: "courage",
    partnerRole: "A customer whose order is two weeks late",
    learnerGoal: "Calm things down and agree on next steps",
    opening: "Hello, I've been waiting two weeks for my order and nobody's answering my emails.",
    maxTurns: 6,
    scripted: [
      "That's not good enough. When will it actually arrive?",
      "Why didn't anyone tell me about the delay?",
      "Can I get a refund for the delivery cost?",
      "How do I know this won't happen again?",
      "Who can I contact if it doesn't arrive by then?",
      "Fine. Can you send me all of that in writing?",
    ],
    defaultPersona: "neutral",
    recommendedAfter: { area: "courage", level: 2 },
  },
  {
    id: "explain-mistake",
    title: "Explaining a mistake",
    summary: "Tell your manager what went wrong, own it and propose a fix.",
    area: "structure",
    partnerRole: "Your manager",
    learnerGoal: "Explain what went wrong, own it and propose a fix",
    opening: "So, what happened with the report yesterday?",
    maxTurns: 6,
    scripted: [
      "How did nobody notice before it went out?",
      "Who else was affected by it?",
      "What are you doing to fix it now?",
      "How long will that take?",
      "What will you do differently next time?",
      "Is there anything you need from me?",
    ],
    defaultPersona: "neutral",
  },
  {
    id: "doctor",
    title: "Doctor's appointment",
    summary: "Describe a minor problem clearly and ask your own questions.",
    area: "vocabulary",
    partnerRole: "A GP",
    learnerGoal: "Describe a minor problem clearly and ask questions",
    opening: "Good morning, what brings you in today?",
    maxTurns: 6,
    scripted: [
      "When did it start?",
      "Does anything make it better or worse?",
      "Have you taken anything for it so far?",
      "How is it affecting your sleep or your work?",
      "Have you had anything like this before?",
      "Is there anything else you'd like to ask me?",
    ],
    defaultPersona: "friendly",
  },
  {
    id: "pitch-friend",
    title: "Pitching an idea to a friend",
    summary: "Explain an idea simply and answer a friend's doubts.",
    area: "spontaneity",
    partnerRole: "A curious but sceptical friend",
    learnerGoal: "Explain an idea simply and answer doubts",
    opening: "So what's this idea you keep talking about?",
    maxTurns: 6,
    scripted: [
      "Who would actually use that?",
      "Doesn't something like that already exist?",
      "How would you make money from it?",
      "What's the hardest part going to be?",
      "What would you need to get started?",
      "If you started tomorrow, what would you do first?",
    ],
    defaultPersona: "skeptic",
    recommendedAfter: { area: "spontaneity", level: 2 },
  },
];

/**
 * Scenarios that only the boss levels use (13.6): the hub shows the eight above.
 */
export const BOSS_SCENARIOS: Scenario[] = [
  {
    id: "skeptical-claim",
    title: "Sceptical Q&A",
    summary: "Make a claim about something you know well and defend it.",
    area: "spontaneity",
    partnerRole: "A colleague who doubts your claim",
    learnerGoal: "State a claim about something you know well and defend it with reasons and examples",
    opening: "You said you had a strong view on this. Go on, what's your claim, and why?",
    maxTurns: 4,
    scripted: ["What's your evidence for that?", "Who would disagree with you, and why?", "What would change your mind?", "Can you give me a concrete example?", "What would happen if you were wrong?", "Is there a simpler explanation?"],
    defaultPersona: "skeptic",
  },
  {
    id: "wedding-guest",
    title: "Wedding toast",
    summary: "Give your toast, then chat with a guest about it.",
    area: "storytelling",
    partnerRole: "A friendly guest at a friend's wedding who just heard your toast",
    learnerGoal: "Give a short toast with a story and a wish, then talk about it",
    opening: "Everyone's got a glass. Whenever you're ready, the floor is yours!",
    maxTurns: 3,
    scripted: ["That story was lovely. How did you two first meet?", "What do you think makes them a good couple?", "Have you given a toast like that before?", "What's your wish for them, in one sentence?", "Will you be dancing later?", "How long have you known them?"],
    defaultPersona: "friendly",
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id) ?? BOSS_SCENARIOS.find((s) => s.id === id);
}

/** General follow-ups the scripted partner mixes in, one per conversation (13.8). */
export const GENERAL_FOLLOW_UPS: string[] = [
  "Interesting. Can you tell me a bit more about that?",
  "What do you mean by that, exactly?",
  "Can you give me an example?",
  "Why do you think that is?",
  "How did that make a difference?",
  "What happened next?",
  "What would you do differently?",
  "Sorry, could you say that again more simply?",
  "And what was the result in the end?",
  "Is that usually how it goes?",
];

/** Partner lines the scripted partner uses for each move; the scripted lines are follow-ups. */
const SCRIPTED_MOVE: PartnerMove = "follow_up";

/**
 * The offline partner's lines for one conversation (13.8): the scenario's
 * scripted lines in order, with one general follow-up at a random place.
 * Enough for every answer but the last.
 */
export function scriptedLines(scenario: Scenario, random: () => number = Math.random): { text: string; move: PartnerMove }[] {
  const general = GENERAL_FOLLOW_UPS[Math.floor(random() * GENERAL_FOLLOW_UPS.length) % GENERAL_FOLLOW_UPS.length];
  const lines = [...scenario.scripted];
  lines.splice(1 + Math.floor(random() * lines.length) % lines.length, 0, general);
  return lines.slice(0, scenario.maxTurns).map((text) => ({ text, move: SCRIPTED_MOVE }));
}

/** The scenario as it is sent and kept with the conversation. */
export function scenarioText(scenario: Scenario, persona: PersonaId, opts: { random?: () => number; guidance?: string | null; bossId?: string | null } = {}): ScenarioText {
  return {
    title: scenario.title,
    partnerRole: scenario.partnerRole,
    learnerGoal: scenario.learnerGoal,
    opening: scenario.opening,
    personaTitle: PERSONAS[persona].title,
    personaStyle: PERSONAS[persona].style,
    maxTurns: scenario.maxTurns,
    script: scriptedLines(scenario, opts.random),
    guidance: opts.guidance ?? null,
    bossId: opts.bossId ?? null,
    hints: [],
  };
}

/** The Q&A panel (13.9): its listeners and, offline, their general questions. */
export const PANEL: Record<PanelPersona, { title: string; description: string; questions: string[] }> = {
  newcomer: {
    title: "Newcomer",
    description: "New to the topic; asks about what they didn't follow.",
    questions: ["Sorry, I'm new to this. What does that actually mean?", "Could you explain the main idea in simpler words?", "Why does that matter to someone like me?"],
  },
  skeptic: {
    title: "Sceptic",
    description: "Politely doubtful; asks for evidence.",
    questions: ["How do you know that's true?", "What's the strongest argument against what you said?", "Isn't that just one example?"],
  },
  expert: {
    title: "Expert",
    description: "Knows the topic; asks about a detail.",
    questions: ["Which part of that was the hardest to get right?", "How would that work at a much larger scale?", "What would you measure to check it worked?"],
  },
};
export const PANEL_PERSONAS: PanelPersona[] = ["newcomer", "skeptic", "expert"];

/** The panel's offline questions as a scenario (the same text the desktop app uses for a model's questions). */
export function panelScenarioText(personas: PanelPersona[], random: () => number = Math.random): ScenarioText {
  const ordered = PANEL_PERSONAS.filter((p) => personas.includes(p));
  const questions = ordered.map((p) => PANEL[p].questions[Math.floor(random() * PANEL[p].questions.length) % PANEL[p].questions.length]);
  const names = ordered.map((p) => (p === "newcomer" ? "a newcomer" : p === "skeptic" ? "a sceptic" : "an expert"));
  return {
    title: "Questions from a panel",
    partnerRole: `A panel of listeners: ${names.join(", ")}`,
    learnerGoal: "Answer each listener's question clearly",
    opening: questions[0],
    personaTitle: "Panel",
    personaStyle: "Each listener asks one question in turn",
    maxTurns: ordered.length,
    script: questions.slice(1).map((text, i) => ({ text, move: ordered[i + 1] === "skeptic" ? "challenge" : "follow_up" })),
    guidance: null,
    bossId: null,
    hints: [],
  };
}

/**
 * Boss levels with the partner (13.6): each boss maps to a scenario, a persona
 * and a pressure level; the boss's questions guide the partner as scenario text.
 */
export const BOSS_PARTNERS: Record<BossId, { scenarioId: string; persona: PersonaId; pressure: 0 | 1 | 2 | 3; guidance: string }> = {
  "job-interview": {
    scenarioId: "job-interview", persona: "interviewer", pressure: 2,
    guidance: `Start with "Tell me about yourself", then ask behavioural questions such as: ${STAR_QUESTIONS.slice(0, 3).map((q) => q.text).join(" ")}`,
  },
  "skeptical-qa": {
    scenarioId: "skeptical-claim", persona: "skeptic", pressure: 2,
    guidance: `Question the claim the way a sceptic would, for example: ${SKEPTICAL_QUESTIONS.slice(0, 3).map((q) => q.text).join(" ")}`,
  },
  toast: { scenarioId: "wedding-guest", persona: "friendly", pressure: 1, guidance: "Listen to the toast, then ask one friendly question about the story or the couple at a time." },
  meeting: {
    scenarioId: "meeting-update", persona: "neutral", pressure: 3,
    guidance: `Interrupt the update politely with questions such as: ${INTERRUPTIONS.slice(0, 3).map((q) => q.text).join(" ")}`,
  },
};
