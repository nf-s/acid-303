import { z } from "zod";

export const CUSTOM_SAMPLE_RATE = 24000;
export const CUSTOM_SAMPLE_SECONDS = 10;
export const MAX_CUSTOM_SAMPLE_BYTES =
  44 + CUSTOM_SAMPLE_RATE * CUSTOM_SAMPLE_SECONDS * 2;
export const sampleIdSchema = z.string().regex(/^[a-f0-9]{32}$/);
export const sampleTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const sampleFields = {
  id: sampleIdSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().trim().min(1).max(40),
  duration: z.number().min(0.05).max(CUSTOM_SAMPLE_SECONDS),
  rootNote: z.literal(60),
  peaks: z.array(z.number().finite().min(0).max(1)).length(128),
};
export const localSampleSchema = z.object({
  kind: z.literal("local"),
  ...sampleFields,
});
export const sharedSampleSchema = z.object({
  kind: z.literal("shared"),
  ...sampleFields,
  readToken: sampleTokenSchema,
});
export const customSampleSchema = z.discriminatedUnion("kind", [
  localSampleSchema,
  sharedSampleSchema,
]);
export type LocalSample = z.infer<typeof localSampleSchema>;
export type SharedSample = z.infer<typeof sharedSampleSchema>;
export type CustomSample = z.infer<typeof customSampleSchema>;

export function sampleSourceKey(sample: CustomSample): string {
  return `${sample.kind}:${sample.id}:${sample.sha256}`;
}
export function sampleShard(id: string): number {
  return Number.parseInt(sampleIdSchema.parse(id).slice(0, 1), 16) % 8;
}
export async function sampleDigest(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
/** Only the app's fixed, uncompressed mono PCM format is accepted remotely. */
export function inspectCustomWav(bytes: ArrayBuffer): {
  duration: number;
  peaks: number[];
} {
  if (
    bytes.byteLength < 44 + CUSTOM_SAMPLE_RATE * 0.05 * 2 ||
    bytes.byteLength > MAX_CUSTOM_SAMPLE_BYTES
  )
    throw new Error("Record between 0.05 and 10 seconds.");
  const view = new DataView(bytes);
  const text = (offset: number, value: string) =>
    [...value].every(
      (char, index) => view.getUint8(offset + index) === char.charCodeAt(0),
    );
  const dataSize = bytes.byteLength - 44;
  if (
    !text(0, "RIFF") ||
    !text(8, "WAVE") ||
    !text(12, "fmt ") ||
    !text(36, "data") ||
    view.getUint32(4, true) !== bytes.byteLength - 8 ||
    view.getUint32(16, true) !== 16 ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    view.getUint32(24, true) !== CUSTOM_SAMPLE_RATE ||
    view.getUint32(28, true) !== CUSTOM_SAMPLE_RATE * 2 ||
    view.getUint16(32, true) !== 2 ||
    view.getUint16(34, true) !== 16 ||
    view.getUint32(40, true) !== dataSize ||
    dataSize % 2 !== 0
  )
    throw new Error("The recording has an invalid WAV format.");
  const frames = dataSize / 2;
  const peaks = Array.from({ length: 128 }, (_, bucket) => {
    let peak = 0;
    for (
      let frame = Math.floor((bucket * frames) / 128);
      frame < Math.floor(((bucket + 1) * frames) / 128);
      frame++
    )
      peak = Math.max(
        peak,
        Math.abs(view.getInt16(44 + frame * 2, true)) / 32768,
      );
    return Math.round(peak * 1000) / 1000;
  });
  return { duration: frames / CUSTOM_SAMPLE_RATE, peaks };
}
