import { describe, expect, it } from "vitest";
import { SCALE_MODES, createProject, noteName, readProject } from "./model";
import type { MusicalScale } from "./model";
import {
  CHORD_BORROWS,
  CHORD_PROGRESSIONS,
  CHORD_QUALITIES,
  PROGRESSION_GROUPS,
  applyProgression,
  chordLabel,
  chordNotes,
  chordNumeral,
  chordPreview,
  createProgression,
  progressionChordLabel,
  progressionChordNotes,
  progressionEntryChords,
  progressionFitsScale,
  progressionMatches,
  progressionScaleDegrees,
  progressionSchema,
} from "./progression-model";
import type { ChordQuality, ProgressionChord } from "./progression-model";
import { PRESETS, createPreset } from "./presets";
import { vocalProgressionNote } from "./vocal-model";
import { arpNotePool } from "./arp-model";

/** The chord voicing and label code of the previous release, kept as a reference. */
function legacyNotes(chord: ProgressionChord, scale: MusicalScale): number[] {
  const degrees = progressionScaleDegrees(scale);
  const root = chord.degree % degrees.length;
  const notes = [0, 2, 4, 6].map((offset) => {
    const degree = root + offset;
    return (
      (degrees[degree % degrees.length] ?? 48 + scale.root) +
      12 * Math.floor(degree / degrees.length)
    );
  });
  for (let index = 0; index < chord.inversion; index++) {
    const first = notes.shift();
    if (first !== undefined) {
      let raised = first + 12;
      while (raised <= (notes.at(-1) ?? first)) raised += 12;
      notes.push(raised);
    }
  }
  while ((notes.at(-1) ?? 0) > 83)
    for (let index = 0; index < notes.length; index++)
      notes[index] = (notes[index] ?? 60) - 12;
  return notes;
}
function legacyLabel(chord: ProgressionChord, scale: MusicalScale): string {
  const root =
    progressionScaleDegrees(scale)[
      chord.degree % progressionScaleDegrees(scale).length
    ];
  if (root === undefined) return "Rest";
  const notes = legacyNotes({ ...chord, inversion: 0 }, scale);
  const name = noteName(root).replace(/-?\d+$/, "");
  if (scale.mode === "pentatonic") return `${name} cluster`;
  const base = notes[0] ?? root;
  const third = ((notes[1] ?? base) - base) % 12;
  const fifth = ((notes[2] ?? base) - base) % 12;
  const seventh = ((notes[3] ?? base) - base) % 12;
  return `${name}${fifth === 6 ? "m7♭5" : third === 3 ? "m7" : seventh === 11 ? "maj7" : "7"}`;
}
const aMinor: MusicalScale = { root: 9, mode: "minor" };
const cMajor: MusicalScale = { root: 0, mode: "major" };

