import { ticksPerStep, trackStepCount } from "./timing";
import { midiFrequency, saturationSample } from "./audio";
import {
  arpEvents,
  arpEventsAtTick,
  arpInterval,
  automatedArp,
  arpValueFromNormalized,
} from "./arp-model";
import type { ArpEvent, ArpTrack } from "./arp-model";
import type { MusicalScale } from "./model";

interface ArpProfile {
  first: OscillatorType;
  second: OscillatorType;
  harmonic: number;
  level: number;
  attack: number;
  sustain: number;
  release: number;
  fm: number;
  ratio: number;
  brightness: number;
}
interface ArpVoice {
  sources: Array<OscillatorNode | AudioBufferSourceNode>;
  nodes: AudioNode[];
  envelope: GainNode;
}

function profileFor(sound: number): ArpProfile {
  if (sound === 1)
    return {
      first: "square",
      second: "triangle",
      harmonic: 2,
      level: 0.24,
      attack: 0.002,
      sustain: 0.3,
      release: 0.22,
      fm: 0.02,
      ratio: 2,
      brightness: 0.9,
    };
  if (sound === 2)
    return {
      first: "sine",
      second: "sine",
      harmonic: 3,
      level: 0.32,
      attack: 0.001,
      sustain: 0.12,
      release: 0.9,
      fm: 3.2,
      ratio: 2.01,
      brightness: 1.25,
    };
  if (sound === 3)
    return {
      first: "sawtooth",
      second: "square",
      harmonic: 1,
      level: 0.25,
      attack: 0.0015,
      sustain: 0.2,
      release: 0.3,
      fm: 0.04,
      ratio: 1,
      brightness: 1.1,
    };
  if (sound === 4)
    return {
      first: "triangle",
      second: "sine",
      harmonic: 3,
      level: 0.32,
      attack: 0.012,
      sustain: 0.55,
      release: 0.45,
      fm: 0.17,
      ratio: 2,
      brightness: 0.65,
    };
  if (sound === 5)
    return {
      first: "sine",
      second: "sawtooth",
      harmonic: 4,
      level: 0.28,
      attack: 0.001,
      sustain: 0.08,
      release: 0.65,
      fm: 2.6,
      ratio: 1.414,
      brightness: 1.2,
    };
  return {
    first: "triangle",
    second: "sine",
    harmonic: 2,
    level: 0.34,
    attack: 0.001,
    sustain: 0.1,
    release: 0.5,
    fm: 0.6,
    ratio: 2,
    brightness: 0.8,
  };
}

export function arpTailDuration(track: ArpTrack, bpm: number): number {
  const volume = Math.max(track.volume, ...(track.automation.volume ?? []));
  if (
    track.muted ||
    volume === 0 ||
    track.notes.length === 0 ||
    !track.steps.some(Boolean)
  )
    return 0;
  const beat = 60 / bpm;
  const gate = Math.max(
    track.gate,
    ...(track.automation.gate ?? []).map((value) =>
      arpValueFromNormalized("gate", value),
    ),
  );
  const decay = Math.max(
    track.decay,
    ...(track.automation.decay ?? []).map((value) =>
      arpValueFromNormalized("decay", value),
    ),
  );
  const space = Math.max(track.space, ...(track.automation.space ?? []));
  return (
    (arpInterval(track.rate) * beat * gate) / 4 +
    0.018 +
    decay * profileFor(track.sound).release +
    (space > 0 ? beat * 1.5 : 0) +
    0.05
  );
}

/** Short polyphonic voices share a level bus; all sources own their cleanup. */
export class ArpInstrument {
  private readonly level: GainNode;
  private readonly voices = new Set<ArpVoice>();
  private firstStep = true;

  constructor(
    private readonly context: BaseAudioContext,
    output: AudioNode,
  ) {
    this.level = context.createGain();
    this.level.gain.value = 0;
    this.level.connect(output);
  }

  schedule(
    track: ArpTrack,
    scale: MusicalScale,
    absoluteStep: number,
    time: number,
    duration: number,
    bpm: number,
  ): void {
    track = automatedArp(track, absoluteStep);
    this.level.gain.cancelAndHoldAtTime(time);
    const level = track.muted ? 0 : track.volume;
    if (this.firstStep) this.level.gain.setValueAtTime(level, time);
    else this.level.gain.setTargetAtTime(level, time, 0.004);
    this.firstStep = false;
    for (const event of arpEvents(track, scale, absoluteStep))
      this.note(
        track,
        event,
        time + event.offset * duration,
        (event.duration * 60) / bpm / 4,
        bpm,
      );
  }

  scheduleTick(track: ArpTrack, scale: MusicalScale, logicalTick: number, time: number, bpm: number): void {
    const index = Math.floor(logicalTick / ticksPerStep(track.timing)) % trackStepCount(track.timing);
    track = automatedArp(track,index);
    this.level.gain.cancelAndHoldAtTime(time);
    const level = track.muted ? 0 : track.volume;
    if (this.firstStep) this.level.gain.setValueAtTime(level,time);
    else this.level.gain.setTargetAtTime(level,time,0.004);
    this.firstStep = false;
    for (const event of arpEventsAtTick(track,scale,logicalTick))
      this.note(track,event,time,event.duration * 60 / bpm / 4,bpm);
  }

