import { encodeWav } from "./wav";
export { encodeWav } from "./wav";
import { CloudInstrument, cloudTailDuration } from "./cloud-audio";
import { TensionInstrument, tensionTailDuration } from "./tension-audio";
import type { CloudTrack } from "./cloud-model";
import type { TensionTrack } from "./tension-model";
import { VocalInstrument, vocalTailDuration } from "./vocal-audio";
import { loadVocalSample, vocalSourceKey } from "./vocal-samples";
import { fluffDrumsReady, loadFluffDrums } from "./fluff-drums";
import type { LoadedVocalSample, VocalSampleStatus } from "./vocal-samples";
import { resolveVocalTrim } from "./vocal-model";
import type { VocalTrack } from "./vocal-model";
import {
  automationStepCount,
  ticksPerStep,
  trackStepCount,
  trackCycleTicks,
  swungTick,
  unswungTick,
  tickSeconds,
  tickSpanSeconds,
} from "./timing";
import { arpRateTicks } from "./arp-model";
import {
  automatedBass,
  automatedDrum,
  automatedKeys,
  scaleNotes,
  snapNote,
  exportPlan,
  playbackFrame,
  projectUsesFamily,
  trackFamily,
} from "./model";
import { ArpInstrument, arpTailDuration } from "./arp-audio";
import {
  FLUFF_HALL_SECONDS,
  FluffBass,
  FluffBus,
  FluffLead,
  fluffDrumTail,
  fluffDrumVoice,
  fluffLeadTail,
} from "./fluff-audio";
import { FLUFF_REVERB_SECONDS, fluffImpulse } from "./fluff-effects";
import type { ReverbKind } from "./fluff-effects";
import type { ProjectMode } from "./mode";
import { PadInstrument, padTailDuration } from "./pad-audio";
import { scheduleChordPreview } from "./chord-preview";
import type { PreviewChord } from "./progression-model";
import type {
  BassTrack,
  DrumTrack,
  FamilyTrack,
  KeysTrack,
  MusicalScale,
  Project,
  PlaybackFrame,
  InstrumentId,
} from "./model";

type ScheduledSource = OscillatorNode | AudioBufferSourceNode;

interface AudioGraph {
  mode: ProjectMode;
  /**
   * Fluff's ducked mix bus and sends. A Fluff project builds it with the
   * graph; a Grain project builds it only when a track first plays a Fluff
   * sound, and it then feeds Grain's master chain (see `fluffBus`).
   */
  fluff: FluffBus | null;
  fluffLead: FluffLead | null;
  fluffMaterial: GainNode | null;
  fluffVocal: GainNode | null;
  context: BaseAudioContext;
  fx: PerformanceFx;
  fxInput: AudioNode;
  input: GainNode;
  cleanInput: GainNode;
  melodicInput: GainNode;
  /** Where Grain bass and Grain melodic voices go: Grain's inputs, or Fluff's bass and melodic buses. */
  grainBass: AudioNode;
  grainMelodic: AudioNode;
  dry: GainNode;
  wet: GainNode;
  distortion: WaveShaperNode;
  compressor: DynamicsCompressorNode;
  master: GainNode;
  analyser: AnalyserNode;
  noise: AudioBuffer;
  textureRoom: AudioBuffer | null;
  sources: Set<ScheduledSource>;
  drive: number;
  bpm: number;
  scale: MusicalScale;
}

const MIN_GAIN = 0.0001;
const LOOKAHEAD = 0.1;
const WAV_SAMPLE_RATE = 44100;

export function midiFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

export function tiesNextStep(
  steps: ReadonlyArray<{ on: boolean; slide: boolean }>,
  step: number,
): boolean {
  const current = steps[step];
  const next = steps[(step + 1) % steps.length];
  return current?.on === true && current.slide && next?.on === true;
}

export function saturationSample(value: number, drive: number): number {
  const amount = 1 + drive * 4;
  // Compensate the input gain: drive must not multiply quiet bass by 5–17×.
  return Math.tanh(value * amount) / amount;
}

function distortionCurve(drive: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(2048);
  for (let index = 0; index < curve.length; index += 1) {
    const value = (index / (curve.length - 1)) * 2 - 1;
    curve[index] = saturationSample(value, drive);
  }
  return curve;
}

function localDriveCurve(drive: number, grit = 0): Float32Array<ArrayBuffer> {
  if (drive === 0 && grit === 0) return new Float32Array([-1, 1]);
  const curve = new Float32Array(2048);
  const resolution = 128 / (1 + grit * 15);
  for (let index = 0; index < curve.length; index += 1) {
    const value = (index / (curve.length - 1)) * 2 - 1;
    const saturated = saturationSample(value, drive);
    const shaped =
      grit > 0 ? Math.round(saturated * resolution) / resolution : saturated;
    const wet = Math.max(drive * 0.65, grit * 0.7);
    curve[index] = value * (1 - wet) + shaped * wet;
  }
  return curve;
}

interface PerformanceFxProfile {
  filterQ: number;
  rooms: readonly [number, number];
  roomSmoothing: number;
  echoBeats: readonly [number, number];
  pingPong: boolean;
  /** Fluff uses its generated plate and hall; Grain builds its own rooms. */
  impulses: readonly [ReverbKind, ReverbKind] | null;
}
/** Grain keeps its dub chain; Fluff gets a resonant sweep, plate/hall and ping-pong. */
function performanceFxProfile(mode: ProjectMode): PerformanceFxProfile {
  return mode === "fluff"
    ? {
        filterQ: 2.4,
        rooms: [FLUFF_REVERB_SECONDS.plate, FLUFF_REVERB_SECONDS.hall],
        roomSmoothing: 0.6,
        echoBeats: [0.5, 0.75],
        pingPong: true,
        impulses: ["plate", "hall"],
      }
    : {
        filterQ: 0.7,
        rooms: [0.36, 4.5],
        roomSmoothing: 0.35,
        echoBeats: [1 / 3, 0.75],
        pingPong: false,
        impulses: null,
      };
}
export function performanceFxTail(project: Project): number {
  const profile = performanceFxProfile(project.mode);
  const space =
    project.fx.space === 0
      ? 0
      : project.fx.space < 0
        ? profile.rooms[0]
        : profile.rooms[1];
  const amount = Math.abs(project.fx.echo);
  const feedback = 0.15 + amount * 0.4;
  const repeats =
    amount === 0 ? 0 : Math.ceil(Math.log(0.0001) / Math.log(feedback));
  const delay =
    (60 / project.bpm) *
    (project.fx.echo < 0 ? profile.echoBeats[0] : profile.echoBeats[1]) *
    (profile.pingPong ? 2 : 1);
  return Math.max(space, repeats * delay + (amount > 0 ? 0.08 : 0));
}

class PerformanceFx {
  private readonly input: GainNode;
  private readonly output: GainNode;
  private readonly sweepDry: GainNode;
  private readonly low: BiquadFilterNode;
  private readonly high: BiquadFilterNode;
  private readonly lowGain: GainNode;
  private readonly highGain: GainNode;
  private readonly roomGain: GainNode;
  private readonly washGain: GainNode;
  private readonly echoSend: GainNode;
  private readonly echoReturn: GainNode;
  private readonly delay: DelayNode;
  private readonly secondDelay: DelayNode | null = null;
  private readonly feedback: GainNode;
  private readonly damping: BiquadFilterNode;
  private readonly nodes: AudioNode[] = [];
  private readonly profile: PerformanceFxProfile;
  constructor(
    private readonly context: BaseAudioContext,
    private readonly source: AudioNode,
    destination: AudioNode,
    project: Project,
  ) {
    this.profile = performanceFxProfile(project.mode);
    this.input = context.createGain();
    this.output = context.createGain();
    const bus = context.createGain();
    this.sweepDry = context.createGain();
    this.low = context.createBiquadFilter();
    this.low.type = "lowpass";
    this.low.Q.value = this.profile.filterQ;
    this.high = context.createBiquadFilter();
    this.high.type = "highpass";
    this.high.Q.value = this.profile.filterQ;
    this.lowGain = context.createGain();
    this.highGain = context.createGain();
    this.input.connect(this.sweepDry);
    this.sweepDry.connect(bus);
    this.input.connect(this.low);
    this.low.connect(this.lowGain);
    this.lowGain.connect(bus);
    this.input.connect(this.high);
    this.high.connect(this.highGain);
    this.highGain.connect(bus);
    bus.connect(this.output);
    this.roomGain = context.createGain();
    this.washGain = context.createGain();
    const smoothing = this.profile.roomSmoothing;
    for (const [duration, gain, kind] of [
      [this.profile.rooms[0], this.roomGain, this.profile.impulses?.[0]],
      [this.profile.rooms[1], this.washGain, this.profile.impulses?.[1]],
    ] satisfies Array<[number, GainNode, ReverbKind | undefined]>) {
      const convolver = context.createConvolver();
      if (kind) {
        convolver.buffer = fluffImpulse(context, kind);
        bus.connect(convolver);
        convolver.connect(gain);
        gain.connect(this.output);
        this.nodes.push(convolver, gain);
        continue;
      }
      const buffer = context.createBuffer(
        2,
        Math.ceil(context.sampleRate * duration),
        context.sampleRate,
      );
      let seed = 4049;
      for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        let filtered = 0;
        for (let index = 0; index < data.length; index++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          filtered =
            filtered * smoothing + (seed / 2147483648 - 1) * (1 - smoothing);
          const time = index / context.sampleRate;
          data[index] =
            time < 0.014
              ? 0
              : filtered *
                Math.min(1, (time - 0.014) / 0.02) *
                (1 - index / data.length) ** 3;
        }
      }
      convolver.buffer = buffer;
      bus.connect(convolver);
      convolver.connect(gain);
      gain.connect(this.output);
      this.nodes.push(convolver, gain);
    }
    this.echoSend = context.createGain();
    this.echoReturn = context.createGain();
    this.delay = context.createDelay(2);
    this.feedback = context.createGain();
    this.damping = context.createBiquadFilter();
    this.damping.type = "lowpass";
    this.damping.Q.value = 0.5;
    const rumble = context.createBiquadFilter();
    rumble.type = "highpass";
    rumble.frequency.value = 140;
    rumble.Q.value = 0.5;
    const saturation = context.createWaveShaper();
    saturation.curve = localDriveCurve(0.2);
    bus.connect(this.echoSend);
    this.echoSend.connect(this.delay);
    this.delay.connect(this.damping);
    this.damping.connect(rumble);
    rumble.connect(saturation);
    this.echoReturn.connect(this.output);
    if (this.profile.pingPong) {
      // The repeat alternates sides: left tap, then a second delay to the right.
      const second = context.createDelay(2);
      const left = context.createStereoPanner();
      const right = context.createStereoPanner();
      left.pan.value = -0.8;
      right.pan.value = 0.8;
      saturation.connect(left);
      left.connect(this.echoReturn);
      saturation.connect(second);
      second.connect(right);
      right.connect(this.echoReturn);
      second.connect(this.feedback);
      this.secondDelay = second;
      this.nodes.push(second, left, right);
    } else {
      saturation.connect(this.echoReturn);
      saturation.connect(this.feedback);
    }
    this.feedback.connect(this.delay);
    this.nodes.push(
      this.input,
      this.output,
      bus,
      this.sweepDry,
      this.low,
      this.high,
      this.lowGain,
      this.highGain,
      this.echoSend,
      this.echoReturn,
      this.delay,
      this.feedback,
      this.damping,
      rumble,
      saturation,
    );
    this.update(project, true);
    source.connect(this.input);
    this.output.connect(destination);
  }
  update(project: Project, immediate = false): void {
    const time = this.context.currentTime;
    const set = (parameter: AudioParam, value: number): void => {
      parameter.cancelAndHoldAtTime(time);
      if (immediate) parameter.setValueAtTime(value, time);
      else parameter.setTargetAtTime(value, time, 0.018);
    };
    const sweep = project.fx.sweep,
      amount = Math.abs(sweep),
      echo = Math.abs(project.fx.echo);
    set(this.sweepDry.gain, 1 - amount);
    set(this.lowGain.gain, sweep < 0 ? amount : 0);
    set(this.highGain.gain, sweep > 0 ? amount : 0);
    set(
      this.low.frequency,
      Math.min(this.context.sampleRate * 0.45, 20000) * (80 / 20000) ** amount,
    );
    set(this.high.frequency, 22 * (4000 / 22) ** amount);
    set(
      this.roomGain.gain,
      project.fx.space < 0 ? -project.fx.space * 0.28 : 0,
    );
    set(this.washGain.gain, project.fx.space > 0 ? project.fx.space * 0.32 : 0);
    set(this.echoSend.gain, echo > 0 ? 1 : 0);
    set(this.echoReturn.gain, echo * 0.42);
    set(this.feedback.gain, echo > 0 ? 0.15 + echo * 0.4 : 0);
    set(
      this.damping.frequency,
      this.profile.pingPong ? 5200 : project.fx.echo < 0 ? 4000 : 1800,
    );
    const delayTime =
      (60 / project.bpm) *
      (project.fx.echo < 0
        ? this.profile.echoBeats[0]
        : this.profile.echoBeats[1]);
    set(this.delay.delayTime, delayTime);
    if (this.secondDelay) set(this.secondDelay.delayTime, delayTime);
  }
  destroy(): void {
    this.source.disconnect(this.input);
    for (const node of this.nodes) node.disconnect();
  }
}

/** Grain's drum and bass input and its melodic input; the input also carries Crunch. */
const GRAIN_INPUT_LEVEL = 0.6;
const GRAIN_MELODIC_LEVEL = 0.72;
const decibels = (value: number): number => 10 ** (value / 20);
/**
 * Fluff's master compressor and melodic glue lift quiet material more than
 * Grain's. These trims, calibrated from solo renders, keep a voice from the
 * other family about as loud as it is in its own studio.
 */
const FLUFF_MASTER_LIFT = decibels(1.9);
const FLUFF_MELODIC_LIFT = decibels(11);

/**
 * Grain voices in a Fluff project: the bass joins Fluff's bass bus (no melodic
 * low cut, its own short duck), Texture, arps and pads join the melodic bus
 * (low cut, shelves, glue and Pump). Trims keep each voice at the level it has
 * in Grain. Grain drums keep Grain's drum input, as Fluff's drums do.
 */
function grainIntoFluff(
  context: BaseAudioContext,
  fluff: FluffBus,
  texture: GainNode,
): { bass: GainNode; melodic: GainNode } {
  const bass = context.createGain();
  const melodic = context.createGain();
  const textureTrim = context.createGain();
  bass.gain.value = GRAIN_INPUT_LEVEL / GRAIN_MELODIC_LEVEL / FLUFF_MASTER_LIFT;
  melodic.gain.value = 1 / FLUFF_MELODIC_LIFT;
  textureTrim.gain.value = 1 / GRAIN_MELODIC_LEVEL;
  bass.connect(fluff.bass);
  melodic.connect(fluff.music);
  texture.connect(textureTrim);
  textureTrim.connect(melodic);
  return { bass, melodic };
}

