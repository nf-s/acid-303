import {
  trackCycleTicks,
  trackStepCount,
  ticksPerStep,
  tickSpanSeconds,
} from "./timing";
import { midiFrequency } from "./audio";
import type { MusicalScale } from "./model";
import { automatedPad, padChordNotes } from "./pad-model";
import type { PadTrack } from "./pad-model";

interface PadProfile {
  main: OscillatorType;
  layer: OscillatorType;
  harmonic: number;
  detune: number;
  gain: number;
  cutoff: number;
  resonance: number;
  motion: number;
  noise: number;
  formants?: readonly number[];
}
const profiles: PadProfile[] = [
  {
    main: "sawtooth",
    layer: "sawtooth",
    harmonic: 1,
    detune: 7,
    gain: 0.085,
    cutoff: 0.8,
    resonance: 0.6,
    motion: 0.22,
    noise: 0,
  },
  {
    main: "triangle",
    layer: "sine",
    harmonic: 2,
    detune: 2,
    gain: 0.13,
    cutoff: 1.5,
    resonance: 0.4,
    motion: 0.35,
    noise: 0.055,
  },
  {
    main: "sawtooth",
    layer: "triangle",
    harmonic: 1,
    detune: 3,
    gain: 0.16,
    cutoff: 1,
    resonance: 0.8,
    motion: 0.18,
    noise: 0.015,
    formants: [520, 1150, 2500],
  },
  {
    main: "sine",
    layer: "sine",
    harmonic: 3,
    detune: 1,
    gain: 0.14,
    cutoff: 2,
    resonance: 0.4,
    motion: 0.5,
    noise: 0,
  },
  {
    main: "triangle",
    layer: "sawtooth",
    harmonic: 2,
    detune: 11,
    gain: 0.09,
    cutoff: 0.65,
    resonance: 1.4,
    motion: 3.5,
    noise: 0.1,
  },
  {
    main: "triangle",
    layer: "square",
    harmonic: 0.5,
    detune: 2,
    gain: 0.12,
    cutoff: 0.3,
    resonance: 1.2,
    motion: 0.08,
    noise: 0.012,
  },
];

export function padReleaseSeconds(track: PadTrack): number {
  return 0.08 + track.release * track.release * 2.8;
}
export function padTailDuration(track: PadTrack, bpm: number): number {
  const volume = Math.max(track.volume, ...(track.automation.volume ?? []));
  if (track.muted || volume === 0) return 0;
  const release = Math.max(track.release, ...(track.automation.release ?? []));
  const space = Math.max(track.space, ...(track.automation.space ?? []));
  return (
    padReleaseSeconds({ ...track, release }) +
    (space > 0 ? Math.max(0.75, (60 / bpm) * 1.5) : 0) +
    0.05
  );
}

class PadVoice {
  private readonly sources: Array<OscillatorNode | AudioBufferSourceNode> = [];
  private readonly nodes: AudioNode[] = [];
  private readonly envelope: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly shimmer: GainNode;
  private readonly lfo: OscillatorNode;
  private readonly lfoDepth: GainNode;
  private readonly vibrato: GainNode;
  private readonly layers: GainNode[] = [];
  private readonly panners: StereoPannerNode[] = [];
  private readonly profile: PadProfile;
  readonly sound: number;
  endsAt: number;
  finished = false;
  private releaseValue: number;
  private attackEnd: number;

