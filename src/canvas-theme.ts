import { projectModeSchema } from "./mode";
import type { ProjectMode } from "./mode";
import { createPaletteLookup, defaultPaletteId } from "./visualizer-palettes";
import type { VisualizerPaletteId } from "./visualizer-palettes";

/**
 * Colours and shapes for every canvas-drawn editor, in one place.
 * Grain keeps its original dark values exactly; Fluff draws light, translucent
 * surfaces with rounded cells and accents taken from the visualizer palette.
 */

type Rgb = readonly [number, number, number];

export interface PaletteAccents {
  /** Sky end of the palette, used to tint page surfaces. */
  readonly sky: Rgb;
  readonly mid: Rgb;
  readonly light: Rgb;
  readonly glow: Rgb;
  /** Mark colour with at least 3:1 contrast on a pale surface. */
  readonly fill: Rgb;
  /** Text and thin-line colour with at least 4.5:1 contrast on a pale surface. */
  readonly ink: Rgb;
  /** Light note body that keeps dark text above 4.5:1. */
  readonly note: Rgb;
}

export interface BeatCanvasTheme {
  readonly background: string;
  readonly drawLabel: string;
  readonly stepMajor: string;
  readonly stepMinor: string;
  readonly labelBackground: string;
  readonly labelBackgroundSelected: string;
  readonly labelText: string;
  readonly labelTextSelected: string;
  readonly labelMarker: string;
  readonly onTop: string;
  readonly onBottom: string;
  readonly offEven: string;
  readonly offOdd: string;
  /** Grain's bevelled step keys; Fluff cells are flat puffs. */
  readonly bevel: {
    readonly onLight: string;
    readonly offLight: string;
    readonly onShade: string;
    readonly offShade: string;
    readonly onNotch: string;
    readonly offNotch: string;
  } | null;
  readonly gloss: string | null;
  readonly playhead: string;
  readonly playheadWidth: number;
  readonly pointer: string;
}

export interface MatrixCanvasTheme {
  readonly background: string;
  readonly bandEven: string;
  readonly bandOdd: string;
  readonly bandCurrent: string;
  readonly lineMajor: string;
  readonly lineMinor: string;
  readonly playLine: string;
  readonly stepText: string;
  readonly stepTextCurrent: string;
  readonly barText: string;
  readonly noteLineOctave: string;
  readonly noteLine: string;
  readonly noteText: string;
  readonly valueText: string;
  readonly midline: string;
  readonly overviewPitch: string;
  readonly overviewGate: string;
  readonly stepNoteOn: string;
  readonly stepNoteOff: string;
  readonly overviewLabel: string;
  readonly gateFillActive: string;
  readonly gateFill: string;
  readonly gateBarActive: string;
  readonly gateBar: string;
  readonly gateOutlineActive: string;
  readonly gateOutline: string;
  readonly pitchLineActive: string;
  readonly pitchLine: string;
  readonly pitchOnActive: string;
  readonly pitchOn: string;
  readonly pitchOffActive: string;
  readonly pitchOff: string;
  readonly pitchOffNotch: string;
  readonly accentOnActive: string;
  readonly accentOn: string;
  readonly accentOffActive: string;
  readonly accentOff: string;
  readonly accentFillActive: string;
  readonly accentFill: string;
  readonly glideActive: string;
  readonly glide: string;
  readonly automationFill: string;
  readonly automationLine: string;
  readonly automationDot: string;
  readonly automationDotEmpty: string;
}

export interface RollCanvasTheme {
  readonly background: string;
  readonly rowRoot: string;
  readonly row: string;
  readonly noteText: string;
  readonly lineMajor: string;
  readonly lineMinor: string;
  readonly stepText: string;
  readonly stepTextPlaying: string;
  readonly playingFill: string;
  readonly note: string;
  readonly noteSelected: string;
  readonly noteStroke: string;
  readonly noteStrokeSelected: string;
  readonly noteInk: string;
}