describe("chord colours and borrowing", () => {
  it("leaves every existing chord's notes and name unchanged", () => {
    for (const mode of SCALE_MODES)
      for (let root = 0; root < 12; root++)
        for (let degree = 0; degree < 7; degree++)
          for (let inversion = 0; inversion < 4; inversion++) {
            const scale = { root, mode: mode.id };
            const chord = { degree, inversion };
            expect(chordNotes(chord, scale)).toEqual(legacyNotes(chord, scale));
            expect(chordLabel(chord, scale)).toBe(legacyLabel(chord, scale));
            expect(chordNotes({ ...chord, quality: "seventh" }, scale)).toEqual(
              legacyNotes(chord, scale),
            );
          }
  });
  it("parses old saved chords and projects without adding fields", () => {
    const old = {
      timing: { bars: 4, meter: "4/4", grid: "straight" },
      chords: [
        { degree: 3, inversion: 2 },
        { degree: 0, inversion: 0 },
        { degree: 5, inversion: 1 },
        { degree: 6, inversion: 3 },
      ],
    };
    expect(JSON.stringify(progressionSchema.parse(old))).toBe(
      JSON.stringify(old),
    );
    const saved: unknown = JSON.parse(JSON.stringify(createProject()));
    expect(readProject(saved)).toEqual(saved);
  });
  it("keeps every earlier bundled example on the original seventh chords", () => {
    // Only the five Fluff tracks written for the chord colours use them.
    const coloured = new Set([
      "fluff-sodium",
      "fluff-slow-turn",
      "fluff-brickwork",
      "fluff-late-bus",
      "fluff-parallax",
    ]);
    for (const preset of PRESETS) {
      const project = createPreset(preset.id);
      const chords = [...project.progression.chords, ...project.pad.chords];
      if (coloured.has(preset.id)) {
        expect(
          chords.some((chord) => chord.quality ?? chord.borrow),
          preset.id,
        ).toBeTruthy();
        continue;
      }
      for (const chord of chords) {
        expect(chord.quality, preset.id).toBeUndefined();
        expect(chord.borrow, preset.id).toBeUndefined();
      }
    }
    expect(
      PRESETS.filter((preset) => coloured.has(preset.id)).map(
        (preset) => preset.id,
      ),
    ).toEqual([...coloured]);
  });
  it("rejects unknown chord types and borrowed scales", () => {
    const progression = createProgression();
    for (const chord of [
      { degree: 0, inversion: 0, quality: "eleventh" },
      { degree: 0, inversion: 0, borrow: "pentatonic" },
      { degree: 0, inversion: 0, borrow: "lydian" },
    ])
      expect(
        progressionSchema.safeParse({
          ...progression,
          chords: [chord, ...progression.chords.slice(1)],
        }).success,
      ).toBe(false);
  });
  it("builds and names every chord type in several keys and scales", () => {
    const cases: Array<
      [MusicalScale, number, Partial<Record<ChordQuality, [string, number[]]>>]
    > = [
      [
        aMinor,
        0,
        {
          triad: ["Am", [57, 60, 64]],
          seventh: ["Am7", [57, 60, 64, 67]],
          ninth: ["Am9", [57, 60, 64, 67, 71]],
          add9: ["Amadd9", [57, 60, 64, 71]],
          sus2: ["Asus2", [57, 59, 64]],
          sus4: ["Asus4", [57, 62, 64]],
          power: ["A5", [57, 64, 69]],
        },
      ],
      [
        cMajor,
        0,
        {
          triad: ["C", [48, 52, 55]],
          seventh: ["Cmaj7", [48, 52, 55, 59]],
          ninth: ["Cmaj9", [48, 52, 55, 59, 62]],
          add9: ["Cadd9", [48, 52, 55, 62]],
          sus2: ["Csus2", [48, 50, 55]],
          sus4: ["Csus4", [48, 53, 55]],
          power: ["C5", [48, 55, 60]],
        },
      ],
      [
        cMajor,
        4,
        {
          triad: ["G", [55, 59, 62]],
          seventh: ["G7", [55, 59, 62, 65]],
          ninth: ["G9", [55, 59, 62, 65, 69]],
          add9: ["Gadd9", [55, 59, 62, 69]],
        },
      ],
      [
        aMinor,
        1,
        { triad: ["Bdim", [59, 62, 65]], seventh: ["Bm7♭5", [59, 62, 65, 69]] },
      ],
      [
        { root: 4, mode: "phrygian" },
        0,
        { ninth: ["Em7♭9", [52, 55, 59, 62, 65]], triad: ["Em", [52, 55, 59]] },
      ],
      [
        { root: 2, mode: "dorian" },
        3,
        {
          seventh: ["G7", [55, 59, 62, 65]],
          ninth: ["G9", [55, 59, 62, 65, 69]],
        },
      ],
      [
        { root: 9, mode: "pentatonic" },
        0,
        {
          seventh: ["A cluster", [57, 62, 67, 72]],
          sus2: ["Asus2", [57, 59, 64]],
        },
      ],
    ];
    for (const [scale, degree, qualities] of cases)
      for (const quality of CHORD_QUALITIES) {
        const expected = qualities[quality];
        if (!expected) continue;
        const chord = { degree, inversion: 0, quality };
        expect(chordLabel(chord, scale)).toBe(expected[0]);
        expect(chordNotes(chord, scale)).toEqual(expected[1]);
      }
  });
  it("voices inversions within the register and limits them by chord size", () => {
    for (const mode of SCALE_MODES)
      for (let root = 0; root < 12; root++)
        for (const quality of CHORD_QUALITIES)
          for (let degree = 0; degree < 7; degree++)
            for (let inversion = 0; inversion < 4; inversion++) {
              const scale = { root, mode: mode.id };
              const notes = chordNotes({ degree, inversion, quality }, scale);
              expect(notes.length).toBeGreaterThanOrEqual(3);
              expect(Math.max(...notes)).toBeLessThanOrEqual(83);
              expect(Math.min(...notes)).toBeGreaterThanOrEqual(36);
              expect(
                notes.every(
                  (note, index) =>
                    index === 0 || note > (notes[index - 1] ?? 0),
                ),
              ).toBe(true);
              if (quality === "power")
                expect(notes).toEqual(
                  chordNotes({ degree, inversion: 0, quality }, scale),
                );
            }
    expect(
      chordNotes({ degree: 0, inversion: 3, quality: "triad" }, aMinor),
    ).toEqual(
      chordNotes({ degree: 0, inversion: 0, quality: "triad" }, aMinor),
    );
  });
  it("borrows roots and thirds from the parallel scale and names them with flats", () => {
    const flatSix: ProgressionChord = {
      degree: 5,
      inversion: 0,
      borrow: "minor",
    };
    expect(chordLabel(flatSix, cMajor)).toBe("A♭maj7");
    expect(chordNotes(flatSix, cMajor)).toEqual([56, 60, 63, 67]);
    expect(chordNumeral(flatSix, cMajor)).toBe("♭VI");
    const flatSeven: ProgressionChord = {
      degree: 6,
      inversion: 0,
      quality: "triad",
      borrow: "minor",
    };
    expect(chordLabel(flatSeven, cMajor)).toBe("B♭");
    expect(chordNumeral(flatSeven, cMajor)).toBe("♭VII");
    const minorFour: ProgressionChord = {
      degree: 3,
      inversion: 0,
      borrow: "minor",
    };
    expect(chordLabel(minorFour, cMajor)).toBe("Fm7");
    expect(chordNumeral(minorFour, cMajor)).toBe("iv");
    const dominant: ProgressionChord = {
      degree: 4,
      inversion: 0,
      borrow: "major",
    };
    expect(chordLabel(dominant, aMinor)).toBe("E7");
    expect(chordNotes(dominant, aMinor)).toEqual([64, 68, 71, 74]);
    expect(chordNumeral(dominant, aMinor)).toBe("V");
    const majorFour: ProgressionChord = {
      degree: 3,
      inversion: 0,
      quality: "triad",
      borrow: "dorian",
    };
    expect(chordLabel(majorFour, aMinor)).toBe("D");
    const neapolitan: ProgressionChord = {
      degree: 1,
      inversion: 0,
      borrow: "phrygian",
    };
    expect(chordLabel(neapolitan, aMinor)).toBe("B♭maj7");
    expect(chordNumeral(neapolitan, aMinor)).toBe("♭II");
    const pentatonic: MusicalScale = { root: 9, mode: "pentatonic" };
    expect(chordNotes(neapolitan, pentatonic)).toEqual(
      chordNotes({ degree: 1, inversion: 0 }, pentatonic),
    );
    expect(chordPreview(dominant, aMinor)).toEqual({
      notes: [64, 68, 71, 74],
      bass: 40,
    });
  });
  it("numbers diatonic chords by their scale degree and case", () => {
    const lift = CHORD_PROGRESSIONS.find((entry) => entry.id === "lift");
    if (!lift) throw new Error("Missing lift.");
    expect(
      progressionEntryChords(lift, aMinor).map((chord) =>
        chordNumeral(chord, aMinor),
      ),
    ).toEqual(["i", "VI", "III", "VII"]);
    expect(chordNumeral({ degree: 6, inversion: 0 }, cMajor)).toBe("vii°");
  });
  it("keeps Arp and Vocal followers on the coloured and borrowed chord", () => {
    const project = createProject();
    project.scale = cMajor;
    project.progression.chords = [
      { degree: 0, inversion: 0 },
      { degree: 5, inversion: 0, quality: "triad", borrow: "minor" },
      { degree: 3, inversion: 0, quality: "sus2" },
      { degree: 4, inversion: 0, quality: "ninth" },
    ];
    project.arp.followChords = true;
    project.arp.octaves = 1;
    project.arp.direction = "up";
    const span = (8 * 96) / 4;
    expect(arpNotePool(project.arp, cMajor, project.progression, span)).toEqual(
      [56, 60, 63],
    );
    expect(
      arpNotePool(project.arp, cMajor, project.progression, span * 3),
    ).toHaveLength(5);
    // Over the borrowed A♭, notes move through C minor: E4 → E♭ → C5, C4 → A♭4.
    expect(vocalProgressionNote(64, cMajor, project.progression, span)).toBe(
      72,
    );
    expect(vocalProgressionNote(60, cMajor, project.progression, span)).toBe(
      68,
    );
    expect(vocalProgressionNote(60, cMajor, project.progression, 0)).toBe(60);
  });
});

