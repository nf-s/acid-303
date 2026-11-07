import { describe, expect, it } from "vitest";
import {
  createProject,
  noteName,
  projectSchema,
  stepDuration,
  remixProject,
  readProject,
  SCALE_MODES,
  scaleNotes,
  snapNote,
  withScale,
  automatedBass,
  automatedKeys,
  normalizedBassValue,
  normalizedKeysValue,
  emptyBassAutomation,
  emptyKeysAutomation,
  automatedDrum,
  normalizedDrumValue,
  drumValueFromNormalized,
  emptyDrumAutomation,
  projectBars,
} from "./model";
import type { DrumAutomationParameter } from "./model";

describe("Arp and Pad project integration", () => {
  it("adds muted independent instruments to old saves without changing existing tracks", () => {
    const project = createProject();
    const { arp, pad, ...old } = project;
    const loaded = readProject(old);
    expect(loaded).toEqual(project);
    expect(loaded?.arp.muted).toBe(true);
    expect(loaded?.pad.muted).toBe(true);
    const second = readProject(old);
    if (!loaded || !second) throw new Error("Expected an upgraded project.");
    loaded.arp.notes.push(72);
    loaded.pad.chords[0] = { degree: 4, inversion: 2 };
    expect(second.arp.notes).toEqual(arp.notes);
    expect(second.pad.chords).toEqual(pad.chords);
  });

  it("keeps the enabled progression length independent of its level", () => {
    const project = createProject();
    expect(projectBars(project)).toBe(2);
    project.pad.muted = false;
    for (const bars of [2, 4, 8, 16]) {
      const valid = projectSchema.parse({
        ...project,
        pad: { ...project.pad, timing: { ...project.pad.timing, bars } },
      });
      expect(projectBars(valid)).toBe(bars);
      valid.pad.volume = 0;
      expect(projectBars(valid)).toBe(bars);
      valid.pad.muted = true;
      expect(projectBars(valid)).toBe(2);
    }
  });

  it("retunes selected notes and chord degrees while preserving expression and timing", () => {
    const project = createProject();
    project.arp.muted = false;
    project.arp.notes = [58, 59, 62];
    project.arp.direction = "played";
    project.pad.muted = false;
    project.pad.chords[0] = { degree: 6, inversion: 3 };
    const changed = withScale(project, { root: 0, mode: "pentatonic" });
    expect(changed.arp.notes).toEqual([58, 63]);
    expect(changed.arp.direction).toBe("played");
    expect(changed.arp.muted).toBe(false);
    expect(changed.pad.chords[0]).toEqual({ degree: 1, inversion: 3 });
    expect(changed.pad.timing.bars).toBe(project.pad.timing.bars);
    expect(project.arp.notes).toEqual([58, 59, 62]);
  });

  it("rejects invalid new instrument data at the project boundary", () => {
    const project = createProject();
    expect(
      readProject({ ...project, arp: { ...project.arp, notes: [60, 60] } }),
    ).toBeNull();
    expect(
      readProject({ ...project, arp: { ...project.arp, rate: "fast" } }),
    ).toBeNull();
    expect(
      readProject({
        ...project,
        pad: { ...project.pad, timing: { ...project.pad.timing, bars: 3 } },
      }),
    ).toBeNull();
    expect(
      readProject({ ...project, pad: { ...project.pad, volume: Infinity } }),
    ).toBeNull();
  });
});

