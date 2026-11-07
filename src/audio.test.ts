import { describe, expect, it } from "vitest";
import { encodeWav, midiFrequency } from "./audio";
import { createProject, projectSchema, stepDuration } from "./model";

describe("audio timing and project boundary", () => {
  it("preserves bar duration at maximum swing and the supported tempos", () => {
    for (const bpm of [60, 126, 180]) {
      const duration = Array.from({ length: 16 }, (_, step) =>
        stepDuration(bpm, 0.5, step),
      ).reduce((sum, value) => sum + value, 0);
      expect(duration).toBeCloseTo((60 / bpm) * 4, 10);
      expect(stepDuration(bpm, 0.5, 0)).toBeGreaterThan(
        stepDuration(bpm, 0.5, 1),
      );
    }
  });

  it("validates all presets and rejects invalid persisted audio settings", () => {
    for (const preset of [0, 1, 2])
      expect(projectSchema.safeParse(createProject(preset)).success).toBe(true);
    const project = createProject();
    expect(projectSchema.safeParse({ ...project, bpm: 0 }).success).toBe(false);
    expect(projectSchema.safeParse({ ...project, volume: 10 }).success).toBe(
      false,
    );
    expect(
      projectSchema.safeParse({ ...project, drums: project.drums.slice(1) })
        .success,
    ).toBe(false);
    expect(
      projectSchema.safeParse({
        ...project,
        bass: { ...project.bass, cutoff: Infinity },
      }).success,
    ).toBe(false);
  });

  it("tunes MIDI notes to concert pitch", () => {
    expect(midiFrequency(69)).toBe(440);
    expect(midiFrequency(33)).toBeCloseTo(55);
    expect(midiFrequency(45)).toBeCloseTo(110);
  });
});

describe("WAV export", () => {
  it("writes an interleaved stereo PCM file with correctly clamped samples", async () => {
    const blob = encodeWav(
      [new Float32Array([-2, 0.5, NaN]), new Float32Array([2, -0.5, Infinity])],
      44100,
    );
    const data = await blob.arrayBuffer();
    const view = new DataView(data);
    expect(blob.type).toBe("audio/wav");
    expect(data.byteLength).toBe(56);
    expect(new TextDecoder().decode(data.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(data.slice(8, 12))).toBe("WAVE");
    expect(view.getUint32(4, true)).toBe(data.byteLength - 8);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(40, true)).toBe(12);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(16384);
    expect(view.getInt16(50, true)).toBe(-16384);
    expect(view.getInt16(52, true)).toBe(0);
    expect(view.getInt16(54, true)).toBe(0);
  });

  it("rejects mismatched or absent channels instead of making a corrupt file", () => {
    expect(() => encodeWav([], 44100)).toThrow();
    expect(() =>
      encodeWav([new Float32Array(2), new Float32Array(1)], 44100),
    ).toThrow();
  });
});
