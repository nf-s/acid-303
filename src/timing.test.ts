import { describe, expect, it } from "vitest";
import {
  createTiming,
  automationBarsSchema,
  automationTiming,
  automationPosition,
  automationStepPosition,
  stepsPerBar,
  swungTick,
  tickSpanSeconds,
  trackCycleTicks,
  trackPages,
  trackPosition,
  trackStepCount,
  unswungTick,
} from "./timing";
import type { Timing } from "./timing";

describe("independent musical timing", () => {
  it("separates meter from subdivision and bounds every supported track", () => {
    const meters: Timing["meter"][] = ["4/4", "3/4", "5/4", "6/8", "7/8"];
    expect(
      meters.map((meter) => stepsPerBar({ bars: 1, meter, grid: "straight" })),
    ).toEqual([16, 12, 20, 12, 14]);
    expect(
      meters.map((meter) => stepsPerBar({ bars: 1, meter, grid: "triplet" })),
    ).toEqual([24, 18, 30, 18, 21]);
    expect(trackStepCount({ bars: 16, meter: "5/4", grid: "triplet" })).toBe(
      480,
    );
  });
  it("pages within each bar without exceeding the drawing width", () => {
    expect(
      trackPages({ bars: 2, meter: "5/4", grid: "straight" }).map(
        ({ start, count, bar }) => [start, count, bar],
      ),
    ).toEqual([
      [0, 16, 0],
      [16, 4, 0],
      [20, 16, 1],
      [36, 4, 1],
    ]);
    expect(
      trackPages({ bars: 1, meter: "7/8", grid: "triplet" }).map(
        ({ count }) => count,
      ),
    ).toEqual([12, 9]);
  });
  it("preserves legacy swing while keeping true triplet grids even", () => {
    for (let step = 0; step < 128; step++)
      expect(
        tickSpanSeconds(step * 6, (step + 1) * 6, 123, 0.37, "straight"),
      ).toBeCloseTo((60 / 123 / 4) * (step % 2 ? 0.63 : 1.37), 12);
    for (let tick = 0; tick < 192; tick += 0.25)
      expect(
        unswungTick(swungTick(tick, 0.5, "straight"), 0.5, "straight"),
      ).toBeCloseTo(tick, 12);
    expect(tickSpanSeconds(4, 8, 120, 0.5, "triplet")).toBeCloseTo(1 / 12, 12);
  });
  it("resolves local pages and independent cycles from one audible clock", () => {
    const timing: Timing = { bars: 2, meter: "5/4", grid: "triplet" };
    expect(trackCycleTicks(timing)).toBe(240);
    expect(trackPosition(timing, 236)).toMatchObject({
      index: 59,
      bar: 1,
      stepInBar: 29,
      page: 5,
      column: 5,
    });
    expect(trackPosition(timing, 240).index).toBe(0);
    expect(trackPosition(createTiming(), 6, 0.5).index).toBe(0);
    expect(trackPosition(createTiming(), 9, 0.5).index).toBe(1);
  });
});

describe("independent automation timing", () => {
  it("follows sequence timing until a separate length is selected", () => {
    const timing = createTiming();
    expect(automationTiming({ timing, automationBars: null })).toEqual(timing);
    const track = { timing, automationBars: automationBarsSchema.parse(8) };
    expect(automationTiming(track)).toEqual({ ...timing, bars: 8 });
    expect(trackPosition(timing, 96).index).toBe(0);
    expect(automationPosition(track, 96).index).toBe(16);
    expect(automationStepPosition(track, 128)).toBe(0);
    expect(automationStepPosition(track, 16.5)).toBe(16.5);
    expect(automationStepPosition(track, NaN)).toBe(-1);
  });
  it("uses the same audible clock and swing while keeping independent phase", () => {
    const track = {
      timing: createTiming(),
      automationBars: automationBarsSchema.parse(8),
    };
    expect(automationPosition(track, 102, 0.5).index).toBe(16);
    expect(automationPosition(track, 105, 0.5).index).toBe(17);
    expect(
      automationPosition(
        { ...track, timing: { ...track.timing, grid: "triplet" } },
        100,
        0.5,
      ).index,
    ).toBe(25);
    for (const invalid of [0, 3, 32, -1])
      expect(automationBarsSchema.safeParse(invalid).success).toBe(false);
  });
});
