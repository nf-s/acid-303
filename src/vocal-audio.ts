import type { Progression } from "./progression-model";
import type { MusicalScale } from "./model";
import {
  automatedVocal,
  resolveVocalTrim,
  vocalProgressionNote,
} from "./vocal-model";
import type { VocalNote, VocalTrack } from "./vocal-model";
import type { LoadedVocalSample } from "./vocal-samples";
import {
  swungTick,
  automationStepCount,
  ticksPerStep,
  trackStepCount,
  tickSpanSeconds,
} from "./timing";

export function vocalReleaseSeconds(track: VocalTrack): number {
  return 0.008 + track.release ** 2 * 1.6;
}
export function vocalTailDuration(track: VocalTrack, bpm: number): number {
  if (track.muted || !track.notes.length) return 0;
  let longest = 0;
  for (let index = 0; index < automationStepCount(track); index++) {
    const resolved = automatedVocal(track, index);
    if (resolved.volume > 0)
      longest = Math.max(
        longest,
        vocalReleaseSeconds(resolved) +
          (resolved.space > 0 ? (60 / bpm) * 2.25 : 0) +
          0.04,
      );
  }
  return longest;
}
class VocalVoice {
  private source: AudioBufferSourceNode;
  private sourceLevel: GainNode;
  private readonly highpass: BiquadFilterNode;
  private trimSignature: string;
  private sourceStarted = false;
  private readonly hold: ConstantSourceNode;
  private readonly envelope: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly driveInput: GainNode;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly echoes: GainNode[] = [];
  private readonly nodes: AudioNode[] = [];
  private readonly attackEnd: number;
  private readonly tail: number;
  private finished = false;
  private released = false;
  private peak: number;

