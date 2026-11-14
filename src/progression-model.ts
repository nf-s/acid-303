import { z } from "zod";
import {
  createPadTiming,
  padTimingSchema,
  trackCycleTicks,
  unswungTick,
  swungTick,
} from "./timing";
import { noteName, scaleNotes } from "./model";
import type { MusicalScale } from "./model";

export const CHORD_QUALITIES = [
  "triad",
  "seventh",
  "ninth",
  "add9",
  "sus2",
  "sus4",
  "power",
] as const;
export const chordQualitySchema = z.enum(CHORD_QUALITIES);
export type ChordQuality = z.infer<typeof chordQualitySchema>;
export const CHORD_QUALITY_NAMES: Record<ChordQuality, string> = {
  triad: "Triad",
  seventh: "7th",
  ninth: "9th",
  add9: "Add9",
  sus2: "Sus2",
  sus4: "Sus4",
  power: "Power",
};
/** Parallel modes a chord can borrow from; Pentatonic projects ignore borrowing. */
export const CHORD_BORROWS = ["major", "minor", "dorian", "phrygian"] as const;
export const chordBorrowSchema = z.enum(CHORD_BORROWS);
export type ChordBorrow = z.infer<typeof chordBorrowSchema>;

/**
 * `quality` and `borrow` are optional rather than defaulted: an absent field is
 * the original diatonic seventh, so older projects, presets and links keep
 * their exact shape, and session peers on the previous schema strip the fields
 * instead of rejecting edits to keys they do not have.
 */
export const progressionChordSchema = z.object({
  degree: z.number().int().min(0).max(6),
  inversion: z.number().int().min(0).max(3).default(0),
  quality: chordQualitySchema.optional(),
  borrow: chordBorrowSchema.optional(),
});
export const progressionSchema = z.object({
  timing: padTimingSchema.default(createPadTiming),
  chords: z
    .array(progressionChordSchema)
    .length(4)
    .default(() => [
      { degree: 0, inversion: 0 },
      { degree: 5, inversion: 1 },
      { degree: 2, inversion: 0 },
      { degree: 6, inversion: 1 },
    ]),
});
export type Progression = z.infer<typeof progressionSchema>;
export type ProgressionChord = z.infer<typeof progressionChordSchema>;
export function createProgression(): Progression {
  return progressionSchema.parse({});
}

