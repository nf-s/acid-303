import { midiFrequency } from "./audio";
import { scaleNotes } from "./model";
import type { BassTrack, DrumTrack, KeysTrack, MusicalScale } from "./model";
import {
  cachedFluffDrum,
  fluffSampleTail,
  playFluffDrumSample,
} from "./fluff-drums";
import {
  FLUFF_REVERB_SECONDS,
  FluffPingPong,
  fluffGlue,
  fluffReverb,
} from "./fluff-effects";
import { FLUFF_LEAD_LEVELS, FLUFF_LEAD_PATCHES } from "./fluff-patches";
import type { MelodicControls, Patch } from "./fluff-patches";
import {
  FluffRack,
  createModulation,
  playSynthVoice,
  randomStream,
  setWave,
} from "./fluff-synth";
import type { Wave } from "./fluff-synth";
import type { FluffModulation } from "./fluff-synth";

const MIN_GAIN = 0.0001;
export const FLUFF_HALL_SECONDS = FLUFF_REVERB_SECONDS.hall;

type Source = OscillatorNode | AudioBufferSourceNode;

function softClipCurve(drive: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(1024);
  const amount = 1 + drive * 7;
  for (let index = 0; index < curve.length; index++) {
    const value = (index / (curve.length - 1)) * 2 - 1;
    curve[index] = Math.tanh(value * amount) / Math.tanh(amount);
  }
  return curve;
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(context: BaseAudioContext): AudioBuffer {
  const cached = noiseCache.get(context);
  if (cached) return cached;
  const buffer = context.createBuffer(
    1,
    Math.ceil(context.sampleRate * 2),
    context.sampleRate,
  );
  const data = buffer.getChannelData(0);
  let seed = 90210;
  for (let index = 0; index < data.length; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[index] = seed / 2147483648 - 1;
  }
  noiseCache.set(context, buffer);
  return buffer;
}

/**
 * Fluff's mix bus: kick-triggered ducking for everything melodic, a hall, a
 * plate for drums, and a tempo-synced ping-pong delay.
 */
export class FluffBus {
  readonly music: GainNode;
  readonly drums: GainNode;
  readonly hall: GainNode;
  readonly plate: GainNode;
  readonly delay: GainNode;
  /** The bass skips the melodic low cut and has its own, shorter duck. */
  readonly bass: GainNode;
  private readonly duck: GainNode;
  private readonly wetDuck: GainNode;
  private readonly bassDuck: GainNode;
  /** Vibrato, drift, filter and chorus LFOs shared by every melodic voice. */
  readonly modulation: FluffModulation;
  private readonly echo: FluffPingPong;
  private readonly lfos: OscillatorNode[] = [];
  private readonly nodes: AudioNode[] = [];
  private bpm = 0;

  constructor(
    private readonly context: BaseAudioContext,
    output: AudioNode,
    drumOutput: AudioNode,
    bpm: number,
  ) {
    const node = <T extends AudioNode>(created: T): T => {
      this.nodes.push(created);
      return created;
    };
    this.music = node(context.createGain());
    this.drums = node(context.createGain());
    this.hall = node(context.createGain());
    this.plate = node(context.createGain());
    this.delay = node(context.createGain());
    this.bass = node(context.createGain());
    this.duck = node(context.createGain());
    this.wetDuck = node(context.createGain());
    this.bassDuck = node(context.createGain());
    // Pads, leads and arps leave 40–150 Hz to the kick and bass.
    const lowCut = node(context.createBiquadFilter());
    lowCut.type = "highpass";
    lowCut.frequency.value = 150;
    lowCut.Q.value = 0.6;
    const makeup = node(context.createGain());
    makeup.gain.value = 1.3;
    this.music.connect(lowCut);
    lowCut.connect(makeup);
    fluffGlue(context, makeup, this.duck, this.nodes);
    this.duck.connect(output);
    this.wetDuck.connect(output);
    this.bass.connect(this.bassDuck);
    this.bassDuck.connect(output);
    this.drums.connect(drumOutput);

    // Reverb and echo returns are ducked a little less than the dry sound.
    fluffReverb(context, "hall", this.hall, this.wetDuck, 1.5, this.nodes);
    fluffReverb(context, "plate", this.plate, this.wetDuck, 1.2, this.nodes);
    const echo = node(context.createGain());
    const echoHall = node(context.createGain());
    echoHall.gain.value = 0.22;
    this.echo = new FluffPingPong(context, this.delay, echo, this.nodes);
    echo.connect(this.wetDuck);
    echo.connect(echoHall);
    echoHall.connect(this.hall);
    this.modulation = createModulation(context, this.nodes, this.lfos);
    this.setTempo(bpm, context.currentTime);
  }

  setTempo(bpm: number, time: number): void {
    if (bpm === this.bpm || bpm <= 0) return;
    const immediate = this.bpm === 0;
    this.bpm = bpm;
    // Dotted eighths on each side make the repeats land between the beats.
    this.echo.setTime(Math.min(1.9, (60 / bpm) * 0.75), time, immediate);
  }

  /**
   * Dip the melodic bus on a kick, then let it swell back before the next
   * beat. The bass always ducks briefly so the kick and sub never sum, even
   * with Pump at zero; Pump only deepens it.
   */
  pump(time: number, depth: number, bpm: number): void {
    const beat = 60 / Math.max(1, bpm);
    const dip = (
      gain: AudioParam,
      amount: number,
      hold: number,
      recovery: number,
    ): void => {
      gain.cancelAndHoldAtTime(time);
      gain.linearRampToValueAtTime(1 - amount, time + 0.006);
      gain.setTargetAtTime(1, time + 0.006 + beat * hold, beat * recovery);
    };
    dip(this.bassDuck.gain, Math.min(0.9, 0.55 + depth * 0.4), 0.13, 0.06);
    if (depth <= 0) return;
    const amount = Math.min(0.92, depth * 0.92);
    dip(this.duck.gain, amount, 0.08, 0.15);
    dip(this.wetDuck.gain, amount * 0.45, 0.08, 0.15);
  }

  /** An instrument channel with fixed hall and delay sends. */
  channel(hall: number, delay: number): GainNode {
    const input = this.context.createGain();
    const hallSend = this.context.createGain();
    const delaySend = this.context.createGain();
    hallSend.gain.value = hall;
    delaySend.gain.value = delay;
    input.connect(this.music);
    input.connect(hallSend);
    input.connect(delaySend);
    hallSend.connect(this.hall);
    delaySend.connect(this.delay);
    this.nodes.push(input, hallSend, delaySend);
    return input;
  }

  destroy(): void {
    for (const lfo of this.lfos) {
      lfo.stop();
      lfo.disconnect();
    }
    for (const node of this.nodes) node.disconnect();
  }
}

export interface FluffNote {
  patch: Patch;
  frequency: number;
  /** Extra chord tones for stacked patches. */
  chord?: readonly number[];
  time: number;
  /** Seconds the note is held before its release. */
  gate: number;
  controls: MelodicControls;
  level: number;
  pan: number;
  accent: boolean;
}
export interface FluffVoice {
  end: number;
  stop(time: number): void;
}

/** One polyphonic Fluff voice: the patch's sound through the instrument's rack. */
export function playFluffNote(
  context: BaseAudioContext,
  rack: FluffRack,
  note: FluffNote,
): FluffVoice {
  const spec = note.patch.voice(note.controls);
  return playSynthVoice(context, rack, rack.input, {
    spec: { ...spec, level: spec.level * note.level },
    frequencies: [note.frequency, ...(note.chord ?? [])],
    time: note.time,
    gate: note.gate,
    accent: note.accent,
    width: note.controls.width,
    pan: note.pan,
    seed: Math.round(note.time * 9973 + note.frequency * 31),
  });
}

type BassWave = Wave;
interface BassTone {
  wave: BassWave;
  ratio: number;
  level: number;
  /** Cents at full Shape. */
  detune: number;
}
interface FluffBassProfile {
  /** Clean sine sub, always folded into 40–80 Hz whatever note is written. */
  sub: number;
  /** Level the sub settles to while the note is held. */
  subSustain: number;
  /** The mid layer, high-passed above the sub so the two never fight. */
  mid: number;
  tones: readonly [BassTone, BassTone, BassTone, BassTone];
  fm: number;
  fmRatio: number;
  drive: number;
  /** Multiplier on the Cutoff control. */
  cutoff: number;
  /** How far the cutoff follows the note (0–1), around A2. */
  keyTrack: number;
  /** Filter envelope depth in octaves at full Envelope. */
  envelope: number;
  /** Filter decay as a multiple of the Decay control. */
  filterDecay: number;
  /** Multiplier on the Resonance control. */
  resonance: number;
  /** Cents of slow filter movement at full Shape. */
  lfo: number;
  attack: number;
  /** Level the mid layer decays to while held. */
  sustain: number;
  /** Mid-layer decay as a multiple of the Decay control. */
  decay: number;
  release: number;
  /** Semitones the note falls from at its start. */
  bend: number;
}

const SAW: BassWave = "saw";
const SILENT: BassTone = { wave: "sine", ratio: 1, level: 0, detune: 0 };
/** Sub, Offbeat, Rolling, Pluck, Long, Reese, Organ, FM, Growl, Warm, Garage. */
const FLUFF_BASSES: readonly FluffBassProfile[] = [
  {
    // A sine sub with a soft triangle and low harmonics so it reads on small speakers.
    sub: 1,
    subSustain: 0.95,
    mid: 0.45,
    tones: [
      { wave: "triangle", ratio: 1, level: 0.6, detune: 0 },
      { wave: "sine", ratio: 2, level: 0.4, detune: 0 },
      { wave: "sine", ratio: 3, level: 0.12, detune: 0 },
      SILENT,
    ],
    fm: 0,
    fmRatio: 1,
    drive: 0.25,
    cutoff: 1,
    keyTrack: 0.3,
    envelope: 0.4,
    filterDecay: 1,
    resonance: 0.2,
    lfo: 0,
    attack: 0.006,
    sustain: 0.85,
    decay: 1.5,
    release: 0.07,
    bend: 0,
  },
  {
    // Trance offbeat: two detuned saws, an octave saw and a square, plucked open.
    sub: 0.95,
    subSustain: 0.85,
    mid: 0.8,
    tones: [
      { wave: SAW, ratio: 1, level: 0.5, detune: -10 },
      { wave: SAW, ratio: 1, level: 0.5, detune: 10 },
      { wave: SAW, ratio: 2, level: 0.14, detune: 4 },
      { wave: "square", ratio: 1, level: 0.2, detune: 0 },
    ],
    fm: 0,
    fmRatio: 1,
    drive: 0.3,
    cutoff: 1.1,
    keyTrack: 0.5,
    envelope: 2.2,
    filterDecay: 0.55,
    resonance: 0.8,
    lfo: 0,
    attack: 0.003,
    sustain: 0.45,
    decay: 1,
    release: 0.04,
    bend: 0,
  },
  {
    // Rolling progressive mid-bass: saw and square a few cents apart through a 24 dB filter.
    sub: 0.95,
    subSustain: 0.7,
    mid: 0.75,
    tones: [
      { wave: SAW, ratio: 1, level: 0.6, detune: -4 },
      { wave: "square", ratio: 1, level: 0.35, detune: 5 },
      { wave: SAW, ratio: 2, level: 0.1, detune: -4 },
      { wave: SAW, ratio: 1, level: 0.25, detune: 9 },
    ],
    fm: 0,
    fmRatio: 1,
    drive: 0.3,
    cutoff: 1,
    keyTrack: 0.5,
    envelope: 2.5,
    filterDecay: 0.45,
    resonance: 1,
    lfo: 0,
    attack: 0.002,
    sustain: 0.3,
    decay: 0.8,
    release: 0.03,
    bend: 0,
  },
  {
    // Pluck bass: a short, deep filter fall over detuned saws.
    sub: 1,
    subSustain: 0.85,
    mid: 0.85,
    tones: [
      { wave: SAW, ratio: 1, level: 0.5, detune: -8 },
      { wave: SAW, ratio: 1, level: 0.5, detune: 8 },
      { wave: "square", ratio: 2, level: 0.12, detune: 0 },
      SILENT,
    ],
    fm: 0,
    fmRatio: 1,
    drive: 0.15,
    cutoff: 0.9,
    keyTrack: 0.5,
    envelope: 3.2,
    filterDecay: 0.35,
    resonance: 1.2,
    lfo: 0,
    attack: 0.002,
    sustain: 0.12,
    decay: 1,
    release: 0.05,
    bend: 0,
  },
  {
    // Long gated saws that breathe with a slow filter drift.
    sub: 0.95,
    subSustain: 1,
    mid: 0.7,
    tones: [
      { wave: SAW, ratio: 1, level: 0.5, detune: -11 },
      { wave: SAW, ratio: 1, level: 0.5, detune: 11 },
      { wave: SAW, ratio: 2, level: 0.15, detune: 6 },
      { wave: SAW, ratio: 1, level: 0.3, detune: 0 },
    ],
    fm: 0,
    fmRatio: 1,
    drive: 0.2,
    cutoff: 1.1,
    keyTrack: 0.4,
    envelope: 1.2,
    filterDecay: 1.4,
    resonance: 0.7,
    lfo: 450,
    attack: 0.008,
    sustain: 0.85,
    decay: 1.6,
    release: 0.1,
    bend: 0,
  },
  {
    // Reese: three saws drifting against each other, a square for body, slow filter movement.
    sub: 1,
    subSustain: 1,
    mid: 0.72,
    tones: [
      { wave: SAW, ratio: 1, level: 0.5, detune: -17 },
      { wave: SAW, ratio: 1, level: 0.5, detune: 17 },
      { wave: SAW, ratio: 1, level: 0.35, detune: -5 },
      { wave: "square", ratio: 1, level: 0.2, detune: 7 },
    ],
    fm: 0,
    fmRatio: 1,
    drive: 0.4,
    cutoff: 0.9,
    keyTrack: 0.3,
    envelope: 0.6,
    filterDecay: 1.5,
    resonance: 0.6,
    lfo: 600,
    attack: 0.01,
    sustain: 0.95,
    decay: 2,
    release: 0.1,
    bend: 0,
  },
  {
    // House organ bass: drawbar partials with a quick decay and a little click.
    sub: 0.85,
    subSustain: 0.6,
    mid: 0.8,
    tones: [
      { wave: "sine", ratio: 2, level: 0.6, detune: 0 },
      { wave: "sine", ratio: 3, level: 0.38, detune: 0 },
      { wave: "sine", ratio: 4, level: 0.3, detune: 0 },
      { wave: "sine", ratio: 8, level: 0.08, detune: 0 },
    ],
    fm: 0,
    fmRatio: 1,
    drive: 0.2,
    cutoff: 3,
    keyTrack: 0.3,
    envelope: 0.5,
    filterDecay: 0.5,
    resonance: 0.3,
    lfo: 0,
    attack: 0.002,
    sustain: 0.45,
    decay: 0.9,
    release: 0.06,
    bend: 0,
  },
  {
    // Deep house FM bass: an octave sine with a decaying FM bite over a triangle.
    sub: 0.85,
    subSustain: 0.5,
    mid: 0.75,
    tones: [
      { wave: "sine", ratio: 2, level: 0.7, detune: 0 },
      { wave: "triangle", ratio: 1, level: 0.3, detune: 0 },
      { wave: "sine", ratio: 4, level: 0.1, detune: 0 },
      SILENT,
    ],
    fm: 2.2,
    fmRatio: 1,
    drive: 0.2,
    cutoff: 2.5,
    keyTrack: 0.5,
    envelope: 1,
    filterDecay: 0.5,
    resonance: 0.6,
    lfo: 0,
    attack: 0.001,
    sustain: 0.2,
    decay: 0.7,
    release: 0.04,
    bend: 0,
  },
  {
    // Dark melodic house growl: driven saw and square, resonant, an octave saw on top.
    sub: 1,
    subSustain: 0.9,
    mid: 0.7,
    tones: [
      { wave: SAW, ratio: 1, level: 0.55, detune: -6 },
      { wave: "square", ratio: 1, level: 0.4, detune: 6 },
      { wave: SAW, ratio: 2, level: 0.12, detune: 0 },
      { wave: "pulse", ratio: 1, level: 0.2, detune: 12 },
    ],
    fm: 0,
    fmRatio: 1,
    drive: 0.6,
    cutoff: 0.8,
    keyTrack: 0.4,
    envelope: 1.6,
    filterDecay: 0.9,
    resonance: 1.4,
    lfo: 250,
    attack: 0.004,
    sustain: 0.6,
    decay: 1.2,
    release: 0.06,
    bend: 0,
  },
  {
    // Warm round bass: triangle and octave sine with a hint of saw.
    sub: 1,
    subSustain: 0.85,
    mid: 0.6,
    tones: [
      { wave: "triangle", ratio: 1, level: 0.6, detune: 0 },
      { wave: "sine", ratio: 2, level: 0.4, detune: 0 },
      { wave: SAW, ratio: 1, level: 0.12, detune: 5 },
      SILENT,
    ],
    fm: 0,
    fmRatio: 1,
    drive: 0.3,
    cutoff: 0.8,
    keyTrack: 0.4,
    envelope: 0.8,
    filterDecay: 0.8,
    resonance: 0.4,
    lfo: 0,
    attack: 0.006,
    sustain: 0.6,
    decay: 1.2,
    release: 0.07,
    bend: 0,
  },
  {
    // UK garage: a bendy square with light FM and an octave sine.
    sub: 0.9,
    subSustain: 0.7,
    mid: 0.8,
    tones: [
      { wave: "square", ratio: 1, level: 0.5, detune: 0 },
      { wave: SAW, ratio: 1, level: 0.35, detune: 6 },
      { wave: "sine", ratio: 2, level: 0.2, detune: 0 },
      SILENT,
    ],
    fm: 0.6,
    fmRatio: 1,
    drive: 0.3,
    cutoff: 1.1,
    keyTrack: 0.5,
    envelope: 2,
    filterDecay: 0.5,
    resonance: 1,
    lfo: 0,
    attack: 0.002,
    sustain: 0.4,
    decay: 0.9,
    release: 0.04,
    bend: 3,
  },
];
/** Per-slot trims that level every bass patch against the kick. */
const FLUFF_BASS_LEVELS: readonly number[] = [
  1.09, 1.16, 1.2, 1.07, 1.09, 1.01, 1.08, 1.29, 0.99, 1.08, 1.17,
];

/** Fold any note into the sub octave so every pattern has weight at 40–80 Hz. */
function subFrequency(frequency: number): number {
  let value = frequency;
  while (value >= 80) value /= 2;
  while (value < 40) value *= 2;
  return value;
}

const saturationCache = new WeakMap<
  BaseAudioContext,
  Float32Array<ArrayBuffer>
>();
function bassSaturation(context: BaseAudioContext): Float32Array<ArrayBuffer> {
  const cached = saturationCache.get(context);
  if (cached) return cached;
  const curve = softClipCurve(0.4);
  saturationCache.set(context, curve);
  return curve;
}

/**
 * Fluff's monophonic bass: a clean, mono sine sub folded into 40–80 Hz plus a
 * driven, filtered mid layer that is high-passed above the sub. Held steps
 * tie into one note and glide when the pitch changes.
 */
export class FluffBass {
  private readonly sub: OscillatorNode;
  private readonly subGain: GainNode;
  private readonly tones: Array<{
    oscillator: OscillatorNode;
    gain: GainNode;
    ratio: number;
  }> = [];
  private readonly modulator: OscillatorNode;
  private readonly modulation: GainNode;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly lowpass: readonly [BiquadFilterNode, BiquadFilterNode];
  private readonly highpass: BiquadFilterNode;
  private readonly lfo: GainNode;
  private readonly slow: AudioNode;
  private readonly midGain: GainNode;
  private readonly level: GainNode;
  private readonly sources: OscillatorNode[] = [];
  private readonly nodes: AudioNode[] = [];
  private noteEnd = 0;
  private firstStep = true;

  constructor(
    private readonly context: BaseAudioContext,
    bus: FluffBus,
    registry: Set<OscillatorNode | AudioBufferSourceNode>,
  ) {
    const gain = (value: number): GainNode => {
      const created = context.createGain();
      created.gain.value = value;
      this.nodes.push(created);
      return created;
    };
    const filter = (type: BiquadFilterType): BiquadFilterNode => {
      const created = context.createBiquadFilter();
      created.type = type;
      this.nodes.push(created);
      return created;
    };
    this.level = gain(0);
    this.level.connect(bus.bass);
    this.sub = context.createOscillator();
    this.sub.type = "sine";
    this.subGain = gain(0);
    this.sub.connect(this.subGain);
    this.subGain.connect(this.level);
    this.sources.push(this.sub);

    const mix = gain(1);
    this.modulator = context.createOscillator();
    this.modulation = gain(0);
    this.modulator.connect(this.modulation);
    this.sources.push(this.modulator);
    for (let index = 0; index < 4; index++) {
      const oscillator = context.createOscillator();
      const level = gain(0);
      oscillator.connect(level);
      level.connect(mix);
      this.modulation.connect(oscillator.frequency);
      this.tones.push({ oscillator, gain: level, ratio: 1 });
      this.sources.push(oscillator);
    }
    this.dry = gain(1);
    this.wet = gain(0);
    const shaper = context.createWaveShaper();
    shaper.curve = bassSaturation(context);
    shaper.oversample = "2x";
    this.nodes.push(shaper);
    mix.connect(this.dry);
    mix.connect(shaper);
    shaper.connect(this.wet);
    this.lowpass = [filter("lowpass"), filter("lowpass")];
    this.highpass = filter("highpass");
    this.highpass.Q.value = 0.6;
    this.dry.connect(this.lowpass[0]);
    this.wet.connect(this.lowpass[0]);
    this.lowpass[0].connect(this.lowpass[1]);
    this.lowpass[1].connect(this.highpass);
    // Slow filter movement for long and Reese basses.
    this.slow = bus.modulation.slow;
    this.lfo = gain(0);
    this.slow.connect(this.lfo);
    for (const lowpass of this.lowpass) this.lfo.connect(lowpass.detune);
    this.midGain = gain(0);
    this.highpass.connect(this.midGain);
    this.midGain.connect(this.level);

    let remaining = this.sources.length;
    for (const source of this.sources) {
      registry.add(source);
      source.onended = () => {
        registry.delete(source);
        source.disconnect();
        remaining--;
        if (remaining !== 0) return;
        this.slow.disconnect(this.lfo);
        for (const node of this.nodes) node.disconnect();
      };
      source.start();
    }
  }

  schedule(
    track: BassTrack,
    stepIndex: number,
    time: number,
    duration: number,
  ): void {
    const target = track.muted ? 0 : track.volume;
    this.level.gain.cancelAndHoldAtTime(time);
    if (this.firstStep) this.level.gain.setValueAtTime(target, time);
    else this.level.gain.setTargetAtTime(target, time, 0.004);
    this.firstStep = false;
    const step = track.steps[stepIndex];
    if (!step?.on || track.muted) return;
    const count = track.steps.length;
    const previous = track.steps[(stepIndex - 1 + count) % count];
    // A held or gliding step continues the sounding note.
    if (
      previous?.on === true &&
      previous.slide &&
      count > 1 &&
      this.noteEnd > time
    ) {
      if (previous.note !== step.note)
        this.glide(step.note, time, Math.min(0.08, duration * 0.6));
      return;
    }
    let held = 1;
    let cursor = step;
    while (held < count && cursor.slide) {
      const next = track.steps[(stepIndex + held) % count];
      if (!next?.on) break;
      cursor = next;
      held++;
    }
    const gate = duration * (held - 1 + 0.45 + track.pulse * 0.55);
    this.trigger(track, step.note, step.accent, time, gate);
  }

  private glide(note: number, time: number, seconds: number): void {
    const frequency = midiFrequency(note);
    const ramp = (parameter: AudioParam, value: number): void => {
      parameter.cancelAndHoldAtTime(time);
      parameter.exponentialRampToValueAtTime(value, time + seconds);
    };
    ramp(this.sub.frequency, subFrequency(frequency));
    for (const tone of this.tones)
      ramp(tone.oscillator.frequency, frequency * tone.ratio);
  }

  private trigger(
    track: BassTrack,
    note: number,
    accent: boolean,
    time: number,
    gate: number,
  ): void {
    const profile = FLUFF_BASSES[track.sound] ?? FLUFF_BASSES[0];
    if (!profile) return;
    const frequency = midiFrequency(note);
    const sub = subFrequency(frequency);
    // A 3 ms dip before each new note avoids clicks on the persistent oscillators.
    const start = time + 0.003;
    const bend = 2 ** (profile.bend / 12);
    const pitch = (parameter: AudioParam, value: number): void => {
      parameter.cancelAndHoldAtTime(time);
      parameter.setValueAtTime(value * bend, start);
      if (bend !== 1)
        parameter.exponentialRampToValueAtTime(value, start + 0.05);
    };
    pitch(this.sub.frequency, sub);
    const shape = track.shape;
    const levels = profile.tones.map((tone, index) =>
      index === 0 ? tone.level : tone.level * (0.4 + shape * 1.2),
    );
    const total = Math.max(
      MIN_GAIN,
      levels.reduce((sum, value) => sum + value, 0),
    );
    const drift = randomStream(Math.round(time * 1000));
    this.tones.forEach((tone, index) => {
      const configuration = profile.tones[index];
      if (!configuration) return;
      setWave(this.context, tone.oscillator, configuration.wave);
      tone.ratio = configuration.ratio;
      // A few cents of random drift per note keeps repeated notes from sounding identical.
      tone.oscillator.detune.setValueAtTime(
        configuration.detune * (0.3 + shape * 1.4) + (drift() - 0.5) * 4,
        start,
      );
      tone.gain.gain.setValueAtTime((levels[index] ?? 0) / total, start);
      pitch(tone.oscillator.frequency, frequency * configuration.ratio);
    });
    pitch(this.modulator.frequency, frequency * profile.fmRatio);
    const modulation = this.modulation.gain;
    modulation.cancelAndHoldAtTime(time);
    if (profile.fm > 0) {
      const depth =
        frequency * profile.fm * (0.4 + shape) * (0.3 + track.envelope);
      modulation.setValueAtTime(depth, start);
      modulation.setTargetAtTime(
        depth * 0.06,
        start,
        Math.max(0.01, track.decay * 0.12),
      );
    } else modulation.setValueAtTime(0, start);

    const drive = 1 - (1 - profile.drive) * (1 - track.drive);
    this.dry.gain.setValueAtTime(1 - drive, start);
    this.wet.gain.setValueAtTime(drive * 0.9, start);
    this.highpass.frequency.setValueAtTime(Math.max(85, sub * 1.6), start);

    const tracked = (frequency / 110) ** profile.keyTrack;
    const base = Math.max(
      40,
      Math.min(12000, track.cutoff * profile.cutoff * tracked),
    );
    this.lfo.gain.setTargetAtTime(profile.lfo * (0.3 + shape), start, 0.05);
    const octaves =
      track.envelope * profile.envelope * (0.5 + shape) + (accent ? 0.8 : 0);
    const peak = Math.min(16000, base * 2 ** octaves);
    const filterDecay = Math.max(0.02, track.decay * profile.filterDecay);
    this.lowpass.forEach((filter, index) => {
      filter.Q.setValueAtTime(
        index === 0 ? 0.7 + track.resonance * profile.resonance * 0.14 : 0.6,
        start,
      );
      filter.frequency.cancelAndHoldAtTime(time);
      filter.frequency.setValueAtTime(peak, start);
      filter.frequency.setTargetAtTime(base, start, filterDecay / 3);
    });

    const boost = accent ? 1.25 : 1;
    const envelope = (
      parameter: AudioParam,
      peakLevel: number,
      attack: number,
      sustain: number,
      fall: number,
      release: number,
    ): number => {
      const hold = Math.max(start + attack + 0.005, time + gate);
      parameter.cancelAndHoldAtTime(time);
      parameter.linearRampToValueAtTime(0, start);
      parameter.linearRampToValueAtTime(peakLevel, start + attack);
      parameter.setTargetAtTime(peakLevel * sustain, start + attack, fall / 3);
      parameter.cancelAndHoldAtTime(hold);
      parameter.setTargetAtTime(0, hold, release / 4);
      parameter.cancelAndHoldAtTime(hold + release);
      parameter.linearRampToValueAtTime(0, hold + release + 0.004);
      return hold + release + 0.004;
    };
    const trim = FLUFF_BASS_LEVELS[track.sound] ?? 1;
    const subEnd = envelope(
      this.subGain.gain,
      profile.sub * trim * boost * 0.36,
      Math.max(0.004, profile.attack),
      profile.subSustain,
      Math.max(0.05, track.decay * 2),
      Math.max(0.03, profile.release),
    );
    const midEnd = envelope(
      this.midGain.gain,
      profile.mid * trim * boost * 0.62,
      profile.attack,
      profile.sustain,
      Math.max(0.02, track.decay * profile.decay),
      profile.release,
    );
    this.noteEnd = Math.max(subEnd, midEnd);
  }

  stop(time = this.context.currentTime): void {
    for (const parameter of [this.subGain.gain, this.midGain.gain]) {
      parameter.cancelAndHoldAtTime(time);
      parameter.linearRampToValueAtTime(0, time + 0.008);
    }
    this.noteEnd = 0;
    for (const source of this.sources) source.stop(time + 0.012);
  }
}

export function fluffLeadTail(track: KeysTrack): number {
  if (track.muted) return 0;
  // Bells and pianos ring for up to about three times Decay.
  return track.decay * 3.4 + 0.5;
}

/** The Lead instrument: Texture's steps voiced as held, tied melodic notes. */
export class FluffLead {
  private readonly level: GainNode;
  private readonly hall: GainNode;
  private readonly delay: GainNode;
  private readonly rack: FluffRack;
  private readonly voices = new Set<FluffVoice>();
  private firstStep = true;

  constructor(
    private readonly context: BaseAudioContext,
    bus: FluffBus,
  ) {
    this.level = context.createGain();
    this.level.gain.value = 0;
    this.rack = new FluffRack(context, bus.modulation);
    this.rack.output.connect(this.level);
    this.hall = context.createGain();
    this.delay = context.createGain();
    this.hall.gain.value = 0;
    this.delay.gain.value = 0;
    this.level.connect(bus.music);
    this.level.connect(this.hall);
    this.level.connect(this.delay);
    this.hall.connect(bus.hall);
    this.delay.connect(bus.delay);
  }

  schedule(
    track: KeysTrack,
    stepIndex: number,
    time: number,
    duration: number,
    scale: MusicalScale,
  ): void {
    const target = track.muted ? 0 : track.volume * 1.15;
    this.level.gain.cancelAndHoldAtTime(time);
    if (this.firstStep) this.level.gain.setValueAtTime(target, time);
    else this.level.gain.setTargetAtTime(target, time, 0.004);
    this.firstStep = false;
    this.hall.gain.setTargetAtTime(0.1 + track.space * 0.75, time, 0.02);
    this.delay.gain.setTargetAtTime(track.space * 0.55, time, 0.02);
    const step = track.steps[stepIndex];
    if (!step?.on || track.muted) return;
    const count = track.steps.length;
    const previous = track.steps[(stepIndex - 1 + count) % count];
    const tiedIn = previous?.on === true && previous.slide;
    // A tie into the same pitch extends the earlier note instead of restriking.
    if (tiedIn && previous.note === step.note && count > 1) return;
    let held = 1;
    let cursor = step;
    while (held < count && cursor.slide) {
      const next = track.steps[(stepIndex + held) % count];
      if (!next?.on || next.note !== step.note) break;
      cursor = next;
      held++;
    }
    const legato =
      cursor.slide && track.steps[(stepIndex + held) % count]?.on === true;
    this.play(
      track,
      step.note,
      step.accent,
      time,
      duration * held * (legato ? 1.04 : 0.92),
      scale,
      tiedIn,
    );
  }

  /** Audition or sequence one note through this instrument's sends. */
  play(
    track: KeysTrack,
    midi: number,
    accent: boolean,
    time: number,
    gate: number,
    scale: MusicalScale,
    legato = false,
  ): void {
    const patch = FLUFF_LEAD_PATCHES[track.sound] ?? FLUFF_LEAD_PATCHES[0];
    if (!patch) return;
    for (const voice of this.voices)
      if (voice.end <= time) this.voices.delete(voice);
    const steps = patch.chord;
    const chord = steps
      ? scaleNotes(scale, midi, midi + 24)
          .filter((_, index) => steps.includes(index))
          .map(midiFrequency)
      : undefined;
    const controls: MelodicControls = {
      tone: track.tone,
      decay: track.decay,
      attack: track.attack ** 2 * 0.6 + (legato ? 0.03 : 0),
      resonance: 0.2,
      shape: track.width,
      width: track.width,
      motion: track.motion,
      grit: track.grit,
    };
    this.rack.set(patch.rack(controls), time);
    this.voices.add(
      playFluffNote(this.context, this.rack, {
        patch,
        frequency: midiFrequency(midi),
        chord,
        time,
        gate,
        controls,
        level: FLUFF_LEAD_LEVELS[track.sound] ?? 1,
        pan: 0,
        accent,
      }),
    );
  }

  preview(track: KeysTrack, time: number): void {
    this.level.gain.cancelAndHoldAtTime(time);
    this.level.gain.setValueAtTime(track.volume * 1.15, time);
    this.hall.gain.setValueAtTime(0.1 + track.space * 0.75, time);
    this.delay.gain.setValueAtTime(track.space * 0.55, time);
    this.firstStep = true;
  }

  stop(time = this.context.currentTime): void {
    for (const voice of this.voices) voice.stop(time);
    this.voices.clear();
  }

  destroy(): void {
    this.stop();
    this.rack.destroy();
    for (const node of [this.level, this.hall, this.delay]) node.disconnect();
  }
}

interface KickProfile {
  /** Target fundamental; the kick is tuned to the nearest root note. */
  floor: number;
  /** Starting pitch as a multiple of the fundamental. */
  from: number;
  /** Seconds for the pitch to fall to just above the fundamental. */
  sweep: number;
  /** Seconds the body stays near full level before its tail. */
  hold: number;
  /** Tail length as a multiple of the Decay control. */
  length: number;
  click: number;
  clickFrequency: number;
  /** Short upper-harmonic knock that keeps the kick audible on small speakers. */
  knock: number;
  drive: number;
  level: number;
  lowpass: number;
}
/** Trance, Prog, Deep, Tight, Breaks, Boom, Dusty. */
const KICKS: readonly KickProfile[] = [
  {
    floor: 54,
    from: 5,
    sweep: 0.028,
    hold: 0.055,
    length: 1.2,
    click: 0.3,
    clickFrequency: 3400,
    knock: 0.22,
    drive: 0.12,
    level: 0.84,
    lowpass: 0,
  },
  {
    floor: 50,
    from: 4.2,
    sweep: 0.034,
    hold: 0.065,
    length: 1.35,
    click: 0.16,
    clickFrequency: 2400,
    knock: 0.18,
    drive: 0.08,
    level: 0.84,
    lowpass: 0,
  },
  {
    floor: 48,
    from: 3.2,
    sweep: 0.04,
    hold: 0.06,
    length: 1.4,
    click: 0.06,
    clickFrequency: 1600,
    knock: 0.12,
    drive: 0.04,
    level: 0.84,
    lowpass: 3200,
  },
  {
    floor: 56,
    from: 5,
    sweep: 0.024,
    hold: 0.04,
    length: 0.9,
    click: 0.28,
    clickFrequency: 3800,
    knock: 0.25,
    drive: 0.1,
    level: 0.82,
    lowpass: 0,
  },
  {
    floor: 58,
    from: 3.6,
    sweep: 0.03,
    hold: 0.045,
    length: 0.95,
    click: 0.3,
    clickFrequency: 1900,
    knock: 0.32,
    drive: 0.12,
    level: 0.82,
    lowpass: 0,
  },
  {
    floor: 46,
    from: 3.4,
    sweep: 0.05,
    hold: 0.09,
    length: 2.2,
    click: 0.1,
    clickFrequency: 2200,
    knock: 0.2,
    drive: 0.1,
    level: 0.84,
    lowpass: 0,
  },
  {
    floor: 52,
    from: 3,
    sweep: 0.04,
    hold: 0.05,
    length: 1.1,
    click: 0.2,
    clickFrequency: 1200,
    knock: 0.22,
    drive: 0.25,
    level: 0.77,
    lowpass: 2400,
  },
];

/**
 * The root or fifth nearest a target pitch, so the kick sits in the track's
 * key without straying more than a few semitones from its designed tuning.
 */
function rootNear(scale: MusicalScale, target: number): number {
  let best = target;
  let distance = Infinity;
  for (let octave = 0; octave < 4; octave++)
    for (const interval of [0, 7]) {
      const frequency = midiFrequency(
        12 * (octave + 1) + scale.root + interval,
      );
      const gap = Math.abs(Math.log2(frequency / target));
      if (gap < distance) {
        distance = gap;
        best = frequency;
      }
    }
  return best;
}

interface SnareProfile {
  tones: readonly [number, number];
  toneLevel: number;
  highpass: number;
  lowpass: number;
  noise: number;
  length: number;
  hall: number;
  drive: number;
}
/** House, Break, Garage, Dusty, Roll, Ghost, Fat. */
const SNARES: readonly SnareProfile[] = [
  {
    tones: [195, 320],
    toneLevel: 0.55,
    highpass: 650,
    lowpass: 9000,
    noise: 0.5,
    length: 0.85,
    hall: 0.05,
    drive: 0.1,
  },
  {
    tones: [178, 285],
    toneLevel: 0.72,
    highpass: 480,
    lowpass: 7600,
    noise: 0.58,
    length: 0.8,
    hall: 0.04,
    drive: 0.35,
  },
  {
    tones: [225, 370],
    toneLevel: 0.5,
    highpass: 850,
    lowpass: 9500,
    noise: 0.55,
    length: 0.55,
    hall: 0.04,
    drive: 0.15,
  },
  {
    tones: [182, 280],
    toneLevel: 0.6,
    highpass: 420,
    lowpass: 4500,
    noise: 0.6,
    length: 0.9,
    hall: 0.04,
    drive: 0.45,
  },
  {
    tones: [210, 345],
    toneLevel: 0.5,
    highpass: 900,
    lowpass: 9000,
    noise: 0.52,
    length: 0.5,
    hall: 0.03,
    drive: 0.1,
  },
  {
    tones: [205, 310],
    toneLevel: 0.32,
    highpass: 900,
    lowpass: 6000,
    noise: 0.3,
    length: 0.35,
    hall: 0.02,
    drive: 0,
  },
  {
    tones: [186, 278],
    toneLevel: 0.85,
    highpass: 380,
    lowpass: 8200,
    noise: 0.62,
    length: 1,
    hall: 0.14,
    drive: 0.25,
  },
];

interface HatProfile {
  highpass: number;
  lowpass: number;
  metal: number;
  attack: number;
  length: number;
  maximum: number;
  level: number;
  gated: boolean;
}
const HATS: readonly HatProfile[] = [
  {
    highpass: 7500,
    lowpass: 14000,
    metal: 0.35,
    attack: 0.001,
    length: 0.5,
    maximum: 0.12,
    level: 1.02,
    gated: false,
  },
  {
    highpass: 6500,
    lowpass: 15000,
    metal: 0.45,
    attack: 0.002,
    length: 3.5,
    maximum: 0.6,
    level: 0.85,
    gated: false,
  },
  {
    highpass: 4500,
    lowpass: 10000,
    metal: 0,
    attack: 0.012,
    length: 1.2,
    maximum: 0.2,
    level: 0.94,
    gated: false,
  },
  {
    highpass: 9000,
    lowpass: 16000,
    metal: 0.2,
    attack: 0.0008,
    length: 0.25,
    maximum: 0.04,
    level: 1.02,
    gated: false,
  },
  {
    highpass: 5000,
    lowpass: 13000,
    metal: 0.8,
    attack: 0.002,
    length: 6,
    maximum: 1.2,
    level: 0.58,
    gated: false,
  },
  {
    highpass: 6000,
    lowpass: 14500,
    metal: 0.5,
    attack: 0.002,
    length: 2.6,
    maximum: 0.32,
    level: 0.88,
    gated: true,
  },
  {
    highpass: 3800,
    lowpass: 8000,
    metal: 0.25,
    attack: 0.002,
    length: 0.8,
    maximum: 0.2,
    level: 1.02,
    gated: false,
  },
  {
    highpass: 8000,
    lowpass: 16000,
    metal: 0.6,
    attack: 0.003,
    length: 4.5,
    maximum: 0.9,
    level: 0.68,
    gated: false,
  },
];
const HAT_PARTIALS = [205.3, 304.4, 369.6, 522.7, 540, 800];

interface ClapProfile {
  frequency: number;
  q: number;
  bursts: number;
  gap: number;
  tail: number;
  level: number;
  hall: number;
  lowpass: number;
  /** Tuned body under the clap, so it has weight instead of only air. */
  snare: number;
  /** Level of the bright noise layer above 5 kHz. */
  air: number;
}
/** House, Tight, Hall, Snap, Dusty, Layered, Soft. */
const CLAPS: readonly ClapProfile[] = [
  {
    frequency: 1250,
    q: 0.9,
    bursts: 3,
    gap: 0.011,
    tail: 1,
    level: 0.62,
    hall: 0.08,
    lowpass: 9000,
    snare: 0.25,
    air: 0.45,
  },
  {
    frequency: 1600,
    q: 1.1,
    bursts: 2,
    gap: 0.008,
    tail: 0.55,
    level: 0.6,
    hall: 0.04,
    lowpass: 10000,
    snare: 0.2,
    air: 0.5,
  },
  {
    frequency: 1150,
    q: 0.8,
    bursts: 4,
    gap: 0.013,
    tail: 1.3,
    level: 0.6,
    hall: 0.28,
    lowpass: 8500,
    snare: 0.2,
    air: 0.4,
  },
  {
    frequency: 2000,
    q: 1.3,
    bursts: 1,
    gap: 0,
    tail: 0.32,
    level: 0.58,
    hall: 0.04,
    lowpass: 11000,
    snare: 0.15,
    air: 0.5,
  },
  {
    frequency: 1000,
    q: 0.8,
    bursts: 3,
    gap: 0.014,
    tail: 0.9,
    level: 0.62,
    hall: 0.06,
    lowpass: 4200,
    snare: 0.3,
    air: 0.15,
  },
  {
    frequency: 1350,
    q: 0.9,
    bursts: 3,
    gap: 0.01,
    tail: 0.95,
    level: 0.52,
    hall: 0.1,
    lowpass: 9000,
    snare: 0.55,
    air: 0.4,
  },
  {
    frequency: 1100,
    q: 0.7,
    bursts: 3,
    gap: 0.016,
    tail: 1.1,
    level: 0.46,
    hall: 0.12,
    lowpass: 5500,
    snare: 0.2,
    air: 0.2,
  },
];

export function fluffDrumTail(track: DrumTrack): number {
  return Math.max(fluffSynthDrumTail(track), fluffSampleTail(track));
}
function fluffSynthDrumTail(track: DrumTrack): number {
  if (track.id === "hat") {
    const profile = HATS[track.sound] ?? HATS[0];
    return profile
      ? Math.min(profile.maximum, track.decay * profile.length) + 0.05
      : 0.2;
  }
  if (track.id === "rim" && track.sound >= 5)
    return Math.min(3, track.decay * 4) + 0.1;
  return track.decay * 1.7 + 0.1;
}

/**
 * Fluff drum kit. Sampled slots play their bundled sample once it has
 * decoded; until then, and for the synthesized slots, each sound has its own
 * synthesis, mixed for 4/4 and breaks.
 */
export function fluffDrumVoice(
  context: BaseAudioContext,
  bus: FluffBus,
  track: DrumTrack,
  time: number,
  scale: MusicalScale,
): void {
  if (track.volume === 0) return;
  const sampled = cachedFluffDrum(context, track.id, track.sound);
  if (sampled) {
    playFluffDrumSample(
      context,
      bus,
      track,
      time,
      sampled.drum,
      sampled.buffer,
      (target) => rootNear(scale, target),
    );
    return;
  }
  const pitch = 2 ** (track.pitch / 12);
  const decay = track.decay;
  const sources: Source[] = [];
  const nodes: AudioNode[] = [];
  const mix = context.createGain();
  nodes.push(mix);
  let previous: AudioNode = mix;
  if (track.tone !== 0.5) {
    const tone = context.createBiquadFilter();
    tone.type = "highshelf";
    tone.frequency.value = 1800;
    tone.gain.value = (track.tone - 0.5) * (track.tone < 0.5 ? 30 : 20);
    previous.connect(tone);
    previous = tone;
    nodes.push(tone);
  }
  if (track.drive > 0) {
    const drive = context.createWaveShaper();
    drive.curve = softClipCurve(track.drive);
    previous.connect(drive);
    previous = drive;
    nodes.push(drive);
  }
  if (track.attack > 0) {
    const soften = context.createGain();
    soften.gain.value = 0;
    soften.gain.setValueAtTime(0, time);
    soften.gain.linearRampToValueAtTime(
      1,
      time + Math.max(0.002, Math.min(0.18, decay * 0.8) * track.attack),
    );
    previous.connect(soften);
    previous = soften;
    nodes.push(soften);
  }
  const pan = context.createStereoPanner();
  pan.pan.value = track.pan;
  previous.connect(pan);
  pan.connect(bus.drums);
  nodes.push(pan);
  const send = (target: AudioNode, amount: number): void => {
    if (amount <= 0) return;
    const gain = context.createGain();
    gain.gain.value = amount;
    pan.connect(gain);
    gain.connect(target);
    nodes.push(gain);
  };
  send(bus.plate, track.space * 0.9);

  let end = time + decay + 0.1;
  const envelope = (
    peak: number,
    seconds: number,
    offset = 0,
    attack = 0.0015,
  ): GainNode => {
    const gain = context.createGain();
    gain.gain.value = 0;
    const start = time + offset;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(
      Math.max(MIN_GAIN, peak * track.volume),
      start + attack,
    );
    gain.gain.exponentialRampToValueAtTime(
      MIN_GAIN,
      start + attack + Math.max(0.006, seconds),
    );
    gain.gain.linearRampToValueAtTime(
      0,
      start + attack + Math.max(0.006, seconds) + 0.004,
    );
    gain.connect(mix);
    nodes.push(gain);
    end = Math.max(end, start + attack + seconds + 0.03);
    return gain;
  };
  const tone = (
    type: OscillatorType,
    frequency: number,
    target: AudioNode,
  ): OscillatorNode => {
    const source = context.createOscillator();
    source.type = type;
    source.frequency.setValueAtTime(frequency, time);
    source.connect(target);
    sources.push(source);
    return source;
  };
  const noise = (
    type: BiquadFilterType,
    frequency: number,
    target: AudioNode,
    q = 0.7,
  ): BiquadFilterNode => {
    const source = context.createBufferSource();
    source.buffer = noiseBuffer(context);
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = Math.min(18000, frequency);
    filter.Q.value = q;
    source.connect(filter);
    filter.connect(target);
    sources.push(source);
    nodes.push(filter);
    return filter;
  };

  if (track.id === "kick") {
    const profile = KICKS[track.sound] ?? KICKS[0];
    if (!profile) return;
    const floor = rootNear(scale, profile.floor) * pitch;
    const tail = Math.max(0.06, decay * profile.length);
    const hold = Math.min(profile.hold, tail * 0.5);
    // The body holds near full level, then falls; drive follows the envelope
    // so its harmonics fade with the body instead of buzzing at a fixed level.
    const body = context.createGain();
    body.gain.value = 0;
    const peak = profile.level * track.volume;
    body.gain.setValueAtTime(0, time);
    body.gain.linearRampToValueAtTime(peak, time + 0.0015);
    body.gain.linearRampToValueAtTime(peak * 0.82, time + hold);
    body.gain.setTargetAtTime(0, time + hold, tail / 4.2);
    body.gain.cancelAndHoldAtTime(time + hold + tail);
    body.gain.linearRampToValueAtTime(0, time + hold + tail + 0.006);
    nodes.push(body);
    let target: AudioNode = mix;
    if (profile.lowpass > 0) {
      const dull = context.createBiquadFilter();
      dull.type = "lowpass";
      dull.frequency.value = profile.lowpass;
      dull.connect(target);
      nodes.push(dull);
      target = dull;
    }
    if (profile.drive > 0) {
      const shaper = context.createWaveShaper();
      shaper.curve = softClipCurve(profile.drive);
      const trim = context.createGain();
      trim.gain.value = 1 / (1 + profile.drive * 0.35);
      shaper.connect(trim);
      trim.connect(target);
      nodes.push(shaper, trim);
      target = shaper;
    }
    body.connect(target);
    const sine = tone("sine", floor * profile.from, body);
    sine.frequency.exponentialRampToValueAtTime(
      floor * 1.18,
      time + profile.sweep,
    );
    sine.frequency.exponentialRampToValueAtTime(
      floor,
      time + profile.sweep + 0.09,
    );
    if (profile.knock > 0) {
      const knock = tone(
        "sine",
        floor * profile.from * 2,
        envelope(profile.knock, 0.04),
      );
      knock.frequency.exponentialRampToValueAtTime(
        floor * 2.2,
        time + profile.sweep * 1.2,
      );
    }
    if (profile.click > 0)
      noise(
        "bandpass",
        profile.clickFrequency,
        envelope(profile.click, 0.008),
        1.1,
      );
    if (track.sound === 4)
      noise("bandpass", 700, envelope(0.18, Math.min(0.06, tail)), 0.8);
    end = time + hold + tail + 0.05;
  } else if (track.id === "snare") {
    const profile = SNARES[track.sound] ?? SNARES[0];
    if (!profile) return;
    const length = Math.max(0.03, decay * profile.length);
    const bodyLength = Math.min(0.14, length * 0.6);
    for (const [index, frequency] of profile.tones.entries()) {
      const source = tone(
        index === 0 ? "sine" : "triangle",
        frequency * pitch * 1.5,
        envelope(profile.toneLevel * (index === 0 ? 1 : 0.5), bodyLength),
      );
      source.frequency.exponentialRampToValueAtTime(
        frequency * pitch,
        time + 0.02,
      );
    }
    const rattle = envelope(profile.noise, length);
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = profile.lowpass;
    nodes.push(lowpass);
    if (profile.drive > 0) {
      const shaper = context.createWaveShaper();
      shaper.curve = softClipCurve(profile.drive);
      lowpass.connect(shaper);
      shaper.connect(rattle);
      nodes.push(shaper);
    } else lowpass.connect(rattle);
    noise("highpass", profile.highpass * pitch, lowpass);
    send(bus.hall, profile.hall);
    end = time + length + 0.05;
  } else if (track.id === "hat") {
    const profile = HATS[track.sound] ?? HATS[0];
    if (!profile) return;
    const length = Math.max(
      0.015,
      Math.min(profile.maximum, decay * profile.length),
    );
    const out = context.createGain();
    out.gain.value = 0;
    out.gain.setValueAtTime(0, time);
    out.gain.linearRampToValueAtTime(
      profile.level * track.volume,
      time + profile.attack,
    );
    if (profile.gated) {
      out.gain.setTargetAtTime(
        profile.level * track.volume * 0.55,
        time + profile.attack,
        length * 0.4,
      );
      out.gain.setTargetAtTime(0, time + length * 0.8, length * 0.06);
    } else out.gain.setTargetAtTime(0, time + profile.attack, length / 4.6);
    out.gain.cancelAndHoldAtTime(time + length * 1.3);
    out.gain.linearRampToValueAtTime(0, time + length * 1.3 + 0.01);
    out.connect(mix);
    nodes.push(out);
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = profile.lowpass;
    lowpass.connect(out);
    nodes.push(lowpass);
    const air = context.createGain();
    air.gain.value = 1 - profile.metal * 0.6;
    air.connect(lowpass);
    nodes.push(air);
    noise("highpass", profile.highpass * pitch, air);
    if (profile.metal > 0) {
      const ring = context.createBiquadFilter();
      ring.type = "highpass";
      ring.frequency.value = Math.min(16000, profile.highpass * pitch);
      ring.Q.value = 0.8;
      const metal = context.createGain();
      metal.gain.value = profile.metal * 0.3;
      metal.connect(ring);
      ring.connect(lowpass);
      nodes.push(ring, metal);
      for (const partial of HAT_PARTIALS)
        tone("square", partial * pitch * 1.6, metal);
    }
    end = time + length * 1.3 + 0.03;
  } else if (track.id === "clap") {
    const profile = CLAPS[track.sound] ?? CLAPS[0];
    if (!profile) return;
    const tail = Math.max(0.03, decay * profile.tail);
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = profile.lowpass;
    lowpass.connect(mix);
    nodes.push(lowpass);
    const out = context.createGain();
    out.gain.value = 0;
    out.connect(lowpass);
    nodes.push(out);
    const peak = profile.level * track.volume;
    for (let burst = 0; burst < profile.bursts; burst++) {
      const start = time + burst * profile.gap;
      const last = burst === profile.bursts - 1;
      out.gain.setValueAtTime(MIN_GAIN, start);
      out.gain.linearRampToValueAtTime(
        peak * (last ? 1 : 0.7 + burst * 0.1),
        start + 0.001,
      );
      out.gain.exponentialRampToValueAtTime(
        last ? MIN_GAIN : peak * 0.12,
        start + (last ? tail : profile.gap * 0.85),
      );
    }
    const total = (profile.bursts - 1) * profile.gap + tail;
    out.gain.linearRampToValueAtTime(0, time + total + 0.004);
    noise("bandpass", profile.frequency * pitch, out, profile.q);
    if (profile.air > 0) {
      const air = context.createGain();
      air.gain.value = profile.air;
      air.connect(out);
      nodes.push(air);
      noise("highpass", 5200 * pitch, air).Q.value = 0.5;
    }
    if (profile.snare > 0) {
      const source = tone(
        "sine",
        330 * pitch,
        envelope(profile.snare, Math.min(0.12, tail)),
      );
      source.frequency.exponentialRampToValueAtTime(200 * pitch, time + 0.02);
      noise("bandpass", 600 * pitch, envelope(profile.snare * 0.5, 0.05), 0.9);
    }
    send(bus.hall, profile.hall);
    end = time + total + 0.05;
  } else if (track.sound === 0) {
    tone("sine", 1750 * pitch, envelope(0.4, Math.min(0.03, decay)));
    tone("triangle", 820 * pitch, envelope(0.4, Math.min(0.045, decay)));
    noise("bandpass", 3200 * pitch, envelope(0.25, 0.006), 1.5);
  } else if (track.sound === 1 || track.sound === 2) {
    const tom = track.sound === 1;
    const frequency = (tom ? 115 : 235) * pitch;
    const source = tone(
      "sine",
      frequency * (tom ? 1.7 : 1.25),
      envelope(0.75, decay),
    );
    source.frequency.exponentialRampToValueAtTime(
      frequency,
      time + (tom ? 0.06 : 0.02),
    );
    tone("triangle", frequency * 2.02, envelope(0.14, decay * 0.3));
    noise(
      "bandpass",
      (tom ? 900 : 2600) * pitch,
      envelope(tom ? 0.12 : 0.3, tom ? 0.02 : 0.012),
      1,
    );
  } else if (track.sound === 3) {
    for (const [index, offset] of [0, 0.028].entries()) {
      const jingle = envelope(0.3 - index * 0.08, decay * 0.9, offset, 0.003);
      noise("highpass", 6200 * pitch, jingle);
      const ring = context.createGain();
      ring.gain.value = 0.12;
      ring.connect(jingle);
      nodes.push(ring);
      for (const partial of [5400, 7150, 9300])
        tone("square", partial * pitch, ring);
    }
  } else if (track.sound === 4) {
    const frequency = midiFrequency(72 + scale.root) * pitch;
    const source = tone("sine", frequency, envelope(0.5, decay));
    const depth = context.createGain();
    depth.gain.setValueAtTime(frequency * 1.6, time);
    depth.gain.setTargetAtTime(0, time, 0.02);
    nodes.push(depth);
    tone("sine", frequency * 2, depth);
    depth.connect(source.frequency);
    send(bus.delay, 0.25);
    send(bus.hall, 0.25);
  } else {
    const crash = track.sound === 5;
    const length = Math.min(3, Math.max(0.2, decay * 4));
    const out = envelope(crash ? 0.42 : 0.34, length, 0, crash ? 0.003 : 0.02);
    const filter = noise(
      crash ? "highpass" : "bandpass",
      (crash ? 3600 : 9000) * pitch,
      out,
      crash ? 0.6 : 1.6,
    );
    if (crash) {
      const metal = context.createGain();
      metal.gain.value = 0.07;
      metal.connect(filter);
      nodes.push(metal);
      for (const partial of HAT_PARTIALS)
        tone("square", partial * pitch * 2.1, metal);
    } else
      filter.frequency.exponentialRampToValueAtTime(
        500 * pitch,
        time + length * 0.9,
      );
    send(bus.hall, 0.45);
    end = time + length + 0.05;
  }

  let remaining = sources.length;
  if (remaining === 0) {
    for (const node of nodes) node.disconnect();
    return;
  }
  for (const source of sources) {
    source.onended = () => {
      source.disconnect();
      remaining--;
      if (remaining === 0) for (const node of nodes) node.disconnect();
    };
    if (source instanceof AudioBufferSourceNode)
      source.start(time, (time * 7.31) % 1.5);
    else source.start(time);
    source.stop(end);
  }
}