  constructor(
    context: BaseAudioContext,
    output: AudioNode,
    noise: AudioBuffer,
    track: PadTrack,
    notes: number[],
    time: number,
    private chordEnd: number,
    private readonly onFinished: () => void,
  ) {
    this.sound = track.sound;
    this.releaseValue = track.release;
    this.attackEnd =
      time + Math.min((chordEnd - time) * 0.7, 0.015 + track.attack ** 2 * 2.4);
    this.profile = profiles[track.sound] ??
      profiles[0] ?? {
        main: "sine",
        layer: "sine",
        harmonic: 1,
        detune: 0,
        gain: 0.08,
        cutoff: 1,
        resonance: 0.7,
        motion: 0.2,
        noise: 0,
      };
    this.endsAt = chordEnd + padReleaseSeconds(track) + 0.03;
    this.envelope = context.createGain();
    this.envelope.gain.value = 0;
    this.filter = context.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = this.profile.resonance;
    this.shimmer = context.createGain();
    this.shimmer.gain.value = 1;
    this.lfo = context.createOscillator();
    this.lfoDepth = context.createGain();
    this.vibrato = context.createGain();
    this.lfo.connect(this.lfoDepth);
    this.lfo.connect(this.vibrato);
    this.lfoDepth.connect(this.filter.detune);
    this.filter.connect(this.shimmer);
    this.shimmer.connect(this.envelope);
    this.envelope.connect(output);
    this.nodes.push(
      this.filter,
      this.shimmer,
      this.envelope,
      this.lfoDepth,
      this.vibrato,
    );
    this.sources.push(this.lfo);

    const mix = context.createGain();
    this.nodes.push(mix);
    if (this.profile.formants) {
      for (const [index, frequency] of this.profile.formants.entries()) {
        const formant = context.createBiquadFilter();
        formant.type = "bandpass";
        formant.frequency.value = frequency;
        formant.Q.value = 2.5 + index;
        const level = context.createGain();
        level.gain.value = index === 0 ? 0.8 : 0.45;
        mix.connect(formant);
        formant.connect(level);
        level.connect(this.filter);
        this.nodes.push(formant, level);
      }
    } else mix.connect(this.filter);

    for (const [index, note] of notes.entries()) {
      const frequency = midiFrequency(note);
      const pan = context.createStereoPanner();
      const main = context.createOscillator();
      const layer = context.createOscillator();
      const mainLevel = context.createGain();
      const layerLevel = context.createGain();
      main.type = this.profile.main;
      layer.type = this.profile.layer;
      main.frequency.value = frequency;
      layer.frequency.value = frequency * this.profile.harmonic;
      main.detune.value = (index % 2 ? -1 : 1) * this.profile.detune;
      layer.detune.value = (index % 2 ? 1 : -1) * this.profile.detune;
      mainLevel.gain.value = this.profile.gain / Math.sqrt(notes.length);
      layerLevel.gain.value = 0;
      main.connect(mainLevel);
      layer.connect(layerLevel);
      mainLevel.connect(pan);
      layerLevel.connect(pan);
      pan.connect(mix);
      this.vibrato.connect(main.detune);
      this.vibrato.connect(layer.detune);
      this.sources.push(main, layer);
      this.nodes.push(mainLevel, layerLevel, pan);
      this.layers.push(layerLevel);
      this.panners.push(pan);
      if (track.sound === 3) {
        const modulator = context.createOscillator();
        const depth = context.createGain();
        modulator.frequency.value = frequency * 2;
        depth.gain.value = frequency * 0.09;
        modulator.connect(depth);
        depth.connect(main.frequency);
        this.sources.push(modulator);
        this.nodes.push(depth);
      }
    }
    if (this.profile.noise > 0) {
      const air = context.createBufferSource();
      const airFilter = context.createBiquadFilter();
      const airLevel = context.createGain();
      air.buffer = noise;
      air.loop = true;
      airFilter.type = track.sound === 1 ? "highpass" : "bandpass";
      airFilter.frequency.value =
        track.sound === 1 ? 2800 : track.sound === 4 ? 1700 : 800;
      airFilter.Q.value = 0.6;
      airLevel.gain.value = this.profile.noise;
      air.connect(airFilter);
      airFilter.connect(airLevel);
      airLevel.connect(mix);
      this.sources.push(air);
      this.nodes.push(airFilter, airLevel);
    }
    this.envelope.gain.setValueAtTime(0, time);
    this.envelope.gain.linearRampToValueAtTime(1, this.attackEnd);
    this.envelope.gain.setValueAtTime(1, chordEnd);
    this.envelope.gain.exponentialRampToValueAtTime(
      0.0001,
      chordEnd + padReleaseSeconds(track),
    );
    this.envelope.gain.linearRampToValueAtTime(0, this.endsAt);
    this.update(track, time);
    let remaining = this.sources.length;
    for (const source of this.sources) {
      source.onended = () => {
        source.disconnect();
        remaining--;
        if (remaining === 0) {
          this.finished = true;
          for (const node of this.nodes) node.disconnect();
          this.onFinished();
        }
      };
      source.start(time);
      source.stop(this.endsAt);
    }
  }

