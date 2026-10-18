import { toast } from "sonner";
import { PROMPTS } from "@/content/prompts";
import { seededRandom } from "@/lib/engagement/random";

/** Loaded only when a surprise is due. Reuse a stored curriculum prompt and its Studio snapshot. */
export function showSurprisePrompt(date: string, navigate: (url: string) => void, dismiss: () => void): string {
  const prompts = PROMPTS.filter((p) => p.conditions.targetSeconds >= 60 && p.conditions.targetSeconds <= 120);
  const prompt = prompts[Math.floor(seededRandom(`${date}-prompt`)() * prompts.length)];
  toast(`Surprise prompt: ${prompt.text}`, {
    description: "A 1–2 minute practice. Skip whenever you like.",
    action: { label: "Start", onClick: () => { dismiss(); navigate(`/practice/ex-repeat?prompt=${prompt.id}`); } },
    cancel: { label: "Not now", onClick: dismiss },
    duration: 30_000,
  });
  return prompt.text;
}