export interface CloudCanvasTheme {
  readonly background: string;
  readonly ridgeMajor: string;
  readonly ridge: string;
  readonly scanBandActive: string;
  readonly scanBand: string;
  readonly scanLine: string;
  readonly note: string;
  readonly noteSelected: string;
  readonly noteLine: string;
  readonly noteLineSelected: string;
  readonly marker: string;
  readonly label: string;
}

export interface TensionCanvasTheme {
  readonly background: string;
  readonly frame: string;
  readonly string: string;
  readonly stringSelected: string;
  readonly stringActive: string;
  readonly pick: string;
  readonly text: string;
  readonly textSelected: string;
}

export interface CanvasTheme {
  readonly mode: ProjectMode;
  /** Corner radius for cells and bars; 0 keeps square edges. */
  readonly radius: number;
  readonly fontFamily: string;
  readonly beat: BeatCanvasTheme;
  readonly matrix: MatrixCanvasTheme;
  readonly roll: RollCanvasTheme;
  readonly cloud: CloudCanvasTheme;
  readonly tension: TensionCanvasTheme;
}

const GRAIN_THEME: CanvasTheme = {
  mode: "grain",
  radius: 0,
  fontFamily: '"IBM Plex Mono", monospace',
  beat: {
    background: "#141414",
    drawLabel: "#969696",
    stepMajor: "#e1e1e1",
    stepMinor: "#777777",
    labelBackground: "#1a1a1a",
    labelBackgroundSelected: "#292929",
    labelText: "#858585",
    labelTextSelected: "#f1f1f1",
    labelMarker: "#f1f1f1",
    onTop: "#d5d5d5",
    onBottom: "#969696",
    offEven: "#252525",
    offOdd: "#2c2c2c",
    bevel: {
      onLight: "#eeeeee",
      offLight: "#464646",
      onShade: "#5d5d5d",
      offShade: "#101010",
      onNotch: "#373737",
      offNotch: "#515151",
    },
    gloss: null,
    playhead: "#eee",
    playheadWidth: 1,
    pointer: "#ffffff88",
  },
  matrix: {
    background: "#131415",
    bandEven: "#1c1e20",
    bandOdd: "#161819",
    bandCurrent: "#44484c",
    lineMajor: "#555a60",
    lineMinor: "#303438",
    playLine: "#b9bec8",
    stepText: "#969a9e",
    stepTextCurrent: "#fff",
    barText: "#aab0b6",
    noteLineOctave: "#34393e",
    noteLine: "#25282b",
    noteText: "#9da2a7",
    valueText: "#aab0b6",
    midline: "#757b81",
    overviewPitch: "#727e89",
    overviewGate: "#8d969e",
    stepNoteOn: "#aab0b6",
    stepNoteOff: "#697077",
    overviewLabel: "#c5ccd3",
    gateFillActive: "#d9dde232",
    gateFill: "#aeb8c112",
    gateBarActive: "#fff",
    gateBar: "#8d969e",
    gateOutlineActive: "#899098",
    gateOutline: "#41474d",
    pitchLineActive: "#d8dee4",
    pitchLine: "#727e89",
    pitchOnActive: "#fff",
    pitchOn: "#9ba7b1",
    pitchOffActive: "#7b858f",
    pitchOff: "#515b64",
    pitchOffNotch: "#202427",
    accentOnActive: "#fff",
    accentOn: "#99a4ae",
    accentOffActive: "#78838d",
    accentOff: "#47515a",
    accentFillActive: "#fff",
    accentFill: "#99a4ae",
    glideActive: "#fff",
    glide: "#84939e",
    automationFill: "#e0e8f016",
    automationLine: "#fff",
    automationDot: "#fff",
    automationDotEmpty: "#161819",
  },
  roll: {
    background: "#131619",
    rowRoot: "#262c32",
    row: "#1a1f23",
    noteText: "#b7c0c8",
    lineMajor: "#66727b",
    lineMinor: "#303940",
    stepText: "#a6b0b9",
    stepTextPlaying: "#fff",
    playingFill: "#c8d8e52b",
    note: "#8f9eaa",
    noteSelected: "#dce4eb",
    noteStroke: "#c3cdd5",
    noteStrokeSelected: "#fff",
    noteInk: "#15212a",
  },
  cloud: {
    background: "#101315",
    ridgeMajor: "#60707b",
    ridge: "#34414b",
    scanBandActive: "#c5d5e22c",
    scanBand: "#c5d5e214",
    scanLine: "#e4edf4",
    note: "#8c9ca9",
    noteSelected: "#f4f7fa",
    noteLine: "#a8bac51c",
    noteLineSelected: "#dce7f380",
    marker: "#edf3f7",
    label: "#a3b2bd",
  },
  tension: {
    background: "#101315",
    frame: "#48535c",
    string: "#748793",
    stringSelected: "#b7c7d3",
    stringActive: "#f2f6fa",
    pick: "#dbe8f2",
    text: "#9caebb",
    textSelected: "#f0f5fa",
  },
};

