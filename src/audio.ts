import { STEP_COUNT, stepDuration } from "./model";
import type { BassTrack, DrumTrack, KeysTrack, Project } from "./model";

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
  sources: Set<ScheduledSource>;
  drive: number;
  bpm: number;
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
    sources: new Set(),
    drive: project.drive,
    bpm: project.bpm,
  };
}

function updateGraph(graph: AudioGraph, project: Project): void {
  const now = graph.context.currentTime;
  graph.master.gain.cancelAndHoldAtTime(now);
  graph.master.gain.setTargetAtTime(project.volume * 0.8, now, 0.015);
  graph.bpm = project.bpm;
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
    source.start(start);
    source.stop(end);
  }
}

function drumVoice(graph: AudioGraph, track: DrumTrack, time: number): void {
  if (track.volume === 0) return;
  const context = graph.context;
  const pitch = 2 ** (track.pitch / 12);
  const decay = track.decay;
  const output = context.createGain();
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
    const frequencies = [55, 62, 51];
    const fundamental = frequencies[track.sound] ?? 55;
    const source = oscillator(
      track.sound === 2 ? "triangle" : "sine",
      fundamental * (track.sound === 1 ? 2.8 : 2.2),
      output,
    );
    source.frequency.exponentialRampToValueAtTime(
      fundamental * pitch,
      time + 0.022,
    );
    envelope(output.gain, 0.95, decay);
    const click = context.createGain();
    click.connect(graph.input);
    nodes.push(click);
    noise("highpass", track.sound === 1 ? 2800 : 1400, click);
    envelope(click.gain, track.sound === 1 ? 0.1 : 0.035, 0.009);
  } else if (track.id === "snare") {
    const body = context.createGain();
    const snap = context.createGain();
    body.connect(output);
    snap.connect(output);
    nodes.push(body, snap);
    output.gain.value = 1;
    oscillator(
      track.sound === 2 ? "triangle" : "sine",
      track.sound === 1 ? 210 : 175,
      body,
    );
    oscillator("sine", track.sound === 2 ? 310 : 330, body);
    envelope(body.gain, 0.24, decay * 0.58);
    const filter = noise("highpass", track.sound === 0 ? 900 : 1800, snap);
    filter.Q.value = track.sound === 2 ? 3 : 0.7;
    envelope(snap.gain, 0.47, decay);
  } else if (track.id === "hat") {
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = Math.min(
      16000,
      (track.sound === 2 ? 4100 : 6500) * pitch,
    );
    highpass.Q.value = 0.7;
    highpass.connect(output);
    nodes.push(highpass);
    for (const frequency of [205.3, 369.6, 522.7, 800, 1047, 1400]) {
      oscillator("square", frequency, highpass);
    }
    const length = Math.min(2.5, decay * (track.sound === 1 ? 3.2 : 1));
    envelope(output.gain, track.sound === 2 ? 0.11 : 0.075, length);
    end = time + length + 0.05;
  } else if (track.id === "clap") {
    output.gain.value = 0;
    const filter = noise("bandpass", track.sound === 2 ? 1300 : 1800, output);
    filter.Q.value = track.sound === 1 ? 0.65 : 1.1;
    const spread = track.sound === 1 ? 0.017 : 0.011;
    for (let pulse = 0; pulse < 3; pulse += 1)
      envelope(output.gain, 0.62, 0.009, pulse * spread);
    envelope(output.gain, 0.46, decay, 3 * spread);
    end = time + 3 * spread + decay + 0.05;
  } else if (track.id === "rim") {
    const body = context.createGain();
    const snap = context.createGain();
    body.connect(output);
    snap.connect(output);
    nodes.push(body, snap);
    output.gain.value = 1;
    oscillator("sine", track.sound === 1 ? 610 : 430, body);
    oscillator(
      "sine",
      track.sound === 2 ? 2400 : track.sound === 1 ? 1680 : 1480,
      body,
    );
    const length = Math.max(0.018, decay * (track.sound === 1 ? 0.65 : 0.4));
    envelope(body.gain, track.sound === 2 ? 0.1 : 0.22, length);
    noise("highpass", track.sound === 2 ? 3800 : 2200, snap);
    envelope(
      snap.gain,
      track.sound === 2 ? 0.26 : 0.11,
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
  return track.space > 0 ? (60 / bpm) * 1.5 : 0;
}

export function exportTailDuration(project: Project): number {
  const drumTail = project.drums.reduce((longest, track) => {
    if (track.muted || track.volume === 0) return longest;
    const decay =
      track.id === "hat" && track.sound === 1
        ? Math.min(2.5, track.decay * 3.2)
        : track.decay;
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
}

function keysTones(sound: number): KeysTone[] {
  if (sound === 0)
    return [
      { type: "sine", multiplier: 1, level: 0.76, detune: 0 },
      { type: "triangle", multiplier: 1, level: 0.2, detune: 2 },
      { type: "sine", multiplier: 2, level: 0.04, detune: 0 },
    ];
  if (sound === 1)
    return [
      { type: "triangle", multiplier: 1, level: 0.65, detune: 0 },
      { type: "sine", multiplier: 1, level: 0.25, detune: 0 },
      { type: "sine", multiplier: 2, level: 0.1, detune: 0 },
    ];
  return [
    { type: "sine", multiplier: 1, level: 0.47, detune: -3 },
    { type: "triangle", multiplier: 1, level: 0.47, detune: 3 },
    { type: "sawtooth", multiplier: 1, level: 0.06, detune: 0 },
  ];
}

class KeysVoice {
  private readonly filter: BiquadFilterNode;
  private readonly envelope: GainNode;
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
    const nodes: AudioNode[] = [this.filter, this.envelope];
    const sources: OscillatorNode[] = [];
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
      const delay = context.createDelay(2);
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
    const configurations = keysTones(track.sound);
    this.tones.forEach((tone, index) => {
      const configuration = configurations[index];
      if (!configuration) return;
      tone.oscillator.type = configuration.type;
      tone.oscillator.detune.setValueAtTime(configuration.detune, time);
      tone.gain.gain.setTargetAtTime(configuration.level, time, 0.01);
      tone.oscillator.frequency.cancelAndHoldAtTime(time);
      if (incomingSlide)
        tone.oscillator.frequency.exponentialRampToValueAtTime(
          frequency * configuration.multiplier,
          time + Math.min(0.08, duration * 0.65),
        );
      else
        tone.oscillator.frequency.setValueAtTime(
          frequency * configuration.multiplier,
          time,
        );
    });
    const attack =
      Math.min(
        track.decay * 0.2,
        track.sound === 1 ? 0.003 : track.sound === 2 ? 0.022 : 0.012,
      ) * (accent ? 0.7 : 1);
    const amplitude = Math.max(
      MIN_GAIN,
      track.volume * (track.sound === 1 ? 0.34 : 0.38) * (accent ? 1.28 : 1),
    );
    const cutoff = Math.min(
      15000,
      Math.max(
        frequency * 2,
        (750 + track.tone ** 1.4 * 10000) * (accent ? 1.18 : 1),
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
        Math.max(MIN_GAIN, amplitude * (track.sound === 1 ? 0.18 : 0.38)),
        time + track.decay * 0.55,
      );
      envelope.exponentialRampToValueAtTime(MIN_GAIN, time + track.decay);
      envelope.linearRampToValueAtTime(0, time + track.decay + 0.01);
    }
    this.filter.frequency.cancelAndHoldAtTime(time);
    if (incomingSlide)
      this.filter.frequency.exponentialRampToValueAtTime(cutoff, time + 0.025);
    else this.filter.frequency.setValueAtTime(cutoff, time);
    this.filter.frequency.exponentialRampToValueAtTime(
      Math.max(frequency * 1.4, 500 + track.tone * 4200),
      time + track.decay,
    );
    const beat = 60 / this.graph.bpm;
    this.echoes.forEach((echo, index) => {
      echo.delay.delayTime.setValueAtTime(beat * (index + 1) * 0.5, time);
      echo.damping.frequency.setValueAtTime(1200 + track.tone * 3000, time);
      echo.gain.gain.setValueAtTime(
        track.space * (index === 0 ? 0.2 : index === 1 ? 0.12 : 0.07),
        time,
      );
    });
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
