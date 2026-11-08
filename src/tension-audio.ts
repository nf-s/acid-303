import { automatedTension, tensionDecaySeconds } from "./tension-model";
import type { TensionTrack } from "./tension-model";
import { scaleNotes, snapNote } from "./model";
import type { MusicalScale } from "./model";
import { automationStepCount, ticksPerStep } from "./timing";
import { midiFrequency, saturationSample } from "./audio";

interface Profile {
  ratios: number[];
  decay: number;
  stiffness: number;
  brightness: number;
  gain: number;
}
const profiles: Profile[] = [
  {
    ratios: [1, 2, 3, 4.02, 5.1, 6.17],
    decay: 1,
    stiffness: 0.018,
    brightness: 1,
    gain: 0.9,
  },
  {
    ratios: [1, 1.47, 2.09, 2.89, 3.79, 5.2],
    decay: 0.85,
    stiffness: 0.11,
    brightness: 0.85,
    gain: 0.72,
  },
  {
    ratios: [1, 2.76, 5.4, 8.93, 13.34, 18.64],
    decay: 0.5,
    stiffness: 0.01,
    brightness: 0.45,
    gain: 1.3,
  },
  {
    ratios: [1, 1.41, 2.07, 3.14, 4.59, 6.8],
    decay: 1,
    stiffness: 0.23,
    brightness: 0.7,
    gain: 0.78,
  },
  {
    ratios: [1, 2.3, 3.6, 5.1, 7.2, 9.4],
    decay: 0.65,
    stiffness: 0.04,
    brightness: 1.2,
    gain: 0.95,
  },
  {
    ratios: [1, 1.99, 3, 4.1, 5.2, 6.7],
    decay: 0.22,
    stiffness: 0.02,
    brightness: 0.2,
    gain: 1.65,
  },
];
function profileFor(sound: number): Profile {
  return (
    profiles[sound] ?? {
      ratios: [1, 2, 3, 4, 5, 6],
      decay: 1,
      stiffness: 0.02,
      brightness: 0.8,
      gain: 1,
    }
  );
}
function voiceDuration(track: TensionTrack): number {
  return (
    Math.max(
      0.08,
      tensionDecaySeconds(track.decay) * profileFor(track.sound).decay,
    ) + 0.03
  );
}
export function tensionTailDuration(track: TensionTrack): number {
  if (track.muted || !track.steps.some((step) => step.on && step.velocity > 0))
    return 0;
  let longest = 0;
  for (let index = 0; index < automationStepCount(track); index++)
    longest = Math.max(longest, voiceDuration(automatedTension(track, index)));
  return longest + 0.02;
}
interface Resonance {
  hold: ConstantSourceNode;
  excitation: AudioBufferSourceNode;
  envelope: GainNode;
  start: number;
  end: number;
}