describe("drum automation and eight-control migration", () => {
  it("defaults older saves to centered dry drums and preserves note-track sound", () => {
    const project = createProject();
    const { pulse, ...bass } = project.bass;
    const { width, attack, ...keys } = project.keys;
    const saved = {
      ...project,
      bass,
      keys,
      drums: project.drums.map(
        ({ pan, attack, space, automation, ...track }) => track,
      ),
    };
    const restored = readProject(saved);
    expect(restored?.bass.pulse).toBe(0.5);
    expect(restored?.keys.width).toBe(0.5);
    expect(restored?.keys.attack).toBe(0);
    expect(
      restored?.drums.every(
        (track) => track.pan === 0 && track.attack === 0 && track.space === 0,
      ),
    ).toBe(true);
    expect(restored?.drums[0]?.automation).toEqual(emptyDrumAutomation());
  });

  it("resolves every drum curve without mutating settings and snaps automated pitch to the mode", () => {
    const project = createProject();
    const drum = project.drums[0];
    if (!drum) throw new Error("Expected a kick.");
    const keys: DrumAutomationParameter[] = [
      "pitch",
      "decay",
      "volume",
      "tone",
      "drive",
      "pan",
      "attack",
      "space",
    ];
    for (const key of keys)
      drum.automation[key] = Array.from({ length: 16 }, (_, step) =>
        step === 0 ? 0 : step === 15 ? 1 : 0.5,
      );
    const original = structuredClone(drum);
    const low = automatedDrum(drum, 0, project.scale),
      high = automatedDrum(drum, 15, project.scale);
    expect([
      low.pitch,
      low.decay,
      low.volume,
      low.tone,
      low.drive,
      low.pan,
      low.attack,
      low.space,
    ]).toEqual([-24, 0.03, 0, 0, 0, -1, 0, 0]);
    expect([
      high.pitch,
      high.decay,
      high.volume,
      high.tone,
      high.drive,
      high.pan,
      high.attack,
      high.space,
    ]).toEqual([24, 1.5, 1, 1, 1, 1, 1, 1]);
    expect(automatedDrum(drum, 8, project.scale).pan).toBe(0);
    expect(automatedDrum(drum, -1, project.scale)).toEqual(drum);
    expect(drum).toEqual(original);
    expect(
      drumValueFromNormalized("pitch", 0.54, { root: 9, mode: "minor" }),
    ).toBe(2);
    expect(
      drumValueFromNormalized("pitch", 0.54, { root: 2, mode: "pentatonic" }),
    ).toBe(3);
    for (const key of keys)
      expect(
        drumValueFromNormalized(
          key,
          normalizedDrumValue(drum, key),
          project.scale,
        ),
      ).toBeCloseTo(drum[key]);
  });

  it("rejects malformed drum curves and fills missing lanes independently", () => {
    const project = createProject();
    for (const lane of [
      Array(15).fill(0),
      Array(16).fill(1.1),
      Array(16).fill(NaN),
      true,
    ]) {
      expect(
        readProject({
          ...project,
          drums: project.drums.map((track) => ({
            ...track,
            automation: { pitch: lane },
          })),
        }),
      ).toBeNull();
    }
    const restored = readProject({
      ...project,
      drums: project.drums.map((track) => ({
        ...track,
        automation: { pan: Array(16).fill(0.5) },
      })),
    });
    expect(restored?.drums[0]?.automation.space).toBeNull();
    expect(restored?.drums[0]?.automation.pan).toEqual(Array(16).fill(0.5));
  });
});

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
    expect(upgraded?.version).toBe(3);
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

