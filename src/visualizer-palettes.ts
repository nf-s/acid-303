import type { ProjectMode } from "./mode";

export type VisualizerPaletteId =
  | "mono"
  | "cobalt"
  | "violet"
  | "ember"
  | "rainbow"
  | "cotton"
  | "sorbet"
  | "lilac"
  | "dusk"
  | "prism";

export interface VisualizerPalette {
  readonly id: VisualizerPaletteId;
  readonly label: string;
  readonly swatch: string;
  readonly animated: boolean;
  readonly mode: ProjectMode;
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
  // Fluff ramps run from the sky behind the clouds (0) to the brightest highlight (1).
  cotton: [
    [178, 198, 240],
    [206, 196, 246],
    [244, 192, 222],
    [255, 222, 236],
    [255, 250, 252],
  ],
  sorbet: [
    [246, 164, 172],
    [255, 186, 186],
    [255, 210, 184],
    [255, 232, 212],
    [255, 250, 244],
  ],
  lilac: [
    [150, 142, 228],
    [180, 166, 246],
    [210, 196, 252],
    [234, 224, 255],
    [250, 248, 255],
  ],
  dusk: [
    [52, 44, 110],
    [110, 84, 176],
    [196, 124, 196],
    [255, 172, 186],
    [255, 228, 210],
  ],
  prism: [
    [255, 186, 212],
    [255, 210, 184],
    [255, 232, 192],
    [214, 196, 255],
    [188, 212, 255],
    [232, 190, 246],
    [255, 186, 212],
  ],
};

function swatch(id: VisualizerPaletteId): string {
  return `linear-gradient(90deg, ${STOPS[id].map(([r, g, b]) => `rgb(${r} ${g} ${b})`).join(", ")})`;
}

export const VISUALIZER_PALETTES: ReadonlyArray<VisualizerPalette> = [
  {
    id: "mono",
    label: "Mono",
    swatch: swatch("mono"),
    animated: false,
    mode: "grain",
  },
  {
    id: "cobalt",
    label: "Cobalt",
    swatch: swatch("cobalt"),
    animated: false,
    mode: "grain",
  },
  {
    id: "violet",
    label: "Violet",
    swatch: swatch("violet"),
    animated: false,
    mode: "grain",
  },
  {
    id: "ember",
    label: "Ember",
    swatch: swatch("ember"),
    animated: false,
    mode: "grain",
  },
  {
    id: "rainbow",
    label: "Rainbow",
    swatch: swatch("rainbow"),
    animated: true,
    mode: "grain",
  },
  {
    id: "cotton",
    label: "Cotton",
    swatch: swatch("cotton"),
    animated: false,
    mode: "fluff",
  },
  {
    id: "sorbet",
    label: "Sorbet",
    swatch: swatch("sorbet"),
    animated: false,
    mode: "fluff",
  },
  {
    id: "lilac",
    label: "Lilac",
    swatch: swatch("lilac"),
    animated: false,
    mode: "fluff",
  },
  {
    id: "dusk",
    label: "Dusk",
    swatch: swatch("dusk"),
    animated: false,
    mode: "fluff",
  },
  {
    id: "prism",
    label: "Prism",
    swatch: swatch("prism"),
    animated: true,
    mode: "fluff",
  },
];

export function palettesForMode(
  mode: ProjectMode,
): ReadonlyArray<VisualizerPalette> {
  return VISUALIZER_PALETTES.filter((palette) => palette.mode === mode);
}
export function defaultPaletteId(mode: ProjectMode): VisualizerPaletteId {
  return mode === "fluff" ? "cotton" : "mono";
}

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
