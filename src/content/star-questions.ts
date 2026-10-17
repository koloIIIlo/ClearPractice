/**
 * Behavioural interview questions for the job interview boss (roadmap 10.13,
 * appendix C.2), answered with Situation, Task, Action, Result. IDs never change.
 */
export type StarQuestion = { id: string; text: string };

const TEXTS = [
  "Tell me about a time you disagreed with a colleague.",
  "Describe a project that didn't go to plan.",
  "Tell me about a time you had to learn something fast.",
  "Tell me about a time you solved a problem nobody else had noticed.",
  "Describe a time you had to meet a tight deadline.",
  "Tell me about a time you helped a team member who was struggling.",
  "Describe a situation where you had to change your plans quickly.",
  "Tell me about a mistake you made and how you put it right.",
  "Describe a time you led a group without being the manager.",
  "Tell me about a time you explained something complex to a beginner.",
  "Describe a time you received difficult feedback.",
  "Tell me about a time you persuaded someone to try your idea.",
  "Describe a time you worked with someone very different from you.",
  "Tell me about a time you had too much work and had to choose priorities.",
  "Describe a situation where you did more than was asked.",
  "Tell me about a time you improved a way of working.",
  "Describe a time you dealt with a customer who had a complaint.",
  "Tell me about a decision you made without all the facts.",
  "Describe a goal you set and how you reached it.",
  "Tell me about a time a deadline moved and you had to adapt.",
  "Describe a time you took responsibility for something that went wrong.",
  "Tell me about a time you had to say no to a request.",
  "Describe a time you shared knowledge with your team.",
  "Tell me about a time you had to get used to a new tool or system.",
  "Describe a situation where you had to stay calm under pressure.",
  "Tell me about a time you noticed a risk early.",
  "Describe how you built a good working relationship with a new client.",
  "Tell me about a time you organised an event or a meeting.",
  "Describe a time you had to give someone bad news.",
  "Tell me about a project you are proud of and your part in it.",
] as const;

export const STAR_QUESTIONS: readonly StarQuestion[] = TEXTS.map((text, i) => ({ id: `star-${String(i + 1).padStart(2, "0")}`, text }));