const WHITE: Rgb = [255, 255, 255];
/** The palest surface a Fluff canvas sits on, used for contrast checks. */
const PALE: Rgb = [236, 238, 244];
const SLATE_DEEP: Rgb = [30, 27, 58];
export const TEXT: Rgb = [31, 39, 53];
const TEXT_SOFT: Rgb = [63, 74, 91];
const SLATE: Rgb = [71, 85, 105];

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.04045
    ? scaled / 12.92
    : Math.pow((scaled + 0.055) / 1.055, 2.4);
}
export function luminance([red, green, blue]: Rgb): number {
  return (
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  );
}
export function contrast(first: Rgb, second: Rgb): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return [
    Math.round(from[0] + (to[0] - from[0]) * amount),
    Math.round(from[1] + (to[1] - from[1]) * amount),
    Math.round(from[2] + (to[2] - from[2]) * amount),
  ];
}
function fromHsl(hue: number, saturation: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const part = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const base = lightness - chroma / 2;
  const [red, green, blue] =
    hue < 60
      ? [chroma, part, 0]
      : hue < 120
        ? [part, chroma, 0]
        : hue < 180
          ? [0, chroma, part]
          : hue < 240
            ? [0, part, chroma]
            : hue < 300
              ? [part, 0, chroma]
              : [chroma, 0, part];
  return [
    Math.round((red + base) * 255),
    Math.round((green + base) * 255),
    Math.round((blue + base) * 255),
  ];
}
function toHueSaturation([red, green, blue]: Rgb): {
  hue: number;
  saturation: number;
} {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0 };
  const saturation = delta / (1 - Math.abs(max + min - 1));
  const sector =
    max === r
      ? ((g - b) / delta) % 6
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return { hue: (sector * 60 + 360) % 360, saturation };
}
/**
 * Keep a palette colour's hue and lower its lightness until it reaches the target
 * contrast; saturation stays in a restrained band so accents remain soft.
 */
function deepen(colour: Rgb, against: Rgb, target: number): Rgb {
  const tone = toHueSaturation(colour);
  const saturation = Math.max(0.28, Math.min(0.5, tone.saturation));
  for (let lightness = 0.8; lightness >= 0.1; lightness -= 0.01) {
    const next = fromHsl(tone.hue, saturation, lightness);
    if (contrast(next, against) >= target) return next;
  }
  return SLATE_DEEP;
}
export function rgb(colour: Rgb, alpha = 1): string {
  return alpha >= 1
    ? `rgb(${colour[0]} ${colour[1]} ${colour[2]})`
    : `rgb(${colour[0]} ${colour[1]} ${colour[2]} / ${alpha})`;
}

