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

export const CLOUD_SOUNDS = [
  "Paper",
  "Sand",
  "Foil",
  "Water",
  "Magnet",
  "Circuit",
];
const cloudAutomationSchema = z.object({
  scan: z.lazy(() => automationLaneSchema),
  size: z.lazy(() => automationLaneSchema),
  density: z.lazy(() => automationLaneSchema),
  scatter: z.lazy(() => automationLaneSchema),
  roughness: z.lazy(() => automationLaneSchema),
  tone: z.lazy(() => automationLaneSchema),
  width: z.lazy(() => automationLaneSchema),
  volume: z.lazy(() => automationLaneSchema),
});
export type CloudAutomation = z.infer<typeof cloudAutomationSchema>;
export type CloudParameter = keyof CloudAutomation;
export function emptyCloudAutomation(): CloudAutomation {
  return {
    scan: null,
    size: null,
    density: null,
    scatter: null,
    roughness: null,
    tone: null,
    width: null,
    volume: null,
  };
}
export const cloudStepSchema = z.object({
  on: z.boolean(),
  note: z.number().int().min(36).max(84),
  velocity: z.number().min(0).max(1),
});
export type CloudStep = z.infer<typeof cloudStepSchema>;
export const cloudBaseSchema = z.object({
  timing: timingSchema.default(createTiming),
  sound: z
    .number()
    .int()
    .min(0)
    .max(CLOUD_SOUNDS.length - 1)
    .default(0),
  seed: z.number().int().min(0).max(2147483647).default(42791),
  muted: z.boolean().default(true),
  steps: z
    .array(cloudStepSchema)
    .min(1)
    .max(480)
    .default(() =>
      Array.from({ length: 16 }, (_, index) => ({
        on: [0, 1, 2, 6, 7, 10, 11].includes(index),
        note: [57, 60, 64, 67][Math.floor(index / 4)] ?? 57,
        velocity: index % 4 === 0 ? 0.8 : 0.58,
      })),
    ),
  automation: cloudAutomationSchema.default(emptyCloudAutomation),
  scan: z.number().min(0).max(1).default(0.35),
  size: z.number().min(0).max(1).default(0.52),
  density: z.number().min(0).max(1).default(0.42),
  scatter: z.number().min(0).max(1).default(0.24),
  roughness: z.number().min(0).max(1).default(0.16),
  tone: z.number().min(0).max(1).default(0.62),
  width: z.number().min(0).max(1).default(0.55),
  volume: z.number().min(0).max(1).default(0.32),
});
export const cloudSchema = cloudBaseSchema.superRefine((track, context) => {
  const count = trackStepCount(track.timing);
  if (
    track.steps.length !== count ||
    Object.values(track.automation).some(
      (lane) => lane !== null && lane.length !== count,
    )
  )
    context.addIssue({
      code: "custom",
      message: "Cloud arrays must match its timing",
    });
});
export type CloudTrack = z.infer<typeof cloudSchema>;
export function createCloud(): CloudTrack {
  return cloudSchema.parse({});
}
export function normalizedCloudValue(
  track: CloudTrack,
  parameter: CloudParameter,
): number {
  return track[parameter];
}
export function cloudValueFromNormalized(
  _parameter: CloudParameter,
  value: number,
): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
export function automatedCloud(
  track: CloudTrack,
  absoluteStep: number,
): CloudTrack {
  const resolved = { ...track };
  if (!Number.isFinite(absoluteStep) || absoluteStep < 0) return resolved;
  const index = Math.floor(absoluteStep) % trackStepCount(track.timing);
  for (const parameter of cloudAutomationSchema.keyof().options) {
    const value = track.automation[parameter]?.[index];
    if (value !== undefined) resolved[parameter] = value;
  }
  return resolved;
}
export function retuneCloud(
  track: CloudTrack,
  scale: MusicalScale,
): CloudTrack {
  return {
    ...track,
    steps: track.steps.map((step) => ({
      ...step,
      note: snapNote(step.note, scale, 36, 84),
    })),
  };
}
export function cloudStepNotes(track: CloudTrack): BassStep[] {
  return track.steps.map((step) => ({
    note: step.note,
    on: step.on,
    accent: step.velocity >= 0.75,
    slide: false,
  }));
}
export function resizeCloudTrack(
  track: CloudTrack,
  timing: Timing,
): CloudTrack {
  const automation = { ...track.automation };
  for (const parameter of cloudAutomationSchema.keyof().options)
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

export function cloudGrainSeconds(value: number): number {
  const x = cloudValueFromNormalized("size", value);
  return 0.008 + 0.172 * x * x;
}
export function cloudGrainsPerSecond(value: number): number {
  return 2 + 30 * cloudValueFromNormalized("density", value);
}