  update(track: PadTrack, time: number, chordEnd = this.chordEnd): void {
    if (this.finished) return;
    if (
      Math.abs(chordEnd - this.chordEnd) > 0.00001 ||
      track.release !== this.releaseValue
    ) {
      this.releaseValue = track.release;
      const envelope = this.envelope.gain;
      // Move the release without restarting the oscillator or the existing attack.
      envelope.cancelAndHoldAtTime(
        Math.max(time, Math.min(this.chordEnd, chordEnd)),
      );
      if (this.attackEnd > chordEnd) {
        envelope.cancelAndHoldAtTime(time);
        this.attackEnd = time + (chordEnd - time) * 0.7;
        envelope.linearRampToValueAtTime(1, this.attackEnd);
      } else if (time > this.chordEnd) {
        envelope.linearRampToValueAtTime(1, Math.min(chordEnd, time + 0.02));
      }
      this.chordEnd = chordEnd;
      this.envelope.gain.setValueAtTime(1, this.chordEnd);
      this.envelope.gain.exponentialRampToValueAtTime(
        0.0001,
        this.chordEnd + padReleaseSeconds(track),
      );
      this.endsAt = this.chordEnd + padReleaseSeconds(track) + 0.03;
      this.envelope.gain.linearRampToValueAtTime(0, this.endsAt);
      for (const source of this.sources) source.stop(this.endsAt);
    }
    this.filter.frequency.setTargetAtTime(
      Math.min(16000, (140 + track.tone ** 2 * 12000) * this.profile.cutoff),
      time,
      0.04,
    );
    this.lfo.frequency.setTargetAtTime(
      this.profile.motion + track.motion ** 2 * (track.sound === 4 ? 10 : 2.5),
      time,
      0.04,
    );
    this.lfoDepth.gain.setTargetAtTime(
      track.motion * (track.sound === 4 ? 2200 : 750),
      time,
      0.04,
    );
    this.vibrato.gain.setTargetAtTime(track.motion * 9, time, 0.04);
    this.layers.forEach((level) =>
      level.gain.setTargetAtTime(
        (this.profile.gain * (0.06 + track.shape * 0.85)) /
          Math.sqrt(this.layers.length),
        time,
        0.04,
      ),
    );
    this.panners.forEach((pan, index) =>
      pan.pan.setTargetAtTime(
        ((index / Math.max(1, this.panners.length - 1)) * 2 - 1) *
          track.spread *
          0.85,
        time,
        0.04,
      ),
    );
    this.shimmer.gain.setTargetAtTime(1 / (1 + track.shape * 0.4), time, 0.04);
  }

  release(time: number, seconds: number): void {
    if (this.finished || time >= this.endsAt) return;
    this.envelope.gain.cancelAndHoldAtTime(time);
    this.envelope.gain.linearRampToValueAtTime(0, time + seconds);
    this.endsAt = time + seconds + 0.02;
    for (const source of this.sources) source.stop(this.endsAt);
  }
}

/** Sustained chords use their own bus so Texture level automation cannot mute them. */
export class PadInstrument {
  private readonly input: GainNode;
  private readonly level: GainNode;
  private readonly dry: GainNode;
  private readonly echoes: Array<{ delay: DelayNode; gain: GainNode }> = [];
  private readonly noise: AudioBuffer;
  private readonly voices: PadVoice[] = [];
  private readonly rackNodes: AudioNode[] = [];
  private current: PadVoice | null = null;
  private signature = "";
  private lastStep = -1;
  private stopped = false;
  private pendingVoices = 0;

  constructor(
    private readonly context: BaseAudioContext,
    output: AudioNode,
  ) {
    this.input = context.createGain();
    this.level = context.createGain();
    this.level.gain.value = 0;
    this.dry = context.createGain();
    this.input.connect(this.dry);
    this.dry.connect(this.level);
    this.level.connect(output);
    this.rackNodes.push(this.input, this.level, this.dry);
    for (let index = 0; index < 3; index++) {
      const delay = context.createDelay(2);
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      const pan = context.createStereoPanner();
      filter.type = "lowpass";
      filter.frequency.value = 3200 - index * 650;
      gain.gain.value = 0;
      pan.pan.value = index % 2 === 0 ? -0.65 : 0.65;
      this.input.connect(delay);
      delay.connect(filter);
      filter.connect(gain);
      gain.connect(pan);
      pan.connect(this.level);
      this.echoes.push({ delay, gain });
      this.rackNodes.push(delay, filter, gain, pan);
    }
    this.noise = context.createBuffer(
      1,
      Math.ceil(context.sampleRate * 2),
      context.sampleRate,
    );
    const data = this.noise.getChannelData(0);
    let seed = 1979;
    for (let index = 0; index < data.length; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[index] = (seed / 4294967296) * 2 - 1;
    }
  }

