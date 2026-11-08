import {
  CUSTOM_SAMPLE_RATE,
  CUSTOM_SAMPLE_SECONDS,
} from "./custom-sample-schema";
import { encodeWav } from "./wav";
import { normalizeRecordingPcm } from "./recording-normalization";

export const MAX_IMPORTED_WAV_BYTES = 2 * 1024 * 1024;
const IMPORT_ERROR =
  "Use a mono or stereo 16-bit PCM WAV at 24, 44.1 or 48 kHz, between 0.05 and 10 seconds (maximum 2 MiB).";
/** Validate chunk boundaries before allocating or decoding any user-selected PCM. */
export function readImportedWav(bytes: ArrayBuffer): {
  samples: Float32Array;
  sampleRate: number;
} {
  if (bytes.byteLength < 44 || bytes.byteLength > MAX_IMPORTED_WAV_BYTES)
    throw new Error(IMPORT_ERROR);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) =>
    [...value].every(
      (char, index) => view.getUint8(offset + index) === char.charCodeAt(0),
    );
  if (
    !text(0, "RIFF") ||
    !text(8, "WAVE") ||
    view.getUint32(4, true) !== bytes.byteLength - 8
  )
    throw new Error(IMPORT_ERROR);
  let channels = 0,
    rate = 0,
    dataStart = -1,
    dataBytes = 0,
    formatFound = false,
    offset = 12;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new Error(IMPORT_ERROR);
    const size = view.getUint32(offset + 4, true),
      start = offset + 8,
      end = start + size;
    if (end > bytes.byteLength) throw new Error(IMPORT_ERROR);
    if (text(offset, "fmt ")) {
      if (formatFound || size < 16) throw new Error(IMPORT_ERROR);
      formatFound = true;
      channels = view.getUint16(start + 2, true);
      rate = view.getUint32(start + 4, true);
      if (
        view.getUint16(start, true) !== 1 ||
        ![1, 2].includes(channels) ||
        ![24000, 44100, 48000].includes(rate) ||
        view.getUint16(start + 14, true) !== 16 ||
        view.getUint16(start + 12, true) !== channels * 2 ||
        view.getUint32(start + 8, true) !== rate * channels * 2
      )
        throw new Error(IMPORT_ERROR);
    } else if (text(offset, "data")) {
      if (dataStart !== -1) throw new Error(IMPORT_ERROR);
      dataStart = start;
      dataBytes = size;
    }
    offset = end + (size % 2);
    if (offset > bytes.byteLength) throw new Error(IMPORT_ERROR);
  }
  if (!formatFound || dataStart < 0 || dataBytes % (channels * 2) !== 0)
    throw new Error(IMPORT_ERROR);
  const frames = dataBytes / (channels * 2),
    duration = frames / rate;
  if (duration < 0.05 || duration > CUSTOM_SAMPLE_SECONDS)
    throw new Error(IMPORT_ERROR);
  const samples = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++)
      sum +=
        view.getInt16(dataStart + (frame * channels + channel) * 2, true) /
        32768;
    samples[frame] = sum / channels;
  }
  return { samples, sampleRate: rate };
}
export async function resampleRecording(
  samples: Float32Array,
  rate: number,
): Promise<Blob> {
  if (
    !Number.isFinite(rate) ||
    rate < 8000 ||
    rate > 192000 ||
    samples.length < rate * 0.05 ||
    samples.length > rate * CUSTOM_SAMPLE_SECONDS
  )
    throw new Error("Record between 0.05 and 10 seconds.");
  const frames = Math.min(
    CUSTOM_SAMPLE_RATE * CUSTOM_SAMPLE_SECONDS,
    Math.round((samples.length * CUSTOM_SAMPLE_RATE) / rate),
  );
  const offline = new OfflineAudioContext(1, frames, CUSTOM_SAMPLE_RATE),
    buffer = offline.createBuffer(1, samples.length, rate);
  const input = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index++) {
    const value = samples[index];
    input[index] = value !== undefined && Number.isFinite(value) ? value : 0;
  }
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const normalized = rendered.getChannelData(0);
  normalizeRecordingPcm(normalized);
  return encodeWav([normalized], CUSTOM_SAMPLE_RATE);
}
export async function normalizeImportedWav(file: Blob): Promise<Blob> {
  if (file.size > MAX_IMPORTED_WAV_BYTES) throw new Error(IMPORT_ERROR);
  const input = readImportedWav(await file.arrayBuffer());
  return resampleRecording(input.samples, input.sampleRate);
}
