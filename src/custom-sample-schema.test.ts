import { describe, expect, it } from "vitest";
import { encodeWav } from "./wav";
import {
  customSampleSchema,
  inspectCustomWav,
  MAX_CUSTOM_SAMPLE_BYTES,
  sampleDigest,
  sampleShard,
} from "./custom-sample-schema";

describe("recorded sample boundary", () => {
  it("accepts ten seconds of canonical PCM and computes bounded waveform peaks", async () => {
    const channel = new Float32Array(240000);
    channel[120000] = -1;
    const bytes = await encodeWav([channel], 24000).arrayBuffer();
    expect(bytes.byteLength).toBe(MAX_CUSTOM_SAMPLE_BYTES);
    const result = inspectCustomWav(bytes);
    expect(result.duration).toBe(10);
    expect(result.peaks).toHaveLength(128);
    expect(Math.max(...result.peaks)).toBe(1);
  });
  it("rejects stereo, alternative rates, extra bytes, short and oversized data", async () => {
    for (const blob of [
      encodeWav([new Float32Array(2400), new Float32Array(2400)], 24000),
      encodeWav([new Float32Array(2400)], 44100),
      encodeWav([new Float32Array(240)], 24000),
      encodeWav([new Float32Array(240001)], 24000),
    ]) {
      const bytes = await blob.arrayBuffer();
      expect(() => inspectCustomWav(bytes)).toThrow();
    }
    const valid = await encodeWav(
      [new Float32Array(2400)],
      24000,
    ).arrayBuffer();
    const extra = new Uint8Array(valid.byteLength + 1);
    extra.set(new Uint8Array(valid));
    expect(() => inspectCustomWav(extra.buffer)).toThrow();
  });
  it("validates capability references and routes every ID into exactly eight shards", async () => {
    const bytes = await encodeWav(
      [new Float32Array(2400)],
      24000,
    ).arrayBuffer();
    const local = {
      kind: "local",
      id: "a".repeat(32),
      sha256: await sampleDigest(bytes),
      name: "Recording 1",
      rootNote: 60,
      ...inspectCustomWav(bytes),
    };
    expect(customSampleSchema.parse(local).kind).toBe("local");
    expect(
      customSampleSchema.safeParse({
        ...local,
        kind: "shared",
        readToken: "no",
      }).success,
    ).toBe(false);
    expect(
      customSampleSchema.parse({
        ...local,
        kind: "shared",
        readToken: "a".repeat(43),
      }).kind,
    ).toBe("shared");
    expect(
      new Set(
        Array.from({ length: 16 }, (_, index) =>
          sampleShard(index.toString(16) + "a".repeat(31)),
        ),
      ),
    ).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
  });
});