export function paletteAccents(id: VisualizerPaletteId): PaletteAccents {
  const lookup = createPaletteLookup(id);
  const at = (position: number): Rgb => {
    const index = Math.round(Math.max(0, Math.min(1, position)) * 255) * 4;
    return [
      lookup[index] ?? 255,
      lookup[index + 1] ?? 255,
      lookup[index + 2] ?? 255,
    ];
  };
  // The most saturated quarter of the ramp gives the clearest accent hue.
  let accent = at(0.4);
  let chroma = -1;
  for (let position = 0.1; position <= 0.75; position += 0.05) {
    const colour = at(position);
    const spread = Math.max(...colour) - Math.min(...colour);
    if (spread > chroma) {
      chroma = spread;
      accent = colour;
    }
  }
  const fill = deepen(accent, PALE, 3);
  return {
    sky: at(0.08),
    mid: at(0.5),
    light: at(0.75),
    glow: at(1),
    fill,
    ink: deepen(accent, PALE, 4.8),
    note: mix(fill, WHITE, 0.45),
  };
}

function fluffTheme(accents: PaletteAccents): CanvasTheme {
  const { fill, ink, note, light, mid } = accents;
  const soft = mix(light, WHITE, 0.35);
  return {
    mode: "fluff",
    radius: 9,
    fontFamily:
      'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    beat: {
      background: rgb(WHITE, 0.32),
      drawLabel: rgb(TEXT_SOFT),
      stepMajor: rgb(TEXT),
      stepMinor: rgb(TEXT_SOFT),
      labelBackground: rgb(WHITE, 0.4),
      labelBackgroundSelected: rgb(WHITE, 0.9),
      labelText: rgb(TEXT_SOFT),
      labelTextSelected: rgb(TEXT),
      labelMarker: rgb(fill),
      onTop: rgb(mix(fill, mid, 0.35)),
      onBottom: rgb(fill),
      offEven: rgb(WHITE, 0.62),
      offOdd: rgb(WHITE, 0.44),
      bevel: null,
      gloss: rgb(WHITE, 0.4),
      playhead: rgb(ink),
      playheadWidth: 2,
      pointer: rgb(ink, 0.55),
    },
    matrix: {
      background: rgb(WHITE, 0.34),
      bandEven: rgb(WHITE, 0.42),
      bandOdd: rgb(WHITE, 0.2),
      bandCurrent: rgb(soft, 0.85),
      lineMajor: rgb(SLATE, 0.3),
      lineMinor: rgb(SLATE, 0.12),
      playLine: rgb(ink),
      stepText: rgb(TEXT_SOFT),
      stepTextCurrent: rgb(ink),
      barText: rgb(TEXT_SOFT),
      noteLineOctave: rgb(SLATE, 0.22),
      noteLine: rgb(SLATE, 0.09),
      noteText: rgb(TEXT_SOFT),
      valueText: rgb(TEXT_SOFT),
      midline: rgb(SLATE, 0.35),
      overviewPitch: rgb(fill),
      overviewGate: rgb(fill, 0.7),
      stepNoteOn: rgb(TEXT),
      stepNoteOff: rgb(TEXT_SOFT),
      overviewLabel: rgb(TEXT),
      gateFillActive: rgb(fill, 0.2),
      gateFill: rgb(fill, 0.08),
      gateBarActive: rgb(fill),
      gateBar: rgb(fill, 0.55),
      gateOutlineActive: rgb(SLATE, 0.5),
      gateOutline: rgb(SLATE, 0.22),
      pitchLineActive: rgb(ink, 0.8),
      pitchLine: rgb(SLATE, 0.4),
      pitchOnActive: rgb(ink),
      pitchOn: rgb(fill, 0.75),
      pitchOffActive: rgb(SLATE, 0.45),
      pitchOff: rgb(SLATE, 0.25),
      pitchOffNotch: rgb(WHITE, 0.85),
      accentOnActive: rgb(ink),
      accentOn: rgb(fill, 0.75),
      accentOffActive: rgb(SLATE, 0.55),
      accentOff: rgb(SLATE, 0.3),
      accentFillActive: rgb(ink),
      accentFill: rgb(fill, 0.75),
      glideActive: rgb(ink),
      glide: rgb(fill, 0.6),
      automationFill: rgb(fill, 0.16),
      automationLine: rgb(ink),
      automationDot: rgb(ink),
      automationDotEmpty: rgb(WHITE),
    },
    roll: {
      background: rgb(WHITE, 0.32),
      rowRoot: rgb(soft, 0.75),
      row: rgb(WHITE, 0.36),
      noteText: rgb(TEXT_SOFT),
      lineMajor: rgb(SLATE, 0.3),
      lineMinor: rgb(SLATE, 0.1),
      stepText: rgb(TEXT_SOFT),
      stepTextPlaying: rgb(ink),
      playingFill: rgb(fill, 0.14),
      note: rgb(mix(note, WHITE, 0.35)),
      noteSelected: rgb(note),
      noteStroke: rgb(fill),
      noteStrokeSelected: rgb(ink),
      noteInk: rgb(TEXT),
    },
    cloud: {
      background: rgb(WHITE, 0.32),
      ridgeMajor: rgb(fill, 0.55),
      ridge: rgb(SLATE, 0.2),
      scanBandActive: rgb(fill, 0.22),
      scanBand: rgb(fill, 0.1),
      scanLine: rgb(ink),
      note: rgb(TEXT_SOFT),
      noteSelected: rgb(ink),
      noteLine: rgb(SLATE, 0.1),
      noteLineSelected: rgb(fill, 0.5),
      marker: rgb(ink),
      label: rgb(TEXT_SOFT),
    },
    tension: {
      background: rgb(WHITE, 0.32),
      frame: rgb(SLATE, 0.3),
      string: rgb(SLATE, 0.5),
      stringSelected: rgb(fill),
      stringActive: rgb(ink),
      pick: rgb(ink),
      text: rgb(TEXT_SOFT),
      textSelected: rgb(ink),
    },
  };
}

