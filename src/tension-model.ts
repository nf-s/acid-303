import { z } from "zod";
import { automationLaneSchema, snapNote } from "./model";
import type { BassStep, MusicalScale } from "./model";
import {
  createTiming,
  timingSchema,
  trackStepCount,
  resizePattern,
  resizeAutomationLane,
} from "./timing";
import type { Timing } from "./timing";

export const TENSION_SOUNDS = [
  "Wire",
  "Sheet",
  "Wood",
  "Spring",
  "Ceramic",
  "Muted",
];
const tensionAutomationSchema = z.object({
  tension: z.lazy(() => automationLaneSchema),
  pick: z.lazy(() => automationLaneSchema),
  decay: z.lazy(() => automationLaneSchema),
  damping: z.lazy(() => automationLaneSchema),
  coupling: z.lazy(() => automationLaneSchema),
  drive: z.lazy(() => automationLaneSchema),
  width: z.lazy(() => automationLaneSchema),
  volume: z.lazy(() => automationLaneSchema),
});
export type TensionAutomation = z.infer<typeof tensionAutomationSchema>;
export type TensionParameter = keyof TensionAutomation;
export function emptyTensionAutomation(): TensionAutomation {
  return {
    tension: null,
    pick: null,
    decay: null,
    damping: null,
    coupling: null,
    drive: null,
    width: null,
    volume: null,
  };
}
export const tensionStepSchema = z.object({
  on: z.boolean(),
  note: z.number().int().min(36).max(84),
  velocity: z.number().min(0).max(1),
});
export type TensionStep = z.infer<typeof tensionStepSchema>;
export const tensionBaseSchema = z.object({
  timing: timingSchema.default(createTiming),
  sound: z
    .number()
    .int()
    .min(0)
    .max(TENSION_SOUNDS.length - 1)
    .default(2),
  seed: z.number().int().min(0).max(2147483647).default(63841),
  muted: z.boolean().default(true),
  steps: z
    .array(tensionStepSchema)
    .min(1)
    .max(480)
    .default(() =>
      Array.from({ length: 16 }, (_, index) => ({
        on: [0, 3, 6, 10, 14].includes(index),
        note: [57, 60, 64, 67][Math.floor(index / 4)] ?? 57,
        velocity: index % 4 === 0 ? 0.8 : 0.58,
      })),
    ),
  automation: tensionAutomationSchema.default(emptyTensionAutomation),
  tension: z.number().min(0).max(1).default(0.35),
  pick: z.number().min(0).max(1).default(0.28),
  decay: z.number().min(0).max(1).default(0.3),
  damping: z.number().min(0).max(1).default(0.62),
  coupling: z.number().min(0).max(1).default(0.15),
  drive: z.number().min(0).max(1).default(0.08),
  width: z.number().min(0).max(1).default(0.35),
  volume: z.number().min(0).max(1).default(0.35),
});
export const tensionSchema = tensionBaseSchema.superRefine((track, context) => {
  const count = trackStepCount(track.timing);
  if (
    track.steps.length !== count ||
    Object.values(track.automation).some(
      (lane) => lane !== null && lane.length !== count,
    )
  )
    context.addIssue({
      code: "custom",
      message: "Tension arrays must match its timing",
    });
});
export type TensionTrack = z.infer<typeof tensionSchema>;
export function createTension(): TensionTrack {
  return tensionSchema.parse({});
}
export function normalizedTensionValue(
  track: TensionTrack,
  parameter: TensionParameter,
): number {
  return track[parameter];
}
export function tensionValueFromNormalized(
  _parameter: TensionParameter,
  value: number,
): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
export function automatedTension(
  track: TensionTrack,
  absoluteStep: number,
): TensionTrack {
  const resolved = { ...track };
  if (!Number.isFinite(absoluteStep) || absoluteStep < 0) return resolved;
  const index = Math.floor(absoluteStep) % trackStepCount(track.timing);
  for (const parameter of tensionAutomationSchema.keyof().options) {
    const value = track.automation[parameter]?.[index];
    if (value !== undefined) resolved[parameter] = value;
  }
  return resolved;
}
export function retuneTension(
  track: TensionTrack,
  scale: MusicalScale,
): TensionTrack {
  return {
    ...track,
    steps: track.steps.map((step) => ({
      ...step,
      note: snapNote(step.note, scale, 36, 84),
    })),
  };
}
export function tensionStepNotes(track: TensionTrack): BassStep[] {
  return track.steps.map((step) => ({
    note: step.note,
    on: step.on,
    accent: step.velocity >= 0.75,
    slide: false,
  }));
}
export function resizeTensionTrack(
  track: TensionTrack,
  timing: Timing,
): TensionTrack {
  const automation = { ...track.automation };
  for (const parameter of tensionAutomationSchema.keyof().options)
    automation[parameter] = resizeAutomationLane(
      track.automation[parameter],
      track.timing,
      timing,
      track[parameter],
    );
  return {
    ...track,
    timing: { ...timing },
    automation,
    steps: resizePattern(
      track.steps,
      track.timing,
      timing,
      (source) => ({
        note: source?.note ?? 57,
        on: false,
        velocity: source?.velocity ?? 0.7,
      }),
      (value) => value.on,
    ),
  };
}

export function tensionDecaySeconds(value: number): number {
  const x = tensionValueFromNormalized("decay", value);
  return 0.08 + 5.92 * x * x;
}
