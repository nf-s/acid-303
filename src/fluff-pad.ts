import { midiFrequency } from "./audio";
import { FLUFF_PAD_LEVELS, FLUFF_PAD_PATCHES } from "./fluff-patches";
import type { MelodicControls, PadPatch } from "./fluff-patches";
import { playSynthVoice, trackedCutoff } from "./fluff-synth";
import type { FluffRack, SynthVoice } from "./fluff-synth";
import type { PadTrack } from "./pad-model";

function padControls(track: PadTrack, release: number): MelodicControls {
  return {
    tone: track.tone,
    decay: release,
    attack: 0,
    resonance: 0,
    shape: track.shape,
    width: track.spread,
    motion: track.motion,
    grit: 0,
  };
}

/**
 * One Fluff pad chord. The envelope follows the shared pad timing (attack to
 * full, hold to the chord end, exponential release); tone, spread and motion
 * follow the track while the chord sounds.
 */
export class FluffPadVoice {
  readonly sound: number;
  endsAt: number;
  finished = false;
  private readonly voice: SynthVoice;
  private readonly patch: PadPatch;
  private readonly lowest: number;
  private readonly level: number;
  private releaseValue: number;
  private attackEnd: number;

  constructor(
    context: BaseAudioContext,
    private readonly rack: FluffRack,
    track: PadTrack,
    notes: number[],
    time: number,
    private chordEnd: number,
    private readonly releaseSeconds: (track: PadTrack) => number,
    onFinished: () => void,
  ) {
    this.sound = track.sound;
    this.releaseValue = track.release;
    this.attackEnd =
      time + Math.min((chordEnd - time) * 0.7, 0.015 + track.attack ** 2 * 2.4);
    const patch = FLUFF_PAD_PATCHES[track.sound] ?? FLUFF_PAD_PATCHES[0];
    if (!patch) throw new Error("No Fluff pad patches.");
    this.patch = patch;
    const release = releaseSeconds(track);
    this.endsAt = chordEnd + release + 0.03;
    const frequencies = notes.map(midiFrequency);
    this.lowest = Math.min(...frequencies);
    const controls = padControls(track, release);
    const spec = patch.voice(controls);
    this.level = spec.level * (FLUFF_PAD_LEVELS[track.sound] ?? 1);
    rack.set(patch.rack(controls), time, true);
    this.voice = playSynthVoice(context, rack, rack.input, {
      spec,
      frequencies,
      time,
      gate: this.endsAt - time,
      accent: false,
      width: track.spread,
      pan: 0,
      seed: Math.round(time * 7919 + this.lowest * 17),
      manualAmp: true,
      onEnded: () => {
        this.finished = true;
        onFinished();
      },
    });
    const envelope = this.voice.amp.gain;
    envelope.setValueAtTime(0, time);
    envelope.linearRampToValueAtTime(this.level, this.attackEnd);
    envelope.setValueAtTime(this.level, chordEnd);
    envelope.exponentialRampToValueAtTime(
      this.level * 0.0001,
      chordEnd + release,
    );
    envelope.linearRampToValueAtTime(0, this.endsAt);
    this.voice.stopAt(this.endsAt);
  }

  update(track: PadTrack, time: number, chordEnd = this.chordEnd): void {
    if (this.finished) return;
    const envelope = this.voice.amp.gain;
    if (
      Math.abs(chordEnd - this.chordEnd) > 0.00001 ||
      track.release !== this.releaseValue
    ) {
      this.releaseValue = track.release;
      // Move the release without restarting the sources or the existing attack.
      envelope.cancelAndHoldAtTime(
        Math.max(time, Math.min(this.chordEnd, chordEnd)),
      );
      if (this.attackEnd > chordEnd) {
        envelope.cancelAndHoldAtTime(time);
        this.attackEnd = time + (chordEnd - time) * 0.7;
        envelope.linearRampToValueAtTime(this.level, this.attackEnd);
      } else if (time > this.chordEnd) {
        envelope.linearRampToValueAtTime(
          this.level,
          Math.min(chordEnd, time + 0.02),
        );
      }
      this.chordEnd = chordEnd;
      const release = this.releaseSeconds(track);
      envelope.setValueAtTime(this.level, this.chordEnd);
      envelope.exponentialRampToValueAtTime(
        this.level * 0.0001,
        this.chordEnd + release,
      );
      this.endsAt = this.chordEnd + release + 0.03;
      envelope.linearRampToValueAtTime(0, this.endsAt);
      this.voice.stopAt(this.endsAt);
    }
    const controls = padControls(track, this.releaseSeconds(track));
    const spec = this.patch.voice(controls);
    this.rack.set(this.patch.rack(controls), time);
    if (spec.filter) {
      const cutoff = trackedCutoff(spec.filter, this.lowest, 19000);
      for (const filter of this.voice.filters)
        filter.frequency.setTargetAtTime(cutoff, time, 0.04);
    }
    const cross = (1 - Math.max(0, Math.min(1, track.spread))) * 0.85;
    for (const gain of this.voice.cross)
      gain.gain.setTargetAtTime(cross, time, 0.04);
  }

  release(time: number, seconds: number): void {
    if (this.finished || time >= this.endsAt) return;
    const envelope = this.voice.amp.gain;
    envelope.cancelAndHoldAtTime(time);
    envelope.linearRampToValueAtTime(0, time + seconds);
    this.endsAt = time + seconds + 0.02;
    this.voice.stopAt(this.endsAt);
  }
}
