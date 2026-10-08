/**
 * Short, quiet cue tones for recording start and stop (Settings → Audio →
 * Recording sounds). Generated with Web Audio, so there is no sound file to ship.
 * The start tone plays while the microphone is still opening, before capture.
 */
let context: AudioContext | null = null;

export function playCue(kind: "start" | "stop"): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    context ??= new Ctor();
    if (context.state === "suspended") void context.resume();
    const now = context.currentTime;
    // Rising pair to start, falling pair to stop.
    const notes = kind === "start" ? [660, 880] : [880, 660];
    notes.forEach((frequency, i) => {
      const osc = context!.createOscillator();
      const gain = context!.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      const t = now + i * 0.09;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      osc.connect(gain).connect(context!.destination);
      osc.start(t);
      osc.stop(t + 0.09);
    });
  } catch {
    // A missing audio output must never affect recording.
  }
}
