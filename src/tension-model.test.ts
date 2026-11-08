import { describe, expect, it } from "vitest";
import {
  tensionSchema,
  TENSION_PATCHES,
  TENSION_SOUNDS,
  applyTensionPatch,
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
  it("uses a short sparse root-and-fifth factory rhythm without changing legacy fallbacks", () => {
    const track = createTension();
    const notes = track.steps.filter((step) => step.on);
    expect(notes).toHaveLength(4);
    expect(new Set(notes.map((step) => step.note))).toEqual(new Set([45, 52]));
    expect(track.muted).toBe(true);
    expect(track.sound).toBe(0);
    expect(track.automation).toEqual(tensionSchema.parse({}).automation);
    expect(tensionSchema.parse({}).steps[0]?.note).toBe(57);
  });
  it("applies all six complete patches without erasing the sequence, mix or automation", () => {
    const track = resizeTensionTrack(createTension(), {
      bars: 2,
      meter: "3/4",
      grid: "triplet",
    });
    track.muted = false;
    track.seed = 123456;
    track.volume = 0.19;
    track.steps[0] = { on: true, note: 38, velocity: 0.31 };
    track.automation.volume = Array(track.steps.length).fill(0.25);
    track.automation.decay = Array.from(
      { length: track.steps.length },
      (_, index) => index / track.steps.length,
    );
    const before = structuredClone(track);
    expect(TENSION_PATCHES).toHaveLength(TENSION_SOUNDS.length);
    for (const patch of TENSION_PATCHES) {
      const applied = applyTensionPatch(track, patch.sound);
      expect(Object.keys(patch.values)).toHaveLength(8);
      expect(tensionSchema.safeParse(applied).success).toBe(true);
      expect(applied.sound).toBe(patch.sound);
      expect(applied.steps).toEqual(before.steps);
      expect(applied.timing).toEqual(before.timing);
      expect(applied.automation).toEqual(before.automation);
      expect(applied.seed).toBe(before.seed);
      expect(applied.muted).toBe(false);
      expect(applied.volume).toBe(0.19);
      expect(tensionSchema.parse(before)).toEqual(before);
    }
    for (const sound of [-1, 6, NaN, 1.5])
      expect(applyTensionPatch(track, sound)).toEqual(before);
    expect(track).toEqual(before);
  });

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

it("keeps tension automation independent of sequence repeats and resizes", async () => {
  const {
    createTension,
    resizeTensionAutomation,
    resizeTensionTrack,
    automatedTension,
  } = await import("./tension-model");
  const track = resizeTensionAutomation(createTension(), 16);
  track.automation.decay = Array.from(
    { length: 256 },
    (_, index) => index / 255,
  );
  const before = structuredClone(track);
  expect(automatedTension(track, 144).decay).toBe(144 / 255);
  expect(automatedTension(track, 256).decay).toBe(0);
  const next = resizeTensionTrack(track, { ...track.timing, bars: 2 });
  expect(next.automationBars).toBe(16);
  expect(next.automation.decay).toEqual(before.automation.decay);
  expect(track).toEqual(before);
});
