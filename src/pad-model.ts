import { progressionChordSchema, retuneProgression } from "./progression-model";
export {
  CHORD_PROGRESSIONS as PAD_PROGRESSIONS,
  progressionScaleDegrees as padScaleDegrees,
  progressionChordAtStep as padChordAtStep,
  progressionChordNotes as padChordNotes,
  progressionChordLabel as padChordLabel,
  progressionChordBounds as padChordBounds,
  progressionChordAtTick as padChordAtTick,
  applyProgression as applyPadProgression,
} from "./progression-model";
import { z } from "zod";
import { projectModeSchema } from "./mode";
import type { AutomationBars } from "./timing";
import {
  createPadTiming,
  automationBarsSchema,
  automationTiming,
  automationStepCount,
  automationStepPosition,
  padTimingSchema,
  trackStepCount,
  resampleCycleLane,
  resizeAutomationLane,
} from "./timing";
import type { PadTiming } from "./timing";
import { automationLaneSchema } from "./model";
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
export { progressionChordSchema as padChordSchema } from "./progression-model";
export const padBaseSchema = z.object({
  timing: padTimingSchema.default(createPadTiming),
  automationBars: automationBarsSchema,
  followChords: z.boolean().default(true),
  automation: padAutomationSchema.default(emptyPadAutomation),
  sound: z
    .number()
    .int()
    .min(0)
    .max(PAD_SOUNDS.length - 1)
    .default(0),
  family: projectModeSchema.optional(),
  muted: z.boolean().default(true),
  chords: z
    .array(z.lazy(() => progressionChordSchema))
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
      (lane) => lane !== null && lane.length !== automationStepCount(track),
    )
  )
    context.addIssue({
      code: "custom",
      message: "Pad curves must match its timing",
    });
});
export type PadTrack = z.infer<typeof padSchema>;
export type { ProgressionChord as PadChord } from "./progression-model";

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
  const position = automationStepPosition(track, absoluteStep);
  const index = Math.floor(position);
  const fraction = position - index;
  for (const parameter of padAutomationSchema.keyof().options) {
    const lane = track.automation[parameter];
    const first = lane?.[index];
    const next = lane?.[(index + 1) % automationStepCount(track)];
    if (first !== undefined && next !== undefined)
      resolved[parameter] = first + (next - first) * fraction;
  }
  return resolved;
}
export function retunePad(track: PadTrack, scale: MusicalScale): PadTrack {
  return { ...track, ...retuneProgression(track, scale) };
}
export function resizePadTrack(track: PadTrack, timing: PadTiming): PadTrack {
  const automation = { ...track.automation };
  for (const parameter of padAutomationSchema.keyof().options)
    automation[parameter] =
      track.automationBars === null
        ? resampleCycleLane(track.automation[parameter], trackStepCount(timing))
        : resizeAutomationLane(
            track.automation[parameter],
            automationTiming(track),
            automationTiming({ ...track, timing }),
            track[parameter],
          );
  return { ...track, timing: { ...timing }, automation };
}

export function resizePadAutomation(
  track: PadTrack,
  automationBars: AutomationBars,
): PadTrack {
  const automation = { ...track.automation };
  for (const parameter of padAutomationSchema.keyof().options)
    automation[parameter] = resizeAutomationLane(
      track.automation[parameter],
      automationTiming(track),
      automationTiming({ ...track, automationBars }),
      track[parameter],
    );
  return { ...track, automationBars, automation };
}
