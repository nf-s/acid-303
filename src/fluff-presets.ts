import {
  createProject,
  emptyBassAutomation,
  emptyDrumAutomation,
  emptyKeysAutomation,
  readProject,
  scaleNotes,
} from "./model";
import type {
  BassAutomationParameter,
  BassStep,
  DrumAutomationParameter,
  DrumId,
  KeysAutomationParameter,
  MusicalScale,
  Project,
} from "./model";
import type { ArpParameter, ArpTrack } from "./arp-model";
import type { PadParameter } from "./pad-model";
import type {
  ChordBorrow,
  ChordQuality,
  ProgressionChord,
} from "./progression-model";
import type { VocalNote, VocalParameter } from "./vocal-model";
import type { PadTiming, SequenceTiming, Timing } from "./timing";

/**
 * Automation is written as [bar, value] points across a sixteen-bar curve
 * loop (0 is the downbeat of bar 1, 16 the end of bar 16) with values in
 * normalized knob units. Values between points are interpolated per step; two
 * points at the same bar make a jump.
 */
type Curve = ReadonlyArray<readonly [number, number]>;
type Curves<K extends string> = Partial<Record<K, Curve>>;
const CURVE_BARS = 16;

/**
 * Drum lanes are written one bar at a time: sixteen cells, "x" for a hit and
 * "." for a rest, bars separated by "|". Spaces are only visual grouping.
 */
interface DrumSpec {
  sound: number;
  pattern: string;
  decay: number;
  volume: number;
  /** One digit per cell (0-9) scaling that hit's level. */
  levels?: string;
  pitch?: number;
  tone?: number;
  space?: number;
  pan?: number;
  drive?: number;
  attack?: number;
  /** A volume curve replaces Volume; levels still scale each hit. */
  curves?: Curves<DrumAutomationParameter>;
}
/**
 * Note lanes use sixteen space-separated tokens per bar: a scale degree
 * (0 is the root; "'" raises and "," lowers an octave), "_" to hold the
 * previous note, "." for a rest, "!" for an accent and "~" to glide onward.
 */
interface BassSpec {
  sound: number;
  pattern: string;
  octave?: number;
  cutoff: number;
  resonance: number;
  envelope: number;
  decay: number;
  volume: number;
  shape?: number;
  drive?: number;
  pulse?: number;
  curves?: Curves<BassAutomationParameter>;
}
interface LeadSpec {
  sound: number;
  pattern: string;
  octave?: number;
  tone: number;
  decay: number;
  space: number;
  volume: number;
  width?: number;
  attack?: number;
  grit?: number;
  motion?: number;
  curves?: Curves<KeysAutomationParameter>;
}
interface ArpSpec {
  sound: number;
  pattern: string;
  accents?: string;
  rate: ArpTrack["rate"];
  direction: ArpTrack["direction"];
  octaves: number;
  gate: number;
  decay: number;
  tone: number;
  space: number;
  volume: number;
  resonance?: number;
  shape?: number;
  width?: number;
  /** Following the chords: the MIDI note the chord voicing stays nearest. */
  register?: number;
  /**
   * A fixed riff instead of the chords: degree tokens played in order,
   * resolved from `octave`.
   */
  riff?: string;
  octave?: number;
  curves?: Curves<ArpParameter>;
}
interface PadSpec {
  sound: number;
  volume: number;
  tone: number;
  attack?: number;
  release?: number;
  motion?: number;
  spread?: number;
  space?: number;
  shape?: number;
  curves?: Curves<PadParameter>;
}
interface VocalSpec {
  sound: number;
  pattern: string;
  /** MIDI note of scale degree 0, placed near the sample's own pitch. */
  octave: number;
  volume: number;
  loop?: boolean;
  attack?: number;
  release?: number;
  tone?: number;
  space?: number;
  gain?: number;
  end?: number;
  curves?: Curves<VocalParameter>;
}
/** A chord type and a borrowed parallel scale; either may be left out. */
interface ChordColour {
  quality?: ChordQuality;
  borrow?: ChordBorrow;
}
interface FluffPreset {
  id: string;
  name: string;
  genre: string;
  scale: MusicalScale;
  bpm: number;
  swing: number;
  /** Sidechain depth: how far the kick ducks everything melodic. */
  pump: number;
  chords: {
    bars: 8 | 16;
    /**
     * Four [scale degree, inversion] pairs, each lasting a quarter of the
     * loop, optionally with a chord colour; without one the chord is the
     * plain diatonic seventh.
     */
    steps: ReadonlyArray<
      readonly [number, number] | readonly [number, number, ChordColour]
    >;
  };
  drums: Partial<Record<DrumId, DrumSpec>>;
  bass: BassSpec;
  lead?: LeadSpec;
  arp?: ArpSpec;
  pad?: PadSpec;
  vocal?: VocalSpec;
}

const FOUR = "x...x...x...x...";
const BACKBEAT = "....x.......x...";
const OFFBEAT = "..x...x...x...x.";
const SIXTEENTHS = "xxxxxxxxxxxxxxxx";
const REST = "................";
const repeat = (bar: string, count: number): string =>
  Array.from({ length: count }, () => bar).join(" | ");
/** Rises from `low` to `high` by `peak`, then eases back so the loop point is smooth. */
const swell = (low: number, high: number, peak = 12): Curve => [
  [0, low],
  [peak, high],
  [CURVE_BARS, low],
];
/** Silent until `bar`, then holds `value`: a part entering halfway. */
const from = (bar: number, value: number): Curve => [
  [0, 0],
  [bar, 0],
  [bar, value],
  [CURVE_BARS, value],
];
/** Only audible in the last bar of the curve loop (fills and rolls). */
const lastBar = (value: number): Curve => from(CURVE_BARS - 1, value);
/** Only audible in the first bar of the curve loop (a crash on the downbeat). */
const firstBar = (value: number): Curve => [
  [0, value],
  [1, value],
  [1, 0],
  [CURVE_BARS, 0],
];