/** Timed voice records enforce the same four-voice limit during live and offline scheduling. */
export class TensionInstrument {
  private readonly level: GainNode;
  private voices: Resonance[] = [];
  private stopped = false;
  private readonly curve: Float32Array<ArrayBuffer>;
  constructor(
    private readonly context: BaseAudioContext,
    output: AudioNode,
  ) {
    this.level = context.createGain();
    this.level.gain.value = 0.7;
    this.level.connect(output);
    this.curve = new Float32Array(1024);
    for (let index = 0; index < this.curve.length; index++)
      this.curve[index] = saturationSample(
        (index / (this.curve.length - 1)) * 2 - 1,
        0.75,
      );
  }
  scheduleTick(
    track: TensionTrack,
    logicalTick: number,
    time: number,
    _bpm: number,
    _swing: number,
    scale: MusicalScale,
  ): void {
    if (this.stopped || logicalTick % ticksPerStep(track.timing) !== 0) return;
    const absoluteStep = Math.floor(logicalTick / ticksPerStep(track.timing));
    const index = absoluteStep % track.steps.length;
    const step = track.steps[index],
      resolved = automatedTension(track, absoluteStep);
    if (!resolved.muted && step?.on && step.velocity > 0 && resolved.volume > 0)
      this.strike(
        resolved,
        snapNote(step.note, scale, 36, 84),
        step.velocity,
        time,
        scale,
        logicalTick,
      );
  }
  audition(
    track: TensionTrack,
    note: number,
    velocity: number,
    time: number,
    scale: MusicalScale,
  ): void {
    if (!this.stopped)
      this.strike(
        track,
        snapNote(note, scale, 36, 84),
        velocity,
        time,
        scale,
        0,
      );
  }
  private release(voice: Resonance, time: number): void {
    const end = Math.max(time + 0.008, voice.start + 0.001);
    voice.envelope.gain.cancelAndHoldAtTime(time);
    voice.envelope.gain.linearRampToValueAtTime(0, end);
    voice.hold.stop(end + 0.002);
    voice.excitation.stop(end);
    voice.end = Math.min(voice.end, end + 0.002);
  }
  private strike(
    track: TensionTrack,
    note: number,
    velocity: number,
    time: number,
    scale: MusicalScale,
    event: number,
  ): void {
    this.voices = this.voices.filter((voice) => voice.end > time);
    if (this.voices.length >= 4) {
      const oldest = this.voices.shift();
      if (oldest) this.release(oldest, time);
    }
    const context = this.context,
      profile = profileFor(track.sound),
      duration = voiceDuration(track),
      frequency = midiFrequency(note);
    const excitation = context.createBufferSource(),
      hold = context.createConstantSource(),
      envelope = context.createGain();
    const mix = context.createGain(),
      dry = context.createGain(),
      wet = context.createGain(),
      shaper = context.createWaveShaper(),
      low = context.createBiquadFilter();
    const burst = 0.004 + (1 - track.pick) * 0.014;
    const buffer = context.createBuffer(
        1,
        Math.ceil(context.sampleRate * burst),
        context.sampleRate,
      ),
      data = buffer.getChannelData(0);
    let seed = (track.seed ^ Math.imul(event + 1, 2654435761)) >>> 0,
      filtered = 0;
    for (let index = 0; index < data.length; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 2147483648 - 1;
      filtered = filtered * 0.7 + noise * 0.3;
      data[index] =
        (noise * profile.brightness + filtered * (1 - profile.brightness)) *
        Math.sin((index / Math.max(1, data.length - 1)) * Math.PI);
    }
    excitation.buffer = buffer;
    hold.offset.value = 0;
    hold.connect(mix);
    low.type = "lowpass";
    low.Q.value = 0.6;
    low.frequency.value = Math.min(
      context.sampleRate * 0.45,
      2000 + (1 - track.damping) * 14000,
    );
    excitation.connect(low);
    mix.connect(dry);
    mix.connect(shaper);
    shaper.curve = this.curve;
    shaper.connect(wet);
    dry.connect(envelope);
    wet.connect(envelope);
    envelope.connect(this.level);
    dry.gain.value = 1 - track.drive * 0.7;
    wet.gain.value = track.drive * 0.7;
    const nodes: AudioNode[] = [
      excitation,
      hold,
      envelope,
      mix,
      dry,
      wet,
      shaper,
      low,
    ];
    const modes = profile.ratios.map((ratio, index) => ({
      frequency:
        frequency *
        ratio *
        (index === 0
          ? 1
          : Math.sqrt(1 + profile.stiffness * track.tension ** 2 * index ** 2)),
      weight: 1,
      index,
    }));
    const sympathetic = scaleNotes(scale, note + 1, Math.min(108, note + 24));
    if (track.coupling > 0)
      for (let index = 0; index < 2; index++)
        modes.push({
          frequency: midiFrequency(
            sympathetic[index === 0 ? 1 : 3] ?? note + 12,
          ),
          weight: track.coupling * 0.3,
          index: 6 + index,
        });
    for (const mode of modes) {
      if (mode.frequency >= context.sampleRate * 0.45) continue;
      const filter = context.createBiquadFilter(),
        gain = context.createGain(),
        pan = context.createStereoPanner();
      const decay = Math.max(
        0.025,
        (duration - 0.03) / (1 + track.damping * mode.index * 1.6),
      );
      filter.type = "bandpass";
      filter.frequency.value = mode.frequency;
      filter.Q.value = Math.min(
        1800,
        Math.max(0.7, (Math.PI * mode.frequency * decay) / Math.log(1000)),
      );
      const pick =
        0.15 +
        0.85 *
          Math.abs(
            Math.sin(Math.PI * (mode.index + 1) * (0.05 + track.pick * 0.9)),
          );
      gain.gain.value =
        (profile.gain * 12 * mode.weight * pick * Math.sqrt(filter.Q.value)) /
        (Math.sqrt(modes.length) * (1 + mode.index * 0.45));
      pan.pan.value =
        (mode.index % 2 === 0 ? -1 : 1) *
        track.width *
        (0.35 + mode.index * 0.08);
      low.connect(filter);
      filter.connect(gain);
      gain.connect(pan);
      pan.connect(mix);
      nodes.push(filter, gain, pan);
    }
    const amplitude = track.volume * Math.max(0, Math.min(1, velocity)) * 0.75;
    envelope.gain.setValueAtTime(amplitude, time);
    envelope.gain.setValueAtTime(amplitude, time + duration - 0.025);
    envelope.gain.linearRampToValueAtTime(0, time + duration);
    const voice = {
      hold,
      excitation,
      envelope,
      start: time,
      end: time + duration + 0.002,
    };
    this.voices.push(voice);
    hold.onended = () => {
      for (const node of nodes) node.disconnect();
      this.voices = this.voices.filter((value) => value !== voice);
      hold.onended = null;
    };
    excitation.start(time);
    hold.start(time);
    hold.stop(voice.end);
  }
  stop(time = this.context.currentTime): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const voice of this.voices) this.release(voice, time);
    this.level.gain.cancelAndHoldAtTime(time);
    this.level.gain.linearRampToValueAtTime(0, time + 0.01);
  }
  silence(time = this.context.currentTime): void {
    for (const voice of this.voices) this.release(voice, time);
  }
  destroy(): void {
    this.stop();
    this.level.disconnect();
  }
}