describe("global scale lock", () => {
  it("enumerates exact scale notes and snaps ties downward within the instrument range", () => {
    const minor = { root: 9, mode: "minor" };
    const validated = projectSchema.parse({
      ...createProject(),
      scale: minor,
    }).scale;
    expect(scaleNotes(validated, 24, 36)).toEqual([
      24, 26, 28, 29, 31, 33, 35, 36,
    ]);
    expect(snapNote(32, validated, 24, 60)).toBe(31);
    expect(snapNote(-100, validated, 24, 60)).toBe(24);
    expect(snapNote(100, validated, 24, 60)).toBe(60);
    expect(scaleNotes({ root: 0, mode: "minor" }, -12, 0)).toEqual([
      -12, -10, -9, -7, -5, -4, -2, 0,
    ]);
  });

  it("retunes every editable pitch across all roots and modes without changing rhythm or sound controls", () => {
    const original = createProject();
    original.drums.forEach((drum, index) => {
      drum.pitch = [-23, -11, -1, 1, 23][index] ?? 0;
    });
    for (let root = 0; root < 12; root += 1) {
      for (const mode of SCALE_MODES) {
        const scale = { root, mode: mode.id };
        const retuned = withScale(original, scale);
        const bassNotes = scaleNotes(scale, 24, 60);
        const textureNotes = scaleNotes(scale, 48, 84);
        const drumOffsets = scaleNotes({ root: 0, mode: mode.id }, -24, 24);
        expect(
          retuned.bass.steps.every((step) => bassNotes.includes(step.note)),
        ).toBe(true);
        expect(
          retuned.keys.steps.every((step) => textureNotes.includes(step.note)),
        ).toBe(true);
        expect(
          retuned.drums.every((drum) => drumOffsets.includes(drum.pitch)),
        ).toBe(true);
        expect(
          retuned.bass.steps.map(({ on, accent, slide }) => ({
            on,
            accent,
            slide,
          })),
        ).toEqual(
          original.bass.steps.map(({ on, accent, slide }) => ({
            on,
            accent,
            slide,
          })),
        );
        expect(retuned.drums.map((drum) => drum.steps)).toEqual(
          original.drums.map((drum) => drum.steps),
        );
        expect(retuned.keys.tone).toBe(original.keys.tone);
        expect(retuned.bass.cutoff).toBe(original.bass.cutoff);
        expect(projectSchema.safeParse(retuned).success).toBe(true);
      }
    }
    expect(original.scale).toEqual({ root: 9, mode: "minor" });
    expect(original.drums[0]?.pitch).toBe(-23);
  });

  it("loads old projects into A minor while retaining valid notes and all expanded voices", () => {
    const current = createProject();
    current.drums.forEach((drum) => {
      drum.sound = 4;
    });
    current.keys.sound = 5;
    const saved = Object.fromEntries(
      Object.entries(current).filter(([key]) => key !== "scale"),
    );
    expect(readProject(saved)).toEqual(current);
    expect(
      readProject({ ...saved, scale: { root: 12, mode: "minor" } }),
    ).toBeNull();
    expect(
      readProject({ ...saved, scale: { root: 9, mode: "unknown" } }),
    ).toBeNull();
    expect(
      readProject({ ...saved, keys: { ...current.keys, sound: 8 } }),
    ).toBeNull();
    expect(
      readProject({
        ...saved,
        drums: current.drums.map((drum) => ({ ...drum, sound: 8 })),
      }),
    ).toBeNull();
  });

  it("keeps remix pitches inside the currently selected scale", () => {
    const project = withScale(createProject(), { root: 1, mode: "pentatonic" });
    const result = remixProject(project, () => 0.73);
    expect(result.scale).toEqual(project.scale);
    expect(
      result.bass.steps.every((step) =>
        scaleNotes(project.scale, 24, 60).includes(step.note),
      ),
    ).toBe(true);
    expect(
      result.keys.steps.every((step) =>
        scaleNotes(project.scale, 48, 84).includes(step.note),
      ),
    ).toBe(true);
  });
});

