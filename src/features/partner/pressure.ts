/**
 * The pressure dial (roadmap 13.5): time limits, interruptions and a tougher
 * partner, raised step by step (stress inoculation; Meichenbaum 1985). The
 * partner's tone for each level is fixed text in the desktop app.
 */
export type PressureLevel = 0 | 1 | 2 | 3;

export type PressureDef = {
  level: PressureLevel;
  name: string;
  /** Your answer stops here; null keeps the clock for information only. */
  limitSeconds: number | null;
  /** A chime before the limit (high stakes). */
  chimeSeconds: number | null;
  /** The partner may cut in when an answer reaches its limit. */
  interrupts: boolean;
  description: string;
};

export const PRESSURE_LEVELS: readonly PressureDef[] = [
  { level: 0, name: "Relaxed", limitSeconds: null, chimeSeconds: null, interrupts: false,
    description: "No time limit; the clock is only for information. A warm, patient partner with simple follow-ups." },
  { level: 1, name: "Real", limitSeconds: 90, chimeSeconds: null, interrupts: false,
    description: "Answers stop at 90 seconds. A neutral partner who clarifies and challenges once in a while." },
  { level: 2, name: "Pressure", limitSeconds: 60, chimeSeconds: null, interrupts: true,
    description: "Answers stop at 60 seconds, and the partner may cut in. Brisk, with more challenges." },
  { level: 3, name: "High stakes", limitSeconds: 45, chimeSeconds: 40, interrupts: true,
    description: "A chime at 40 seconds, the answer stops at 45 and the partner interrupts. Sceptical: asks for numbers and examples." },
];

export const pressureDef = (level: number): PressureDef => PRESSURE_LEVELS[Math.min(3, Math.max(0, Math.round(level)))];
