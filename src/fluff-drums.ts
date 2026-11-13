import type { DrumId, DrumTrack } from "./model";
import type { FluffBus } from "./fluff-audio";

/**
 * One bundled Fluff drum sample. Files live in `public/drums/fluff/` as mono
 * 44.1 kHz 16-bit WAV, start within a millisecond of the hit, end with a fade
 * and peak at -1 dBFS. Sources and licences are listed in docs/samples.md.
 */
export interface FluffDrumSample {
  file: string;
  /** Exact file length, checked after decoding. */
  seconds: number;
  /** RMS of the first 50 ms in dBFS, measured on the bundled file. */
  loudness: number;
  /** Musical offset from the lane's common level, in dB. */
  trim: number;
  /** Seconds of sound per unit of the Decay control. */
  reach: number;
  /** Measured fundamental in Hz; tuned kicks follow the key. 0 leaves the pitch alone. */
  fundamental: number;
  /** Level of a sine sub added under kicks whose own weight sits above 70 Hz. */
  sub: number;
  /**
   * Sub polarity that sums constructively with the sample's 30–120 Hz band,
   * measured on the bundled file; unused without a sub.
   */
  polarity: 1 | -1;
  /** Fixed hall send. */
  hall: number;
}

const sample = (
  file: string,
  seconds: number,
  loudness: number,
  options: Partial<
    Pick<
      FluffDrumSample,
      "trim" | "reach" | "fundamental" | "sub" | "polarity" | "hall"
    >
  > = {},
): FluffDrumSample => ({
  file,
  seconds,
  loudness,
  polarity: options.polarity ?? 1,
  trim: options.trim ?? 0,
  reach: options.reach ?? 2,
  fundamental: options.fundamental ?? 0,
  sub: options.sub ?? 0,
  hall: options.hall ?? 0,
});

/**
 * Slot order matches `FLUFF_SOUNDS` in src/mode.ts. `null` slots (the Blip
 * and Sweep percussion) stay synthesized.
 */
export const FLUFF_DRUM_SAMPLES: Readonly<
  Record<DrumId, ReadonlyArray<FluffDrumSample | null>>
> = {
  kick: [
    sample("kick-click", 0.22, -7.8, { fundamental: 56.5, trim: 2.5 }),
    sample("kick-round", 0.447, -7.9, { fundamental: 49.8, trim: 5.5 }),
    sample("kick-deep", 0.43, -4.3, { fundamental: 46.4, trim: 4 }),
    sample("kick-tight", 0.24, -5.4, { fundamental: 65.3, trim: 4.5 }),
    sample("kick-acoustic", 0.6, -8.2, { sub: 0.7, polarity: -1 }),
    sample("kick-boom", 1.1, -5.7, {
      fundamental: 59.9,
      reach: 2.6,
      trim: 2.5,
    }),
    sample("kick-lofi", 0.5, -9.7, { sub: 0.75, polarity: -1, trim: -1 }),
  ],
  snare: [
    sample("snare-house", 0.378, -6.3, {
      reach: 2.4,
      hall: 0.05,
      trim: 1.5,
    }),
    sample("snare-rimshot", 0.6, -14.9, { reach: 2.4, hall: 0.04 }),
    sample("snare-garage", 0.278, -10.7, { reach: 2.4, hall: 0.04 }),
    sample("snare-dusty", 0.55, -12.9, { reach: 2.4, hall: 0.04 }),
    sample("snare-roll", 0.197, -14.8, {
      reach: 2.4,
      hall: 0.03,
      trim: -2,
    }),
    sample("snare-ghost", 0.35, -12, { reach: 2.4, trim: -6 }),
    sample("snare-room", 0.75, -13.5, { reach: 2.8, hall: 0.08 }),
  ],
  hat: [
    sample("hat-closed", 0.229, -13.4, { reach: 2.5 }),
    sample("hat-open", 1, -11.3, { reach: 3, trim: -2 }),
    sample("hat-shaker", 0.3, -14.2, { reach: 2.5 }),
    sample("hat-tick", 0.12, -12.9, { reach: 2 }),
    sample("hat-ride", 1.8, -16.8, { reach: 6, trim: -4 }),
    sample("hat-offbeat", 0.45, -12.2, { reach: 3, trim: 3 }),
    sample("hat-dusty", 0.35, -16.7, { reach: 2.5 }),
    sample("hat-sizzle", 0.56, -8.8, { reach: 4, trim: -1 }),
  ],
  clap: [
    sample("clap-house", 0.4, -13.1, { reach: 2.4, hall: 0.08 }),
    sample("clap-tight", 0.16, -14.5, { reach: 2.4, hall: 0.04 }),
    sample("clap-hall", 0.644, -15.7, { reach: 3, hall: 0.25 }),
    sample("clap-snap", 0.3, -16.8, { reach: 2.4, hall: 0.04 }),
    sample("clap-dusty", 0.35, -14.2, { reach: 2.4, hall: 0.06 }),
    sample("clap-layered", 0.38, -13.9, { reach: 2.4, hall: 0.1 }),
    sample("clap-soft", 0.35, -14.4, { reach: 2.4, hall: 0.12, trim: -2 }),
  ],
  rim: [
    sample("perc-rim", 0.25, -19.1, { reach: 2, trim: -2 }),
    sample("perc-tom", 1, -9.6, { reach: 3 }),
    sample("perc-conga", 0.6, -8.5, { reach: 3 }),
    sample("perc-tamb", 0.6, -16.1, { reach: 4, trim: -4 }),
    null,
    sample("perc-crash", 2.6, -17, { reach: 4, hall: 0.3, trim: -4 }),
    null,
  ],
};