describe("instrument automation", () => {
  it("migrates older saves to Acid with inactive automation and independent defaults", () => {
    const project = createProject();
    const bass = Object.fromEntries(
      Object.entries(project.bass).filter(
        ([key]) => !["automation", "sound", "shape", "drive"].includes(key),
      ),
    );
    const keys = Object.fromEntries(
      Object.entries(project.keys).filter(
        ([key]) => !["automation", "grit", "motion"].includes(key),
      ),
    );
    const drums = project.drums.map((drum) =>
      Object.fromEntries(
        Object.entries(drum).filter(
          ([key]) => !["tone", "drive"].includes(key),
        ),
      ),
    );
    const loaded = readProject({ ...project, bass, keys, drums });
    expect(loaded?.bass.sound).toBe(2);
    expect(loaded?.bass.shape).toBe(0.5);
    expect(loaded?.bass.drive).toBe(0);
    expect(loaded?.keys.grit).toBe(0);
    expect(loaded?.keys.motion).toBe(0);
    expect(
      loaded?.drums.every((drum) => drum.tone === 0.5 && drum.drive === 0),
    ).toBe(true);
    expect(loaded?.bass.automation).toEqual(emptyBassAutomation());
    expect(loaded?.keys.automation).toEqual(emptyKeysAutomation());
    const second = readProject({ ...project, bass, keys });
    if (!loaded || !second) throw new Error("Expected valid legacy projects.");
    loaded.bass.automation.cutoff = Array.from({ length: 16 }, () => 0.5);
    expect(second.bass.automation.cutoff).toBeNull();
    expect(
      readProject({ ...project, bass: { ...bass, sound: 11 } }),
    ).toBeNull();
  });

  it("rejects malformed, out-of-range and nonfinite automation at the saved-data boundary", () => {
    const project = createProject();
    const invalid: unknown[] = [
      [],
      Array(15).fill(0.5),
      Array(17).fill(0.5),
      Array(16).fill(-0.01),
      Array(16).fill(1.01),
      Array(16).fill(NaN),
      Array(16).fill(Infinity),
      Array(16).fill("high"),
      true,
    ];
    for (const lane of invalid) {
      expect(
        readProject({
          ...project,
          bass: { ...project.bass, automation: { cutoff: lane } },
        }),
      ).toBeNull();
      expect(
        readProject({
          ...project,
          keys: { ...project.keys, automation: { space: lane } },
        }),
      ).toBeNull();
    }
    const partial = readProject({
      ...project,
      bass: { ...project.bass, automation: { cutoff: Array(16).fill(0.5) } },
    });
    expect(partial?.bass.automation.resonance).toBeNull();
    expect(partial?.bass.automation.shape).toBeNull();
    expect(partial?.bass.automation.drive).toBeNull();
  });

  it("resolves zero, midpoint and full-scale values without changing the base controls", () => {
    const project = createProject();
    const curve = Array.from({ length: 16 }, (_, index) =>
      index === 0 ? 0 : index === 15 ? 1 : 0.5,
    );
    project.bass.automation = {
      pulse: [...curve],
      shape: [...curve],
      drive: [...curve],
      cutoff: [...curve],
      resonance: [...curve],
      envelope: [...curve],
      decay: [...curve],
      volume: [...curve],
    };
    project.keys.automation = {
      width: [...curve],
      attack: [...curve],
      grit: [...curve],
      motion: [...curve],
      tone: [...curve],
      decay: [...curve],
      space: [...curve],
      volume: [...curve],
    };
    const original = structuredClone(project);
    const lowBass = automatedBass(project.bass, 0),
      middleBass = automatedBass(project.bass, 8),
      highBass = automatedBass(project.bass, 15);
    expect(lowBass.shape).toBe(0);
    expect(lowBass.drive).toBe(0);
    expect(lowBass.cutoff).toBe(80);
    expect(lowBass.resonance).toBe(0);
    expect(lowBass.volume).toBe(0);
    expect(lowBass.decay).toBe(0.05);
    expect(middleBass.cutoff).toBeCloseTo(800);
    expect(middleBass.resonance).toBe(11);
    expect(middleBass.envelope).toBe(0.5);
    expect(middleBass.decay).toBeCloseTo(0.775);
    expect(highBass.shape).toBe(1);
    expect(highBass.drive).toBe(1);
    expect(highBass.cutoff).toBe(8000);
    expect(highBass.resonance).toBe(22);
    expect(highBass.decay).toBe(1.5);
    const lowKeys = automatedKeys(project.keys, 0),
      middleKeys = automatedKeys(project.keys, 8),
      highKeys = automatedKeys(project.keys, 15);
    expect(lowKeys.grit).toBe(0);
    expect(lowKeys.motion).toBe(0);
    expect(lowKeys.tone).toBe(0);
    expect(lowKeys.volume).toBe(0);
    expect(lowKeys.decay).toBe(0.08);
    expect(middleKeys.decay).toBeCloseTo(1.04);
    expect(middleKeys.space).toBe(0.5);
    expect(highKeys.grit).toBe(1);
    expect(highKeys.motion).toBe(1);
    expect(highKeys.decay).toBe(2);
    expect(highKeys.space).toBe(1);
    expect(project).toEqual(original);
    expect(automatedBass(project.bass, 16).cutoff).toBe(original.bass.cutoff);
    expect(automatedKeys(project.keys, -1).decay).toBe(original.keys.decay);
    project.bass.automation = emptyBassAutomation();
    project.keys.automation = emptyKeysAutomation();
    expect(automatedBass(project.bass, 8).cutoff).toBe(original.bass.cutoff);
    expect(automatedKeys(project.keys, 8).decay).toBe(original.keys.decay);
  });

  it("uses base knob values when initializing curves and preserves drawn lanes through save, scale and remix", () => {
    const project = createProject();
    project.bass.sound = 8;
    project.bass.automation.shape = Array(16).fill(
      normalizedBassValue(project.bass, "shape"),
    );
    project.bass.automation.drive = Array(16).fill(
      normalizedBassValue(project.bass, "drive"),
    );
    project.keys.automation.grit = Array(16).fill(
      normalizedKeysValue(project.keys, "grit"),
    );
    project.keys.automation.motion = Array(16).fill(
      normalizedKeysValue(project.keys, "motion"),
    );
    project.bass.automation.cutoff = Array(16).fill(
      normalizedBassValue(project.bass, "cutoff"),
    );
    project.bass.automation.resonance = Array(16).fill(
      normalizedBassValue(project.bass, "resonance"),
    );
    project.bass.automation.envelope = Array(16).fill(
      normalizedBassValue(project.bass, "envelope"),
    );
    project.bass.automation.decay = Array(16).fill(
      normalizedBassValue(project.bass, "decay"),
    );
    project.bass.automation.volume = Array(16).fill(
      normalizedBassValue(project.bass, "volume"),
    );
    project.keys.automation.tone = Array(16).fill(
      normalizedKeysValue(project.keys, "tone"),
    );
    project.keys.automation.decay = Array(16).fill(
      normalizedKeysValue(project.keys, "decay"),
    );
    project.keys.automation.space = Array(16).fill(
      normalizedKeysValue(project.keys, "space"),
    );
    project.keys.automation.volume = Array(16).fill(
      normalizedKeysValue(project.keys, "volume"),
    );
    const bass = automatedBass(project.bass, 7),
      keys = automatedKeys(project.keys, 7);
    expect(bass.cutoff).toBeCloseTo(project.bass.cutoff);
    expect(bass.resonance).toBeCloseTo(project.bass.resonance);
    expect(bass.decay).toBeCloseTo(project.bass.decay);
    expect(keys.decay).toBeCloseTo(project.keys.decay);
    expect(keys.tone).toBe(project.keys.tone);
    expect(keys.space).toBe(project.keys.space);
    const saved = readProject(JSON.parse(JSON.stringify(project)));
    expect(saved).toEqual(project);
    for (const edited of [
      withScale(project, { root: 1, mode: "dorian" }),
      remixProject(project, () => 0.71),
    ]) {
      expect(edited.bass.sound).toBe(8);
      expect(edited.bass.automation).toEqual(project.bass.automation);
      expect(edited.keys.automation).toEqual(project.keys.automation);
      expect(edited.bass.automation.cutoff).not.toBe(
        project.bass.automation.cutoff,
      );
    }
  });
});

