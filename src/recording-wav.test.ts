import { describe, expect, it } from "vitest";
import { encodeWav } from "./wav";
import { MAX_IMPORTED_WAV_BYTES, readImportedWav } from "./recording-wav";

describe("bounded local WAV imports", () => {
  it.each([24000, 44100, 48000])(
    "reads mono and downmixes stereo PCM at%dHz",
    async (rate) => {
      const left = new Float32Array(rate / 10).fill(0.5),
        right = new Float32Array(rate / 10).fill(-0.25);
      const mono = readImportedWav(await encodeWav([left], rate).arrayBuffer());
      expect(mono.sampleRate).toBe(rate);
      expect(mono.samples[0]).toBeCloseTo(0.5, 4);
      const stereo = readImportedWav(
        await encodeWav([left, right], rate).arrayBuffer(),
      );
      expect(stereo.samples).toHaveLength(rate / 10);
      expect(stereo.samples[0]).toBeCloseTo(0.125, 4);
    },
  );
  it("supports bounded padded metadata chunks and rejects malformed chunk lengths before decoding", async () => {
    const wav = await encodeWav([new Float32Array(2400)], 24000).arrayBuffer(),
      padded = new Uint8Array(wav.byteLength + 10);
    padded.set(new Uint8Array(wav).slice(0, 12));
    padded.set(new TextEncoder().encode("JUNK"), 12);
    const view = new DataView(padded.buffer);
    view.setUint32(16, 1, true);
    view.setUint32(4, padded.byteLength - 8, true);
    padded.set(new Uint8Array(wav).slice(12), 22);
    expect(readImportedWav(padded.buffer).samples).toHaveLength(2400);
    view.setUint32(16, 0xffffffff, true);
    expect(() => readImportedWav(padded.buffer)).toThrow("PCM WAV");
  });
  it("rejects oversized, long, unsupported-rate and compressed WAVs", async () => {
    expect(() =>
      readImportedWav(new ArrayBuffer(MAX_IMPORTED_WAV_BYTES + 1)),
    ).toThrow("PCM WAV");
    for (const blob of [
      encodeWav([new Float32Array(3200)], 32000),
      encodeWav([new Float32Array(240001)], 24000),
    ]) {
      const wav = await blob.arrayBuffer();
      expect(() => readImportedWav(wav)).toThrow("PCM WAV");
    }
    const compressed = await encodeWav(
      [new Float32Array(2400)],
      24000,
    ).arrayBuffer();
    new DataView(compressed).setUint16(20, 17, true);
    expect(() => readImportedWav(compressed)).toThrow("PCM WAV");
  });
});
