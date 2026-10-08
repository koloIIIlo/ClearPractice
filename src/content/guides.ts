import type { Guide } from "@/lib/ipc/schemas";

/**
 * Offline learning guides (plan 4.3), part of curriculum version 1. Short,
 * original, practical. They describe habits to try, never scores or levels, and
 * they are honest about what automatic feedback cannot tell you (§11).
 */
export const GUIDES: Guide[] = [
  {
    id: "g-pauses",
    title: "Pauses are allowed",
    summary: "Why a short silence often helps a listener more than a filler.",
    minutes: 3,
    sections: [
      { heading: "A pause is not a mistake", paragraphs: [
        "Listeners need a moment to take in what you just said. A short pause between ideas gives them that moment, and it gives you time to choose the next words.",
        "Fillers such as \"uh\" and \"um\" are normal in speech. They are not wrong; they simply fill the same gap a silent pause could fill, and when they come often they can make an answer harder to follow.",
      ] },
      { heading: "Try this", paragraphs: [
        "In your next take, finish one sentence, close your mouth, and breathe once before the next idea. It will feel longer to you than it sounds to a listener.",
        "When you review the take, listen for one place where a pause helped. The app marks pauses it measures from the recording; they are a guide to where you stopped, not a grade.",
      ] },
    ],
  },
  {
    id: "g-main-point",
    title: "Main point first",
    summary: "Open with the point, then give a reason and one example.",
    minutes: 3,
    sections: [
      { heading: "Point, reason, example", paragraphs: [
        "Many answers wander because the speaker is still discovering what they think. Try saying your main point in the first sentence, even if it feels too direct.",
        "Then give one reason, and one concrete example. \"I'd keep working from home. I focus better without interruptions. Last week I finished a report in a morning that would have taken all day in the office.\"",
      ] },
      { heading: "Why it works", paragraphs: [
        "A listener who knows your point can fit everything else around it. If you run out of time, the most important part has already been said.",
        "When you review, ask: could someone repeat my point after the first ten seconds?",
      ] },
    ],
  },
  {
    id: "g-self-review",
    title: "Reviewing your own recording",
    summary: "Listen for one thing at a time, and write down what you notice.",
    minutes: 4,
    sections: [
      { heading: "One focus per listen", paragraphs: [
        "Listening to yourself is uncomfortable at first, and it is easy to notice everything at once. Choose one thing before you press play: the opening, the pauses, or one expression you wanted to use.",
        "Listen once without stopping. Then write one sentence about what you noticed, in your own words. Your note is evidence too, and it stays labelled as yours.",
      ] },
      { heading: "Compare, don't judge", paragraphs: [
        "When you record a second take, compare the same feature in both. Did the point come earlier? Was a pause in a better place? Change one thing at a time, so you can tell what made the difference.",
        "A take that feels worse is still useful: it shows you what to try next, and every take stays saved so you can come back to it.",
      ] },
    ],
  },
  {
    id: "g-limits",
    title: "What automatic feedback can't tell you",
    summary: "Transcripts miss fillers and can't judge pronunciation. Here's what that means.",
    minutes: 4,
    sections: [
      { heading: "Transcripts are estimates", paragraphs: [
        "Speech recognition writes down what it thinks you said. Many systems quietly drop fillers and tidy repeated words, so a clean transcript does not prove a clean answer. ClearPractice marks filler candidates for you to confirm, because the machine can be wrong both ways.",
        "Times and measures such as pace or pauses are labelled Estimated. They help you find places to listen to, not verdicts.",
      ] },
      { heading: "What it cannot judge", paragraphs: [
        "There is no pronunciation grade and no mood detection in this app. Pitch lines show how your voice moved, not whether it was correct. An AI suggestion about wording is a suggestion: you decide whether it keeps your meaning.",
        "The best judge of clarity is still a listener. That is why the weekly task asks you to check what a real person understood.",
      ] },
    ],
  },
  {
    id: "g-thought-groups",
    title: "Thought groups",
    summary: "Speaking in chunks that each carry one idea.",
    minutes: 3,
    sections: [
      { heading: "Chunks, not words", paragraphs: [
        "Fluent speakers do not speak word by word. They speak in short groups, each carrying one idea, with a small pause or change of pitch between them: \"When I moved here / I didn't know anyone / so I joined a running club.\"",
        "The passages in the Thought groups exercise show these boundaries with a slash. Reading them aloud trains you to plan a group, say it, and briefly let it land.",
      ] },
      { heading: "Then let go of the text", paragraphs: [
        "After reading, hide the passage and explain the idea in your own words. You will not reuse every phrase, and that is the point: the habit of speaking in groups is what transfers.",
      ] },
    ],
  },
  {
    id: "g-imitation",
    title: "How to imitate usefully",
    summary: "Choosing a single feature and comparing by ear.",
    minutes: 3,
    sections: [
      { heading: "Pick one feature", paragraphs: [
        "Copying a whole clip at once is overwhelming. Choose one feature to imitate: which word carries the stress, where the voice falls at the end of a sentence, or the rhythm of a short phrase.",
        "Listen several times, then record your version without the clip playing, so only your voice is in the recording.",
      ] },
      { heading: "Compare by ear first", paragraphs: [
        "Play the clip and your take one after the other and listen for the feature you chose. The intonation view can help you see a rise or a fall, but similar-looking lines are not a score, and different voices naturally sit higher or lower.",
        "If the feature sounds close, keep it and choose a new one next time; if not, slow the clip down and try a single phrase.",
      ] },
    ],
  },
  {
    id: "g-expressions",
    title: "Keeping new expressions",
    summary: "Why recall and reuse beat rereading a list.",
    minutes: 3,
    sections: [
      { heading: "Use it in your own sentence", paragraphs: [
        "Reading an expression ten times feels productive, but it rarely makes it available when you speak. What helps is retrieving it from memory and using it in a sentence about your own life.",
        "When you save a phrase, write or say three original sentences with it. Keep the meaning you intend, and note whether a correction is a real error or just another way to say it.",
      ] },
      { heading: "Spaced practice", paragraphs: [
        "The Phrases page brings an expression back after a few days, then after longer gaps. Try to recall it before you reveal it; the effort of recalling is what makes it stick.",
        "Then use it once in a real conversation that week, and notice whether it came out naturally.",
      ] },
    ],
  },
  {
    id: "g-real-talk",
    title: "Taking practice into real conversations",
    summary: "Small weekly tasks and asking a listener what they understood.",
    minutes: 4,
    sections: [
      { heading: "One small task a week", paragraphs: [
        "Practice at the desk matters most when it shows up in conversation. Each week, choose one small task: explain a recent decision to a colleague, or recommend a book to a friend.",
        "You do not need to record anyone else. Afterwards, write down what you said and what the listener seemed to understand.",
      ] },
      { heading: "Ask what they understood", paragraphs: [
        "A simple question gives the most honest feedback there is: \"Could you tell me in one sentence what you took from that?\" If their sentence matches your main point, it worked. If not, you know exactly what to practise next.",
        "Keep real conversations separate from rehearsed answers when you look at your progress. They measure different things.",
      ] },
    ],
  },
];
