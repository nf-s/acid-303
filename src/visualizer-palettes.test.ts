import { describe, expect, it } from "vitest";
import {
  VISUALIZER_PALETTES,
  createPaletteLookup,
  isVisualizerPaletteId,
} from "./visualizer-palettes";

describe("visualizer palettes", () => {
  it("validates saved palette IDs without accepting unrelated or inherited keys", () => {
    for (const palette of VISUALIZER_PALETTES)
      expect(isVisualizerPaletteId(palette.id)).toBe(true);
    for (const value of [
      null,
      undefined,
      1,
      {},
      "",
      "Mono",
      "__proto__",
      "constructor",
      "unknown",
    ])
      expect(isVisualizerPaletteId(value)).toBe(false);
    expect(new Set(VISUALIZER_PALETTES.map((palette) => palette.id)).size).toBe(
      VISUALIZER_PALETTES.length,
    );
  });

  it("preserves an exact neutral 256-level ramp for the default monochrome palette", () => {
    expect(VISUALIZER_PALETTES[0]?.id).toBe("mono");
    const lookup = createPaletteLookup("mono");
    for (let value = 0; value < 256; value++)
      expect(Array.from(lookup.slice(value * 4, value * 4 + 4))).toEqual([
        value,
        value,
        value,
        255,
      ]);
  });

  it("provides opaque, smooth colour ramps and CSS gradient swatches", () => {
    for (const palette of VISUALIZER_PALETTES) {
      expect(palette.swatch.startsWith("linear-gradient(90deg, rgb(")).toBe(
        true,
      );
      const lookup = createPaletteLookup(palette.id);
      expect(lookup).toHaveLength(1024);
      for (let value = 0; value < 256; value++) {
        expect(lookup[value * 4 + 3]).toBe(255);
        if (value === 0) continue;
        for (let channel = 0; channel < 3; channel++) {
          const current = lookup[value * 4 + channel];
          const previous = lookup[(value - 1) * 4 + channel];
          if (current === undefined || previous === undefined)
            throw new Error("Palette channel missing.");
          expect(Math.abs(current - previous)).toBeLessThanOrEqual(8);
        }
      }
    }
  });

  it("keeps fixed palettes distinct, dark at zero and independent between instances", () => {
    const ramps = [
      createPaletteLookup("cobalt"),
      createPaletteLookup("violet"),
      createPaletteLookup("ember"),
    ];
    for (const ramp of ramps)
      expect(Array.from(ramp.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(
      new Set(ramps.map((ramp) => Array.from(ramp.slice(512, 515)).join(",")))
        .size,
    ).toBe(3);
    const changed = createPaletteLookup("cobalt");
    changed[0] = 255;
    expect(createPaletteLookup("cobalt")[0]).toBe(0);
  });

  it("marks only rainbow as animated and closes its colour cycle without a seam", () => {
    expect(
      VISUALIZER_PALETTES.filter((palette) => palette.animated).map(
        (palette) => palette.id,
      ),
    ).toEqual(["rainbow"]);
    const rainbow = createPaletteLookup("rainbow");
    expect(Array.from(rainbow.slice(0, 4))).toEqual(
      Array.from(rainbow.slice(-4)),
    );
  });
});
