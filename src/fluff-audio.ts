import { midiFrequency } from "./audio";
import { scaleNotes } from "./model";
import type { DrumTrack, KeysTrack, MusicalScale } from "./model";

const MIN_GAIN = 0.0001;
export const FLUFF_HALL_SECONDS = 3.4;
const FLUFF_PLATE_SECONDS = 1.1;

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

/** A dense, darkening noise tail; both channels are decorrelated for width. */
function reverbImpulse(
  context: BaseAudioContext,
  seconds: number,
  brightness: number,
  seed: number,
): AudioBuffer {
  const length = Math.ceil(context.sampleRate * seconds);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let state = (seed + channel * 7919) >>> 0;
    let low = 0;
    let energy = 0;
    for (let index = 0; index < length; index++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const white = state / 2147483648 - 1;
      const progress = index / length;
      // The one-pole coefficient falls over time, so highs die before lows.
      const coefficient = brightness * (1 - progress * 0.82) + 0.04;
      low += (white - low) * coefficient;
      const build = Math.min(1, index / (context.sampleRate * 0.012));
      const value = low * build * Math.exp(-progress * 6.2);
      data[index] = value;
      energy += value * value;
    }
    const scale = 1 / Math.sqrt(Math.max(1e-9, energy));
    for (let index = 0; index < length; index++)
      data[index] = (data[index] ?? 0) * scale;
  }
  return buffer;
}

const sawCache = new WeakMap<BaseAudioContext, PeriodicWave[]>();
/** Phase-offset saws stop a unison stack from starting as one hard transient. */
function sawWaves(context: BaseAudioContext): PeriodicWave[] {
  const cached = sawCache.get(context);
  if (cached) return cached;
  const waves: PeriodicWave[] = [];
  for (let wave = 0; wave < 8; wave++) {
    const phase = ((wave * 0.6180339887) % 1) * Math.PI * 2;
    const real = new Float32Array(40);
    const imaginary = new Float32Array(40);
    for (let harmonic = 1; harmonic < real.length; harmonic++) {
      real[harmonic] = Math.sin(harmonic * phase) / harmonic;
      imaginary[harmonic] = Math.cos(harmonic * phase) / harmonic;
    }
    waves.push(context.createPeriodicWave(real, imaginary));
  }
  sawCache.set(context, waves);
  return waves;
}
export function fluffSaw(
  context: BaseAudioContext,
  oscillator: OscillatorNode,
  index: number,
): void {
  const waves = sawWaves(context);
  const wave = waves[((index % waves.length) + waves.length) % waves.length];
  if (wave) oscillator.setPeriodicWave(wave);
  else oscillator.type = "sawtooth";
}

