import { describe, expect, it } from "vitest";
import { createProject, noteName, projectSchema, stepDuration } from "./model";

describe("project boundary validation", () => {
  it("accepts all starter patterns", () => {
    for (let i = 0; i < 3; i++)
      expect(projectSchema.safeParse(createProject(i)).success).toBe(true);
  });
  it("rejects invalid saved timing, tracks and notes", () => {
    const project = createProject();
    expect(projectSchema.safeParse({ ...project, bpm: 0 }).success).toBe(false);
    expect(projectSchema.safeParse({ ...project, drums: [] }).success).toBe(
      false,
    );
    expect(
      projectSchema.safeParse({
        ...project,
        drums: Array.from({ length: 5 }, () => project.drums[0]),
      }).success,
    ).toBe(false);
    expect(
      projectSchema.safeParse({
        ...project,
        bass: {
          ...project.bass,
          steps: [{ note: 120, on: true, slide: false, accent: false }],
        },
      }).success,
    ).toBe(false);
  });
  it("does not share mutable patterns between presets", () => {
    const first = createProject();
    const second = createProject();
    const step = first.bass.steps[0];
    if (step) step.note = 60;
    expect(second.bass.steps[0]?.note).toBe(33);
  });
});
describe("sequencer timing", () => {
  it("keeps a swung pair and a complete bar at the same duration", () => {
    for (const swing of [0, 0.16, 0.5]) {
      expect(
        stepDuration(120, swing, 0) + stepDuration(120, swing, 1),
      ).toBeCloseTo(0.25);
      expect(
        Array.from({ length: 16 }, (_, i) =>
          stepDuration(120, swing, i),
        ).reduce((a, b) => a + b, 0),
      ).toBeCloseTo(2);
    }
  });
  it("names MIDI bass pitches correctly", () => {
    expect(noteName(33)).toBe("A1");
    expect(noteName(60)).toBe("C4");
    expect(noteName(24)).toBe("C1");
  });
});
