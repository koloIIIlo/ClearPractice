/**
 * Thought-group passages (plan 4.2), part of curriculum version 1. Each passage
 * is 40–80 words, original text, with " / " marking a natural pause between
 * thought groups. The Thought groups exercise (4.7) shows them: listen or read,
 * hide the text, then explain the idea in your own words.
 */
export type Passage = {
  id: string;
  title: string;
  subject: string;
  /** Text with " / " at each thought-group boundary. */
  text: string;
};

export const PASSAGES: Passage[] = [
  {
    id: "tg-parks",
    title: "City parks",
    subject: "daily life",
    text: "City parks do more than look nice. / On hot days, / trees can make a street several degrees cooler, / and grass soaks up rain / that would otherwise flood the drains. / Parks also give people a reason to slow down, / to meet their neighbours, / and to spend time outside / without paying for it.",
  },
  {
    id: "tg-variables",
    title: "What a variable is",
    subject: "programming",
    text: "A variable is a name for a value / that a program needs to remember. / Think of a labelled box: / the label stays the same, / but you can take out what is inside / and put in something new. / When the program later asks for the label, / it gets whatever the box holds / at that moment.",
  },
  {
    id: "tg-tests",
    title: "Why tests save time",
    subject: "programming",
    text: "Writing tests feels slow at first, / because you write code that users never see. / But every test is a small promise / that something still works. / When you change the code next month, / the tests check those promises in seconds, / so you find a mistake / before your users do.",
  },
  {
    id: "tg-inflation",
    title: "Inflation",
    subject: "economics",
    text: "Inflation means that prices rise over time, / so the same amount of money buys a little less. / A small, steady rise is normal / and most central banks aim for it. / The trouble starts when prices climb quickly: / savings lose value, / and people find it hard / to plan for the future.",
  },
  {
    id: "tg-supply",
    title: "Supply and demand",
    subject: "economics",
    text: "When a famous band announces a small concert, / thousands of people want a ticket, / but only a few hundred exist. / Because demand is far greater than supply, / prices on resale sites shoot up. / If the band moved to a stadium, / supply would grow, / and the price would usually fall.",
  },
  {
    id: "tg-blockchain",
    title: "A shared record",
    subject: "crypto",
    text: "A blockchain is a record of transactions / that many computers keep at the same time. / Instead of trusting one bank to hold the list, / everyone holds a copy / and checks new entries against the rules. / Changing an old entry is extremely hard, / because you would have to convince / most of those computers at once.",
  },
  {
    id: "tg-keys",
    title: "Public and private keys",
    subject: "crypto",
    text: "A crypto wallet has two important parts. / The public address is like your email address: / you can share it / so that people can send you money. / The private key is like your password, / except that nobody can reset it. / If you lose it, / the money is gone; / if someone copies it, / they can take everything.",
  },
  {
    id: "tg-offside",
    title: "The offside rule",
    subject: "sport",
    text: "In football, / a player is offside / if they are closer to the opponents' goal / than both the ball / and the second-last defender / at the moment a teammate passes to them. / The rule stops attackers / from simply waiting next to the goal. / It forces teams / to build their attacks together.",
  },
  {
    id: "tg-warmup",
    title: "Warming up",
    subject: "sport",
    text: "A good warm-up prepares the body / for the work that follows. / Start with a few minutes of light movement, / such as jogging, / to raise your heart rate. / Then move your joints / through the motions you are about to use. / Save long, still stretches / for after the session, / when your muscles are warm.",
  },
  {
    id: "tg-festivals",
    title: "Festivals of light",
    subject: "religion and culture",
    text: "Many traditions celebrate light / during the darkest part of the year. / Families light candles or lamps, / share food, / and tell stories / about hope returning after a hard time. / The details differ from place to place, / but the shared idea is simple: / even a small light / changes how a dark room feels.",
  },
  {
    id: "tg-adaptation",
    title: "Reading before watching",
    subject: "anime and books",
    text: "When a manga becomes an anime, / the story usually has to change. / A long inner thought / might become a single look, / and a slow chapter / might be cut entirely. / Some fans prefer to read first / so they can imagine the world themselves. / Others watch first / and read later / to discover what was left out.",
  },
  {
    id: "tg-summary",
    title: "Summarising a book",
    subject: "books",
    text: "A useful summary of a non-fiction book / answers three questions. / What problem does the author care about? / What is the main idea they offer? / And what is one example / that makes the idea concrete? / If you can answer those three questions / in under a minute, / you probably understood the book.",
  },
];

/** Words in a passage, ignoring pause marks. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w !== "/" && /[A-Za-z0-9]/.test(w)).length;
}

/** Thought groups of a passage, in order. */
export function thoughtGroups(text: string): string[] {
  return text.split(" / ").map((g) => g.trim()).filter(Boolean);
}
