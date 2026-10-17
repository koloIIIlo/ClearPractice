/**
 * Short, quiet cue tones for recording start and stop (Settings → Audio →
 * Recording sounds), and the optional celebration chime. Generated with Web Audio, so there is no sound file to ship.
 * The start tone plays while the microphone is still opening, before capture.
 */
let context: AudioContext | null = null;

export function playCue(kind: "start" | "stop" | "celebrate" | "tick"): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    context ??= new Ctor();
    if (context.state === "suspended") void context.resume();
    const now = context.currentTime;
    // Rising pair to start, falling pair to stop.
    // A soft two-note chime for a celebration (9.10), quieter than the recording cues.
    // A single soft click confirms a Catch it press (11.6).
    const notes = kind === "start" ? [660, 880] : kind === "stop" ? [880, 660] : kind === "tick" ? [1320] : [784, 1047];
    const peak = kind === "tick" ? 0.05 : 0.12;
    notes.forEach((frequency, i) => {
      const osc = context!.createOscillator();
      const gain = context!.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      const t = now + i * 0.09;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      osc.connect(gain).connect(context!.destination);
      osc.start(t);
      osc.stop(t + 0.09);
    });
  } catch {
    // A missing audio output must never affect recording.
  }
}
