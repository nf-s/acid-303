export type VisualizerPaletteId =
  "mono" | "cobalt" | "violet" | "ember" | "rainbow";

export interface VisualizerPalette {
  readonly id: VisualizerPaletteId;
  readonly label: string;
  readonly swatch: string;
  readonly animated: boolean;
}

type Rgb = readonly [number, number, number];
type PaletteStops = readonly [Rgb, Rgb, ...Rgb[]];

const STOPS: Record<VisualizerPaletteId, PaletteStops> = {
  mono: [
    [0, 0, 0],
    [255, 255, 255],
  ],
  cobalt: [
    [0, 0, 0],
    [12, 12, 104],
    [28, 65, 255],
    [0, 225, 255],
    [225, 250, 255],
  ],
  violet: [
    [0, 0, 0],
    [46, 5, 98],
    [140, 45, 255],
    [255, 20, 140],
    [255, 225, 245],
  ],
  ember: [
    [0, 0, 0],
    [91, 3, 12],
    [235, 46, 19],
    [255, 146, 22],
    [255, 239, 176],
  ],
  rainbow: [
    [255, 30, 60],
    [255, 146, 10],
    [255, 236, 25],
    [52, 239, 99],
    [0, 205, 255],
    [80, 55, 255],
    [229, 35, 246],
    [255, 30, 60],
  ],
};

function swatch(id: VisualizerPaletteId): string {
  return `linear-gradient(90deg, ${STOPS[id].map(([r, g, b]) => `rgb(${r} ${g} ${b})`).join(", ")})`;
}

export const VISUALIZER_PALETTES: ReadonlyArray<VisualizerPalette> = [
  { id: "mono", label: "Mono", swatch: swatch("mono"), animated: false },
  { id: "cobalt", label: "Cobalt", swatch: swatch("cobalt"), animated: false },
  { id: "violet", label: "Violet", swatch: swatch("violet"), animated: false },
  { id: "ember", label: "Ember", swatch: swatch("ember"), animated: false },
  {
    id: "rainbow",
    label: "Rainbow",
    swatch: swatch("rainbow"),
    animated: true,
  },
];

export function isVisualizerPaletteId(
  value: unknown,
): value is VisualizerPaletteId {
  return (
    typeof value === "string" &&
    VISUALIZER_PALETTES.some((palette) => palette.id === value)
  );
}

/** One shared RGBA lookup keeps the GPU and Canvas colour ramps consistent. */
export function createPaletteLookup(id: VisualizerPaletteId): Uint8Array {
  const stops = STOPS[id];
  const lookup = new Uint8Array(256 * 4);
  for (let index = 0; index < 256; index++) {
    const position = (index / 255) * (stops.length - 1);
    const lower = Math.floor(position);
    const fraction = position - lower;
    const start = stops[lower] ?? stops[0];
    const end = stops[lower + 1] ?? start;
    start.forEach((value, channel) => {
      lookup[index * 4 + channel] = Math.round(
        value + ((end[channel] ?? value) - value) * fraction,
      );
    });
    lookup[index * 4 + 3] = 255;
  }
  return lookup;
}