  schedule(
    track: PadTrack,
    scale: MusicalScale,
    absoluteStep: number,
    time: number,
    duration: number,
    bpm: number,
  ): void {
    const swing = Math.min(0.5, Math.abs(duration / (60 / bpm / 4) - 1));
    this.scheduleTick(track, scale, absoluteStep * 6, time, bpm, swing);
  }

  scheduleTick(
    track: PadTrack,
    scale: MusicalScale,
    logicalTick: number,
    time: number,
    bpm: number,
    swing: number,
  ): void {
    const absoluteStep = logicalTick / ticksPerStep(track.timing);
    const duration = tickSpanSeconds(
      logicalTick,
      logicalTick + ticksPerStep(track.timing),
      bpm,
      swing,
      track.timing.grid,
    );
    if (
      this.stopped ||
      absoluteStep < 0 ||
      !Number.isFinite(time) ||
      duration <= 0 ||
      bpm <= 0
    )
      return;
    track = automatedPad(track, absoluteStep % trackStepCount(track.timing));
    const span = trackCycleTicks(track.timing) / 4;
    const slot = Math.floor(logicalTick / span) % 4;
    const notes = padChordNotes(track, scale, slot);
    const signature = `${slot}:${trackCycleTicks(track.timing)}:${track.sound}:${notes.join(",")}`;
    this.level.gain.setTargetAtTime(
      track.muted ? 0 : track.volume * 1.25,
      time,
      0.02,
    );
    this.dry.gain.setTargetAtTime(1 - track.space * 0.2, time, 0.04);
    this.echoes.forEach((echo, index) => {
      echo.delay.delayTime.setValueAtTime(
        Math.max(0.25, (60 / bpm) * 0.5) * (index + 1),
        time,
      );
      echo.gain.gain.setTargetAtTime(
        track.space * ([0.22, 0.14, 0.08][index % 3] ?? 0),
        time,
        0.04,
      );
    });
    for (let index = this.voices.length - 1; index >= 0; index--) {
      const voice = this.voices[index];
      if (voice && (voice.finished || voice.endsAt <= time))
        this.voices.splice(index, 1);
    }
    if (track.muted || notes.length === 0) {
      this.current?.release(time, 0.025);
      this.current = null;
      this.signature = "";
      this.lastStep = absoluteStep;
      return;
    }
    const boundary = logicalTick % span === 0;
    const newChord =
      signature !== this.signature ||
      !this.current ||
      this.current.finished ||
      (boundary && absoluteStep !== this.lastStep);
    const remainingEnd = (Math.floor(logicalTick / span) + 1) * span;
    const end =
      time +
      tickSpanSeconds(logicalTick, remainingEnd, bpm, swing, track.timing.grid);
    if (newChord) {
      if (this.current && time < this.current.endsAt)
        this.current.release(time, padReleaseSeconds(track));
      if (this.voices.length >= 6) this.voices.shift()?.release(time, 0.04);
      this.pendingVoices++;
      this.current = new PadVoice(
        this.context,
        this.input,
        this.noise,
        track,
        notes,
        time,
        end,
        () => {
          this.pendingVoices--;
          this.disconnectWhenFinished();
        },
      );
      this.voices.push(this.current);
      this.signature = signature;
    } else this.current?.update(track, time, end);
    this.lastStep = absoluteStep;
  }

  finish(track: PadTrack, localStep: number, time: number): void {
    const resolved = automatedPad(track, localStep);
    this.current?.release(time, padReleaseSeconds(resolved));
    this.current = null;
  }

  stop(time = this.context.currentTime): void {
    if (this.stopped) return;
    this.stopped = true;
    this.level.gain.cancelAndHoldAtTime(time);
    this.level.gain.linearRampToValueAtTime(0, time + 0.015);
    for (const voice of this.voices) voice.release(time, 0.012);
    this.current = null;
    this.disconnectWhenFinished();
  }

  private disconnectWhenFinished(): void {
    if (this.stopped && this.pendingVoices === 0)
      for (const node of this.rackNodes) node.disconnect();
  }
}