/** Common sample level per lane, before the track's volume. */
const LANE_LEVEL: Readonly<Record<DrumId, number>> = {
  kick: 0.85,
  snare: 0.6,
  hat: 0.7,
  clap: 0.48,
  rim: 0.5,
};
/** Each lane's samples are levelled to this first-50 ms RMS. */
const LANE_LOUDNESS = -8;

export function fluffDrumSample(
  id: DrumId,
  sound: number,
): FluffDrumSample | null {
  return FLUFF_DRUM_SAMPLES[id][sound] ?? null;
}

export function fluffDrumUrl(drum: FluffDrumSample): string {
  return `/drums/fluff/${drum.file}.wav`;
}

/** Linear gain that brings a slot to its lane level at full volume. */
export function fluffDrumGain(id: DrumId, drum: FluffDrumSample): number {
  return (
    LANE_LEVEL[id] * 10 ** ((LANE_LOUDNESS - drum.loudness + drum.trim) / 20)
  );
}

/** Seconds a hit sounds for, before the playback rate is applied. */
export function fluffDrumGate(drum: FluffDrumSample, decay: number): number {
  return Math.min(drum.seconds, Math.max(0.03, decay * drum.reach));
}

/**
 * Playback rate for a hit. Tuned kicks move to the key frequency the caller
 * picks near their fundamental; the Pitch control offsets everything.
 */
export function fluffDrumRate(
  drum: FluffDrumSample,
  pitch: number,
  keyFrequency: (target: number) => number,
): number {
  const offset = 2 ** (pitch / 12);
  if (drum.fundamental <= 0) return offset;
  return (keyFrequency(drum.fundamental) / drum.fundamental) * offset;
}

/** Target for the added sub; the caller tunes it to the key. */
export const FLUFF_SUB_TARGET = 52;

/** Longest sound a sampled hit can make, for render tails; 0 when synthesized. */
export function fluffSampleTail(track: DrumTrack): number {
  const drum = fluffDrumSample(track.id, track.sound);
  if (!drum) return 0;
  // Key tuning can lower a kick by up to 3.5 semitones on top of Pitch.
  const rate = 2 ** ((Math.min(0, track.pitch) - 3.5) / 12);
  return fluffDrumGate(drum, track.decay) / rate + 0.05;
}

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 8000;
/** The part of an audio context the loader needs. */
export interface FluffDrumDecoder {
  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer>;
}
const encoded = new Map<string, Promise<ArrayBuffer>>();
const decoded = new WeakMap<FluffDrumDecoder, Map<string, AudioBuffer>>();
const loading = new WeakMap<FluffDrumDecoder, Promise<void>>();

function download(url: string): Promise<ArrayBuffer> {
  const cached = encoded.get(url);
  if (cached) return cached;
  const request = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("A drum sample is unavailable.");
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES)
        throw new Error("A drum sample has an invalid size.");
      return bytes;
    } finally {
      clearTimeout(timer);
    }
  })();
  encoded.set(url, request);
  // A failed request can be retried by the next load.
  request.catch(() => encoded.delete(url));
  return request;
}

async function decode(
  context: FluffDrumDecoder,
  drum: FluffDrumSample,
): Promise<void> {
  if (decoded.get(context)?.has(drum.file)) return;
  const buffer = await context.decodeAudioData(
    (await download(fluffDrumUrl(drum))).slice(0),
  );
  if (
    buffer.numberOfChannels !== 1 ||
    !Number.isFinite(buffer.duration) ||
    Math.abs(buffer.duration - drum.seconds) > 0.03
  )
    throw new Error("A drum sample has an invalid format.");
  const cache = decoded.get(context) ?? new Map<string, AudioBuffer>();
  cache.set(drum.file, buffer);
  decoded.set(context, cache);
}

/**
 * Fetch and decode every Fluff drum sample for a context. Slots that fail
 * keep their synthesized voice, so this never rejects.
 */
export function loadFluffDrums(context: FluffDrumDecoder): Promise<void> {
  const pending = loading.get(context);
  if (pending) return pending;
  const drums = Object.values(FLUFF_DRUM_SAMPLES)
    .flat()
    .filter((drum): drum is FluffDrumSample => drum !== null);
  const all = Promise.allSettled(
    drums.map((drum) => decode(context, drum)),
  ).then((results) => {
    // Let a later call retry anything that failed.
    if (results.some((result) => result.status === "rejected"))
      loading.delete(context);
  });
  loading.set(context, all);
  return all;
}

