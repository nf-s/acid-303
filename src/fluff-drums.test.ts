import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FLUFF_DRUM_SAMPLES,
  fluffDrumGate,
  fluffDrumRate,
  fluffDrumSample,
  fluffSampleTail,
} from "./fluff-drums";
import { FLUFF_SOUNDS } from "./mode";
import { createProject, drumIdSchema } from "./model";

const bundled = Object.keys(
  import.meta.glob("../public/drums/fluff/*.wav", { query: "?url" }),
).map((path) => path.replace("../public", ""));

/** The nearest root or fifth of A minor, as the Fluff kit tunes kicks. */
function aMinor(target: number): number {
  let best = target;
  for (let midi = 21; midi < 60; midi++) {
    if ((midi - 9) % 12 !== 0 && (midi - 4) % 12 !== 0) continue;
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    if (
      Math.abs(Math.log2(frequency / target)) <
      Math.abs(Math.log2(best / target))
    )
      best = frequency;
  }
  return best;
}

describe("Fluff drum samples", () => {
  it("covers every Fluff drum slot, sampled except the Blip and Sweep percussion", () => {
    for (const id of drumIdSchema.options) {
      const slots = FLUFF_DRUM_SAMPLES[id];
      expect(slots).toHaveLength(FLUFF_SOUNDS[id].length);
      slots.forEach((drum, sound) => {
        const synthesized =
          id === "rim" &&
          ["Blip", "Sweep"].includes(FLUFF_SOUNDS.rim[sound] ?? "");
        expect(drum === null).toBe(synthesized);
      });
    }
    expect(fluffDrumSample("hat", 99)).toBeNull();
  });

  it("bundles exactly one file for every sampled slot", () => {
    const files = Object.values(FLUFF_DRUM_SAMPLES)
      .flat()
      .flatMap((drum) => (drum ? [`/drums/fluff/${drum.file}.wav`] : []));
    expect(new Set(files).size).toBe(files.length);
    expect([...files].sort()).toEqual([...bundled].sort());
  });

  it("tunes kick fundamentals into 40–70 Hz and only offsets the others", () => {
    for (const drum of FLUFF_DRUM_SAMPLES.kick) {
      if (!drum) continue;
      if (drum.fundamental > 0) {
        const tuned = drum.fundamental * fluffDrumRate(drum, 0, aMinor);
        expect(tuned).toBeGreaterThanOrEqual(40);
        expect(tuned).toBeLessThanOrEqual(70);
        expect(
          Math.abs(12 * Math.log2(tuned / drum.fundamental)),
        ).toBeLessThanOrEqual(3.5);
      } else {
        expect(drum.sub).toBeGreaterThan(0);
        expect(fluffDrumRate(drum, 12, aMinor)).toBe(2);
      }
    }
    const snare = fluffDrumSample("snare", 0);
    expect(snare && fluffDrumRate(snare, -12, aMinor)).toBe(0.5);
  });

  it("gates by Decay without exceeding the sample", () => {
    const drum = fluffDrumSample("hat", 1);
    if (!drum) throw new Error("Open hat is sampled");
    expect(fluffDrumGate(drum, 0.03)).toBeCloseTo(0.09);
    expect(fluffDrumGate(drum, 0.001)).toBe(0.03);
    expect(fluffDrumGate(drum, 1.5)).toBe(drum.seconds);
  });

  it("reports render tails for sampled slots only", () => {
    const [kick] = createProject().drums;
    if (!kick) throw new Error("The project has a kick");
    expect(fluffSampleTail({ ...kick, id: "rim", sound: 4 })).toBe(0);
    expect(
      fluffSampleTail({ ...kick, id: "kick", sound: 5, decay: 1.5 }),
    ).toBeGreaterThan(1.1);
  });

  describe("loading", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.resetModules();
    });
    class BufferStub implements AudioBuffer {
      readonly length = 1;
      readonly sampleRate = 44100;
      constructor(
        readonly numberOfChannels: number,
        readonly duration: number,
      ) {}
      copyFromChannel(): void {}
      copyToChannel(): void {}
      getChannelData(): Float32Array<ArrayBuffer> {
        return new Float32Array(1);
      }
    }
    /** Decodes the stub "file", which is the sample's name as text. */
    const decoder = (channels: (file: string) => number) => ({
      decodeAudioData: vi.fn(async (bytes: ArrayBuffer) => {
        const file = new TextDecoder().decode(bytes);
        const drum = Object.values(FLUFF_DRUM_SAMPLES)
          .flat()
          .find((entry) => entry?.file === file);
        return new BufferStub(channels(file), drum?.seconds ?? 0);
      }),
    });

    it("decodes every sampled slot once per context and keeps failures synthesized", async () => {
      const fetcher = vi.fn(
        async (url: string) =>
          new Response(url.replace("/drums/fluff/", "").replace(".wav", "")),
      );
      vi.stubGlobal("fetch", fetcher);
      const drums = await import("./fluff-drums");
      const target = decoder((file) => (file === "hat-ride" ? 2 : 1));
      expect(drums.cachedFluffDrum(target, "kick", 0)).toBeNull();
      await drums.loadFluffDrums(target);
      expect(drums.cachedFluffDrum(target, "kick", 0)?.drum.file).toBe(
        "kick-click",
      );
      expect(drums.cachedFluffDrum(target, "hat", 4)).toBeNull();
      expect(drums.cachedFluffDrum(target, "rim", 4)).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(34);
      expect(target.decodeAudioData).toHaveBeenCalledTimes(34);
      // A retry decodes only the slot that failed.
      await drums.loadFluffDrums(target);
      expect(fetcher).toHaveBeenCalledTimes(34);
      expect(target.decodeAudioData).toHaveBeenCalledTimes(35);
    });
  });
});
