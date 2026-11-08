import { env } from "cloudflare:workers";
import {
  SELF,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { encodeWav } from "../../../src/wav";
import { sampleDigest, sampleShard } from "../../../src/custom-sample-schema";

const origin = "https://acid-303.pages.dev",
  readToken = "r".repeat(43),
  ownerToken = "o".repeat(43);
let ip = 0;
function id(shard = 0): string {
  return shard.toString(16) + crypto.randomUUID().replaceAll("-", "").slice(1);
}
async function wav(): Promise<ArrayBuffer> {
  return encodeWav(
    [
      Float32Array.from(
        { length: 2400 },
        (_, frame) => Math.sin(frame / 12) * 0.4,
      ),
    ],
    24000,
  ).arrayBuffer();
}
function headers(token = ownerToken): HeadersInit {
  return {
    Origin: origin,
    Authorization: `Bearer ${token}`,
    "Content-Type": "audio/wav",
    "X-Sample-Read-Token": readToken,
    "CF-Connecting-IP": `192.0.2.${++ip}`,
  };
}
async function put(sampleId: string, bytes?: ArrayBuffer): Promise<Response> {
  return SELF.fetch(`https://samples.test/samples/${sampleId}`, {
    method: "PUT",
    headers: headers(),
    body: bytes ?? (await wav()),
  });
}
async function get(sampleId: string, token = readToken): Promise<Response> {
  return SELF.fetch(`https://samples.test/samples/${sampleId}`, {
    headers: headers(token),
  });
}
beforeEach(async () => {
  for (let shard = 0; shard < 8; shard++) {
    const stub = env.SAMPLES.getByName(`samples-${shard}`);
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.deleteAll();
    });
    await evictDurableObject(stub);
  }
});
describe("private recorded samples", () => {
  it("stores canonical PCM, keeps capabilities hashed, survives eviction and separates read/delete permissions", async () => {
    const sampleId = id(),
      bytes = await wav();
    const uploaded = await put(sampleId, bytes);
    expect(uploaded.status).toBe(201);
    const stub = env.SAMPLES.getByName("samples-0");
    const stored = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ read_hash: string; owner_hash: string }>(
          "SELECT read_hash, owner_hash FROM samples",
        )
        .one(),
    );
    expect(stored.read_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.owner_hash).not.toBe(ownerToken);
    await evictDurableObject(stub);
    const loaded = await get(sampleId);
    expect(loaded.status).toBe(200);
    expect(loaded.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await sampleDigest(await loaded.arrayBuffer())).toBe(
      await sampleDigest(bytes),
    );
    expect((await get(sampleId, ownerToken)).status).toBe(403);
    const denied = await SELF.fetch(
      `https://samples.test/samples/${sampleId}`,
      { method: "DELETE", headers: headers(readToken) },
    );
    expect(denied.status).toBe(403);
    const removed = await SELF.fetch(
      `https://samples.test/samples/${sampleId}`,
      { method: "DELETE", headers: headers() },
    );
    expect(removed.status).toBe(204);
    expect((await get(sampleId)).status).toBe(404);
  });
  it("makes concurrent upload retries idempotent and rejects different audio at an existing ID", async () => {
    const sampleId = id(),
      bytes = await wav();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => put(sampleId, bytes)),
    );
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 200, 200, 201,
    ]);
    const changed = bytes.slice(0);
    new DataView(changed).setInt16(50, 18000, true);
    expect((await put(sampleId, changed)).status).toBe(409);
    const counts = await runInDurableObject(
      env.SAMPLES.getByName("samples-0"),
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number; uploads: number }>(
            "SELECT count, uploads FROM sample_totals",
          )
          .one(),
    );
    expect(counts).toEqual({ count: 1, uploads: 1 });
  });
  it("enforces the per-shard daily quota atomically and persists it across restarts", async () => {
    const bytes = await wav();
    const results = await Promise.all(
      Array.from({ length: 16 }, () => put(id(), bytes)),
    );
    expect(results.filter((response) => response.status === 201)).toHaveLength(
      12,
    );
    expect(results.filter((response) => response.status === 429)).toHaveLength(
      4,
    );
    await evictDurableObject(env.SAMPLES.getByName("samples-0"));
    expect((await put(id())).status).toBe(429);
    expect((await put(id(1))).status).toBe(201);
  });
  it("enforces stored count and byte budgets independently", async () => {
    const sampleId = id();
    expect((await put(sampleId)).status).toBe(201);
    const stub = env.SAMPLES.getByName("samples-0");
    await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql.exec(
        "UPDATE sample_totals SET count = 64 WHERE id = 1",
      ),
    );
    expect((await put(id())).status).toBe(507);
    await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql.exec(
        "UPDATE sample_totals SET count = 1, bytes = 33554432 WHERE id = 1",
      ),
    );
    expect((await put(id())).status).toBe(507);
  });
  it("refreshes expiry at most daily, denies expired data and reclaims rows with an indexed alarm", async () => {
    const sampleId = id();
    await put(sampleId);
    const stub = env.SAMPLES.getByName("samples-0"),
      day = Math.floor(Date.now() / 86400000);
    await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql.exec(
        "UPDATE samples SET touched_day = ?, expires_at = ?",
        day - 1,
        Date.now() + 60000,
      ),
    );
    expect((await get(sampleId)).status).toBe(200);
    const refreshed = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ expires_at: number; touched_day: number }>(
          "SELECT expires_at, touched_day FROM samples",
        )
        .one(),
    );
    expect(refreshed).toEqual({
      touched_day: day,
      expires_at: (day + 31) * 86400000,
    });
    await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql.exec("UPDATE samples SET expires_at = 1"),
    );
    expect((await get(sampleId)).status).toBe(410);
    const second = id();
    await put(second);
    await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql.exec("UPDATE samples SET expires_at = 1"),
    );
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await get(second)).status).toBe(404);
    const counts = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ count: number; bytes: number }>(
          "SELECT count, bytes FROM sample_totals",
        )
        .one(),
    );
    expect(counts).toEqual({ count: 0, bytes: 0 });
  });
  it("uses indexed primary-key and expiry lookups at the full64-record capacity", async () => {
    const sampleId = id();
    await put(sampleId);
    const evidence = await runInDurableObject(
      env.SAMPLES.getByName("samples-0"),
      (_instance, state) => {
        for (let index = 1; index < 64; index++)
          state.storage.sql.exec(
            "INSERT INTO samples SELECT ?, read_hash, owner_hash, sha256, bytes, duration, peaks, wav, expires_at, touched_day FROM samples WHERE id = ?",
            `${index}`.padStart(32, "0"),
            sampleId,
          );
        const read = state.storage.sql.exec(
          "SELECT read_hash, owner_hash, expires_at FROM samples WHERE id = ?",
          sampleId,
        );
        read.toArray();
        const expiry = state.storage.sql.exec(
          "SELECT expires_at FROM samples ORDER BY expires_at, id LIMIT 1",
        );
        expiry.toArray();
        const plan = state.storage.sql
          .exec<{ detail: string }>(
            "EXPLAIN QUERY PLAN SELECT id, bytes FROM samples WHERE expires_at <= ? ORDER BY expires_at, id LIMIT 64",
            Date.now(),
          )
          .toArray();
        return {
          read: read.rowsRead,
          expiry: expiry.rowsRead,
          plan: plan.map((row) => row.detail),
        };
      },
    );
    expect(evidence.read).toBeLessThanOrEqual(1);
    expect(evidence.expiry).toBeLessThanOrEqual(1);
    expect(evidence.plan.join(" ")).toContain("samples_expiry");
  });
  it("requires the allowed origin and valid fixed WAV format including streamed actual-size limits", async () => {
    const sampleId = id();
    expect(
      (
        await SELF.fetch(`https://samples.test/samples/${sampleId}`, {
          method: "PUT",
          headers: { ...headers(), Origin: "https://example.com" },
          body: await wav(),
        })
      ).status,
    ).toBe(403);
    const stereo = await encodeWav(
      [new Float32Array(2400), new Float32Array(2400)],
      24000,
    ).arrayBuffer();
    expect((await put(sampleId, stereo)).status).toBe(400);
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(480045));
        controller.close();
      },
    });
    expect(
      (
        await SELF.fetch(`https://samples.test/samples/${sampleId}`, {
          method: "PUT",
          headers: headers(),
          body: oversized,
        })
      ).status,
    ).toBe(400);
    expect(sampleShard(sampleId)).toBe(0);
  });
});