let palette: VisualizerPaletteId = defaultPaletteId("fluff");
let fluff: CanvasTheme | null = null;
const watchers = new Set<() => void>();
let observer: MutationObserver | null = null;

function currentMode(): ProjectMode {
  if (typeof document === "undefined") return "grain";
  const parsed = projectModeSchema.safeParse(
    document.documentElement.dataset.mode,
  );
  return parsed.success ? parsed.data : "grain";
}

export function canvasTheme(): CanvasTheme {
  if (currentMode() === "grain") return GRAIN_THEME;
  fluff ??= fluffTheme(paletteAccents(palette));
  return fluff;
}

/** Font string for canvas text in the current theme. */
export function canvasFont(
  theme: CanvasTheme,
  size: number,
  bold = false,
): string {
  return `${bold ? "bold " : ""}${size}px ${theme.fontFamily}`;
}

/** Fill a cell, rounding its corners when the theme asks for it. */
export function fillCell(
  context: CanvasRenderingContext2D,
  theme: CanvasTheme,
  x: number,
  y: number,
  width: number,
  height: number,
  radius = theme.radius,
): void {
  const corner = Math.min(radius, width / 2, height / 2);
  if (corner <= 0.5) {
    context.fillRect(x, y, width, height);
    return;
  }
  context.beginPath();
  context.roundRect(x, y, width, height, corner);
  context.fill();
}

function notify(): void {
  for (const watcher of watchers) watcher();
}

/** Redraw whenever the studio mode or Fluff palette changes. Returns an unsubscribe. */
export function watchCanvasTheme(redraw: () => void): () => void {
  watchers.add(redraw);
  if (!observer && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(notify);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-mode"],
    });
  }
  return () => {
    watchers.delete(redraw);
  };
}

/** Publish palette-derived colours to CSS and the canvas editors. */
export function setThemePalette(id: VisualizerPaletteId): void {
  const accents = paletteAccents(id);
  const style = document.documentElement.style;
  style.setProperty("--fluff-palette-sky", rgb(accents.sky));
  style.setProperty("--fluff-palette-mid", rgb(accents.mid));
  style.setProperty("--fluff-palette-light", rgb(accents.light));
  style.setProperty("--fluff-palette-glow", rgb(accents.glow));
  style.setProperty("--fluff-palette-fill", rgb(accents.fill));
  style.setProperty("--fluff-palette-ink", rgb(accents.ink));
  if (id === palette && fluff) return;
  palette = id;
  fluff = null;
  if (currentMode() === "fluff") notify();
}