/**
 * The Fluff bus, built on first use in a Grain project. Its melodic and
 * return outputs feed Grain's melodic input; its drums and bass feed Grain's
 * drum input, so Crunch reaches them as it reaches Grain's drums and bass.
 * Grain never pumps it; a kick only runs the Fluff bass's own short duck.
 */
function fluffBus(graph: AudioGraph): FluffBus {
  if (graph.fluff) return graph.fluff;
  const bus = new FluffBus(
    graph.context,
    graph.melodicInput,
    graph.input,
    graph.bpm,
    {
      level: FLUFF_MASTER_LIFT,
      bass: graph.input,
      bassLevel: (GRAIN_MELODIC_LEVEL / GRAIN_INPUT_LEVEL) * FLUFF_MASTER_LIFT,
    },
  );
  graph.fluff = bus;
  return bus;
}

function usesFluffDrums(project: Project): boolean {
  return project.drums.some(
    (track) => trackFamily(project.mode, track) === "fluff",
  );
}

function fluffLead(graph: AudioGraph): FluffLead {
  if (graph.fluffLead) return graph.fluffLead;
  const lead = new FluffLead(graph.context, fluffBus(graph));
  graph.fluffLead = lead;
  return lead;
}

function createGraph(context: BaseAudioContext, project: Project): AudioGraph {
  const input = context.createGain();
  const cleanInput = context.createGain();
  const melodicInput = context.createGain();
  const dry = context.createGain();
  const wet = context.createGain();
  const distortion = context.createWaveShaper();
  const highpass = context.createBiquadFilter();
  const compressor = context.createDynamicsCompressor();
  const master = context.createGain();
  const safety = context.createWaveShaper();
  const analyser = context.createAnalyser();
  const fluffMode = project.mode === "fluff";
  input.gain.value = GRAIN_INPUT_LEVEL;
  melodicInput.gain.value = GRAIN_MELODIC_LEVEL;
  cleanInput.gain.value = project.keys.muted
    ? 0
    : 0.72 * automatedKeys(project.keys, 0).volume;
  // Fluff reuses the drive setting as its sidechain pump, so the bus stays clean.
  dry.gain.value = fluffMode ? 1 : 1 - project.drive * 0.45;
  wet.gain.value = fluffMode ? 0 : project.drive * 0.45;
  distortion.curve = distortionCurve(fluffMode ? 0 : project.drive);
  // Keep the parallel paths sample-aligned; oversampling delays only the wet path.
  distortion.oversample = "none";
  highpass.type = "highpass";
  highpass.frequency.value = 22;
  highpass.Q.value = 0.7;
  compressor.threshold.value = fluffMode ? -18 : -7;
  compressor.knee.value = fluffMode ? 10 : 5;
  compressor.ratio.value = fluffMode ? 2.5 : 6;
  compressor.attack.value = fluffMode ? 0.004 : 0.008;
  compressor.release.value = fluffMode ? 0.18 : 0.11;
  master.gain.value = project.volume * 0.8;
  const ceiling = new Float32Array(2048);
  for (let index = 0; index < ceiling.length; index += 1) {
    const value = (index / (ceiling.length - 1)) * 2 - 1;
    ceiling[index] =
      Math.abs(value) <= 0.85
        ? value
        : Math.sign(value) *
          (0.85 + 0.1 * Math.tanh((Math.abs(value) - 0.85) / 0.1));
  }
  safety.curve = ceiling;
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.82;
  input.connect(dry);
  dry.connect(highpass);
  input.connect(distortion);
  distortion.connect(wet);
  wet.connect(highpass);
  if (!fluffMode) cleanInput.connect(highpass);
  melodicInput.connect(highpass);
  const fx = new PerformanceFx(context, highpass, compressor, project);
  const fluff = fluffMode
    ? new FluffBus(context, melodicInput, input, project.bpm)
    : null;
  const grain = fluff
    ? grainIntoFluff(context, fluff, cleanInput)
    : { bass: input, melodic: melodicInput };
  // Hits fall back to synthesized drums until the samples have decoded.
  if (fluffMode) void loadFluffDrums(context);
  compressor.connect(master);
  master.connect(safety);
  safety.connect(analyser);
  analyser.connect(context.destination);
  const noise = context.createBuffer(
    1,
    Math.ceil(context.sampleRate * 3),
    context.sampleRate,
  );
  const data = noise.getChannelData(0);
  for (let index = 0; index < data.length; index += 1)
    data[index] = Math.random() * 2 - 1;
  return {
    mode: project.mode,
    fluff,
    fluffLead: fluff ? new FluffLead(context, fluff) : null,
    fluffMaterial: fluff ? fluff.channel(0.22, 0.12) : null,
    fluffVocal: fluff ? fluff.channel(0.42, 0.3) : null,
    context,
    fx,
    fxInput: highpass,
    input,
    cleanInput,
    melodicInput,
    grainBass: grain.bass,
    grainMelodic: grain.melodic,
    dry,
    wet,
    distortion,
    compressor,
    master,
    analyser,
    noise,
    textureRoom: null,
    sources: new Set(),
    drive: project.drive,
    bpm: project.bpm,
    scale: project.scale,
  };
}

function updateGraph(
  graph: AudioGraph,
  project: Project,
  outputEnabled = true,
): void {
  graph.fx.update(project);
  const now = graph.context.currentTime;
  graph.master.gain.cancelAndHoldAtTime(now);
  graph.master.gain.setTargetAtTime(
    outputEnabled ? project.volume * 0.8 : 0,
    now,
    0.015,
  );
  graph.bpm = project.bpm;
  graph.scale = project.scale;
  graph.fluff?.setTempo(project.bpm, now);
  if (graph.mode === "grain" && graph.drive !== project.drive) {
    graph.distortion.curve = distortionCurve(project.drive);
    graph.dry.gain.setTargetAtTime(1 - project.drive * 0.45, now, 0.015);
    graph.wet.gain.setTargetAtTime(project.drive * 0.45, now, 0.015);
    graph.drive = project.drive;
  }
}

/** Every voice owns its nodes; the last source to finish disconnects the voice. */
function scheduleSources(
  graph: AudioGraph,
  sources: ScheduledSource[],
  nodes: AudioNode[],
  start: number,
  end: number,
  bufferOffset = 0,
  tail = 0,
): void {
  const hold = tail > 0 ? graph.context.createBufferSource() : null;
  if (hold) {
    hold.buffer = graph.context.createBuffer(1, 1, graph.context.sampleRate);
    hold.loop = true;
  }
  const scheduled = hold ? [...sources, hold] : sources;
  let remaining = scheduled.length;
  for (const source of scheduled) {
    graph.sources.add(source);
    source.onended = () => {
      graph.sources.delete(source);
      source.disconnect();
      remaining -= 1;
      if (remaining === 0) for (const node of nodes) node.disconnect();
    };
    if ("buffer" in source) source.start(start, bufferOffset);
    else source.start(start);
    source.stop(end + (source === hold ? tail : 0));
  }
}

interface HatProfile {
  highpass: number;
  lowpass: number;
  level: number;
  attack: number;
  length: number;
  maximum: number;
}
function hatProfile(sound: number): HatProfile {
  const profiles: HatProfile[] = [
    {
      highpass: 4800,
      lowpass: 11200,
      level: 0.7,
      attack: 0.0012,
      length: 0.8,
      maximum: 0.8,
    },
    {
      highpass: 5800,
      lowpass: 14500,
      level: 0.54,
      attack: 0.003,
      length: 3.2,
      maximum: 2.5,
    },
    {
      highpass: 7200,
      lowpass: 13000,
      level: 0.62,
      attack: 0.0008,
      length: 0.55,
      maximum: 0.35,
    },
    {
      highpass: 3200,
      lowpass: 9000,
      level: 0.58,
      attack: 0.01,
      length: 1.5,
      maximum: 1.6,
    },
    {
      highpass: 4200,
      lowpass: 13800,
      level: 0.42,
      attack: 0.004,
      length: 6,
      maximum: 3,
    },
    {
      highpass: 4500,
      lowpass: 10500,
      level: 0.76,
      attack: 0.001,
      length: 1.1,
      maximum: 1.4,
    },
    {
      highpass: 3500,
      lowpass: 11000,
      level: 0.43,
      attack: 0.001,
      length: 1,
      maximum: 1.4,
    },
    {
      highpass: 2800,
      lowpass: 10500,
      level: 0.55,
      attack: 0.008,
      length: 2.4,
      maximum: 2.5,
    },
  ];
  return (
    profiles[sound] ?? {
      highpass: 4800,
      lowpass: 11200,
      level: 0.7,
      attack: 0.0012,
      length: 0.8,
      maximum: 0.8,
    }
  );
}
function hatDuration(sound: number, decay: number): number {
  const profile = hatProfile(sound);
  return Math.max(0.018, Math.min(profile.maximum, decay * profile.length));
}

