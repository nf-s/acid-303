import { STEP_COUNT, stepDuration } from "./model";
import type { BassTrack, DrumTrack, Project } from "./model";

type ScheduledSource = OscillatorNode | AudioBufferSourceNode;

interface AudioGraph {
  context: BaseAudioContext;
  input: GainNode;
  distortion: WaveShaperNode;
  compressor: DynamicsCompressorNode;
  master: GainNode;
  analyser: AnalyserNode;
  noise: AudioBuffer;
  sources: Set<ScheduledSource>;
  drive: number;
}

const MIN_GAIN = 0.0001;
const LOOKAHEAD = 0.1;
const WAV_SAMPLE_RATE = 44100;

export function midiFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

function distortionCurve(drive: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(2048);
  const amount = 1 + drive * 16;
  const normalization = Math.tanh(amount);
  for (let index = 0; index < curve.length; index += 1) {
    const value = (index / (curve.length - 1)) * 2 - 1;
    curve[index] =
      drive < 0.001 ? value : Math.tanh(value * amount) / normalization;
  }
  return curve;
}

function createGraph(context: BaseAudioContext, project: Project): AudioGraph {
  const input = context.createGain();
  const distortion = context.createWaveShaper();
  const compressor = context.createDynamicsCompressor();
  const master = context.createGain();
  const analyser = context.createAnalyser();
  input.gain.value = 0.6;
  distortion.curve = distortionCurve(project.drive);
  distortion.oversample = "4x";
  compressor.threshold.value = -10;
  compressor.knee.value = 6;
  compressor.ratio.value = 16;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.14;
  master.gain.value = project.volume * 0.8;
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.82;
  input.connect(distortion);
  distortion.connect(compressor);
  compressor.connect(master);
  master.connect(analyser);
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
    distortion,
    compressor,
    master,
    analyser,
    noise,
    sources: new Set(),
    drive: project.drive,
  };
}

function updateGraph(graph: AudioGraph, project: Project): void {
  const now = graph.context.currentTime;
  graph.master.gain.cancelAndHoldAtTime(now);
  graph.master.gain.setTargetAtTime(project.volume * 0.8, now, 0.015);
  if (graph.drive !== project.drive) {
    graph.distortion.curve = distortionCurve(project.drive);
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
    const frequencies = [49, 57, 44];
    const fundamental = frequencies[track.sound] ?? 49;
    const source = oscillator(
      track.sound === 2 ? "triangle" : "sine",
      fundamental * 3.8,
      output,
    );
    source.frequency.exponentialRampToValueAtTime(
      fundamental * pitch,
      time + 0.045,
    );
    source.frequency.exponentialRampToValueAtTime(
      Math.max(20, fundamental * pitch * 0.7),
      time + decay,
    );
    envelope(output.gain, 0.95, decay);
    const click = context.createGain();
    click.connect(graph.input);
    nodes.push(click);
    noise("highpass", track.sound === 1 ? 2800 : 1400, click);
    envelope(click.gain, track.sound === 1 ? 0.15 : 0.07, 0.012);
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
  } else {
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = Math.min(
      16000,
      (track.sound === 2 ? 720 : 1100) * pitch,
    );
    filter.Q.value = track.sound === 1 ? 2.2 : 0.75;
    filter.connect(output);
    nodes.push(filter);
    const base = track.sound === 2 ? 360 : track.sound === 1 ? 610 : 540;
    oscillator(track.sound === 1 ? "triangle" : "square", base, filter);
    oscillator("square", base * 1.4815, filter);
    envelope(output.gain, 0.28, decay);
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
    const next = track.steps[(stepIndex + 1) % STEP_COUNT];
    const envelope = this.gain.gain;
    envelope.cancelAndHoldAtTime(time);
    if (!step?.on || track.muted || track.volume === 0) {
      envelope.linearRampToValueAtTime(0, time + 0.008);
      this.sliding = false;
      return;
    }
    const incomingSlide = this.sliding;
    const outgoingSlide = step.slide && next?.on === true;
    const frequency = midiFrequency(step.note);
    this.oscillator.type = track.waveform;
    this.oscillator.frequency.cancelAndHoldAtTime(time);
    if (incomingSlide)
      this.oscillator.frequency.exponentialRampToValueAtTime(
        frequency,
        time + Math.min(0.065, duration * 0.6),
      );
    else this.oscillator.frequency.setValueAtTime(frequency, time);

    const amplitude = Math.max(
      MIN_GAIN,
      (track.volume * (step.accent ? 0.48 : 0.32)) /
        (1 + track.resonance * 0.018),
    );
    if (!incomingSlide) {
      envelope.setValueAtTime(MIN_GAIN, time);
      envelope.linearRampToValueAtTime(amplitude, time + 0.003);
    }
    if (outgoingSlide) {
      envelope.exponentialRampToValueAtTime(
        Math.max(MIN_GAIN, amplitude * 0.74),
        time + duration,
      );
    } else {
      envelope.exponentialRampToValueAtTime(
        Math.max(MIN_GAIN, amplitude * 0.5),
        time + duration * 0.68,
      );
      envelope.exponentialRampToValueAtTime(MIN_GAIN, time + duration * 0.92);
      envelope.linearRampToValueAtTime(0, time + duration * 0.96);
    }

    this.filters.forEach((filter, index) => {
      const base = Math.min(17000, track.cutoff * (index === 0 ? 1 : 1.12));
      const peak = Math.min(
        18000,
        base + track.envelope * (step.accent ? 10500 : 7200),
      );
      filter.Q.setValueAtTime(
        index === 0 ? 0.8 + track.resonance * 0.45 : 0.7,
        time,
      );
      filter.frequency.cancelAndHoldAtTime(time);
      if (!incomingSlide) {
        filter.frequency.setValueAtTime(base, time);
        filter.frequency.exponentialRampToValueAtTime(peak, time + 0.004);
      }
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

  getAnalyser(): AnalyserNode | null {
    return this.graph?.analyser ?? null;
  }

  async exportWav(project: Project): Promise<Blob> {
    const loopDuration = (60 / project.bpm) * 8;
    const tailDuration = 1.6;
    const context = new OfflineAudioContext(
      2,
      Math.ceil((loopDuration + tailDuration) * WAV_SAMPLE_RATE),
      WAV_SAMPLE_RATE,
    );
    const graph = createGraph(context, project);
    const bass = new BassVoice(graph);
    let time = 0;
    for (let index = 0; index < STEP_COUNT * 2; index += 1) {
      const step = index % STEP_COUNT;
      const duration = stepDuration(project.bpm, project.swing, step);
      for (const drum of project.drums) {
        if (!drum.muted && drum.steps[step]) drumVoice(graph, drum, time);
      }
      bass.schedule(project.bass, step, time, duration);
      time += duration;
    }
    bass.stop(loopDuration);
    const rendered = await context.startRendering();
    const channels: Float32Array[] = [];
    for (let index = 0; index < rendered.numberOfChannels; index += 1)
      channels.push(rendered.getChannelData(index));
    return encodeWav(channels, rendered.sampleRate);
  }
}
