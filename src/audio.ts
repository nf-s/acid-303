import { STEP_COUNT, scaleNotes, stepDuration } from "./model";
import type {
  BassTrack,
  DrumTrack,
  KeysTrack,
  MusicalScale,
  Project,
} from "./model";

type ScheduledSource = OscillatorNode | AudioBufferSourceNode;

interface AudioGraph {
  context: BaseAudioContext;
  input: GainNode;
  cleanInput: GainNode;
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
  const next = steps[(step + 1) % STEP_COUNT];
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

function createGraph(context: BaseAudioContext, project: Project): AudioGraph {
  const input = context.createGain();
  const cleanInput = context.createGain();
  const dry = context.createGain();
  const wet = context.createGain();
  const distortion = context.createWaveShaper();
  const highpass = context.createBiquadFilter();
  const compressor = context.createDynamicsCompressor();
  const master = context.createGain();
  const safety = context.createWaveShaper();
  const analyser = context.createAnalyser();
  input.gain.value = 0.6;
  cleanInput.gain.value = 0.72;
  dry.gain.value = 1 - project.drive * 0.45;
  wet.gain.value = project.drive * 0.45;
  distortion.curve = distortionCurve(project.drive);
  // Keep the parallel paths sample-aligned; oversampling delays only the wet path.
  distortion.oversample = "none";
  highpass.type = "highpass";
  highpass.frequency.value = 22;
  highpass.Q.value = 0.7;
  compressor.threshold.value = -7;
  compressor.knee.value = 5;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.008;
  compressor.release.value = 0.11;
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
  cleanInput.connect(highpass);
  highpass.connect(compressor);
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
    context,
    input,
    cleanInput,
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

function updateGraph(graph: AudioGraph, project: Project): void {
  const now = graph.context.currentTime;
  graph.master.gain.cancelAndHoldAtTime(now);
  graph.master.gain.setTargetAtTime(project.volume * 0.8, now, 0.015);
  graph.bpm = project.bpm;
  graph.scale = project.scale;
  if (graph.drive !== project.drive) {
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
): void {
  let remaining = sources.length;
  for (const source of sources) {
    graph.sources.add(source);
    source.onended = () => {
      graph.sources.delete(source);
      source.disconnect();
      remaining -= 1;
      if (remaining === 0) for (const node of nodes) node.disconnect();
    };
    if ("buffer" in source) source.start(start, bufferOffset);
    else source.start(start);
    source.stop(end);
  }
}

function drumVoice(graph: AudioGraph, track: DrumTrack, time: number): void {
  if (track.volume === 0) return;
  const context = graph.context;
  const pitch = 2 ** (track.pitch / 12);
  const decay = track.decay;
  const output = context.createGain();
  // A fractional-time start can precede its first automation sample.
  output.gain.value = 0;
  const nodes: AudioNode[] = [output];
  const sources: ScheduledSource[] = [];
  output.connect(graph.input);
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

  if (track.id === "kick") {
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
    click.connect(graph.input);
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
    if (track.sound === 3) {
      const filter = noise("bandpass", 7500, output);
      filter.Q.value = 0.6;
      envelope(output.gain, 0.25, 0.008);
      envelope(output.gain, 0.19, 0.009, 0.011);
      envelope(output.gain, 0.15, 0.009, 0.023);
      envelope(output.gain, 0.12, decay * 0.8, 0.035);
      end = time + 0.035 + decay * 0.8 + 0.06;
    } else {
      const highpass = context.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = Math.min(
        16000,
        (track.sound === 4 ? 3600 : track.sound === 2 ? 4100 : 6500) * pitch,
      );
      highpass.Q.value = 0.7;
      highpass.connect(output);
      nodes.push(highpass);
      const metalRatios =
        track.sound === 4
          ? [1, 1.405, 1.99, 2.86, 3.95, 5.88]
          : [1, 1.8, 2.546, 3.897, 5.1, 6.819];
      for (const ratio of metalRatios) {
        oscillator(
          "square",
          midiFrequency(48 + graph.scale.root) * ratio,
          highpass,
        );
      }
      const length =
        track.sound === 4
          ? Math.min(3, decay * 6)
          : Math.min(2.5, decay * (track.sound === 1 ? 3.2 : 1));
      if (track.sound === 4) noise("highpass", 6200, highpass);
      envelope(
        output.gain,
        track.sound === 4 ? 0.045 : track.sound === 2 ? 0.11 : 0.075,
        length,
      );
      end = time + length + 0.05;
    }
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
      wet.connect(graph.input);
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
  scheduleSources(graph, sources, nodes, time, end);
}

class BassVoice {
  private oscillator: OscillatorNode;
  private filters: BiquadFilterNode[];
  private gain: GainNode;
  private sliding = false;

  constructor(private graph: AudioGraph) {
    const context = graph.context;
    this.oscillator = context.createOscillator();
    this.oscillator.type = "sawtooth";
    this.filters = [context.createBiquadFilter(), context.createBiquadFilter()];
    this.gain = context.createGain();
    this.gain.gain.value = 0;
    let previous: AudioNode = this.oscillator;
    for (const filter of this.filters) {
      filter.type = "lowpass";
      filter.frequency.value = 500;
      previous.connect(filter);
      previous = filter;
    }
    previous.connect(this.gain);
    this.gain.connect(graph.input);
    graph.sources.add(this.oscillator);
    this.oscillator.onended = () => {
      graph.sources.delete(this.oscillator);
      this.oscillator.disconnect();
      this.gain.disconnect();
      for (const filter of this.filters) filter.disconnect();
    };
    this.oscillator.start();
  }

  schedule(
    track: BassTrack,
    stepIndex: number,
    time: number,
    duration: number,
  ): void {
    const step = track.steps[stepIndex];
    const envelope = this.gain.gain;
    envelope.cancelAndHoldAtTime(time);
    if (!step?.on || track.muted || track.volume === 0) {
      envelope.linearRampToValueAtTime(0, time + 0.008);
      this.sliding = false;
      return;
    }
    const incomingSlide = this.sliding;
    const outgoingSlide = tiesNextStep(track.steps, stepIndex);
    const frequency = midiFrequency(step.note);
    this.oscillator.type = track.waveform;
    this.oscillator.frequency.cancelAndHoldAtTime(time);
    if (incomingSlide)
      this.oscillator.frequency.exponentialRampToValueAtTime(
        frequency,
        time + Math.min(0.07, duration * 0.6),
      );
    else this.oscillator.frequency.setValueAtTime(frequency, time);

    const amplitude = Math.max(
      MIN_GAIN,
      (track.volume * (step.accent ? 0.46 : 0.34)) /
        (1 + track.resonance * 0.012),
    );
    if (!incomingSlide) {
      envelope.setValueAtTime(MIN_GAIN, time);
      envelope.linearRampToValueAtTime(amplitude, time + 0.004);
    } else if (step.accent)
      envelope.linearRampToValueAtTime(amplitude, time + 0.02);
    if (outgoingSlide)
      envelope.exponentialRampToValueAtTime(
        Math.max(MIN_GAIN, amplitude * 0.74),
        time + duration,
      );
    else {
      envelope.exponentialRampToValueAtTime(
        Math.max(MIN_GAIN, amplitude * 0.4),
        time + duration * 0.66,
      );
      envelope.exponentialRampToValueAtTime(MIN_GAIN, time + duration * 0.88);
      envelope.linearRampToValueAtTime(0, time + duration * 0.94);
    }

    this.filters.forEach((filter, index) => {
      const base = Math.min(17000, track.cutoff * (index === 0 ? 1 : 1.12));
      const peak = Math.min(
        16000,
        base * (1 + track.envelope * 5) +
          track.envelope * (step.accent ? 2200 : 1400),
      );
      filter.Q.setValueAtTime(
        index === 0 ? 0.7 + track.resonance * 0.28 : 0.7,
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
      filter.frequency.exponentialRampToValueAtTime(base, time + track.decay);
    });
    this.sliding = outgoingSlide;
  }

  stop(time = this.graph.context.currentTime): void {
    this.gain.gain.cancelAndHoldAtTime(time);
    this.gain.gain.linearRampToValueAtTime(0, time + 0.008);
    this.oscillator.stop(time + 0.012);
  }
}

function keysEchoTail(track: KeysTrack, bpm: number): number {
  return track.space > 0
    ? Math.max(
        (60 / bpm) * (track.sound === 4 ? 2.25 : 1.5),
        track.sound === 1 || track.sound === 5 ? 0.9 : 0,
      )
    : 0;
}

export function exportTailDuration(project: Project): number {
  const drumTail = project.drums.reduce((longest, track) => {
    if (track.muted || track.volume === 0) return longest;
    let decay = track.decay;
    if (track.id === "kick" && track.sound === 3)
      decay = Math.min(2, track.decay * 1.35);
    if (track.id === "snare" && track.sound === 4)
      decay = Math.min(2, track.decay * 1.3);
    if (track.id === "hat" && track.sound === 1)
      decay = Math.min(2.5, track.decay * 3.2);
    if (track.id === "hat" && track.sound === 4)
      decay = Math.min(3, track.decay * 6);
    if (track.id === "clap" && track.sound === 3)
      decay = track.decay * 1.2 + 0.945;
    return Math.max(longest, decay + 0.12);
  }, 0);
  const keysTail =
    project.keys.muted || project.keys.volume === 0
      ? 0
      : project.keys.decay + keysEchoTail(project.keys, project.bpm) + 0.08;
  return Math.max(0.35, drumTail, keysTail);
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
  private readonly filter: BiquadFilterNode;
  private readonly envelope: GainNode;
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
    this.filter = context.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = 0.55;
    this.envelope = context.createGain();
    this.envelope.gain.value = 0;
    this.filter.connect(this.envelope);
    this.envelope.connect(graph.cleanInput);
    const nodes = this.nodes;
    nodes.push(this.filter, this.envelope);
    const sources: ScheduledSource[] = [];
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
    sources.push(this.noise);
    nodes.push(this.noiseFilter, this.noiseGain, this.noiseColor);
    for (const tone of keysTones(track.sound)) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = tone.type;
      oscillator.detune.value = tone.detune;
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
      const delay = context.createDelay(3);
      const damping = context.createBiquadFilter();
      const gain = context.createGain();
      const pan = context.createStereoPanner();
      damping.type = "lowpass";
      damping.Q.value = 0.5;
      gain.gain.value = 0;
      pan.pan.value = index % 2 === 0 ? -0.5 : 0.5;
      this.envelope.connect(delay);
      delay.connect(damping);
      damping.connect(gain);
      gain.connect(pan);
      pan.connect(graph.cleanInput);
      nodes.push(delay, damping, gain, pan);
      this.echoes.push({ delay, damping, gain });
    }
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
    const chordRoot = track.sound === 4 ? note - 12 : note;
    const chord = scaleNotes(this.graph.scale, chordRoot, chordRoot + 24);
    if (track.sound !== this.sound) {
      this.noiseColor.curve = textureNoiseCurve(track.sound);
      this.sound = track.sound;
    }
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
      else tone.oscillator.frequency.setValueAtTime(targetFrequency, time);
    });
    const attack =
      Math.min(track.decay * 0.2, shape.attack) * (accent ? 0.7 : 1);
    const amplitude = Math.max(
      MIN_GAIN,
      track.volume * shape.amplitude * (accent ? 1.28 : 1),
    );
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
    const noiseLevel = shape.noiseLevel;
    this.noiseGain.gain.cancelAndHoldAtTime(time);
    if (!incomingSlide || accent) {
      this.noiseGain.gain.setValueAtTime(noiseLevel, time);
      if (track.sound !== 1 && track.sound !== 3 && track.sound !== 5)
        this.noiseGain.gain.exponentialRampToValueAtTime(
          shape.noiseTail,
          time + Math.min(0.035, track.decay * 0.4),
        );
    } else if (track.sound === 1 || track.sound === 5)
      this.noiseGain.gain.setTargetAtTime(noiseLevel, time, 0.02);
    if (track.sound === 3) {
      const length = outgoingSlide ? duration : track.decay;
      const grains = Math.min(12, Math.max(3, Math.round(length / 0.025)));
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
    if (shape.roomLevel > 0 && track.space > 0 && !this.roomGain) {
      const room = this.graph.context.createConvolver();
      room.buffer = textureRoom(this.graph);
      const gain = this.graph.context.createGain();
      gain.gain.value = 0;
      this.envelope.connect(room);
      room.connect(gain);
      gain.connect(this.graph.cleanInput);
      this.nodes.push(room, gain);
      this.roomGain = gain;
    }
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
  }
}

class KeysSequencer {
  private tiedVoice: KeysVoice | null = null;
  constructor(private readonly graph: AudioGraph) {}

  schedule(
    track: KeysTrack,
    stepIndex: number,
    time: number,
    duration: number,
  ): void {
    const step = track.steps[stepIndex];
    if (!step?.on || track.muted || track.volume === 0) {
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

export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const frames = channels[0]?.length ?? 0;
  const channelCount = channels.length;
  if (channelCount < 1 || channels.some((channel) => channel.length !== frames))
    throw new Error("Audio channels must have matching lengths.");
  const dataSize = frames * channelCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1)
      view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (const channel of channels) {
      const raw = channel[frame] ?? 0;
      const value = Number.isFinite(raw) ? Math.min(1, Math.max(-1, raw)) : 0;
      view.setInt16(
        offset,
        Math.round(value * (value < 0 ? 32768 : 32767)),
        true,
      );
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private graph: AudioGraph | null = null;
  private bass: BassVoice | null = null;
  private keys: KeysSequencer | null = null;
  private project: Project | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private visualTimers = new Set<ReturnType<typeof setTimeout>>();
  private nextStepTime = 0;
  private step = 0;
  private playing = false;
  private generation = 0;

  constructor(private onStep: (step: number) => void) {}

  get isPlaying(): boolean {
    return this.playing;
  }

  private async prepare(project: Project): Promise<AudioGraph> {
    if (!this.context)
      this.context = new AudioContext({ latencyHint: "interactive" });
    if (!this.graph) this.graph = createGraph(this.context, project);
    if (this.context.state !== "running") await this.context.resume();
    updateGraph(this.graph, project);
    return this.graph;
  }

  async play(project: Project): Promise<void> {
    if (this.playing) return;
    const generation = ++this.generation;
    const graph = await this.prepare(project);
    if (generation !== this.generation) return;
    this.project = project;
    this.bass = new BassVoice(graph);
    this.keys = new KeysSequencer(graph);
    this.step = 0;
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
    while (this.nextStepTime < now + LOOKAHEAD) {
      const step = this.step;
      const time = this.nextStepTime;
      const duration = stepDuration(project.bpm, project.swing, step);
      for (const drum of project.drums) {
        if (!drum.muted && drum.steps[step]) drumVoice(graph, drum, time);
      }
      this.bass?.schedule(project.bass, step, time, duration);
      this.keys?.schedule(project.keys, step, time, duration);
      const timer = setTimeout(
        () => {
          this.visualTimers.delete(timer);
          if (this.playing) this.onStep(step);
        },
        Math.max(0, (time - now) * 1000),
      );
      this.visualTimers.add(timer);
      this.step = (step + 1) % STEP_COUNT;
      this.nextStepTime += duration;
    }
  }

  stop(): void {
    this.generation += 1;
    this.playing = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const timer of this.visualTimers) clearTimeout(timer);
    this.visualTimers.clear();
    const graph = this.graph;
    if (graph) {
      const time = graph.context.currentTime;
      graph.master.gain.cancelAndHoldAtTime(time);
      graph.master.gain.linearRampToValueAtTime(0, time + 0.012);
      this.bass?.stop(time);
      for (const source of graph.sources) source.stop(time + 0.015);
    }
    this.bass = null;
    this.keys = null;
    this.onStep(-1);
  }

  update(project: Project): void {
    this.project = project;
    if (this.graph) updateGraph(this.graph, project);
  }

  async audition(track: DrumTrack): Promise<void> {
    if (!this.project)
      throw new Error("Set the project before auditioning a drum.");
    const graph = await this.prepare(this.project);
    drumVoice(graph, track, graph.context.currentTime + 0.005);
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
    const voice = new BassVoice(graph);
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
    const voice = new KeysVoice(graph, track, time);
    voice.schedule(track, note, accent, time, track.decay, false, false);
  }

  getAnalyser(): AnalyserNode | null {
    return this.graph?.analyser ?? null;
  }

  async exportWav(project: Project): Promise<Blob> {
    const loopDuration = (60 / project.bpm) * 8;
    const tailDuration = exportTailDuration(project);
    const context = new OfflineAudioContext(
      2,
      Math.ceil((loopDuration + tailDuration) * WAV_SAMPLE_RATE),
      WAV_SAMPLE_RATE,
    );
    const graph = createGraph(context, project);
    const bass = new BassVoice(graph);
    const keys = new KeysSequencer(graph);
    let time = 0;
    for (let index = 0; index < STEP_COUNT * 2; index += 1) {
      const step = index % STEP_COUNT;
      const duration = stepDuration(project.bpm, project.swing, step);
      for (const drum of project.drums) {
        if (!drum.muted && drum.steps[step]) drumVoice(graph, drum, time);
      }
      bass.schedule(project.bass, step, time, duration);
      keys.schedule(project.keys, step, time, duration);
      time += duration;
    }
    bass.stop(loopDuration);
    keys.release(loopDuration, project.keys.decay);
    const rendered = await context.startRendering();
    const channels: Float32Array[] = [];
    for (let index = 0; index < rendered.numberOfChannels; index += 1)
      channels.push(rendered.getChannelData(index));
    return encodeWav(channels, rendered.sampleRate);
  }
}
