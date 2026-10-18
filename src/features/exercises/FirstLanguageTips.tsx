import { Link } from "react-router";
import { usePreferences } from "@/lib/ipc/queries";
import { FIRST_LANGUAGES } from "@/content/first-languages";
import { FIRST_LANGUAGE_TIPS, occasionalLanguageTip } from "@/content/first-language-tips";
import { toLocalDate } from "@/lib/phrase-schedule";

export function FirstLanguageTips() {
  const { preferences: { firstLanguage } } = usePreferences();
  if (!firstLanguage) return null;
  const label = FIRST_LANGUAGES.find((l) => l.id === firstLanguage)!.label;
  return <section className="mb-6 space-y-3" aria-labelledby="language-tips">
    <h2 id="language-tips" className="font-semibold">Practice ideas · {label}</h2>
    <p className="text-meta text-muted-foreground">Use what helps you and skip the rest. Your language choice does not tell us how you speak. These draft tips await review by a knowledgeable speaker.</p>
    <ul className="grid gap-3 md:grid-cols-2">{FIRST_LANGUAGE_TIPS[firstLanguage].map((tip) => <li key={tip.text} className="space-y-2 rounded-panel border bg-card p-4">
      <p>{tip.text}</p><p className="text-meta text-muted-foreground">Example: {tip.example}</p>
      <Link className="inline-flex min-h-10 items-center text-meta underline" to={tip.href}>Practise this</Link>
    </li>)}</ul>
  </section>;
}

export function FirstLanguageTipLine({ href }: { href: string }) {
  const { preferences: { firstLanguage } } = usePreferences();
  const tip = occasionalLanguageTip(firstLanguage, toLocalDate(new Date()), href);
  if (!tip) return null;
  return <p className="text-meta text-muted-foreground">Practice idea: {tip.text} Example: {tip.example} <Link className="underline" to="/exercises?tab=guides">More tips</Link></p>;
}