function drumVoice(
  graph: AudioGraph,
  track: DrumTrack,
  time: number,
  family: ProjectMode,
): void {
  if (track.volume === 0) return;
  if (family === "fluff") {
    fluffDrumVoice(graph.context, fluffBus(graph), track, time, graph.scale);
    return;
  }
  const context = graph.context;
  const pitch = 2 ** (track.pitch / 12);
  const decay = track.decay;
  const output = context.createGain();
  // A fractional-time start can precede its first automation sample.
  output.gain.value = 0;
  const mix = context.createGain();
  const nodes: AudioNode[] = [output, mix];
  const sources: ScheduledSource[] = [];
  output.connect(mix);
  let previous: AudioNode = mix;
  if (track.tone !== 0.5) {
    const tone = context.createBiquadFilter();
    tone.type = "highshelf";
    tone.frequency.value = 1400;
    tone.gain.value = (track.tone - 0.5) * (track.tone < 0.5 ? 36 : 24);
    previous.connect(tone);
    previous = tone;
    nodes.push(tone);
  }
  if (track.drive > 0) {
    const drive = context.createWaveShaper();
    drive.curve = localDriveCurve(track.drive, track.drive * 0.6);
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
  pan.channelCount = 2;
  pan.channelCountMode = "explicit";
  pan.pan.value = track.pan;
  previous.connect(pan);
  pan.connect(graph.input);
  nodes.push(pan);
  if (track.space > 0) {
    const room = context.createConvolver();
    const wet = context.createGain();
    room.buffer = textureRoom(graph);
    wet.gain.value = track.space * 0.32;
    pan.connect(room);
    room.connect(wet);
    wet.connect(graph.input);
    nodes.push(room, wet);
  }
  let end = time + decay + 0.08;
  const envelope = (
    gain: AudioParam,
    peak: number,
    duration: number,
    offset = 0,
  ) => {
    const start = time + offset;
    gain.setValueAtTime(MIN_GAIN, start);
    gain.linearRampToValueAtTime(
      Math.max(MIN_GAIN, peak * track.volume),
      start + 0.002,
    );
    gain.exponentialRampToValueAtTime(
      MIN_GAIN,
      start + Math.max(0.008, duration),
    );
  };
  const oscillator = (
    type: OscillatorType,
    frequency: number,
    target: AudioNode,
  ) => {
    const source = context.createOscillator();
    source.type = type;
    source.frequency.setValueAtTime(frequency * pitch, time);
    source.connect(target);
    sources.push(source);
    return source;
  };
  const noise = (
    filterType: BiquadFilterType,
    frequency: number,
    target: AudioNode,
  ) => {
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    source.buffer = graph.noise;
    source.playbackRate.value = pitch;
    source.loop = true;
    filter.type = filterType;
    filter.frequency.value = Math.min(18000, frequency * pitch);
    source.connect(filter);
    filter.connect(target);
    sources.push(source);
    nodes.push(filter);
    return filter;
  };

  if (track.id === "kick" && track.sound >= 5) {
    const root = midiFrequency(24 + graph.scale.root);
    const length = track.sound === 5 ? decay * 0.9 : decay * 0.72;
    const body = oscillator(
      "sine",
      root * (track.sound === 5 ? 1.8 : 3.8),
      output,
    );
    body.frequency.exponentialRampToValueAtTime(
      root * pitch,
      time + (track.sound === 5 ? 0.035 : 0.016),
    );
    envelope(output.gain, track.sound === 5 ? 0.94 : 0.85, length);
    const transient = context.createGain();
    transient.gain.value = 0;
    nodes.push(transient);
    if (track.sound === 5) {
      transient.connect(mix);
      oscillator("triangle", root * 2, transient);
      envelope(transient.gain, 0.12, Math.min(0.06, length));
    } else {
      transient.connect(body.frequency);
      oscillator("sine", root * 5, transient);
      transient.gain.setValueAtTime(root * pitch * 3, time);
      transient.gain.exponentialRampToValueAtTime(
        MIN_GAIN,
        time + Math.min(0.045, length),
      );
      const click = context.createGain();
      click.gain.value = 0;
      click.connect(mix);
      nodes.push(click);
      noise("bandpass", 2400, click);
      envelope(click.gain, 0.075, 0.009);
    }
    end = time + length + 0.06;
  } else if (track.id === "snare" && track.sound >= 5) {
    const length =
      track.sound === 5
        ? Math.min(0.65, decay * 0.85)
        : Math.min(1.4, decay * 1.05);
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = track.sound === 5 ? 8200 : 6200;
    lowpass.connect(output);
    nodes.push(lowpass);
    const filter = noise("bandpass", track.sound === 5 ? 2900 : 1600, lowpass);
    filter.Q.value = track.sound === 5 ? 0.6 : 1.25;
    const body = context.createGain();
    body.gain.value = 0;
    body.connect(mix);
    nodes.push(body);
    oscillator("triangle", midiFrequency(48 + graph.scale.root), body);
    envelope(body.gain, 0.15, Math.min(length * 0.5, 0.16));
    if (track.sound === 5) {
      output.gain.setValueAtTime(0, time);
      output.gain.linearRampToValueAtTime(track.volume * 0.64, time + 0.0015);
      output.gain.exponentialRampToValueAtTime(
        Math.max(MIN_GAIN, track.volume * 0.24),
        time + length * 0.72,
      );
      output.gain.linearRampToValueAtTime(0, time + length);
    } else {
      for (let pulse = 0; pulse < 4; pulse++)
        envelope(
          output.gain,
          0.62 / (1 + pulse * 0.35),
          pulse === 3 ? length : 0.012,
          pulse * 0.018,
        );
    }
    end = time + length + (track.sound === 6 ? 0.104 : 0.05);
  } else if (track.id === "clap" && track.sound >= 5) {
    const filter = noise("bandpass", track.sound === 5 ? 1450 : 2300, output);
    filter.Q.value = track.sound === 5 ? 0.8 : 0.5;
    if (track.sound === 5) {
      for (const [index, offset] of [0, 0.014, 0.033, 0.061].entries())
        envelope(
          output.gain,
          0.54 - index * 0.055,
          index === 3 ? decay * 0.65 : 0.012,
          offset,
        );
      end = time + 0.061 + decay * 0.65 + 0.05;
    } else {
      const length = decay * 1.25;
      output.gain.setValueAtTime(0, time);
      output.gain.linearRampToValueAtTime(
        track.volume * 0.5,
        time + Math.min(0.09, length * 0.3),
      );
      output.gain.exponentialRampToValueAtTime(MIN_GAIN, time + length);
      const room = context.createConvolver(),
        wet = context.createGain();
      room.buffer = textureRoom(graph);
      wet.gain.value = 0.27;
      output.connect(room);
      room.connect(wet);
      wet.connect(mix);
      nodes.push(room, wet);
      end = time + length + 0.95;
    }
  } else if (track.id === "rim" && track.sound >= 5) {
    const root = midiFrequency(60 + graph.scale.root);
    const length = Math.max(0.025, decay * (track.sound === 5 ? 0.42 : 0.9));
    if (track.sound === 5) {
      oscillator("triangle", root, output);
      const partial = context.createGain();
      partial.gain.value = 0.16;
      partial.connect(output);
      nodes.push(partial);
      oscillator("sine", root * 4, partial);
      envelope(output.gain, 0.36, length);
    } else {
      const resonator = noise("bandpass", root * 2, output);
      resonator.Q.value = 5;
      resonator.frequency.exponentialRampToValueAtTime(
        root * pitch,
        time + length,
      );
      const partial = context.createGain();
      partial.gain.value = 0.05;
      partial.connect(output);
      nodes.push(partial);
      oscillator("sine", root, partial);
      envelope(output.gain, 2.1, length);
    }
    end = time + length + 0.05;
  } else if (track.id === "kick") {
    const fundamental = midiFrequency(
      (track.sound === 4 ? 36 : 24) + graph.scale.root,
    );
    const length =
      track.sound === 3
        ? Math.min(2, decay * 1.35)
        : track.sound === 4
          ? decay * 0.65
          : decay;
    const source = oscillator(
      track.sound === 2 ? "triangle" : "sine",
      fundamental *
        (track.sound === 3
          ? 1.3
          : track.sound === 4
            ? 1.65
            : track.sound === 1
              ? 2.8
              : 2.2),
      output,
    );
    source.frequency.exponentialRampToValueAtTime(
      fundamental * pitch,
      time + (track.sound === 3 ? 0.015 : track.sound === 4 ? 0.009 : 0.022),
    );
    envelope(output.gain, track.sound === 4 ? 0.78 : 0.95, length);
    const click = context.createGain();
    click.gain.value = 0;
    click.connect(mix);
    nodes.push(click);
    noise(
      track.sound === 4 ? "bandpass" : "highpass",
      track.sound === 4 ? 1900 : track.sound === 1 ? 2800 : 1400,
      click,
    );
    envelope(
      click.gain,
      track.sound === 3
        ? 0.008
        : track.sound === 4
          ? 0.14
          : track.sound === 1
            ? 0.1
            : 0.035,
      track.sound === 4 ? 0.016 : 0.009,
    );
    end = time + length + 0.08;
  } else if (track.id === "snare") {
    const body = context.createGain();
    const snap = context.createGain();
    body.gain.value = 0;
    snap.gain.value = 0;
    body.connect(output);
    snap.connect(output);
    nodes.push(body, snap);
    output.gain.value = 1;
    oscillator(
      track.sound === 2 ? "triangle" : "sine",
      midiFrequency(48 + graph.scale.root),
      body,
    );
    oscillator(
      "sine",
      midiFrequency(48 + graph.scale.root) * (track.sound === 2 ? 3 : 2),
      body,
    );
    envelope(
      body.gain,
      track.sound === 4 ? 0.045 : track.sound === 3 ? 0.3 : 0.24,
      decay * 0.58,
    );
    if (track.sound === 3) {
      const crunch = context.createWaveShaper();
      crunch.curve = textureNoiseCurve(0);
      crunch.connect(snap);
      nodes.push(crunch);
      const filter = noise("bandpass", 2300, crunch);
      filter.Q.value = 0.65;
      envelope(snap.gain, 0.78, decay * 0.95);
    } else if (track.sound === 4) {
      const length = Math.min(2, decay * 1.3);
      const filter = noise("bandpass", 2600, snap);
      filter.Q.value = 0.45;
      snap.gain.setValueAtTime(0, time);
      snap.gain.linearRampToValueAtTime(
        track.volume * 0.48,
        time + Math.min(0.018, length * 0.3),
      );
      snap.gain.exponentialRampToValueAtTime(MIN_GAIN, time + length);
      end = time + length + 0.08;
    } else {
      const filter = noise("highpass", track.sound === 0 ? 900 : 1800, snap);
      filter.Q.value = track.sound === 2 ? 3 : 0.7;
      envelope(snap.gain, 0.47, decay);
    }
  } else if (track.id === "hat") {
    const profile = hatProfile(track.sound),
      length = hatDuration(track.sound, decay);
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.Q.value = 0.55;
    lowpass.frequency.value = Math.min(
      18000,
      profile.lowpass * Math.sqrt(pitch),
    );
    lowpass.connect(output);
    nodes.push(lowpass);
    const hiss = context.createGain();
    hiss.gain.value = profile.level;
    hiss.connect(lowpass);
    nodes.push(hiss);
    const highpass = noise(
      "highpass",
      Math.min(12000, profile.highpass / Math.sqrt(pitch)),
      hiss,
    );
    highpass.Q.value = 0.5;
    if (track.sound === 2 || track.sound === 4 || track.sound === 6) {
      const metal = context.createGain();
      metal.gain.value =
        track.sound === 2 ? 0.035 : track.sound === 4 ? 0.025 : 0.06;
      metal.connect(lowpass);
      nodes.push(metal);
      const root = midiFrequency(48 + graph.scale.root);
      const harmonic = (ratio: number) =>
        Math.min(context.sampleRate * 0.4, root * pitch * ratio) / pitch;
      const carrier = oscillator(
        "sine",
        harmonic(track.sound === 2 ? 24 : 16),
        metal,
      );
      if (track.sound === 4) {
        oscillator("sine", harmonic(23), metal);
        oscillator("sine", harmonic(31), metal);
      }
      if (track.sound === 6) {
        const depth = context.createGain();
        depth.gain.value = root * pitch * 7;
        depth.connect(carrier.frequency);
        nodes.push(depth);
        oscillator("sine", harmonic(16 * Math.SQRT2), depth);
        depth.gain.exponentialRampToValueAtTime(
          root * pitch * 0.2,
          time + length,
        );
      }
    }
    if (track.sound === 7) {
      const depth = context.createGain();
      depth.gain.value = 1200;
      depth.connect(lowpass.detune);
      nodes.push(depth);
      oscillator("sine", 18 / pitch, depth);
      lowpass.frequency.setValueAtTime(
        Math.min(15000, 7000 * Math.sqrt(pitch)),
        time,
      );
      lowpass.frequency.exponentialRampToValueAtTime(
        Math.min(12000, 3000 * Math.sqrt(pitch)),
        time + length,
      );
    }
    if (track.sound === 5) {
      for (let pulse = 0; pulse < 4; pulse++)
        envelope(
          output.gain,
          0.75 / (1 + pulse * 0.25),
          Math.max(0.006, length / 5),
          (pulse * length) / 4,
        );
    } else {
      output.gain.setValueAtTime(0, time);
      output.gain.linearRampToValueAtTime(
        track.volume * 0.68,
        time + Math.min(profile.attack, length * 0.25),
      );
      output.gain.exponentialRampToValueAtTime(MIN_GAIN, time + length);
    }
    end = time + length + 0.05;
  } else if (track.id === "clap") {
    output.gain.value = 0;
    const filter = noise(
      "bandpass",
      track.sound === 4 ? 2900 : track.sound === 2 ? 1300 : 1800,
      output,
    );
    filter.Q.value = track.sound === 1 ? 0.65 : 1.1;
    const spread =
      track.sound === 3
        ? 0.015
        : track.sound === 4
          ? 0.008
          : track.sound === 1
            ? 0.017
            : 0.011;
    const length =
      track.sound === 3 ? decay * 1.2 : track.sound === 4 ? decay * 0.4 : decay;
    for (let pulse = 0; pulse < 3; pulse += 1)
      envelope(output.gain, 0.62, 0.009, pulse * spread);
    envelope(output.gain, track.sound === 4 ? 0.34 : 0.46, length, 3 * spread);
    end = time + 3 * spread + length + 0.05;
    if (track.sound === 3) {
      const room = context.createConvolver();
      const wet = context.createGain();
      room.buffer = textureRoom(graph);
      wet.gain.value = 0.22;
      output.connect(room);
      room.connect(wet);
      wet.connect(mix);
      nodes.push(room, wet);
      output.gain.linearRampToValueAtTime(0, time + 3 * spread + length + 0.01);
      end += 0.9;
    }
  } else if (track.id === "rim") {
    const body = context.createGain();
    const snap = context.createGain();
    body.gain.value = 0;
    snap.gain.value = 0;
    body.connect(output);
    snap.connect(output);
    nodes.push(body, snap);
    output.gain.value = 1;
    const root = midiFrequency(
      (track.sound === 3 ? 72 : 60) + graph.scale.root,
    );
    oscillator(track.sound === 4 ? "triangle" : "sine", root, body);
    oscillator(
      "sine",
      root *
        (track.sound === 3
          ? 1.5
          : track.sound === 4
            ? 2
            : track.sound === 2
              ? 5
              : track.sound === 1
                ? 3
                : 3.4),
      body,
    );
    const length = Math.max(
      0.018,
      decay *
        (track.sound === 3
          ? 0.28
          : track.sound === 4
            ? 0.8
            : track.sound === 1
              ? 0.65
              : 0.4),
    );
    envelope(
      body.gain,
      track.sound === 3
        ? 0.3
        : track.sound === 4
          ? 0.25
          : track.sound === 2
            ? 0.1
            : 0.22,
      length,
    );
    noise("highpass", track.sound === 2 ? 3800 : 2200, snap);
    envelope(
      snap.gain,
      track.sound === 3
        ? 0.015
        : track.sound === 4
          ? 0.05
          : track.sound === 2
            ? 0.26
            : 0.11,
      Math.min(0.025, length * 0.5),
    );
    end = time + length + 0.03;
  }
  scheduleSources(
    graph,
    sources,
    nodes,
    time,
    end,
    0,
    track.space > 0 ? 0.92 : 0,
  );
}

interface BassTone {
  type: OscillatorType | "selected";
  multiplier: number;
  level: number;
  detune: number;
  pan: number;
}
interface BassProfile {
  tones: BassTone[];
  level: number;
  attack: number;
  sustain: number;
  gate: number;
  release: number;
  cutoff: number;
  resonance: number;
  envelope: number;
  brightness: number;
  accentBrightness: number;
  filterDecay: number;
  fm: number;
  fmRatio: number;
  drive: number;
}

function bassProfile(sound: number): BassProfile {
  if (sound === 0)
    return {
      tones: [
        { type: "sine", multiplier: 1, level: 0.82, detune: 0, pan: 0 },
        { type: "triangle", multiplier: 1, level: 0.13, detune: 0, pan: 0 },
        { type: "sine", multiplier: 0.5, level: 0.05, detune: 0, pan: 0 },
      ],
      level: 0.52,
      attack: 0.006,
      sustain: 0.48,
      gate: 0.94,
      release: 0.85,
      cutoff: 0.85,
      resonance: 0.08,
      envelope: 1.5,
      brightness: 200,
      accentBrightness: 350,
      filterDecay: 1,
      fm: 0,
      fmRatio: 2,
      drive: 0,
    };
  if (sound === 1)
    return {
      tones: [
        { type: "triangle", multiplier: 1, level: 0.55, detune: 0, pan: 0 },
        { type: "square", multiplier: 2, level: 0.2, detune: 0, pan: 0 },
        { type: "sine", multiplier: 1, level: 0.25, detune: 0, pan: 0 },
      ],
      level: 0.47,
      attack: 0.002,
      sustain: 0.16,
      gate: 0.65,
      release: 0.55,
      cutoff: 0.85,
      resonance: 0.11,
      envelope: 6,
      brightness: 1000,
      accentBrightness: 1600,
      filterDecay: 0.55,
      fm: 0.08,
      fmRatio: 2,
      drive: 0,
    };
  if (sound === 3)
    return {
      tones: [
        { type: "selected", multiplier: 1, level: 0.67, detune: 0, pan: 0 },
        { type: "sawtooth", multiplier: 2, level: 0.16, detune: 3, pan: 0.1 },
        { type: "triangle", multiplier: 0.5, level: 0.17, detune: 0, pan: 0 },
      ],
      level: 0.46,
      attack: 0.0025,
      sustain: 0.38,
      gate: 0.87,
      release: 0.7,
      cutoff: 1.1,
      resonance: 0.22,
      envelope: 4,
      brightness: 1800,
      accentBrightness: 2600,
      filterDecay: 0.7,
      fm: 0,
      fmRatio: 3,
      drive: 0.18,
    };
  if (sound === 4)
    return {
      tones: [
        {
          type: "triangle",
          multiplier: 1,
          level: 0.42,
          detune: -5,
          pan: -0.18,
        },
        { type: "sawtooth", multiplier: 1, level: 0.42, detune: 5, pan: 0.18 },
        { type: "sine", multiplier: 2, level: 0.16, detune: 0, pan: 0 },
      ],
      level: 0.5,
      attack: 0.012,
      sustain: 0.3,
      gate: 0.96,
      release: 1.2,
      cutoff: 1.2,
      resonance: 0.12,
      envelope: 7,
      brightness: 1400,
      accentBrightness: 2400,
      filterDecay: 1.15,
      fm: 0,
      fmRatio: 2,
      drive: 0,
    };
  if (sound === 5)
    return {
      tones: [
        { type: "sine", multiplier: 1, level: 0.65, detune: -2, pan: -0.12 },
        { type: "triangle", multiplier: 0.5, level: 0.2, detune: 2, pan: 0.12 },
        { type: "sine", multiplier: 2, level: 0.15, detune: 0, pan: 0 },
      ],
      level: 0.58,
      attack: 0.025,
      sustain: 0.7,
      gate: 0.99,
      release: 2.5,
      cutoff: 0.45,
      resonance: 0.06,
      envelope: 1.2,
      brightness: 120,
      accentBrightness: 220,
      filterDecay: 2.2,
      fm: 0,
      fmRatio: 2,
      drive: 0,
    };
  if (sound === 6)
    return {
      tones: [
        { type: "sine", multiplier: 1, level: 0.78, detune: 0, pan: 0 },
        { type: "triangle", multiplier: 2, level: 0.12, detune: 0, pan: 0 },
        { type: "sine", multiplier: 0.5, level: 0.1, detune: 0, pan: 0 },
      ],
      level: 0.56,
      attack: 0.002,
      sustain: 0.24,
      gate: 0.8,
      release: 0.65,
      cutoff: 1.2,
      resonance: 0.1,
      envelope: 2,
      brightness: 800,
      accentBrightness: 1300,
      filterDecay: 0.6,
      fm: 1.5,
      fmRatio: 2,
      drive: 0,
    };
  if (sound === 7)
    return {
      tones: [
        {
          type: "sawtooth",
          multiplier: 1,
          level: 0.4,
          detune: -11,
          pan: -0.58,
        },
        { type: "sawtooth", multiplier: 1, level: 0.4, detune: 11, pan: 0.58 },
        { type: "sine", multiplier: 0.5, level: 0.2, detune: 0, pan: 0 },
      ],
      level: 0.5,
      attack: 0.009,
      sustain: 0.78,
      gate: 0.99,
      release: 2,
      cutoff: 0.75,
      resonance: 0.13,
      envelope: 1.8,
      brightness: 500,
      accentBrightness: 900,
      filterDecay: 1.6,
      fm: 0,
      fmRatio: 2,
      drive: 0.04,
    };
  if (sound === 8)
    return {
      tones: [
        { type: "triangle", multiplier: 1, level: 0.58, detune: 0, pan: 0 },
        { type: "square", multiplier: 2, level: 0.26, detune: 2, pan: 0.1 },
        { type: "sine", multiplier: 0.5, level: 0.16, detune: 0, pan: 0 },
      ],
      level: 0.5,
      attack: 0.004,
      sustain: 0.58,
      gate: 0.94,
      release: 0.85,
      cutoff: 1.2,
      resonance: 0.16,
      envelope: 4.5,
      brightness: 1400,
      accentBrightness: 2200,
      filterDecay: 0.9,
      fm: 0.12,
      fmRatio: 2,
      drive: 0.08,
    };
  if (sound === 9)
    return {
      tones: [
        { type: "square", multiplier: 1, level: 0.45, detune: 0, pan: 0 },
        { type: "sine", multiplier: 3, level: 0.3, detune: 0, pan: -0.12 },
        { type: "sine", multiplier: 1, level: 0.25, detune: 0, pan: 0.12 },
      ],
      level: 0.49,
      attack: 0.003,
      sustain: 0.18,
      gate: 0.78,
      release: 0.8,
      cutoff: 0.8,
      resonance: 0.09,
      envelope: 3.2,
      brightness: 750,
      accentBrightness: 1500,
      filterDecay: 0.55,
      fm: 0.35,
      fmRatio: 3,
      drive: 0,
    };
  if (sound === 10)
    return {
      tones: [
        { type: "sawtooth", multiplier: 1, level: 0.4, detune: -3, pan: -0.1 },
        { type: "square", multiplier: 2, level: 0.35, detune: 3, pan: 0.1 },
        { type: "sine", multiplier: 0.5, level: 0.25, detune: 0, pan: 0 },
      ],
      level: 0.42,
      attack: 0.0015,
      sustain: 0.13,
      gate: 0.7,
      release: 0.6,
      cutoff: 1.6,
      resonance: 0.3,
      envelope: 8,
      brightness: 2600,
      accentBrightness: 3800,
      filterDecay: 0.45,
      fm: 1.8,
      fmRatio: 1,
      drive: 0.12,
    };
  return {
    tones: [
      { type: "selected", multiplier: 1, level: 1, detune: 0, pan: 0 },
      { type: "triangle", multiplier: 2, level: 0, detune: 0, pan: 0 },
      { type: "sine", multiplier: 0.5, level: 0, detune: 0, pan: 0 },
    ],
    level: 0.34,
    attack: 0.004,
    sustain: 0.4,
    gate: 0.94,
    release: 0.94,
    cutoff: 1,
    resonance: 0.28,
    envelope: 5,
    brightness: 1400,
    accentBrightness: 2200,
    filterDecay: 1,
    fm: 0,
    fmRatio: 2,
    drive: 0,
  };
}

class BassVoice {
  private readonly tones: Array<{
    oscillator: OscillatorNode;
    gain: GainNode;
    pan: StereoPannerNode;
  }> = [];
  private readonly sources: OscillatorNode[] = [];
  private readonly filters: BiquadFilterNode[];
  private readonly gain: GainNode;
  private readonly level: GainNode;
  private readonly shaper: WaveShaperNode;
  private readonly driveDry: GainNode;
  private readonly driveWet: GainNode;
  private readonly modulation: OscillatorNode;
  private readonly modulationGain: GainNode;
  private sliding = false;
  private firstStep = true;
  /** Fluff has its own sub-and-mid bass synth. */
  private readonly fluff: FluffBass | null;

  constructor(
    private readonly graph: AudioGraph,
    family: ProjectMode,
  ) {
    const context = graph.context;
    this.fluff =
      family === "fluff"
        ? new FluffBass(context, fluffBus(graph), graph.sources)
        : null;
    const mix = context.createGain();
    this.shaper = context.createWaveShaper();
    this.shaper.curve = localDriveCurve(1);
    this.driveDry = context.createGain();
    this.driveWet = context.createGain();
    this.driveDry.gain.value = 1;
    this.driveWet.gain.value = 0;
    const driven = context.createGain();
    this.filters = [context.createBiquadFilter(), context.createBiquadFilter()];
    this.gain = context.createGain();
    this.gain.gain.value = 0;
    this.level = context.createGain();
    this.level.gain.value = 0;
    this.modulation = context.createOscillator();
    this.modulation.type = "sine";
    this.modulationGain = context.createGain();
    this.modulationGain.gain.value = 0;
    this.modulation.connect(this.modulationGain);
    this.sources.push(this.modulation);
    const nodes: AudioNode[] = [
      mix,
      this.shaper,
      this.gain,
      this.level,
      this.modulationGain,
      this.driveDry,
      this.driveWet,
      driven,
    ];
    for (let index = 0; index < 3; index += 1) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const pan = context.createStereoPanner();
      gain.gain.value = 0;
      oscillator.connect(gain);
      gain.connect(pan);
      pan.connect(mix);
      if (index === 0) this.modulationGain.connect(oscillator.frequency);
      this.tones.push({ oscillator, gain, pan });
      this.sources.push(oscillator);
      nodes.push(gain, pan);
    }
    mix.connect(this.driveDry);
    mix.connect(this.shaper);
    this.shaper.connect(this.driveWet);
    this.driveDry.connect(driven);
    this.driveWet.connect(driven);
    let previous: AudioNode = driven;
    for (const filter of this.filters) {
      filter.type = "lowpass";
      filter.frequency.value = 500;
      previous.connect(filter);
      previous = filter;
      nodes.push(filter);
    }
    if (this.fluff) return;
    previous.connect(this.gain);
    this.gain.connect(this.level);
    this.level.connect(graph.grainBass);
    let remaining = this.sources.length;
    for (const source of this.sources) {
      graph.sources.add(source);
      source.onended = () => {
        graph.sources.delete(source);
        source.disconnect();
        remaining -= 1;
        if (remaining === 0) for (const node of nodes) node.disconnect();
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
    if (this.fluff) {
      this.fluff.schedule(track, stepIndex, time, duration);
      return;
    }
    const step = track.steps[stepIndex];
    const envelope = this.gain.gain;
    this.level.gain.cancelAndHoldAtTime(time);
    if (this.firstStep)
      this.level.gain.setValueAtTime(track.muted ? 0 : track.volume, time);
    else
      this.level.gain.setTargetAtTime(
        track.muted ? 0 : track.volume,
        time,
        0.004,
      );
    this.firstStep = false;
    envelope.cancelAndHoldAtTime(time);
    if (!step?.on || track.muted) {
      envelope.linearRampToValueAtTime(0, time + 0.008);
      this.sliding = false;
      return;
    }
    const profile = bassProfile(track.sound);
    const incomingSlide = this.sliding;
    const outgoingSlide = tiesNextStep(track.steps, stepIndex);
    const frequency = midiFrequency(step.note);
    const complexity = track.shape * 2;
    const extra = Math.max(0, track.shape - 0.5) * 2;
    const levels = profile.tones.map((tone, index) =>
      index === 0
        ? tone.level
        : tone.level *
            (index === 1
              ? complexity * (1.5 - track.pulse)
              : (1.35 - track.shape * 0.7) * (0.5 + track.pulse)) +
          (index === 1 ? extra * 0.25 : 0),
    );
    const total = Math.max(
      MIN_GAIN,
      levels.reduce((sum, value) => sum + value, 0),
    );
    const setFrequency = (parameter: AudioParam, target: number) => {
      parameter.cancelAndHoldAtTime(time);
      if (incomingSlide)
        parameter.exponentialRampToValueAtTime(
          target,
          time + Math.min(0.07, duration * 0.6),
        );
      else parameter.setValueAtTime(target, time);
    };
    this.tones.forEach((tone, index) => {
      const configuration = profile.tones[index];
      if (!configuration) return;
      tone.oscillator.type =
        configuration.type === "selected" ? track.waveform : configuration.type;
      tone.oscillator.detune.setValueAtTime(
        configuration.detune * complexity,
        time,
      );
      tone.gain.gain.setTargetAtTime((levels[index] ?? 0) / total, time, 0.004);
      tone.pan.pan.setValueAtTime(
        Math.max(-0.9, Math.min(0.9, configuration.pan * (0.5 + track.shape))),
        time,
      );
      setFrequency(
        tone.oscillator.frequency,
        frequency * configuration.multiplier,
      );
    });
    setFrequency(this.modulation.frequency, frequency * profile.fmRatio);
    const fm =
      profile.fm * (0.3 + track.shape * 1.4) +
      ([1, 2, 3].includes(track.sound)
        ? Math.max(0, track.shape - 0.65) * 2
        : 0);
    this.modulationGain.gain.cancelAndHoldAtTime(time);
    if (fm > 0) {
      const depth = frequency * fm * (0.3 + track.envelope);
      this.modulationGain.gain.linearRampToValueAtTime(depth, time + 0.003);
      this.modulationGain.gain.exponentialRampToValueAtTime(
        Math.max(MIN_GAIN, depth * 0.035),
        time + Math.max(0.025, track.decay * 0.6),
      );
    } else this.modulationGain.gain.setValueAtTime(0, time);
    const drive = 1 - (1 - profile.drive) * (1 - track.drive);
    this.driveDry.gain.setTargetAtTime(1 - drive, time, 0.006);
    this.driveWet.gain.setTargetAtTime(drive, time, 0.006);
    const release = Math.max(
      0.02,
      Math.min(
        duration * profile.gate * (0.35 + track.pulse * 1.3),
        track.decay * profile.release * (0.4 + track.pulse * 1.2),
      ),
    );
    const amplitude = Math.max(
      MIN_GAIN,
      (profile.level * Math.SQRT2 * (step.accent ? 1.35 : 1)) /
        (1 + track.resonance * profile.resonance * 0.04),
    );
    if (!incomingSlide) {
      envelope.setValueAtTime(MIN_GAIN, time);
      envelope.linearRampToValueAtTime(
        amplitude,
        time + Math.min(profile.attack, release * 0.2),
      );
    } else
      envelope.linearRampToValueAtTime(
        amplitude * (step.accent ? 1 : 0.85),
        time + Math.min(0.02, release * 0.4),
      );
    if (outgoingSlide)
      envelope.exponentialRampToValueAtTime(
        Math.max(MIN_GAIN, amplitude * 0.74 * (0.55 + track.pulse * 0.9)),
        time + duration,
      );
    else {
      envelope.exponentialRampToValueAtTime(
        Math.max(
          MIN_GAIN,
          amplitude * profile.sustain * (0.3 + track.pulse * 1.4),
        ),
        time + release * 0.66,
      );
      envelope.exponentialRampToValueAtTime(MIN_GAIN, time + release * 0.94);
      envelope.linearRampToValueAtTime(0, time + release);
    }
    this.filters.forEach((filter, index) => {
      const base = Math.max(
        35,
        Math.min(
          15000,
          track.cutoff * profile.cutoff * (index === 0 ? 1 : 1.12),
        ),
      );
      const peak = Math.min(
        16000,
        base * (1 + track.envelope * profile.envelope * (0.5 + track.shape)) +
          track.envelope *
            (step.accent ? profile.accentBrightness : profile.brightness) *
            (0.6 + track.shape * 0.8),
      );
      filter.Q.setValueAtTime(
        index === 0
          ? 0.7 +
              track.resonance * profile.resonance * (0.4 + track.shape * 1.2)
          : 0.7,
        time,
      );
      filter.frequency.cancelAndHoldAtTime(time);
      if (!incomingSlide) {
        filter.frequency.setValueAtTime(base, time);
        filter.frequency.exponentialRampToValueAtTime(peak, time + 0.004);
      } else if (step.accent)
        filter.frequency.exponentialRampToValueAtTime(
          base + (peak - base) * 0.65,
          time + 0.02,
        );
      filter.frequency.exponentialRampToValueAtTime(
        base,
        time + Math.max(0.025, track.decay * profile.filterDecay),
      );
    });
    this.sliding = outgoingSlide;
  }

  stop(time = this.graph.context.currentTime): void {
    if (this.fluff) {
      this.fluff.stop(time);
      return;
    }
    this.gain.gain.cancelAndHoldAtTime(time);
    this.gain.gain.linearRampToValueAtTime(0, time + 0.008);
    for (const source of this.sources) source.stop(time + 0.012);
  }
}

function keysEchoTail(track: KeysTrack, bpm: number): number {
  return track.space > 0
    ? Math.max(
        (60 / bpm) * (track.sound === 4 ? 2.25 : 1.5),
        track.sound === 1 || track.sound === 5 || track.sound === 7 ? 0.9 : 0,
      )
    : 0;
}

function grainDrumTail(project: Project, drum: DrumTrack): number {
  return Array.from({ length: automationStepCount(drum) }, (_, step) =>
    automatedDrum(drum, step, project.scale),
  ).reduce((longest, track) => {
    if (track.muted || track.volume === 0) return longest;
    let decay = track.decay;
    if (track.id === "kick" && track.sound === 3)
      decay = Math.min(2, track.decay * 1.35);
    if (track.id === "snare" && track.sound === 4)
      decay = Math.min(2, track.decay * 1.3);
    if (track.id === "hat") decay = hatDuration(track.sound, track.decay);
    if (track.id === "snare" && track.sound === 6)
      decay = Math.min(1.4, track.decay * 1.05) + 0.054;
    if (track.id === "clap" && track.sound === 6)
      decay = track.decay * 1.25 + 0.95;
    if (track.id === "clap" && track.sound === 3)
      decay = track.decay * 1.2 + 0.945;
    return Math.max(longest, decay + 0.12 + (track.space > 0 ? 0.92 : 0));
  }, 0);
}
function grainKeysTail(project: Project): number {
  const automated = Array.from(
    { length: automationStepCount(project.keys) },
    (_, step) => automatedKeys(project.keys, step),
  );
  return project.keys.muted || automated.every((track) => track.volume === 0)
    ? 0
    : Math.max(...automated.map((track) => track.decay)) +
        Math.max(
          ...automated.map((track) => keysEchoTail(track, project.bpm)),
        ) +
        0.08;
}
/** Each track rings out as its own family's voice; Fluff voices also feed the hall. */
export function exportTailDuration(project: Project): number {
  const fluff = (track: FamilyTrack): boolean =>
    trackFamily(project.mode, track) === "fluff";
  const drums = project.drums.map((track) =>
    fluff(track)
      ? track.muted || track.volume === 0
        ? 0
        : fluffDrumTail(track)
      : grainDrumTail(project, track),
  );
  const keys = fluff(project.keys)
    ? fluffLeadTail(project.keys)
    : grainKeysTail(project);
  const hall =
    project.mode === "fluff" || projectUsesFamily(project, "fluff")
      ? FLUFF_HALL_SECONDS * 0.75
      : 0;
  return (
    Math.max(
      0.35,
      ...drums,
      keys,
      arpTailDuration(project.arp, project.bpm),
      padTailDuration(project.pad, project.bpm),
      vocalTailDuration(project.vocal, project.bpm),
      cloudTailDuration(project.cloud),
      tensionTailDuration(project.tension),
    ) +
    hall +
    performanceFxTail(project)
  );
}

interface KeysTone {
  type: OscillatorType;
  multiplier: number;
  level: number;
  detune: number;
  scaleDegree?: number;
}

function keysTones(sound: number): KeysTone[] {
  if (sound === 0)
    return [
      { type: "sine", multiplier: 1, level: 0.3, detune: 0 },
      { type: "triangle", multiplier: 2, level: 0.12, detune: 0 },
      { type: "sine", multiplier: 3, level: 0.04, detune: 0 },
    ];
  if (sound === 1)
    return [
      { type: "sine", multiplier: 1, level: 0.08, detune: -4 },
      { type: "triangle", multiplier: 1, level: 0.06, detune: 4 },
      { type: "sine", multiplier: 2, level: 0.02, detune: 0 },
    ];
  if (sound === 3)
    return [
      { type: "sine", multiplier: 1, level: 0.08, detune: 0 },
      { type: "triangle", multiplier: 2, level: 0.04, detune: 0 },
      { type: "sine", multiplier: 3, level: 0.02, detune: 0 },
    ];
  if (sound === 4)
    return [
      {
        type: "triangle",
        multiplier: 1,
        level: 0.46,
        detune: -4,
        scaleDegree: 0,
      },
      {
        type: "sawtooth",
        multiplier: 1,
        level: 0.16,
        detune: 5,
        scaleDegree: 2,
      },
      { type: "sine", multiplier: 1, level: 0.22, detune: 0, scaleDegree: 4 },
    ];
  if (sound === 5)
    return [
      { type: "sine", multiplier: 1, level: 0.02, detune: 0 },
      { type: "sine", multiplier: 2, level: 0.025, detune: 4 },
      { type: "triangle", multiplier: 3, level: 0.008, detune: -4 },
    ];
  if (sound === 6)
    return [
      { type: "sine", multiplier: 1, level: 0.72, detune: 0 },
      { type: "sine", multiplier: 2, level: 0.13, detune: 0 },
      { type: "triangle", multiplier: 3, level: 0.055, detune: 0 },
    ];
  if (sound === 7)
    return [
      { type: "triangle", multiplier: 1, level: 0.28, detune: -6 },
      { type: "sine", multiplier: 2, level: 0.24, detune: 6 },
      { type: "sine", multiplier: 4, level: 0.1, detune: -3 },
    ];
  return [
    {
      type: "sawtooth",
      multiplier: 1,
      level: 0.38,
      detune: -7,
      scaleDegree: 0,
    },
    {
      type: "sawtooth",
      multiplier: 2 ** (3 / 12),
      level: 0.31,
      detune: 5,
      scaleDegree: 2,
    },
    {
      type: "sawtooth",
      multiplier: 2 ** (7 / 12),
      level: 0.25,
      detune: -3,
      scaleDegree: 4,
    },
  ];
}

interface TextureShape {
  attack: number;
  amplitude: number;
  sustain: number;
  sustainTime: number;
  cutoffBase: number;
  cutoffRange: number;
  cutoffRoot: number;
  tailBase: number;
  tailRange: number;
  tailRoot: number;
  noiseRatio: number;
  noiseRange: number;
  noiseQ: number;
  noiseQRange: number;
  noiseLevel: number;
  noiseTail: number;
  roomLevel: number;
}

function textureShape(sound: number): TextureShape {
  if (sound === 3)
    return {
      attack: 0.002,
      amplitude: 0.56,
      sustain: 0.28,
      sustainTime: 0.75,
      cutoffBase: 1200,
      cutoffRange: 6500,
      cutoffRoot: 3,
      tailBase: 700,
      tailRange: 3000,
      tailRoot: 1.5,
      noiseRatio: 3.5,
      noiseRange: 5,
      noiseQ: 1.2,
      noiseQRange: 1,
      noiseLevel: 1.1,
      noiseTail: 0.01,
      roomLevel: 0,
    };
  if (sound === 4)
    return {
      attack: 0.006,
      amplitude: 0.46,
      sustain: 0.3,
      sustainTime: 0.45,
      cutoffBase: 350,
      cutoffRange: 3000,
      cutoffRoot: 1.6,
      tailBase: 180,
      tailRange: 950,
      tailRoot: 0.8,
      noiseRatio: 2,
      noiseRange: 3,
      noiseQ: 0.7,
      noiseQRange: 0,
      noiseLevel: 0.06,
      noiseTail: 0.008,
      roomLevel: 0,
    };
  if (sound === 5)
    return {
      attack: 0.024,
      amplitude: 0.44,
      sustain: 0.35,
      sustainTime: 0.72,
      cutoffBase: 6500,
      cutoffRange: 11000,
      cutoffRoot: 5,
      tailBase: 4200,
      tailRange: 7000,
      tailRoot: 3,
      noiseRatio: 8,
      noiseRange: 8,
      noiseQ: 0.5,
      noiseQRange: 0,
      noiseLevel: 0.9,
      noiseTail: 0.7,
      roomLevel: 0.4,
    };
  if (sound === 6)
    return {
      attack: 0.001,
      amplitude: 0.58,
      sustain: 0.1,
      sustainTime: 0.45,
      cutoffBase: 800,
      cutoffRange: 5200,
      cutoffRoot: 3,
      tailBase: 220,
      tailRange: 1200,
      tailRoot: 1.5,
      noiseRatio: 3,
      noiseRange: 2,
      noiseQ: 1.1,
      noiseQRange: 0.8,
      noiseLevel: 0.24,
      noiseTail: 0.002,
      roomLevel: 0,
    };
  if (sound === 7)
    return {
      attack: 0.035,
      amplitude: 0.56,
      sustain: 0.58,
      sustainTime: 0.62,
      cutoffBase: 700,
      cutoffRange: 4300,
      cutoffRoot: 2,
      tailBase: 320,
      tailRange: 1500,
      tailRoot: 1,
      noiseRatio: 2,
      noiseRange: 4,
      noiseQ: 5,
      noiseQRange: 4,
      noiseLevel: 0.22,
      noiseTail: 0.07,
      roomLevel: 0.22,
    };
  return {
    attack: sound === 1 ? 0.035 : sound === 2 ? 0.0035 : 0.0015,
    amplitude: sound === 1 ? 0.56 : sound === 2 ? 0.42 : 0.58,
    sustain: sound === 1 ? 0.42 : sound === 2 ? 0.2 : 0.08,
    sustainTime: sound === 1 ? 0.7 : sound === 2 ? 0.38 : 0.32,
    cutoffBase: sound === 1 ? 1400 : sound === 2 ? 450 : 700,
    cutoffRange: sound === 1 ? 7800 : 6000,
    cutoffRoot: sound === 1 ? 3 : 1.8,
    tailBase: sound === 1 ? 1100 : 220,
    tailRange: sound === 1 ? 4200 : 2000,
    tailRoot: sound === 1 ? 1.8 : 1,
    noiseRatio: sound === 1 ? 4 : 2.5,
    noiseRange: sound === 1 ? 5 : 3,
    noiseQ: sound === 1 ? 0.45 : sound === 2 ? 0.7 : 1.4,
    noiseQRange: sound < 1 ? 1.2 : 0,
    noiseLevel: sound === 1 ? 1.35 : sound === 2 ? 0.18 : 0.85,
    noiseTail: sound === 1 ? 1.35 : sound === 0 ? 0.04 : 0.015,
    roomLevel: sound === 1 ? 0.32 : 0,
  };
}

function textureNoiseCurve(sound: number): Float32Array<ArrayBuffer> {
  if (sound === 1 || sound === 5) return new Float32Array([-1, 1]);
  const curve = new Float32Array(2048);
  for (let index = 0; index < curve.length; index += 1) {
    const value = (index / (curve.length - 1)) * 2 - 1;
    const shaped = Math.tanh(value * 2.2) / 2.2;
    curve[index] =
      sound === 0
        ? Math.round(shaped * 48) / 48
        : sound === 3
          ? Math.round(shaped * 24) / 24
          : shaped;
  }
  return curve;
}

function textureRoom(graph: AudioGraph): AudioBuffer {
  if (graph.textureRoom) return graph.textureRoom;
  const room = graph.context.createBuffer(
    2,
    Math.ceil(graph.context.sampleRate * 0.9),
    graph.context.sampleRate,
  );
  for (let channel = 0; channel < room.numberOfChannels; channel += 1) {
    const samples = room.getChannelData(channel);
    let filtered = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const time = index / graph.context.sampleRate;
      filtered = filtered * 0.7 + (Math.random() * 2 - 1) * 0.3;
      samples[index] =
        time < 0.018
          ? 0
          : filtered *
            Math.min(1, (time - 0.018) / 0.025) *
            (1 - index / samples.length) ** 3;
    }
  }
  graph.textureRoom = room;
  return room;
}

class KeysVoice {
  private readonly stereoInput: GainNode;
  private readonly widthGains: GainNode[] = [];
  private readonly filter: BiquadFilterNode;
  private readonly envelope: GainNode;
  private readonly gritNode: WaveShaperNode;
  private readonly gritDry: GainNode;
  private readonly gritWet: GainNode;
  private readonly flutter: GainNode;
  private readonly motionOscillator: OscillatorNode;
  private readonly motionDepth: GainNode;
  private readonly filterMotion: GainNode;
  private readonly pitchMotion: GainNode;
  private readonly noise: AudioBufferSourceNode;
  private readonly noiseFilter: BiquadFilterNode;
  private readonly noiseGain: GainNode;
  private readonly noiseColor: WaveShaperNode;
  private readonly nodes: AudioNode[] = [];
  private roomGain: GainNode | null = null;
  private readonly tones: Array<{
    oscillator: OscillatorNode;
    gain: GainNode;
  }> = [];
  private readonly echoes: Array<{
    delay: DelayNode;
    damping: BiquadFilterNode;
    gain: GainNode;
  }> = [];
  private echoTail = 0;
  private sound: number;
  finished = false;

  constructor(
    private readonly graph: AudioGraph,
    track: KeysTrack,
    time: number,
  ) {
    const context = graph.context;
    this.stereoInput = context.createGain();
    this.stereoInput.channelCount = 2;
    this.stereoInput.channelCountMode = "explicit";
    const split = context.createChannelSplitter(2);
    const merge = context.createChannelMerger(2);
    this.stereoInput.connect(split);
    for (let index = 0; index < 4; index += 1) {
      const gain = context.createGain();
      gain.gain.value = index === 0 || index === 3 ? 1 : 0;
      split.connect(gain, Math.floor(index / 2));
      gain.connect(merge, 0, index % 2);
      this.widthGains.push(gain);
    }
    merge.connect(graph.cleanInput);
    this.nodes.push(this.stereoInput, split, merge, ...this.widthGains);
    this.filter = context.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = 0.55;
    this.envelope = context.createGain();
    this.envelope.gain.value = 0;
    this.gritNode = context.createWaveShaper();
    this.gritNode.curve = localDriveCurve(1, 1);
    this.gritDry = context.createGain();
    this.gritWet = context.createGain();
    this.gritDry.gain.value = 1 - track.grit;
    this.gritWet.gain.value = track.grit;
    this.flutter = context.createGain();
    this.flutter.gain.value = 1;
    this.motionOscillator = context.createOscillator();
    this.motionDepth = context.createGain();
    this.motionDepth.gain.value = 0;
    this.filterMotion = context.createGain();
    this.filterMotion.gain.value = 0;
    this.pitchMotion = context.createGain();
    this.pitchMotion.gain.value = 0;
    this.motionOscillator.connect(this.motionDepth);
    this.motionOscillator.connect(this.filterMotion);
    this.motionOscillator.connect(this.pitchMotion);
    this.motionDepth.connect(this.flutter.gain);
    this.filterMotion.connect(this.filter.detune);
    this.filter.connect(this.gritDry);
    this.filter.connect(this.gritNode);
    this.gritNode.connect(this.gritWet);
    this.gritDry.connect(this.envelope);
    this.gritWet.connect(this.envelope);
    this.envelope.connect(this.flutter);
    this.flutter.connect(this.stereoInput);
    const nodes = this.nodes;
    nodes.push(
      this.filter,
      this.envelope,
      this.gritNode,
      this.flutter,
      this.motionDepth,
      this.filterMotion,
      this.pitchMotion,
      this.gritDry,
      this.gritWet,
    );
    const sources: ScheduledSource[] = [this.motionOscillator];
    this.sound = track.sound;
    this.noise = context.createBufferSource();
    this.noise.buffer = graph.noise;
    this.noise.loop = true;
    this.noiseFilter = context.createBiquadFilter();
    this.noiseFilter.type = "bandpass";
    this.noiseGain = context.createGain();
    this.noiseGain.gain.value = 0;
    this.noiseColor = context.createWaveShaper();
    this.noiseColor.curve = textureNoiseCurve(track.sound);
    this.noise.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noiseColor);
    this.noiseColor.connect(this.noiseGain);
    this.noiseGain.connect(this.filter);
    this.filterMotion.connect(this.noiseFilter.detune);
    sources.push(this.noise);
    nodes.push(this.noiseFilter, this.noiseGain, this.noiseColor);
    for (const tone of keysTones(track.sound)) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = tone.type;
      oscillator.detune.value = tone.detune;
      this.pitchMotion.connect(oscillator.detune);
      gain.gain.value = tone.level;
      oscillator.connect(gain);
      gain.connect(this.filter);
      sources.push(oscillator);
      nodes.push(gain);
      this.tones.push({ oscillator, gain });
      oscillator.addEventListener(
        "ended",
        () => {
          this.finished = true;
        },
        { once: true },
      );
    }
    for (let index = 0; index < 3; index += 1) {
      // A held voice can change tempo or switch to Dub; reserve each tap at 60 BPM.
      const delay = context.createDelay((index + 1) * 0.75 + 0.01);
      const damping = context.createBiquadFilter();
      const gain = context.createGain();
      const pan = context.createStereoPanner();
      damping.type = "lowpass";
      damping.Q.value = 0.5;
      gain.gain.value = 0;
      pan.pan.value = index % 2 === 0 ? -0.5 : 0.5;
      this.flutter.connect(delay);
      delay.connect(damping);
      damping.connect(gain);
      gain.connect(pan);
      pan.connect(this.stereoInput);
      nodes.push(delay, damping, gain, pan);
      this.echoes.push({ delay, damping, gain });
    }
    if (textureShape(track.sound).roomLevel > 0) this.ensureRoom();
    scheduleSources(
      graph,
      sources,
      nodes,
      time,
      time + track.decay + keysEchoTail(track, graph.bpm) + 0.05,
      Math.random() * graph.noise.duration * 0.8,
    );
  }

  schedule(
    track: KeysTrack,
    note: number,
    accent: boolean,
    time: number,
    duration: number,
    incomingSlide: boolean,
    outgoingSlide: boolean,
  ): void {
    const frequency = midiFrequency(note);
    const shape = textureShape(track.sound);
    this.widthGains.forEach((gain, index) => {
      gain.gain.setTargetAtTime(
        index === 0 || index === 3 ? 0.5 + track.width : 0.5 - track.width,
        time,
        0.006,
      );
    });
    const chordRoot = track.sound === 4 ? note - 12 : note;
    const chord = scaleNotes(this.graph.scale, chordRoot, chordRoot + 24);
    if (track.sound !== this.sound) {
      this.noiseColor.curve = textureNoiseCurve(track.sound);
      this.sound = track.sound;
    }
    this.gritDry.gain.setTargetAtTime(1 - track.grit, time, 0.006);
    this.gritWet.gain.setTargetAtTime(track.grit, time, 0.006);
    const motionRate =
      track.sound === 1
        ? 0.35 + track.motion * 2.5
        : track.sound === 3
          ? 5 + track.motion * 25
          : track.sound === 4
            ? 0.3 + track.motion * 3
            : track.sound === 5
              ? 4 + track.motion * 12
              : track.sound === 6
                ? 12 + track.motion * 38
                : track.sound === 7
                  ? 0.65 + track.motion * 7
                  : 2 + track.motion * 18;
    this.motionOscillator.type = track.sound === 3 ? "triangle" : "sine";
    this.motionOscillator.frequency.setValueAtTime(motionRate, time);
    this.motionDepth.gain.setValueAtTime(track.motion * 0.48, time);
    this.flutter.gain.setValueAtTime(1 - track.motion * 0.48, time);
    this.filterMotion.gain.setValueAtTime(track.motion * 900, time);
    this.pitchMotion.gain.setValueAtTime(track.motion * 12, time);
    const configurations = keysTones(track.sound);
    this.tones.forEach((tone, index) => {
      const configuration = configurations[index];
      if (!configuration) return;
      const targetFrequency =
        configuration.scaleDegree === undefined
          ? frequency * configuration.multiplier
          : midiFrequency(chord[configuration.scaleDegree] ?? chordRoot);
      tone.oscillator.type = configuration.type;
      tone.oscillator.detune.setValueAtTime(configuration.detune, time);
      tone.gain.gain.setTargetAtTime(configuration.level, time, 0.01);
      tone.oscillator.frequency.cancelAndHoldAtTime(time);
      if (incomingSlide)
        tone.oscillator.frequency.exponentialRampToValueAtTime(
          targetFrequency,
          time + Math.min(0.08, duration * 0.65),
        );
      else if (track.sound === 6) {
        tone.oscillator.frequency.setValueAtTime(
          targetFrequency * (1.32 + track.motion * 0.7),
          time,
        );
        tone.oscillator.frequency.exponentialRampToValueAtTime(
          targetFrequency,
          time + Math.min(0.065, track.decay * 0.4),
        );
      } else tone.oscillator.frequency.setValueAtTime(targetFrequency, time);
    });
    const attack = Math.min(
      track.decay * shape.sustainTime * 0.8,
      Math.min(track.decay * 0.2, shape.attack) * (accent ? 0.7 : 1) +
        track.attack ** 2 * Math.min(0.24, track.decay * 0.6),
    );
    const amplitude = Math.max(MIN_GAIN, shape.amplitude * (accent ? 1.28 : 1));
    const cutoff = Math.min(
      15000,
      Math.max(
        frequency * shape.cutoffRoot,
        (shape.cutoffBase + track.tone ** 1.2 * shape.cutoffRange) *
          (accent ? 1.18 : 1),
      ),
    );
    const envelope = this.envelope.gain;
    envelope.cancelAndHoldAtTime(time);
    if (!incomingSlide) {
      envelope.setValueAtTime(0, time);
      envelope.linearRampToValueAtTime(amplitude, time + attack);
    } else
      envelope.linearRampToValueAtTime(
        amplitude * (accent ? 1 : 0.85),
        time + 0.025,
      );
    if (outgoingSlide)
      envelope.exponentialRampToValueAtTime(
        Math.max(MIN_GAIN, amplitude * 0.75),
        time + duration,
      );
    else {
      envelope.exponentialRampToValueAtTime(
        Math.max(MIN_GAIN, amplitude * shape.sustain),
        time + track.decay * shape.sustainTime,
      );
      envelope.exponentialRampToValueAtTime(MIN_GAIN, time + track.decay);
      envelope.linearRampToValueAtTime(0, time + track.decay + 0.01);
    }
    this.filter.frequency.cancelAndHoldAtTime(time);
    if (incomingSlide)
      this.filter.frequency.exponentialRampToValueAtTime(cutoff, time + 0.025);
    else this.filter.frequency.setValueAtTime(cutoff, time);
    this.filter.frequency.exponentialRampToValueAtTime(
      Math.max(
        frequency * shape.tailRoot,
        shape.tailBase + track.tone * shape.tailRange,
      ),
      time + track.decay,
    );
    const noiseFrequency =
      track.sound === 5
        ? Math.min(15000, (2500 + track.tone * 4500) * (frequency / 220) ** 0.5)
        : Math.min(
            18000,
            frequency * (shape.noiseRatio + track.tone * shape.noiseRange),
          );
    this.noiseFilter.type = track.sound === 5 ? "highpass" : "bandpass";
    this.noiseFilter.frequency.cancelAndHoldAtTime(time);
    this.noise.playbackRate.cancelAndHoldAtTime(time);
    if (incomingSlide) {
      this.noiseFilter.frequency.exponentialRampToValueAtTime(
        noiseFrequency,
        time + Math.min(0.08, duration * 0.65),
      );
      this.noise.playbackRate.exponentialRampToValueAtTime(
        frequency / 220,
        time + Math.min(0.08, duration * 0.65),
      );
    } else {
      this.noiseFilter.frequency.setValueAtTime(noiseFrequency, time);
      this.noise.playbackRate.setValueAtTime(frequency / 220, time);
    }
    this.noiseFilter.Q.setValueAtTime(
      shape.noiseQ + track.tone * shape.noiseQRange,
      time,
    );
    if (track.sound === 7)
      this.noiseFilter.frequency.exponentialRampToValueAtTime(
        Math.min(14000, frequency * (2.2 + track.tone * 2)),
        time + track.decay,
      );
    const noiseLevel = shape.noiseLevel;
    this.noiseGain.gain.cancelAndHoldAtTime(time);
    if (!incomingSlide || accent) {
      this.noiseGain.gain.setValueAtTime(noiseLevel, time);
      if (
        track.sound !== 1 &&
        track.sound !== 3 &&
        track.sound !== 5 &&
        track.sound !== 7
      )
        this.noiseGain.gain.exponentialRampToValueAtTime(
          shape.noiseTail,
          time + Math.min(0.035, track.decay * 0.4),
        );
    } else if (track.sound === 1 || track.sound === 5 || track.sound === 7)
      this.noiseGain.gain.setTargetAtTime(noiseLevel, time, 0.02);
    if (track.sound === 3) {
      const length = outgoingSlide ? duration : track.decay;
      const grains = Math.min(
        Math.round(12 + track.motion * 12),
        Math.max(3, Math.round(length / (0.025 / (1 + track.motion * 1.8)))),
      );
      for (let grain = 0; grain < grains; grain += 1) {
        const start = time + (grain / grains) * length * 0.85;
        const size = Math.min(0.018, (length / grains) * 0.7);
        this.noiseGain.gain.setValueAtTime(MIN_GAIN, start);
        this.noiseGain.gain.linearRampToValueAtTime(
          noiseLevel * (0.45 + Math.random() * 0.55),
          start + size * 0.2,
        );
        this.noiseGain.gain.exponentialRampToValueAtTime(
          MIN_GAIN,
          start + size,
        );
        this.noiseFilter.frequency.setValueAtTime(
          Math.min(18000, noiseFrequency * (0.7 + Math.random() * 0.8)),
          start,
        );
      }
    }
    const beat = 60 / this.graph.bpm;
    this.echoes.forEach((echo, index) => {
      echo.delay.delayTime.setValueAtTime(
        beat * (index + 1) * (track.sound === 4 ? 0.75 : 0.5),
        time,
      );
      echo.damping.frequency.setValueAtTime(
        track.sound === 4
          ? (650 + track.tone * 2200) * 0.8 ** index
          : 1200 + track.tone * 3000,
        time,
      );
      echo.gain.gain.setValueAtTime(
        track.space *
          (track.sound === 4
            ? index === 0
              ? 0.42
              : index === 1
                ? 0.26
                : 0.14
            : index === 0
              ? 0.2
              : index === 1
                ? 0.12
                : 0.07) *
          (track.sound === 1 || track.sound === 5 ? 0.3 : 1),
        time,
      );
    });
    if (shape.roomLevel > 0) this.ensureRoom();
    this.roomGain?.gain.setValueAtTime(track.space * shape.roomLevel, time);
    this.echoTail = Math.max(
      this.echoTail,
      keysEchoTail(track, this.graph.bpm),
    );
    this.scheduleStop(
      time +
        (outgoingSlide ? duration : 0) +
        track.decay +
        this.echoTail +
        0.05,
    );
  }

  private ensureRoom(): void {
    if (this.roomGain) return;
    const room = this.graph.context.createConvolver();
    room.buffer = textureRoom(this.graph);
    const gain = this.graph.context.createGain();
    gain.gain.value = 0;
    this.flutter.connect(room);
    room.connect(gain);
    gain.connect(this.stereoInput);
    this.nodes.push(room, gain);
    this.roomGain = gain;
  }

  release(time: number, decay: number): void {
    if (this.finished) return;
    this.envelope.gain.cancelAndHoldAtTime(time);
    this.envelope.gain.exponentialRampToValueAtTime(MIN_GAIN, time + decay);
    this.envelope.gain.linearRampToValueAtTime(0, time + decay + 0.01);
    this.scheduleStop(time + decay + this.echoTail + 0.05);
  }

  private scheduleStop(time: number): void {
    for (const tone of this.tones) tone.oscillator.stop(time);
    this.noise.stop(time);
    this.motionOscillator.stop(time);
  }
}

