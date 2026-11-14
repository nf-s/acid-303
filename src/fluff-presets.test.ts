import { describe, expect, it } from "vitest";
import { FLUFF_PRESETS, createFluffPreset } from "./fluff-presets";
import { projectBars, projectSchema, scaleNotes } from "./model";
import type { Project } from "./model";
import {
  chordNotes,
  progressionChordAtStep,
  progressionChordScale,
} from "./progression-model";
import { defaultPresetId, presetsForMode } from "./presets";

const ids = FLUFF_PRESETS.map((preset) => preset.id);

/** Every automation lane of the melodic parts, labelled by part and parameter. */
function melodicLanes(project: Project): Array<[string, number[]]> {
  const lanes: Array<[string, number[]]> = [];
  const parts: Array<
    [string, { muted: boolean; automation: Record<string, number[] | null> }]
  > = [
    ["bass", project.bass],
    ["lead", project.keys],
    ["arp", project.arp],
    ["pad", project.pad],
    ["vocal", project.vocal],
  ];
  for (const [part, track] of parts) {
    if (track.muted) continue;
    for (const [parameter, lane] of Object.entries(track.automation))
      if (lane) lanes.push([`${part} ${parameter}`, lane]);
  }
  return lanes;
}

/** Lead onsets per bar; a held step of the same pitch is not a new note. */
function leadOnsetsPerBar(project: Project): number[] {
  const steps = project.keys.steps;
  const bars = Array.from({ length: steps.length / 16 }, () => 0);
  steps.forEach((step, index) => {
    const previous = steps[(index - 1 + steps.length) % steps.length];
    const tied = previous?.on && previous.slide && previous.note === step.note;
    const bar = Math.floor(index / 16);
    if (step.on && !tied) bars[bar] = (bars[bar] ?? 0) + 1;
  });
  return bars;
}

describe("Fluff examples", () => {
  it("offers seventeen distinctly named genres with Cotton first", () => {
    expect(FLUFF_PRESETS).toHaveLength(17);
    expect(new Set(FLUFF_PRESETS.map((preset) => preset.name)).size).toBe(17);
    expect(new Set(FLUFF_PRESETS.map((preset) => preset.genre)).size).toBe(17);
    expect(defaultPresetId("fluff")).toBe("fluff-cotton");
    expect(presetsForMode("fluff").map((preset) => preset.id)).toEqual(ids);
  });

  it.each(ids)("builds %s as a valid Fluff project that stays in key", (id) => {
    const project = createFluffPreset(id);
    expect(projectSchema.safeParse(project).success).toBe(true);
    expect(project.mode).toBe("fluff");
    const allowed = new Set(
      scaleNotes(project.scale, 0, 127).map((note) => note % 12),
    );
    const played = [
      ...project.bass.steps.filter((step) => step.on).map((step) => step.note),
      ...project.keys.steps.filter((step) => step.on).map((step) => step.note),
      ...project.vocal.notes.map((note) => note.note),
      ...(project.arp.followChords ? [] : project.arp.notes),
    ].map((note) => note % 12);
    expect(played.every((note) => allowed.has(note))).toBe(true);
  });

  it.each(ids)(
    "builds the %s chords from the key or a borrowed parallel scale",
    (id) => {
      const project = createFluffPreset(id);
      const borrowed = project.progression.chords.filter(
        (chord) => chord.borrow,
      );
      // At most one borrowed chord, so the colour stays a colour.
      expect(borrowed.length).toBeLessThanOrEqual(1);
      expect(project.pad.chords).toEqual(project.progression.chords);
      for (const chord of project.progression.chords) {
        const own = new Set(
          scaleNotes(progressionChordScale(chord, project.scale), 0, 127).map(
            (note) => note % 12,
          ),
        );
        const notes = chordNotes(chord, project.scale);
        expect(notes.length).toBeGreaterThanOrEqual(3);
        expect(notes.every((note) => own.has(note % 12))).toBe(true);
      }
      // Bass and lead notes under a borrowed chord fit its scale as well.
      for (let step = 0; step < projectBars(project) * 16; step++) {
        const chord =
          project.progression.chords[
            progressionChordAtStep(project.progression, step)
          ];
        if (!chord?.borrow) continue;
        const own = new Set(
          scaleNotes(progressionChordScale(chord, project.scale), 0, 127).map(
            (note) => note % 12,
          ),
        );
        for (const track of [project.bass, project.keys]) {
          const played = track.steps[step % track.steps.length];
          if (!track.muted && played?.on)
            expect(own.has(played.note % 12), `${id} step ${step}`).toBe(true);
        }
      }
    },
  );

  it.each(ids)(
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

  it.each(ids)("keeps the %s bassline in the bass register", (id) => {
    const project = createFluffPreset(id);
    const notes = project.bass.steps
      .filter((step) => step.on)
      .map((step) => step.note);
    // C1 to E3: octave jumps allowed, but every line starts from the low end.
    expect(Math.min(...notes)).toBeGreaterThanOrEqual(24);
    expect(Math.max(...notes)).toBeLessThanOrEqual(52);
  });

  it.each(ids)("keeps the %s lead sparse", (id) => {
    const project = createFluffPreset(id);
    if (project.keys.muted) return;
    const bars = leadOnsetsPerBar(project);
    expect(Math.max(...bars)).toBeLessThanOrEqual(5);
    const average = bars.reduce((sum, count) => sum + count, 0) / bars.length;
    expect(average).toBeLessThanOrEqual(4.5);
  });

  it.each(ids)(
    "moves %s over a sixteen-bar automation loop that meets itself",
    (id) => {
      const project = createFluffPreset(id);
      expect(projectBars(project)).toBe(16);
      const lanes = melodicLanes(project);
      const moving = lanes.filter(
        ([, lane]) => Math.max(...lane) - Math.min(...lane) >= 0.1,
      );
      expect(moving.length).toBeGreaterThanOrEqual(1);
      for (const [label, lane] of lanes) {
        expect(lane, label).toHaveLength(256);
        // Volume lanes bring parts in; every other curve eases back by the loop point.
        if (label.endsWith("volume")) continue;
        expect(
          Math.abs((lane.at(-1) ?? 0) - (lane[0] ?? 0)),
          label,
        ).toBeLessThan(0.05);
      }
    },
  );
});
