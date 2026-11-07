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
export interface CloudPatch {
  readonly name: string;
  readonly sound: number;
  readonly values: Readonly<Record<CloudParameter, number>>;
}
export const CLOUD_PATCHES: ReadonlyArray<CloudPatch> = [
  {
    name: "Shuffle",
    sound: 0,
    values: {
      scan: 0.23,
      size: 0.34,
      density: 0.12,
      scatter: 0.07,
      roughness: 0.08,
      tone: 0.58,
      width: 0.24,
      volume: 0.36,
    },
  },
  {
    name: "Dust",
    sound: 1,
    values: {
      scan: 0.42,
      size: 0.23,
      density: 0.08,
      scatter: 0.1,
      roughness: 0.12,
      tone: 0.68,
      width: 0.18,
      volume: 0.34,
    },
  },
  {
    name: "Grind",
    sound: 2,
    values: {
      scan: 0.62,
      size: 0.38,
      density: 0.18,
      scatter: 0.04,
      roughness: 0.28,
      tone: 0.43,
      width: 0.12,
      volume: 0.3,
    },
  },
  {
    name: "Air",
    sound: 3,
    values: {
      scan: 0.31,
      size: 0.58,
      density: 0.38,
      scatter: 0.16,
      roughness: 0.02,
      tone: 0.35,
      width: 0.58,
      volume: 0.26,
    },
  },
  {
    name: "Pulse",
    sound: 4,
    values: {
      scan: 0.12,
      size: 0.52,
      density: 0.1,
      scatter: 0.01,
      roughness: 0.06,
      tone: 0.32,
      width: 0.08,
      volume: 0.32,
    },
  },
  {
    name: "Crunch",
    sound: 5,
    values: {
      scan: 0.47,
      size: 0.29,
      density: 0.16,
      scatter: 0.04,
      roughness: 0.34,
      tone: 0.39,
      width: 0.16,
      volume: 0.3,
    },
  },
];

/** Sound selection changes articulation, leaving the performance and mix intact. */
export function applyCloudPatch(track: CloudTrack, sound: number): CloudTrack {
  const patch = CLOUD_PATCHES.find((candidate) => candidate.sound === sound);
  return patch
    ? { ...track, ...patch.values, sound: patch.sound, volume: track.volume }
    : { ...track };
}
export function createCloud(): CloudTrack {
  const patch = CLOUD_PATCHES[0];
  return cloudSchema.parse({
    ...patch?.values,
    sound: patch?.sound ?? 0,
    steps: Array.from({ length: 16 }, (_, index) => ({
      on: [2, 6, 9, 14].includes(index),
      note: index === 9 ? 52 : 45,
      velocity: index === 9 ? 0.48 : index === 14 ? 0.68 : 0.76,
    })),
  });
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