class KeysSequencer {
  private tiedVoice: KeysVoice | null = null;
  private firstStep = true;
  constructor(private readonly graph: AudioGraph) {}

  schedule(
    track: KeysTrack,
    stepIndex: number,
    time: number,
    duration: number,
  ): void {
    const step = track.steps[stepIndex];
    const level = this.graph.cleanInput.gain;
    level.cancelAndHoldAtTime(time);
    if (this.firstStep)
      level.setValueAtTime(track.muted ? 0 : track.volume * 0.72, time);
    else
      level.setTargetAtTime(track.muted ? 0 : track.volume * 0.72, time, 0.004);
    this.firstStep = false;
    if (!step?.on || track.muted) {
      this.tiedVoice?.release(time, 0.015);
      this.tiedVoice = null;
      return;
    }
    const incomingSlide = this.tiedVoice !== null && !this.tiedVoice.finished;
    const voice =
      incomingSlide && this.tiedVoice
        ? this.tiedVoice
        : new KeysVoice(this.graph, track, time);
    const outgoingSlide = tiesNextStep(track.steps, stepIndex);
    voice.schedule(
      track,
      step.note,
      step.accent,
      time,
      duration,
      incomingSlide,
      outgoingSlide,
    );
    this.tiedVoice = outgoingSlide ? voice : null;
  }

