/**
 * The chime.
 *
 * Generated with the Web Audio API — three oscillators and a gain envelope,
 * zero bytes fetched. No file in /public, so it works with the network down, it
 * cannot be blocked by a future Content-Security-Policy, and there is no decode
 * latency between the scan and the sound. In a warehouse the sound *is* the
 * confirmation: a person scanning a pallet is looking at the pallet, not at the
 * screen.
 *
 * Three tones, distinguishable without looking:
 *   ok    two rising blips — the scan landed
 *   warn  one flat mid tone — nothing was written, and nothing is wrong
 *         (already on this list, unknown barcode saved as unregistered)
 *   error one low tone with a downward slide — the server refused
 *
 * Peak gain is deliberately low. This runs a few hundred times an hour next to
 * somebody's head.
 */

export type Tone = "ok" | "warn" | "error";

type Blip = { at: number; hz: number; to?: number; ms: number };

const TONES: Record<Tone, Blip[]> = {
  ok: [
    { at: 0, hz: 880, ms: 60 },
    { at: 0.07, hz: 1320, ms: 60 },
  ],
  warn: [{ at: 0, hz: 660, ms: 110 }],
  error: [{ at: 0, hz: 220, to: 160, ms: 180 }],
};

const PEAK = 0.08;

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (context) return context;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  context = new Ctor();
  return context;
}

/**
 * Browsers start an AudioContext suspended until a real gesture. The audible
 * toggle's own click is that gesture; the scan panel also calls this on the
 * first pointer or key event, so arming the scanner arms the sound with it.
 */
export function unlockAudio(): void {
  const ctx = audioContext();
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

/** True once the context is actually running — the panel hints when it is not. */
export function audioReady(): boolean {
  return context?.state === "running";
}

export function playTone(tone: Tone): void {
  const ctx = audioContext();
  if (!ctx || ctx.state !== "running") return;

  const now = ctx.currentTime;
  for (const blip of TONES[tone]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = now + blip.at;
    const end = start + blip.ms / 1000;

    osc.type = "sine";
    osc.frequency.setValueAtTime(blip.hz, start);
    if (blip.to !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(blip.to, end);
    }

    // 5ms attack and an exponential release, so it reads as a chime rather than
    // the click a square-edged envelope makes.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(PEAK, start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

/**
 * A short buzz on a refusal, where the device has a motor.
 *
 * Guarded rather than assumed: `navigator.vibrate` is absent on iOS entirely,
 * and calling it there throws.
 */
export function buzz(): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate?.(40);
  }
}
