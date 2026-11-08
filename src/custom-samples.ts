import { z } from "zod";
import {
  customSampleSchema,
  inspectCustomWav,
  MAX_CUSTOM_SAMPLE_BYTES,
  sampleDigest,
  sharedSampleSchema,
} from "./custom-sample-schema";
import type { CustomSample, SharedSample } from "./custom-sample-schema";
import {
  getRecording,
  listRecordings,
  saveRecording,
} from "./custom-sample-store";
import type { StoredRecording } from "./custom-sample-store";

let api = "https://grain-sessions.nf-s.workers.dev";
class SampleRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export function configureSampleApi(value: string): void {
  api = value.replace(/\/$/, "");
}
const uploadResponseSchema = z.object({
  sha256: sharedSampleSchema.shape.sha256,
  duration: sharedSampleSchema.shape.duration,
  peaks: sharedSampleSchema.shape.peaks,
  expiresAt: z.number().finite().positive(),
});
function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException("Recording loading cancelled", "AbortError");
}
async function requestSample(
  path: string,
  options: RequestInit,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  cancelled(signal);
  const controller = new AbortController(),
    cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(cancel, 15000);
  try {
    const response = await fetch(`${api}${path}`, {
      ...options,
      signal: controller.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (response.status === 204) return new ArrayBuffer(0);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The shared recording is unavailable.");
    const parts: Uint8Array[] = [];
    let count = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        count += part.value.byteLength;
        if (count > MAX_CUSTOM_SAMPLE_BYTES) {
          await reader.cancel();
          throw new Error("The shared recording is too large.");
        }
        parts.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const output = new Uint8Array(count);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.byteLength;
    }
    if (!response.ok) {
      let message =
        response.status === 404 || response.status === 410
          ? "This shared recording has expired or was deleted. Choose another recording."
          : "The recording could not be shared. Try again.";
      try {
        const error = z
          .object({ error: z.string().max(240) })
          .safeParse(JSON.parse(new TextDecoder().decode(output)));
        if (error.success) message = error.data.error;
      } catch {
        /* The status still provides a useful failure when a gateway returns HTML. */
      }
      throw new SampleRequestError(message, response.status);
    }
    cancelled(signal);
    return output.buffer;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}
function token(): string {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
async function findRecording(
  sample: CustomSample,
): Promise<StoredRecording | null> {
  const direct = await getRecording(sample.id);
  if (direct?.sample.sha256 === sample.sha256) return direct;
  return (
    (await listRecordings()).find(
      (record) =>
        record.shared?.id === sample.id &&
        record.shared.sha256 === sample.sha256,
    ) ?? null
  );
}
const sharing = new Map<string, Promise<SharedSample>>();
const deleting = new Set<string>();
export function ensureSharedSample(
  input: CustomSample,
  signal?: AbortSignal,
): Promise<SharedSample> {
  const sample = customSampleSchema.parse(input);
  cancelled(signal);
  if (deleting.has(sample.sha256))
    throw new Error("Wait for the shared copy to finish deleting.");
  const key = `${sample.id}:${sample.sha256}`;
  const pending = sharing.get(key);
  if (pending) return pending;
  const operation = uploadSample(sample, signal).finally(() =>
    sharing.delete(key),
  );
  sharing.set(key, operation);
  return operation;
}
async function uploadSample(
  input: CustomSample,
  signal?: AbortSignal,
): Promise<SharedSample> {
  const sample = customSampleSchema.parse(input);
  cancelled(signal);
  let record: StoredRecording | null = null;
  try {
    record = await findRecording(sample);
  } catch (error) {
    if (sample.kind === "local") throw error;
  }
  if (record?.shared && record.shared.id !== sample.id)
    return uploadSample(record.shared, signal);
  if (sample.kind === "shared") {
    try {
      const existing = await requestSample(
        `/samples/${sample.id}`,
        { headers: { Authorization: `Bearer ${sample.readToken}` } },
        signal,
      );
      if ((await sampleDigest(existing)) !== sample.sha256)
        throw new Error("The shared recording does not match this project.");
      if (record)
        await saveRecording({
          ...record,
          sharedExpiresAt: Date.now() + 30 * 86400000,
          lastRemoteAccessDay: Math.floor(Date.now() / 86400000),
        });
      return sample;
    } catch (error) {
      if (
        !(error instanceof SampleRequestError) ||
        ![404, 410].includes(error.status) ||
        !record
      )
        throw error;
    }
  }
  if (!record)
    throw new Error(
      "This recording is missing from this device. Record it again before sharing.",
    );
  const upload =
    record.upload && record.upload.id !== record.shared?.id
      ? record.upload
      : {
          id: crypto.randomUUID().replaceAll("-", ""),
          readToken: token(),
          ownerToken: token(),
        };
  await saveRecording({ ...record, upload });
  const bytes = await record.blob.arrayBuffer();
  inspectCustomWav(bytes);
  if ((await sampleDigest(bytes)) !== sample.sha256)
    throw new Error(
      "This recording is damaged. Record it again before sharing.",
    );
  const replyBytes = await requestSample(
    `/samples/${upload.id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "audio/wav",
        Authorization: `Bearer ${upload.ownerToken}`,
        "X-Sample-Read-Token": upload.readToken,
      },
      body: bytes,
    },
    signal,
  );
  const result = uploadResponseSchema.parse(
    JSON.parse(new TextDecoder().decode(replyBytes)),
  );
  if (
    result.sha256 !== sample.sha256 ||
    Math.abs(result.duration - sample.duration) > 1 / 24000
  )
    throw new Error("The uploaded recording did not match. Try again.");
  const shared = sharedSampleSchema.parse({
    ...sample,
    ...result,
    kind: "shared",
    id: upload.id,
    readToken: upload.readToken,
  });
  await saveRecording({
    ...record,
    upload,
    shared,
    sharedExpiresAt: result.expiresAt,
    lastRemoteAccessDay: Math.floor(Date.now() / 86400000),
  });
  cancelled(signal);
  return shared;
}
export async function loadCustomSampleBytes(
  input: CustomSample,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const sample = customSampleSchema.parse(input);
  cancelled(signal);
  let record: StoredRecording | null = null;
  try {
    record = await findRecording(sample);
  } catch {
    /* Shared playback still works if browser storage is unavailable. */
  }
  let bytes: ArrayBuffer;
  if (record) bytes = await record.blob.arrayBuffer();
  else if (sample.kind === "shared")
    bytes = await requestSample(
      `/samples/${sample.id}`,
      { headers: { Authorization: `Bearer ${sample.readToken}` } },
      signal,
    );
  else
    throw new Error(
      "This recording is missing from this device. Choose another recording.",
    );
  cancelled(signal);
  const metadata = inspectCustomWav(bytes);
  if (
    (await sampleDigest(bytes)) !== sample.sha256 ||
    Math.abs(metadata.duration - sample.duration) > 1 / 24000
  )
    throw new Error(
      "The recording does not match this project. Choose another recording.",
    );
  if (
    record &&
    sample.kind === "shared" &&
    (record.lastRemoteAccessDay ?? -1) < Math.floor(Date.now() / 86400000)
  ) {
    try {
      const refreshed = await requestSample(
        `/samples/${sample.id}`,
        { headers: { Authorization: `Bearer ${sample.readToken}` } },
        signal,
      );
      if ((await sampleDigest(refreshed)) !== sample.sha256)
        throw new Error("The shared recording does not match this project.");
      await saveRecording({
        ...record,
        lastRemoteAccessDay: Math.floor(Date.now() / 86400000),
        sharedExpiresAt: Date.now() + 30 * 86400000,
      });
    } catch {
      cancelled(signal);
    }
  }
  if (!record) {
    try {
      await saveRecording({
        sample,
        blob: new Blob([bytes], { type: "audio/wav" }),
        createdAt: Date.now(),
        lastRemoteAccessDay: Math.floor(Date.now() / 86400000),
      });
    } catch {
      /* A full local cache must not prevent playback of a validated shared recording. */
    }
  }
  cancelled(signal);
  return bytes;
}
export async function deleteSharedRecording(
  record: StoredRecording,
  signal?: AbortSignal,
): Promise<void> {
  const hash = record.sample.sha256;
  if (deleting.has(hash))
    throw new Error("The shared copy is already being deleted.");
  deleting.add(hash);
  try {
    await Promise.allSettled(
      [...sharing]
        .filter(([key]) => key.endsWith(`:${hash}`))
        .map(([, operation]) => operation),
    );
    const latest = await getRecording(record.sample.id);
    if (!latest?.upload) return;
    await requestSample(
      `/samples/${latest.upload.id}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${latest.upload.ownerToken}` },
      },
      signal,
    );
    await saveRecording({
      ...latest,
      shared: undefined,
      upload: undefined,
      sharedExpiresAt: undefined,
    });
  } finally {
    deleting.delete(hash);
  }
}