  release(time: number, decay: number): void {
    this.tiedVoice?.release(time, decay);
    this.tiedVoice = null;
  }
}

export interface ScheduledTrackEvent {
  instrument: InstrumentId;
  absoluteStep: number;
  index: number;
  logicalTick: number;
  audibleTick: number;
  duration: number;
}
export function projectEventsAtTick(
  project: Project,
  logicalTick: number,
): ScheduledTrackEvent[] {
  if (!Number.isInteger(logicalTick) || logicalTick < 0) return [];
  const events: ScheduledTrackEvent[] = [];
  const add = (
    instrument: InstrumentId,
    timing: Project["bass"]["timing"] | Project["pad"]["timing"],
    extra = false,
  ): void => {
    const stepTicks = ticksPerStep(timing);
    if (!extra && logicalTick % stepTicks !== 0) return;
    events.push({
      instrument,
      absoluteStep: logicalTick / stepTicks,
      index: Math.floor(logicalTick / stepTicks) % trackStepCount(timing),
      logicalTick,
      audibleTick: swungTick(logicalTick, project.swing, timing.grid),
      duration: tickSpanSeconds(
        logicalTick,
        logicalTick + stepTicks,
        project.bpm,
        project.swing,
        timing.grid,
      ),
    });
  };
  for (const drum of project.drums) add(drum.id, drum.timing);
  add("bass", project.bass.timing);
  add("keys", project.keys.timing);
  add("vocal", project.vocal.timing);
  add(
    "arp",
    project.arp.timing,
    logicalTick % arpRateTicks(project.arp.rate) === 0,
  );
  const addPadBoundary = (
    timing: Project["pad"]["timing"],
    interval: number,
  ): void => {
    const boundary =
      Math.ceil(
        unswungTick(logicalTick, project.swing, timing.grid) / interval - 1e-9,
      ) * interval;
    const audibleTick = swungTick(boundary, project.swing, timing.grid);
    if (
      audibleTick < logicalTick - 1e-9 ||
      audibleTick >= logicalTick + 1 - 1e-9 ||
      events.some(
        (event) =>
          event.instrument === "pad" &&
          Math.abs(event.audibleTick - audibleTick) < 1e-9,
      )
    )
      return;
    const padTick = unswungTick(
      audibleTick,
      project.swing,
      project.pad.timing.grid,
    );
    const stepTicks = ticksPerStep(project.pad.timing);
    events.push({
      instrument: "pad",
      absoluteStep: padTick / stepTicks,
      index:
        Math.floor(padTick / stepTicks + 1e-9) %
        trackStepCount(project.pad.timing),
      logicalTick: padTick,
      audibleTick,
      duration: tickSpanSeconds(
        padTick,
        padTick + stepTicks,
        project.bpm,
        project.swing,
        project.pad.timing.grid,
      ),
    });
  };
  // Pad automation and harmony can use different grids. Bucket their audible
  // boundaries so a later swung chord never precedes an earlier triplet update.
  addPadBoundary(project.pad.timing, ticksPerStep(project.pad.timing));
  const chordTiming = project.pad.followChords
    ? project.progression.timing
    : project.pad.timing;
  addPadBoundary(chordTiming, trackCycleTicks(chordTiming) / 4);
  if (!project.cloud.muted) add("cloud", project.cloud.timing, true);
  if (!project.tension.muted) add("tension", project.tension.timing);
  return events.sort((a, b) => a.audibleTick - b.audibleTick);
}
interface FamilyVoice<T> {
  family: ProjectMode;
  voice: T;
}

