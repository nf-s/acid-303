import { describe, expect, it } from "vitest";
import { PRESETS, createPreset } from "./presets";
import {
  DRUM_META,
  BASS_SOUNDS,
  KEYS_SOUNDS,
  projectSchema,
  scaleNotes,
  withScale,
} from "./model";

describe("genre examples", () => {
  it("provides ten distinct valid genre arrangements with authored movement and all instrument palettes", () => {
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
      "bass-house",
    ]);
    expect(new Set(PRESETS.map((preset) => preset.name)).size).toBe(10);
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
    ).toBe(10);
    expect(new Set(projects.map((project) => project.keys.sound)).size).toBe(6);
    expect(projects.map((project) => project.bass.sound)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 6,
    ]);
    expect(projects.map((project) => BASS_SOUNDS[project.bass.sound])).toEqual([
      "Round",
      "Knock",
      "Acid",
      "Drive",
      "Bloom",
      "Fog",
      "Rubber",
      "Reese",
      "Pressure",
      "Rubber",
    ]);
    for (const project of projects) {
      expect(
        project.bass.automation.cutoff &&
          new Set(project.bass.automation.cutoff).size > 1,
      ).toBe(true);
      expect(project.keys.automation.motion).toHaveLength(16);
      expect(
        project.drums.find((drum) => drum.id === "hat")?.automation.pan,
      ).toHaveLength(16);
      expect(project.arp.muted).toBe(false);
      expect(
        project.arp.notes.every((note) =>
          scaleNotes(project.scale, 48, 84).includes(note),
        ),
      ).toBe(true);
    }
    expect(new Set(projects.map((project) => project.arp.sound)).size).toBe(6);
    expect(
      new Set(
        projects
          .filter((project) => !project.pad.muted)
          .map((project) => project.pad.sound),
      ).size,
    ).toBe(6);
    expect(
      new Set(
        projects.map((project) =>
          JSON.stringify([
            project.arp.sound,
            project.arp.rate,
            project.arp.steps,
            project.pad.sound,
            project.pad.bars,
            project.pad.chords,
          ]),
        ),
      ).size,
    ).toBe(10);
    expect(
      createPreset("bass-house")
        .drums.find((drum) => drum.id === "kick")
        ?.steps.filter(Boolean),
    ).toHaveLength(4);
    expect(createPreset("bass-house").bass.drive).toBeGreaterThan(
      createPreset("house").bass.drive,
    );
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
    house.arp.notes[0] = 84;
    house.pad.chords[0] = { degree: 6, inversion: 3 };
    const cutoff = house.bass.automation.cutoff;
    if (cutoff) cutoff[0] = 1;
    const fresh = createPreset("house");
    expect(fresh.arp.notes[0]).not.toBe(84);
    expect(fresh.pad.chords[0]).not.toEqual({ degree: 6, inversion: 3 });
    expect(fresh.bass.automation.cutoff?.[0]).not.toBe(1);
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
