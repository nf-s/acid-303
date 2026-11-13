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
    "gives %s an eight-bar bassline, a long chord loop and a kick",
    (id) => {
      const project = createFluffPreset(id);
      expect(project.bass.timing.bars).toBe(8);
      expect(project.bass.muted).toBe(false);
      expect(project.progression.timing.bars).toBeGreaterThanOrEqual(8);
      const kick = project.drums.find((track) => track.id === "kick");
      expect(kick?.muted).toBe(false);
      expect(kick?.steps.some(Boolean)).toBe(true);
    },
  );

  it.each(FLUFF_PRESETS.map((preset) => preset.id))(
    "keeps the %s bassline in the bass register",
    (id) => {
      const project = createFluffPreset(id);
      const notes = project.bass.steps
        .filter((step) => step.on)
        .map((step) => step.note);
      // C1 to E3: octave jumps allowed, but every line starts from the low end.
      expect(Math.min(...notes)).toBeGreaterThanOrEqual(24);
      expect(Math.max(...notes)).toBeLessThanOrEqual(52);
    },
  );
});