  constructor(
    private readonly context: BaseAudioContext,
    output: AudioNode,
    private readonly loaded: LoadedVocalSample,
    track: VocalTrack,
    note: VocalNote,
    time: number,
    end: number,
    bpm: number,
    onFinished: () => void,
  ) {
    const source = context.createBufferSource();
    this.source = source;
    source.buffer = loaded.buffer;
    source.playbackRate.value =
      2 ** ((note.note - loaded.sample.rootNote) / 12);
    source.loop = track.loop;
    const trim = resolveVocalTrim(track, loaded.buffer.duration);
    source.loopStart = trim.start;
    source.loopEnd = trim.end;
    this.trimSignature = `${track.loop}:${trim.start}:${trim.end}`;
    this.sourceLevel = context.createGain();
    this.peak =
      (note.accent ? 1.16 : 1) *
      Math.min(1.25, Math.max(0.6, 0.18 / loaded.sample.rms));
    this.attackEnd =
      time +
      Math.min(
        Math.max(0.002, (end - time) * 0.8),
        0.002 + track.attack ** 2 * 0.6,
      );
    const highpass = context.createBiquadFilter();
    this.highpass = highpass;
    highpass.type = "highpass";
    highpass.frequency.value = 45;
    highpass.Q.value = 0.5;
    this.filter = context.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = 0.65;
    this.driveInput = context.createGain();
    const distortion = context.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let index = 0; index < curve.length; index++) {
      const value = (index / (curve.length - 1)) * 2 - 1;
      curve[index] = Math.tanh(value * 2) / Math.tanh(2);
    }
    distortion.curve = curve;
    distortion.oversample = "2x";
    this.dry = context.createGain();
    this.wet = context.createGain();
    this.envelope = context.createGain();
    source.connect(this.sourceLevel);
    this.sourceLevel.connect(highpass);
    highpass.connect(this.filter);
    this.filter.connect(this.dry);
    this.dry.connect(this.envelope);
    this.filter.connect(this.driveInput);
    this.driveInput.connect(distortion);
    distortion.connect(this.wet);
    this.wet.connect(this.envelope);
    this.envelope.connect(output);
    this.nodes.push(
      source,
      this.sourceLevel,
      highpass,
      this.filter,
      this.driveInput,
      distortion,
      this.dry,
      this.wet,
      this.envelope,
    );
    this.tail = (60 / bpm) * 2.25 + 0.025;
    for (let index = 1; index <= 3; index++) {
      const delayTime = (60 / bpm) * 0.75 * index;
      const delay = context.createDelay(delayTime + 0.01);
      delay.delayTime.value = delayTime;
      const damp = context.createBiquadFilter();
      damp.type = "lowpass";
      damp.frequency.value = 4200 / index;
      const gain = context.createGain();
      this.envelope.connect(delay);
      delay.connect(damp);
      damp.connect(gain);
      gain.connect(output);
      this.echoes.push(gain);
      this.nodes.push(delay, damp, gain);
    }
    this.hold = context.createConstantSource();
    this.hold.offset.value = 0;
    this.hold.connect(output);
    this.nodes.push(this.hold);
    this.hold.onended = () => {
      this.finished = true;
      for (const node of this.nodes) node.disconnect();
      onFinished();
    };
    this.controls(track, note, time);
    this.envelope.gain.setValueAtTime(0.0001, time);
    this.envelope.gain.linearRampToValueAtTime(this.peak, this.attackEnd);
    if (track.loop) source.start(time, trim.start);
    else source.start(time, trim.start, trim.end - trim.start);
    this.sourceStarted = true;
    this.hold.start(time);
    this.gate(track, end);
  }
  private controls(track: VocalTrack, note: VocalNote, time: number): void {
    this.peak =
      (note.accent ? 1.16 : 1) *
      Math.min(1.25, Math.max(0.6, 0.18 / this.loaded.sample.rms));
    this.source.playbackRate.setTargetAtTime(
      2 ** ((note.note - this.loaded.sample.rootNote) / 12),
      time,
      0.008,
    );
    this.filter.frequency.setTargetAtTime(1200 * 14 ** track.tone, time, 0.008);
    this.driveInput.gain.setTargetAtTime(1 + track.drive * 9, time, 0.006);
    this.dry.gain.setTargetAtTime(1 - track.drive * 0.8, time, 0.006);
    this.wet.gain.setTargetAtTime(track.drive * 0.42, time, 0.006);
    this.echoes.forEach((gain, index) =>
      gain.gain.setTargetAtTime(
        track.space * (index === 0 ? 0.22 : index === 1 ? 0.12 : 0.07),
        time,
        0.008,
      ),
    );
    const trim = resolveVocalTrim(track, this.loaded.buffer.duration);
    const signature = `${track.loop}:${trim.start}:${trim.end}`;
    if (
      this.sourceStarted &&
      signature !== this.trimSignature &&
      (track.loop || this.source.loop)
    ) {
      this.sourceLevel.gain.cancelScheduledValues(time);
      this.sourceLevel.gain.setValueAtTime(1, time);
      this.sourceLevel.gain.linearRampToValueAtTime(0, time + 0.006);
      this.source.stop(time + 0.008);
      const source = this.context.createBufferSource(),
        gain = this.context.createGain();
      source.buffer = this.loaded.buffer;
      source.playbackRate.value =
        2 ** ((note.note - this.loaded.sample.rootNote) / 12);
      source.loop = track.loop;
      source.loopStart = trim.start;
      source.loopEnd = trim.end;
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(1, time + 0.006);
      source.connect(gain);
      gain.connect(this.highpass);
      this.nodes.push(source, gain);
      if (track.loop) source.start(time, trim.start);
      else source.start(time, trim.start, trim.end - trim.start);
      this.source = source;
      this.sourceLevel = gain;
      this.trimSignature = signature;
    }
  }

  private gate(track: VocalTrack, end: number): void {
    const release = vocalReleaseSeconds(track);
    this.envelope.gain.setValueAtTime(this.peak, end);
    this.envelope.gain.exponentialRampToValueAtTime(0.0001, end + release);
    this.envelope.gain.linearRampToValueAtTime(0, end + release + 0.002);
    this.source.stop(end + release + 0.003);
    this.hold.stop(end + release + this.tail);
  }
  update(track: VocalTrack, note: VocalNote, time: number, end: number): void {
    if (this.finished || this.released) return;
    this.controls(track, note, time);
    this.envelope.gain.cancelAndHoldAtTime(time);
    if (time < this.attackEnd)
      this.envelope.gain.linearRampToValueAtTime(
        this.peak,
        Math.min(this.attackEnd, end),
      );
    else this.envelope.gain.setTargetAtTime(this.peak, time, 0.008);
    this.gate(track, Math.max(time + 0.001, end));
  }
  release(time: number, duration: number, hard = false): void {
    if (this.finished) return;
    this.released = true;
    this.envelope.gain.cancelAndHoldAtTime(time);
    this.envelope.gain.linearRampToValueAtTime(0, time + duration);
    this.source.stop(time + duration + 0.002);
    this.hold.stop(time + duration + (hard ? 0.003 : this.tail));
  }
}