const pulseCache = new WeakMap<BaseAudioContext, PeriodicWave>();
function pulseWave(context: BaseAudioContext): PeriodicWave {
  const cached = pulseCache.get(context);
  if (cached) return cached;
  const duty = 0.25;
  const real = new Float32Array(40);
  const imaginary = new Float32Array(40);
  for (let harmonic = 1; harmonic < real.length; harmonic++) {
    real[harmonic] =
      (2 / (harmonic * Math.PI)) * Math.sin(harmonic * Math.PI * duty);
    imaginary[harmonic] = 0;
  }
  const wave = context.createPeriodicWave(real, imaginary);
  pulseCache.set(context, wave);
  return wave;
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
  private readonly duck: GainNode;
  private readonly wetDuck: GainNode;
  private readonly delays: DelayNode[];
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
    this.duck = node(context.createGain());
    this.wetDuck = node(context.createGain());
    this.music.connect(this.duck);
    this.duck.connect(output);
    this.wetDuck.connect(output);
    this.drums.connect(drumOutput);

    const reverb = (
      send: GainNode,
      seconds: number,
      brightness: number,
      lowCut: number,
      level: number,
      destination: AudioNode,
    ): void => {
      const predelay = node(context.createDelay(0.1));
      predelay.delayTime.value = 0.018;
      const cut = node(context.createBiquadFilter());
      cut.type = "highpass";
      cut.frequency.value = lowCut;
      cut.Q.value = 0.5;
      const convolver = node(context.createConvolver());
      convolver.normalize = false;
      convolver.buffer = reverbImpulse(context, seconds, brightness, 5381);
      const wet = node(context.createGain());
      wet.gain.value = level;
      send.connect(predelay);
      predelay.connect(cut);
      cut.connect(convolver);
      convolver.connect(wet);
      wet.connect(destination);
    };
    reverb(this.hall, FLUFF_HALL_SECONDS, 0.5, 260, 1.5, this.wetDuck);
    reverb(this.plate, FLUFF_PLATE_SECONDS, 0.75, 420, 1.2, output);

    const left = node(context.createDelay(2));
    const right = node(context.createDelay(2));
    this.delays = [left, right];
    const damping = node(context.createBiquadFilter());
    damping.type = "lowpass";
    damping.frequency.value = 4800;
    damping.Q.value = 0.5;
    const rumble = node(context.createBiquadFilter());
    rumble.type = "highpass";
    rumble.frequency.value = 320;
    rumble.Q.value = 0.5;
    const feedback = node(context.createGain());
    feedback.gain.value = 0.42;
    const panLeft = node(context.createStereoPanner());
    const panRight = node(context.createStereoPanner());
    panLeft.pan.value = -0.75;
    panRight.pan.value = 0.75;
    const echo = node(context.createGain());
    echo.gain.value = 0.8;
    const echoHall = node(context.createGain());
    echoHall.gain.value = 0.22;
    this.delay.connect(rumble);
    rumble.connect(damping);
    damping.connect(left);
    left.connect(panLeft);
    left.connect(right);
    right.connect(panRight);
    right.connect(feedback);
    feedback.connect(damping);
    panLeft.connect(echo);
    panRight.connect(echo);
    echo.connect(this.wetDuck);
    echo.connect(echoHall);
    echoHall.connect(this.hall);
    this.setTempo(bpm, context.currentTime);
  }

  setTempo(bpm: number, time: number): void {
    if (bpm === this.bpm || bpm <= 0) return;
    const immediate = this.bpm === 0;
    this.bpm = bpm;
    // Dotted eighths on each side make the repeats land between the beats.
    const seconds = Math.min(1.9, (60 / bpm) * 0.75);
    for (const delay of this.delays) {
      if (immediate) delay.delayTime.value = seconds;
      else delay.delayTime.setTargetAtTime(seconds, time, 0.05);
    }
  }

  /** Dip the melodic bus on a kick, then let it swell back before the next beat. */
  pump(time: number, depth: number, bpm: number): void {
    if (depth <= 0) return;
    const beat = 60 / Math.max(1, bpm);
    const dip = (gain: AudioParam, amount: number): void => {
      gain.cancelAndHoldAtTime(time);
      gain.linearRampToValueAtTime(1 - amount, time + 0.008);
      gain.setTargetAtTime(1, time + 0.008 + beat * 0.08, beat * 0.15);
    };
    const amount = Math.min(0.92, depth * 0.92);
    dip(this.duck.gain, amount);
    dip(this.wetDuck.gain, amount * 0.6);
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
    for (const node of this.nodes) node.disconnect();
  }
}

export type FluffPatch =
  | "supersaw"
  | "superpluck"
  | "pluck"
  | "bell"
  | "glass"
  | "piano"
  | "stab"
  | "rave"
  | "chip"
  | "whistle"
  | "vox"
  | "pizz"
  | "dream"
  | "mallet";

export const FLUFF_LEAD_PATCHES: readonly FluffPatch[] = [
  "supersaw",
  "pluck",
  "bell",
  "piano",
  "stab",
  "chip",
  "whistle",
  "vox",
];
/** Per-slot trims that level every lead patch against the kick. */
const FLUFF_LEAD_LEVELS: readonly number[] = [
  2.24, 2.24, 1.26, 1.41, 2.24, 2.51, 1.26, 1.26,
];
/** Per-slot trims that level every arp patch under the lead. */
export const FLUFF_ARP_LEVELS: readonly number[] = [
  2.56, 5.1, 1.71, 2.29, 3.22, 1.14, 2.88, 1.44,
];
export const FLUFF_ARP_PATCHES: readonly FluffPatch[] = [
  "pluck",
  "superpluck",
  "glass",
  "pizz",
  "chip",
  "dream",
  "rave",
  "mallet",
];

export interface FluffNote {
  patch: FluffPatch;
  frequency: number;
  /** Extra chord tones for stacked patches. */
  chord?: readonly number[];
  time: number;
  /** Seconds the note is held before its release. */
  gate: number;
  decay: number;
  attack: number;
  tone: number;
  resonance: number;
  shape: number;
  width: number;
  motion: number;
  grit: number;
  level: number;
  pan: number;
  accent: boolean;
}
export interface FluffVoice {
  end: number;
  stop(time: number): void;
}

