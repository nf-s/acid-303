import { randomStream } from "./fluff-synth";

/**
 * Fluff's shared effects: generated reverb impulses with band-dependent decay,
 * the reverb returns, a filtered and gently saturated ping-pong delay, and the
 * melodic bus glue.
 */

export type ReverbKind = "plate" | "hall";

interface ImpulseProfile {
  seconds: number;
  /** Band centres in Hz; the lowest is a low-pass and the highest a high-pass. */
  bands: readonly number[];
  /** RT60 in seconds for each band. */
  decay: readonly number[];
  /** Relative level of each band at the start of the tail. */
  levels: readonly number[];
  /** Seconds for the diffuse tail to build up. */
  build: number;
  /** Discrete early reflections: [seconds, level] for the left channel. */
  reflections: number;
  reflectionSpan: readonly [number, number];
  /** Share of noise common to both channels (0 is fully decorrelated). */
  correlation: number;
}

/** Plate: fast, dense build and bright but short highs. Hall: slow build, long and dark. */
const IMPULSES: Record<ReverbKind, ImpulseProfile> = {
  plate: {
    seconds: 2.6,
    bands: [180, 500, 1400, 3600, 8000, 14000],
    decay: [1.5, 1.85, 1.8, 1.45, 1.05, 0.65],
    levels: [0.8, 1, 1, 0.85, 0.6, 0.35],
    build: 0.004,
    reflections: 0,
    reflectionSpan: [0, 0],
    correlation: 0.12,
  },
  hall: {
    seconds: 6.2,
    bands: [180, 500, 1400, 3600, 8000, 14000],
    decay: [4.4, 4.9, 4.6, 3.4, 2.3, 1.3],
    levels: [0.9, 1, 0.9, 0.62, 0.38, 0.18],
    build: 0.045,
    reflections: 14,
    reflectionSpan: [0.008, 0.085],
    correlation: 0.15,
  },
};
export const FLUFF_REVERB_SECONDS: Record<ReverbKind, number> = {
  plate: IMPULSES.plate.seconds,
  hall: IMPULSES.hall.seconds,
};

/** RBJ biquad coefficients, run offline over a buffer. */
function filterInPlace(
  data: Float32Array,
  type: "lowpass" | "highpass",
  frequency: number,
  q: number,
  sampleRate: number,
): void {
  const omega =
    (2 * Math.PI * Math.min(frequency, sampleRate * 0.45)) / sampleRate;
  const alpha = Math.sin(omega) / (2 * q);
  const cosine = Math.cos(omega);
  const low = type === "lowpass";
  const b0 = low ? (1 - cosine) / 2 : (1 + cosine) / 2;
  const b1 = low ? 1 - cosine : -(1 + cosine);
  const b2 = b0;
  const a0 = 1 + alpha;
  const a1 = -2 * cosine;
  const a2 = 1 - alpha;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < data.length; index++) {
    const x = data[index] ?? 0;
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    data[index] = y;
  }
}

const impulseCache = new WeakMap<
  BaseAudioContext,
  Map<ReverbKind, AudioBuffer>
>();

/**
 * A smooth reverb tail made offline: Gaussian noise split into bands, each
 * band given its own exponential decay so highs die before lows, faded in over
 * the build time and preceded (for the hall) by sparse early reflections. The
 * two channels use mostly independent noise, so the tail is wide but sums to
 * mono without cancelling. Each channel is normalised to unit energy.
 */
