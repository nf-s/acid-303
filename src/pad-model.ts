import { z } from "zod";
import { noteName, scaleNotes } from "./model";
import type { MusicalScale } from "./model";

const unit = z.number().min(0).max(1);
export const padChordSchema = z.object({
  degree: z.number().int().min(0).max(6),
  inversion: z.number().int().min(0).max(3).default(0),
});
export const padSchema = z.object({
  sound: z.number().int().min(0).max(5).default(0),
  muted: z.boolean().default(true),
  bars: z
    .union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)])
    .default(8),
  chords: z
    .array(padChordSchema)
    .length(4)
    .default(() => [
      { degree: 0, inversion: 0 },
      { degree: 5, inversion: 1 },
      { degree: 2, inversion: 0 },
      { degree: 6, inversion: 1 },
    ]),
  attack: unit.default(0.35),
  release: unit.default(0.42),
  tone: unit.default(0.42),
  motion: unit.default(0.22),
  spread: unit.default(0.65),
  space: unit.default(0.35),
  shape: unit.default(0.4),
  volume: unit.default(0.28),
});
export type PadTrack = z.infer<typeof padSchema>;
export type PadChord = z.infer<typeof padChordSchema>;
export const PAD_SOUNDS = ["Velvet", "Air", "Choir", "Glass", "Dust", "Drone"];
export const PAD_PROGRESSIONS: ReadonlyArray<{
  id: string;
  name: string;
  degrees: readonly number[];
}> = [
  { id: "lift", name: "I · VI · III · VII", degrees: [0, 5, 2, 6] },
  { id: "return", name: "I · IV · VI · V", degrees: [0, 3, 5, 4] },
  { id: "descent", name: "I · VII · VI · V", degrees: [0, 6, 5, 4] },
  { id: "orbit", name: "I · III · IV · VI", degrees: [0, 2, 3, 5] },
  { id: "resolve", name: "II · V · I · VI", degrees: [1, 4, 0, 5] },
  { id: "suspended", name: "I · IV · I · VII", degrees: [0, 3, 0, 6] },
  { id: "rise", name: "VI · IV · I · V", degrees: [5, 3, 0, 4] },
  { id: "drift", name: "I · II · VI · IV", degrees: [0, 1, 5, 3] },
];

export function createPad(): PadTrack {
  return padSchema.parse({});
}
export function padScaleDegrees(scale: MusicalScale): number[] {
  return scaleNotes(scale, 48 + scale.root, 59 + scale.root);
}
export function retunePad(track: PadTrack, scale: MusicalScale): PadTrack {
  const count = padScaleDegrees(scale).length;
  return {
    ...track,
    chords: track.chords.map((chord) => ({
      ...chord,
      degree: chord.degree % count,
    })),
  };
}
export function padChordAtStep(track: PadTrack, absoluteStep: number): number {
  if (!Number.isFinite(absoluteStep) || absoluteStep < 0) return -1;
  return Math.floor(
    (Math.floor(absoluteStep) % (track.bars * 16)) / (track.bars * 4),
  );
}
export function padChordNotes(
  track: PadTrack,
  scale: MusicalScale,
  slot: number,
): number[] {
  const chord = track.chords[slot];
  if (!chord) return [];
  const degrees = padScaleDegrees(scale);
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
export function padChordLabel(
  track: PadTrack,
  scale: MusicalScale,
  slot: number,
): string {
  const chord = track.chords[slot];
  if (!chord) return "Rest";
  const root =
    padScaleDegrees(scale)[chord.degree % padScaleDegrees(scale).length];
  if (root === undefined) return "Rest";
  const notes = padChordNotes(
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
export function applyPadProgression(
  track: PadTrack,
  id: string,
  scale: MusicalScale,
): boolean {
  const progression = PAD_PROGRESSIONS.find((item) => item.id === id);
  if (!progression) return false;
  const count = padScaleDegrees(scale).length;
  track.chords = progression.degrees.map((degree, index) => ({
    degree: degree % count,
    inversion: index % 2,
  }));
  return true;
}
