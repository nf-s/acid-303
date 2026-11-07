import { describe, expect, it } from "vitest";
import { PRESETS, createPreset } from "./presets";
import {
  DRUM_META,
  KEYS_SOUNDS,
  projectSchema,
  scaleNotes,
  withScale,
} from "./model";

describe("genre examples", () => {
  it("provides nine distinct named, valid arrangements and uses every Texture voice", () => {
    expect(PRESETS.map((preset) => preset.id)).toEqual([
      "house",
      "tech-house",
      "techno",
      "driving-techno",
      "melodic-techno",
      "atmospheric-techno",
      "garage",
      "speed-garage",
      "jungle",
    ]);
    expect(new Set(PRESETS.map((preset) => preset.name)).size).toBe(9);
    const projects = PRESETS.map((preset) => createPreset(preset.id));
    for (const project of projects) {
      expect(projectSchema.safeParse(project).success).toBe(true);
      expect(project.drums.some((drum) => drum.steps.some(Boolean))).toBe(true);
      expect(project.bass.steps.some((step) => step.on)).toBe(true);
      expect(project.keys.steps.some((step) => step.on)).toBe(true);
      expect(
        project.bass.steps.every((step) =>
          scaleNotes(project.scale, 24, 60).includes(step.note),
        ),
      ).toBe(true);
      expect(
        project.keys.steps.every((step) =>
          scaleNotes(project.scale, 48, 84).includes(step.note),
        ),
      ).toBe(true);
      project.drums.forEach((drum) =>
        expect(DRUM_META[drum.id].sounds[drum.sound]).toBeDefined(),
      );
      expect(KEYS_SOUNDS[project.keys.sound]).toBeDefined();
    }
    expect(
      new Set(
        projects.map((project) =>
          JSON.stringify(project.drums.map((drum) => drum.steps)),
        ),
      ).size,
    ).toBe(9);
    expect(new Set(projects.map((project) => project.keys.sound)).size).toBe(6);
    expect(createPreset("jungle").bpm).toBeGreaterThan(
      createPreset("garage").bpm,
    );
    expect(createPreset("driving-techno").bpm).toBeGreaterThan(
      createPreset("melodic-techno").bpm,
    );
    expect(createPreset("garage").swing).toBeGreaterThan(
      createPreset("techno").swing,
    );
  });

  it("isolates edits and supports loading any genre into the user's selected scale", () => {
    const house = createPreset("house");
    const firstKick = house.drums.find((drum) => drum.id === "kick");
    if (!firstKick) throw new Error("House kick is missing.");
    firstKick.steps[0] = false;
    expect(
      createPreset("house").drums.find((drum) => drum.id === "kick")?.steps[0],
    ).toBe(true);
    for (const preset of PRESETS) {
      const original = createPreset(preset.id);
      const result = withScale(original, { root: 11, mode: "dorian" });
      expect(result.name).toBe(preset.name);
      expect(result.scale).toEqual({ root: 11, mode: "dorian" });
      expect(result.drums.map((drum) => drum.steps)).toEqual(
        original.drums.map((drum) => drum.steps),
      );
      expect(
        result.bass.steps.every((step) =>
          scaleNotes(result.scale, 24, 60).includes(step.note),
        ),
      ).toBe(true);
      expect(
        result.keys.steps.every((step) =>
          scaleNotes(result.scale, 48, 84).includes(step.note),
        ),
      ).toBe(true);
    }
    expect(createPreset("missing").name).toBe("Sunday Socks");
  });
});