const TRACKS: readonly FluffPreset[] = [
  {
    // Pumping supersaw chords and a three-note dotted pluck over a rolling
    // bass. The bass holds F under Fm7 and A♭maj7 (heard as Fm9), then walks
    // D♭–E♭ under the major chords; the pluck, bass and pad filters open
    // together over twelve bars and settle back by the loop point.
    id: "fluff-cotton",
    name: "Cotton",
    genre: "Progressive house",
    scale: { root: 5, mode: "minor" },
    bpm: 125,
    swing: 0,
    pump: 0.7,
    chords: {
      bars: 16,
      steps: [
        [0, 0],
        [5, 0],
        [2, 0],
        [6, 0],
      ],
    },
    drums: {
      kick: { sound: 1, pattern: FOUR, decay: 0.32, volume: 1 },
      clap: {
        sound: 0,
        pattern: BACKBEAT,
        decay: 0.22,
        volume: 0.42,
        tone: 0.62,
        space: 0.12,
      },
      hat: { sound: 5, pattern: OFFBEAT, decay: 0.12, volume: 0.14 },
      rim: {
        sound: 3,
        pattern: SIXTEENTHS,
        levels: "3153315331533153",
        decay: 0.05,
        volume: 0.16,
        pan: 0.25,
        curves: { volume: from(4, 0.16) },
      },
    },
    bass: {
      sound: 2,
      pattern: [
        ". 0 0 0 . 0 0 0 . 0 0 0 . 0 0 0",
        ". 0 0 0 . 0 0 0 . 0 0 0 . 0 0 0",
        ". 0 0 0 . 0 0 0 . 0 0 0 . 0 0 0",
        ". 0 0 0 . 0 0 0 . 0 0 0 . 0' 0 0",
        ". 5, 5, 5, . 5, 5, 5, . 5, 5, 5, . 5, 5, 5,",
        ". 5, 5, 5, . 5, 5, 5, . 5, 5, 5, . 5, 5, 5,",
        ". 6, 6, 6, . 6, 6, 6, . 6, 6, 6, . 6, 6, 6,",
        ". 6, 6, 6, . 6, 6, 6, . 6, 6, 6, . 6 6, 6,",
      ].join(" | "),
      octave: 1,
      cutoff: 340,
      resonance: 3,
      envelope: 0.45,
      decay: 0.2,
      volume: 0.46,
      shape: 0.4,
      pulse: 0.5,
      curves: { cutoff: swell(0.26, 0.56) },
    },
    lead: {
      sound: 1,
      pattern: [
        ". . 6 . . 4 . . 1' . . . 6 . . .",
        ". . 6 . . 4 . . 2' . . . . . 4 .",
        ". . 6 . . 4 . . 1' . . . 6 . . .",
        ". . 6 . . 4 . . 0' _ _ _ . . . .",
        ". . 6 . . 4 . . 1' . . . 6 . . .",
        ". . 6 . . 4 . . 2' . . . . . 4 .",
        ". . 6 . . 4 . . 1' . . . 6 . . .",
        ". . 6 . . 4 . . 1' . . . 2' _ _ .",
      ].join(" | "),
      tone: 0.2,
      decay: 0.28,
      space: 0.65,
      volume: 0.27,
      width: 0.5,
      curves: { tone: swell(0.12, 0.36) },
    },
    pad: {
      sound: 0,
      volume: 0.44,
      tone: 0.38,
      space: 0.55,
      attack: 0.3,
      release: 0.55,
      motion: 0.2,
      curves: { tone: swell(0.28, 0.6) },
    },
  },
  {
    // An offbeat bass under four slow chords, a low gated pluck arp and a
    // supersaw call that leaps a fifth and answers with a falling pair. The
    // bass moves C♯–A under the first chord and holds B under the second, so
    // the same four bars sound as C♯m7, Amaj9, B7, then Amaj7, G♯m7 over B.
    id: "fluff-skylark",
    name: "Skylark",
    genre: "Progressive trance",
    scale: { root: 1, mode: "minor" },
    bpm: 134,
    swing: 0,
    pump: 0.7,
    chords: {
      bars: 16,
      steps: [
        [0, 0],
        [6, 0],
        [5, 0],
        [4, 0],
      ],
    },
    drums: {
      kick: { sound: 0, pattern: FOUR, decay: 0.28, volume: 0.9 },
      clap: {
        sound: 5,
        pattern: BACKBEAT,
        decay: 0.2,
        volume: 0.4,
        space: 0.15,
      },
      hat: { sound: 5, pattern: OFFBEAT, decay: 0.1, volume: 0.19 },
      rim: {
        sound: 3,
        pattern: SIXTEENTHS,
        levels: "2142214221422142",
        decay: 0.05,
        volume: 0.16,
        pan: -0.2,
      },
      snare: {
        sound: 4,
        pattern: `${repeat(REST, 7)} | x...x...x.x.xxxx`,
        levels: `${repeat("0000000000000000", 7)} | 3000400050607899`,
        decay: 0.12,
        volume: 0.4,
        curves: { volume: lastBar(0.4) },
      },
    },
    bass: {
      sound: 1,
      pattern: [
        ". . 0 . . . 0 . . . 0 . . . 0 .",
        ". . 0 . . . 0 . . . 0 . . . 0 .",
        ". . 5, . . . 5, . . . 5, . . . 5, .",
        ". . 5, . . . 5, . . . 5, . . . 5 .",
        ". . 6, . . . 6, . . . 6, . . . 6, .",
        ". . 6, . . . 6, . . . 6, . . . 6, .",
        ". . 6, . . . 6, . . . 6, . . . 6, .",
        ". . 6, . . . 6, . . . 6, . . . 6 .",
      ].join(" | "),
      octave: 2,
      cutoff: 420,
      resonance: 4,
      envelope: 0.5,
      decay: 0.18,
      volume: 0.78,
      shape: 0.45,
      pulse: 0.7,
      curves: { cutoff: swell(0.3, 0.58) },
    },
    lead: {
      sound: 0,
      pattern: [
        "0' . . 0' . . 4' . . . 3' . . . . .",
        ". . . . . . 2' . . . 0' _ _ _ . .",
        "0' . . 0' . . 4' . . . 3' . . . . .",
        ". . . . . . 3' . . . 2' _ _ _ . .",
        "0' . . 0' . . 4' . . . 3' . . . . .",
        ". . . . . . 2' . . . 1' _ _ _ . .",
        "0' . . 0' . . 4' . . . 3' . . . . .",
        ". . . . . . 1' . . . 0' _ _ _ 6 .",
      ].join(" | "),
      tone: 0.26,
      decay: 0.4,
      space: 0.55,
      volume: 0.45,
      width: 0.6,
      curves: { tone: swell(0.16, 0.44) },
    },
    arp: {
      sound: 0,
      pattern: "x.xxx.xxx.xxx.xx",
      accents: "x...x...x...x...",
      rate: "1/16",
      direction: "up",
      octaves: 1,
      gate: 0.5,
      decay: 0.12,
      tone: 0.44,
      space: 0.3,
      volume: 0.29,
      register: 49,
      curves: { decay: swell(0.05, 0.2) },
    },
    pad: {
      sound: 0,
      volume: 0.35,
      tone: 0.38,
      space: 0.6,
      attack: 0.45,
      release: 0.6,
      curves: { tone: swell(0.3, 0.58) },
    },
  },
  {
    // A Dorian loop: a long, softly restarting bass, a low pluck arp whose
    // notes lengthen as its filter opens, and a two-note piano sigh that
    // enters at bar 9. The bass holds A under Am7 and Cmaj7 (Am9), then G and
    // D under Gmaj7 and D7.
    id: "fluff-halflight",
    name: "Halflight",
    genre: "Melodic house",
    scale: { root: 9, mode: "dorian" },
    bpm: 122,
    swing: 0.04,
    pump: 0.3,
    chords: {
      bars: 16,
      steps: [
        [0, 0],
        [6, 0],
        [2, 0],
        [3, 0],
      ],
    },
    drums: {
      kick: { sound: 2, pattern: FOUR, decay: 0.34, volume: 0.88 },
      clap: {
        sound: 6,
        pattern: BACKBEAT,
        decay: 0.24,
        volume: 0.36,
        space: 0.2,
      },
      hat: {
        sound: 2,
        pattern: SIXTEENTHS,
        levels: "3293329332933293",
        decay: 0.12,
        volume: 0.26,
      },
      rim: {
        sound: 2,
        pattern: "......x......x.. | ...x..x.......x.",
        decay: 0.3,
        volume: 0.2,
        pan: -0.3,
      },
    },
    bass: {
      sound: 4,
      pattern: [
        "0 _ _ _ _ _ _ . . . 0 _ _ _ _ .",
        "0 _ _ _ _ _ _ . . . 0 _ _ _ _ .",
        "0 _ _ _ _ _ _ . . . 0 _ _ _ _ .",
        "0 _ _ _ _ _ _ . . . 0 _ _ . 4 .",
        "6 _ _ _ _ _ _ . . . 6 _ _ _ _ .",
        "6 _ _ _ _ _ _ . . . 6 _ _ _ _ .",
        "3 _ _ _ _ _ _ . . . 3 _ _ _ _ .",
        "3 _ _ _ _ _ _ . . . 3 _ _ . 4, .",
      ].join(" | "),
      octave: 1,
      cutoff: 300,
      resonance: 2,
      envelope: 0.3,
      decay: 0.5,
      volume: 0.42,
      shape: 0.5,
      pulse: 0.8,
      curves: { cutoff: swell(0.26, 0.54) },
    },
    lead: {
      sound: 3,
      pattern: [
        ". . . . . . 4 . . . 1 _ _ _ . .",
        ". . . . . . 4 . . . 6 _ _ _ . .",
        ". . . . . . 4 . . . 1 _ _ _ . .",
        ". . . . . . 4 . . . 3 _ _ _ . .",
        ". . . . . . 4 . . . 1 _ _ _ . .",
        ". . . . . . 4 . . . 5 _ _ _ . .",
        ". . . . . . 4 . . . 1 _ _ _ . .",
        ". . . . . . 3 . . . 2 _ _ _ 1 .",
      ].join(" | "),
      tone: 0.32,
      decay: 0.7,
      space: 0.6,
      volume: 0.36,
      width: 0.4,
      curves: { volume: from(8, 0.36) },
    },
    arp: {
      sound: 0,
      pattern: "x..x..x..x..x.x.",
      rate: "1/16",
      direction: "up",
      octaves: 1,
      gate: 0.4,
      decay: 0.14,
      tone: 0.36,
      resonance: 0.3,
      space: 0.45,
      volume: 0.4,
      register: 52,
      curves: { decay: swell(0.06, 0.24), tone: swell(0.3, 0.48) },
    },
    pad: {
      sound: 1,
      volume: 0.41,
      tone: 0.46,
      space: 0.55,
      attack: 0.5,
      release: 0.6,
      motion: 0.3,
      spread: 0.8,
      curves: { tone: swell(0.32, 0.62) },
    },
  },
  {
    // A broken kick and rimshot backbeat with ghost notes, a Reese holding
    // long notes under the chords, a mallet arp in threes against the bar and
    // a sparse "ooh" melody that enters at bar 9. The bass holds D under Dm7
    // and B♭maj7, then G under Gm7 and Am7, stepping to A at the turnaround.
    id: "fluff-tidepool",
    name: "Tidepool",
    genre: "Melodic breaks",
    scale: { root: 2, mode: "minor" },
    bpm: 132,
    swing: 0.06,
    pump: 0.2,
    chords: {
      bars: 16,
      steps: [
        [0, 0],
        [3, 0],
        [5, 0],
        [4, 0],
      ],
    },
    drums: {
      kick: {
        sound: 3,
        pattern: "x.........x..... | x......x..x.....",
        decay: 0.3,
        volume: 0.9,
      },
      snare: {
        sound: 1,
        pattern: "....x.......x... | ....x..x....x..x",
        levels: "0000900000009000 | 0000900300009003",
        decay: 0.25,
        volume: 0.55,
        tone: 0.68,
        space: 0.1,
      },
      hat: {
        sound: 0,
        pattern: "x.x.x.xxx.x.x.x. | x.x.x.x.x.xxx.x.",
        levels: "7050705470507050 | 7050705070547050",
        decay: 0.08,
        volume: 0.34,
      },
      rim: {
        sound: 2,
        pattern: "......x.......x. | ..x.......x.....",
        decay: 0.3,
        volume: 0.16,
        pan: 0.3,
      },
    },
    bass: {
      sound: 5,
      pattern: [
        "0 _ _ _ _ _ _ _ _ _ 0 _ _ _ _ .",
        "0 _ _ _ _ _ _ _ _ _ 0 _ _ _ _ .",
        "0 _ _ _ _ _ _ _ _ _ 0 _ _ _ _ .",
        "0 _ _ _ _ _ _ _ _ _ 0 _ _ 2 _ .",
        "3 _ _ _ _ _ _ _ _ _ 3 _ _ _ _ .",
        "3 _ _ _ _ _ _ _ _ _ 3 _ _ _ _ .",
        "3 _ _ _ _ _ _ _ _ _ 3 _ _ _ _ .",
        "3 _ _ _ _ _ _ _ _ _ 4 _ _ _ _ .",
      ].join(" | "),
      octave: 2,
      cutoff: 320,
      resonance: 3,
      envelope: 0.3,
      decay: 0.5,
      volume: 0.6,
      shape: 0.5,
      pulse: 0.85,
      drive: 0.2,
      curves: { cutoff: swell(0.24, 0.54) },
    },
    arp: {
      sound: 7,
      pattern: "x..x..x..x..x..x",
      rate: "1/16",
      direction: "updown",
      octaves: 1,
      gate: 0.5,
      decay: 0.25,
      tone: 0.46,
      space: 0.5,
      volume: 0.3,
      register: 56,
      curves: { decay: swell(0.08, 0.36) },
    },
    pad: {
      sound: 2,
      volume: 0.42,
      tone: 0.4,
      space: 0.6,
      attack: 0.6,
      release: 0.7,
      curves: { shape: swell(0.2, 0.6, 8) },
    },
    vocal: {
      sound: 32,
      pattern: [
        repeat(". . . . . . . . . . . . . . . .", 8),
        "0 _ _ _ _ _ . . . . . . . . . .",
        ". . . . . . . . 4, _ _ _ . . . .",
        "2 _ _ _ _ _ . . . . . . . . . .",
        ". . . . . . . . 0 _ _ _ . . . .",
        "6, _ _ _ _ _ . . . . . . . . . .",
        ". . . . . . . . 4, _ _ _ . . . .",
        "1 _ _ _ _ _ . . . . . . . . . .",
        ". . . . . . . . . . . . . . . .",
      ].join(" | "),
      octave: 5,
      volume: 0.09,
      loop: true,
      attack: 0.25,
      release: 0.6,
      space: 0.65,
      tone: 0.32,
    },
  },
  {
    // Swung dusty drums, a round syncopated bass, tape-worn electric piano
    // chords and a two-note hummed hook; a piano answers it from bar 9. The
    // bass holds E♭ under E♭m7 and G♭maj7 (E♭m9), then A♭ under A♭7 and
    // D♭maj7.
    id: "fluff-hush",
    name: "Hush",
    genre: "Lo-fi house",
    scale: { root: 3, mode: "dorian" },
    bpm: 122,
    swing: 0.14,
    pump: 0.25,
    chords: {
      bars: 16,
      steps: [
        [0, 0],
        [3, 0],
        [2, 0],
        [6, 0],
      ],
    },
    drums: {
      kick: { sound: 6, pattern: FOUR, decay: 0.3, volume: 0.88 },
      clap: {
        sound: 4,
        pattern: BACKBEAT,
        decay: 0.22,
        volume: 0.38,
        space: 0.12,
      },
      hat: {
        sound: 6,
        pattern: "..x...x...x...xx | ..x...x.x.x...x.",
        levels: "0090009000900095 | 0090009050900090",
        decay: 0.12,
        volume: 0.3,
      },
      snare: {
        sound: 5,
        pattern: ".......x.......x | .......x....x...",
        levels: "0000000500000004 | 0000000500003000",
        decay: 0.1,
        volume: 0.3,
      },
      rim: {
        sound: 0,
        pattern: "...x......x..... | ......x......x..",
        decay: 0.1,
        volume: 0.2,
        pan: -0.25,
      },
    },
    bass: {
      sound: 9,
      pattern: [
        "0 _ . 0 _ . . . . . 0 _ . . . .",
        "0 _ . 0 _ . . . . . 0 _ . . 4, .",
        "0 _ . 0 _ . . . . . 0 _ . . . .",
        "0 _ . 0 _ . . . . . 0 _ . . 6, .",
        "3 _ . 3 _ . . . . . 3 _ . . . .",
        "3 _ . 3 _ . . . . . 3 _ . . 2 .",
        "3 _ . 3 _ . . . . . 3 _ . . . .",
        "3 _ . 3 _ . . . . . 3 _ . . 1 .",
      ].join(" | "),
      octave: 2,
      cutoff: 600,
      resonance: 1,
      envelope: 0.3,
      decay: 0.35,
      volume: 0.66,
      shape: 0.45,
      drive: 0.1,
      pulse: 0.6,
      curves: { cutoff: swell(0.32, 0.56, 8) },
    },
    lead: {
      sound: 3,
      pattern: [
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . 2 . . 0 _ .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . 2 . . 1 _ .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . 2 . . 0 _ .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . 1 . . 6, _ .",
      ].join(" | "),
      octave: 5,
      tone: 0.3,
      decay: 0.6,
      space: 0.5,
      volume: 0.3,
      width: 0.4,
      grit: 0.3,
      curves: { volume: from(8, 0.3) },
    },
    pad: {
      sound: 4,
      volume: 0.4,
      tone: 0.42,
      space: 0.45,
      attack: 0.2,
      release: 0.55,
      motion: 0.45,
      spread: 0.6,
      curves: { tone: swell(0.3, 0.6, 8) },
    },
    vocal: {
      sound: 33,
      pattern: [
        ". . . . . . 2 _ . 1 _ _ _ . . .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . 2 _ . 3 _ _ _ . . .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . 2 _ . 1 _ _ _ . . .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . 0 _ . 1 _ _ _ . . .",
        ". . . . . . . . . . . . . . . .",
      ].join(" | "),
      octave: 4,
      volume: 0.2,
      release: 0.3,
      space: 0.5,
      tone: 0.3,
      curves: { space: swell(0.5, 0.7) },
    },
  },
  {
    // Half-time future bass: a punchy kick, a 909 snare doubled by a layered
    // clap on beat three and crisp closed hats that roll into every second
    // bar. Wide detuned supersaw chords pump hard under the kick; the sub
    // restrikes the chord root with each kick. A soft bell motif repeats on
    // every chord and changes only its answer.
    id: "fluff-kite-string",
    name: "Kite String",
    genre: "Future bass",
    scale: { root: 4, mode: "major" },
    bpm: 150,
    swing: 0,
    pump: 0.85,
    chords: {
      bars: 8,
      steps: [
        [3, 0],
        [5, 0],
        [4, 0],
        [0, 1],
      ],
    },
    drums: {
      kick: {
        sound: 0,
        pattern: "x.........x..... | x.........x.x...",
        decay: 0.3,
        volume: 0.95,
      },
      snare: {
        sound: 0,
        pattern: "........x.......",
        decay: 0.26,
        volume: 0.5,
        space: 0.12,
      },
      clap: {
        sound: 5,
        pattern: "........x.......",
        decay: 0.2,
        volume: 0.34,
        space: 0.1,
      },
      hat: {
        sound: 0,
        pattern: "x.x.x.x.x.x.x.x. | x.x.x.x.x.x.xxxx",
        levels: "7050705070507050 | 7050705070504567",
        decay: 0.08,
        volume: 0.3,
      },
      rim: {
        sound: 5,
        pattern: "x...............",
        decay: 0.6,
        volume: 0.24,
        curves: { volume: firstBar(0.24) },
      },
    },
    bass: {
      sound: 0,
      pattern: [
        "3 _ _ _ _ _ _ _ _ _ 3 _ _ _ _ _",
        "3 _ _ _ _ _ _ _ _ _ 3 _ 3 _ _ _",
        "5, _ _ _ _ _ _ _ _ _ 5, _ _ _ _ _",
        "5, _ _ _ _ _ _ _ _ _ 5, _ 5, _ _ _",
        "4, _ _ _ _ _ _ _ _ _ 4, _ _ _ _ _",
        "4, _ _ _ _ _ _ _ _ _ 4, _ 4, _ _ _",
        "2 _ _ _ _ _ _ _ _ _ 2 _ _ _ _ _",
        "2 _ _ _ _ _ _ _ _ _ 2 _ 2 _ _ _",
      ].join(" | "),
      octave: 2,
      cutoff: 500,
      resonance: 1,
      envelope: 0.2,
      decay: 0.6,
      volume: 0.66,
      shape: 0.4,
      pulse: 0.9,
      curves: { cutoff: swell(0.36, 0.46, 8) },
    },
    lead: {
      sound: 2,
      pattern: [
        ". . 4 . . 2 . . 4 . . 3 . . . .",
        ". . . . . . . . 2 _ _ _ . . . .",
        ". . 4 . . 2 . . 4 . . 1 . . . .",
        ". . . . . . . . 0 _ _ _ . . . .",
        ". . 3 . . 1 . . 3 . . 4 . . . .",
        ". . . . . . . . 2 _ _ _ . . . .",
        ". . 4 . . 2 . . 4 . . 3 . . . .",
        ". . . . . . . . 2 _ _ _ 1 . 0 .",
      ].join(" | "),
      octave: 5,
      tone: 0.3,
      decay: 0.4,
      space: 0.6,
      volume: 0.36,
      width: 0.5,
      curves: { tone: swell(0.22, 0.42, 8) },
    },
    pad: {
      sound: 0,
      volume: 0.5,
      tone: 0.5,
      space: 0.45,
      attack: 0.02,
      release: 0.35,
      motion: 0.15,
      spread: 0.9,
      shape: 0.6,
      curves: { tone: swell(0.38, 0.68) },
    },
  },
  {
    // Deliberately playful: offbeat octave bass, a sung synth-voice melody
    // over the IV–V–iii–vi pop progression, a quiet pulse arp under it, a
    // shouted "hey" every four bars and a snare roll into each eight.
    id: "fluff-hoshi",
    name: "Hoshi",
    genre: "Vocaloid trance pop",
    scale: { root: 2, mode: "major" },
    bpm: 168,
    swing: 0,
    pump: 0.4,
    chords: {
      bars: 8,
      steps: [
        [3, 0],
        [4, 0],
        [2, 0],
        [5, 0],
      ],
    },
    drums: {
      kick: { sound: 0, pattern: FOUR, decay: 0.26, volume: 0.9 },
      clap: {
        sound: 0,
        pattern: BACKBEAT,
        decay: 0.2,
        volume: 0.42,
        space: 0.1,
      },
      hat: { sound: 5, pattern: OFFBEAT, decay: 0.1, volume: 0.16 },
      rim: {
        sound: 3,
        pattern: SIXTEENTHS,
        levels: "2142214221422142",
        decay: 0.05,
        volume: 0.16,
        pan: 0.2,
      },
      snare: {
        sound: 4,
        pattern: `${repeat(REST, 7)} | ........xxxxxxxx`,
        levels: `${repeat("0000000000000000", 7)} | 0000000034567899`,
        decay: 0.1,
        volume: 0.36,
      },
    },
    bass: {
      sound: 1,
      pattern: [
        ". . 3, . . . 3 . . . 3, . . . 3 .",
        ". . 3, . . . 3 . . . 3, . . . 3 .",
        ". . 4, . . . 4 . . . 4, . . . 4 .",
        ". . 4, . . . 4 . . . 4, . . . 4 .",
        ". . 2, . . . 2 . . . 2, . . . 2 .",
        ". . 2, . . . 2 . . . 2, . . . 2 .",
        ". . 5, . . . 5 . . . 5, . . . 5 .",
        ". . 5, . . . 5 . . . 5, . . . 5 .",
      ].join(" | "),
      octave: 2,
      cutoff: 450,
      resonance: 4,
      envelope: 0.5,
      decay: 0.16,
      volume: 0.8,
      shape: 0.45,
      pulse: 0.65,
      curves: { cutoff: swell(0.36, 0.5) },
    },
    lead: {
      sound: 7,
      pattern: [
        "2' . . 2' . . 1' . 0' _ _ 1' _ _ . .",
        ". . 0' . 6 . 5 _ _ . 4 _ _ _ . .",
        "2' . . 2' . . 1' . 0' _ _ 1' _ _ . .",
        ". . 0' . 1' . 2' _ _ . 4' _ _ _ . .",
        "2' . . 2' . . 1' . 0' _ _ 1' _ _ . .",
        ". . 0' . 6 . 5 _ _ . 6 _ _ _ . .",
        "2' . . 2' . . 3' . 2' _ _ 1' _ _ . .",
        ". . 0' . 1' . 0' _ _ . 5 _ _ _ . .",
      ].join(" | "),
      tone: 0.5,
      decay: 0.5,
      space: 0.35,
      volume: 0.34,
      width: 0.5,
      motion: 0.45,
      curves: { tone: swell(0.36, 0.64) },
    },
    arp: {
      sound: 4,
      pattern: "x.xxx.xxx.xxx.xx",
      rate: "1/16",
      direction: "updown",
      octaves: 1,
      gate: 0.45,
      decay: 0.1,
      tone: 0.46,
      space: 0.25,
      volume: 0.26,
      register: 50,
      curves: { decay: swell(0.04, 0.14) },
    },
    pad: {
      sound: 0,
      volume: 0.41,
      tone: 0.48,
      space: 0.4,
      attack: 0.2,
      release: 0.4,
      curves: { tone: swell(0.42, 0.56) },
    },
    vocal: {
      sound: 45,
      pattern: [
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . . . . . 0 .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . . . 0 . 0 .",
      ].join(" | "),
      octave: 4,
      volume: 0.24,
      space: 0.4,
      tone: 0.45,
    },
  },
  {
    // A five-note pluck riff cycling against the sixteen-step bar, so its
    // accents shift every bar while the filter slowly opens. A galloping bass
    // pedals E under Em7 and Am7, then C under Cmaj7 and D7 (a Lydian lift),
    // with a phased string pad swelling underneath.
    id: "fluff-glasshouse",
    name: "Glasshouse",
    genre: "Melodic progressive",
    scale: { root: 4, mode: "minor" },
    bpm: 126,
    swing: 0,
    pump: 0.4,
    chords: {
      bars: 16,
      steps: [
        [0, 0],
        [5, 0],
        [3, 0],
        [6, 0],
      ],
    },
    drums: {
      kick: { sound: 1, pattern: FOUR, decay: 0.32, volume: 1 },
      clap: {
        sound: 0,
        pattern: BACKBEAT,
        decay: 0.22,
        volume: 0.4,
        space: 0.1,
      },
      hat: { sound: 5, pattern: OFFBEAT, decay: 0.12, volume: 0.16 },
      rim: {
        sound: 0,
        pattern: "...x..x....x..x.",
        levels: "0005009000050090",
        decay: 0.1,
        volume: 0.2,
        pan: 0.3,
        curves: { volume: from(4, 0.2) },
      },
    },
    bass: {
      sound: 3,
      pattern: [
        ". . 0 0 . . 0 0 . . 0 0 . . 0 0",
        ". . 0 0 . . 0 0 . . 0 0 . . 0 0",
        ". . 0 0 . . 0 0 . . 0 0 . . 0 0",
        ". . 0 0 . . 0 0 . . 0 0 . . 0' 0",
        ". . 5, 5, . . 5, 5, . . 5, 5, . . 5, 5,",
        ". . 5, 5, . . 5, 5, . . 5, 5, . . 5, 5,",
        ". . 5, 5, . . 5, 5, . . 5, 5, . . 5, 5,",
        ". . 5, 5, . . 5, 5, . . 5, 5, . . 5 5,",
      ].join(" | "),
      octave: 2,
      cutoff: 300,
      resonance: 4,
      envelope: 0.45,
      decay: 0.16,
      volume: 0.56,
      shape: 0.4,
      pulse: 0.5,
      curves: { cutoff: swell(0.24, 0.54) },
    },
    arp: {
      sound: 0,
      pattern: SIXTEENTHS,
      accents: "x..x..x..x..x...",
      riff: "0 4 2 6 1",
      octave: 4,
      rate: "1/16",
      direction: "played",
      octaves: 1,
      gate: 0.5,
      decay: 0.14,
      tone: 0.31,
      resonance: 0.45,
      space: 0.4,
      volume: 0.28,
      curves: { tone: swell(0.18, 0.76, 13), decay: swell(0.07, 0.22, 13) },
    },
    pad: {
      sound: 6,
      volume: 0.4,
      tone: 0.38,
      space: 0.6,
      attack: 0.6,
      release: 0.7,
      motion: 0.5,
      curves: { volume: swell(0.28, 0.52) },
    },
  },
  {
    // Shuffled two-step drums, a bending square bass that jumps octaves, and
    // a two-chord organ stab (D minor and B♭ triads over a G minor bass, then
    // over E♭: a minor-ninth and a Lydian colour) answered by a sung chop.
    // The bass holds G under Gm7 and Cm7, then E♭ under E♭maj7 and Dm7.
    id: "fluff-night-swim",
    name: "Night Swim",
    genre: "UK garage",
    scale: { root: 7, mode: "minor" },
    bpm: 132,
    swing: 0.2,
    pump: 0.2,
    chords: {
      bars: 16,
      steps: [
        [0, 0],
        [5, 0],
        [3, 0],
        [4, 0],
      ],
    },
    drums: {
      kick: {
        sound: 3,
        pattern: "x.........x..... | x.......x.x.....",
        decay: 0.28,
        volume: 0.9,
      },
      snare: {
        sound: 2,
        pattern: BACKBEAT,
        decay: 0.2,
        volume: 0.5,
        space: 0.08,
      },
      hat: {
        sound: 0,
        pattern: "..x.x.x...x.x.x. | ..x.x.x.x.x...x.",
        levels: "0090509000905090 | 0090509040900090",
        decay: 0.07,
        volume: 0.34,
      },
      rim: {
        sound: 0,
        pattern: "...x.....x....x.",
        levels: "0005000004000060",
        decay: 0.1,
        volume: 0.22,
        pan: -0.3,
      },
    },
    bass: {
      sound: 10,
      pattern: [
        "0 _ . . . . 0' . . . 0 _ . 0' . .",
        "0 _ . . . . 0' . . . 0 _ . . 6, .",
        "0 _ . . . . 0' . . . 0 _ . 0' . .",
        "0 _ . . . . 0' . . . 0 _ . 2 . .",
        "5 _ . . . . 5' . . . 5 _ . 5' . .",
        "5 _ . . . . 5' . . . 5 _ . . 4 .",
        "5 _ . . . . 5' . . . 5 _ . 5' . .",
        "5 _ . . . . 5' . . . 5 _ . 4 . .",
      ].join(" | "),
      octave: 1,
      cutoff: 520,
      resonance: 3,
      envelope: 0.5,
      decay: 0.2,
      volume: 0.78,
      shape: 0.5,
      drive: 0.15,
      pulse: 0.55,
      curves: { cutoff: swell(0.3, 0.56) },
    },
    lead: {
      sound: 4,
      pattern: [
        ". . . 4 . . 4 . . . . . . 2 . .",
        ". . . 4 . . . . . . . . . . . .",
        ". . . 4 . . 4 . . . . . . 2 . .",
        ". . . 4 . . . . . . . . . . . .",
        ". . . 4 . . 4 . . . . . . 2 . .",
        ". . . 4 . . . . . . . . . . . .",
        ". . . 4 . . 4 . . . . . . 2 . .",
        ". . . 4 . . . . . . . . . . . .",
      ].join(" | "),
      octave: 3,
      tone: 0.18,
      decay: 0.25,
      space: 0.5,
      volume: 0.45,
      curves: { tone: swell(0.12, 0.34) },
    },
    pad: {
      sound: 5,
      volume: 0.36,
      tone: 0.36,
      space: 0.5,
      attack: 0.6,
      release: 0.6,
      curves: { tone: swell(0.32, 0.44) },
    },
    vocal: {
      sound: 35,
      pattern: [
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . 6 _ . 4 _ _ _ . . .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . 0' _ . 6 _ _ _ . . .",
      ].join(" | "),
      octave: 3,
      volume: 0.15,
      release: 0.3,
      space: 0.55,
      tone: 0.3,
    },
  },
  {
    // Rolling sixteenth bass, a supersaw hook that repeats its first bar and
    // changes only its answer, and a gated pluck arp entering at bar 9 below
    // it. The bass holds B under Bm7 and A7 (a suspended B11), then G under
    // Gmaj7 and Em7.
    id: "fluff-overpass",
    name: "Overpass",
    genre: "Fast trance",
    scale: { root: 11, mode: "minor" },
    bpm: 142,
    swing: 0,
    pump: 0.5,
    chords: {
      bars: 16,
      steps: [
        [0, 0],
        [5, 0],
        [6, 0],
        [3, 0],
      ],
    },
    drums: {
      kick: { sound: 0, pattern: FOUR, decay: 0.26, volume: 0.9 },
      clap: {
        sound: 1,
        pattern: BACKBEAT,
        decay: 0.2,
        volume: 0.42,
        space: 0.12,
      },
      hat: { sound: 5, pattern: OFFBEAT, decay: 0.1, volume: 0.19 },
      rim: {
        sound: 3,
        pattern: SIXTEENTHS,
        levels: "2142214221422142",
        decay: 0.05,
        volume: 0.16,
        pan: -0.2,
      },
      snare: {
        sound: 4,
        pattern: `${repeat(REST, 7)} | x...x...x.x.xxxx`,
        levels: `${repeat("0000000000000000", 7)} | 3000400050607899`,
        decay: 0.12,
        volume: 0.4,
        curves: { volume: lastBar(0.4) },
      },
    },
    bass: {
      sound: 2,
      pattern: [
        ". 0 0 0 . 0 0 0 . 0 0 0 . 0 0 0",
        ". 0 0 0 . 0 0 0 . 0 0 0 . 0 0 0",
        ". 0 0 0 . 0 0 0 . 0 0 0 . 0 0 0",
        ". 0 0 0 . 0 0 0 . 0 0 0 . 0' 0 0",
        ". 5 5 5 . 5 5 5 . 5 5 5 . 5 5 5",
        ". 5 5 5 . 5 5 5 . 5 5 5 . 5 5 5",
        ". 5 5 5 . 5 5 5 . 5 5 5 . 5 5 5",
        ". 5 5 5 . 5 5 5 . 5 5 5 . 6 6 6",
      ].join(" | "),
      octave: 1,
      cutoff: 360,
      resonance: 4,
      envelope: 0.5,
      decay: 0.16,
      volume: 0.58,
      shape: 0.45,
      pulse: 0.55,
      curves: { cutoff: swell(0.26, 0.56) },
    },
    lead: {
      sound: 0,
      pattern: [
        "2' . . 2' . . 4' . . . 3' . 2' . . .",
        "0' _ _ _ . . . . . . 1' . 2' . . .",
        "2' . . 2' . . 4' . . . 3' . 2' . . .",
        "0' _ _ _ . . . . . . 6 . 0' . . .",
        "2' . . 2' . . 4' . . . 3' . 2' . . .",
        "0' _ _ _ . . . . . . 1' . 2' . . .",
        "2' . . 2' . . 4' . . . 3' . 2' . . .",
        "3' _ _ _ . . . . . . 2' . 1' . . .",
      ].join(" | "),
      octave: 3,
      tone: 0.32,
      decay: 0.35,
      space: 0.5,
      volume: 0.45,
      width: 0.65,
      curves: { tone: swell(0.2, 0.5) },
    },
    arp: {
      sound: 0,
      pattern: "x.xxx.xxx.xxx.xx",
      accents: "x...x...x...x...",
      rate: "1/16",
      direction: "up",
      octaves: 1,
      gate: 0.45,
      decay: 0.1,
      tone: 0.46,
      space: 0.25,
      volume: 0.25,
      register: 48,
      curves: { volume: from(8, 0.25) },
    },
    pad: {
      sound: 0,
      volume: 0.38,
      tone: 0.4,
      space: 0.5,
      attack: 0.4,
      release: 0.5,
      curves: { tone: swell(0.34, 0.5) },
    },
  },
  {
    // Warm and unhurried: an FM bass on the one and the and-of-three, a
    // chorused electric piano arpeggio and a soft two-note line from bar 9.
    // The bass holds C under Cm7 and A♭maj7, then F and B♭ under Fm7 and B♭7,
    // so Fm7 over B♭ gives the suspended eleventh of deep house.
    id: "fluff-low-sun",
    name: "Low Sun",
    genre: "Deep house",
    scale: { root: 0, mode: "minor" },
    bpm: 122,
    swing: 0.08,
    pump: 0.3,
    chords: {
      bars: 16,
      steps: [
        [0, 0],
        [3, 0],
        [5, 0],
        [6, 0],
      ],
    },
    drums: {
      kick: { sound: 2, pattern: FOUR, decay: 0.34, volume: 1 },
      clap: {
        sound: 0,
        pattern: BACKBEAT,
        decay: 0.22,
        volume: 0.36,
        space: 0.12,
      },
      hat: { sound: 1, pattern: OFFBEAT, decay: 0.07, volume: 0.3 },
      snare: {
        sound: 5,
        pattern: "......x.......x.",
        levels: "0000003000000040",
        decay: 0.1,
        volume: 0.24,
      },
      rim: {
        sound: 0,
        pattern: "...x..x....x....",
        levels: "0005005000060000",
        decay: 0.1,
        volume: 0.18,
        pan: 0.25,
      },
    },
    bass: {
      sound: 7,
      pattern: [
        "0 _ . . . . . . . . 0 _ . 0' _ .",
        "0 _ . . . . . . . . 0 _ . 4 _ .",
        "0 _ . . . . . . . . 0 _ . 0' _ .",
        "0 _ . . . . . . . . 0 _ . 6, _ .",
        "3 _ . . . . . . . . 3 _ . 0' _ .",
        "3 _ . . . . . . . . 3 _ . 2 _ .",
        "6, _ . . . . . . . . 6, _ . 6 _ .",
        "6, _ . . . . . . . . 6, _ . 4 _ .",
      ].join(" | "),
      octave: 2,
      cutoff: 500,
      resonance: 2,
      envelope: 0.4,
      decay: 0.3,
      volume: 0.52,
      shape: 0.5,
      pulse: 0.7,
      curves: { cutoff: swell(0.28, 0.54) },
    },
    lead: {
      sound: 6,
      pattern: [
        ". . . . . . . . . . 4 _ _ 2 _ _",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . 4 _ _ 6 _ _",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . 3 _ _ 2 _ _",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . 3 _ _ 1 _ _",
        ". . . . . . . . . . . . . . . .",
      ].join(" | "),
      octave: 5,
      tone: 0.35,
      decay: 0.5,
      space: 0.55,
      volume: 0.36,
      motion: 0.3,
      attack: 0.1,
      curves: { volume: from(8, 0.36) },
    },
    arp: {
      sound: 3,
      pattern: "x...x.x...x...x.",
      rate: "1/16",
      direction: "updown",
      octaves: 1,
      gate: 0.9,
      decay: 0.6,
      tone: 0.41,
      space: 0.45,
      volume: 0.26,
      register: 55,
      curves: { tone: swell(0.28, 0.6), space: swell(0.4, 0.6) },
    },
    pad: {
      sound: 3,
      volume: 0.34,
      tone: 0.38,
      space: 0.6,
      attack: 0.6,
      release: 0.7,
    },
  },
  {
    // Phrygian and driven: a growling sixteenth bass whose filter opens over
    // thirteen bars, a resonant square motif that circles the fifth and the
    // flat sixth, and a dark choir. The bass holds G under Gm7 and Cm7, then
    // A♭ under A♭maj7, so each eight bars ends on the flat second.
    id: "fluff-undertone",
    name: "Undertone",
    genre: "Dark melodic house",
    scale: { root: 7, mode: "phrygian" },
    bpm: 124,
    swing: 0,
    pump: 0.65,
    chords: {
      bars: 16,
      steps: [
        [0, 0],
        [1, 0],
        [3, 0],
        [1, 0],
      ],
    },
    drums: {
      kick: { sound: 5, pattern: FOUR, decay: 0.3, volume: 0.75 },
      clap: {
        sound: 2,
        pattern: BACKBEAT,
        decay: 0.26,
        volume: 0.34,
        space: 0.1,
      },
      hat: { sound: 1, pattern: OFFBEAT, decay: 0.08, volume: 0.3 },
      rim: {
        sound: 1,
        pattern: "..........x..... | ......x......x..",
        decay: 0.3,
        volume: 0.16,
        pan: -0.25,
      },
    },
    bass: {
      sound: 8,
      pattern: [
        ". 0 0 . . 0 0 . . 0! 0 . . 0 0 .",
        ". 0 0 . . 0 0 . . 0! 0 . . 0 0 .",
        ". 0 0 . . 0 0 . . 0! 0 . . 0 0 .",
        ". 0 0 . . 0 0 . . 0! 0 . . 0' 0 .",
        ". 1 1 . . 1 1 . . 1! 1 . . 1 1 .",
        ". 1 1 . . 1 1 . . 1! 1 . . 1 1 .",
        ". 1 1 . . 1 1 . . 1! 1 . . 1 1 .",
        ". 1 1 . . 1 1 . . 1! 1 . . 1' 0' .",
      ].join(" | "),
      octave: 1,
      cutoff: 260,
      resonance: 6,
      envelope: 0.5,
      decay: 0.2,
      volume: 0.58,
      shape: 0.5,
      drive: 0.3,
      pulse: 0.5,
      curves: { cutoff: swell(0.18, 0.56, 13) },
    },
    lead: {
      sound: 5,
      pattern: [
        ". . 4 . . 5 . . 4 . . . . . . .",
        ". . 4 . . 5 . . 3 . . . . . . .",
        ". . 4 . . 5 . . 4 . . . . . . .",
        ". . 4 . . 5 . . 1 _ _ _ . . . .",
        ". . 4 . . 5 . . 4 . . . . . . .",
        ". . 4 . . 5 . . 3 . . . . . . .",
        ". . 4 . . 5 . . 4 . . . . . . .",
        ". . 4 . . 5 . . 6 _ _ _ . . . .",
      ].join(" | "),
      tone: 0.22,
      decay: 0.3,
      space: 0.6,
      volume: 0.36,
      motion: 0.3,
      curves: { tone: swell(0.12, 0.42, 13) },
    },
    pad: {
      sound: 2,
      volume: 0.38,
      tone: 0.34,
      space: 0.65,
      attack: 0.7,
      release: 0.8,
      shape: 0.3,
      curves: { shape: swell(0.15, 0.5) },
    },
  },
  {
    // A broken kick and shuffled hats under dark analog strings in a long
    // hall. The bass follows the kick and holds F♯ under F♯m9 and Dadd9,
    // then E under Bm(add9) (heard as E9sus) and an unresolved Esus4. A
    // filtered poly synth answers each bar with three chord tones; its
    // filter opens over ten bars.
    id: "fluff-sodium",
    name: "Sodium",
    genre: "UK breaks",
    scale: { root: 6, mode: "minor" },
    bpm: 136,
    swing: 0.16,
    pump: 0.25,
    chords: {
      bars: 16,
      steps: [
        [0, 0, { quality: "ninth" }],
        [3, 0, { quality: "add9" }],
        [5, 0, { quality: "add9" }],
        [6, 0, { quality: "sus4" }],
      ],
    },
    drums: {
      kick: {
        sound: 1,
        pattern: "x.....x...x..... | ..x.......x.....",
        decay: 0.3,
        volume: 1,
      },
      snare: {
        sound: 1,
        pattern: "....x.......x... | ....x.......x..x",
        levels: "0000900000009000 | 0000900000009003",
        decay: 0.24,
        volume: 0.52,
        tone: 0.62,
        space: 0.12,
      },
      hat: {
        sound: 0,
        pattern: "x.xxx.x.x.xxx.x. | x.x.x.xxx.x.x.xx",
        levels: "6034504060345040 | 6040504560405034",
        decay: 0.07,
        volume: 0.32,
      },
      clap: {
        sound: 2,
        pattern: "................ | ............x...",
        decay: 0.3,
        volume: 0.3,
        space: 0.35,
        curves: { volume: from(8, 0.3) },
      },
      rim: {
        sound: 1,
        pattern: "................ | ...........x....",
        decay: 0.4,
        volume: 0.18,
        pan: -0.3,
        space: 0.4,
      },
    },
    bass: {
      sound: 4,
      pattern: [
        "0 _ _ _ _ _ 0 _ _ _ 0 _ _ _ _ .",
        ". . 0 _ _ _ _ _ _ _ 0 _ _ _ _ .",
        "0 _ _ _ _ _ 0 _ _ _ 0 _ _ _ _ .",
        ". . 0 _ _ _ _ _ _ _ 0 _ _ 6, _ .",
        "6, _ _ _ _ _ 6, _ _ _ 6, _ _ _ _ .",
        ". . 6, _ _ _ _ _ _ _ 6, _ _ _ _ .",
        "6, _ _ _ _ _ 6, _ _ _ 6, _ _ _ _ .",
        ". . 6, _ _ _ _ _ _ _ 6, _ _ 0 _ .",
      ].join(" | "),
      octave: 2,
      cutoff: 380,
      resonance: 2,
      envelope: 0.3,
      decay: 0.5,
      volume: 0.48,
      shape: 0.5,
      pulse: 0.8,
      drive: 0.15,
      curves: { cutoff: swell(0.28, 0.56, 10) },
    },
    arp: {
      sound: 6,
      pattern: "..x..x.x........ | ..x..x....x.....",
      rate: "1/16",
      direction: "up",
      octaves: 1,
      gate: 0.35,
      decay: 0.18,
      tone: 0.28,
      space: 0.55,
      volume: 0.3,
      register: 57,
      curves: { tone: swell(0.24, 0.5, 10), decay: swell(0.12, 0.3, 10) },
    },
    pad: {
      sound: 5,
      volume: 0.36,
      tone: 0.34,
      space: 0.7,
      attack: 0.6,
      release: 0.7,
      motion: 0.3,
      spread: 0.8,
      curves: { tone: swell(0.28, 0.5) },
    },
  },
  {
    // Percussion carries it: shaker sixteenths, a ghost rim and congas from
    // bar 5. Minor ninths throughout, the last borrowed from Dorian (E♭9,
    // with G natural). The bass repeats one two-note figure, B♭ falling to
    // A♭ under B♭m9, then E♭ to D♭ under G♭maj9 (heard as E♭m11) and E♭9.
    // A low pluck ostinato lengthens and opens over fourteen bars over a
    // slow phased pad.
    id: "fluff-slow-turn",
    name: "Slow Turn",
    genre: "Hypnotic house",
    scale: { root: 10, mode: "minor" },
    bpm: 122,
    swing: 0.06,
    pump: 0.35,
    chords: {
      bars: 16,
      steps: [
        [0, 0, { quality: "ninth" }],
        [5, 0, { quality: "ninth" }],
        [0, 0, { quality: "ninth" }],
        [3, 0, { quality: "ninth", borrow: "dorian" }],
      ],
    },
    drums: {
      kick: { sound: 2, pattern: FOUR, decay: 0.34, volume: 0.95 },
      clap: {
        sound: 6,
        pattern: BACKBEAT,
        decay: 0.22,
        volume: 0.3,
        space: 0.15,
      },
      hat: {
        sound: 2,
        pattern: SIXTEENTHS,
        levels: "3393339333933393",
        decay: 0.1,
        volume: 0.26,
      },
      snare: {
        sound: 5,
        pattern: "...x......x.....",
        levels: "0004000000300000",
        decay: 0.1,
        volume: 0.24,
      },
      rim: {
        sound: 2,
        pattern: "......x...x..x.. | ...x..x.......x.",
        decay: 0.3,
        volume: 0.22,
        pan: 0.3,
        curves: { volume: from(4, 0.22) },
      },
    },
    bass: {
      sound: 9,
      pattern: [
        "0 _ _ . . . . . . . 0 _ . 6, _ .",
        "0 _ _ . . . . . . . 0 _ . 6, _ .",
        "0 _ _ . . . . . . . 0 _ . 6, _ .",
        "0 _ _ . . . . . . . 0 _ . 6, _ .",
        "3 _ _ . . . . . . . 3 _ . 2 _ .",
        "3 _ _ . . . . . . . 3 _ . 2 _ .",
        "3 _ _ . . . . . . . 3 _ . 2 _ .",
        "3 _ _ . . . . . . . 3 _ . 4, _ .",
      ].join(" | "),
      octave: 2,
      cutoff: 450,
      resonance: 2,
      envelope: 0.3,
      decay: 0.4,
      volume: 0.52,
      shape: 0.45,
      pulse: 0.6,
      curves: { cutoff: swell(0.36, 0.54) },
    },
    arp: {
      sound: 0,
      pattern: "x..x..x...x..x..",
      rate: "1/16",
      direction: "up",
      octaves: 1,
      gate: 0.4,
      decay: 0.06,
      tone: 0.22,
      resonance: 0.35,
      space: 0.4,
      volume: 0.32,
      register: 58,
      curves: { tone: swell(0.18, 0.6, 14), decay: swell(0.05, 0.28, 14) },
    },
    pad: {
      sound: 6,
      volume: 0.46,
      tone: 0.34,
      space: 0.6,
      attack: 0.7,
      release: 0.8,
      motion: 0.5,
      curves: { tone: swell(0.28, 0.46) },
    },
  },
  {
    // Fast and dusty: a lo-fi kick, open hats on the offbeat and an organ
    // stab motif (A minor, A minor, G over the first chords, C, C, G over
    // the others) pumping hard over plain triads. The offbeat bass holds A
    // under Am and Dm, then C under F and Em (heard as Cmaj7); tape keys
    // join at bar 9.
    id: "fluff-brickwork",
    name: "Brickwork",
    genre: "Lo-fi rave",
    scale: { root: 9, mode: "minor" },
    bpm: 140,
    swing: 0,
    pump: 0.75,
    chords: {
      bars: 16,
      steps: [
        [0, 0, { quality: "triad" }],
        [5, 0, { quality: "triad" }],
        [3, 0, { quality: "triad" }],
        [4, 0, { quality: "triad" }],
      ],
    },
    drums: {
      kick: { sound: 6, pattern: FOUR, decay: 0.3, volume: 0.88 },
      clap: {
        sound: 4,
        pattern: BACKBEAT,
        decay: 0.22,
        volume: 0.38,
        space: 0.1,
      },
      hat: { sound: 1, pattern: OFFBEAT, decay: 0.09, volume: 0.2 },
      rim: {
        sound: 3,
        pattern: "...x...x...x...x",
        levels: "0003000500030005",
        decay: 0.1,
        volume: 0.2,
        pan: 0.25,
      },
      snare: {
        sound: 3,
        pattern: `${repeat(REST, 7)} | ........x.x.xxxx`,
        levels: `${repeat("0000000000000000", 7)} | 0000000030405678`,
        decay: 0.12,
        volume: 0.34,
        curves: { volume: lastBar(0.34) },
      },
    },
    bass: {
      sound: 1,
      pattern: [
        ". . 0 . . . 0 . . . 0 . . . 0 .",
        ". . 0 . . . 0 . . . 0 . . . 0 .",
        ". . 0 . . . 0 . . . 0 . . . 0 .",
        ". . 0 . . . 0 . . . 0 . . . 6, .",
        ". . 2 . . . 2 . . . 2 . . . 2 .",
        ". . 2 . . . 2 . . . 2 . . . 2 .",
        ". . 2 . . . 2 . . . 2 . . . 2 .",
        ". . 2 . . . 2 . . . 2 . . . 4 .",
      ].join(" | "),
      octave: 2,
      cutoff: 400,
      resonance: 3,
      envelope: 0.45,
      decay: 0.2,
      volume: 0.95,
      shape: 0.45,
      pulse: 0.6,
      curves: { cutoff: swell(0.38, 0.6) },
    },
    lead: {
      sound: 4,
      pattern: [
        ". . 0 . . 0 . . . . 6, . . . . .",
        ". . 0 . . 0 . . . . . . . . . .",
        ". . 0 . . 0 . . . . 6, . . . . .",
        ". . 0 . . 0 . . . . . . . 6, . .",
        ". . 2 . . 2 . . . . 6, . . . . .",
        ". . 2 . . 2 . . . . . . . . . .",
        ". . 2 . . 2 . . . . 6, . . . . .",
        ". . 2 . . 2 . . . . . . . 4 . .",
      ].join(" | "),
      octave: 3,
      tone: 0.25,
      decay: 0.2,
      space: 0.35,
      volume: 0.3,
      grit: 0.2,
      curves: { tone: swell(0.18, 0.4) },
    },
    pad: {
      sound: 4,
      volume: 0.4,
      tone: 0.36,
      space: 0.4,
      attack: 0.2,
      release: 0.5,
      motion: 0.4,
      curves: { volume: from(8, 0.4) },
    },
  },
  {
    // Swung two-step drums opening into a house kick every second bar, a
    // bouncing organ bass, chopped electric piano chord tones and a quiet
    // bell answer from bar 9. The bass holds F under Fm9 and E♭add9 (heard
    // as F11), then B♭ under B♭9 and Cm9.
    id: "fluff-late-bus",
    name: "Late Bus",
    genre: "2-step house",
    scale: { root: 5, mode: "dorian" },
    bpm: 132,
    swing: 0.26,
    pump: 0.3,
    chords: {
      bars: 16,
      steps: [
        [0, 0, { quality: "ninth" }],
        [3, 0, { quality: "ninth" }],
        [6, 0, { quality: "add9" }],
        [4, 0, { quality: "ninth" }],
      ],
    },
    drums: {
      kick: {
        sound: 1,
        pattern: "x......x..x..... | x...x...x.x.....",
        decay: 0.3,
        volume: 1,
      },
      snare: {
        sound: 2,
        pattern: BACKBEAT,
        decay: 0.2,
        volume: 0.5,
        space: 0.08,
      },
      clap: {
        sound: 1,
        pattern: BACKBEAT,
        decay: 0.2,
        volume: 0.36,
        space: 0.1,
      },
      hat: {
        sound: 0,
        pattern: "..x.x.xx..x.x.x. | x.x.x.x...x.xxx.",
        levels: "0090509400905090 | 5090509000904590",
        decay: 0.07,
        volume: 0.28,
      },
      rim: {
        sound: 0,
        pattern: "...x......x..x..",
        levels: "0004000000500040",
        decay: 0.1,
        volume: 0.2,
        pan: -0.3,
      },
    },
    bass: {
      sound: 6,
      pattern: [
        "0 _ . 0 . . . . . . 0 _ . 0' . .",
        "0 _ . 0 . . . . . . 0 _ . . 6, .",
        "0 _ . 0 . . . . . . 0 _ . 0' . .",
        "0 _ . 0 . . . . . . 0 _ . . 2 .",
        "3 _ . 3 . . . . . . 3 _ . 3' . .",
        "3 _ . 3 . . . . . . 3 _ . . 2 .",
        "3 _ . 3 . . . . . . 3 _ . 3' . .",
        "3 _ . 3 . . . . . . 3 _ . . 4 .",
      ].join(" | "),
      octave: 1,
      cutoff: 450,
      resonance: 2,
      envelope: 0.4,
      decay: 0.25,
      volume: 0.9,
      shape: 0.45,
      pulse: 0.6,
      curves: { cutoff: swell(0.3, 0.5) },
    },
    lead: {
      sound: 2,
      pattern: [
        ". . . . . . . . . . 4 . . 2 _ .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . 4 . . 2 _ .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . 4 . . 3 _ .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . 4 . . 2 _ .",
        ". . . . . . . . . . . . . . . .",
      ].join(" | "),
      octave: 4,
      tone: 0.2,
      decay: 0.4,
      space: 0.6,
      volume: 0.22,
      width: 0.4,
      curves: { volume: from(8, 0.22) },
    },
    arp: {
      sound: 3,
      pattern: "...x..x.....x... | ...x..x...x.....",
      rate: "1/16",
      direction: "up",
      octaves: 1,
      gate: 0.5,
      decay: 0.3,
      tone: 0.3,
      space: 0.4,
      volume: 0.26,
      register: 60,
      curves: { tone: swell(0.24, 0.5) },
    },
    pad: {
      sound: 3,
      volume: 0.38,
      tone: 0.34,
      space: 0.55,
      attack: 0.5,
      release: 0.6,
    },
  },
  {
    // A steady kick, ticking sixteenths and a hall clap under a detuned pad
    // that brightens over twelve bars, with a two-bar bell figure swelling
    // in and out of it. Open add9 and sus2 chords never resolve: the sub
    // holds A♭ under A♭m(add9) and C♭sus2, then D♭ under F♭add9 (heard as
    // D♭m11) and G♭sus2.
    id: "fluff-parallax",
    name: "Parallax",
    genre: "Melodic techno",
    scale: { root: 8, mode: "minor" },
    bpm: 126,
    swing: 0,
    pump: 0.45,
    chords: {
      bars: 16,
      steps: [
        [0, 0, { quality: "add9" }],
        [5, 0, { quality: "add9" }],
        [2, 0, { quality: "sus2" }],
        [6, 0, { quality: "sus2" }],
      ],
    },
    drums: {
      kick: { sound: 1, pattern: FOUR, decay: 0.32, volume: 1 },
      clap: {
        sound: 2,
        pattern: BACKBEAT,
        decay: 0.26,
        volume: 0.3,
        space: 0.3,
      },
      hat: {
        sound: 3,
        pattern: SIXTEENTHS,
        levels: "3363336333633363",
        decay: 0.08,
        volume: 0.36,
      },
      rim: {
        sound: 1,
        pattern: "......x......... | ..........x.....",
        decay: 0.3,
        volume: 0.18,
        pan: 0.3,
        space: 0.3,
        curves: { volume: from(4, 0.18) },
      },
    },
    bass: {
      sound: 0,
      pattern: [
        "0 _ _ _ _ _ . . . . 0 _ _ _ . .",
        "0 _ _ _ _ _ . . . . 0 _ _ _ . .",
        "0 _ _ _ _ _ . . . . 0 _ _ _ . .",
        "0 _ _ _ _ _ . . . . 0 _ _ _ . .",
        "3 _ _ _ _ _ . . . . 3 _ _ _ . .",
        "3 _ _ _ _ _ . . . . 3 _ _ _ . .",
        "3 _ _ _ _ _ . . . . 3 _ _ _ . .",
        "3 _ _ _ _ _ . . . . 3 _ _ _ . .",
      ].join(" | "),
      octave: 1,
      cutoff: 300,
      resonance: 1,
      envelope: 0.2,
      decay: 0.6,
      volume: 0.42,
      shape: 0.4,
      pulse: 0.8,
      curves: { cutoff: swell(0.3, 0.48) },
    },
    arp: {
      sound: 5,
      pattern: "x..x...x....x... | ..x..x...x......",
      rate: "1/16",
      direction: "updown",
      octaves: 1,
      gate: 0.6,
      decay: 0.4,
      tone: 0.3,
      space: 0.6,
      volume: 0.3,
      register: 63,
      curves: { volume: swell(0.2, 0.38, 12), tone: swell(0.22, 0.46, 12) },
    },
    pad: {
      sound: 0,
      volume: 0.42,
      tone: 0.3,
      space: 0.6,
      attack: 0.7,
      release: 0.8,
      motion: 0.35,
      spread: 0.9,
      curves: { tone: swell(0.22, 0.66, 12), shape: swell(0.3, 0.6) },
    },
  },
];

