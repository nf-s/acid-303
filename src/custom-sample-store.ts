import { z } from "zod";
import {
  customSampleSchema,
  inspectCustomWav,
  localSampleSchema,
  MAX_CUSTOM_SAMPLE_BYTES,
  sampleDigest,
  sampleTokenSchema,
  sharedSampleSchema,
} from "./custom-sample-schema";
import type { LocalSample } from "./custom-sample-schema";

const recordSchema = z.object({
  sample: customSampleSchema,
  createdAt: z.number().finite().positive(),
  blob: z.instanceof(Blob),
  shared: sharedSampleSchema.optional(),
  sharedExpiresAt: z.number().finite().positive().optional(),
  lastRemoteAccessDay: z.number().int().nonnegative().optional(),
  upload: z
    .object({
      id: localSampleSchema.shape.id,
      readToken: sampleTokenSchema,
      ownerToken: sampleTokenSchema,
    })
    .optional(),
});
export type StoredRecording = z.infer<typeof recordSchema>;
const storedSchema = recordSchema
  .omit({ blob: true })
  .extend({ bytes: z.instanceof(ArrayBuffer) });
function readStored(value: unknown): StoredRecording | null {
  const stored = storedSchema.safeParse(value);
  if (stored.success) {
    const { bytes, ...metadata } = stored.data;
    return { ...metadata, blob: new Blob([bytes], { type: "audio/wav" }) };
  }
  const legacy = recordSchema.safeParse(value);
  return legacy.success ? legacy.data : null;
}
let database: Promise<IDBDatabase> | undefined;
const listeners = new Set<() => void>();
export function subscribeRecordings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function changed(): void {
  for (const listener of listeners) listener();
}
function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("grain-recordings", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("recordings", { keyPath: "sample.id" });
    };
    request.onerror = () =>
      reject(new Error("Recordings could not be saved on this device."));
    request.onblocked = () =>
      reject(new Error("Close other Grain tabs and try saving again."));
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        database = undefined;
      };
      resolve(request.result);
    };
  }).catch((error: unknown) => {
    database = undefined;
    throw error;
  });
  return database;
}
export async function getRecording(
  id: string,
): Promise<StoredRecording | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("recordings")
      .objectStore("recordings")
      .get(id);
    request.onerror = () =>
      reject(new Error("The recording could not be read."));
    request.onsuccess = () => {
      resolve(readStored(request.result));
    };
  });
}
export async function listRecordings(): Promise<StoredRecording[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("recordings")
      .objectStore("recordings")
      .getAll();
    request.onerror = () => reject(new Error("Recordings could not be read."));
    request.onsuccess = () => {
      const values: unknown = request.result;
      resolve(
        Array.isArray(values)
          ? values
              .flatMap((value: unknown) => {
                const parsed = readStored(value);
                return parsed ? [parsed] : [];
              })
              .sort((left, right) => right.createdAt - left.createdAt)
          : [],
      );
    };
  });
}
export async function saveRecording(value: StoredRecording): Promise<void> {
  const record = recordSchema.parse(value);
  const bytes = await record.blob.arrayBuffer();
  inspectCustomWav(bytes);
  const { blob: _blob, ...metadata } = record;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("recordings", "readwrite"),
      store = transaction.objectStore("recordings");
    const count = store.count();
    count.onsuccess = () => {
      const existing = store.get(record.sample.id);
      existing.onsuccess = () => {
        if (!existing.result && count.result >= 24) {
          transaction.abort();
          return;
        }
        store.put({ ...metadata, bytes });
      };
    };
    transaction.oncomplete = () => {
      changed();
      resolve();
    };
    transaction.onabort = transaction.onerror = () =>
      reject(
        new Error(
          "Recording storage is full. Delete a recording or free device storage.",
        ),
      );
  });
}
export async function deleteLocalRecording(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("recordings", "readwrite");
    transaction.objectStore("recordings").delete(id);
    transaction.oncomplete = () => {
      changed();
      resolve();
    };
    transaction.onabort = transaction.onerror = () =>
      reject(new Error("The recording could not be deleted."));
  });
}
export async function storeCapturedRecording(
  blob: Blob,
  name: string,
): Promise<LocalSample> {
  if (blob.size > MAX_CUSTOM_SAMPLE_BYTES)
    throw new Error(
      "Use a mono 24 kHz, 16-bit PCM WAV between 0.05 and 10 seconds.",
    );
  const bytes = await blob.arrayBuffer(),
    metadata = inspectCustomWav(bytes);
  const sample = localSampleSchema.parse({
    kind: "local",
    id: crypto.randomUUID().replaceAll("-", ""),
    sha256: await sampleDigest(bytes),
    name,
    rootNote: 60,
    ...metadata,
  });
  await saveRecording({
    sample,
    blob: new Blob([bytes], { type: "audio/wav" }),
    createdAt: Date.now(),
  });
  return sample;
}
