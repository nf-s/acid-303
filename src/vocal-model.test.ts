import { describe, expect, it } from "vitest";
import {
  createProject,
  projectSchema,
  readProject,
  playbackFrame,
  resolvedAutomationValue,
  exportPlan,
} from "./model";
import {
  createVocal,
  vocalSchema,
  setVocalNote,
  removeVocalNote,
  joinVocalNote,
  resizeVocalTrack,
  automatedVocal,
  setVocalValue,
  resolveVocalTrim,
  vocalStepNotes,
  VOCAL_SOUNDS,
  VOCAL_PATTERNS,
  withVocalPattern,
} from "./vocal-model";
import { trackStepCount, timingSchema } from "./timing";
import { scaleNotes } from "./model";
const scale = createProject().scale;
describe("vocal patterns", () => {
  it("builds musical rhythms across every meter/grid without replacing sound, trim or automation", () => {
    for (const meter of ["4/4", "3/4", "5/4", "6/8", "7/8"])
      for (const grid of ["straight", "triplet"])
        for (const pattern of VOCAL_PATTERNS) {
          const track = resizeVocalTrack(
            createVocal(),
            timingSchema.parse({ bars: 16, meter, grid }),
          );
          track.start = 0.1;
          track.end = 0.8;
          track.automation.tone = Array(trackStepCount(track.timing)).fill(0.4);
          const next = withVocalPattern(track, pattern.id, scale, 63);
          expect(vocalSchema.safeParse(next).success).toBe(true);
          expect(
            next.notes.every((note) =>
              scaleNotes(scale, 36, 84).includes(note.note),
            ),
          ).toBe(true);
          expect(next.muted).toBe(false);
          expect(next.sound).toBe(track.sound);
          expect([next.start, next.end, next.automation]).toEqual([
            track.start,
            track.end,
            track.automation,
          ]);
          expect(track.muted).toBe(true);
        }
  });
  it("migrates v3 without changing existing instruments or enabling vocals", () => {
    const original = createProject();
    const { vocal, ...previous } = original;
    expect(vocal.muted).toBe(true);
    const migrated = readProject({ ...previous, version: 3 });
    expect(migrated).toEqual(original);
    expect(migrated?.version).toBe(5);
    expect(projectSchema.safeParse(migrated).success).toBe(true);
  });
  it("validates sample bounds, ordered notes, loop bounds, trim and automation", () => {
    const track = createVocal();
    expect(VOCAL_SOUNDS).toHaveLength(48);
    expect(vocalSchema.safeParse({ ...track, sound: 23 }).success).toBe(true);
    expect(vocalSchema.safeParse({ ...track, sound: 48 }).success).toBe(false);
    expect(vocalSchema.safeParse({ ...track, start: 1, end: 0 }).success).toBe(
      false,
    );
    expect(
      vocalSchema.safeParse({
        ...track,
        notes: [{ start: 15, length: 2, note: 60, accent: false }],
      }).success,
    ).toBe(false);
    expect(
      vocalSchema.safeParse({ ...track, notes: [...track.notes].reverse() })
        .success,
    ).toBe(false);
    expect(
      vocalSchema.safeParse({
        ...track,
        automation: { ...track.automation, tone: [0.5] },
      }).success,
    ).toBe(false);
  });
  it("moves and overlays notes without overlap or mutation, preserving uncovered fragments", () => {
    let track = {
      ...createVocal(),
      notes: [{ start: 0, length: 12, note: 60, accent: false }],
    };
    const original = structuredClone(track);
    track = setVocalNote(
      track,
      { start: 4, length: 3, note: 61, accent: true },
      scale,
    );
    expect(track.notes).toEqual([
      { start: 0, length: 4, note: 60, accent: false },
      { start: 4, length: 3, note: 60, accent: true },
      { start: 7, length: 5, note: 60, accent: false },
    ]);
    expect(original.notes[0]?.length).toBe(12);
    track = setVocalNote(
      track,
      { start: 13, length: 8, note: 72, accent: false },
      scale,
      4,
    );
    expect(track.notes.at(-1)).toMatchObject({
      start: 13,
      length: 3,
      note: 72,
    });
    expect(track.notes.some((note) => note.start === 4)).toBe(false);
    expect(vocalSchema.safeParse(track).success).toBe(true);
    expect(removeVocalNote(track, 13).notes).toHaveLength(2);
  });
  it("joins only adjacent equal-pitch notes", () => {
    const track = {
      ...createVocal(),
      notes: [
        { start: 0, length: 2, note: 60, accent: true },
        { start: 2, length: 3, note: 60, accent: false },
        { start: 5, length: 2, note: 64, accent: false },
      ],
    };
    expect(joinVocalNote(track, 0).notes[0]).toEqual({
      start: 0,
      length: 5,
      note: 60,
      accent: true,
    });
    expect(joinVocalNote(track, 2)).toBe(track);
    expect(
      vocalStepNotes(joinVocalNote(track, 0))
        .slice(0, 5)
        .map((step) => step.slide),
    ).toEqual([true, true, true, true, false]);
  });
  it("repeats bars and quantizes note durations across straight/triplet timing", () => {
    const track = createVocal();
    track.automation.tone = Array(16).fill(0.7);
    const expanded = resizeVocalTrack(track, {
      bars: 16,
      meter: "5/4",
      grid: "triplet",
    });
    expect(trackStepCount(expanded.timing)).toBe(480);
    expect(expanded.notes[0]).toMatchObject({ start: 0, length: 3 });
    expect(expanded.notes[1]).toMatchObject({ start: 12, length: 3 });
    expect(expanded.notes).toHaveLength(32);
    expect(expanded.automation.tone).toHaveLength(480);
    expect(vocalSchema.safeParse(expanded).success).toBe(true);
    expect(
      vocalSchema.safeParse(resizeVocalTrack(expanded, track.timing)).success,
    ).toBe(true);
  });
  it("resolves crossing automated trims safely and exposes the playback position", () => {
    const project = createProject();
    project.vocal.muted = false;
    project.vocal.automation.start = Array(16).fill(1);
    project.vocal.automation.end = Array(16).fill(0);
    const resolved = automatedVocal(project.vocal, 0);
    const trim = resolveVocalTrim(resolved, 0.12);
    expect(trim.end).toBe(0.12);
    expect(trim.end - trim.start).toBeCloseTo(0.008);
    expect(setVocalValue(project.vocal, "start", 1).start).toBe(0.995);
    expect(playbackFrame(project, 12).positions.vocal?.index).toBe(2);
    expect(
      resolvedAutomationValue(
        project,
        { instrument: "vocal", parameter: "start" },
        12,
      ),
    ).toEqual({ base: 0, value: 1, automated: true });
    project.vocal = resizeVocalTrack(project.vocal, {
      bars: 16,
      meter: "4/4",
      grid: "straight",
    });
    expect(exportPlan(project).ticks).toBeGreaterThanOrEqual(1536);
  });
});
