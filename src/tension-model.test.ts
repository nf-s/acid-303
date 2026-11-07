import { describe, expect, it } from "vitest";
import {
  tensionSchema,
  createTension,
  resizeTensionTrack,
  retuneTension,
  automatedTension,
  normalizedTensionValue,
  tensionValueFromNormalized,
  tensionStepNotes,
} from "./tension-model";
import type { TensionParameter } from "./tension-model";
import {
  createProject,
  readProject,
  withScale,
  playbackFrame,
  resolvedAutomationValue,
  exportPlan,
} from "./model";
import { trackStepCount } from "./timing";
const parameters: TensionParameter[] = [
  "tension",
  "pick",
  "decay",
  "damping",
  "coupling",
  "drive",
  "width",
  "volume",
];
describe("Tension model", () => {
  it("defaults to a muted scale-locked playable pattern with six valid profiles", () => {
    const track = createTension();
    expect(track.muted).toBe(true);
    expect(track.steps.some((step) => step.on)).toBe(true);
    expect(Object.keys(track.automation)).toHaveLength(8);
    for (let sound = 0; sound < 6; sound++)
      expect(tensionSchema.safeParse({ ...track, sound }).success).toBe(true);
    for (const invalid of [
      { ...track, sound: 6 },
      { ...track, seed: -1 },
      { ...track, steps: [{ on: true, note: 85, velocity: 1 }] },
      { ...track, steps: track.steps.slice(1) },
    ])
      expect(tensionSchema.safeParse(invalid).success).toBe(false);
  });
  it("resizes gates and curves by beat time through all 480 cells without mutating input", () => {
    const original = createTension();
    original.automation.volume = Array.from({ length: 16 }, (_, i) => i / 15);
    const before = structuredClone(original);
    const track = resizeTensionTrack(original, {
      bars: 16,
      meter: "5/4",
      grid: "triplet",
    });
    expect(track.steps).toHaveLength(480);
    expect(track.automation.volume).toHaveLength(480);
    expect(tensionSchema.safeParse(track).success).toBe(true);
    expect(original).toEqual(before);
    expect(track.steps[0]?.on).toBe(original.steps[0]?.on);
    expect(track.steps[30]?.on).toBe(original.steps[0]?.on);
    expect(
      tensionSchema.safeParse({
        ...track,
        automation: { ...track.automation, volume: [1] },
      }).success,
    ).toBe(false);
  });
  it("resolves every normalized lane, wraps positions and keeps base controls", () => {
    const track = createTension();
    for (const parameter of parameters)
      track.automation[parameter] = Array.from(
        { length: 16 },
        (_, i) => i / 15,
      );
    const before = structuredClone(track);
    for (const parameter of parameters) {
      expect(automatedTension(track, 17)[parameter]).toBeCloseTo(1 / 15);
      expect(normalizedTensionValue(track, parameter)).toBe(track[parameter]);
      expect(tensionValueFromNormalized(parameter, 2)).toBe(1);
      expect(tensionValueFromNormalized(parameter, NaN)).toBe(0);
    }
    expect(automatedTension(track, -1)).toEqual(track);
    expect(track).toEqual(before);
  });
  it("retunes pitches while preserving velocity and projection", () => {
    const track = createTension();
    track.steps[0] = { on: true, note: 61, velocity: 0.93 };
    const tuned = retuneTension(track, { root: 0, mode: "major" });
    expect(tuned.steps[0]).toEqual({ on: true, note: 60, velocity: 0.93 });
    expect(tensionStepNotes(tuned)[0]).toEqual({
      on: true,
      note: 60,
      accent: true,
      slide: false,
    });
    expect(track.steps[0]?.note).toBe(61);
  });
  it("participates in playback, global scale and bounded export only when enabled", () => {
    let project = createProject();
    const old = exportPlan(project);
    project.tension = resizeTensionTrack(project.tension, {
      bars: 16,
      meter: "5/4",
      grid: "triplet",
    });
    expect(exportPlan(project)).toEqual(old);
    project.tension.muted = false;
    project.tension.automation.volume = Array(
      trackStepCount(project.tension.timing),
    ).fill(0.23);
    expect(playbackFrame(project, 12).positions.tension?.index).toBe(3);
    expect(
      resolvedAutomationValue(
        project,
        { instrument: "tension", parameter: "volume" },
        12,
      ).value,
    ).toBe(0.23);
    expect(exportPlan(project).ticks).toBeGreaterThanOrEqual(1920);
    project = withScale(project, { root: 0, mode: "major" });
    expect(
      project.tension.steps.every((step) =>
        [0, 2, 4, 5, 7, 9, 11].includes(step.note % 12),
      ),
    ).toBe(true);
    expect(readProject(project)).toEqual(project);
  });
});