export const FLUFF_PRESETS: ReadonlyArray<{
  id: string;
  name: string;
  genre: string;
}> = TRACKS.map(({ id, name, genre }) => ({ id, name, genre }));

function barCount(bars: number, label: string): SequenceTiming["bars"] {
  if (bars === 1 || bars === 2 || bars === 4 || bars === 8) return bars;
  throw new Error(`${label} must be 1, 2, 4 or 8 bars.`);
}
function drumCells(pattern: string, label: string): string[] {
  const bars = pattern.split("|").map((bar) => bar.replace(/\s+/g, ""));
  for (const bar of bars)
    if (bar.length !== 16) throw new Error(`${label} needs 16 cells per bar.`);
  return bars.join("").split("");
}
function noteTokens(pattern: string, label: string): string[] {
  const bars = pattern.split("|").map((bar) => bar.trim().split(/\s+/));
  for (const bar of bars)
    if (bar.length !== 16) throw new Error(`${label} needs 16 steps per bar.`);
  return bars.flat();
}
interface ParsedNote {
  note: number;
  accent: boolean;
  glide: boolean;
}
/** Resolve a degree token against the scale, folded into the instrument's range. */
function parseNote(
  token: string,
  scale: MusicalScale,
  octave: number,
  minimum: number,
  maximum: number,
  label: string,
): ParsedNote {
  const match = /^(\d)('*)(,*)(!?)(~?)$/.exec(token);
  if (!match) throw new Error(`${label} has an unreadable step "${token}".`);
  const base = 12 * (octave + 1) + scale.root;
  const degrees = scaleNotes(scale, base, base + 11);
  const degree = Number(match[1]);
  let note =
    (degrees[degree % degrees.length] ?? base) +
    12 * ((match[2]?.length ?? 0) - (match[3]?.length ?? 0));
  while (note > maximum) note -= 12;
  while (note < minimum) note += 12;
  return { note, accent: match[4] === "!", glide: match[5] === "~" };
}
function noteSteps(
  pattern: string,
  scale: MusicalScale,
  octave: number,
  minimum: number,
  maximum: number,
  label: string,
): BassStep[] {
  const tokens = noteTokens(pattern, label);
  const steps: BassStep[] = [];
  let held = 12 * (octave + 1) + scale.root;
  for (const token of tokens) {
    if (token === ".") {
      steps.push({ note: held, on: false, accent: false, slide: false });
      continue;
    }
    if (token === "_") {
      const previous = steps.at(-1);
      if (!previous?.on) throw new Error(`${label} holds a rest.`);
      previous.slide = true;
      steps.push({ note: held, on: true, accent: false, slide: false });
      continue;
    }
    const parsed = parseNote(token, scale, octave, minimum, maximum, label);
    held = parsed.note;
    steps.push({
      note: parsed.note,
      on: true,
      accent: parsed.accent,
      slide: parsed.glide,
    });
  }
  return steps;
}
function vocalNotes(spec: VocalSpec, scale: MusicalScale): VocalNote[] {
  const notes: VocalNote[] = [];
  noteSteps(spec.pattern, scale, spec.octave, 36, 84, "Vocal").forEach(
    (step, index, steps) => {
      if (!step.on) return;
      const previous = steps[index - 1];
      const last = notes.at(-1);
      if (previous?.on && previous.slide && previous.note === step.note && last)
        last.length++;
      else
        notes.push({
          start: index,
          length: 1,
          note: step.note,
          accent: step.accent,
        });
    },
  );
  return notes;
}
/** Sample a curve at every sixteenth of the sixteen-bar automation loop. */
function curveLane(curve: Curve): number[] {
  return Array.from({ length: CURVE_BARS * 16 }, (_, step) => {
    const bar = step / 16;
    let index = -1;
    curve.forEach(([at], candidate) => {
      if (at <= bar) index = candidate;
    });
    const point = curve[index] ?? curve[0];
    const next = curve[index + 1];
    if (!point) return 0;
    const value =
      next && next[0] > point[0]
        ? point[1] +
          ((next[1] - point[1]) * (bar - point[0])) / (next[0] - point[0])
        : point[1];
    return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
  });
}
/** Write each curve into its lane; returns whether any lane was written. */
function applyCurves<K extends string>(
  automation: Record<K, number[] | null>,
  curves: Curves<K> | undefined,
  lanes: readonly K[],
): boolean {
  let written = false;
  for (const lane of lanes) {
    const curve = curves?.[lane];
    if (!curve) continue;
    automation[lane] = curveLane(curve);
    written = true;
  }
  return written;
}
const DRUM_LANES: readonly DrumAutomationParameter[] = [
  "pitch",
  "decay",
  "volume",
  "tone",
  "drive",
  "pan",
  "attack",
  "space",
];
const BASS_LANES: readonly BassAutomationParameter[] = [
  "pulse",
  "shape",
  "drive",
  "cutoff",
  "resonance",
  "envelope",
  "decay",
  "volume",
];
const KEYS_LANES: readonly KeysAutomationParameter[] = [
  "width",
  "attack",
  "grit",
  "motion",
  "tone",
  "decay",
  "space",
  "volume",
];
const ARP_LANES: readonly ArpParameter[] = [
  "gate",
  "decay",
  "tone",
  "resonance",
  "shape",
  "space",
  "width",
  "volume",
];
const PAD_LANES: readonly PadParameter[] = [
  "attack",
  "release",
  "tone",
  "motion",
  "spread",
  "space",
  "shape",
  "volume",
];
const VOCAL_LANES: readonly VocalParameter[] = [
  "gain",
  "start",
  "end",
  "attack",
  "release",
  "tone",
  "drive",
  "space",
  "volume",
];
function timing(bars: number, label: string): SequenceTiming {
  return { bars: barCount(bars, label), meter: "4/4", grid: "straight" };
}

export function createFluffPreset(id: string): Project {
  const preset = TRACKS.find((candidate) => candidate.id === id) ?? TRACKS[0];
  if (!preset) throw new Error("No Fluff examples are available.");
  const scale = preset.scale;
  const project = createProject();
  project.mode = "fluff";
  project.name = preset.name;
  project.scale = { ...scale };
  project.bpm = preset.bpm;
  project.swing = preset.swing;
  project.drive = preset.pump;
  project.volume = 0.95;
  project.fx = { sweep: 0, space: 0, echo: 0 };

  project.drums.forEach((track) => {
    const spec = preset.drums[track.id];
    track.automation = emptyDrumAutomation();
    track.automationBars = null;
    if (!spec) {
      track.muted = true;
      track.timing = timing(1, track.id);
      track.steps = Array.from({ length: 16 }, () => false);
      return;
    }
    const label = `${preset.name} ${track.id}`;
    const cells = drumCells(spec.pattern, label);
    track.timing = timing(cells.length / 16, label);
    track.steps = cells.map((cell) => cell === "x");
    track.muted = false;
    track.sound = spec.sound;
    track.decay = spec.decay;
    track.volume = spec.volume;
    track.pitch = spec.pitch ?? 0;
    track.tone = spec.tone ?? 0.5;
    track.space = spec.space ?? 0;
    track.pan = spec.pan ?? 0;
    track.drive = spec.drive ?? 0;
    track.attack = spec.attack ?? 0;
    if (applyCurves(track.automation, spec.curves, DRUM_LANES))
      track.automationBars = CURVE_BARS;
    if (spec.levels) {
      const levels = drumCells(spec.levels, `${label} levels`);
      if (levels.length !== cells.length)
        throw new Error(`${label} levels must match its pattern.`);
      const volume = track.automation.volume;
      const count = track.automationBars ? CURVE_BARS * 16 : cells.length;
      track.automation.volume = Array.from(
        { length: count },
        (_, step) =>
          ((volume?.[step] ?? spec.volume) *
            Number(levels[step % levels.length])) /
          9,
      );
    }
  });

  const bass = preset.bass;
  const bassSteps = noteSteps(
    bass.pattern,
    scale,
    bass.octave ?? 2,
    24,
    60,
    `${preset.name} bass`,
  );
  project.bass = {
    timing: timing(bassSteps.length / 16, `${preset.name} bass`),
    automationBars: null,
    pulse: bass.pulse ?? 0.5,
    shape: bass.shape ?? 0.3,
    drive: bass.drive ?? 0,
    sound: bass.sound,
    automation: emptyBassAutomation(),
    waveform: "sawtooth",
    cutoff: bass.cutoff,
    resonance: bass.resonance,
    envelope: bass.envelope,
    decay: bass.decay,
    volume: bass.volume,
    muted: false,
    steps: bassSteps,
  };
  if (applyCurves(project.bass.automation, bass.curves, BASS_LANES))
    project.bass.automationBars = CURVE_BARS;

  const lead = preset.lead;
  if (lead) {
    const steps = noteSteps(
      lead.pattern,
      scale,
      lead.octave ?? 4,
      48,
      84,
      `${preset.name} lead`,
    );
    project.keys = {
      timing: timing(steps.length / 16, `${preset.name} lead`),
      automationBars: null,
      width: lead.width ?? 0.5,
      attack: lead.attack ?? 0,
      grit: lead.grit ?? 0,
      motion: lead.motion ?? 0,
      automation: emptyKeysAutomation(),
      sound: lead.sound,
      tone: lead.tone,
      decay: lead.decay,
      space: lead.space,
      volume: lead.volume,
      muted: false,
      steps,
    };
    if (applyCurves(project.keys.automation, lead.curves, KEYS_LANES))
      project.keys.automationBars = CURVE_BARS;
  } else project.keys.muted = true;

  const chordTiming: Timing & { bars: PadTiming["bars"] } = {
    bars: preset.chords.bars,
    meter: "4/4",
    grid: "straight",
  };
  const chords = preset.chords.steps.map(
    ([degree, inversion, colour]): ProgressionChord => ({
      degree,
      inversion,
      ...(colour?.quality ? { quality: colour.quality } : {}),
      ...(colour?.borrow ? { borrow: colour.borrow } : {}),
    }),
  );
  project.progression = { timing: chordTiming, chords };

  const pad = preset.pad;
  project.pad = {
    ...project.pad,
    timing: { ...chordTiming },
    automationBars: null,
    followChords: true,
    chords: chords.map((chord) => ({ ...chord })),
    muted: !pad,
    sound: pad?.sound ?? 0,
    volume: pad?.volume ?? 0.28,
    tone: pad?.tone ?? 0.45,
    attack: pad?.attack ?? 0.35,
    release: pad?.release ?? 0.5,
    motion: pad?.motion ?? 0.15,
    spread: pad?.spread ?? 0.7,
    space: pad?.space ?? 0.45,
    shape: pad?.shape ?? 0.4,
  };
  if (applyCurves(project.pad.automation, pad?.curves, PAD_LANES))
    project.pad.automationBars = CURVE_BARS;

  const arp = preset.arp;
  if (arp) {
    const label = `${preset.name} arp`;
    const cells = drumCells(arp.pattern, label);
    const accents = arp.accents ? drumCells(arp.accents, label) : null;
    const register = arp.register ?? 60;
    const notes = arp.riff
      ? arp.riff
          .trim()
          .split(/\s+/)
          .map(
            (token) =>
              parseNote(token, scale, arp.octave ?? 4, 48, 84, label).note,
          )
      : scaleNotes(scale, register, register + 11).filter(
          (_, index) => index === 0 || index === 2 || index === 4,
        );
    project.arp = {
      ...project.arp,
      timing: timing(cells.length / 16, label),
      automationBars: null,
      followChords: !arp.riff,
      muted: false,
      sound: arp.sound,
      notes,
      direction: arp.direction,
      rate: arp.rate,
      octaves: arp.octaves,
      steps: cells.map((cell) => cell === "x"),
      accents: cells.map((_, index) =>
        accents ? accents[index % accents.length] === "x" : index % 4 === 0,
      ),
      gate: arp.gate,
      decay: arp.decay,
      tone: arp.tone,
      resonance: arp.resonance ?? 0.25,
      shape: arp.shape ?? 0.35,
      space: arp.space,
      width: arp.width ?? 0.6,
      volume: arp.volume,
    };
    if (applyCurves(project.arp.automation, arp.curves, ARP_LANES))
      project.arp.automationBars = CURVE_BARS;
  } else project.arp.muted = true;

  const vocal = preset.vocal;
  if (vocal) {
    const count = noteTokens(vocal.pattern, `${preset.name} vocal`).length;
    const bars = count / 16;
    if (bars !== 1 && bars !== 2 && bars !== 4 && bars !== 8 && bars !== 16)
      throw new Error(`${preset.name} vocal must be 1 to 16 bars.`);
    project.vocal = {
      ...project.vocal,
      timing: { bars, meter: "4/4", grid: "straight" },
      automationBars: null,
      followChords: false,
      recording: null,
      muted: false,
      sound: vocal.sound,
      loop: vocal.loop ?? false,
      notes: vocalNotes(vocal, scale),
      start: 0,
      end: vocal.end ?? 1,
      attack: vocal.attack ?? 0.03,
      release: vocal.release ?? 0.25,
      tone: vocal.tone ?? 0.62,
      drive: 0,
      space: vocal.space ?? 0.3,
      gain: vocal.gain ?? 0.5,
      volume: vocal.volume,
    };
    if (applyCurves(project.vocal.automation, vocal.curves, VOCAL_LANES))
      project.vocal.automationBars = CURVE_BARS;
  } else project.vocal.muted = true;

  project.cloud.muted = true;
  project.tension.muted = true;
  const valid = readProject(project);
  if (!valid) throw new Error(`The ${preset.name} example is invalid.`);
  return valid;
}