  stop(time = this.context.currentTime): void {
    this.level.gain.cancelAndHoldAtTime(time);
    this.level.gain.linearRampToValueAtTime(0, time + 0.008);
    for (const voice of this.voices) {
      voice.envelope.gain.cancelAndHoldAtTime(time);
      voice.envelope.gain.linearRampToValueAtTime(0, time + 0.008);
      for (const source of voice.sources) source.stop(time + 0.012);
    }
  }

  destroy(): void {
    this.stop();
    this.level.disconnect();
  }

  private note(
    track: ArpTrack,
    event: ArpEvent,
    time: number,
    gate: number,
    bpm: number,
  ): void {
    const context = this.context;
    const profile = profileFor(track.sound);
    const frequency = midiFrequency(event.note);
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    const dry = context.createStereoPanner();
    const first = context.createOscillator();
    const second = context.createOscillator();
    const secondLevel = context.createGain();
    const modulation = context.createOscillator();
    const modulationLevel = context.createGain();
    const voice: ArpVoice = {
      sources: [first, second, modulation],
      nodes: [filter, envelope, dry, secondLevel, modulationLevel],
      envelope,
    };
    first.type = profile.first;
    second.type = profile.second;
    first.frequency.value = frequency;
    second.frequency.value = frequency * profile.harmonic;
    second.detune.value = (track.sound === 1 ? 12 : 5) * track.width;
    secondLevel.gain.value =
      0.03 +
      track.shape * (track.sound === 1 || track.sound === 3 ? 0.65 : 0.3);
    modulation.frequency.value = frequency * profile.ratio;
    modulationLevel.gain.setValueAtTime(
      frequency * profile.fm * (0.12 + track.shape * 1.2),
      time,
    );
    modulationLevel.gain.exponentialRampToValueAtTime(
      0.0001,
      time + Math.max(0.025, track.decay),
    );
    modulation.connect(modulationLevel);
    modulationLevel.connect(first.frequency);
    first.connect(filter);
    second.connect(secondLevel);
    secondLevel.connect(filter);
    filter.type = "lowpass";
    filter.Q.value =
      track.sound === 4
        ? 0.45 + track.resonance * 2.5
        : 0.5 + track.resonance * (track.sound === 3 ? 8 : 4);
    const maximum = Math.min(17000, context.sampleRate * 0.45);
    const base = Math.min(maximum, 150 + track.tone ** 1.7 * 11000);
    const peak = Math.min(
      maximum,
      Math.max(
        frequency * 1.2,
        base * profile.brightness * (1.4 + track.shape * 2.5),
      ),
    );
    filter.frequency.setValueAtTime(peak, time);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(70, base * 0.6),
      time + Math.max(0.03, track.decay),
    );
    const release = 0.018 + track.decay * profile.release;
    const attack = Math.min(profile.attack, gate * 0.25);
    const hold = Math.max(attack + 0.002, gate);
    const amplitude =
      (profile.level * (event.accent ? 1.18 : 1)) /
      (1 + track.resonance * 0.25 + track.shape * 0.15);
    envelope.gain.value = 0;
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(amplitude, time + attack);
    envelope.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, amplitude * profile.sustain),
      time + hold,
    );
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + hold + release);
    envelope.gain.linearRampToValueAtTime(0, time + hold + release + 0.005);
    filter.connect(envelope);
    dry.pan.value = Math.sin(event.eventIndex * 2.399963) * track.width * 0.65;
    envelope.connect(dry);
    dry.connect(this.level);

    if (track.sound === 5) {
      const buffer = context.createBuffer(
        1,
        Math.ceil(context.sampleRate * 0.25),
        context.sampleRate,
      );
      const samples = buffer.getChannelData(0);
      let seed = (track.seed + event.eventIndex * 397 + 1) >>> 0;
      let previous = 0;
      for (let index = 0; index < samples.length; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const white = seed / 2147483648 - 1;
        previous = previous * 0.55 + white * 0.45;
        samples[index] = saturationSample(previous, track.shape);
      }
      const noise = context.createBufferSource();
      const noiseGain = context.createGain();
      noise.buffer = buffer;
      noise.loop = true;
      noise.playbackRate.value = frequency / 220;
      noiseGain.gain.value = 0.2 + track.shape * 0.55;
      noise.connect(noiseGain);
      noiseGain.connect(filter);
      voice.sources.push(noise);
      voice.nodes.push(noiseGain);
    }

    const beat = 60 / bpm;
    if (track.space > 0) {
      for (let index = 0; index < 3; index++) {
        const delay = context.createDelay(3);
        const damping = context.createBiquadFilter();
        const echoLevel = context.createGain();
        const pan = context.createStereoPanner();
        delay.delayTime.value = beat * (index + 1) * 0.5;
        damping.type = "lowpass";
        damping.frequency.value = 2200 + track.tone * 3000;
        echoLevel.gain.value = track.space * 0.24 * 0.55 ** index;
        pan.pan.value = (index % 2 === 0 ? -1 : 1) * track.width * 0.85;
        envelope.connect(delay);
        delay.connect(damping);
        damping.connect(echoLevel);
        echoLevel.connect(pan);
        pan.connect(this.level);
        voice.nodes.push(delay, damping, echoLevel, pan);
      }
    }
    const end =
      time + hold + release + (track.space > 0 ? beat * 1.5 : 0) + 0.04;
    let remaining = voice.sources.length;
    this.voices.add(voice);
    for (const source of voice.sources) {
      source.onended = () => {
        source.disconnect();
        remaining--;
        if (remaining === 0) {
          for (const node of voice.nodes) node.disconnect();
          this.voices.delete(voice);
        }
      };
      source.start(time);
      source.stop(end);
    }
  }
}