export function fluffImpulse(
  context: BaseAudioContext,
  kind: ReverbKind,
): AudioBuffer {
  let cache = impulseCache.get(context);
  if (!cache) {
    cache = new Map();
    impulseCache.set(context, cache);
  }
  const cached = cache.get(kind);
  if (cached) return cached;
  const profile = IMPULSES[kind];
  const rate = context.sampleRate;
  const length = Math.ceil(rate * profile.seconds);
  const buffer = context.createBuffer(2, length, rate);
  const random = randomStream(kind === "plate" ? 7331 : 5381);
  const gaussian = (): number =>
    (random() + random() + random() + random() - 2) * 1.73;
  const common = new Float32Array(length);
  for (let index = 0; index < length; index++) common[index] = gaussian();
  const shared = Math.sqrt(profile.correlation);
  const own = Math.sqrt(1 - profile.correlation);
  const fadeOut = Math.floor(rate * 0.25);
  for (let channel = 0; channel < 2; channel++) {
    const output = buffer.getChannelData(channel);
    const noise = new Float32Array(length);
    for (let index = 0; index < length; index++)
      noise[index] = (common[index] ?? 0) * shared + gaussian() * own;
    profile.bands.forEach((centre, band) => {
      // Linkwitz-Riley crossovers (two Butterworth stages) halfway between
      // the band centres keep each band's decay its own.
      const filtered = Float32Array.from(noise);
      const below = profile.bands[band - 1];
      const above = profile.bands[band + 1];
      for (let stage = 0; stage < 2; stage++) {
        if (below !== undefined)
          filterInPlace(
            filtered,
            "highpass",
            Math.sqrt(below * centre),
            Math.SQRT1_2,
            rate,
          );
        if (above !== undefined)
          filterInPlace(
            filtered,
            "lowpass",
            Math.sqrt(above * centre),
            Math.SQRT1_2,
            rate,
          );
      }
      // Equal energy per band before the profile's levels, so the start of
      // the tail is pink rather than tilted towards the wider high bands.
      let power = 0;
      for (let index = 0; index < length; index++)
        power += (filtered[index] ?? 0) ** 2;
      const rt60 = profile.decay[band] ?? 2;
      const level =
        (profile.levels[band] ?? 0.5) /
        Math.sqrt(Math.max(1e-12, power / length));
      // −60 dB at RT60: ln(1000) ≈ 6.91.
      const step = Math.exp(-6.91 / (rt60 * rate));
      let envelope = level;
      for (let index = 0; index < length; index++) {
        output[index] =
          (output[index] ?? 0) + (filtered[index] ?? 0) * envelope;
        envelope *= step;
      }
    });
    // Build-up and a short fade at the end so the tail never cuts off.
    const build = Math.max(1, profile.build * rate);
    for (let index = 0; index < length; index++) {
      const rise = 1 - Math.exp(-index / build);
      const fall = index > length - fadeOut ? (length - index) / fadeOut : 1;
      output[index] = (output[index] ?? 0) * rise * fall;
    }
    // Early reflections at irregular times, darker and quieter as they arrive later.
    const [first, last] = profile.reflectionSpan;
    for (let reflection = 0; reflection < profile.reflections; reflection++) {
      const position = (reflection + random() * 0.9) / profile.reflections;
      const seconds = first + (last - first) * position ** 1.3;
      const index = Math.floor(seconds * rate);
      const level = (random() < 0.5 ? -1 : 1) * (0.5 - position * 0.3) * 6;
      // A short smeared tap rather than a single sample keeps it soft.
      for (let offset = 0; offset < 24 && index + offset < length; offset++) {
        const target = index + offset;
        output[target] =
          (output[target] ?? 0) +
          level * Math.sin((Math.PI * offset) / 24) * 0.25;
      }
    }
    let energy = 0;
    for (let index = 0; index < length; index++)
      energy += (output[index] ?? 0) ** 2;
    const scale = 1 / Math.sqrt(Math.max(1e-9, energy));
    for (let index = 0; index < length; index++)
      output[index] = (output[index] ?? 0) * scale;
  }
  cache.set(kind, buffer);
  return buffer;
}

