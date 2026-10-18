import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { DrillPlan, PlanContext } from "@/features/drills/drill-module";
import { challengeForPlan } from "@/lib/social/codes";

export function ShareChallenge({ plan, ctx }: { plan: DrillPlan; ctx: PlanContext }) {
  const [challenge, setChallenge] = useState<{ plan: DrillPlan; ctx: PlanContext; code: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void challengeForPlan(plan, ctx).then((code) => {
      if (alive) setChallenge(code ? { plan, ctx, code } : null);
    });
    return () => { alive = false; };
  }, [plan, ctx]);
  const code = challenge?.plan === plan && challenge.ctx === ctx ? challenge.code : null;
  if (!code) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Try my ${plan.drill.title} challenge in ClearPractice: ${code}`);
      toast.success("Challenge copied.");
    } catch {
      toast.error("The clipboard isn't available here.");
    }
  };
  return <Button variant="outline" onClick={() => void copy()}><Copy aria-hidden /> Share challenge</Button>;
}