describe("independent timing migration", () => {
  it("preserves all legacy sixteen-step voices and samples old pad knots without retiming", async () => {
    const { automatedPad } = await import("./pad-model");
    const project = createProject();
    project.bass.automation.cutoff = Array.from(
      { length: 16 },
      (_, index) => index / 15,
    );
    const lane = Array.from({ length: 16 }, (_, index) => (index % 5) / 4);
    const legacy = {
      ...project,
      version: 2,
      pad: {
        ...project.pad,
        bars: 4,
        automation: { ...project.pad.automation, tone: lane },
      },
    };
    const restored = readProject(legacy);
    if (!restored) throw new Error("Legacy timing migration failed");
    expect(restored.version).toBe(3);
    expect(restored.drums).toEqual(project.drums);
    expect(restored.bass).toEqual(project.bass);
    expect(restored.keys).toEqual(project.keys);
    expect(restored.arp).toEqual(project.arp);
    expect(restored.fx).toEqual({ sweep: 0, space: 0, echo: 0 });
    expect(restored.pad.timing).toEqual({
      bars: 4,
      meter: "4/4",
      grid: "straight",
    });
    expect(restored.pad.automation.tone).toHaveLength(64);
    for (let step = 0; step < 128; step++) {
      const position = (step / 4) % 16,
        index = Math.floor(position),
        fraction = position - index;
      const first = lane[index] ?? 0,
        next = lane[(index + 1) % 16] ?? 0;
      expect(automatedPad(restored.pad, step).tone).toBeCloseTo(
        first + (next - first) * fraction,
        12,
      );
    }
  });
  it("resizes independent patterns and rejects inconsistent stored lengths", async () => {
    const { resizeDrumTrack, resizeBassTrack } = await import("./model");
    const project = createProject(),
      drum = project.drums[0];
    if (!drum) throw new Error("Missing kick");
    drum.automation.volume = Array.from(
      { length: 16 },
      (_, index) => index / 15,
    );
    const longer = resizeDrumTrack(drum, {
      bars: 4,
      meter: "4/4",
      grid: "straight",
    });
    expect(longer.steps).toHaveLength(64);
    expect(longer.steps.slice(16, 32)).toEqual(drum.steps);
    expect(longer.automation.volume?.slice(48)).toEqual(drum.automation.volume);
    project.drums[0] = longer;
    project.bass = resizeBassTrack(project.bass, {
      bars: 8,
      meter: "5/4",
      grid: "triplet",
    });
    expect(project.bass.steps).toHaveLength(240);
    expect(readProject(project)).not.toBeNull();
    expect(
      readProject({
        ...project,
        bass: { ...project.bass, steps: project.bass.steps.slice(1) },
      }),
    ).toBeNull();
  });
  it("bounds polymeter export without requiring an enormous common loop", async () => {
    const { exportPlan, resizeDrumTrack, playbackFrame } =
      await import("./model");
    const project = createProject();
    project.drums = project.drums.map((track, index) =>
      resizeDrumTrack(track, {
        bars: 8,
        meter: index === 0 ? "7/8" : index === 1 ? "5/4" : "3/4",
        grid: "triplet",
      }),
    );
    project.pad.muted = false;
    project.pad.timing.bars = 16;
    const plan = exportPlan(project);
    expect(plan.completeCycle).toBe(false);
    expect(plan.ticks).toBeLessThanOrEqual(3072);
    expect(plan.ticks).toBeGreaterThanOrEqual(1536);
    const frame = playbackFrame(project, 672);
    expect(frame.positions.kick?.index).toBe(0);
    expect(frame.positions.snare?.index).not.toBe(0);
    expect(playbackFrame(project, 0, false).positions.bass).toBeNull();
  });
});

