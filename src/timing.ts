import { z } from "zod";

export const PPQ = 24;
export const MAX_TRACK_STEPS = 480;
export const MAX_PROJECT_BYTES = 1024 * 1024;
export const meterSchema = z.enum(["4/4", "3/4", "5/4", "6/8", "7/8"]);
export const gridSchema = z.enum(["straight", "triplet"]);
const barsSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(4),
  z.literal(8),
  z.literal(16),
]);
export const automationBarsSchema = barsSchema.nullable().default(null);
export type AutomationBars = z.infer<typeof automationBarsSchema>;

export const timingSchema = z.object({
  bars: barsSchema,
  meter: meterSchema,
  grid: gridSchema,
});
export const sequenceTimingSchema = timingSchema.extend({
  bars: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)]),
});
export const padTimingSchema = timingSchema.extend({
  bars: z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)]),
});
export type Timing = z.infer<typeof timingSchema>;
export type SequenceTiming = z.infer<typeof sequenceTimingSchema>;
export type PadTiming = z.infer<typeof padTimingSchema>;
export interface AutomationTimingTrack {
  timing: Timing;
  automationBars: AutomationBars;
}
/** Curves share the sequence meter and grid, with an optional independent bar count. */
export function automationTiming(track: AutomationTimingTrack): Timing {
  return { ...track.timing, bars: track.automationBars ?? track.timing.bars };
}
export function automationStepCount(track: AutomationTimingTrack): number {
  return trackStepCount(automationTiming(track));
}
/** Accept an unwrapped logical grid position; only the automation loop wraps here. */
export function automationStepPosition(
  track: AutomationTimingTrack,
  absoluteStep: number,
): number {
  return Number.isFinite(absoluteStep) && absoluteStep >= 0
    ? absoluteStep % automationStepCount(track)
    : -1;
}
export function automationPosition(
  track: AutomationTimingTrack,
  absoluteTick: number,
  swing = 0,
): TrackPosition {
  return trackPosition(automationTiming(track), absoluteTick, swing);
}

export interface TrackPage {
  start: number;
  count: number;
  bar: number;
  pageInBar: number;
}
export interface TrackPosition {
  index: number;
  bar: number;
  stepInBar: number;
  page: number;
  column: number;
  phase: number;
}

export function createTiming(): SequenceTiming {
  return { bars: 1, meter: "4/4", grid: "straight" };
}
export function createPadTiming(): PadTiming {
  return { bars: 8, meter: "4/4", grid: "straight" };
}
export function ticksPerBar(timing: Timing): number {
  if (timing.meter === "3/4" || timing.meter === "6/8") return 72;
  if (timing.meter === "5/4") return 120;
  if (timing.meter === "7/8") return 84;
  return 96;
}
export function ticksPerStep(timing: Timing): number {
  return timing.grid === "triplet" ? 4 : 6;
}
export function stepsPerBar(timing: Timing): number {
  return ticksPerBar(timing) / ticksPerStep(timing);
}
export function trackStepCount(timing: Timing): number {
  return stepsPerBar(timing) * timing.bars;
}
export function trackCycleTicks(timing: Timing): number {
  return ticksPerBar(timing) * timing.bars;
}
export function trackPages(timing: Timing): TrackPage[] {
  const perBar = stepsPerBar(timing),
    width = timing.grid === "triplet" ? 12 : 16;
  const pages: TrackPage[] = [];
  for (let bar = 0; bar < timing.bars; bar++)
    for (let offset = 0; offset < perBar; offset += width)
      pages.push({
        start: bar * perBar + offset,
        count: Math.min(width, perBar - offset),
        bar,
        pageInBar: Math.floor(offset / width),
      });
  return pages;
}
/** Convert a logical note position to the audible clock; whole eighths retain their duration. */
export function swungTick(
  tick: number,
  swing: number,
  grid: Timing["grid"],
): number {
  if (grid === "triplet") return tick;
  const amount = Math.max(0, Math.min(0.5, swing));
  const pair = Math.floor(tick / 12),
    phase = tick - pair * 12;
  return (
    pair * 12 +
    (phase <= 6
      ? phase * (1 + amount)
      : 6 * (1 + amount) + (phase - 6) * (1 - amount))
  );
}
export function unswungTick(
  tick: number,
  swing: number,
  grid: Timing["grid"],
): number {
  if (grid === "triplet") return tick;
  const amount = Math.max(0, Math.min(0.5, swing));
  const pair = Math.floor(tick / 12),
    phase = tick - pair * 12,
    split = 6 * (1 + amount);
  return (
    pair * 12 +
    (phase <= split ? phase / (1 + amount) : 6 + (phase - split) / (1 - amount))
  );
}
export function tickSeconds(tick: number, bpm: number): number {
  return (tick * 60) / (bpm * PPQ);
}
export function tickSpanSeconds(
  start: number,
  end: number,
  bpm: number,
  swing: number,
  grid: Timing["grid"],
): number {
  return tickSeconds(
    swungTick(end, swing, grid) - swungTick(start, swing, grid),
    bpm,
  );
}
export function trackPosition(
  timing: Timing,
  absoluteTick: number,
  swing = 0,
): TrackPosition {
  const logical = Math.max(0, unswungTick(absoluteTick, swing, timing.grid));
  const cell = logical / ticksPerStep(timing),
    whole = Math.floor(cell + 1e-9);
  const index = whole % trackStepCount(timing),
    perBar = stepsPerBar(timing);
  const bar = Math.floor(index / perBar),
    stepInBar = index % perBar;
  const width = timing.grid === "triplet" ? 12 : 16;
  return {
    index,
    bar,
    stepInBar,
    page: bar * Math.ceil(perBar / width) + Math.floor(stepInBar / width),
    column: stepInBar % width,
    phase: Math.max(0, Math.min(1, cell - whole)),
  };
}
export function nextTrackStepTick(timing: Timing, tick: number): number {
  return (Math.floor(tick / ticksPerStep(timing)) + 1) * ticksPerStep(timing);
}