const VOWELS: ReadonlyArray<readonly [number, number, number]> = [
  [340, 760, 2700],
  [480, 880, 2830],
  [820, 1250, 2900],
  [600, 1900, 2850],
  [310, 2350, 3100],
];
function vowel(position: number): [number, number, number] {
  const scaled = Math.max(0, Math.min(1, position)) * (VOWELS.length - 1);
  const lower = Math.floor(scaled);
  const fraction = scaled - lower;
  const first = VOWELS[lower] ?? [820, 1250, 2900];
  const second = VOWELS[Math.min(VOWELS.length - 1, lower + 1)] ?? first;
  return [
    first[0] + (second[0] - first[0]) * fraction,
    first[1] + (second[1] - first[1]) * fraction,
    first[2] + (second[2] - first[2]) * fraction,
  ];
}

/** One polyphonic Fluff voice; every source owns its cleanup. */
export function playFluffNote(
  context: BaseAudioContext,
  output: AudioNode,
  note: FluffNote,
): FluffVoice {
  const { patch, frequency, time } = note;
  const sources: Source[] = [];
  const nodes: AudioNode[] = [];
  const amp = context.createGain();
  amp.gain.value = 0;
  nodes.push(amp);
  const maximum = Math.min(18000, context.sampleRate * 0.45);
  const base = Math.min(maximum, 180 * 2 ** (note.tone * 6.4));
  const decay = Math.max(0.03, note.decay);
  const gate = Math.max(0.02, note.gate);

  const vibrato = context.createGain();
  vibrato.gain.value = 0;
  const wobble = context.createGain();
  wobble.gain.value = 0;
  nodes.push(vibrato, wobble);
  const lfo = context.createOscillator();
  lfo.frequency.value = 5.4;
  lfo.connect(vibrato);
  lfo.connect(wobble);
  sources.push(lfo);

  const filters: BiquadFilterNode[] = [];
  /** A filtered stereo position; unison patches use one per side. */
  const side = (pan: number): BiquadFilterNode => {
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    const panner = context.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, note.pan + pan));
    filter.connect(panner);
    panner.connect(amp);
    wobble.connect(filter.detune);
    filters.push(filter);
    nodes.push(filter, panner);
    return filter;
  };
  const oscillator = (
    type: OscillatorType | "saw" | "pulse",
    ratio: number,
    level: number,
    target: AudioNode,
    detune = 0,
    phase = 0,
  ): OscillatorNode => {
    const source = context.createOscillator();
    if (type === "saw") fluffSaw(context, source, phase);
    else if (type === "pulse") source.setPeriodicWave(pulseWave(context));
    else source.type = type;
    source.frequency.value = frequency * ratio;
    source.detune.value = detune;
    vibrato.connect(source.detune);
    const gain = context.createGain();
    gain.gain.value = level;
    source.connect(gain);
    gain.connect(target);
    sources.push(source);
    nodes.push(gain);
    return source;
  };
  const sweep = (peak: number, floor: number, seconds: number): void => {
    for (const filter of filters) {
      filter.frequency.setValueAtTime(
        Math.min(maximum, Math.max(40, peak)),
        time,
      );
      filter.frequency.setTargetAtTime(
        Math.min(maximum, Math.max(40, floor)),
        time,
        Math.max(0.004, seconds),
      );
    }
  };
  const resonance = (value: number): void => {
    for (const filter of filters) filter.Q.value = value;
  };
  const modulate = (
    carrier: OscillatorNode,
    ratio: number,
    index: number,
    seconds: number,
    floor = 0,
  ): void => {
    const modulator = context.createOscillator();
    modulator.frequency.value = frequency * ratio;
    const depth = context.createGain();
    depth.gain.setValueAtTime(frequency * index, time);
    depth.gain.setTargetAtTime(
      frequency * index * floor,
      time,
      Math.max(0.004, seconds),
    );
    modulator.connect(depth);
    depth.connect(carrier.frequency);
    sources.push(modulator);
    nodes.push(depth);
  };

  let peak = 0.3;
  let attack = Math.max(0.002, note.attack);
  let sustain = 0;
  let fall = decay;
  let release = decay;
  let vibratoDepth = note.motion * 22;
  let vibratoDelay = 0.12;
  const spread = 6 + note.shape * 26;
  const wide = 0.25 + note.width * 0.7;

  if (patch === "supersaw" || patch === "superpluck") {
    const leftFilter = side(-wide);
    const rightFilter = side(wide);
    const voices = patch === "supersaw" ? 7 : 5;
    for (let voice = 0; voice < voices; voice++) {
      const position = (voice / (voices - 1)) * 2 - 1;
      oscillator(
        "saw",
        1,
        position === 0 ? 0.2 : 0.15,
        voice % 2 === 0 ? leftFilter : rightFilter,
        position * spread,
        voice + Math.round(frequency),
      );
    }
    oscillator("saw", 2, 0.05 + note.shape * 0.06, leftFilter, 5, 3);
    oscillator("saw", 2, 0.05 + note.shape * 0.06, rightFilter, -5, 6);
    resonance(0.6 + note.resonance * 5);
    if (patch === "supersaw") {
      sweep(base * 1.7, base, 0.14);
      sustain = 0.86;
      fall = 0.25;
      peak = 0.36;
      attack = Math.max(0.006, note.attack);
    } else {
      sweep(base * (2.5 + note.shape * 3), base * 0.55, decay * 0.3);
      sustain = 0.22;
      fall = decay * 0.5;
      release = decay * 0.8;
      peak = 0.42;
    }
  } else if (patch === "pluck") {
    const left = side(-wide * 0.5);
    const right = side(wide * 0.5);
    oscillator("saw", 1, 0.3, left, -7, 1);
    oscillator("saw", 1, 0.3, right, 7, 4);
    oscillator("square", 0.5, 0.1 + note.shape * 0.16, left);
    oscillator("triangle", 1, 0.2, right);
    resonance(1 + note.resonance * 9);
    sweep(base * (3.2 + note.shape * 5), base * 0.45, decay * 0.2);
    peak = 0.5;
  } else if (patch === "bell" || patch === "glass") {
    const filter = side(0);
    filter.frequency.value = maximum;
    const body = oscillator("sine", 1, 0.5, filter);
    const glassy = patch === "glass";
    modulate(
      body,
      glassy ? 7 : 2 + Math.round(note.shape * 4) * 0.5 + 1.5,
      (glassy ? 0.9 : 1.8) * (0.5 + note.tone),
      decay * (glassy ? 0.08 : 0.3),
      0.04,
    );
    const shimmer = oscillator(
      "sine",
      glassy ? 3 : 2,
      glassy ? 0.2 : 0.22,
      filter,
      glassy ? 4 : 3,
    );
    modulate(shimmer, glassy ? 5.02 : 1, 0.6 * note.shape, decay * 0.2);
    if (glassy) oscillator("sine", 5.02, 0.07, filter);
    fall = decay * (glassy ? 1.2 : 1.7);
    attack = 0.002;
    peak = 0.42;
  } else if (patch === "piano") {
    const left = side(-wide * 0.3);
    const right = side(wide * 0.3);
    const body = oscillator("triangle", 1, 0.5, left);
    modulate(body, 1, 1.3 + note.shape * 1.5, 0.05, 0.12);
    oscillator("saw", 1, 0.16 + note.shape * 0.12, right, 4, 2);
    oscillator("sine", 2, 0.2, right, -3);
    oscillator("sine", 0.5, 0.12, left);
    resonance(0.7 + note.resonance * 2);
    sweep(base * 4.5, base * 0.8, decay * 0.25);
    sustain = 0.18;
    fall = decay * 0.7;
    release = 0.16;
    attack = 0.002;
    peak = 0.52;
  } else if (patch === "stab" || patch === "rave") {
    const left = side(-wide);
    const right = side(wide);
    const tones = [1, ...(note.chord ?? []).map((tone) => tone / frequency)];
    const level = 0.26 / Math.sqrt(tones.length);
    tones.forEach((ratio, index) => {
      oscillator("saw", ratio, level, left, -spread * 0.5, index * 2);
      oscillator("saw", ratio, level, right, spread * 0.5, index * 2 + 1);
      if (patch === "rave")
        oscillator("pulse", ratio * 0.5, level * 0.7, index % 2 ? left : right);
    });
    resonance(1 + note.resonance * 6);
    if (patch === "stab") {
      sweep(base * 3.4, base * 0.9, 0.07);
      sustain = 0.55;
      fall = 0.09;
      release = Math.min(0.5, decay * 0.5);
    } else {
      sweep(base * 4, base * 0.6, decay * 0.25);
      sustain = 0.12;
      fall = decay * 0.5;
      release = decay * 0.5;
      for (const source of sources)
        if (source instanceof OscillatorNode && source !== lfo) {
          source.detune.setValueAtTime(source.detune.value + 45, time);
          source.detune.setTargetAtTime(source.detune.value, time, 0.012);
        }
    }
    attack = 0.003;
    peak = 0.6;
  } else if (patch === "chip") {
    const filter = side(0);
    filter.frequency.value = Math.min(maximum, base * 2.4 + 600);
    oscillator("pulse", 1, 0.3, filter);
    oscillator("square", 2, 0.05 + note.shape * 0.1, filter);
    oscillator("triangle", 0.5, 0.12, filter);
    sustain = 0.8;
    fall = 0.06;
    release = Math.min(0.3, decay * 0.4);
    attack = 0.002;
    vibratoDepth = 6 + note.motion * 26;
    vibratoDelay = 0.16;
    peak = 0.34;
  } else if (patch === "whistle") {
    const filter = side(0);
    filter.frequency.value = Math.min(maximum, base * 3 + 1200);
    const body = oscillator("sine", 1, 0.5, filter);
    body.detune.setValueAtTime(-45, time);
    body.detune.setTargetAtTime(0, time, 0.025);
    oscillator("sine", 2, 0.05 + note.shape * 0.12, filter);
    oscillator("triangle", 1, 0.08, filter, 4);
    const breath = context.createBufferSource();
    breath.buffer = noiseBuffer(context);
    breath.loop = true;
    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = Math.min(maximum, frequency * 2);
    band.Q.value = 1.4;
    const air = context.createGain();
    air.gain.value = 0.05 + note.grit * 0.2;
    breath.connect(band);
    band.connect(air);
    air.connect(filter);
    sources.push(breath);
    nodes.push(band, air);
    sustain = 0.9;
    fall = 0.1;
    attack = Math.max(0.03, note.attack);
    vibratoDepth = 8 + note.motion * 30;
    vibratoDelay = 0.18;
    peak = 0.42;
  } else if (patch === "vox") {
    const output = side(0);
    output.frequency.value = Math.min(maximum, 5200 + base);
    const source = context.createGain();
    nodes.push(source);
    oscillator("saw", 1, 0.5, source, -4, 2);
    oscillator("pulse", 1, 0.35, source, 5);
    oscillator("saw", 2, 0.08, source, 3, 5);
    const breath = context.createBufferSource();
    breath.buffer = noiseBuffer(context);
    breath.loop = true;
    const air = context.createGain();
    air.gain.value = 0.03 + note.grit * 0.12;
    breath.connect(air);
    air.connect(source);
    sources.push(breath);
    nodes.push(air);
    // Each note opens from a rounder vowel, which reads as a sung syllable.
    const target = vowel(0.2 + note.shape * 0.8);
    const onset = vowel(Math.max(0, note.shape * 0.8 - 0.15));
    const higher = (frequency / 330) ** 0.18 * 1.12;
    [1, 0.6, 0.34].forEach((level, index) => {
      const formant = context.createBiquadFilter();
      formant.type = "bandpass";
      formant.Q.value = 7 + index * 3 + note.resonance * 6;
      formant.frequency.setValueAtTime((onset[index] ?? 800) * higher, time);
      formant.frequency.setTargetAtTime(
        (target[index] ?? 800) * higher,
        time,
        0.05,
      );
      const gain = context.createGain();
      gain.gain.value = level * 2.4;
      source.connect(formant);
      formant.connect(gain);
      gain.connect(output);
      nodes.push(formant, gain);
    });
    sustain = 0.88;
    fall = 0.12;
    attack = Math.max(0.018, note.attack);
    vibratoDepth = 10 + note.motion * 32;
    vibratoDelay = 0.2;
    peak = 0.5;
  } else if (patch === "pizz") {
    const filter = side(0);
    oscillator("triangle", 1, 0.5, filter);
    oscillator("saw", 1, 0.12 + note.shape * 0.2, filter, 3, 1);
    oscillator("sine", 2, 0.1, filter);
    resonance(0.8 + note.resonance * 4);
    sweep(base * 5, base * 0.5, 0.03);
    fall = Math.min(0.35, decay);
    attack = 0.0015;
    peak = 0.5;
  } else if (patch === "dream") {
    const left = side(-wide * 0.6);
    const right = side(wide * 0.6);
    left.frequency.value = Math.min(maximum, base * 2 + 900);
    right.frequency.value = Math.min(maximum, base * 2 + 900);
    oscillator("sine", 1, 0.36, left, -6);
    oscillator("sine", 1, 0.36, right, 6);
    oscillator("sine", 2, 0.1 + note.shape * 0.16, left, 3);
    oscillator("triangle", 3, 0.03 + note.shape * 0.06, right, -3);
    fall = decay * 2;
    attack = Math.max(0.012, note.attack);
    peak = 0.4;
  } else {
    const filter = side(0);
    filter.frequency.value = Math.min(maximum, base * 3 + 1500);
    oscillator("sine", 1, 0.55, filter);
    const overtone = context.createGain();
    overtone.gain.setValueAtTime(0.3 + note.shape * 0.3, time);
    overtone.gain.setTargetAtTime(0, time, 0.045);
    overtone.connect(filter);
    nodes.push(overtone);
    oscillator("sine", 4, 1, overtone);
    oscillator("sine", 10, 0.25, overtone);
    fall = decay;
    attack = 0.0015;
    peak = 0.5;
  }

  const level = peak * note.level * (note.accent ? 1.22 : 1);
  const gain = amp.gain;
  gain.setValueAtTime(0, time);
  gain.linearRampToValueAtTime(level, time + attack);
  let end: number;
  if (sustain <= 0.001) {
    gain.setTargetAtTime(0, time + attack, fall / 4.6);
    end = time + attack + fall * 1.25;
  } else {
    const hold = Math.max(time + attack + 0.004, time + gate);
    gain.setTargetAtTime(level * sustain, time + attack, fall / 3);
    gain.cancelAndHoldAtTime(hold);
    gain.setTargetAtTime(0, hold, release / 4.6);
    end = hold + release * 1.25;
  }
  gain.cancelAndHoldAtTime(end - 0.012);
  gain.linearRampToValueAtTime(0, end);

  if (vibratoDepth > 0) {
    vibrato.gain.setValueAtTime(0, time);
    vibrato.gain.setTargetAtTime(vibratoDepth, time + vibratoDelay, 0.12);
  }
  if (note.motion > 0 && (patch === "supersaw" || patch === "stab")) {
    lfo.frequency.value = 0.4 + note.motion * 5;
    wobble.gain.value = note.motion * 900;
  }

  let last: AudioNode = amp;
  if (note.grit > 0 && patch !== "whistle" && patch !== "vox") {
    const shaper = context.createWaveShaper();
    shaper.curve = softClipCurve(note.grit);
    const trim = context.createGain();
    trim.gain.value = 1 / (1 + note.grit * 0.6);
    amp.connect(shaper);
    shaper.connect(trim);
    last = trim;
    nodes.push(shaper, trim);
  }
  last.connect(output);

  let remaining = sources.length;
  for (const source of sources) {
    source.onended = () => {
      source.disconnect();
      remaining--;
      if (remaining === 0) for (const node of nodes) node.disconnect();
    };
    if (source instanceof AudioBufferSourceNode)
      source.start(time, (frequency * 0.0137) % 1.5);
    else source.start(time);
    source.stop(end + 0.01);
  }
  const voice: FluffVoice = {
    end,
    stop(stopTime: number): void {
      if (stopTime >= voice.end) return;
      gain.cancelAndHoldAtTime(stopTime);
      gain.linearRampToValueAtTime(0, stopTime + 0.012);
      voice.end = stopTime + 0.012;
      for (const source of sources) source.stop(stopTime + 0.02);
    },
  };
  return voice;
}