export class VocalInstrument {
  private readonly level: GainNode;
  private readonly voices = new Set<VocalVoice>();
  private current: VocalVoice | null = null;
  private currentStart = -1;
  private currentPitch = 60;
  private stopped = false;
  constructor(
    private readonly context: BaseAudioContext,
    output: AudioNode,
    private readonly loaded: LoadedVocalSample,
  ) {
    this.level = context.createGain();
    this.level.gain.value = 0;
    this.level.connect(output);
  }
  scheduleTick(
    track: VocalTrack,
    logicalTick: number,
    time: number,
    bpm: number,
    swing: number,
    scale?: MusicalScale,
    progression?: Progression,
  ): void {
    if (this.stopped) return;
    const stepTicks = ticksPerStep(track.timing),
      count = trackStepCount(track.timing);
    const absoluteStep = Math.floor(logicalTick / stepTicks),
      index = absoluteStep % count;
    const resolved = automatedVocal(track, absoluteStep);
    this.level.gain.setTargetAtTime(
      track.muted ? 0 : resolved.volume * 0.6,
      time,
      0.006,
    );
    if (track.muted) {
      this.current?.release(time, 0.012);
      this.current = null;
      this.currentStart = -1;
      return;
    }
    const note = track.notes.find(
      (value) => index >= value.start && index < value.start + value.length,
    );
    if (!note) {
      this.current?.release(time, vocalReleaseSeconds(resolved));
      this.current = null;
      this.currentStart = -1;
      return;
    }
    const start = absoluteStep - index + note.start;
    const endTick = (start + note.length) * stepTicks;
    const end =
      time +
      tickSpanSeconds(logicalTick, endTick, bpm, swing, track.timing.grid);
    if (this.current && this.currentStart === start)
      this.current.update(
        resolved,
        { ...note, note: track.followChords ? this.currentPitch : note.note },
        time,
        end,
      );
    else if (index === note.start) {
      this.currentPitch =
        track.followChords && scale && progression
          ? vocalProgressionNote(
              note.note,
              scale,
              progression,
              swungTick(logicalTick, swing, track.timing.grid),
              swing,
            )
          : note.note;
      this.current?.release(time, 0.008);
      let voice: VocalVoice;
      voice = new VocalVoice(
        this.context,
        this.level,
        this.loaded,
        resolved,
        { ...note, note: this.currentPitch },
        time,
        end,
        bpm,
        () => {
          this.voices.delete(voice);
          if (this.stopped && this.voices.size === 0) this.level.disconnect();
        },
      );
      this.voices.add(voice);
      this.current = voice;
      this.currentStart = start;
    }
  }
  audition(
    track: VocalTrack,
    note: number,
    accent: boolean,
    time: number,
    duration: number,
    bpm: number,
  ): void {
    if (this.stopped) return;
    this.level.gain.setValueAtTime(track.volume * 0.6, time);
    let voice: VocalVoice;
    voice = new VocalVoice(
      this.context,
      this.level,
      this.loaded,
      track,
      { start: 0, length: 1, note, accent },
      time,
      time + duration,
      bpm,
      () => {
        this.voices.delete(voice);
        if (this.voices.size === 0) this.level.disconnect();
      },
    );
    this.voices.add(voice);
  }
  finish(track: VocalTrack, localStep: number, time: number): void {
    this.current?.release(
      time,
      vocalReleaseSeconds(automatedVocal(track, localStep)),
    );
    this.current = null;
  }
  stop(time = this.context.currentTime): void {
    if (this.stopped) return;
    this.stopped = true;
    this.level.gain.cancelAndHoldAtTime(time);
    this.level.gain.linearRampToValueAtTime(0, time + 0.012);
    for (const voice of this.voices) voice.release(time, 0.012, true);
    this.current = null;
    if (this.voices.size === 0) this.level.disconnect();
  }
}
