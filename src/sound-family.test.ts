import { describe, expect, it } from "vitest";
import {
  chooseSound,
  createProject,
  familyTracks,
  projectUsesFamily,
  readProject,
  trackFamily,
} from "./model";
import { createPreset, PRESETS } from "./presets";
import {
  applyProjectChanges,
  applySessionProjectChanges,
  diffProject,
} from "./session-protocol";
import { exportTailDuration } from "./audio";
import { FLUFF_HALL_SECONDS } from "./fluff-audio";
import { familySounds } from "./sound-family";
import type { SoundInstrument } from "./sound-family";

describe("per-track sound families", () => {
  it("follow the project's mode unless a track names another family", () => {
    const project = createProject();
    expect(trackFamily("grain", project.bass)).toBe("grain");
    expect(trackFamily("fluff", project.bass)).toBe("fluff");
    project.bass.family = "fluff";
    expect(trackFamily("grain", project.bass)).toBe("fluff");
    expect(trackFamily("fluff", project.bass)).toBe("fluff");
  });

  it("store a family only when it differs from the project's mode", () => {
    const project = createProject();
    chooseSound(project.keys, "grain", "fluff", 2);
    expect(project.keys).toMatchObject({ sound: 2, family: "fluff" });
    chooseSound(project.keys, "grain", "grain", 5);
    expect(project.keys.sound).toBe(5);
    expect(Object.hasOwn(project.keys, "family")).toBe(false);
    const expected = createProject();
    expected.keys.sound = 5;
    expect(JSON.stringify(project)).toBe(JSON.stringify(expected));
  });

  it("leave every bundled example and old save without a family", () => {
    for (const preset of PRESETS) {
      const project = createPreset(preset.id);
      expect(familyTracks(project).some((track) => "family" in track)).toBe(
        false,
      );
      expect(projectUsesFamily(project, project.mode)).toBe(true);
      expect(
        projectUsesFamily(
          project,
          project.mode === "grain" ? "fluff" : "grain",
        ),
      ).toBe(false);
      const reloaded = readProject(JSON.parse(JSON.stringify(project)));
      expect(reloaded).toEqual(project);
    }
  });

  it("round-trip through saves and reject unknown families", () => {
    const project = createProject();
    for (const drum of project.drums)
      if (drum.id === "kick") drum.family = "fluff";
    project.arp.family = "fluff";
    project.pad.family = "fluff";
    const reloaded = readProject(JSON.parse(JSON.stringify(project)));
    expect(reloaded?.drums[0]?.family).toBe("fluff");
    expect(reloaded?.arp.family).toBe("fluff");
    expect(reloaded?.pad.family).toBe("fluff");
    expect(reloaded?.bass.family).toBeUndefined();
    expect(projectUsesFamily(project, "fluff")).toBe(true);
    const invalid = JSON.parse(JSON.stringify(project));
    invalid.bass.family = "trance";
    expect(readProject(invalid)).toBeNull();
  });

  it("travel through session edits as whole-track replacements", () => {
    const before = createProject();
    const after = structuredClone(before);
    chooseSound(after.bass, "grain", "fluff", 4);
    const changes = diffProject(before, after);
    expect(changes).toEqual([{ path: ["bass"], value: after.bass }]);
    expect(applyProjectChanges(before, changes)?.bass.family).toBe("fluff");
    const back = diffProject(after, before);
    const restored = applyProjectChanges(after, back);
    expect(restored?.bass.family).toBeUndefined();
    expect(applySessionProjectChanges(before, changes, 7)?.bass.family).toBe(
      "fluff",
    );
  });

  it("name the same number of sounds in both families", () => {
    const instruments: SoundInstrument[] = [
      "kick",
      "snare",
      "hat",
      "clap",
      "rim",
      "bass",
      "keys",
      "arp",
      "pad",
    ];
    for (const instrument of instruments)
      expect(familySounds(instrument, "fluff")).toHaveLength(
        familySounds(instrument, "grain").length,
      );
  });

  it("size export tails by each track's own family", () => {
    const grain = createProject();
    const plain = exportTailDuration(grain);
    const mixed = structuredClone(grain);
    mixed.pad.family = "fluff";
    // Muted tracks still keep the hall reserved once a Fluff voice is in use.
    expect(exportTailDuration(mixed)).toBeCloseTo(
      plain + FLUFF_HALL_SECONDS * 0.75,
      6,
    );
    const fluff = structuredClone(grain);
    fluff.mode = "fluff";
    const grainKeys = structuredClone(fluff);
    grainKeys.keys.family = "grain";
    grainKeys.keys.decay = 2;
    fluff.keys.decay = 2;
    // A Fluff lead rings for about 3.4 times Decay; Grain Texture stops at Decay.
    expect(exportTailDuration(grainKeys)).toBeLessThan(
      exportTailDuration(fluff),
    );
  });
});
