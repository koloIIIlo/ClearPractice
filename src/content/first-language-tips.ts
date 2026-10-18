import type { Preferences } from "@/lib/ipc/schemas";
import { seededRandom } from "@/lib/engagement/random";

// RELEASE REVIEW REQUIRED: each language's tips need review by a knowledgeable
// speaker before release. None has been reviewed yet; record reviewers in docs/CONTENT_REVIEW.md.
export type FirstLanguageTip = { text: string; example: string; href: string };
export const FIRST_LANGUAGE_TIPS: Record<NonNullable<Preferences["firstLanguage"]>, FirstLanguageTip[]> = {
  "russian": [
    {
      "text": "Try a or the when introducing and then referring to something.",
      "example": "I bought a book. The book is about trees.",
      "href": "/practice/ex-thought-groups"
    },
    {
      "text": "Choose one syllable to make prominent in a long word.",
      "example": "Try pho-TOG-ra-phy, then put it in a sentence.",
      "href": "/drill/emphasis"
    },
    {
      "text": "Listen to the final pitch movement of a yes/no question.",
      "example": "Are you coming today?",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Let the last sound of a word stay audible before a pause.",
      "example": "We need a bag. We need a back.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Make the contrast word carry the message.",
      "example": "I said TUESDAY, not Thursday.",
      "href": "/drill/emphasis"
    },
    {
      "text": "Give a listener time between two complete ideas.",
      "example": "First we checked the map / then we left.",
      "href": "/practice/ex-thought-groups"
    }
  ],
  "ukrainian": [
    {
      "text": "Experiment with an article when a thing first appears in a story.",
      "example": "There is a cafe nearby. The cafe opens at eight.",
      "href": "/practice/ex-thought-groups"
    },
    {
      "text": "Listen for the prominent syllable in a new word.",
      "example": "Try de-VEL-op-ment in a short sentence.",
      "href": "/drill/emphasis"
    },
    {
      "text": "Keep the ending audible when it carries the time of an action.",
      "example": "I walk every day. Yesterday I walked.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Explore a light rise on a short checking question.",
      "example": "Is this your stop?",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Choose the word that gives the listener new information.",
      "example": "The meeting is ONLINE today.",
      "href": "/drill/emphasis"
    },
    {
      "text": "Pause at the boundary of an idea, wherever that helps you.",
      "example": "When the rain stopped / we went outside.",
      "href": "/practice/ex-thought-groups"
    }
  ],
  "polish": [
    {
      "text": "Try a or the as a small signpost for your listener.",
      "example": "I found a key. The key was under the chair.",
      "href": "/practice/ex-thought-groups"
    },
    {
      "text": "Explore word stress one word at a time.",
      "example": "Try IN-ter-est-ing, then an interesting idea.",
      "href": "/drill/emphasis"
    },
    {
      "text": "Listen to the difference between a short vowel and a longer one.",
      "example": "Try ship and sheep in two short sentences.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Let a word ending stay clear without adding another syllable.",
      "example": "Please send the next draft.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Change the important word to change what you mean.",
      "example": "SHE called me. She called ME.",
      "href": "/drill/emphasis"
    },
    {
      "text": "Group a reason with the point it supports.",
      "example": "I chose the train / because I could read.",
      "href": "/practice/ex-thought-groups"
    }
  ],
  "german": [
    {
      "text": "Try saying your main point before a longer explanation.",
      "example": "We should leave early / because the road is busy.",
      "href": "/practice/ex-thought-groups"
    },
    {
      "text": "Listen to the difference between w and v in a short phrase.",
      "example": "Try west and vest with a clip you like.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Let a final sound distinguish two words.",
      "example": "Try ride and write in separate sentences.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Experiment with the prominent word in a polite request.",
      "example": "Could you SEND it today?",
      "href": "/drill/emphasis"
    },
    {
      "text": "Listen to how small words fit around the main words.",
      "example": "I can meet you at the station.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Try a pause before the detail you want remembered.",
      "example": "There is one change / the time.",
      "href": "/practice/ex-thought-groups"
    }
  ],
  "french": [
    {
      "text": "Explore which syllable carries a new English word.",
      "example": "Try COM-fort-a-ble in a short phrase.",
      "href": "/drill/emphasis"
    },
    {
      "text": "Let the key word stand out within a phrase.",
      "example": "We need the BLUE folder.",
      "href": "/drill/emphasis"
    },
    {
      "text": "Try a gentle h at the start of a word when the clip has one.",
      "example": "Try heat and eat in separate sentences.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Listen to a final consonant and repeat the whole phrase.",
      "example": "Please keep the receipt.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Break a long sentence into ideas you can say comfortably.",
      "example": "The shop was closed / so we went home.",
      "href": "/practice/ex-thought-groups"
    },
    {
      "text": "Try a light linking sound between two words, if useful.",
      "example": "Take it with you.",
      "href": "/practice/ex-imitate"
    }
  ],
  "spanish": [
    {
      "text": "Listen to the first sound in a word beginning with s and another consonant.",
      "example": "Try school and street inside short phrases.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Choose a prominent syllable in a new long word.",
      "example": "Try a-VAIL-a-ble in a sentence.",
      "href": "/drill/emphasis"
    },
    {
      "text": "Explore two vowel sounds by copying a whole short phrase.",
      "example": "Try sit here and take a seat.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Keep a word ending audible when it tells the listener how many.",
      "example": "One book. Two books.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Use a pause to separate a point from its example.",
      "example": "It saves time / for example, on a busy morning.",
      "href": "/practice/ex-thought-groups"
    },
    {
      "text": "Try moving the emphasis to change the correction.",
      "example": "I ordered TWO coffees, not three.",
      "href": "/drill/emphasis"
    }
  ],
  "portuguese": [
    {
      "text": "Explore the vowel in two short words by listening first.",
      "example": "Try live here and leave here.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Keep the last sound in a phrase audible without adding a syllable.",
      "example": "I need a map.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Choose the syllable that stands out in a new word.",
      "example": "Try op-por-TU-ni-ty in a short sentence.",
      "href": "/drill/emphasis"
    },
    {
      "text": "Listen to the opening sound of a phrase with h.",
      "example": "How was your day?",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Let the listener hear where one idea ends.",
      "example": "I tried it twice / and the second time was easier.",
      "href": "/practice/ex-thought-groups"
    },
    {
      "text": "Make the contrast word the clearest word.",
      "example": "I can come TOMORROW.",
      "href": "/drill/emphasis"
    }
  ],
  "arabic": [
    {
      "text": "Try a short phrase with p and one with b, listening first.",
      "example": "Try a park and a bank.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Explore the vowel difference in two short words.",
      "example": "Try sit here and save your seat.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Choose one syllable to bring forward in a longer word.",
      "example": "Try in-for-MA-tion in a sentence.",
      "href": "/drill/emphasis"
    },
    {
      "text": "Keep a group of consonants comfortable at your own pace.",
      "example": "Try next week, then a whole sentence.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Use an article to help introduce a new thing.",
      "example": "I saw a bird. The bird was on the wall.",
      "href": "/practice/ex-thought-groups"
    },
    {
      "text": "Pause between a request and the reason for it.",
      "example": "Could we talk later / I need to check one thing.",
      "href": "/practice/ex-thought-groups"
    }
  ],
  "hindi": [
    {
      "text": "Choose a prominent word to make your intended contrast clear.",
      "example": "I need it TODAY, please.",
      "href": "/drill/emphasis"
    },
    {
      "text": "Listen to how a speaker joins the small words in a phrase.",
      "example": "I would like to try it.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Explore v and w in short phrases if that helps you.",
      "example": "Try a west wind and a very warm day.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Leave space between a main point and its supporting detail.",
      "example": "The plan worked / we finished before lunch.",
      "href": "/practice/ex-thought-groups"
    },
    {
      "text": "Try an article when introducing one particular thing.",
      "example": "I have a question about the schedule.",
      "href": "/practice/ex-thought-groups"
    },
    {
      "text": "Listen to the rhythm of a long word in a whole sentence.",
      "example": "Try re-spon-si-BIL-i-ty, then my responsibility.",
      "href": "/drill/emphasis"
    }
  ],
  "mandarin": [
    {
      "text": "Try a word ending that helps show more than one item.",
      "example": "One ticket. Two tickets.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Listen to the prominent syllable of a longer word.",
      "example": "Try to-MOR-row in a short sentence.",
      "href": "/drill/emphasis"
    },
    {
      "text": "Use a small word to make the time of an action clear.",
      "example": "Yesterday I went to the library.",
      "href": "/practice/ex-thought-groups"
    },
    {
      "text": "Explore a short phrase with l and one with r if useful.",
      "example": "Try a light rain and turn right.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Bring forward the word that is new for your listener.",
      "example": "The train leaves at SIX.",
      "href": "/drill/emphasis"
    },
    {
      "text": "Use a pause to give a listener the shape of a longer answer.",
      "example": "My first reason is cost / my second is time.",
      "href": "/practice/ex-thought-groups"
    }
  ],
  "japanese": [
    {
      "text": "Explore l and r by copying a whole short phrase.",
      "example": "Try a long road and turn left.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Let a final consonant finish the word without an extra syllable.",
      "example": "Try a big desk.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Choose a prominent syllable within a longer word.",
      "example": "Try im-POR-tant in a short sentence.",
      "href": "/drill/emphasis"
    },
    {
      "text": "Try an article when introducing one thing.",
      "example": "I bought a ticket for the concert.",
      "href": "/practice/ex-thought-groups"
    },
    {
      "text": "Listen to how a yes/no question ends in a clip you like.",
      "example": "Would you like some tea?",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Let the contrast word guide your listener.",
      "example": "I wanted the SMALL one.",
      "href": "/drill/emphasis"
    }
  ],
  "korean": [
    {
      "text": "Let the end of a word stay audible before a pause.",
      "example": "Try a cap and a cab in short sentences.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Explore f and p in a phrase if that helps you.",
      "example": "Try a full page and pull the page.",
      "href": "/practice/ex-imitate"
    },
    {
      "text": "Choose the syllable that carries a new word.",
      "example": "Try a-BOUT and IN-ter-view.",
      "href": "/drill/emphasis"
    },
    {
      "text": "Try an article when a thing first enters your story.",
      "example": "We found a place near the river.",
      "href": "/practice/ex-thought-groups"
    },
    {
      "text": "Split a long explanation into comfortable idea groups.",
      "example": "I checked the times / and booked the earlier train.",
      "href": "/practice/ex-thought-groups"
    },
    {
      "text": "Make the word you are correcting stand out.",
      "example": "The meeting is on MONDAY.",
      "href": "/drill/emphasis"
    }
  ]
};

/** Show occasionally, with a stable choice for the local date and exercise. */
export function occasionalLanguageTip(language: Preferences["firstLanguage"], date: string, href: string): FirstLanguageTip | null {
  if (!language) return null;
  const random = seededRandom(`${date}:${language}:${href}`);
  if (random() >= 0.35) return null;
  const tips = FIRST_LANGUAGE_TIPS[language].filter((t) => t.href === href);
  return tips[Math.floor(random() * tips.length)] ?? null;
}
