import {
  automatedCloud,
  cloudGrainSeconds,
  cloudGrainsPerSecond,
} from "./cloud-model";
import type { CloudTrack } from "./cloud-model";
import { snapNote } from "./model";
import type { MusicalScale } from "./model";
import { ticksPerStep, tickSpanSeconds } from "./timing";

const materials = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();
function random(seed: number, index: number): number {
  let value = Math.imul(index + 1, 0x45d9f3b) ^ seed;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

/** Material changes along the scan axis; a short seam fade makes wraparound grains safe. */
function material(
  context: BaseAudioContext,
  sound: number,
  seed: number,
): AudioBuffer {
  let cache = materials.get(context);
  if (!cache) {
    cache = new Map();
    materials.set(context, cache);
  }
  const key = `${sound}:${seed}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const buffer = context.createBuffer(
    1,
    Math.ceil(context.sampleRate * 2),
    context.sampleRate,
  );
  const data = buffer.getChannelData(0);
  let low = 0,
    previous = 0,
    sum = 0;
  for (let index = 0; index < data.length; index++) {
    const t = index / context.sampleRate;
    const noise = random(seed, index) * 2 - 1;
    low = low * 0.94 + noise * 0.06;
    const bright = noise - previous;
    previous = noise;
    const phase = t * Math.PI * 2 * 261.625565;
    const pulse = Math.exp(-((t * (7 + sound * 3)) % 1) * 16);
    let value = 0;
    if (sound === 0)
      value =
        low * 2.6 +
        bright * pulse * 0.14 +
        Math.sin(phase) * 0.12 * (0.5 + 0.5 * Math.sin(t * 9));
    else if (sound === 1)
      value = noise * (0.05 + pulse * 0.55) + Math.sin(phase * 2) * 0.08;
    else if (sound === 2)
      value =
        Math.sin(phase + Math.sin(phase * 3.7) * (0.2 + t)) * 0.24 +
        bright * pulse * 0.13;
    else if (sound === 3)
      value =
        low * 2 +
        Math.sin(phase + Math.sin(t * 31) * 4) * (0.08 + pulse * 0.22);
    else if (sound === 4)
      value =
        (Math.sin(phase) * 0.32 +
          Math.sin(phase * 2 + Math.sin(t * 8) * 3) * 0.17 +
          low * 0.5) *
        (0.45 + 0.55 * Math.sin(t * 7) ** 2);
    else
      value =
        (Math.round(Math.sin(phase + Math.sin(phase * 4) * (t + 0.2)) * 3) /
          3) *
          0.23 +
        noise * pulse * 0.12;
    const seam = Math.min(1, index / 128, (data.length - 1 - index) / 128);
    data[index] = value * seam;
    sum += (data[index] ?? 0) ** 2;
  }
  const gain = Math.min(3, 0.22 / Math.sqrt(sum / data.length));
  for (let index = 0; index < data.length; index++)
    data[index] = Math.max(-0.85, Math.min(0.85, (data[index] ?? 0) * gain));
  if (cache.size >= 6) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, buffer);
  return buffer;
}

export function cloudTailDuration(track: CloudTrack): number {
  if (track.muted || !track.steps.some((step) => step.on && step.velocity > 0))
    return 0;
  let longest = cloudGrainSeconds(track.size);
  for (const value of track.automation.size ?? [])
    longest = Math.max(longest, cloudGrainSeconds(value));
  return longest + 0.02;
}
interface Grain {
  source: AudioBufferSourceNode;
  envelope: GainNode;
  start: number;
  end: number;
}

/** Sequence and held preview share one bounded grain bank and output bus. */
export class CloudInstrument {
  private readonly level: GainNode;
  private grains: Grain[] = [];
  private nextGrain = -1;
  private previewNext = -1;
  private previewIndex = 0;
  private preview: {
    track: CloudTrack;
    note: number;
    velocity: number;
    until: number;
  } | null = null;
  private stopped = false;
  private readonly curve: Float32Array<ArrayBuffer>;

  constructor(
    private readonly context: BaseAudioContext,
    output: AudioNode,
  ) {
    this.level = context.createGain();
    this.level.gain.value = 0.65;
    this.level.connect(output);
    this.curve = new Float32Array(1024);
    for (let index = 0; index < this.curve.length; index++) {
      const value = (index / (this.curve.length - 1)) * 2 - 1;
      this.curve[index] = Math.round(Math.tanh(value * 3) * 24) / 24 / 1.4;
    }
  }
  scheduleTick(
    track: CloudTrack,
    logicalTick: number,
    time: number,
    bpm: number,
    swing: number,
    scale: MusicalScale,
  ): void {
    if (this.stopped || this.preview) return;
    const absoluteStep = Math.floor(logicalTick / ticksPerStep(track.timing));
    const index = absoluteStep % track.steps.length;
    const resolved = automatedCloud(track, absoluteStep),
      step = track.steps[index];
    if (resolved.muted || !step?.on || step.velocity <= 0) {
      this.nextGrain = -1;
      return;
    }
    const duration = tickSpanSeconds(
      logicalTick,
      logicalTick + 1,
      bpm,
      swing,
      track.timing.grid,
    );
    if (this.nextGrain < time - 0.0001) this.nextGrain = time;
    let event = 0;
    while (this.nextGrain < time + duration - 1e-8 && event < 3) {
      this.grain(
        resolved,
        snapNote(step.note, scale, 36, 84),
        step.velocity,
        this.nextGrain,
        logicalTick * 4 + event,
      );
      this.nextGrain += 1 / cloudGrainsPerSecond(resolved.density);
      event++;
    }
  }
  audition(
    track: CloudTrack,
    note: number,
    velocity: number,
    time: number,
    sustain: boolean,
  ): void {
    if (this.stopped) return;
    if (!this.preview) {
      this.fadeGrains(time);
      this.previewNext = time;
      this.previewIndex = 0;
    }
    this.preview = {
      track: { ...track, muted: false },
      note,
      velocity,
      until: sustain ? Infinity : time + 0.24,
    };
    this.schedulePreview(time + 0.1);
  }
  schedulePreview(horizon: number): void {
    const preview = this.preview;
    if (!preview || this.stopped) return;
    if (this.context.currentTime >= preview.until) {
      this.releasePreview();
      return;
    }
    if (this.previewNext < this.context.currentTime - 0.1)
      this.previewNext = this.context.currentTime + 0.005;
    while (this.previewNext < Math.min(horizon, preview.until)) {
      this.grain(
        preview.track,
        preview.note,
        preview.velocity,
        this.previewNext,
        this.previewIndex++,
      );
      this.previewNext += 1 / cloudGrainsPerSecond(preview.track.density);
    }
  }
  get isPreviewing(): boolean {
    return this.preview !== null;
  }
  releasePreview(time = this.context.currentTime): void {
    if (!this.preview) return;
    this.preview = null;
    this.nextGrain = -1;
    this.fadeGrains(time);
  }
  private fadeGrains(time: number): void {
    for (const grain of this.grains) {
      const end = Math.max(time + 0.008, grain.start + 0.001);
      grain.envelope.gain.cancelAndHoldAtTime(time);
      grain.envelope.gain.setTargetAtTime(0, time, 0.002);
      grain.source.stop(end);
      grain.end = Math.min(grain.end, end);
    }
  }
  silence(time = this.context.currentTime): void {
    this.preview = null;
    this.nextGrain = -1;
    this.fadeGrains(time);
  }
  private grain(
    track: CloudTrack,
    note: number,
    velocity: number,
    time: number,
    event: number,
  ): void {
    this.grains = this.grains.filter((grain) => grain.end > time);
    if (this.grains.length >= 12) return;
    const context = this.context,
      length = cloudGrainSeconds(track.size);
    const source = context.createBufferSource(),
      envelope = context.createGain(),
      filter = context.createBiquadFilter(),
      pan = context.createStereoPanner();
    const dry = context.createGain(),
      wet = context.createGain(),
      shaper = context.createWaveShaper();
    source.buffer = material(context, track.sound, track.seed);
    source.loop = true;
    source.playbackRate.value = 2 ** ((note - 60) / 12);
    filter.type = "lowpass";
    filter.Q.value = 0.6;
    filter.frequency.value = Math.min(
      context.sampleRate * 0.45,
      400 * 40 ** track.tone,
    );
    pan.pan.value = (random(track.seed + 31, event) * 2 - 1) * track.width;
    shaper.curve = this.curve;
    dry.gain.value = 1 - track.roughness;
    wet.gain.value = track.roughness;
    source.connect(filter);
    filter.connect(dry);
    filter.connect(shaper);
    shaper.connect(wet);
    dry.connect(envelope);
    wet.connect(envelope);
    envelope.connect(pan);
    pan.connect(this.level);
    const amplitude =
      (track.volume * velocity * 0.85) /
      Math.sqrt(
        Math.max(1, cloudGrainsPerSecond(track.density) * length * 0.375),
      );
    const window = new Float32Array(65);
    for (let index = 0; index < window.length; index++)
      window[index] =
        amplitude * Math.sin((index / (window.length - 1)) * Math.PI) ** 2;
    envelope.gain.setValueCurveAtTime(window, time, length);
    const offset =
      (((track.scan * 1.8 +
        (random(track.seed, event) * 2 - 1) * track.scatter * 0.35) %
        2) +
        2) %
      2;
    const grain = { source, envelope, start: time, end: time + length + 0.002 };
    this.grains.push(grain);
    source.onended = () => {
      for (const node of [source, envelope, filter, pan, dry, wet, shaper])
        node.disconnect();
      this.grains = this.grains.filter((value) => value !== grain);
      source.onended = null;
    };
    source.start(time, offset);
    source.stop(grain.end);
  }
  stop(time = this.context.currentTime): void {
    if (this.stopped) return;
    this.stopped = true;
    this.preview = null;
    this.fadeGrains(time);
    this.level.gain.cancelAndHoldAtTime(time);
    this.level.gain.linearRampToValueAtTime(0, time + 0.01);
  }
  destroy(): void {
    this.stop();
    this.level.disconnect();
  }
}