export const PROGRESSION_GROUPS = [
  "Uplifting",
  "Melancholy",
  "Dreamy",
  "Deep",
  "Driving",
  "Dark",
  "Tense",
] as const;
export type ProgressionGroup = (typeof PROGRESSION_GROUPS)[number];
interface LibraryChord {
  degree: number;
  quality?: ChordQuality;
  borrow?: ChordBorrow;
}
export interface ChordProgressionEntry {
  id: string;
  group: ProgressionGroup;
  /** The scale the entry was written for; it is listed wherever it sounds the same. */
  mode: ChordBorrow;
  chords: readonly LibraryChord[];
  /** Fixed inversions; otherwise each chord takes the closest voicing to the last. */
  inversions?: readonly number[];
}
function c(
  degree: number,
  quality?: ChordQuality,
  borrow?: ChordBorrow,
): LibraryChord {
  return {
    degree,
    ...(quality ? { quality } : {}),
    ...(borrow ? { borrow } : {}),
  };
}
const alternate = [0, 1, 0, 1];
/** The first eight ids are used by the Grain examples and keep their original chords. */
export const CHORD_PROGRESSIONS: readonly ChordProgressionEntry[] = [
  {
    id: "lift",
    group: "Uplifting",
    mode: "minor",
    chords: [c(0), c(5), c(2), c(6)],
    inversions: alternate,
  },
  {
    id: "return",
    group: "Uplifting",
    mode: "major",
    chords: [c(0), c(3), c(5), c(4)],
    inversions: alternate,
  },
  {
    id: "descent",
    group: "Melancholy",
    mode: "minor",
    chords: [c(0), c(6), c(5), c(4)],
    inversions: alternate,
  },
  {
    id: "orbit",
    group: "Dreamy",
    mode: "major",
    chords: [c(0), c(2), c(3), c(5)],
    inversions: alternate,
  },
  {
    id: "resolve",
    group: "Deep",
    mode: "major",
    chords: [c(1), c(4), c(0), c(5)],
    inversions: alternate,
  },
  {
    id: "suspended",
    group: "Driving",
    mode: "minor",
    chords: [c(0), c(3), c(0), c(6)],
    inversions: alternate,
  },
  {
    id: "rise",
    group: "Uplifting",
    mode: "major",
    chords: [c(5), c(3), c(0), c(4)],
    inversions: alternate,
  },
  {
    id: "drift",
    group: "Dreamy",
    mode: "major",
    chords: [c(0), c(1), c(5), c(3)],
    inversions: alternate,
  },
  // Minor
  {
    id: "anthem",
    group: "Uplifting",
    mode: "minor",
    chords: [c(0, "triad"), c(5, "add9"), c(2, "triad"), c(6, "triad")],
  },
  {
    id: "skyward",
    group: "Uplifting",
    mode: "minor",
    chords: [c(5, "add9"), c(6, "triad"), c(0, "sus4"), c(0, "triad")],
  },
  {
    id: "rotation",
    group: "Uplifting",
    mode: "minor",
    chords: [c(5), c(2, "add9"), c(6, "triad"), c(0, "triad")],
  },
  {
    id: "climb",
    group: "Uplifting",
    mode: "minor",
    chords: [c(0, "triad"), c(6, "triad"), c(5, "add9"), c(6, "sus4")],
  },
  {
    id: "lament",
    group: "Melancholy",
    mode: "minor",
    chords: [c(0), c(4), c(5), c(3)],
  },
  {
    id: "circle",
    group: "Melancholy",
    mode: "minor",
    chords: [c(0), c(3), c(6), c(2)],
  },
  {
    id: "falling",
    group: "Melancholy",
    mode: "minor",
    chords: [c(0, "add9"), c(3), c(5), c(4)],
  },
  {
    id: "homeward",
    group: "Melancholy",
    mode: "minor",
    chords: [c(0), c(5), c(2), c(3)],
  },
  {
    id: "haze",
    group: "Dreamy",
    mode: "minor",
    chords: [c(0, "ninth"), c(5), c(0, "ninth"), c(5)],
  },
  {
    id: "float",
    group: "Dreamy",
    mode: "minor",
    chords: [c(5, "ninth"), c(6, "sus2"), c(2, "add9"), c(0, "sus2")],
  },
  {
    id: "glass",
    group: "Dreamy",
    mode: "minor",
    chords: [c(5), c(0, "ninth"), c(2), c(6, "sus2")],
  },
  {
    id: "minor-nines",
    group: "Deep",
    mode: "minor",
    chords: [c(0, "ninth"), c(3, "ninth"), c(0, "ninth"), c(3, "ninth")],
  },
  {
    id: "deep-walk",
    group: "Deep",
    mode: "minor",
    chords: [c(3, "ninth"), c(4, "ninth"), c(0, "ninth"), c(5, "ninth")],
  },
  {
    id: "two-step",
    group: "Deep",
    mode: "minor",
    chords: [c(0, "ninth"), c(6, "ninth"), c(0, "ninth"), c(6, "ninth")],
  },
  {
    id: "pulse",
    group: "Driving",
    mode: "minor",
    chords: [c(0, "triad"), c(6, "triad"), c(0, "triad"), c(6, "triad")],
  },
  {
    id: "push",
    group: "Driving",
    mode: "minor",
    chords: [c(5, "add9"), c(6, "triad"), c(5, "add9"), c(6, "sus4")],
  },
  {
    id: "pedal",
    group: "Driving",
    mode: "minor",
    chords: [c(0), c(5), c(3), c(0)],
    inversions: [0, 1, 2, 0],
  },
  {
    id: "power-run",
    group: "Driving",
    mode: "minor",
    chords: [c(0, "power"), c(5, "power"), c(2, "power"), c(6, "power")],
  },
  {
    id: "shadow",
    group: "Dark",
    mode: "minor",
    chords: [
      c(0),
      c(1, "seventh", "phrygian"),
      c(0),
      c(1, "seventh", "phrygian"),
    ],
  },
  {
    id: "low-power",
    group: "Dark",
    mode: "minor",
    chords: [
      c(0, "power"),
      c(1, "power", "phrygian"),
      c(0, "power"),
      c(6, "power"),
    ],
  },
  {
    id: "cellar",
    group: "Dark",
    mode: "minor",
    chords: [c(0, "triad"), c(4, "triad"), c(0, "triad"), c(5, "triad")],
  },
  {
    id: "harmonic",
    group: "Tense",
    mode: "minor",
    chords: [c(0), c(5), c(2), c(4, "seventh", "major")],
  },
  {
    id: "pull",
    group: "Tense",
    mode: "minor",
    chords: [c(0), c(3), c(4, "seventh", "major"), c(0)],
  },
  {
    id: "edge",
    group: "Tense",
    mode: "minor",
    chords: [c(0), c(1), c(4, "seventh", "major"), c(0, "sus4")],
  },
  {
    id: "suspense",
    group: "Tense",
    mode: "minor",
    chords: [c(0, "sus4"), c(0, "triad"), c(5, "sus2"), c(6, "sus4")],
  },
  // Major
  {
    id: "axis",
    group: "Uplifting",
    mode: "major",
    chords: [c(0, "add9"), c(4, "triad"), c(5), c(3, "add9")],
  },
  {
    id: "summit",
    group: "Uplifting",
    mode: "major",
    chords: [c(3, "add9"), c(0, "triad"), c(4, "triad"), c(5)],
  },
  {
    id: "victory",
    group: "Uplifting",
    mode: "major",
    chords: [
      c(0, "triad"),
      c(5, "triad", "minor"),
      c(6, "triad", "minor"),
      c(0, "add9"),
    ],
  },
  {
    id: "minor-four",
    group: "Melancholy",
    mode: "major",
    chords: [c(0), c(3), c(3, "seventh", "minor"), c(0)],
  },
  {
    id: "nostalgia",
    group: "Melancholy",
    mode: "major",
    chords: [c(0), c(2), c(5), c(3)],
  },
  {
    id: "reflect",
    group: "Melancholy",
    mode: "major",
    chords: [c(5), c(2), c(3), c(0)],
  },
  {
    id: "deceptive",
    group: "Melancholy",
    mode: "major",
    chords: [c(0, "add9"), c(3), c(4, "sus4"), c(5)],
  },
  {
    id: "royal",
    group: "Dreamy",
    mode: "major",
    chords: [c(3), c(4), c(2), c(5)],
  },
  {
    id: "major-nines",
    group: "Dreamy",
    mode: "major",
    chords: [c(0, "ninth"), c(3, "ninth"), c(0, "ninth"), c(3, "ninth")],
  },
  {
    id: "open-sky",
    group: "Dreamy",
    mode: "major",
    chords: [c(0, "sus2"), c(3, "sus2"), c(5, "add9"), c(4, "sus4")],
  },
  {
    id: "two-five",
    group: "Deep",
    mode: "major",
    chords: [c(1, "ninth"), c(4, "ninth"), c(0, "ninth"), c(5, "ninth")],
  },
  {
    id: "stepdown",
    group: "Deep",
    mode: "major",
    chords: [c(3, "ninth"), c(2), c(1, "ninth"), c(0, "ninth")],
  },
  {
    id: "flat-seven",
    group: "Driving",
    mode: "major",
    chords: [
      c(0, "triad"),
      c(6, "triad", "minor"),
      c(3, "triad"),
      c(0, "triad"),
    ],
  },
  {
    id: "six-four",
    group: "Driving",
    mode: "major",
    chords: [c(5), c(3, "add9"), c(5), c(3, "add9")],
  },
  {
    id: "borrowed-dark",
    group: "Tense",
    mode: "major",
    chords: [
      c(0),
      c(5, "seventh", "minor"),
      c(3, "seventh", "minor"),
      c(4, "sus4"),
    ],
  },
  {
    id: "eclipse",
    group: "Dark",
    mode: "major",
    chords: [
      c(5, "triad"),
      c(5, "triad", "minor"),
      c(6, "triad", "minor"),
      c(5, "triad"),
    ],
  },
  // Dorian
  {
    id: "dorian-two",
    group: "Deep",
    mode: "dorian",
    chords: [c(0, "ninth"), c(4, "ninth"), c(0, "ninth"), c(4, "ninth")],
  },
  {
    id: "dorian-nines",
    group: "Deep",
    mode: "dorian",
    chords: [c(0, "ninth"), c(3, "ninth"), c(0, "ninth"), c(3, "ninth")],
  },
  {
    id: "dorian-drive",
    group: "Driving",
    mode: "dorian",
    chords: [c(0), c(3, "triad"), c(6, "triad"), c(0)],
  },
  {
    id: "dorian-steps",
    group: "Dreamy",
    mode: "dorian",
    chords: [c(0, "ninth"), c(1), c(2), c(3)],
  },
  {
    id: "dorian-lift",
    group: "Uplifting",
    mode: "dorian",
    chords: [c(0), c(2, "add9"), c(6, "triad"), c(3, "triad")],
  },
  {
    id: "dorian-sigh",
    group: "Melancholy",
    mode: "dorian",
    chords: [c(0), c(4), c(3), c(0, "sus2")],
  },
  // Phrygian
  {
    id: "phrygian-vamp",
    group: "Dark",
    mode: "phrygian",
    chords: [c(0, "triad"), c(1, "triad"), c(0, "triad"), c(1, "triad")],
  },
  {
    id: "phrygian-fall",
    group: "Dark",
    mode: "phrygian",
    chords: [c(0), c(6), c(5), c(1)],
  },
  {
    id: "phrygian-pull",
    group: "Tense",
    mode: "phrygian",
    chords: [c(0, "triad"), c(1), c(2, "triad"), c(1)],
  },
  {
    id: "phrygian-power",
    group: "Driving",
    mode: "phrygian",
    chords: [c(0, "power"), c(1, "power"), c(0, "power"), c(5, "power")],
  },
  {
    id: "phrygian-glow",
    group: "Dreamy",
    mode: "phrygian",
    chords: [c(0), c(5, "ninth"), c(1, "ninth"), c(0)],
  },
];