/**
 * Bass, Texture/Lead, arp and pad voices, each built for its track's sound
 * family. The project's own voices are built up front, in their original
 * order; a voice of the other family is built only when its track first
 * plays, and the voice it replaces is released at that moment.
 */
class TrackVoices {
  private bassVoice: FamilyVoice<BassVoice> | null = null;
  private keysVoice: FamilyVoice<KeysSequencer | FluffLead> | null = null;
  private arpVoice: FamilyVoice<ArpInstrument> | null = null;
  private padVoice: FamilyVoice<PadInstrument> | null = null;

  constructor(
    private readonly graph: AudioGraph,
    project: Project,
  ) {
    const time = graph.context.currentTime;
    this.bass(trackFamily(project.mode, project.bass), time);
    this.keys(trackFamily(project.mode, project.keys), time);
    this.arp(trackFamily(project.mode, project.arp), time);
    this.pad(trackFamily(project.mode, project.pad), time);
  }

  bass(family: ProjectMode, time: number): BassVoice {
    const current = this.bassVoice;
    if (current?.family === family) return current.voice;
    current?.voice.stop(time);
    const voice = new BassVoice(this.graph, family);
    this.bassVoice = { family, voice };
    return voice;
  }

  keys(family: ProjectMode, time: number): KeysSequencer | FluffLead {
    const current = this.keysVoice;
    if (current?.family === family) return current.voice;
    const previous = current?.voice;
    if (previous instanceof FluffLead) {
      previous.stop(time);
      this.afterwards(time, () => previous.destroy());
    } else previous?.release(time, 0.015);
    const voice =
      family === "fluff"
        ? new FluffLead(this.graph.context, fluffBus(this.graph))
        : new KeysSequencer(this.graph);
    this.keysVoice = { family, voice };
    return voice;
  }

