import { describe, expect, it } from "vitest";
import {
  VISUALIZER_PALETTES,
  createPaletteLookup,
  defaultPaletteId,
  isVisualizerPaletteId,
  palettesForMode,
} from "./visualizer-palettes";

function luminance(lookup: Uint8Array, value: number): number {
  const [red = 0, green = 0, blue = 0] = lookup.slice(value * 4, value * 4 + 3);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

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

  it("marks only rainbow and prism as animated and closes the rainbow cycle without a seam", () => {
    expect(
      VISUALIZER_PALETTES.filter((palette) => palette.animated).map(
        (palette) => palette.id,
      ),
    ).toEqual(["rainbow", "prism"]);
    const rainbow = createPaletteLookup("rainbow");
    expect(Array.from(rainbow.slice(0, 4))).toEqual(
      Array.from(rainbow.slice(-4)),
    );
  });

  it("gives each mode its own palettes and default", () => {
    expect(palettesForMode("grain").map((palette) => palette.id)).toEqual([
      "mono",
      "cobalt",
      "violet",
      "ember",
      "rainbow",
    ]);
    expect(palettesForMode("fluff").map((palette) => palette.id)).toEqual([
      "cotton",
      "sorbet",
      "lilac",
      "dusk",
      "prism",
    ]);
    expect(defaultPaletteId("grain")).toBe("mono");
    expect(defaultPaletteId("fluff")).toBe("cotton");
  });

  it("keeps Fluff ramps pastel, never green-led, and brightening towards highlights", () => {
    for (const palette of palettesForMode("fluff")) {
      const lookup = createPaletteLookup(palette.id);
      for (let value = 0; value < 256; value++) {
        const [red = 0, green = 0, blue = 0] = lookup.slice(
          value * 4,
          value * 4 + 3,
        );
        expect(green > red + 8 && green > blue + 8).toBe(false);
      }
      if (!palette.animated)
        expect(luminance(lookup, 255)).toBeGreaterThan(
          luminance(lookup, 0) + 40,
        );
    }
    for (const palette of palettesForMode("fluff")) {
      if (palette.id === "dusk") continue;
      const lookup = createPaletteLookup(palette.id);
      for (let value = 0; value < 256; value++)
        expect(luminance(lookup, value)).toBeGreaterThan(140);
    }
  });

  it("closes the animated prism cycle without a seam", () => {
    const prism = createPaletteLookup("prism");
    expect(Array.from(prism.slice(0, 4))).toEqual(Array.from(prism.slice(-4)));
  });
});
