import { describe, expect, it } from "vitest";
import { scaleNotes, SCALE_MODES } from "./model";
import {
  PAD_PROGRESSIONS,
  applyPadProgression,
  createPad,
  padChordAtStep,
  padChordLabel,
  padChordNotes,
  padScaleDegrees,
  padSchema,
  retunePad,
} from "./pad-model";
import { padTailDuration } from "./pad-audio";

describe("chord progression model", () => {
  it("adds a silent eight-bar progression with four editable chord slots", () => {
    const pad = createPad();
    expect(pad.muted).toBe(true);
    expect(pad.bars).toBe(8);
    expect(pad.chords).toHaveLength(4);
    expect(padSchema.parse(JSON.parse(JSON.stringify(pad)))).toEqual(pad);
  });

  it("rejects unsafe lengths, sound choices and chord positions at the boundary", () => {
    const pad = createPad();
    for (const bars of [0, -1, 3, 32, Infinity])
      expect(padSchema.safeParse({ ...pad, bars }).success).toBe(false);
    expect(padSchema.safeParse({ ...pad, sound: 6 }).success).toBe(false);
    expect(
      padSchema.safeParse({ ...pad, chords: pad.chords.slice(1) }).success,
    ).toBe(false);
    expect(
      padSchema.safeParse({
        ...pad,
        chords: pad.chords.map(() => ({ degree: 7, inversion: 0 })),
      }).success,
    ).toBe(false);
    expect(padSchema.safeParse({ ...pad, volume: NaN }).success).toBe(false);
  });

  it("holds each chord for its share of every supported progression length", () => {
    for (const bars of [2, 4, 8, 16]) {
      const pad = padSchema.parse({ ...createPad(), bars });
      const positions = Array.from({ length: bars * 16 }, (_, step) =>
        padChordAtStep(pad, step),
      );
      for (let chord = 0; chord < 4; chord++)
        expect(positions.filter((slot) => slot === chord)).toHaveLength(
          bars * 4,
        );
      expect(padChordAtStep(pad, bars * 16)).toBe(0);
      expect(padChordAtStep(pad, bars * 16 - 1)).toBe(3);
    }
    expect(padChordAtStep(createPad(), -1)).toBe(-1);
    expect(padChordAtStep(createPad(), NaN)).toBe(-1);
  });

  it("keeps all inversions of all progressions inside the chosen scale", () => {
    for (const mode of SCALE_MODES)
      for (let root = 0; root < 12; root++) {
        const scale = { root, mode: mode.id };
        const allowed = scaleNotes(scale, 24, 96);
        const pad = createPad();
        for (const progression of PAD_PROGRESSIONS) {
          expect(applyPadProgression(pad, progression.id, scale)).toBe(true);
          for (let slot = 0; slot < 4; slot++)
            for (let inversion = 0; inversion < 4; inversion++) {
              const chord = pad.chords[slot];
              if (!chord) throw new Error("Missing chord slot.");
              chord.inversion = inversion;
              const notes = padChordNotes(pad, scale, slot);
              expect(notes).toHaveLength(4);
              expect(new Set(notes).size).toBe(4);
              expect(notes.every((note) => allowed.includes(note))).toBe(true);
              expect(Math.max(...notes)).toBeLessThanOrEqual(83);
              expect(
                notes.every(
                  (note, index) =>
                    index === 0 || note > (notes[index - 1] ?? 0),
                ),
              ).toBe(true);
            }
        }
      }
  });

  it("retunes scale degrees without losing timing, inversions or sound parameters", () => {
    const pad = createPad();
    pad.sound = 4;
    pad.bars = 16;
    pad.chords[0] = { degree: 6, inversion: 3 };
    const changed = retunePad(pad, { root: 6, mode: "pentatonic" });
    expect(changed.chords[0]).toEqual({ degree: 1, inversion: 3 });
    expect(changed.bars).toBe(16);
    expect(changed.sound).toBe(4);
    expect(pad.chords[0]?.degree).toBe(6);
    expect(padScaleDegrees({ root: 6, mode: "pentatonic" })).toHaveLength(5);
  });

  it("names chord quality from the selected scale and keeps inversion labels stable", () => {
    const pad = createPad();
    expect(padChordLabel(pad, { root: 0, mode: "major" }, 0)).toBe("Cmaj7");
    expect(padChordLabel(pad, { root: 9, mode: "minor" }, 0)).toBe("Am7");
    pad.chords[0] = { degree: 6, inversion: 3 };
    expect(padChordLabel(pad, { root: 0, mode: "major" }, 0)).toBe("Bm7♭5");
    expect(padChordLabel(pad, { root: 9, mode: "pentatonic" }, 0)).toContain(
      "cluster",
    );
    expect(padChordNotes(pad, { root: 0, mode: "major" }, 9)).toEqual([]);
  });

  it("keeps invalid progression requests from altering the current chords", () => {
    const pad = createPad();
    const before = structuredClone(pad);
    expect(
      applyPadProgression(pad, "<script>", { root: 0, mode: "major" }),
    ).toBe(false);
    expect(pad).toEqual(before);
  });

  it("reserves the final release plus slow echo for export", () => {
    const pad = createPad();
    expect(padTailDuration(pad, 60)).toBe(0);
    pad.muted = false;
    pad.release = 1;
    pad.space = 1;
    expect(padTailDuration(pad, 60)).toBeGreaterThanOrEqual(4.4);
    const wet = padTailDuration(pad, 180);
    pad.space = 0;
    expect(padTailDuration(pad, 180)).toBeLessThan(wet);
    pad.volume = 0;
    expect(padTailDuration(pad, 60)).toBe(0);
  });
});