/** Repeat existing bars; quantize active events by beat time when the grid changes. */
export function resizePattern<T>(
  values: readonly T[],
  previous: Timing,
  next: Timing,
  empty: (source: T | undefined) => T,
  active: (value: T) => boolean,
): T[] {
  const oldBar = stepsPerBar(previous),
    newBar = stepsPerBar(next);
  const output = Array.from({ length: trackStepCount(next) }, (_, index) => {
    const bar = Math.floor(index / newBar) % previous.bars;
    const source =
      bar * oldBar +
      Math.min(
        oldBar - 1,
        Math.floor(
          ((index % newBar) * ticksPerStep(next)) / ticksPerStep(previous),
        ),
      );
    return empty(values[source]);
  });
  for (let bar = 0; bar < next.bars; bar++) {
    const sourceBar = bar % previous.bars;
    for (let cell = 0; cell < oldBar; cell++) {
      const value = values[sourceBar * oldBar + cell];
      const target = Math.round(
        (cell * ticksPerStep(previous)) / ticksPerStep(next),
      );
      if (value !== undefined && active(value) && target < newBar)
        output[bar * newBar + target] = structuredClone(value);
    }
  }
  return output;
}
export function resizeAutomationLane(
  lane: readonly number[] | null,
  previous: Timing,
  next: Timing,
  base: number,
): number[] | null {
  if (!lane) return null;
  const oldBar = stepsPerBar(previous),
    newBar = stepsPerBar(next);
  return Array.from({ length: trackStepCount(next) }, (_, index) => {
    const bar = Math.floor(index / newBar) % previous.bars;
    const position =
      ((index % newBar) * ticksPerStep(next)) / ticksPerStep(previous);
    if (position >= oldBar) return base;
    const cell = Math.floor(position),
      fraction = position - cell;
    const first = lane[bar * oldBar + cell] ?? base;
    const second = lane[bar * oldBar + Math.min(oldBar - 1, cell + 1)] ?? first;
    return first + (second - first) * fraction;
  });
}
export function resampleCycleLane(
  lane: readonly number[] | null,
  count: number,
): number[] | null {
  if (!lane) return null;
  return Array.from({ length: count }, (_, index) => {
    const position = (index * lane.length) / count,
      cell = Math.floor(position),
      fraction = position - cell;
    const first = lane[cell] ?? 0,
      next = lane[(cell + 1) % lane.length] ?? first;
    return first + (next - first) * fraction;
  });
}