  arp(family: ProjectMode, time: number): ArpInstrument {
    const current = this.arpVoice;
    if (current?.family === family) return current.voice;
    const previous = current?.voice;
    if (previous) {
      previous.stop(time);
      this.afterwards(time, () => previous.destroy());
    }
    const voice =
      family === "fluff"
        ? new ArpInstrument(
            this.graph.context,
            this.graph.melodicInput,
            fluffBus(this.graph),
          )
        : new ArpInstrument(this.graph.context, this.graph.grainMelodic);
    this.arpVoice = { family, voice };
    return voice;
  }

  pad(family: ProjectMode, time: number): PadInstrument {
    const current = this.padVoice;
    if (current?.family === family) return current.voice;
    current?.voice.stop(time);
    const voice =
      family === "fluff"
        ? new PadInstrument(
            this.graph.context,
            this.graph.melodicInput,
            fluffBus(this.graph),
          )
        : new PadInstrument(this.graph.context, this.graph.grainMelodic);
    this.padVoice = { family, voice };
    return voice;
  }

  stop(time: number): void {
    this.bassVoice?.voice.stop(time);
    const arp = this.arpVoice?.voice;
    if (arp) {
      arp.stop(time);
      setTimeout(() => arp.destroy(), 30);
    }
    this.padVoice?.voice.stop(time);
    const keys = this.keysVoice?.voice;
    if (keys instanceof FluffLead) {
      keys.stop(time);
      setTimeout(() => keys.destroy(), 30);
    }
  }

  /** A replaced voice is torn down once its release has played. */
  private afterwards(time: number, action: () => void): void {
    const delay = Math.max(0, time - this.graph.context.currentTime);
    setTimeout(action, delay * 1000 + 50);
  }
}

