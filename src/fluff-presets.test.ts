import { describe, expect, it } from "vitest";
import { FLUFF_PRESETS, createFluffPreset } from "./fluff-presets";
import { projectSchema, scaleNotes } from "./model";
import { defaultPresetId, presetsForMode } from "./presets";

describe("Fluff examples", () => {
  it("offers twelve distinctly named genres with Cotton first", () => {
    expect(FLUFF_PRESETS).toHaveLength(12);
    expect(new Set(FLUFF_PRESETS.map((preset) => preset.name)).size).toBe(12);
    expect(new Set(FLUFF_PRESETS.map((preset) => preset.genre)).size).toBe(12);
    expect(defaultPresetId("fluff")).toBe("fluff-cotton");
    expect(presetsForMode("fluff").map((preset) => preset.id)).toEqual(
      FLUFF_PRESETS.map((preset) => preset.id),
    );
  });

  it.each(FLUFF_PRESETS.map((preset) => preset.id))(
    "builds %s as a valid Fluff project that stays in key",
    (id) => {
      const project = createFluffPreset(id);
      expect(projectSchema.safeParse(project).success).toBe(true);
      expect(project.mode).toBe("fluff");
      const allowed = new Set(
        scaleNotes(project.scale, 0, 127).map((note) => note % 12),
      );
      const played = [
        ...project.bass.steps.filter((step) => step.on),
        ...project.keys.steps.filter((step) => step.on),
        ...project.vocal.notes,
      ].map((step) => step.note % 12);
      expect(played.every((note) => allowed.has(note))).toBe(true);
    },
  );

  it.each(FLUFF_PRESETS.map((preset) => preset.id))(
    "gives %s a multi-bar bassline and chord loop",
    (id) => {
      const project = createFluffPreset(id);
      expect(project.bass.timing.bars).toBeGreaterThanOrEqual(4);
      expect(project.progression.timing.bars).toBeGreaterThanOrEqual(4);
      expect(project.drums.some((track) => track.steps.some(Boolean))).toBe(
        true,
      );
    },
  );
});