/** A reverb return: pre-delay, low cut, a gentle high cut and the convolver. */
export function fluffReverb(
  context: BaseAudioContext,
  kind: ReverbKind,
  send: AudioNode,
  destination: AudioNode,
  level: number,
  nodes: AudioNode[],
): void {
  const predelay = context.createDelay(0.2);
  predelay.delayTime.value = kind === "hall" ? 0.028 : 0.012;
  const lowCut = context.createBiquadFilter();
  lowCut.type = "highpass";
  lowCut.frequency.value = 250;
  lowCut.Q.value = -3;
  const highCut = context.createBiquadFilter();
  highCut.type = "lowpass";
  highCut.frequency.value = kind === "hall" ? 9000 : 12000;
  highCut.Q.value = -3;
  const convolver = context.createConvolver();
  convolver.normalize = false;
  convolver.buffer = fluffImpulse(context, kind);
  const wet = context.createGain();
  wet.gain.value = level;
  send.connect(predelay);
  predelay.connect(lowCut);
  lowCut.connect(highCut);
  highCut.connect(convolver);
  convolver.connect(wet);
  wet.connect(destination);
  nodes.push(predelay, lowCut, highCut, convolver, wet);
}

const echoCurveCache = new WeakMap<
  BaseAudioContext,
  Float32Array<ArrayBuffer>
>();
function echoCurve(context: BaseAudioContext): Float32Array<ArrayBuffer> {
  const cached = echoCurveCache.get(context);
  if (cached) return cached;
  const curve = new Float32Array(1025);
  for (let index = 0; index < curve.length; index++) {
    const value = (index / (curve.length - 1)) * 2 - 1;
    curve[index] = Math.tanh(value * 1.6) / Math.tanh(1.6);
  }
  echoCurveCache.set(context, curve);
  return curve;
}

/**
 * A tempo-synced ping-pong: each repeat alternates sides, and the feedback
 * passes a low cut, a high cut and a soft clipper, so repeats get darker,
 * thinner and slightly rounder as they fade, like a tape or analog delay.
 */
export class FluffPingPong {
  private readonly delays: DelayNode[];

  constructor(
    context: BaseAudioContext,
    input: AudioNode,
    destination: AudioNode,
    nodes: AudioNode[],
  ) {
    const lowCut = context.createBiquadFilter();
    lowCut.type = "highpass";
    lowCut.frequency.value = 320;
    lowCut.Q.value = -3;
    const damping = context.createBiquadFilter();
    damping.type = "lowpass";
    damping.frequency.value = 4200;
    damping.Q.value = -3;
    const left = context.createDelay(2);
    const right = context.createDelay(2);
    this.delays = [left, right];
    const feedback = context.createGain();
    feedback.gain.value = 0.46;
    const saturation = context.createWaveShaper();
    saturation.curve = echoCurve(context);
    const loopCut = context.createBiquadFilter();
    loopCut.type = "highpass";
    loopCut.frequency.value = 200;
    loopCut.Q.value = -3;
    const panLeft = context.createStereoPanner();
    const panRight = context.createStereoPanner();
    panLeft.pan.value = -0.8;
    panRight.pan.value = 0.8;
    const level = context.createGain();
    level.gain.value = 0.8;
    input.connect(lowCut);
    lowCut.connect(damping);
    damping.connect(left);
    left.connect(panLeft);
    left.connect(right);
    right.connect(panRight);
    right.connect(feedback);
    feedback.connect(saturation);
    saturation.connect(loopCut);
    loopCut.connect(damping);
    panLeft.connect(level);
    panRight.connect(level);
    level.connect(destination);
    nodes.push(
      lowCut,
      damping,
      left,
      right,
      feedback,
      saturation,
      loopCut,
      panLeft,
      panRight,
      level,
    );
  }

  setTime(seconds: number, time: number, immediate: boolean): void {
    for (const delay of this.delays) {
      if (immediate) delay.delayTime.value = seconds;
      else delay.delayTime.setTargetAtTime(seconds, time, 0.05);
    }
  }
}

/**
 * Melodic bus glue: a slow, gentle compressor that sits on the sum of the
 * leads, arps and pads, then a soft clipper that only touches peaks.
 */
export function fluffGlue(
  context: BaseAudioContext,
  input: AudioNode,
  destination: AudioNode,
  nodes: AudioNode[],
): void {
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 12;
  compressor.ratio.value = 2;
  compressor.attack.value = 0.02;
  compressor.release.value = 0.25;
  const makeup = context.createGain();
  makeup.gain.value = 1.15;
  input.connect(compressor);
  compressor.connect(makeup);
  makeup.connect(destination);
  nodes.push(compressor, makeup);
}
