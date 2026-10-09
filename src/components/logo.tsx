import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * The ClearPractice mark: an intonation line rising and falling from a start
 * point over a baseline (design/logo/b-intonation.svg). Same artwork as the app icon.
 */
export function Logo({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden className={cn("size-6 shrink-0", className)}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1f8463" />
          <stop offset="1" stopColor="#0e4a38" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="232" fill={`url(#${id})`} />
      <path d="M212 640C330 640 360 330 512 330S690 560 812 470" fill="none" stroke="#fff" strokeWidth="76" strokeLinecap="round" />
      <circle cx="212" cy="640" r="58" fill="#9fe3c3" />
      <path d="M212 790h600" stroke="#9fe3c3" strokeOpacity=".55" strokeWidth="40" strokeLinecap="round" />
    </svg>
  );
}
