import type { Preferences } from "@/lib/ipc/schemas";
export const FIRST_LANGUAGES: { id: NonNullable<Preferences["firstLanguage"]>; label: string }[] = [
  { id: "arabic", label: "Arabic" }, { id: "french", label: "French" }, { id: "german", label: "German" },
  { id: "hindi", label: "Hindi" }, { id: "japanese", label: "Japanese" }, { id: "korean", label: "Korean" },
  { id: "mandarin", label: "Mandarin Chinese" }, { id: "polish", label: "Polish" }, { id: "portuguese", label: "Portuguese" },
  { id: "russian", label: "Russian" }, { id: "spanish", label: "Spanish" }, { id: "ukrainian", label: "Ukrainian" },
];
