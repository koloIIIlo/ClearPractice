import type { TransferTag } from "@/lib/ipc/schemas";
import type { AreaId } from "@/lib/engagement/types";

/**
 * Missions (roadmap 14.1, appendix C.5): small, concrete challenges in real
 * conversations, one a week, which you choose. Difficulty runs from 1 (easy)
 * to 3 (hard). `tags` are the kinds of conversation the reflection form
 * preselects. Two areas differ from the appendix table so that every area has
 * a mission: the voice message (voice) and asking about a word (listening).
 * IDs never change once shipped; the wording is reviewed before release.
 */
export type Mission = { id: string; title: string; how: string; area: AreaId; difficulty: 1 | 2 | 3; tags: TransferTag[] };

export const MISSIONS: readonly Mission[] = [
  { id: "ask-in-meeting", title: "Ask one question in a meeting", how: "Write the question down before the meeting starts, then ask it when the topic comes up.", area: "courage", difficulty: 1, tags: ["meeting"] },
  { id: "good-morning", title: "Say good morning to someone new and ask how their week is going", how: "Pick someone you see often but rarely talk to. One greeting and one question is enough.", area: "courage", difficulty: 1, tags: ["small_talk"] },
  { id: "cafe-question", title: "Order at a cafe and ask one question about the menu", how: "Choose your question while you wait in line, for example what they would recommend.", area: "vocabulary", difficulty: 1, tags: ["small_talk"] },
  { id: "voice-message", title: "Leave a 30-second voice message for a friend", how: "Say who it is, the one thing you want to tell them, and a goodbye. Send it without re-recording.", area: "voice", difficulty: 1, tags: ["phone"] },
  { id: "use-saved-phrase", title: "Use one saved phrase in a real conversation", how: "Pick one phrase from your list in the morning and look for a moment to say it today.", area: "vocabulary", difficulty: 1, tags: ["other"] },
  { id: "directions-home", title: "Explain how to get to your home to someone", how: "Give the steps in order and name one landmark they can look out for.", area: "structure", difficulty: 1, tags: ["small_talk"] },
  { id: "film-or-book", title: "Tell someone about a film or book you liked, in one minute", how: "Say what it is about in one sentence, then the one moment you remember best.", area: "storytelling", difficulty: 1, tags: ["story"] },
  { id: "colleague-work", title: "Ask a colleague what they're working on, and one follow-up question", how: "Listen for one detail in their answer and ask about that detail.", area: "spontaneity", difficulty: 1, tags: ["small_talk"] },
  { id: "compliment-reason", title: "Give a compliment with a reason (\"I liked … because …\")", how: "Name the specific thing and say why it worked for you.", area: "structure", difficulty: 1, tags: ["other"] },
  { id: "call-instead", title: "Call a shop or office instead of emailing", how: "Note your question and any numbers you need before you dial.", area: "courage", difficulty: 2, tags: ["phone"] },
  { id: "dinner-story", title: "Tell a one-minute story at dinner", how: "Start with where and when, give one detail people can picture, and end with what happened.", area: "storytelling", difficulty: 2, tags: ["story"] },
  { id: "explain-job", title: "Explain your job to someone outside your field", how: "Say who you help and how, without the words only your team uses. Add one example.", area: "structure", difficulty: 2, tags: ["small_talk"] },
  { id: "summarise-decision", title: "Summarise a meeting's decision in two sentences for someone who missed it", how: "First sentence: what was decided. Second sentence: what happens next.", area: "structure", difficulty: 2, tags: ["meeting"] },
  { id: "ask-for-help", title: "Ask for help with something, and explain what you've tried", how: "Say the goal, what you tried, and where you are stuck, in that order.", area: "spontaneity", difficulty: 2, tags: ["meeting"] },
  { id: "update-no-notes", title: "Give a one-minute update without notes", how: "Use three parts: what is done, what is next, and anything in the way.", area: "fluency", difficulty: 2, tags: ["meeting"] },
  { id: "unexpected-answer", title: "Answer a question you didn't expect without saying \"um\" at the start", how: "Take a breath and pause for a second before your first word. A pause is fine.", area: "fluency", difficulty: 2, tags: ["other"] },
  { id: "disagree-politely", title: "Disagree politely with one point", how: "Say what you agree with first, then \"I see it differently because …\".", area: "spontaneity", difficulty: 2, tags: ["meeting"] },
  { id: "teach-three-steps", title: "Teach someone a small skill in three steps", how: "Say how many steps there are before you start, then number them as you go.", area: "structure", difficulty: 2, tags: ["other"] },
  { id: "concrete-detail-story", title: "Tell a story with one concrete detail (a name, a place, a sound)", how: "Choose the detail before you start and put it near the beginning.", area: "storytelling", difficulty: 2, tags: ["story"] },
  { id: "stranger-recommendation", title: "Ask a stranger for a recommendation", how: "Ask somewhere people expect questions, like a bookshop or a market stall.", area: "courage", difficulty: 2, tags: ["small_talk"] },
  { id: "join-conversation", title: "Join a conversation that has already started", how: "Listen for a minute, then add something that links to what was just said.", area: "courage", difficulty: 3, tags: ["small_talk"] },
  { id: "present-five", title: "Present something for five minutes", how: "Plan an opening, three points and a close. Rehearse it once out loud the day before.", area: "courage", difficulty: 3, tags: ["presentation"] },
  { id: "speak-first", title: "Speak first in a meeting", how: "Prepare your opening sentence and say it when the floor opens.", area: "courage", difficulty: 3, tags: ["meeting"] },
  { id: "feedback-two-parts", title: "Give feedback to someone: one thing that worked, one to change", how: "Be specific about both, and offer the change as a suggestion.", area: "structure", difficulty: 3, tags: ["meeting"] },
  { id: "phone-call-full", title: "Handle a phone call in English from start to finish", how: "Have your name, reason for calling and the questions you need written down.", area: "spontaneity", difficulty: 3, tags: ["phone"] },
  { id: "negotiate-small", title: "Negotiate something small (a price, a date, a task)", how: "Know what you want and one alternative you would accept before you start.", area: "spontaneity", difficulty: 3, tags: ["other"] },
  { id: "story-laugh", title: "Tell a story that makes someone laugh", how: "Keep the set-up short and pause just before the funny part.", area: "storytelling", difficulty: 3, tags: ["story"] },
  { id: "three-follow-ups", title: "Answer three follow-up questions about your work", how: "Invite questions after you explain something, then answer each one briefly.", area: "spontaneity", difficulty: 3, tags: ["meeting"] },
  { id: "explain-mistake", title: "Explain a mistake you made, and what you'll do differently", how: "Say what happened, what you learned, and the one change you are making.", area: "structure", difficulty: 3, tags: ["meeting"] },
  { id: "run-meeting", title: "Run a short meeting or call", how: "Open with the goal, keep to an agenda of two or three items, and close with next steps.", area: "courage", difficulty: 3, tags: ["meeting"] },
  { id: "ask-main-point", title: "Ask \"What was my main point?\" after you explain something", how: "Ask it lightly, as a check, and listen to how they put it in their own words.", area: "structure", difficulty: 2, tags: ["other"] },
  { id: "pause-before-hard", title: "Pause for two seconds before answering a hard question", how: "Count two in your head before you answer. Listeners hear thought, not hesitation.", area: "fluency", difficulty: 1, tags: ["other"] },
  { id: "in-other-words", title: "Use \"in other words\" to rephrase when someone looks confused", how: "Say the same idea again more simply, with an example if you have one.", area: "vocabulary", difficulty: 2, tags: ["other"] },
  { id: "weekend-four", title: "Describe your weekend in four sentences: what, where, who, best moment", how: "One sentence for each part, in that order.", area: "storytelling", difficulty: 1, tags: ["small_talk"] },
  { id: "ask-word-meaning", title: "Ask someone to repeat or explain a word you didn't know", how: "Try \"Sorry, what does … mean?\" Most people are glad to explain.", area: "listening", difficulty: 1, tags: ["other"] },
  { id: "queue-small-talk", title: "Make small talk while waiting in a queue", how: "Comment on something you both can see, then ask one easy question.", area: "courage", difficulty: 2, tags: ["small_talk"] },
  { id: "news-minute", title: "Explain a news story you read, in one minute", how: "Say what happened, why it matters, and what might happen next.", area: "structure", difficulty: 2, tags: ["other"] },
  { id: "recommend-place", title: "Recommend a place with three reasons", how: "Name the place first, then give the reasons one by one.", area: "structure", difficulty: 1, tags: ["small_talk"] },
  { id: "problem-two-options", title: "Tell a colleague about a problem and suggest two options", how: "State the problem in one sentence, then give each option with one advantage.", area: "spontaneity", difficulty: 2, tags: ["meeting"] },
  { id: "thank-specifically", title: "Thank someone and say specifically what helped", how: "Name the thing they did and the difference it made for you.", area: "vocabulary", difficulty: 1, tags: ["other"] },
];

export const missionById = (id: string | null | undefined) => (id ? MISSIONS.find((m) => m.id === id) : undefined);