export function progressionScaleDegrees(scale: MusicalScale): number[] {
  return scaleNotes(scale, 48 + scale.root, 59 + scale.root);
}
export function retuneProgression(
  track: Progression,
  scale: MusicalScale,
): Progression {
  const count = progressionScaleDegrees(scale).length;
  return {
    ...track,
    chords: track.chords.map((chord) => ({
      ...chord,
      degree: chord.degree % count,
    })),
  };
}
export function progressionChordAtStep(
  track: Progression,
  absoluteStep: number,
): number {
  if (!Number.isFinite(absoluteStep) || absoluteStep < 0) return -1;
  return progressionChordAtTick(track, absoluteStep * 6);
}

/** Stacked qualities count scale steps; the others are exact semitone shapes. */
const CHORD_SHAPES: Record<
  ChordQuality,
  { stacked: boolean; steps: readonly number[] }
> = {
  triad: { stacked: true, steps: [0, 2, 4] },
  seventh: { stacked: true, steps: [0, 2, 4, 6] },
  ninth: { stacked: true, steps: [0, 2, 4, 6, 8] },
  add9: { stacked: true, steps: [0, 2, 4, 8] },
  sus2: { stacked: false, steps: [0, 2, 7] },
  sus4: { stacked: false, steps: [0, 5, 7] },
  power: { stacked: false, steps: [0, 7, 12] },
};
/** The scale a chord is built from: the project scale or the borrowed parallel mode. */
export function progressionChordScale(
  chord: ProgressionChord,
  scale: MusicalScale,
): MusicalScale {
  return chord.borrow && scale.mode !== "pentatonic"
    ? { root: scale.root, mode: chord.borrow }
    : scale;
}
/** The named root in the octave above C3; undefined only for an empty scale. */
export function chordRootNote(
  chord: ProgressionChord,
  scale: MusicalScale,
): number | undefined {
  const degrees = progressionScaleDegrees(progressionChordScale(chord, scale));
  return degrees[chord.degree % degrees.length];
}
/** How many inversions the chord's shape distinguishes (Power has none). */
export function chordInversionCount(chord: ProgressionChord): number {
  const quality = chord.quality ?? "seventh";
  return quality === "power"
    ? 1
    : Math.min(4, CHORD_SHAPES[quality].steps.length);
}
export function chordNotes(
  chord: ProgressionChord,
  scale: MusicalScale,
): number[] {
  const degrees = progressionScaleDegrees(progressionChordScale(chord, scale));
  const root = chord.degree % degrees.length;
  const shape = CHORD_SHAPES[chord.quality ?? "seventh"];
  const base = degrees[root] ?? 48 + scale.root;
  const notes = shape.steps.map((step) => {
    if (!shape.stacked) return base + step;
    const degree = root + step;
    return (
      (degrees[degree % degrees.length] ?? 48 + scale.root) +
      12 * Math.floor(degree / degrees.length)
    );
  });
  const inversions = chord.inversion % chordInversionCount(chord);
  for (let index = 0; index < inversions; index++) {
    const first = notes.shift();
    if (first !== undefined) {
      let raised = first + 12;
      while (raised <= (notes.at(-1) ?? first)) raised += 12;
      notes.push(raised);
    }
  }
  // Keep inversions in the pad register while preserving every chord tone.
  while ((notes.at(-1) ?? 0) > 83)
    for (let index = 0; index < notes.length; index++)
      notes[index] = (notes[index] ?? 60) - 12;
  return notes;
}
export function progressionChordNotes(
  track: Progression,
  scale: MusicalScale,
  slot: number,
): number[] {
  const chord = track.chords[slot];
  return chord ? chordNotes(chord, scale) : [];
}
/** Root-position intervals above the root, in semitones within one octave. */
function stackedIntervals(chord: ProgressionChord, scale: MusicalScale) {
  const notes = chordNotes({ ...chord, inversion: 0, quality: "ninth" }, scale);
  const base = notes[0] ?? 0;
  const interval = (index: number) => ((notes[index] ?? base) - base) % 12;
  return {
    third: interval(1),
    fifth: interval(2),
    seventh: interval(3),
    ninth: interval(4),
  };
}
function pitchName(note: number): string {
  return noteName(note).replace(/-?\d+$/, "");
}
/** Sharps as elsewhere, except a root lowered by borrowing is spelled as a flat (A♭, B♭). */
function rootName(
  chord: ProgressionChord,
  scale: MusicalScale,
  root: number,
): string {
  const diatonic =
    progressionScaleDegrees(scale)[
      chord.degree % progressionScaleDegrees(scale).length
    ];
  if (diatonic !== undefined && root < diatonic) {
    const letter = pitchName(diatonic);
    if (letter.length === 1) return `${letter}♭`;
  }
  return pitchName(root);
}
export function chordLabel(
  chord: ProgressionChord,
  scale: MusicalScale,
): string {
  const root = chordRootNote(chord, scale);
  if (root === undefined) return "Rest";
  const name = rootName(chord, scale, root);
  const quality = chord.quality ?? "seventh";
  if (quality === "sus2" || quality === "sus4") return `${name}${quality}`;
  if (quality === "power") return `${name}5`;
  if (scale.mode === "pentatonic") return `${name} cluster`;
  const { third, fifth, seventh, ninth } = stackedIntervals(chord, scale);
  const triad = fifth === 6 ? "dim" : third === 3 ? "m" : "";
  const sevenths =
    fifth === 6 ? "m7♭5" : third === 3 ? "m7" : seventh === 11 ? "maj7" : "7";
  if (quality === "triad") return `${name}${triad}`;
  if (quality === "add9")
    return `${name}${triad}add${ninth === 1 ? "♭9" : "9"}`;
  if (quality === "ninth")
    return `${name}${ninth === 1 ? `${sevenths}♭9` : sevenths.replace("7", "9")}`;
  return `${name}${sevenths}`;
}
export function progressionChordLabel(
  track: Progression,
  scale: MusicalScale,
  slot: number,
): string {
  const chord = track.chords[slot];
  return chord ? chordLabel(chord, scale) : "Rest";
}
const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];
/** Roman numeral against the project scale: case shows minor, ♭/♯ a borrowed root. */
export function chordNumeral(
  chord: ProgressionChord,
  scale: MusicalScale,
): string {
  const degrees = progressionScaleDegrees(scale);
  const degree = chord.degree % degrees.length;
  const numeral = NUMERALS[degree] ?? "I";
  const quality = chord.quality ?? "seventh";
  if (scale.mode === "pentatonic") return numeral;
  const offset = (chordRootNote(chord, scale) ?? 0) - (degrees[degree] ?? 0);
  const accidental = offset < 0 ? "♭" : offset > 0 ? "♯" : "";
  if (!CHORD_SHAPES[quality].stacked) return `${accidental}${numeral}`;
  const { third, fifth } = stackedIntervals(chord, scale);
  return `${accidental}${third === 3 ? numeral.toLowerCase() : numeral}${fifth === 6 ? "°" : ""}`;
}

