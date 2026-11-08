import { DurableObject } from "cloudflare:workers";
import {
  inspectCustomWav,
  MAX_CUSTOM_SAMPLE_BYTES,
  sampleDigest,
  sampleIdSchema,
  sampleShard,
  sampleTokenSchema,
} from "../../../src/custom-sample-schema";

const DAY = 86_400_000;
const RETENTION_DAYS = 30;
export const SHARD_SAMPLE_LIMIT = 64;
export const SHARD_BYTE_LIMIT = 32 * 1024 * 1024;
export const SHARD_DAILY_UPLOAD_LIMIT = 12;
interface SampleBindings {
  SAMPLES: DurableObjectNamespace<SampleStore>;
  SAMPLE_UPLOAD_LIMIT: RateLimit;
  SAMPLE_READ_LIMIT: RateLimit;
}
type SampleRow = {
  id: string;
  read_hash: string;
  owner_hash: string;
  sha256: string;
  bytes: number;
  duration: number;
  peaks: string;
  expires_at: number;
  touched_day: number;
};
type Result = { status: number; error: string };
type PutResult =
  | Result
  | {
      status: 201 | 200;
      sha256: string;
      duration: number;
      peaks: number[];
      expiresAt: number;
    };
type GetResult = Result | { status: 200; wav: ArrayBuffer };
type DeleteResult = Result | { status: 204 };
function failure(status: number, error: string): Result {
  return { status, error };
}
function equalHash(left: string, right: string): boolean {
  return crypto.subtle.timingSafeEqual(
    new TextEncoder().encode(left),
    new TextEncoder().encode(right),
  );
}
async function hashToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token),
    buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  return sampleDigest(buffer);
}
/** Eight fixed quota buckets bound anonymous storage without cross-object counters. */
export class SampleStore extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS samples (
        id TEXT PRIMARY KEY, read_hash TEXT NOT NULL, owner_hash TEXT NOT NULL,
        sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, duration REAL NOT NULL,
        peaks TEXT NOT NULL, wav BLOB NOT NULL, expires_at INTEGER NOT NULL, touched_day INTEGER NOT NULL
      )`);
      ctx.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS samples_expiry ON samples(expires_at, id)",
      );
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS sample_totals (id INTEGER PRIMARY KEY CHECK(id = 1), bytes INTEGER NOT NULL, count INTEGER NOT NULL, day INTEGER NOT NULL, uploads INTEGER NOT NULL)",
      );
      ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO sample_totals VALUES (1, 0, 0, 0, 0)",
      );
    });
  }
  private metadata(id: string): SampleRow | undefined {
    return this.ctx.storage.sql
      .exec<SampleRow>(
        "SELECT id, read_hash, owner_hash, sha256, bytes, duration, peaks, expires_at, touched_day FROM samples WHERE id = ?",
        id,
      )
      .toArray()[0];
  }
  private remove(id: string, bytes: number): void {
    this.ctx.storage.sql.exec("DELETE FROM samples WHERE id = ?", id);
    this.ctx.storage.sql.exec(
      "UPDATE sample_totals SET bytes = MAX(0, bytes - ?), count = MAX(0, count - 1) WHERE id = 1",
      bytes,
    );
  }
  private async schedule(): Promise<void> {
    const next = this.ctx.storage.sql
      .exec<{ expires_at: number }>(
        "SELECT expires_at FROM samples ORDER BY expires_at, id LIMIT 1",
      )
      .toArray()[0];
    if (next) await this.ctx.storage.setAlarm(next.expires_at);
    else await this.ctx.storage.deleteAlarm();
  }
  async putSample(
    id: string,
    readToken: string,
    ownerToken: string,
    wav: ArrayBuffer,
  ): Promise<PutResult> {
    sampleIdSchema.parse(id);
    sampleTokenSchema.parse(readToken);
    sampleTokenSchema.parse(ownerToken);
    const metadata = inspectCustomWav(wav);
    const [readHash, ownerHash, sha256] = await Promise.all([
      hashToken(readToken),
      hashToken(ownerToken),
      sampleDigest(wav),
    ]);
    const now = Date.now(),
      day = Math.floor(now / DAY),
      expiresAt = (day + RETENTION_DAYS + 1) * DAY;
    const result = this.ctx.storage.transactionSync((): PutResult => {
      const existing = this.metadata(id);
      if (existing) {
        if (
          !equalHash(existing.owner_hash, ownerHash) ||
          !equalHash(existing.read_hash, readHash)
        )
          return failure(403, "Recording credentials are invalid.");
        if (existing.sha256 !== sha256)
          return failure(
            409,
            "This recording already contains different audio.",
          );
        if (existing.expires_at <= now)
          return failure(410, "The shared recording has expired.");
        return {
          status: 200,
          sha256,
          ...metadata,
          expiresAt: existing.expires_at,
        };
      }
      const totals = this.ctx.storage.sql
        .exec<{ bytes: number; count: number; day: number; uploads: number }>(
          "SELECT bytes, count, day, uploads FROM sample_totals WHERE id = 1",
        )
        .one();
      if (
        totals.count >= SHARD_SAMPLE_LIMIT ||
        totals.bytes + wav.byteLength > SHARD_BYTE_LIMIT
      )
        return failure(
          507,
          "Shared recording storage is full. Keep the recording on this device and try later.",
        );
      const uploads = totals.day === day ? totals.uploads : 0;
      if (uploads >= SHARD_DAILY_UPLOAD_LIMIT)
        return failure(
          429,
          "The daily recording upload limit has been reached. Try tomorrow.",
        );
      this.ctx.storage.sql.exec(
        "INSERT INTO samples VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        readHash,
        ownerHash,
        sha256,
        wav.byteLength,
        metadata.duration,
        JSON.stringify(metadata.peaks),
        wav,
        expiresAt,
        day,
      );
      this.ctx.storage.sql.exec(
        "UPDATE sample_totals SET bytes = bytes + ?, count = count + 1, day = ?, uploads = ? WHERE id = 1",
        wav.byteLength,
        day,
        uploads + 1,
      );
      return { status: 201, sha256, ...metadata, expiresAt };
    });
    await this.schedule();
    return result;
  }
  async getSample(id: string, token: string): Promise<GetResult> {
    sampleIdSchema.parse(id);
    sampleTokenSchema.parse(token);
    const digest = await hashToken(token),
      now = Date.now(),
      day = Math.floor(now / DAY);
    const result = this.ctx.storage.transactionSync((): GetResult => {
      const row = this.metadata(id);
      if (!row) return failure(404, "The shared recording is unavailable.");
      if (!equalHash(row.read_hash, digest))
        return failure(403, "Recording credentials are invalid.");
      if (row.expires_at <= now) {
        this.remove(id, row.bytes);
        return failure(410, "The shared recording has expired.");
      }
      const stored = this.ctx.storage.sql
        .exec<{ wav: ArrayBuffer }>("SELECT wav FROM samples WHERE id = ?", id)
        .one();
      if (row.touched_day < day)
        this.ctx.storage.sql.exec(
          "UPDATE samples SET touched_day = ?, expires_at = ? WHERE id = ?",
          day,
          (day + RETENTION_DAYS + 1) * DAY,
          id,
        );
      return { status: 200, wav: stored.wav };
    });
    // The existing earlier alarm is harmless; it reschedules if a read extended expiry.
    return result;
  }
  async deleteSample(id: string, ownerToken: string): Promise<DeleteResult> {
    sampleIdSchema.parse(id);
    sampleTokenSchema.parse(ownerToken);
    const digest = await hashToken(ownerToken);
    const result = this.ctx.storage.transactionSync((): DeleteResult => {
      const row = this.metadata(id);
      if (!row) return { status: 204 };
      if (!equalHash(row.owner_hash, digest))
        return failure(403, "Recording credentials are invalid.");
      this.remove(id, row.bytes);
      return { status: 204 };
    });
    await this.schedule();
    return result;
  }
  async alarm(): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      const expired = this.ctx.storage.sql
        .exec<{ id: string; bytes: number }>(
          "SELECT id, bytes FROM samples WHERE expires_at <= ? ORDER BY expires_at, id LIMIT 64",
          Date.now(),
        )
        .toArray();
      for (const row of expired) this.remove(row.id, row.bytes);
    });
    await this.schedule();
  }
}
async function readWav(request: Request): Promise<ArrayBuffer> {
  if (
    request.headers.get("Content-Type")?.split(";")[0] !== "audio/wav" ||
    !request.body
  )
    throw new Error("Upload a recorded WAV sample.");
  if (Number(request.headers.get("Content-Length")) > MAX_CUSTOM_SAMPLE_BYTES)
    throw new Error("The recording is too large.");
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0,
    timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel("Upload timed out");
  }, 15000);
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_CUSTOM_SAMPLE_BYTES) {
        await reader.cancel();
        throw new Error("The recording is too large.");
      }
      chunks.push(chunk.value);
    }
    if (timedOut) throw new Error("Recording upload timed out.");
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    inspectCustomWav(output.buffer);
    return output.buffer;
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}
export async function handleSampleRequest(
  request: Request,
  env: SampleBindings,
  origin: string,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/samples/")) return null;
  const headers = {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        "Access-Control-Allow-Methods": "PUT, GET, DELETE",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Sample-Read-Token",
        "Access-Control-Max-Age": "600",
      },
    });
  const id = sampleIdSchema.safeParse(path.slice(9));
  const token = sampleTokenSchema.safeParse(
    request.headers.get("Authorization")?.replace(/^Bearer /, ""),
  );
  if (!id.success || !token.success)
    return Response.json(
      { error: "Invalid recording request." },
      { status: 400, headers },
    );
  const key = request.headers.get("CF-Connecting-IP") ?? "local";
  const limit =
    request.method === "PUT" ? env.SAMPLE_UPLOAD_LIMIT : env.SAMPLE_READ_LIMIT;
  if (!(await limit.limit({ key })).success)
    return Response.json(
      { error: "Try again in a minute." },
      { status: 429, headers },
    );
  const stub = env.SAMPLES.getByName(`samples-${sampleShard(id.data)}`);
  if (request.method === "PUT") {
    const read = sampleTokenSchema.safeParse(
      request.headers.get("X-Sample-Read-Token"),
    );
    if (!read.success)
      return Response.json(
        { error: "Invalid recording credentials." },
        { status: 400, headers },
      );
    let bytes: ArrayBuffer;
    try {
      bytes = await readWav(request);
    } catch (error) {
      return Response.json(
        {
          error: error instanceof Error ? error.message : "Invalid recording.",
        },
        { status: 400, headers },
      );
    }
    const result = await stub.putSample(id.data, read.data, token.data, bytes);
    return Response.json(result, { status: result.status, headers });
  }
  if (request.method === "GET") {
    const result = await stub.getSample(id.data, token.data);
    return "wav" in result
      ? new Response(result.wav, {
          headers: { ...headers, "Content-Type": "audio/wav" },
        })
      : Response.json(result, { status: result.status, headers });
  }
  if (request.method === "DELETE") {
    const result = await stub.deleteSample(id.data, token.data);
    return result.status === 204
      ? new Response(null, { status: 204, headers })
      : Response.json(result, { status: result.status, headers });
  }
  return Response.json(
    { error: "Method not allowed." },
    { status: 405, headers },
  );
}
