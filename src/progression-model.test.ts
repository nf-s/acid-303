import { describe, expect, it } from "vitest";
import { SCALE_MODES, scaleNotes } from "./model";
import { swungTick, trackCycleTicks } from "./timing";
import {
  CHORD_PROGRESSIONS,
  applyProgression,
  createProgression,
  progressionChordAtTick,
  progressionChordBounds,
  progressionChordLabel,
  progressionChordNotes,
  progressionSchema,
  retuneProgression,
} from "./progression-model";

describe("shared chord progression", () => {
  it("creates independent eight-bar harmony without instrument sound or mute state", () => {
    const first = createProgression(),
      second = createProgression();
    expect(first.timing).toEqual({ bars: 8, meter: "4/4", grid: "straight" });
    expect(first.chords.map((chord) => chord.degree)).toEqual([0, 5, 2, 6]);
    first.chords[0] = { degree: 3, inversion: 2 };
    expect(second.chords[0]).toEqual({ degree: 0, inversion: 0 });
    expect(progressionSchema.parse(JSON.parse(JSON.stringify(second)))).toEqual(
      second,
    );
  });
  it("retains the existing A minor seventh voicings and inversions", () => {
    const progression = createProgression();
    const scale = { root: 9, mode: "minor" } satisfies Parameters<
      typeof progressionChordNotes
    >[1];
    expect(progressionChordNotes(progression, scale, 0)).toEqual([
      57, 60, 64, 67,
    ]);
    expect(progressionChordNotes(progression, scale, 1)).toEqual([
      69, 72, 76, 77,
    ]);
    expect(progressionChordLabel(progression, scale, 0)).toBe("Am7");
    expect(progressionChordLabel(progression, scale, 1)).toBe("Fmaj7");
    expect(progressionChordNotes(progression, scale, -1)).toEqual([]);
  });
  it("uses its own absolute cycle including half-bar boundaries and swing", () => {
    const progression = progressionSchema.parse({
      timing: { bars: 2, meter: "7/8", grid: "straight" },
    });
    expect(trackCycleTicks(progression.timing)).toBe(168);
    const boundary = swungTick(42, 0.4, "straight");
    expect(progressionChordAtTick(progression, boundary - 0.01, 0.4)).toBe(0);
    expect(progressionChordAtTick(progression, boundary, 0.4)).toBe(1);
    expect(progressionChordBounds(progression, boundary, 0.4)).toEqual({
      slot: 1,
      startTick: boundary,
      endTick: 84,
    });
    expect(progressionChordAtTick(progression, 168, 0.4)).toBe(0);
    for (const tick of [-1, NaN, Infinity])
      expect(progressionChordAtTick(progression, tick)).toBe(-1);
    progression.timing.grid = "triplet";
    expect(progressionChordAtTick(progression, 42, 0.4)).toBe(1);
  });
  it("keeps every voicing diatonic across roots, modes and pentatonic degree wrapping", () => {
    for (const root of [0, 9, 11])
      for (const mode of SCALE_MODES) {
        const scale = { root, mode: mode.id };
        const original = createProgression();
        const progression = retuneProgression(original, scale);
        const allowed = scaleNotes(scale, 24, 108);
        for (let slot = 0; slot < 4; slot++) {
          const notes = progressionChordNotes(progression, scale, slot);
          expect(notes).toHaveLength(4);
          expect(notes.every((note) => allowed.includes(note))).toBe(true);
          expect(notes.at(-1)).toBeLessThanOrEqual(83);
        }
        expect(original.chords.map((chord) => chord.degree)).toEqual([
          0, 5, 2, 6,
        ]);
        if (mode.id === "pentatonic")
          expect(progression.chords.map((chord) => chord.degree)).toEqual([
            0, 0, 2, 1,
          ]);
      }
  });
  it("applies existing progression recipes without changing timing", () => {
    const progression = createProgression();
    const timing = { ...progression.timing };
    for (const preset of CHORD_PROGRESSIONS) {
      expect(
        applyProgression(progression, preset.id, { root: 0, mode: "major" }),
      ).toBe(true);
      expect(progression.chords.map((chord) => chord.degree)).toEqual(
        preset.degrees,
      );
      expect(progression.timing).toEqual(timing);
    }
    const before = structuredClone(progression);
    expect(
      applyProgression(progression, "unknown", { root: 0, mode: "major" }),
    ).toBe(false);
    expect(progression).toEqual(before);
  });
  it("rejects malformed external chord data and unsupported timing", () => {
    const progression = createProgression();
    for (const chords of [
      [],
      progression.chords.slice(1),
      [{ degree: -1, inversion: 0 }, ...progression.chords.slice(1)],
      [{ degree: 0, inversion: 4 }, ...progression.chords.slice(1)],
    ])
      expect(
        progressionSchema.safeParse({ ...progression, chords }).success,
      ).toBe(false);
    for (const bars of [1, 3, 32, NaN])
      expect(
        progressionSchema.safeParse({
          ...progression,
          timing: { ...progression.timing, bars },
        }).success,
      ).toBe(false);
  });
});
