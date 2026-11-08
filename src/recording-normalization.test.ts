import { describe, expect, it } from "vitest";
import {
  normalizeRecordingPcm,
  recordingNormalizationGain,
  RECORDING_PEAK_TARGET,
} from "./recording-normalization";

describe("recording peak normalization", () => {
  it("raises quiet PCM with headroom while preserving polarity and dynamics", () => {
    const samples = Float32Array.of(-0.01, -0.005, 0, 0.0025, 0.01);
    normalizeRecordingPcm(samples);
    expect(Array.from(samples)).toEqual([
      expect.closeTo(-0.8, 6),
      expect.closeTo(-0.4, 6),
      0,
      expect.closeTo(0.2, 6),
      expect.closeTo(0.8, 6),
    ]);
  });
  it("attenuates full-scale input and is idempotent even for very quiet PCM", () => {
    for (const peak of [1, 0.01, 0.001]) {
      const samples = Float32Array.of(-peak, peak / 2, peak);
      normalizeRecordingPcm(samples);
      expect(Math.max(...samples)).toBeCloseTo(RECORDING_PEAK_TARGET, 6);
      const previous = samples.slice();
      normalizeRecordingPcm(samples);
      expect(samples).toEqual(previous);
    }
  });
  it("preserves silence and rejects nonfinite values without contaminating valid PCM", () => {
    expect(recordingNormalizationGain(0.001)).toBe(800);
    expect(recordingNormalizationGain(0.01)).toBe(80);
    for (const peak of [0, 0.00001, Number.NaN, Infinity])
      expect(recordingNormalizationGain(peak)).toBe(1);
    const silent = Float32Array.of(0, Number.NaN, Infinity, -Infinity);
    normalizeRecordingPcm(silent);
    expect(silent).toEqual(new Float32Array(4));
    const tiny = Float32Array.of(-0.00001, 0.00001);
    const previous = tiny.slice();
    normalizeRecordingPcm(tiny);
    expect(tiny).toEqual(previous);
    const mixed = Float32Array.of(Number.NaN, 0.01, Infinity);
    normalizeRecordingPcm(mixed);
    expect(Array.from(mixed)).toEqual([0, expect.closeTo(0.8, 6), 0]);
  });
});
