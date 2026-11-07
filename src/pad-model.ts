import { z } from "zod";
import {
  createPadTiming,
  padTimingSchema,
  trackStepCount,
  trackCycleTicks,
  unswungTick,
  swungTick,
  resampleCycleLane,
} from "./timing";
import type { PadTiming } from "./timing";
import { automationLaneSchema, noteName, scaleNotes } from "./model";
import type { MusicalScale } from "./model";

export const PAD_SOUNDS = [
  "Velvet",
  "Air",
  "Choir",
  "Glass",
  "Dust",
  "Drone",
  "Phase",
  "Rotor",
];

const unit = z.number().min(0).max(1);
const padAutomationSchema = z.object({
  attack: z.lazy(() => automationLaneSchema),
  release: z.lazy(() => automationLaneSchema),
  tone: z.lazy(() => automationLaneSchema),
  motion: z.lazy(() => automationLaneSchema),
  spread: z.lazy(() => automationLaneSchema),
  space: z.lazy(() => automationLaneSchema),
  shape: z.lazy(() => automationLaneSchema),
  volume: z.lazy(() => automationLaneSchema),
});
export type PadAutomation = z.infer<typeof padAutomationSchema>;
export type PadParameter = keyof PadAutomation;
export function emptyPadAutomation(): PadAutomation {
  return {
    attack: null,
    release: null,
    tone: null,
    motion: null,
    spread: null,
    space: null,
    shape: null,
    volume: null,
  };
}
export const padChordSchema = z.object({
  degree: z.number().int().min(0).max(6),
  inversion: z.number().int().min(0).max(3).default(0),
});
export const padBaseSchema = z.object({
  timing: padTimingSchema.default(createPadTiming),
  automation: padAutomationSchema.default(emptyPadAutomation),
  sound: z
    .number()
    .int()
    .min(0)
    .max(PAD_SOUNDS.length - 1)
    .default(0),
  muted: z.boolean().default(true),
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
export const padSchema = padBaseSchema.superRefine((track, context) => {
  if (
    Object.values(track.automation).some(
      (lane) => lane !== null && lane.length !== trackStepCount(track.timing),
    )
  )
    context.addIssue({
      code: "custom",
      message: "Pad curves must match its timing",
    });
});
export type PadTrack = z.infer<typeof padSchema>;
export type PadChord = z.infer<typeof padChordSchema>;

export const PAD_PROGRESSIONS: ReadonlyArray<{
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

export function createPad(): PadTrack {
  return padSchema.parse({});
}
export function normalizedPadValue(
  track: PadTrack,
  parameter: PadParameter,
): number {
  return track[parameter];
}
export function automatedPad(track: PadTrack, absoluteStep: number): PadTrack {
  const resolved = { ...track };
  if (!Number.isFinite(absoluteStep) || absoluteStep < 0) return resolved;
  const position = absoluteStep % trackStepCount(track.timing);
  const index = Math.floor(position);
  const fraction = position - index;
  for (const parameter of padAutomationSchema.keyof().options) {
    const lane = track.automation[parameter];
    const first = lane?.[index];
    const next = lane?.[(index + 1) % trackStepCount(track.timing)];
    if (first !== undefined && next !== undefined)
      resolved[parameter] = first + (next - first) * fraction;
  }
  return resolved;
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
  return padChordAtTick(track, absoluteStep * 6);
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

export function padChordBounds(
  track: PadTrack,
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
export function padChordAtTick(
  track: PadTrack,
  absoluteTick: number,
  swing = 0,
): number {
  if (!Number.isFinite(absoluteTick) || absoluteTick < 0) return -1;
  return padChordBounds(track, absoluteTick, swing).slot;
}
export function resizePadTrack(track: PadTrack, timing: PadTiming): PadTrack {
  const automation = { ...track.automation };
  for (const parameter of padAutomationSchema.keyof().options)
    automation[parameter] = resampleCycleLane(
      track.automation[parameter],
      trackStepCount(timing),
    );
  return { ...track, timing: { ...timing }, automation };
}