describe("expanded sound catalogs", () => {
  it("accepts each catalog entry and rejects missing per-instrument indices", async () => {
    const {
      DRUM_META,
      BASS_SOUNDS,
      KEYS_SOUNDS,
      drumSchema,
      bassSchema,
      keysSchema,
    } = await import("./model");
    const project = createProject();
    for (const drum of project.drums) {
      const names = DRUM_META[drum.id].sounds;
      expect(names).toHaveLength(drum.id === "hat" ? 8 : 7);
      expect(new Set(names).size).toBe(names.length);
      for (let sound = 0; sound < names.length; sound++)
        expect(drumSchema.safeParse({ ...drum, sound }).success).toBe(true);
      expect(
        drumSchema.safeParse({ ...drum, sound: names.length }).success,
      ).toBe(false);
    }
    expect(BASS_SOUNDS).toHaveLength(11);
    expect(KEYS_SOUNDS).toHaveLength(8);
    for (let sound = 0; sound < BASS_SOUNDS.length; sound++)
      expect(bassSchema.safeParse({ ...project.bass, sound }).success).toBe(
        true,
      );
    for (let sound = 0; sound < KEYS_SOUNDS.length; sound++)
      expect(keysSchema.safeParse({ ...project.keys, sound }).success).toBe(
        true,
      );
    project.drums = project.drums.map((track) => ({
      ...track,
      sound: DRUM_META[track.id].sounds.length - 1,
    }));
    project.bass.sound = 10;
    project.keys.sound = 7;
    expect(readProject(JSON.parse(JSON.stringify(project)))).toEqual(project);
  });
});
