import type { ProjectMode } from "./mode";
import type { PreviewChord } from "./progression-model";

function frequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

/**
 * A soft, neutral chord used only to audition harmony: filtered saw/triangle in
 * Grain, sine/triangle in Fluff, with the chord root underneath. It never uses
 * an instrument's voices or shared racks, so playback is not disturbed.
 * Returns the time its last source stops.
 */
export function scheduleChordPreview(
  context: BaseAudioContext,
  output: AudioNode,
  chord: PreviewChord,
  mode: ProjectMode,
  time: number,
  hold: number,
  release: number,
): number {
  const fluff = mode === "fluff";
  const attack = fluff ? 0.03 : 0.015;
  const end = time + hold + release;
  const stop = end + 0.02;
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = fluff ? 3600 : 1900;
  filter.Q.value = 0.4;
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0, time);
  envelope.gain.linearRampToValueAtTime(1, time + attack);
  envelope.gain.setTargetAtTime(0.72, time + attack, hold * 0.6);
  envelope.gain.setTargetAtTime(0, time + hold, release / 5);
  filter.connect(envelope);
  envelope.connect(output);
  const level = 0.13 / Math.sqrt(Math.max(1, chord.notes.length));
  const waves: OscillatorType[] = fluff
    ? ["sine", "triangle"]
    : ["sawtooth", "triangle"];
  const sources: OscillatorNode[] = [];
  for (const note of chord.notes)
    waves.forEach((type, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency(note) * (fluff && index ? 2 : 1);
      oscillator.detune.value = index ? 5 : -5;
      gain.gain.value = level * (index ? (fluff ? 0.18 : 0.6) : 1);
      oscillator.connect(gain);
      gain.connect(filter);
      sources.push(oscillator);
    });
  const bass = context.createOscillator();
  const bassLevel = context.createGain();
  bass.type = fluff ? "sine" : "triangle";
  bass.frequency.value = frequency(chord.bass);
  bassLevel.gain.value = fluff ? 0.16 : 0.12;
  bass.connect(bassLevel);
  bassLevel.connect(envelope);
  sources.push(bass);
  for (const source of sources) {
    source.start(time);
    source.stop(stop);
  }
  const last = sources.at(-1);
  if (last)
    last.onended = () => {
      envelope.disconnect();
      filter.disconnect();
    };
  return stop;
}
