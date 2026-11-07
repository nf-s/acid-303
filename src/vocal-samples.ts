import { z } from "zod";
import { VOCAL_BANKS, VOCAL_SOUNDS } from "./vocal-model";

export interface VocalSampleStatus {
  sound: number;
  phase: "idle" | "loading" | "ready" | "error";
  message: string;
}
const sampleSchema = z.object({
  id: z.string().regex(/^(female|male|fighter)-[a-z-]+$/),
  name: z.string().min(1).max(40),
  voice: z.enum(["female", "male", "fighter"]),
  url: z
    .string()
    .regex(/^\/vocals\/audio\/(female|male|fighter)-[a-z-]+\.wav$/),
  duration: z.number().positive().max(3),
  rootNote: z.literal(60),
  peak: z.number().positive().max(1),
  rms: z.number().positive().max(1),
  peaks: z.array(z.number().min(0).max(1)).length(128),
});
const catalogSchema = z.object({
  version: z.literal(1),
  samples: z
    .array(sampleSchema)
    .length(VOCAL_SOUNDS.length)
    .refine((samples) =>
      samples.every(
        (sample, index) =>
          sample.name === VOCAL_SOUNDS[index] &&
          sample.voice ===
            VOCAL_BANKS.find(
              (bank) => index >= bank.start && index < bank.start + bank.count,
            )?.id &&
          sample.url === `/vocals/audio/${sample.id}.wav`,
      ),
    ),
});
export type VocalSample = z.infer<typeof sampleSchema>;
export type VocalCatalog = z.infer<typeof catalogSchema>;
export interface LoadedVocalSample {
  sample: VocalSample;
  buffer: AudioBuffer;
}
const MAX_DOWNLOAD_BYTES = 256 * 1024;
const TIMEOUT_MS = 8000;
let catalog: VocalCatalog | null = null;
const encodedSamples = new Map<number, ArrayBuffer>();
const decodedSamples = new WeakMap<
  BaseAudioContext,
  Map<number, LoadedVocalSample>
>();

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException("Vocal loading cancelled", "AbortError");
}
async function download(
  url: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  cancelled(signal);
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: "same-origin",
    });
    if (!response.ok)
      throw new Error("The vocal sample could not be downloaded. Try again.");
    const length = Number(response.headers.get("Content-Length"));
    if (length > MAX_DOWNLOAD_BYTES)
      throw new Error("The vocal sample is too large.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The vocal sample is empty.");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_DOWNLOAD_BYTES) {
          await reader.cancel();
          throw new Error("The vocal sample is too large.");
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const output = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    cancelled(signal);
    return output.buffer;
  } catch (error) {
    cancelled(signal);
    if (timedOut) throw new Error("Vocal loading timed out. Try again.");
    if (error instanceof Error) throw error;
    throw new Error("The vocal sample could not be loaded. Try again.");
  } finally {
    clearTimeout(timer);
    controller.abort();
    signal?.removeEventListener("abort", cancel);
  }
}
/** Metadata and waveform peaks require neither decoding nor an AudioContext. */
export async function loadVocalCatalog(
  signal?: AbortSignal,
): Promise<VocalCatalog> {
  cancelled(signal);
  if (catalog) return catalog;
  const bytes = await download("/vocals/catalog.json", signal);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("The vocal catalog is invalid. Reload Grain to retry.");
  }
  const parsed = catalogSchema.safeParse(value);
  if (!parsed.success)
    throw new Error("The vocal catalog is invalid. Reload Grain to retry.");
  catalog = parsed.data;
  return catalog;
}
export function cachedVocalSample(
  context: BaseAudioContext,
  sound: number,
): LoadedVocalSample | null {
  return decodedSamples.get(context)?.get(sound) ?? null;
}
export async function loadVocalSample(
  context: BaseAudioContext,
  sound: number,
  signal?: AbortSignal,
): Promise<LoadedVocalSample> {
  cancelled(signal);
  if (!Number.isInteger(sound) || sound < 0 || sound >= VOCAL_SOUNDS.length)
    throw new Error("Choose an available vocal sample.");
  const cached = cachedVocalSample(context, sound);
  if (cached) return cached;
  const metadata = await loadVocalCatalog(signal);
  const sample = metadata.samples[sound];
  if (!sample) throw new Error("Choose an available vocal sample.");
  let bytes = encodedSamples.get(sound);
  if (!bytes) {
    bytes = await download(sample.url, signal);
    encodedSamples.set(sound, bytes);
  }
  cancelled(signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectCancelled: (() => void) | undefined;
  const cancel = () => rejectCancelled?.();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const buffer = await Promise.race([
      context.decodeAudioData(bytes.slice(0)),
      new Promise<never>((_resolve, reject) => {
        rejectCancelled = () =>
          reject(new DOMException("Vocal loading cancelled", "AbortError"));
        timer = setTimeout(
          () => reject(new Error("Vocal decoding timed out. Try again.")),
          TIMEOUT_MS,
        );
      }),
    ]);
    cancelled(signal);
    if (
      buffer.numberOfChannels !== 1 ||
      Math.abs(buffer.duration - sample.duration) > 0.03 ||
      !Number.isFinite(buffer.duration)
    )
      throw new Error("The vocal sample has an invalid format.");
    const loaded = { sample, buffer };
    const cache =
      decodedSamples.get(context) ?? new Map<number, LoadedVocalSample>();
    cache.set(sound, loaded);
    decodedSamples.set(context, cache);
    return loaded;
  } catch (error) {
    cancelled(signal);
    if (error instanceof Error && error.message.includes("timed out"))
      throw error;
    encodedSamples.delete(sound);
    throw new Error("The vocal sample could not be decoded. Try again.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