function scheduleProjectTick(
  graph: AudioGraph,
  project: Project,
  voices: {
    tracks: TrackVoices;
    vocal: VocalInstrument | null;
    cloud: CloudInstrument;
    tension: TensionInstrument;
  },
  logicalTick: number,
  nominalTime: number,
): void {
  for (const event of projectEventsAtTick(project, logicalTick)) {
    const time =
      nominalTime + tickSeconds(event.audibleTick - logicalTick, project.bpm);
    const index = event.index;
    if (event.instrument === "bass")
      voices.tracks
        .bass(trackFamily(project.mode, project.bass), time)
        .schedule(
          automatedBass(project.bass, event.absoluteStep),
          index,
          time,
          event.duration,
        );
    else if (event.instrument === "keys") {
      const keys = automatedKeys(project.keys, event.absoluteStep);
      const voice = voices.tracks.keys(
        trackFamily(project.mode, project.keys),
        time,
      );
      if (voice instanceof FluffLead)
        voice.schedule(keys, index, time, event.duration, project.scale);
      else voice.schedule(keys, index, time, event.duration);
    } else if (event.instrument === "cloud")
      voices.cloud.scheduleTick(
        project.cloud,
        logicalTick,
        time,
        project.bpm,
        project.swing,
        project.scale,
      );
    else if (event.instrument === "tension")
      voices.tension.scheduleTick(
        project.tension,
        logicalTick,
        time,
        project.bpm,
        project.swing,
        project.scale,
      );
    else if (event.instrument === "vocal")
      voices.vocal?.scheduleTick(
        project.vocal,
        logicalTick,
        time,
        project.bpm,
        project.swing,
        project.scale,
        project.progression,
      );
    else if (event.instrument === "arp")
      voices.tracks
        .arp(trackFamily(project.mode, project.arp), time)
        .scheduleTick(
          project.arp,
          project.scale,
          logicalTick,
          time,
          project.bpm,
          project.progression,
          event.audibleTick,
          project.swing,
        );
    else if (event.instrument === "pad")
      voices.tracks
        .pad(trackFamily(project.mode, project.pad), time)
        .scheduleTick(
          project.pad,
          project.scale,
          event.logicalTick,
          time,
          project.bpm,
          project.swing,
          project.progression,
          event.audibleTick,
        );
    else {
      const drum = project.drums.find((track) => track.id === event.instrument);
      if (drum && !drum.muted && drum.steps[index]) {
        const voiced = automatedDrum(drum, event.absoluteStep, project.scale);
        drumVoice(graph, voiced, time, trackFamily(project.mode, drum));
        // Any kick pumps a Fluff project; in Grain a Fluff bass only ducks.
        if (drum.id === "kick" && voiced.volume > 0)
          graph.fluff?.pump(
            time,
            graph.mode === "fluff" ? project.drive : 0,
            project.bpm,
          );
      }
    }
  }
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private graph: AudioGraph | null = null;
  private tracks: TrackVoices | null = null;
  private cloud: CloudInstrument | null = null;
  private tension: TensionInstrument | null = null;
  private cloudPreviewTimer: ReturnType<typeof setInterval> | null = null;
  private cloudPreviewGeneration = 0;
  private tensionPreviewGeneration = 0;
  private cloudConfiguration = { sound: -1, muted: true };
  private tensionConfiguration = { sound: -1, muted: true };
  private vocal: VocalInstrument | null = null;
  private vocalPreview: VocalInstrument | null = null;
  private vocalRequest: AbortController | null = null;
  private vocalPreviewRequest: AbortController | null = null;
  private vocalConfiguration = { sound: -1, muted: true, sourceKey: "" };
  private vocalStatus: VocalSampleStatus = {
    sound: 0,
    phase: "idle",
    message: "",
  };
  private vocalLoadListener: ((status: VocalSampleStatus) => void) | null =
    null;
  private project: Project | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private visualTimers = new Set<ReturnType<typeof setTimeout>>();
  private nextStepTime = 0;
  private absoluteTick = 0;
  private needsFxReset = false;
  private playing = false;
  private generation = 0;
  private silent = false;
  private chordPreview: GainNode | null = null;

  constructor(
    private onStep: (
      step: number,
      absoluteStep: number,
      frame: PlaybackFrame,
    ) => void,
  ) {}

  get isPlaying(): boolean {
    return this.playing;
  }

  get isReady(): boolean {
    return !this.silent && this.context?.state === "running";
  }

  setSilent(silent: boolean): void {
    if (this.silent === silent) return;
    this.silent = silent;
    if (silent) this.stop();
  }

  async unlock(project: Project): Promise<void> {
    await this.prepare(project);
  }

  private async prepare(
    project: Project,
    generation = this.generation,
  ): Promise<AudioGraph> {
    if (this.silent) throw new Error("Audio plays on the session host.");
    if (!this.context)
      this.context = new AudioContext({ latencyHint: "interactive" });
    this.syncGraphMode(project);
    if (!this.graph) this.graph = createGraph(this.context, project);
    if (usesFluffDrums(project)) void loadFluffDrums(this.context);
    if (this.needsFxReset) {
      this.graph.fx.destroy();
      this.graph.fx = new PerformanceFx(
        this.graph.context,
        this.graph.fxInput,
        this.graph.compressor,
        project,
      );
      this.needsFxReset = false;
    }
    if (this.context.state !== "running") await this.context.resume();
    if (this.silent) throw new Error("Audio plays on the session host.");
    if (generation !== this.generation)
      throw new DOMException("Playback cancelled", "AbortError");
    updateGraph(this.graph, project);
    return this.graph;
  }

  /** Grain and Fluff use different buses and effects; rebuild when the mode changes. */
  private syncGraphMode(project: Project): void {
    const graph = this.graph;
    if (!graph || graph.mode === project.mode) return;
    if (this.playing) this.stop();
    graph.fx.destroy();
    graph.fluffLead?.destroy();
    graph.fluff?.destroy();
    graph.master.disconnect();
    graph.analyser.disconnect();
    this.graph = null;
    this.needsFxReset = false;
  }

  /** A Grain project drops its Fluff bus when playback starts without a Fluff sound. */
  private releaseUnusedFluff(graph: AudioGraph, project: Project): void {
    if (graph.mode === "fluff" || !graph.fluff) return;
    if (projectUsesFamily(project, "fluff")) return;
    graph.fluffLead?.destroy();
    graph.fluff.destroy();
    graph.fluffLead = null;
    graph.fluff = null;
  }

  async play(project: Project): Promise<void> {
    if (this.playing) return;
    const generation = ++this.generation;
    this.project = project;
    this.vocalConfiguration = {
      sound: project.vocal.sound,
      sourceKey: vocalSourceKey(project.vocal.sound, project.vocal.recording),
      muted: project.vocal.muted,
    };
    const graph = await this.prepare(project, generation);
    if (graph.mode === "fluff" || usesFluffDrums(project))
      await fluffDrumsReady(graph.context, 1500);
    const loaded = project.vocal.muted
      ? null
      : await this.loadPlayingVocal(graph, project.vocal, generation);
    if (!project.vocal.muted && !loaded) return;
    if (generation !== this.generation) return;
    this.project = project;
    graph.fx.destroy();
    graph.fx = new PerformanceFx(
      graph.context,
      graph.fxInput,
      graph.compressor,
      project,
    );
    this.releaseCloudAudition();
    this.cloud?.destroy();
    this.tension?.destroy();
    this.cloud = new CloudInstrument(
      graph.context,
      graph.fluffMaterial ?? graph.melodicInput,
    );
    this.tension = new TensionInstrument(
      graph.context,
      graph.fluffMaterial ?? graph.melodicInput,
    );
    this.releaseUnusedFluff(graph, project);
    this.tracks = new TrackVoices(graph, project);
    this.vocal = loaded
      ? new VocalInstrument(
          graph.context,
          graph.fluffVocal ?? graph.melodicInput,
          loaded,
        )
      : null;
    this.absoluteTick = 0;
    this.nextStepTime = graph.context.currentTime + 0.035;
    this.playing = true;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 25);
  }

  private schedule(): void {
    const graph = this.graph;
    const project = this.project;
    if (!graph || !project || !this.playing) return;
    const now = graph.context.currentTime;
    // A suspended browser tab must not emit all missed beats at once.
    if (this.nextStepTime < now - LOOKAHEAD) this.nextStepTime = now + 0.01;
    const tracks = this.tracks,
      cloud = this.cloud,
      tension = this.tension;
    if (!tracks || !cloud || !tension) return;
    while (this.nextStepTime < now + LOOKAHEAD) {
      const tick = this.absoluteTick;
      const time = this.nextStepTime;
      scheduleProjectTick(
        graph,
        project,
        { tracks, vocal: this.vocal, cloud, tension },
        tick,
        time,
      );
      if (tick % 2 === 0) {
        const timer = setTimeout(
          () => {
            this.visualTimers.delete(timer);
            if (this.playing && this.project) {
              const frame = playbackFrame(this.project, tick);
              this.onStep(
                Math.floor(tick / 6) % 16,
                Math.floor(tick / 6),
                frame,
              );
            }
          },
          Math.max(0, (time - now) * 1000),
        );
        this.visualTimers.add(timer);
      }
      this.absoluteTick++;
      this.nextStepTime += tickSeconds(1, project.bpm);
    }
  }

  stop(): void {
    this.generation += 1;
    this.tensionPreviewGeneration++;
    this.releaseCloudAudition();
    for (const voice of [this.cloud, this.tension])
      if (voice) {
        voice.stop();
        setTimeout(() => voice.destroy(), 30);
      }
    this.cloud = null;
    this.tension = null;
    this.vocalRequest?.abort();
    this.vocalRequest = null;
    this.vocalPreviewRequest?.abort();
    this.vocalPreviewRequest = null;
    this.vocal?.stop();
    this.vocal = null;
    this.vocalPreview?.stop();
    this.vocalPreview = null;
    this.reportVocal({
      sound: this.vocalConfiguration.sound,
      sourceKey: this.vocalConfiguration.sourceKey,
      phase: "idle",
      message: "",
    });
    this.playing = false;
    this.needsFxReset = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const timer of this.visualTimers) clearTimeout(timer);
    this.visualTimers.clear();
    const graph = this.graph;
    if (graph) {
      const time = graph.context.currentTime;
      graph.master.gain.cancelAndHoldAtTime(time);
      graph.master.gain.linearRampToValueAtTime(0, time + 0.012);
      this.tracks?.stop(time);
      for (const source of graph.sources) source.stop(time + 0.015);
    }
    this.tracks = null;
    if (this.project)
      this.onStep(-1, -1, playbackFrame(this.project, 0, false));
  }

  update(project: Project): void {
    if (
      (project.cloud.muted && !this.cloudConfiguration.muted) ||
      project.cloud.sound !== this.cloudConfiguration.sound
    ) {
      this.releaseCloudAudition();
      this.cloud?.silence();
    }
    if (
      (project.tension.muted && !this.tensionConfiguration.muted) ||
      project.tension.sound !== this.tensionConfiguration.sound
    ) {
      this.tensionPreviewGeneration++;
      this.tension?.silence();
    }
    this.cloudConfiguration = {
      sound: project.cloud.sound,
      muted: project.cloud.muted,
    };
    this.tensionConfiguration = {
      sound: project.tension.sound,
      muted: project.tension.muted,
    };
    const changed =
      vocalSourceKey(project.vocal.sound, project.vocal.recording) !==
        this.vocalConfiguration.sourceKey ||
      project.vocal.muted !== this.vocalConfiguration.muted;
    this.project = project;
    this.syncGraphMode(project);
    if (this.graph && usesFluffDrums(project))
      void loadFluffDrums(this.graph.context);
    this.vocalConfiguration = {
      sound: project.vocal.sound,
      sourceKey: vocalSourceKey(project.vocal.sound, project.vocal.recording),
      muted: project.vocal.muted,
    };
    if (changed) {
      const pendingPlay = this.vocalRequest !== null && !this.playing;
      this.vocalRequest?.abort();
      this.vocalRequest = null;
      this.vocalPreviewRequest?.abort();
      this.vocalPreviewRequest = null;
      this.vocal?.stop();
      this.vocal = null;
      this.vocalPreview?.stop();
      this.vocalPreview = null;
      if (pendingPlay) this.stop();
      else
        this.reportVocal({
          sound: project.vocal.sound,
          sourceKey: vocalSourceKey(
            project.vocal.sound,
            project.vocal.recording,
          ),
          phase: "idle",
          message: "",
        });
      const graph = this.graph;
      if (graph && this.playing && !this.silent && !project.vocal.muted) {
        const generation = this.generation;
        void this.loadPlayingVocal(graph, project.vocal, generation)
          .then((loaded) => {
            if (
              loaded &&
              this.playing &&
              !this.silent &&
              generation === this.generation
            )
              this.vocal = new VocalInstrument(
                graph.context,
                graph.fluffVocal ?? graph.melodicInput,
                loaded,
              );
          })
          .catch(() => undefined);
      }
    }
    if (this.graph) updateGraph(this.graph, project, !this.needsFxReset);
  }

  setVocalLoadListener(listener: (status: VocalSampleStatus) => void): void {
    this.vocalLoadListener = listener;
    listener({ ...this.vocalStatus });
  }
  private reportVocal(status: VocalSampleStatus): void {
    this.vocalStatus = status;
    this.vocalLoadListener?.({ ...status });
  }
  private async loadPlayingVocal(
    graph: AudioGraph,
    track: VocalTrack,
    generation: number,
  ): Promise<LoadedVocalSample | null> {
    this.vocalRequest?.abort();
    const request = new AbortController(),
      sound = track.sound,
      sourceKey = vocalSourceKey(track.sound, track.recording);
    this.vocalRequest = request;
    this.reportVocal({
      sound,
      sourceKey,
      phase: "loading",
      message: "Loading vocal…",
    });
    try {
      const loaded = await loadVocalSample(
        graph.context,
        sound,
        request.signal,
        track.recording,
      );
      if (
        request.signal.aborted ||
        generation !== this.generation ||
        this.silent ||
        !this.project ||
        vocalSourceKey(
          this.project.vocal.sound,
          this.project.vocal.recording,
        ) !== sourceKey ||
        this.project.vocal.muted
      )
        return null;
      this.reportVocal({ sound, sourceKey, phase: "ready", message: "" });
      return loaded;
    } catch (error) {
      if (
        request.signal.aborted ||
        generation !== this.generation ||
        this.silent
      )
        return null;
      this.reportVocal({
        sound,
        sourceKey,
        phase: "error",
        message:
          error instanceof Error
            ? error.message
            : "Vocal loading failed. Try again.",
      });
      throw error;
    } finally {
      if (this.vocalRequest === request) this.vocalRequest = null;
    }
  }
  async auditionVocal(
    track: VocalTrack,
    note = 60,
    accent = false,
  ): Promise<void> {
    if (!this.project)
      throw new Error("Set the project before previewing vocals.");
    if (!Number.isInteger(note) || note < 36 || note > 84)
      throw new Error("Choose a vocal note between C2 and C6.");
    if (this.silent) throw new Error("Audio plays on the session host.");
    this.vocalPreviewRequest?.abort();
    this.vocalPreview?.stop();
    this.vocalPreview = null;
    const request = new AbortController(),
      generation = this.generation,
      sound = track.sound,
      sourceKey = vocalSourceKey(track.sound, track.recording);
    const snapshot = structuredClone(track);
    this.vocalPreviewRequest = request;
    this.reportVocal({
      sound,
      sourceKey,
      phase: "loading",
      message: "Loading vocal…",
    });
    try {
      const graph = await this.prepare(this.project, generation);
      const loaded = await loadVocalSample(
        graph.context,
        sound,
        request.signal,
        track.recording,
      );
      if (
        request.signal.aborted ||
        generation !== this.generation ||
        this.silent ||
        vocalSourceKey(
          this.project.vocal.sound,
          this.project.vocal.recording,
        ) !== sourceKey
      )
        return;
      const preview = new VocalInstrument(
        graph.context,
        graph.fluffVocal ?? graph.melodicInput,
        loaded,
      );
      this.vocalPreview = preview;
      const trim = resolveVocalTrim(snapshot, loaded.buffer.duration);
      const duration = snapshot.loop
        ? 0.65
        : Math.min(
            2.5,
            Math.max(
              0.12,
              (trim.end - trim.start) /
                2 ** ((note - loaded.sample.rootNote) / 12),
            ),
          );
      preview.audition(
        snapshot,
        note,
        accent,
        graph.context.currentTime + 0.005,
        duration,
        this.project.bpm,
      );
      this.reportVocal({ sound, sourceKey, phase: "ready", message: "" });
    } catch (error) {
      if (
        request.signal.aborted ||
        generation !== this.generation ||
        this.silent
      )
        return;
      this.reportVocal({
        sound,
        sourceKey,
        phase: "error",
        message:
          error instanceof Error
            ? error.message
            : "Vocal preview failed. Try again.",
      });
      throw error;
    } finally {
      if (this.vocalPreviewRequest === request) this.vocalPreviewRequest = null;
    }
  }

  async auditionCloud(
    track: CloudTrack,
    note: number,
    velocity: number,
    sustain = false,
  ): Promise<void> {
    if (!this.project)
      throw new Error("Set the project before auditioning Cloud.");
    if (!Number.isFinite(note) || !Number.isFinite(velocity)) return;
    const request = ++this.cloudPreviewGeneration;
    const graph = await this.prepare(this.project);
    if (request !== this.cloudPreviewGeneration || this.silent) return;
    if (!this.cloud)
      this.cloud = new CloudInstrument(
        graph.context,
        graph.fluffMaterial ?? graph.melodicInput,
      );
    this.cloud.audition(
      track,
      snapNote(note, this.project.scale, 36, 84),
      Math.max(0, Math.min(1, velocity)),
      graph.context.currentTime + 0.005,
      sustain,
    );
    if (this.cloudPreviewTimer === null)
      this.cloudPreviewTimer = setInterval(() => {
        const voice = this.cloud;
        if (!voice?.isPreviewing) {
          if (this.cloudPreviewTimer !== null)
            clearInterval(this.cloudPreviewTimer);
          this.cloudPreviewTimer = null;
          return;
        }
        voice.schedulePreview(graph.context.currentTime + LOOKAHEAD);
      }, 25);
  }
  releaseCloudAudition(): void {
    this.cloudPreviewGeneration++;
    if (this.cloudPreviewTimer !== null) clearInterval(this.cloudPreviewTimer);
    this.cloudPreviewTimer = null;
    this.cloud?.releasePreview();
  }
  async auditionTension(
    track: TensionTrack,
    note: number,
    velocity: number,
  ): Promise<void> {
    if (!this.project)
      throw new Error("Set the project before auditioning Tension.");
    if (!Number.isFinite(note) || !Number.isFinite(velocity)) return;
    const request = this.tensionPreviewGeneration;
    const graph = await this.prepare(this.project);
    if (request !== this.tensionPreviewGeneration || this.silent) return;
    if (!this.tension)
      this.tension = new TensionInstrument(
        graph.context,
        graph.fluffMaterial ?? graph.melodicInput,
      );
    this.tension.audition(
      track,
      note,
      Math.max(0, Math.min(1, velocity)),
      graph.context.currentTime + 0.005,
      this.project.scale,
    );
  }

  async audition(track: DrumTrack): Promise<void> {
    if (!this.project)
      throw new Error("Set the project before auditioning a drum.");
    const graph = await this.prepare(this.project);
    drumVoice(
      graph,
      track,
      graph.context.currentTime + 0.005,
      trackFamily(this.project.mode, track),
    );
  }

  async auditionBass(
    track: BassTrack,
    note: number,
    accent = false,
  ): Promise<void> {
    if (!this.project)
      throw new Error("Set the project before auditioning bass.");
    if (!Number.isInteger(note) || note < 24 || note > 60)
      throw new Error("Choose a bass note between C1 and C4.");
    const graph = await this.prepare(this.project);
    const voice = new BassVoice(graph, trackFamily(this.project.mode, track));
    const preview: BassTrack = {
      ...track,
      muted: false,
      steps: track.steps.map((step, index) => ({
        ...step,
        note,
        on: index === 0,
        accent,
        slide: false,
      })),
    };
    const time = graph.context.currentTime + 0.005;
    const duration = Math.max(0.14, Math.min(0.4, track.decay + 0.06));
    voice.schedule(preview, 0, time, duration);
    voice.stop(time + duration);
  }

  async auditionKeys(
    track: KeysTrack,
    note: number,
    accent = false,
  ): Promise<void> {
    if (!this.project)
      throw new Error("Set the project before auditioning keys.");
    if (!Number.isInteger(note) || note < 48 || note > 84)
      throw new Error("Choose a keys note between C3 and C6.");
    const graph = await this.prepare(this.project);
    if (track.volume === 0) return;
    const time = graph.context.currentTime + 0.005;
    if (trackFamily(this.project.mode, track) === "fluff") {
      const lead = fluffLead(graph);
      lead.preview(track, graph.context.currentTime);
      lead.play(
        track,
        note,
        accent,
        time,
        Math.min(0.4, track.decay + 0.1),
        this.project.scale,
      );
      return;
    }
    graph.cleanInput.gain.cancelAndHoldAtTime(graph.context.currentTime);
    graph.cleanInput.gain.setValueAtTime(
      track.volume * 0.72,
      graph.context.currentTime,
    );
    const voice = new KeysVoice(graph, track, time);
    voice.schedule(track, note, accent, time, track.decay, false, false);
  }

  /**
   * Plays chords on a dedicated soft voice into the master bus: one chord for
   * about a second, or a sequence two beats apart (0.55–1 s). It is quieter
   * while the transport runs, never touches the playing parts, the project or
   * WAV export, and replaces any preview still sounding.
   */
  async previewChords(chords: readonly PreviewChord[]): Promise<void> {
    if (!this.project)
      throw new Error("Set the project before previewing chords.");
    if (!chords.length) return;
    const project = this.project;
    const graph = await this.prepare(project);
    const context = graph.context;
    const time = context.currentTime + 0.01;
    this.releaseChordPreview(time);
    const output = context.createGain();
    output.gain.value = this.playing ? 0.5 : 1;
    output.connect(graph.master);
    this.chordPreview = output;
    const single = chords.length === 1;
    const spacing = single ? 0 : Math.min(1, Math.max(0.55, 120 / project.bpm));
    let end = time;
    chords.forEach((chord, index) => {
      const last = index === chords.length - 1;
      end = scheduleChordPreview(
        context,
        output,
        chord,
        project.mode,
        time + index * spacing,
        single ? 0.8 : last ? spacing : spacing - 0.04,
        last ? 0.5 : 0.25,
      );
    });
    setTimeout(
      () => {
        if (this.chordPreview === output) this.chordPreview = null;
        output.disconnect();
      },
      (end - context.currentTime) * 1000 + 100,
    );
  }

  private releaseChordPreview(time: number): void {
    const previous = this.chordPreview;
    if (!previous) return;
    previous.gain.cancelAndHoldAtTime(time);
    previous.gain.linearRampToValueAtTime(0, time + 0.04);
    this.chordPreview = null;
    setTimeout(() => previous.disconnect(), 120);
  }

  getAnalyser(): AnalyserNode | null {
    return this.graph?.analyser ?? null;
  }

  async exportWav(project: Project): Promise<Blob> {
    if (this.silent) throw new Error("Export audio from the session host.");
    project = structuredClone(project);
    const plan = exportPlan(project);
    const loopDuration = plan.seconds;
    const tailDuration = exportTailDuration(project);
    const context = new OfflineAudioContext(
      2,
      Math.ceil((loopDuration + tailDuration) * WAV_SAMPLE_RATE),
      WAV_SAMPLE_RATE,
    );
    const loaded = project.vocal.muted
      ? null
      : await loadVocalSample(
          context,
          project.vocal.sound,
          undefined,
          project.vocal.recording,
        );
    if (this.silent) throw new Error("Export audio from the session host.");
    const graph = createGraph(context, project);
    if (graph.mode === "fluff" || usesFluffDrums(project))
      await loadFluffDrums(context);
    const vocal = loaded
      ? new VocalInstrument(
          context,
          graph.fluffVocal ?? graph.melodicInput,
          loaded,
        )
      : null;
    const tracks = new TrackVoices(graph, project);
    const cloud = new CloudInstrument(
      context,
      graph.fluffMaterial ?? graph.melodicInput,
    );
    const tension = new TensionInstrument(
      context,
      graph.fluffMaterial ?? graph.melodicInput,
    );
    for (let tick = 0; tick < plan.ticks; tick++)
      scheduleProjectTick(
        graph,
        project,
        { tracks, vocal, cloud, tension },
        tick,
        tickSeconds(tick, project.bpm),
      );
    vocal?.finish(
      project.vocal,
      Math.max(
        0,
        Math.ceil(plan.ticks / ticksPerStep(project.vocal.timing)) - 1,
      ),
      loopDuration,
    );
    tracks
      .bass(trackFamily(project.mode, project.bass), loopDuration)
      .stop(loopDuration);
    const keys = tracks.keys(
      trackFamily(project.mode, project.keys),
      loopDuration,
    );
    // Fluff lead notes are scheduled with their full length and release.
    if (!(keys instanceof FluffLead))
      keys.release(
        loopDuration,
        automatedKeys(
          project.keys,
          Math.ceil(plan.ticks / ticksPerStep(project.keys.timing)) - 1,
        ).decay,
      );
    if (
      plan.ticks %
        (trackCycleTicks(
          project.pad.followChords
            ? project.progression.timing
            : project.pad.timing,
        ) /
          4) !==
      0
    )
      tracks
        .pad(trackFamily(project.mode, project.pad), loopDuration)
        .finish(
          project.pad,
          plan.ticks / ticksPerStep(project.pad.timing),
          loopDuration,
        );
    const rendered = await context.startRendering();
    const channels: Float32Array[] = [];
    for (let index = 0; index < rendered.numberOfChannels; index += 1)
      channels.push(rendered.getChannelData(index));
    return encodeWav(channels, rendered.sampleRate);
  }
}