describe("progression library", () => {
  it("has 40–64 uniquely named entries across the groups", () => {
    expect(CHORD_PROGRESSIONS.length).toBeGreaterThanOrEqual(40);
    expect(CHORD_PROGRESSIONS.length).toBeLessThanOrEqual(64);
    expect(new Set(CHORD_PROGRESSIONS.map((entry) => entry.id)).size).toBe(
      CHORD_PROGRESSIONS.length,
    );
    for (const group of PROGRESSION_GROUPS)
      expect(
        CHORD_PROGRESSIONS.filter(
          (entry) =>
            entry.group === group && progressionFitsScale(entry, "minor"),
        ).length,
      ).toBeGreaterThanOrEqual(3);
    for (const mode of CHORD_BORROWS)
      expect(
        CHORD_PROGRESSIONS.filter((entry) => progressionFitsScale(entry, mode))
          .length,
      ).toBeGreaterThanOrEqual(8);
  });
  it("produces valid chords for every entry in every key and scale", () => {
    for (const mode of SCALE_MODES)
      for (const root of [0, 3, 9, 11])
        for (const entry of CHORD_PROGRESSIONS) {
          const scale = { root, mode: mode.id };
          const progression = createProgression();
          expect(applyProgression(progression, entry.id, scale)).toBe(true);
          expect(progressionSchema.parse(progression)).toEqual(progression);
          expect(progressionMatches(entry, progression, scale)).toBe(true);
          for (let slot = 0; slot < 4; slot++) {
            const notes = progressionChordNotes(progression, scale, slot);
            expect(notes.length).toBeGreaterThanOrEqual(3);
            expect(Math.max(...notes)).toBeLessThanOrEqual(83);
            expect(progressionChordLabel(progression, scale, slot)).not.toBe(
              "Rest",
            );
            const chord = progression.chords[slot];
            if (!chord) throw new Error("Missing chord.");
            expect(chord.quality).not.toBe("seventh");
            expect(chord.borrow).not.toBe(mode.id);
          }
        }
  });
  it("lists an entry wherever it sounds as written", () => {
    for (const entry of CHORD_PROGRESSIONS) {
      expect(progressionFitsScale(entry, entry.mode)).toBe(true);
      expect(progressionFitsScale(entry, "pentatonic")).toBe(true);
      for (const mode of CHORD_BORROWS) {
        if (!progressionFitsScale(entry, mode)) continue;
        const home = { root: 2, mode: entry.mode },
          other = { root: 2, mode };
        const played = progressionEntryChords(entry, other);
        progressionEntryChords(entry, home).forEach((chord, index) => {
          const candidate = played[index];
          if (!candidate) throw new Error("Missing chord.");
          expect(chordNotes({ ...candidate, inversion: 0 }, other)).toEqual(
            chordNotes({ ...chord, inversion: 0 }, home),
          );
        });
      }
    }
  });
  it("voices repeated chords the same way so vamps alternate two shapes", () => {
    const vamp = CHORD_PROGRESSIONS.find((entry) => entry.id === "minor-nines");
    if (!vamp) throw new Error("Missing vamp.");
    const chords = progressionEntryChords(vamp, aMinor);
    expect(chords[2]).toEqual(chords[0]);
    expect(chords[3]).toEqual(chords[1]);
    expect(chords[0]?.inversion).toBe(0);
  });
});