export function fluffLeadTail(track: KeysTrack): number {
  if (track.muted) return 0;
  return track.decay * 2.5 + 0.05;
}

/** The Lead instrument: Texture's steps voiced as held, tied melodic notes. */
export class FluffLead {
  private readonly level: GainNode;
  private readonly hall: GainNode;
  private readonly delay: GainNode;
  private readonly voices = new Set<FluffVoice>();
  private firstStep = true;

  constructor(
    private readonly context: BaseAudioContext,
    bus: FluffBus,
  ) {
    this.level = context.createGain();
    this.level.gain.value = 0;
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
    const patch = FLUFF_LEAD_PATCHES[track.sound] ?? "supersaw";
    for (const voice of this.voices)
      if (voice.end <= time) this.voices.delete(voice);
    const chord =
      patch === "stab"
        ? scaleNotes(scale, midi, midi + 24)
            .filter((_, index) => index === 2 || index === 4)
            .map(midiFrequency)
        : undefined;
    this.voices.add(
      playFluffNote(this.context, this.level, {
        patch,
        frequency: midiFrequency(midi),
        chord,
        time,
        gate,
        decay: track.decay,
        attack: 0.004 + track.attack ** 2 * 0.5 + (legato ? 0.03 : 0),
        tone: track.tone,
        resonance: 0.2,
        shape: track.width,
        width: track.width,
        motion: track.motion,
        grit: track.grit,
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
    for (const node of [this.level, this.hall, this.delay]) node.disconnect();
  }
}

interface KickProfile {
  floor: number;
  from: number;
  sweep: number;
  click: number;
  clickFrequency: number;
  length: number;
  drive: number;
  level: number;
  lowpass: number;
}
const KICKS: readonly KickProfile[] = [
  {
    floor: 50,
    from: 6,
    sweep: 0.045,
    click: 0.34,
    clickFrequency: 3600,
    length: 1,
    drive: 0.25,
    level: 0.95,
    lowpass: 0,
  },
  {
    floor: 46,
    from: 4,
    sweep: 0.06,
    click: 0.18,
    clickFrequency: 2200,
    length: 1.15,
    drive: 0.1,
    level: 0.95,
    lowpass: 0,
  },
  {
    floor: 52,
    from: 2.6,
    sweep: 0.08,
    click: 0.06,
    clickFrequency: 1500,
    length: 0.9,
    drive: 0,
    level: 0.92,
    lowpass: 0,
  },
  {
    floor: 58,
    from: 5,
    sweep: 0.03,
    click: 0.3,
    clickFrequency: 4000,
    length: 0.55,
    drive: 0.2,
    level: 0.92,
    lowpass: 0,
  },
  {
    floor: 62,
    from: 3,
    sweep: 0.05,
    click: 0.3,
    clickFrequency: 1800,
    length: 0.7,
    drive: 0.15,
    level: 0.9,
    lowpass: 0,
  },
  {
    floor: 42,
    from: 3.5,
    sweep: 0.09,
    click: 0.1,
    clickFrequency: 2000,
    length: 1.6,
    drive: 0.05,
    level: 0.95,
    lowpass: 0,
  },
  {
    floor: 55,
    from: 3,
    sweep: 0.05,
    click: 0.22,
    clickFrequency: 1200,
    length: 0.8,
    drive: 0.55,
    level: 0.85,
    lowpass: 2600,
  },
];

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
const SNARES: readonly SnareProfile[] = [
  {
    tones: [190, 330],
    toneLevel: 0.42,
    highpass: 1800,
    lowpass: 11000,
    noise: 0.7,
    length: 1,
    hall: 0.06,
    drive: 0,
  },
  {
    tones: [170, 260],
    toneLevel: 0.6,
    highpass: 900,
    lowpass: 7000,
    noise: 0.62,
    length: 0.8,
    hall: 0.04,
    drive: 0.3,
  },
  {
    tones: [240, 400],
    toneLevel: 0.3,
    highpass: 2500,
    lowpass: 12000,
    noise: 0.6,
    length: 0.45,
    hall: 0.03,
    drive: 0,
  },
  {
    tones: [180, 280],
    toneLevel: 0.5,
    highpass: 700,
    lowpass: 4500,
    noise: 0.66,
    length: 0.9,
    hall: 0.04,
    drive: 0.45,
  },
  {
    tones: [210, 350],
    toneLevel: 0.4,
    highpass: 2200,
    lowpass: 9000,
    noise: 0.6,
    length: 0.5,
    hall: 0.02,
    drive: 0,
  },
  {
    tones: [200, 300],
    toneLevel: 0.22,
    highpass: 1500,
    lowpass: 6000,
    noise: 0.32,
    length: 0.35,
    hall: 0.03,
    drive: 0,
  },
  {
    tones: [165, 250],
    toneLevel: 0.55,
    highpass: 1200,
    lowpass: 10000,
    noise: 0.8,
    length: 1.5,
    hall: 0.5,
    drive: 0.1,
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
    level: 0.6,
    gated: false,
  },
  {
    highpass: 6500,
    lowpass: 15000,
    metal: 0.45,
    attack: 0.002,
    length: 3.5,
    maximum: 0.6,
    level: 0.5,
    gated: false,
  },
  {
    highpass: 4500,
    lowpass: 10000,
    metal: 0,
    attack: 0.012,
    length: 1.2,
    maximum: 0.2,
    level: 0.55,
    gated: false,
  },
  {
    highpass: 9000,
    lowpass: 16000,
    metal: 0.2,
    attack: 0.0008,
    length: 0.25,
    maximum: 0.04,
    level: 0.6,
    gated: false,
  },
  {
    highpass: 5000,
    lowpass: 13000,
    metal: 0.8,
    attack: 0.002,
    length: 6,
    maximum: 1.2,
    level: 0.34,
    gated: false,
  },
  {
    highpass: 6000,
    lowpass: 14500,
    metal: 0.5,
    attack: 0.002,
    length: 2.6,
    maximum: 0.32,
    level: 0.52,
    gated: true,
  },
  {
    highpass: 3800,
    lowpass: 8000,
    metal: 0.25,
    attack: 0.002,
    length: 0.8,
    maximum: 0.2,
    level: 0.6,
    gated: false,
  },
  {
    highpass: 8000,
    lowpass: 16000,
    metal: 0.6,
    attack: 0.003,
    length: 4.5,
    maximum: 0.9,
    level: 0.4,
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
  snare: number;
}
const CLAPS: readonly ClapProfile[] = [
  {
    frequency: 1300,
    q: 0.9,
    bursts: 3,
    gap: 0.011,
    tail: 1,
    level: 0.62,
    hall: 0.1,
    lowpass: 9000,
    snare: 0,
  },
  {
    frequency: 1700,
    q: 1.1,
    bursts: 2,
    gap: 0.008,
    tail: 0.55,
    level: 0.6,
    hall: 0.04,
    lowpass: 10000,
    snare: 0,
  },
  {
    frequency: 1150,
    q: 0.7,
    bursts: 4,
    gap: 0.013,
    tail: 1.5,
    level: 0.6,
    hall: 0.6,
    lowpass: 8500,
    snare: 0,
  },
  {
    frequency: 2400,
    q: 1.4,
    bursts: 1,
    gap: 0,
    tail: 0.3,
    level: 0.55,
    hall: 0.05,
    lowpass: 12000,
    snare: 0,
  },
  {
    frequency: 1000,
    q: 0.8,
    bursts: 3,
    gap: 0.014,
    tail: 0.9,
    level: 0.62,
    hall: 0.08,
    lowpass: 4200,
    snare: 0,
  },
  {
    frequency: 1400,
    q: 0.9,
    bursts: 3,
    gap: 0.01,
    tail: 0.9,
    level: 0.5,
    hall: 0.14,
    lowpass: 9500,
    snare: 0.4,
  },
  {
    frequency: 1100,
    q: 0.6,
    bursts: 3,
    gap: 0.016,
    tail: 1.1,
    level: 0.42,
    hall: 0.2,
    lowpass: 5500,
    snare: 0,
  },
];

export function fluffDrumTail(track: DrumTrack): number {
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

/** Fluff drum kit: every sound slot has its own synthesis, mixed for 4/4 and breaks. */
export function fluffDrumVoice(
  context: BaseAudioContext,
  bus: FluffBus,
  track: DrumTrack,
  time: number,
  scale: MusicalScale,
): void {
  if (track.volume === 0) return;
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
    const floor = profile.floor * pitch;
    const length = Math.max(0.05, decay * profile.length);
    const body = envelope(profile.level, length, 0, 0.002);
    let target: AudioNode = body;
    if (profile.drive > 0) {
      const shaper = context.createWaveShaper();
      shaper.curve = softClipCurve(profile.drive);
      shaper.connect(body);
      nodes.push(shaper);
      target = shaper;
    }
    if (profile.lowpass > 0) {
      const dull = context.createBiquadFilter();
      dull.type = "lowpass";
      dull.frequency.value = profile.lowpass;
      dull.connect(target);
      nodes.push(dull);
      target = dull;
    }
    const sine = tone("sine", floor * profile.from, target);
    sine.frequency.exponentialRampToValueAtTime(
      floor * 1.35,
      time + profile.sweep,
    );
    sine.frequency.exponentialRampToValueAtTime(floor, time + length * 0.6);
    if (profile.click > 0) {
      noise(
        "bandpass",
        profile.clickFrequency,
        envelope(profile.click, 0.007),
        1.2,
      );
      tone("triangle", floor * 4, envelope(profile.click * 0.5, 0.012));
    }
    if (track.sound === 4)
      noise("lowpass", 900, envelope(0.2, Math.min(0.09, length)));
    end = time + length + 0.05;
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
    noise("highpass", 5200 * pitch, out).Q.value = 0.5;
    if (profile.snare > 0) {
      const source = tone(
        "sine",
        300 * pitch,
        envelope(profile.snare, Math.min(0.1, tail)),
      );
      source.frequency.exponentialRampToValueAtTime(190 * pitch, time + 0.02);
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
