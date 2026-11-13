/**
 * Fluff's melodic voice engine: unison oscillator stacks, FM pairs, filtered
 * noise, key-tracked 12/24 dB filters with exponential envelopes, and a
 * per-instrument rack (gentle oversampled drive, stereo ensemble chorus,
 * shared vibrato and filter LFOs). Patches are plain data built per note.
 */

export type Wave =
  "sine" | "triangle" | "saw" | "square" | "pulse" | "organ" | "hollow";

/** A stack of identical oscillators spread in pitch and across the stereo field. */
export interface OscLayer {
  kind: "osc";
  wave: Wave;
  /** Multiple of the note frequency. */
  ratio: number;
  /** 1–9 oscillators. */
  voices: number;
  /** Cents between the centre and the outermost voice. */
  detune: number;
  /** Level of the centre voice relative to the side voices (supersaw mix). */
  center?: number;
  /** Alternate the side voices hard left and right; otherwise keep them central. */
  spread: boolean;
  level: number;
  /** Fixed offset in cents. */
  cents?: number;
  /** Seconds for this layer to fall to `hold` of its level (key click, hammer). */
  fall?: number;
  hold?: number;
  /** Seconds for this layer to fade in. */
  rise?: number;
}

/** A sine carrier phase-modulated by a sine, with a decaying index (DX style). */
export interface FmLayer {
  kind: "fm";
  ratio: number;
  modRatio: number;
  /** Peak modulation index (radians of phase deviation). */
  index: number;
  /** Seconds for the index to fall to `indexHold` of its peak. */
  indexFall: number;
  indexHold: number;
  level: number;
  /** Pan of this layer, −1 to 1. */
  pan: number;
  cents?: number;
  fall?: number;
  hold?: number;
  rise?: number;
}

/** Looped noise through its own filter: breath, air, hammer or bow. */
export interface NoiseLayer {
  kind: "noise";
  filter: BiquadFilterType;
  /** Filter frequency as a multiple of the note frequency, or Hz when `fixed`. */
  frequency: number;
  fixed?: boolean;
  q: number;
  level: number;
  fall?: number;
  hold?: number;
  rise?: number;
}

export type Layer = OscLayer | FmLayer | NoiseLayer;

export interface FilterSpec {
  type: "lowpass" | "highpass" | "bandpass";
  /** 2 for 12 dB, 4 for 24 dB per octave. */
  poles: 2 | 4;
  /** Cutoff in Hz at middle C before key tracking and the envelope. */
  cutoff: number;
  /** 0 holds the cutoff for every note; 1 follows the pitch exactly. */
  keyTrack: number;
  /** Resonance in dB on the last stage (lowpass/highpass) or Q (bandpass). */
  resonance: number;
  /** Envelope depth in octaves above the cutoff. */
  envelope: number;
  envAttack: number;
  /** Seconds for the envelope to fall most of the way to `envSustain`. */
  envDecay: number;
  envSustain: number;
  /** Slow LFO depth in cents from the rack's filter modulation, 0–1. */
  lfo?: number;
}

/** Parallel band-pass formants, used instead of a low-pass for vowel sounds. */
export interface FormantSpec {
  /** Formant centre frequencies in Hz. */
  frequencies: readonly number[];
  gains: readonly number[];
  q: number;
  /** Formants a vowel earlier, glided to `frequencies` over `glide` seconds. */
  from?: readonly number[];
  glide?: number;
}

export interface AmpSpec {
  attack: number;
  /** Seconds to fall most of the way to sustain. */
  decay: number;
  sustain: number;
  release: number;
}

export interface VoiceSpec {
  layers: readonly Layer[];
  filter: FilterSpec | null;
  formant?: FormantSpec;
  amp: AmpSpec;
  /** Random per-voice tuning in cents, fixed for the length of a note. */
  drift: number;
  /** Follow the rack's shared slow pitch wander (depth set by the rack). */
  wander: boolean;
  /** 0–1 mix of a slow four-stage phaser after the amp. */
  phaser?: number;
  level: number;
}

