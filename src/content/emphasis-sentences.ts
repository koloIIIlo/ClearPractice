/**
 * The emphasis game (roadmap 10.6, appendix C.2): sentences of six to nine
 * words where stressing a different word changes the meaning. `word` is an
 * index into `text.split(" ")`; `meaning` says what that stress implies.
 */
export type EmphasisTarget = { word: number; meaning: string };
export type EmphasisSentence = { id: string; text: string; targets: readonly EmphasisTarget[] };

export const EMPHASIS_SENTENCES: readonly EmphasisSentence[] = [
  {
    id: "es-01", text: "I didn't say she stole my money.",
    targets: [
      { word: 0, meaning: "Someone else said it." },
      { word: 2, meaning: "I suggested it without saying it." },
      { word: 3, meaning: "Someone else stole it." },
      { word: 6, meaning: "She stole something else." },
    ],
  },
  {
    id: "es-02", text: "She wants to buy a blue car.",
    targets: [
      { word: 0, meaning: "She does, not someone else." },
      { word: 3, meaning: "She wants to buy it, not rent it." },
      { word: 5, meaning: "Blue, not another colour." },
      { word: 6, meaning: "A car, not something else that is blue." },
    ],
  },
  {
    id: "es-03", text: "We are meeting at three tomorrow.",
    targets: [
      { word: 0, meaning: "We are, not another group." },
      { word: 4, meaning: "At three, not at another time." },
      { word: 5, meaning: "Tomorrow, not today." },
    ],
  },
  {
    id: "es-04", text: "Can you send me the report?",
    targets: [
      { word: 1, meaning: "You, not someone else." },
      { word: 3, meaning: "Send it to me, not to someone else." },
      { word: 5, meaning: "The report, not another document." },
    ],
  },
  {
    id: "es-05", text: "I left my keys on the table.",
    targets: [
      { word: 2, meaning: "My keys, not yours." },
      { word: 3, meaning: "My keys, not my phone." },
      { word: 6, meaning: "On the table, not somewhere else." },
    ],
  },
  {
    id: "es-06", text: "He only drinks coffee in the morning.",
    targets: [
      { word: 0, meaning: "He does, though others may not." },
      { word: 3, meaning: "Coffee, not tea." },
      { word: 6, meaning: "In the morning, not later in the day." },
    ],
  },
  {
    id: "es-07", text: "Our team finished the project last week.",
    targets: [
      { word: 0, meaning: "Our team, not another team." },
      { word: 2, meaning: "It is finished, not still going on." },
      { word: 5, meaning: "Last week, not this week." },
    ],
  },
  {
    id: "es-08", text: "I never said the plan was easy.",
    targets: [
      { word: 1, meaning: "Not once did I say it." },
      { word: 4, meaning: "The plan, not the work itself." },
      { word: 6, meaning: "I said something else about it, not that it was easy." },
    ],
  },
  {
    id: "es-09", text: "She gave the book to her brother.",
    targets: [
      { word: 0, meaning: "She did, not someone else." },
      { word: 1, meaning: "She gave it away; she didn't lend it." },
      { word: 3, meaning: "The book, not something else." },
      { word: 6, meaning: "Her brother, not her sister." },
    ],
  },
  {
    id: "es-10", text: "They moved to a bigger flat.",
    targets: [
      { word: 0, meaning: "They did, not us." },
      { word: 4, meaning: "Bigger, not smaller." },
      { word: 5, meaning: "A flat, not a house." },
    ],
  },
  {
    id: "es-11", text: "You should call the plumber today.",
    targets: [
      { word: 0, meaning: "You should, not me." },
      { word: 2, meaning: "Call, don't send an email." },
      { word: 5, meaning: "Today, not later this week." },
    ],
  },
  {
    id: "es-12", text: "I bought three apples at the market.",
    targets: [
      { word: 1, meaning: "I bought them; nobody gave them to me." },
      { word: 2, meaning: "Three, not two or four." },
      { word: 3, meaning: "Apples, not other fruit." },
      { word: 6, meaning: "At the market, not at the supermarket." },
    ],
  },
  {
    id: "es-13", text: "We could take the train instead.",
    targets: [
      { word: 1, meaning: "It is possible, not decided." },
      { word: 4, meaning: "The train, not the car." },
    ],
  },
  {
    id: "es-14", text: "Is this your coat on the chair?",
    targets: [
      { word: 2, meaning: "Yours, not someone else's." },
      { word: 3, meaning: "Your coat, not your bag." },
      { word: 6, meaning: "On the chair, not on the hook." },
    ],
  },
  {
    id: "es-15", text: "My sister painted the kitchen yellow.",
    targets: [
      { word: 1, meaning: "My sister, not my brother." },
      { word: 4, meaning: "The kitchen, not another room." },
      { word: 5, meaning: "Yellow, not another colour." },
    ],
  },
  {
    id: "es-16", text: "I thought the shop opened at nine.",
    targets: [
      { word: 1, meaning: "I thought so, but it seems I was wrong." },
      { word: 3, meaning: "The shop, not the café." },
      { word: 6, meaning: "At nine, not at another time." },
    ],
  },
  {
    id: "es-17", text: "He drove us to the station yesterday.",
    targets: [
      { word: 0, meaning: "He did, not someone else." },
      { word: 1, meaning: "He drove; we didn't walk." },
      { word: 2, meaning: "Us, not other people." },
      { word: 6, meaning: "Yesterday, not today." },
    ],
  },
  {
    id: "es-18", text: "Did you finish the whole cake?",
    targets: [
      { word: 1, meaning: "You, and not someone else?" },
      { word: 4, meaning: "All of it, not just a slice?" },
      { word: 5, meaning: "The cake, not the biscuits?" },
    ],
  },
  {
    id: "es-19", text: "This is the best soup I've tasted.",
    targets: [
      { word: 0, meaning: "This one, not the others." },
      { word: 4, meaning: "Soup, not another dish." },
      { word: 5, meaning: "I think so, though others may not." },
    ],
  },
  {
    id: "es-20", text: "She told me the meeting was cancelled.",
    targets: [
      { word: 0, meaning: "She did, not someone else." },
      { word: 2, meaning: "She told me, not other people." },
      { word: 4, meaning: "The meeting, not the dinner." },
      { word: 6, meaning: "Cancelled, not moved." },
    ],
  },
];
