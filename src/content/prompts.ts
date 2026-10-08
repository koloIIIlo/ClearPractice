import type { PracticePrompt, TaskConditions } from "@/lib/ipc/schemas";

/**
 * Bundled prompt pack (plan 4.1, 4.5). Bump CURRICULUM_VERSION whenever a
 * prompt's wording or conditions change; sessions keep the snapshot they used.
 * Subjects follow D-19: explaining complex topics, debating and teaching across
 * sport, economics, religion, crypto, programming, anime and books.
 */
export const CURRICULUM_VERSION = 1;

const cond = (
  familiarity: TaskConditions["familiarity"],
  preparationSeconds: number,
  targetSeconds: number,
  audience: string | null = null,
  followUp = false,
): TaskConditions => ({ familiarity, preparationSeconds, targetSeconds, audience, followUp });

const bundled = (id: string, text: string, tags: PracticePrompt["tags"], conditions: TaskConditions, favorite = false): PracticePrompt => ({
  id, text, tags, conditions, favorite, source: "bundled",
});

export const PROMPTS: PracticePrompt[] = [
  // Everyday starters (kept from the first pack; ids are referenced by plans and history).
  bundled("p-habit", "Describe a habit you would like to change and why.", ["daily_life"], cond("familiar", 15, 60), true),
  bundled("p-process", "Explain how you prepare for a busy day.", ["explanations", "daily_life"], cond("familiar", 15, 60)),
  bundled("p-tool", "Explain a tool you use at work to someone who has never seen it.", ["work", "explanations"], cond("unfamiliar", 30, 90, "A beginner")),
  bundled("p-remote", "Is working from home better than working in an office? Give your view.", ["opinions", "work"], cond("familiar", 30, 90)),
  bundled("p-mistake", "Tell a short story about a mistake that taught you something.", ["storytelling"], cond("familiar", 30, 120), true),
  bundled("p-city", "What would you change about the place where you live?", ["opinions", "daily_life"], cond("unfamiliar", 15, 60)),
  bundled("p-decision", "Explain a recent decision to a colleague, then answer a follow-up.", ["work", "explanations"], cond("unfamiliar", 15, 90, "A colleague", true)),
  bundled("p-unexpected", "If you could learn any skill instantly, what would it be?", ["unexpected"], cond("unfamiliar", 0, 60)),
  bundled("p-disagree", "A friend says learning languages is pointless with translation apps. Respond politely.", ["opinions", "unexpected"], cond("unfamiliar", 15, 90, "A friend", true)),
  bundled("p-weekend", "Describe what a good weekend looks like for you.", ["daily_life"], cond("familiar", 15, 60)),
  bundled("p-book", "Recommend a book, film, or series and explain why.", ["opinions", "storytelling"], cond("familiar", 30, 90)),
  bundled("p-project", "Summarise a project you worked on for a new team member.", ["work", "explanations"], cond("unfamiliar", 30, 120, "A new team member")),

  // Programming: explaining and teaching.
  bundled("p-prog-variable", "Explain what a variable is to someone who has never programmed.", ["explanations"], cond("familiar", 15, 60, "A complete beginner")),
  bundled("p-prog-bug", "Walk a teammate through how you found and fixed a difficult bug.", ["work", "storytelling"], cond("familiar", 30, 120, "A teammate", true)),
  bundled("p-prog-api", "Explain what an API is using an everyday comparison.", ["explanations"], cond("unfamiliar", 30, 90, "A non-technical manager")),
  bundled("p-prog-tests", "Convince a sceptical colleague that automated tests are worth the time.", ["opinions", "work"], cond("unfamiliar", 30, 90, "A sceptical colleague", true)),
  bundled("p-prog-index", "Explain why a database index makes some searches faster and some updates slower.", ["explanations", "work"], cond("unfamiliar", 45, 120, "A junior developer")),

  // Economics.
  bundled("p-econ-inflation", "Explain inflation to a teenager in under two minutes.", ["explanations"], cond("unfamiliar", 30, 120, "A teenager")),
  bundled("p-econ-supply", "Use a concert ticket example to explain supply and demand.", ["explanations"], cond("familiar", 30, 90, "A friend")),
  bundled("p-econ-rent", "Should cities cap rents? Give one argument for and one against, then your view.", ["opinions"], cond("unfamiliar", 45, 120, null, true)),
  bundled("p-econ-budget", "Teach someone a simple way to plan a monthly budget.", ["explanations", "daily_life"], cond("familiar", 15, 90, "Someone living alone for the first time")),

  // Crypto.
  bundled("p-crypto-blockchain", "Explain what a blockchain is without using the words 'block' or 'chain'.", ["explanations", "unexpected"], cond("unfamiliar", 30, 90, "A curious relative")),
  bundled("p-crypto-risk", "A friend wants to put their savings into a new coin. What would you say?", ["opinions"], cond("unfamiliar", 15, 90, "A friend", true)),
  bundled("p-crypto-wallet", "Explain the difference between a wallet's public address and its private key.", ["explanations"], cond("unfamiliar", 30, 90, "A first-time buyer")),
  bundled("p-crypto-debate", "Is cryptocurrency mainly useful or mainly speculation? Argue one side clearly.", ["opinions"], cond("unfamiliar", 45, 120, null, true)),

  // Sport.
  bundled("p-sport-rule", "Explain one rule of your favourite sport to someone watching for the first time.", ["explanations"], cond("familiar", 15, 60, "A first-time viewer")),
  bundled("p-sport-match", "Describe a memorable match or game as if telling a friend who missed it.", ["storytelling"], cond("familiar", 15, 90, "A friend")),
  bundled("p-sport-var", "Has video review made football fairer or more frustrating? Give your view.", ["opinions"], cond("unfamiliar", 30, 90, null, true)),
  bundled("p-sport-coach", "Teach a beginner how to warm up properly before exercise.", ["explanations", "daily_life"], cond("familiar", 15, 60, "A beginner")),

  // Religion and belief: explaining respectfully.
  bundled("p-belief-holiday", "Explain the meaning of a religious or cultural holiday to someone unfamiliar with it.", ["explanations"], cond("unfamiliar", 30, 90, "A new colleague")),
  bundled("p-belief-compare", "Describe how two belief traditions answer one shared question, without judging either.", ["explanations", "opinions"], cond("unfamiliar", 60, 120)),
  bundled("p-belief-school", "Should schools teach about several religions? Give your view and a reason.", ["opinions"], cond("unfamiliar", 30, 90, null, true)),

  // Anime and books.
  bundled("p-anime-recommend", "Recommend an anime to someone who has never watched one, and say who it suits.", ["opinions", "storytelling"], cond("familiar", 15, 90, "Someone new to anime")),
  bundled("p-anime-theme", "Explain the main theme of an anime or manga you know, without retelling the whole plot.", ["explanations", "storytelling"], cond("familiar", 30, 90)),
  bundled("p-anime-debate", "Is it better to watch an adaptation or read the original first? Argue your side.", ["opinions"], cond("unfamiliar", 30, 90, null, true)),
  bundled("p-book-summary", "Summarise a non-fiction book's main idea in three sentences, then give one example.", ["explanations"], cond("familiar", 45, 90)),
  bundled("p-book-character", "Describe a character you admire and what they would do in your situation.", ["storytelling", "unexpected"], cond("unfamiliar", 15, 90)),

  // Teaching and unexpected tasks.
  bundled("p-teach-skill", "Teach a skill you know well in three clear steps.", ["explanations"], cond("familiar", 30, 90, "A beginner", true)),
  bundled("p-unexpected-alien", "Explain what the internet is to a visitor from another planet.", ["unexpected", "explanations"], cond("unfamiliar", 0, 60, "A visitor with no context")),
  bundled("p-unexpected-object", "Pick an object near you and argue that it is the most important invention.", ["unexpected", "opinions"], cond("unfamiliar", 0, 60)),
];
