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

export const progressionChordSchema = z.object({
  degree: z.number().int().min(0).max(6),
  inversion: z.number().int().min(0).max(3).default(0),
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
export const CHORD_PROGRESSIONS: ReadonlyArray<{
  id: string;
  name: string;
  degrees: readonly number[];
  description: string;
}> = [
  {
    id: "lift",
    description: "A tonic opening, a warm lift, then a stepwise return.",
    name: "I · VI · III · VII",
    degrees: [0, 5, 2, 6],
  },
  {
    id: "return",
    description:
      "Moves away from the tonic, then builds tension on the dominant.",
    name: "I · IV · VI · V",
    degrees: [0, 3, 5, 4],
  },
  {
    id: "descent",
    description: "Descends through neighboring roots toward the dominant.",
    name: "I · VII · VI · V",
    degrees: [0, 6, 5, 4],
  },
  {
    id: "orbit",
    description: "An open cycle with gradual movement away from the tonic.",
    name: "I · III · IV · VI",
    degrees: [0, 2, 3, 5],
  },
  {
    id: "resolve",
    description: "A dominant-to-tonic resolution followed by a softer turn.",
    name: "II · V · I · VI",
    degrees: [1, 4, 0, 5],
  },
  {
    id: "suspended",
    description:
      "Alternates tonic and subdominant before a neighboring-root turn.",
    name: "I · IV · I · VII",
    degrees: [0, 3, 0, 6],
  },
  {
    id: "rise",
    description:
      "Starts away from the tonic and resolves through a rising cadence.",
    name: "VI · IV · I · V",
    degrees: [5, 3, 0, 4],
  },
  {
    id: "drift",
    description: "A close-root opening followed by wider harmonic movement.",
    name: "I · II · VI · IV",
    degrees: [0, 1, 5, 3],
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
export function progressionChordNotes(
  track: Progression,
  scale: MusicalScale,
  slot: number,
): number[] {
  const chord = track.chords[slot];
  if (!chord) return [];
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
  // Keep four-note inversions in the pad register while preserving every scale degree.
  while ((notes.at(-1) ?? 0) > 83)
    for (let index = 0; index < notes.length; index++)
      notes[index] = (notes[index] ?? 60) - 12;
  return notes;
}
export function progressionChordLabel(
  track: Progression,
  scale: MusicalScale,
  slot: number,
): string {
  const chord = track.chords[slot];
  if (!chord) return "Rest";
  const root =
    progressionScaleDegrees(scale)[
      chord.degree % progressionScaleDegrees(scale).length
    ];
  if (root === undefined) return "Rest";
  const notes = progressionChordNotes(
    { ...track, chords: [{ ...chord, inversion: 0 }] },
    scale,
    0,
  );
  const name = noteName(root).replace(/-?\d+$/, "");
  if (scale.mode === "pentatonic") return `${name} cluster`;
  const base = notes[0] ?? root;
  const third = ((notes[1] ?? base) - base) % 12;
  const fifth = ((notes[2] ?? base) - base) % 12;
  const seventh = ((notes[3] ?? base) - base) % 12;
  return `${name}${fifth === 6 ? "m7♭5" : third === 3 ? "m7" : seventh === 11 ? "maj7" : "7"}`;
}
export function applyProgression(
  track: Progression,
  id: string,
  scale: MusicalScale,
): boolean {
  const progression = CHORD_PROGRESSIONS.find((item) => item.id === id);
  if (!progression) return false;
  const count = progressionScaleDegrees(scale).length;
  track.chords = progression.degrees.map((degree, index) => ({
    degree: degree % count,
    inversion: index % 2,
  }));
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
