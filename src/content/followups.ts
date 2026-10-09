/**
 * Written follow-up questions for prompts with a follow-up (plan 5.11, §7
 * interaction practice). Shown after the first answer as a simulation of a
 * listener; they work offline. Your own prompts with a follow-up use the
 * general questions. Curriculum version 1.
 */
export const FOLLOW_UPS: Record<string, string[]> = {
  "p-decision": ["What other option did you consider, and why didn't you choose it?", "What would make you change this decision later?"],
  "p-disagree": ["But translation apps keep getting better. Why spend years on a language?", "Have you ever had a moment where an app wasn't enough?"],
  "p-prog-bug": ["How would you stop this kind of bug from happening again?", "What did you try first that didn't work?"],
  "p-prog-tests": ["We have a deadline next week. Why not skip the tests just this once?", "How do you know a test is worth writing?"],
  "p-econ-rent": ["What happens to landlords who can no longer cover their costs?", "Is there a better way to make housing affordable?"],
  "p-crypto-risk": ["But my cousin made a lot of money this way. Why shouldn't I?", "How much would you say is safe to risk?"],
  "p-crypto-debate": ["Can you give one real example that supports your side?", "What is the strongest argument against your view?"],
  "p-sport-var": ["Should referees still have the final say?", "What would you change about how video review works?"],
  "p-belief-school": ["Who should decide what is taught about each religion?", "What if parents disagree with it?"],
  "p-anime-debate": ["What if the adaptation changes the ending?", "Which example best supports your side?"],
  "p-teach-skill": ["Which step do beginners usually get wrong?", "How long does it take to get comfortable with it?"],
};

export const GENERAL_FOLLOW_UPS = [
  "Can you give me a concrete example?",
  "Why do you think that is?",
  "What would someone who disagrees say?",
  "What was the most important point, in one sentence?",
];

export function followUpsFor(promptId: string): string[] {
  return FOLLOW_UPS[promptId] ?? GENERAL_FOLLOW_UPS;
}
