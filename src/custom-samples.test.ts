import { afterEach, expect, it, vi } from "vitest";
import {
  localSampleSchema,
  inspectCustomWav,
  sampleDigest,
} from "./custom-sample-schema";
import type { StoredRecording } from "./custom-sample-store";
import { encodeWav } from "./wav";

const store = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  save: vi.fn(),
}));
vi.mock("./custom-sample-store", () => ({
  getRecording: store.get,
  listRecordings: store.list,
  saveRecording: store.save,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

it("deletion waits for an accepted upload, reads its new credentials and prevents a new share racing it", async () => {
  const blob = encodeWav([new Float32Array(2400)], 24000),
    bytes = await blob.arrayBuffer();
  const sample = localSampleSchema.parse({
    kind: "local",
    id: "a".repeat(32),
    sha256: await sampleDigest(bytes),
    name: "Test",
    rootNote: 60,
    ...inspectCustomWav(bytes),
  });
  let record: StoredRecording = { sample, blob, createdAt: Date.now() };
  store.get.mockImplementation(async (id: string) =>
    id === record.sample.id ? record : null,
  );
  store.list.mockImplementation(async () => [record]);
  store.save.mockImplementation(async (next: StoredRecording) => {
    record = structuredClone(next);
  });
  let accept = () => {},
    started = () => {};
  const accepted = new Promise<void>((resolve) => {
      accept = resolve;
    }),
    uploading = new Promise<void>((resolve) => {
      started = resolve;
    });
  let uploadedId = "",
    uploadedOwner = "",
    deletedId = "",
    deletedOwner = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const id = new URL(url).pathname.split("/").at(-1) ?? "",
        headers = new Headers(init?.headers);
      if (init?.method === "PUT") {
        uploadedId = id;
        uploadedOwner = headers.get("Authorization") ?? "";
        started();
        await accepted;
        return Response.json({
          sha256: sample.sha256,
          duration: sample.duration,
          peaks: sample.peaks,
          expiresAt: Date.now() + 86400000,
        });
      }
      if (init?.method === "DELETE") {
        deletedId = id;
        deletedOwner = headers.get("Authorization") ?? "";
        return new Response(null, { status: 204 });
      }
      throw new Error("Unexpected request");
    }),
  );
  const { ensureSharedSample, deleteSharedRecording } =
    await import("./custom-samples");
  const sharing = ensureSharedSample(sample);
  await uploading;
  const removing = deleteSharedRecording(record);
  expect(() => ensureSharedSample(sample)).toThrow("finish deleting");
  expect(deletedId).toBe("");
  accept();
  await sharing;
  await removing;
  expect(deletedId === uploadedId && deletedOwner === uploadedOwner).toBe(true);
  expect(record.upload).toBeUndefined();
  expect(record.shared).toBeUndefined();
});

it("deletes a pending renewal with its matching ID rather than the expired shared ID", async () => {
  const blob = encodeWav([new Float32Array(2400)], 24000),
    bytes = await blob.arrayBuffer();
  const sample = localSampleSchema.parse({
    kind: "local",
    id: "a".repeat(32),
    sha256: await sampleDigest(bytes),
    name: "Test",
    rootNote: 60,
    ...inspectCustomWav(bytes),
  });
  let record: StoredRecording = {
    sample,
    blob,
    createdAt: Date.now(),
    shared: {
      ...sample,
      kind: "shared",
      id: "b".repeat(32),
      readToken: "r".repeat(43),
    },
    upload: {
      id: "c".repeat(32),
      ownerToken: "o".repeat(43),
      readToken: "s".repeat(43),
    },
  };
  store.get.mockImplementation(async () => record);
  store.list.mockImplementation(async () => [record]);
  store.save.mockImplementation(async (next: StoredRecording) => {
    record = next;
  });
  let deleted = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe("DELETE");
      expect(
        new Headers(init?.headers).get("Authorization") ===
          `Bearer ${"o".repeat(43)}`,
      ).toBe(true);
      deleted = new URL(url).pathname;
      return new Response(null, { status: 204 });
    }),
  );
  const { deleteSharedRecording } = await import("./custom-samples");
  await deleteSharedRecording(record);
  expect(deleted).toBe(`/samples/${"c".repeat(32)}`);
  expect(record.upload).toBeUndefined();
});
