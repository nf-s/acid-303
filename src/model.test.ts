import { describe, expect, it } from "vitest";
import {
  createProject,
  noteName,
  projectSchema,
  stepDuration,
  remixProject,
  readProject,
} from "./model";

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

describe("remix", () => {
  it("changes the sequence, keeps its downbeat and preserves sound settings", () => {
    const original = createProject();
    const kick = original.drums[0];
    if (!kick) throw new Error("Missing starter kick.");
    kick.pitch = 7;
    kick.decay = 0.5;
    const remixed = remixProject(original, () => 0.6);
    expect(projectSchema.safeParse(remixed).success).toBe(true);
    expect(remixed.drums[0]?.steps[0]).toBe(true);
    expect(remixed.drums[0]?.steps).not.toEqual(original.drums[0]?.steps);
    expect(remixed.drums[0]?.pitch).toBe(7);
    expect(remixed.drums[0]?.decay).toBe(0.5);
    expect(remixed.bpm).toBe(original.bpm);
    expect(remixed.bass.steps[0]?.on).toBe(true);
    expect(original.bass.steps[0]?.note).toBe(33);
  });
});

describe("saved project migration", () => {
  it("preserves v1 rhythm, pitch and expression while replacing the bell", () => {
    const original = createProject();
    const legacy = {
      version: 1,
      name: original.name,
      bpm: 139,
      swing: original.swing,
      drive: 0.28,
      volume: original.volume,
      drums: original.drums.map((track) => ({
        ...track,
        id: track.id === "rim" ? "cowbell" : track.id,
        pitch: track.id === "rim" ? -4 : track.pitch,
      })),
      bass: {
        ...original.bass,
        steps: original.bass.steps.map((step) => ({ ...step, slide: true })),
      },
    };
    const upgraded = readProject(legacy);
    expect(upgraded?.version).toBe(2);
    expect(upgraded?.bpm).toBe(139);
    expect(upgraded?.drums.find((track) => track.id === "rim")?.pitch).toBe(-4);
    expect(upgraded?.drums.map((track) => track.steps)).toEqual(
      original.drums.map((track) => track.steps),
    );
    expect(upgraded?.bass.steps).toEqual(
      original.bass.steps.map((step) => ({ ...step, slide: true })),
    );
    expect(upgraded?.drive).toBe(0.18);
    expect(upgraded?.keys.steps).toHaveLength(16);
    expect(upgraded && projectSchema.safeParse(upgraded).success).toBe(true);
  });
  it("rejects invalid legacy input and preserves current-version Keys settings", () => {
    expect(readProject({ version: 1, bpm: 0 })).toBeNull();
    const current = createProject();
    current.keys.tone = 0.82;
    expect(readProject(current)).toEqual(current);
    expect(
      projectSchema.safeParse({
        ...current,
        keys: { ...current.keys, volume: 7 },
      }).success,
    ).toBe(false);
  });
});

it("loads saved v2 notes without expression fields and rejects invalid expression values", () => {
  const project = createProject();
  const saved = {
    ...project,
    bass: {
      ...project.bass,
      steps: project.bass.steps.map(({ note, on, accent }) => ({
        note,
        on,
        accent,
      })),
    },
    keys: {
      ...project.keys,
      steps: project.keys.steps.map(({ note, on }) => ({ note, on })),
    },
  };
  expect(readProject(saved)).toEqual(project);
  expect(
    readProject({
      ...project,
      keys: {
        ...project.keys,
        steps: project.keys.steps.map((step) => ({ ...step, accent: "loud" })),
      },
    }),
  ).toBeNull();
});