/** A deterministic random stream so renders are repeatable. */
export function randomStream(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const waveCache = new WeakMap<BaseAudioContext, Map<Wave, PeriodicWave>>();
/**
 * Band-limited custom waves. The browser removes partials above Nyquist per
 * pitch range, so these stay alias-free across the keyboard.
 */
function customWave(context: BaseAudioContext, wave: Wave): PeriodicWave {
  let waves = waveCache.get(context);
  if (!waves) {
    waves = new Map();
    waveCache.set(context, waves);
  }
  const cached = waves.get(wave);
  if (cached) return cached;
  const size = 512;
  const real = new Float32Array(size);
  const imaginary = new Float32Array(size);
  if (wave === "pulse") {
    // A 28% pulse: hollower than a square, rounder than a saw.
    for (let harmonic = 1; harmonic < size; harmonic++)
      imaginary[harmonic] =
        (2 / (harmonic * Math.PI)) * Math.sin(harmonic * Math.PI * 0.28);
  } else if (wave === "organ") {
    // Drawbars 8', 4', 2⅔', 2' and a little 1⅓' and 1': the house organ.
    const bars: ReadonlyArray<readonly [number, number]> = [
      [1, 1],
      [2, 0.72],
      [3, 0.5],
      [4, 0.42],
      [6, 0.16],
      [8, 0.12],
    ];
    for (const [harmonic, level] of bars) imaginary[harmonic] = level;
  } else {
    // Hollow: odd partials with a little even content, like a narrowed square.
    for (let harmonic = 1; harmonic < size; harmonic++)
      imaginary[harmonic] = (harmonic % 2 === 1 ? 1 : 0.18) / harmonic;
  }
  const created = context.createPeriodicWave(real, imaginary);
  waves.set(wave, created);
  return created;
}

export function setWave(
  context: BaseAudioContext,
  oscillator: OscillatorNode,
  wave: Wave,
): void {
  if (wave === "sine" || wave === "triangle" || wave === "square")
    oscillator.type = wave;
  else if (wave === "saw") oscillator.type = "sawtooth";
  else oscillator.setPeriodicWave(customWave(context, wave));
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
export function fluffNoise(context: BaseAudioContext): AudioBuffer {
  const cached = noiseCache.get(context);
  if (cached) return cached;
  const buffer = context.createBuffer(
    1,
    Math.ceil(context.sampleRate * 2),
    context.sampleRate,
  );
  const data = buffer.getChannelData(0);
  const random = randomStream(90210);
  for (let index = 0; index < data.length; index++)
    data[index] = random() * 2 - 1;
  noiseCache.set(context, buffer);
  return buffer;
}

const driveCache = new WeakMap<BaseAudioContext, Float32Array<ArrayBuffer>>();
/** A smooth tanh curve; the rack sets how hard it is driven. */
function driveCurve(context: BaseAudioContext): Float32Array<ArrayBuffer> {
  const cached = driveCache.get(context);
  if (cached) return cached;
  const curve = new Float32Array(2049);
  for (let index = 0; index < curve.length; index++) {
    const value = ((index / (curve.length - 1)) * 2 - 1) * 4;
    // A touch of asymmetry adds even harmonics, like a tube or tape stage.
    curve[index] = Math.tanh(value + 0.04 * value * value);
  }
  driveCache.set(context, curve);
  return curve;
}

/** Shared modulation sources owned by the Fluff bus and stopped with it. */
export interface FluffModulation {
  /** ±1 at about 5.4 Hz, for vibrato. */
  vibrato: AudioNode;
  /** ±1, two slow sines summed: pitch wander and drift. */
  wander: AudioNode;
  /** The same wander, inverted, for the other half of a stack. */
  wanderInverse: AudioNode;
  /** ±1 at about 0.2 Hz, for slow filter movement. */
  slow: AudioNode;
  /** ±1 at about 0.11 Hz, for phaser sweeps. */
  phaser: AudioNode;
  /** ±1 triangle-ish at about 0.6 Hz and its inverse, for chorus. */
  chorus: AudioNode;
  chorusInverse: AudioNode;
}

export function createModulation(
  context: BaseAudioContext,
  nodes: AudioNode[],
  sources: OscillatorNode[],
): FluffModulation {
  const oscillator = (frequency: number, type: OscillatorType) => {
    const created = context.createOscillator();
    created.type = type;
    created.frequency.value = frequency;
    sources.push(created);
    return created;
  };
  const gain = (value: number): GainNode => {
    const created = context.createGain();
    created.gain.value = value;
    nodes.push(created);
    return created;
  };
  const vibrato = gain(1);
  oscillator(5.3, "sine").connect(vibrato);
  const wander = gain(0.6);
  const wanderInverse = gain(-0.6);
  for (const frequency of [0.13, 0.31]) {
    const source = oscillator(frequency, "sine");
    source.connect(wander);
    source.connect(wanderInverse);
  }
  const slow = gain(1);
  oscillator(0.19, "sine").connect(slow);
  const phaser = gain(1);
  oscillator(0.11, "triangle").connect(phaser);
  const chorus = gain(1);
  const chorusInverse = gain(-1);
  const chorusSource = oscillator(0.55, "triangle");
  chorusSource.connect(chorus);
  chorusSource.connect(chorusInverse);
  for (const source of sources) source.start();
  return {
    vibrato,
    wander,
    wanderInverse,
    slow,
    phaser,
    chorus,
    chorusInverse,
  };
}

export interface RackSettings {
  /** 0–1: gentle warmth at 0, clearly driven at 1. */
  drive: number;
  /** 0–1 wet level of the stereo ensemble. */
  chorus: number;
  /** Cents of vibrato. */
  vibrato: number;
  /** Seconds before vibrato fades in, from `time`. */
  vibratoDelay: number;
  /** Cents of slow filter movement for voices whose filter follows the LFO. */
  filterLfo: number;
  /** Cents of slow pitch wander for voices that follow it. */
  wander: number;
  /** Cents the phaser sweeps. */
  phaser: number;
}

/**
 * Per-instrument processing after the voices: drive into a 2× oversampled
 * soft clipper, then a two-tap ensemble chorus panned left and right.
 */
export class FluffRack {
  readonly input: GainNode;
  readonly output: GainNode;
  /** Voices connect this to their oscillator detune for vibrato. */
  readonly vibrato: GainNode;
  /** Voices connect this to their filter detune for slow movement. */
  readonly filterMod: GainNode;
  /** Voices connect this to their phaser all-passes. */
  readonly phaserMod: GainNode;
  /** Voices connect these to oscillator detune for shared pitch wander. */
  readonly wander: GainNode;
  readonly wanderInverse: GainNode;
  private readonly pre: GainNode;
  private readonly post: GainNode;
  private readonly chorusWet: GainNode;
  private readonly chorusDry: GainNode;
  private readonly nodes: AudioNode[] = [];
  private readonly taps: Array<[AudioNode, AudioNode | AudioParam]> = [];
  private destroyed = false;

  constructor(
    context: BaseAudioContext,
    readonly modulation: FluffModulation,
  ) {
    const gain = (value: number): GainNode => {
      const created = context.createGain();
      created.gain.value = value;
      this.nodes.push(created);
      return created;
    };
    this.input = gain(1);
    this.output = gain(1);
    this.pre = gain(0.5);
    this.post = gain(1);
    const shaper = context.createWaveShaper();
    shaper.curve = driveCurve(context);
    shaper.oversample = "2x";
    this.nodes.push(shaper);
    this.input.connect(this.pre);
    this.pre.connect(shaper);
    shaper.connect(this.post);

    this.chorusDry = gain(1);
    this.chorusWet = gain(0);
    this.post.connect(this.chorusDry);
    this.chorusDry.connect(this.output);
    this.post.connect(this.chorusWet);
    // Two delays swept in opposite directions, one per side.
    for (const [index, side] of [-1, 1].entries()) {
      const delay = context.createDelay(0.05);
      delay.delayTime.value = index === 0 ? 0.0071 : 0.0093;
      const depth = gain(0.0021);
      const pan = context.createStereoPanner();
      pan.pan.value = side;
      this.nodes.push(delay, pan);
      const source = index === 0 ? modulation.chorus : modulation.chorusInverse;
      source.connect(depth);
      this.taps.push([source, depth]);
      depth.connect(delay.delayTime);
      this.chorusWet.connect(delay);
      delay.connect(pan);
      pan.connect(this.output);
    }

    this.vibrato = gain(0);
    modulation.vibrato.connect(this.vibrato);
    this.taps.push([modulation.vibrato, this.vibrato]);
    this.filterMod = gain(0);
    modulation.slow.connect(this.filterMod);
    this.taps.push([modulation.slow, this.filterMod]);
    this.phaserMod = gain(0);
    modulation.phaser.connect(this.phaserMod);
    this.taps.push([modulation.phaser, this.phaserMod]);
    this.wander = gain(1);
    modulation.wander.connect(this.wander);
    this.taps.push([modulation.wander, this.wander]);
    this.wanderInverse = gain(1);
    modulation.wanderInverse.connect(this.wanderInverse);
    this.taps.push([modulation.wanderInverse, this.wanderInverse]);
  }

  /** Apply one note's rack settings; long notes keep the latest values. */
  set(settings: RackSettings, time: number, immediate = false): void {
    const ramp = (parameter: AudioParam, value: number): void => {
      parameter.cancelAndHoldAtTime(time);
      if (immediate) parameter.setValueAtTime(value, time);
      else parameter.setTargetAtTime(value, time, 0.03);
    };
    // No drive still rounds peaks; full drive is about 33 dB into the curve.
    const drive = Math.max(0, Math.min(1, settings.drive));
    const pre = 0.3 * 2 ** (drive * 5.5);
    ramp(this.pre.gain, pre);
    // The curve's small-signal gain is 4 × pre; make-up follows it partly,
    // because clipped audio is denser and sounds louder at the same peak.
    ramp(this.post.gain, (4 * pre) ** -0.6);
    const wet = Math.max(0, Math.min(1, settings.chorus));
    ramp(this.chorusWet.gain, wet * 0.7);
    ramp(this.chorusDry.gain, 1 - wet * 0.3);
    ramp(this.filterMod.gain, settings.filterLfo);
    ramp(this.wander.gain, settings.wander);
    ramp(this.phaserMod.gain, settings.phaser);
    ramp(this.wanderInverse.gain, settings.wander);
    const vibrato = this.vibrato.gain;
    vibrato.cancelAndHoldAtTime(time);
    if (settings.vibrato <= 0) vibrato.setTargetAtTime(0, time, 0.05);
    else {
      vibrato.setTargetAtTime(0, time, 0.01);
      vibrato.setTargetAtTime(
        settings.vibrato,
        time + settings.vibratoDelay,
        0.18,
      );
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const [source, target] of this.taps) {
      if (target instanceof AudioParam) source.disconnect(target);
      else source.disconnect(target);
    }
    for (const node of this.nodes) node.disconnect();
  }
}

export interface SynthVoice {
  end: number;
  readonly amp: GainNode;
  readonly filters: readonly BiquadFilterNode[];
  readonly sources: ReadonlyArray<OscillatorNode | AudioBufferSourceNode>;
  /** Stereo crossfeed gains: 0 keeps the sides apart, 1 makes the voice mono. */
  readonly cross: readonly GainNode[];
  /** Fade out quickly and stop, for transport stops and voice stealing. */
  stop(time: number): void;
  /** Move every source's stop time (pads that change length). */
  stopAt(time: number): void;
}

export interface VoiceRequest {
  spec: VoiceSpec;
  /** One frequency per note; chords share one filter and envelope. */
  frequencies: readonly number[];
  time: number;
  /** Seconds before the release starts; ignored when `manualAmp` is set. */
  gate: number;
  /** Extra filter octaves and level for accented notes. */
  accent: boolean;
  /** 0–1 stereo width of the stacks. */
  width: number;
  /** −1 to 1 pan of the whole voice. */
  pan: number;
  seed: number;
  /** The caller drives the amp gain itself (pads). */
  manualAmp?: boolean;
  onEnded?: () => void;
}

/** Cutoff after key tracking, clamped to a safe range. */
export function trackedCutoff(
  filter: FilterSpec,
  frequency: number,
  maximum: number,
): number {
  const tracked = filter.cutoff * (frequency / 261.63) ** filter.keyTrack;
  return Math.max(30, Math.min(maximum, tracked));
}

/** Unison positions from −1 to 1, denser near the centre as in the JP supersaw. */
function unisonPositions(voices: number, random: () => number): number[] {
  if (voices <= 1) return [0];
  const positions: number[] = [];
  for (let voice = 0; voice < voices; voice++) {
    const linear = (voice / (voices - 1)) * 2 - 1;
    const curved = Math.sign(linear) * Math.abs(linear) ** 1.5;
    const jitter = linear === 0 ? 0 : (random() - 0.5) * 0.08;
    positions.push(curved + jitter);
  }
  return positions;
}

/** Build and schedule one note or chord. Every node is released when the last source ends. */
export function playSynthVoice(
  context: BaseAudioContext,
  rack: FluffRack,
  output: AudioNode,
  request: VoiceRequest,
): SynthVoice {
  const { spec, time } = request;
  const random = randomStream(request.seed);
  const sources: Array<OscillatorNode | AudioBufferSourceNode> = [];
  const nodes: AudioNode[] = [];
  const params: Array<[AudioNode, AudioParam]> = [];
  const maximum = Math.min(19000, context.sampleRate * 0.45);
  const frequencies = request.frequencies.length
    ? request.frequencies
    : [261.63];
  const lowest = Math.min(...frequencies);
  const gate = Math.max(0.01, request.gate);
  const accent = request.accent ? 1 : 0;
  const width = Math.max(0, Math.min(1, request.width));
  const chordScale = 1 / Math.sqrt(frequencies.length);

  const gain = (value: number): GainNode => {
    const created = context.createGain();
    created.gain.value = value;
    nodes.push(created);
    return created;
  };
  const merger = context.createChannelMerger(2);
  nodes.push(merger);
  // Each side also feeds the other through `cross`, so Width can narrow the voice.
  const crossToRight = gain(0);
  const crossToLeft = gain(0);
  crossToRight.connect(merger, 0, 1);
  crossToLeft.connect(merger, 0, 0);
  const cross = (1 - width) * 0.85;
  crossToRight.gain.value = cross;
  crossToLeft.gain.value = cross;
  // Equal power for the uncorrelated sides as Width narrows the voice.
  const sideGain = 1 / Math.sqrt(1 + cross * cross);

  const envelopeLayer = (
    target: GainNode,
    level: number,
    layer: { fall?: number; hold?: number; rise?: number },
  ): void => {
    const parameter = target.gain;
    if (layer.rise !== undefined && layer.rise > 0) {
      parameter.setValueAtTime(0, time);
      parameter.setTargetAtTime(level, time, layer.rise / 3);
    } else parameter.setValueAtTime(level, time);
    if (layer.fall !== undefined && layer.fall > 0)
      parameter.setTargetAtTime(
        level * (layer.hold ?? 0),
        time + (layer.rise ?? 0),
        layer.fall / 3,
      );
  };
  /** A layer's left/right sums, already scaled by its level. */
  const stereoPair = (
    level: number,
    layer: { fall?: number; hold?: number; rise?: number },
    pan = 0,
  ): [GainNode, GainNode] => {
    const left = gain(0);
    const right = gain(0);
    left.connect(merger, 0, 0);
    left.connect(crossToRight);
    right.connect(merger, 0, 1);
    right.connect(crossToLeft);
    const balance = Math.max(-1, Math.min(1, pan));
    envelopeLayer(left, level * sideGain * Math.min(1, 1 - balance), layer);
    envelopeLayer(right, level * sideGain * Math.min(1, 1 + balance), layer);
    return [left, right];
  };
  const startTime = (frequency: number): number =>
    // Starting up to one cycle early gives every oscillator a random phase.
    Math.max(0, time - Math.min(0.02, random() / Math.max(20, frequency)));
  const oscillatorAt = (
    wave: Wave,
    frequency: number,
    cents: number,
  ): OscillatorNode => {
    const oscillator = context.createOscillator();
    setWave(context, oscillator, wave);
    oscillator.frequency.value = frequency;
    oscillator.detune.value = cents;
    rack.vibrato.connect(oscillator.detune);
    params.push([rack.vibrato, oscillator.detune]);
    if (spec.wander) {
      // Half the stack wanders one way and half the other, so it never moves in step.
      const wander = random() < 0.5 ? rack.wander : rack.wanderInverse;
      wander.connect(oscillator.detune);
      params.push([wander, oscillator.detune]);
    }
    sources.push(oscillator);
    return oscillator;
  };

  // Shared filters (stereo), then the amp.
  const filters: BiquadFilterNode[] = [];
  const amp = gain(0);
  let source: AudioNode = merger;
  if (spec.formant) {
    const formant = spec.formant;
    const formantSum = gain(1);
    formant.frequencies.forEach((frequency, index) => {
      const band = context.createBiquadFilter();
      band.type = "bandpass";
      band.Q.value = formant.q;
      const start = formant.from?.[index] ?? frequency;
      band.frequency.setValueAtTime(start, time);
      band.frequency.setTargetAtTime(
        frequency,
        time,
        Math.max(0.005, (formant.glide ?? 0.05) / 3),
      );
      const level = gain(formant.gains[index] ?? 0.5);
      merger.connect(band);
      band.connect(level);
      level.connect(formantSum);
      nodes.push(band);
    });
    source = formantSum;
  }
  if (spec.filter) {
    const filter = spec.filter;
    const cutoff = trackedCutoff(filter, lowest, maximum);
    const stages = filter.poles === 4 ? 2 : 1;
    let previous: AudioNode = source;
    for (let stage = 0; stage < stages; stage++) {
      const biquad = context.createBiquadFilter();
      biquad.type = filter.type;
      biquad.frequency.value = cutoff;
      const last = stage === stages - 1;
      if (filter.type === "bandpass") biquad.Q.value = filter.resonance;
      else if (stages === 2)
        biquad.Q.value = last ? 2.3 + filter.resonance : -5.3;
      else biquad.Q.value = -3 + filter.resonance;
      previous.connect(biquad);
      previous = biquad;
      filters.push(biquad);
      nodes.push(biquad);
    }
    previous.connect(amp);
    // The envelope moves detune, so its shape is exponential in pitch.
    const peakOctaves = Math.max(0, filter.envelope + accent * 0.6);
    const ceiling = Math.log2(maximum / cutoff);
    const peak = Math.min(peakOctaves, Math.max(0, ceiling)) * 1200;
    const sustain = peak * filter.envSustain;
    const attackEnd = time + Math.max(0.001, filter.envAttack);
    for (const biquad of filters) {
      const detune = biquad.detune;
      detune.setValueAtTime(filter.envAttack > 0.004 ? 0 : peak, time);
      if (filter.envAttack > 0.004)
        detune.linearRampToValueAtTime(peak, attackEnd);
      detune.setTargetAtTime(
        sustain,
        attackEnd,
        Math.max(0.004, filter.envDecay / 3),
      );
      if ((filter.lfo ?? 0) > 0) {
        rack.filterMod.connect(detune);
        params.push([rack.filterMod, detune]);
      }
    }
  } else source.connect(amp);

  // Centred voices skip the panner.
  let panner: AudioNode = output;
  if (request.pan !== 0) {
    const stereo = context.createStereoPanner();
    stereo.pan.value = Math.max(-1, Math.min(1, request.pan));
    stereo.connect(output);
    nodes.push(stereo);
    panner = stereo;
  }
  if (spec.phaser && spec.phaser > 0) {
    // Four swept all-passes mixed with the dry signal: a slow string phaser.
    const dry = gain(1 - spec.phaser * 0.5);
    const wet = gain(spec.phaser * 0.5);
    amp.connect(dry);
    dry.connect(panner);
    let previous: AudioNode = amp;
    for (let stage = 0; stage < 4; stage++) {
      const allpass = context.createBiquadFilter();
      allpass.type = "allpass";
      allpass.frequency.value = 300 * 2.2 ** stage;
      allpass.Q.value = 0.6;
      rack.phaserMod.connect(allpass.detune);
      params.push([rack.phaserMod, allpass.detune]);
      previous.connect(allpass);
      previous = allpass;
      nodes.push(allpass);
    }
    previous.connect(wet);
    wet.connect(panner);
  } else amp.connect(panner);

  // Sources.
  for (const layer of spec.layers) {
    if (layer.kind === "osc") {
      const voices = Math.max(1, Math.min(9, Math.round(layer.voices)));
      const center = layer.center ?? 1;
      const positions = unisonPositions(voices, random);
      const energy = positions.reduce(
        (sum, position) => sum + (position === 0 ? center * center : 1),
        0,
      );
      const level = (layer.level * chordScale) / Math.sqrt(energy);
      const [left, right] = stereoPair(level, layer);
      let centerGain: GainNode | null = null;
      if (positions.includes(0) && center !== 1) {
        centerGain = gain(center);
        centerGain.connect(left);
        centerGain.connect(right);
      }
      for (const frequency of frequencies) {
        positions.forEach((position, index) => {
          const cents =
            position * layer.detune +
            (layer.cents ?? 0) +
            (random() - 0.5) * 2 * spec.drift;
          const oscillator = oscillatorAt(
            layer.wave,
            frequency * layer.ratio,
            cents,
          );
          if (position === 0) {
            // The centre voice sits in both channels.
            if (centerGain) oscillator.connect(centerGain);
            else {
              oscillator.connect(left);
              oscillator.connect(right);
            }
          } else {
            // Side voices alternate hard left and right; Width narrows the
            // whole voice through the crossfeed, which costs no extra nodes.
            if (layer.spread)
              oscillator.connect(index % 2 === 0 ? left : right);
            else {
              oscillator.connect(left);
              oscillator.connect(right);
            }
          }
          oscillator.start(startTime(frequency * layer.ratio));
        });
      }
    } else if (layer.kind === "fm") {
      const level = layer.level * chordScale;
      const [left, right] = stereoPair(level, layer, layer.pan);
      for (const frequency of frequencies) {
        const carrierFrequency = frequency * layer.ratio;
        const carrier = oscillatorAt(
          "sine",
          carrierFrequency,
          (layer.cents ?? 0) + (random() - 0.5) * 2 * spec.drift,
        );
        const modulator = context.createOscillator();
        modulator.frequency.value = frequency * layer.modRatio;
        sources.push(modulator);
        const depth = gain(0);
        // Keep the modulator and the sidebands below Nyquist on high notes.
        const modulatorFrequency = frequency * layer.modRatio;
        const room = (maximum * 0.9 - carrierFrequency) / modulatorFrequency;
        const index = Math.max(0, Math.min(layer.index, room - 1));
        // Phase modulation index → frequency deviation in Hz.
        const deviation = index * modulatorFrequency;
        depth.gain.setValueAtTime(deviation * (1 + accent * 0.35), time);
        depth.gain.setTargetAtTime(
          deviation * layer.indexHold,
          time,
          Math.max(0.003, layer.indexFall / 3),
        );
        modulator.connect(depth);
        depth.connect(carrier.frequency);
        carrier.connect(left);
        carrier.connect(right);
        carrier.start(startTime(carrierFrequency));
        modulator.start(time);
      }
    } else {
      const level = layer.level * chordScale;
      const [left, right] = stereoPair(level, layer);
      for (const frequency of frequencies) {
        const noise = context.createBufferSource();
        noise.buffer = fluffNoise(context);
        noise.loop = true;
        const band = context.createBiquadFilter();
        band.type = layer.filter;
        band.frequency.value = Math.min(
          maximum,
          layer.fixed ? layer.frequency : frequency * layer.frequency,
        );
        band.Q.value = layer.q;
        noise.connect(band);
        band.connect(left);
        band.connect(right);
        nodes.push(band);
        sources.push(noise);
        noise.start(time, random() * 1.8);
      }
    }
  }

  // Amplitude envelope.
  const level = spec.level * (1 + accent * 0.2);
  const parameter = amp.gain;
  const { attack, decay, sustain, release } = spec.amp;
  let end: number;
  parameter.setValueAtTime(0, time);
  if (request.manualAmp) end = time + gate;
  else {
    const attackSeconds = Math.max(0.0015, attack);
    if (attackSeconds > 0.03) {
      // Long attacks rise on a curve, which sounds smoother than a line.
      parameter.setTargetAtTime(level * 1.02, time, attackSeconds / 3);
      parameter.cancelAndHoldAtTime(time + attackSeconds);
    } else parameter.linearRampToValueAtTime(level, time + attackSeconds);
    const decayStart = time + attackSeconds;
    if (sustain <= 0.001) {
      parameter.setTargetAtTime(0, decayStart, Math.max(0.005, decay / 4.6));
      const releaseStart = Math.max(decayStart + 0.004, time + gate);
      parameter.cancelAndHoldAtTime(releaseStart);
      parameter.setTargetAtTime(
        0,
        releaseStart,
        Math.max(0.005, release / 4.6),
      );
      end = Math.min(decayStart + decay * 1.3, releaseStart + release * 1.3);
      end = Math.max(end, decayStart + 0.02);
    } else {
      parameter.setTargetAtTime(
        level * sustain,
        decayStart,
        Math.max(0.005, decay / 3),
      );
      const releaseStart = Math.max(decayStart + 0.004, time + gate);
      parameter.cancelAndHoldAtTime(releaseStart);
      parameter.setTargetAtTime(
        0,
        releaseStart,
        Math.max(0.005, release / 4.6),
      );
      end = releaseStart + release * 1.3;
      // The filter closes a little through the release, as with a real envelope.
      for (const biquad of filters)
        if (spec.filter && spec.filter.envSustain > 0) {
          biquad.detune.cancelAndHoldAtTime(releaseStart);
          biquad.detune.setTargetAtTime(
            0,
            releaseStart,
            Math.max(0.01, release / 3),
          );
        }
    }
    parameter.cancelAndHoldAtTime(end - 0.01);
    parameter.linearRampToValueAtTime(0, end);
  }

  let remaining = sources.length;
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const [node, target] of params) node.disconnect(target);
    for (const node of nodes) node.disconnect();
    request.onEnded?.();
  };
  for (const node of sources) {
    node.onended = () => {
      node.disconnect();
      remaining--;
      if (remaining === 0) dispose();
    };
    node.stop(end + 0.02);
  }
  const voice: SynthVoice = {
    end,
    amp,
    filters,
    sources,
    cross: [crossToLeft, crossToRight],
    stop(stopTime: number): void {
      if (stopTime >= voice.end) return;
      parameter.cancelAndHoldAtTime(stopTime);
      parameter.linearRampToValueAtTime(0, stopTime + 0.012);
      voice.end = stopTime + 0.012;
      for (const node of sources) node.stop(stopTime + 0.02);
    },
    stopAt(stopTime: number): void {
      voice.end = stopTime;
      for (const node of sources) node.stop(stopTime + 0.02);
    },
  };
  if (sources.length === 0) dispose();
  return voice;
}
