import { describe, expect, it } from "vitest";
import {
  FLUFF_ARP_LEVELS,
  FLUFF_ARP_PATCHES,
  FLUFF_LEAD_LEVELS,
  FLUFF_LEAD_PATCHES,
  FLUFF_PAD_LEVELS,
  FLUFF_PAD_PATCHES,
} from "./fluff-patches";
import type { MelodicControls } from "./fluff-patches";
import { FLUFF_SOUNDS } from "./mode";

const corners: MelodicControls[] = [0, 1].flatMap((low) =>
  [0.03, 2].map((decay) => ({
    tone: low,
    decay,
    attack: low * 0.6,
    resonance: low,
    shape: low,
    width: 1 - low,
    motion: low,
    grit: low,
  })),
);

describe("Fluff melodic patches", () => {
  it("has one patch and one level for every sound slot", () => {
    expect(FLUFF_LEAD_PATCHES).toHaveLength(FLUFF_SOUNDS.keys.length);
    expect(FLUFF_ARP_PATCHES).toHaveLength(FLUFF_SOUNDS.arp.length);
    expect(FLUFF_PAD_PATCHES).toHaveLength(FLUFF_SOUNDS.pad.length);
    expect(FLUFF_LEAD_LEVELS).toHaveLength(FLUFF_SOUNDS.keys.length);
    expect(FLUFF_ARP_LEVELS).toHaveLength(FLUFF_SOUNDS.arp.length);
    expect(FLUFF_PAD_LEVELS).toHaveLength(FLUFF_SOUNDS.pad.length);
  });

  it("builds finite, audible voices at every control extreme", () => {
    for (const patch of [
      ...FLUFF_LEAD_PATCHES,
      ...FLUFF_ARP_PATCHES,
      ...FLUFF_PAD_PATCHES,
    ])
      for (const controls of corners) {
        const voice = patch.voice(controls);
        const rack = patch.rack(controls);
        // NaN and Infinity serialise as null, so any null means a bad value.
        expect(JSON.stringify({ voice, rack })).not.toContain("null");
        expect(voice.level).toBeGreaterThan(0);
        expect(voice.layers.length).toBeGreaterThan(0);
        expect(voice.amp.attack).toBeGreaterThanOrEqual(0);
        if (voice.filter) {
          expect(voice.filter.cutoff).toBeGreaterThan(100);
          expect(voice.filter.cutoff).toBeLessThan(20000);
        }
        for (const layer of voice.layers)
          if (layer.kind === "osc") {
            expect(layer.voices).toBeGreaterThanOrEqual(1);
            expect(layer.voices).toBeLessThanOrEqual(9);
          }
      }
  });
});
