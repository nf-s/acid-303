import { describe, expect, it } from "vitest";
import { TEXT, canvasTheme, contrast, paletteAccents } from "./canvas-theme";
import { palettesForMode } from "./visualizer-palettes";

const PALE: readonly [number, number, number] = [236, 238, 244];

describe("canvas theme", () => {
  it("keeps Grain's original canvas colours outside a browser", () => {
    const theme = canvasTheme();
    expect(theme.mode).toBe("grain");
    expect(theme.radius).toBe(0);
    expect(theme.beat.background).toBe("#141414");
    expect(theme.matrix.background).toBe("#131415");
    expect(theme.beat.bevel).not.toBeNull();
  });

  it("derives accessible accents from every Fluff palette", () => {
    for (const palette of palettesForMode("fluff")) {
      const accents = paletteAccents(palette.id);
      expect(contrast(accents.fill, PALE)).toBeGreaterThanOrEqual(3);
      expect(contrast(accents.ink, PALE)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(TEXT, accents.note)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
