export const RECORDING_PEAK_TARGET = 0.8;
const MIN_RECORDING_PEAK = 0.0001;

/** Keep near-silence quiet and leave headroom above the recording's peak. */
export function recordingNormalizationGain(peak: number): number {
  if (!Number.isFinite(peak) || peak < MIN_RECORDING_PEAK) return 1;
  return RECORDING_PEAK_TARGET / peak;
}

/** Normalize an owned PCM buffer; stored source bytes and references stay intact. */
export function normalizeRecordingPcm(samples: Float32Array): void {
  let peak = 0;
  for (const value of samples)
    if (Number.isFinite(value)) peak = Math.max(peak, Math.abs(value));
  const gain = recordingNormalizationGain(peak);
  for (let index = 0; index < samples.length; index++) {
    const value = samples[index];
    samples[index] =
      value !== undefined && Number.isFinite(value) ? value * gain : 0;
  }
}
