import { z } from "zod";
import type { AutomationBars } from "./timing";
import { automationLaneSchema, snapNote } from "./model";
import type { BassStep, MusicalScale } from "./model";
import {
  createTiming,
  automationBarsSchema,
  automationTiming,
  automationStepCount,
  automationStepPosition,
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
  automationBars: automationBarsSchema,
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
      (lane) => lane !== null && lane.length !== automationStepCount(track),
    )
  )
    context.addIssue({
      code: "custom",
      message: "Tension arrays must match its timing",
    });
});
export type TensionTrack = z.infer<typeof tensionSchema>;
export interface TensionPatch {
  readonly name: string;
  readonly sound: number;
  readonly values: Readonly<Record<TensionParameter, number>>;
}
export const TENSION_PATCHES: ReadonlyArray<TensionPatch> = [
  {
    name: "Low tom",
    sound: 0,
    values: {
      tension: 0.04,
      pick: 0.42,
      decay: 0.18,
      damping: 0.88,
      coupling: 0,
      drive: 0.12,
      width: 0.1,
      volume: 0.38,
    },
  },
  {
    name: "Metal hit",
    sound: 1,
    values: {
      tension: 0.28,
      pick: 0.18,
      decay: 0.12,
      damping: 0.66,
      coupling: 0,
      drive: 0.2,
      width: 0.2,
      volume: 0.3,
    },
  },
  {
    name: "Dry rim",
    sound: 2,
    values: {
      tension: 0.08,
      pick: 0.82,
      decay: 0.06,
      damping: 0.84,
      coupling: 0,
      drive: 0.08,
      width: 0.08,
      volume: 0.32,
    },
  },
  {
    name: "Dub hit",
    sound: 3,
    values: {
      tension: 0.16,
      pick: 0.48,
      decay: 0.23,
      damping: 0.92,
      coupling: 0.04,
      drive: 0.1,
      width: 0.24,
      volume: 0.34,
    },
  },
  {
    name: "Clank",
    sound: 4,
    values: {
      tension: 0.48,
      pick: 0.12,
      decay: 0.12,
      damping: 0.62,
      coupling: 0,
      drive: 0.25,
      width: 0.18,
      volume: 0.28,
    },
  },
  {
    name: "Knock",
    sound: 5,
    values: {
      tension: 0.02,
      pick: 0.35,
      decay: 0.18,
      damping: 0.9,
      coupling: 0,
      drive: 0.12,
      width: 0.05,
      volume: 0.4,
    },
  },
];

/** Sound selection changes articulation, leaving the performance and mix intact. */
export function applyTensionPatch(
  track: TensionTrack,
  sound: number,
): TensionTrack {
  const patch = TENSION_PATCHES.find((candidate) => candidate.sound === sound);
  return patch
    ? { ...track, ...patch.values, sound: patch.sound, volume: track.volume }
    : { ...track };
}
export function createTension(): TensionTrack {
  const patch = TENSION_PATCHES[0];
  return tensionSchema.parse({
    ...patch?.values,
    sound: patch?.sound ?? 0,
    steps: Array.from({ length: 16 }, (_, index) => ({
      on: [3, 7, 10, 15].includes(index),
      note: index === 10 ? 52 : 45,
      velocity: index === 7 ? 0.52 : index === 15 ? 0.64 : 0.82,
    })),
  });
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
  const index = Math.floor(automationStepPosition(track, absoluteStep));
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
      automationTiming(track),
      automationTiming({ ...track, timing }),
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

export function resizeTensionAutomation(
  track: TensionTrack,
  automationBars: AutomationBars,
): TensionTrack {
  const automation = { ...track.automation };
  for (const parameter of tensionAutomationSchema.keyof().options)
    automation[parameter] = resizeAutomationLane(
      track.automation[parameter],
      automationTiming(track),
      automationTiming({ ...track, automationBars }),
      track[parameter],
    );
  return { ...track, automationBars, automation };
}