/** Wait for the samples, but never longer than `milliseconds`. */
export function fluffDrumsReady(
  context: FluffDrumDecoder,
  milliseconds: number,
): Promise<void> {
  return Promise.race([
    loadFluffDrums(context),
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
  ]);
}

export function cachedFluffDrum(
  context: FluffDrumDecoder,
  id: DrumId,
  sound: number,
): { drum: FluffDrumSample; buffer: AudioBuffer } | null {
  const drum = fluffDrumSample(id, sound);
  const buffer = drum ? decoded.get(context)?.get(drum.file) : undefined;
  return drum && buffer ? { drum, buffer } : null;
}

const driveCurves = new Map<number, Float32Array<ArrayBuffer>>();
/**
 * Soft clip for inputs up to ±2 (fed at half level): some slots run above
 * unity before Volume, and a wave shaper hard-clips anything outside ±1.
 */
function driveCurve(drive: number): Float32Array<ArrayBuffer> {
  const key = Math.round(drive * 100);
  const cached = driveCurves.get(key);
  if (cached) return cached;
  const amount = 1 + key / 12;
  const curve = new Float32Array(2048);
  for (let index = 0; index < curve.length; index++) {
    const value = ((index / (curve.length - 1)) * 2 - 1) * 2;
    curve[index] = Math.tanh(value * amount) / Math.tanh(amount);
  }
  driveCurves.set(key, curve);
  return curve;
}

/**
 * Play one sampled Fluff drum hit through the per-drum controls into the
 * Fluff drum bus. Pitch sets the playback rate, Decay gates the sample, Tone
 * tilts a high shelf, then Drive, Attack, Pan, Space and the slot's hall send.
 */
export function playFluffDrumSample(
  context: BaseAudioContext,
  bus: FluffBus,
  track: DrumTrack,
  time: number,
  drum: FluffDrumSample,
  buffer: AudioBuffer,
  keyFrequency: (target: number) => number,
): void {
  if (track.volume === 0) return;
  const nodes: AudioNode[] = [];
  const rate = fluffDrumRate(drum, track.pitch, keyFrequency);
  const gate = fluffDrumGate(drum, track.decay) / rate;
  const full = gate >= drum.seconds / rate - 0.001;
  const end = time + gate;

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  const level = context.createGain();
  const peak = track.volume * fluffDrumGain(track.id, drum);
  level.gain.value = 0;
  level.gain.setValueAtTime(peak, time);
  if (!full) {
    // Hold the hit, then fade over the last 40% of the gate.
    level.gain.setValueAtTime(peak, time + gate * 0.6);
    level.gain.linearRampToValueAtTime(0, end);
  }
  // The sample and the optional sub share every control after this point.
  const input = context.createGain();
  source.connect(level);
  level.connect(input);
  nodes.push(level, input);

  let previous: AudioNode = input;
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
    const half = context.createGain();
    half.gain.value = 0.5;
    const drive = context.createWaveShaper();
    drive.curve = driveCurve(track.drive);
    previous.connect(half);
    half.connect(drive);
    previous = drive;
    nodes.push(half, drive);
  }
  if (track.attack > 0) {
    const soften = context.createGain();
    soften.gain.value = 0;
    soften.gain.setValueAtTime(0, time);
    soften.gain.linearRampToValueAtTime(
      1,
      time + Math.max(0.002, Math.min(0.18, track.decay * 0.8) * track.attack),
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
  send(bus.hall, drum.hall);

  const sources: AudioScheduledSourceNode[] = [source];
  if (drum.sub > 0) {
    // A clean sine under the sample, in the polarity that sums with its low
    // end; it drops from just above its pitch like a kick body.
    const frequency = keyFrequency(FLUFF_SUB_TARGET) * 2 ** (track.pitch / 12);
    const sub = context.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(frequency * 1.6, time);
    sub.frequency.exponentialRampToValueAtTime(frequency, time + 0.03);
    const body = context.createGain();
    const subPeak = peak * drum.sub * drum.polarity;
    const tail = Math.max(0.05, Math.min(gate, 0.45));
    body.gain.value = 0;
    body.gain.setValueAtTime(0, time);
    body.gain.linearRampToValueAtTime(subPeak, time + 0.002);
    body.gain.setValueAtTime(subPeak, time + tail * 0.3);
    body.gain.setTargetAtTime(0, time + tail * 0.3, tail * 0.2);
    body.gain.cancelAndHoldAtTime(time + tail);
    body.gain.linearRampToValueAtTime(0, time + tail + 0.005);
    sub.connect(body);
    body.connect(input);
    nodes.push(body);
    sources.push(sub);
  }

  let remaining = sources.length;
  for (const scheduled of sources) {
    scheduled.onended = () => {
      scheduled.disconnect();
      remaining--;
      if (remaining === 0) for (const node of nodes) node.disconnect();
    };
    scheduled.start(time);
    scheduled.stop(end + 0.01);
  }
}