export interface PreviewChord {
  notes: number[];
  /** The named root between C2 and B2, played underneath the voicing. */
  bass: number;
}
export function chordPreview(
  chord: ProgressionChord,
  scale: MusicalScale,
): PreviewChord {
  const root = chordRootNote(chord, scale) ?? 48 + scale.root;
  return { notes: chordNotes(chord, scale), bass: 36 + (root % 12) };
}

function sameNotes(first: readonly number[], second: readonly number[]) {
  return (
    first.length === second.length &&
    first.every((note, index) => note === second[index])
  );
}
function mean(notes: readonly number[]): number {
  return notes.reduce((sum, note) => sum + note, 0) / Math.max(1, notes.length);
}
function voiceDistance(from: readonly number[], to: readonly number[]) {
  if (from.length !== to.length)
    return Math.abs(mean(from) - mean(to)) * Math.max(from.length, to.length);
  return to.reduce(
    (sum, note, index) => sum + Math.abs(note - (from[index] ?? note)),
    0,
  );
}
/** The library entry as stored chords for this scale; borrowing only where it changes notes. */
export function progressionEntryChords(
  entry: ChordProgressionEntry,
  scale: MusicalScale,
): ProgressionChord[] {
  const count = progressionScaleDegrees(scale).length;
  const chords = entry.chords.map((source) => {
    const chord: ProgressionChord = {
      degree: source.degree % count,
      inversion: 0,
    };
    if (source.quality && source.quality !== "seventh")
      chord.quality = source.quality;
    if (source.borrow && scale.mode !== "pentatonic") {
      const borrowed = { ...chord, borrow: source.borrow };
      if (!sameNotes(chordNotes(borrowed, scale), chordNotes(chord, scale)))
        chord.borrow = source.borrow;
    }
    return chord;
  });
  let previous: number[] | null = null;
  // A repeated chord keeps its first voicing, so vamps alternate two shapes.
  const voiced = new Map<string, number>();
  chords.forEach((chord, index) => {
    const fixed = entry.inversions?.[index];
    const key = `${chord.degree}:${chord.quality ?? ""}:${chord.borrow ?? ""}`;
    const repeated = voiced.get(key);
    if (fixed !== undefined) chord.inversion = fixed;
    else if (repeated !== undefined) chord.inversion = repeated;
    else {
      let best = 0,
        score = Infinity;
      // The first chord starts in root position; later chords move least, then stay compact.
      const count = previous ? chordInversionCount(chord) : 1;
      for (let inversion = 0; inversion < count; inversion++) {
        const notes = chordNotes({ ...chord, inversion }, scale);
        const distance = previous
          ? voiceDistance(previous, notes) +
            ((notes.at(-1) ?? 0) - (notes[0] ?? 0)) * 0.1
          : 0;
        if (distance < score - 1e-9) {
          best = inversion;
          score = distance;
        }
      }
      chord.inversion = best;
    }
    if (!voiced.has(key)) voiced.set(key, chord.inversion);
    previous = chordNotes(chord, scale);
  });
  return chords;
}
/** Whether the entry sounds as written in this scale (Pentatonic lists every entry). */
export function progressionFitsScale(
  entry: ChordProgressionEntry,
  mode: MusicalScale["mode"],
): boolean {
  if (mode === entry.mode || mode === "pentatonic") return true;
  const home = { root: 0, mode: entry.mode },
    other = { root: 0, mode };
  const written = progressionEntryChords(entry, home),
    played = progressionEntryChords(entry, other);
  return written.every((chord, index) => {
    const candidate = played[index];
    return (
      candidate !== undefined &&
      sameNotes(
        chordNotes({ ...chord, inversion: 0 }, home),
        chordNotes({ ...candidate, inversion: 0 }, other),
      )
    );
  });
}
/** True when the chords match the entry, ignoring inversions. */
export function progressionMatches(
  entry: ChordProgressionEntry,
  track: Progression,
  scale: MusicalScale,
): boolean {
  const chords = progressionEntryChords(entry, scale);
  return (
    chords.length === track.chords.length &&
    chords.every((chord, index) => {
      const current = track.chords[index];
      return (
        current !== undefined &&
        sameNotes(
          chordNotes({ ...chord, inversion: 0 }, scale),
          chordNotes({ ...current, inversion: 0 }, scale),
        )
      );
    })
  );
}
export function applyProgression(
  track: Progression,
  id: string,
  scale: MusicalScale,
): boolean {
  const entry = CHORD_PROGRESSIONS.find((item) => item.id === id);
  if (!entry) return false;
  track.chords = progressionEntryChords(entry, scale);
  return true;
}

export function progressionChordBounds(
  track: Progression,
  absoluteTick: number,
  swing = 0,
): { slot: number; startTick: number; endTick: number } {
  const logical = Math.max(
    0,
    unswungTick(absoluteTick, swing, track.timing.grid),
  );
  const span = trackCycleTicks(track.timing) / 4;
  const chord = Math.floor(logical / span + 1e-9);
  return {
    slot: chord % 4,
    startTick: swungTick(chord * span, swing, track.timing.grid),
    endTick: swungTick((chord + 1) * span, swing, track.timing.grid),
  };
}
export function progressionChordAtTick(
  track: Progression,
  absoluteTick: number,
  swing = 0,
): number {
  if (!Number.isFinite(absoluteTick) || absoluteTick < 0) return -1;
  return progressionChordBounds(track, absoluteTick, swing).slot;
}
