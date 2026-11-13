import {
  createProject,
  emptyBassAutomation,
  emptyDrumAutomation,
  emptyKeysAutomation,
  readProject,
  scaleNotes,
} from "./model";
import type { BassStep, DrumId, MusicalScale, Project } from "./model";
import type { ArpTrack } from "./arp-model";
import type { VocalNote } from "./vocal-model";
import type { PadTiming, SequenceTiming, Timing } from "./timing";

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
  /** Cutoff sweep across the whole pattern, in normalized knob units. */
  sweep?: readonly [number, number];
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
  sweep?: readonly [number, number];
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
  sweep?: readonly [number, number];
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
  sweep?: readonly [number, number];
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
    bars: PadTiming["bars"];
    /** Four [scale degree, inversion] pairs, each lasting a quarter of the loop. */
    steps: ReadonlyArray<readonly [number, number]>;
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
const repeat = (bar: string, count: number): string =>
  Array.from({ length: count }, () => bar).join(" | ");

const TRACKS: readonly FluffPreset[] = [
  {
    id: "fluff-cotton",
    name: "Cotton",
    genre: "Progressive house",
    scale: { root: 5, mode: "minor" },
    bpm: 128,
    swing: 0,
    pump: 0.7,
    chords: {
      bars: 8,
      steps: [
        [5, 0],
        [3, 1],
        [0, 1],
        [6, 0],
      ],
    },
    drums: {
      kick: { sound: 1, pattern: FOUR, decay: 0.3, volume: 0.86 },
      clap: {
        sound: 0,
        pattern: BACKBEAT,
        decay: 0.2,
        volume: 0.44,
        space: 0.25,
      },
      hat: { sound: 5, pattern: OFFBEAT, decay: 0.12, volume: 0.34 },
      snare: {
        sound: 5,
        pattern: `................ | ..........x..x.x`,
        decay: 0.14,
        volume: 0.26,
      },
      rim: {
        sound: 3,
        pattern: "x.xxx.xxx.xxx.xx",
        levels: "5035503550355035",
        decay: 0.06,
        volume: 0.2,
        pan: 0.25,
      },
    },
    bass: {
      sound: 4,
      pattern: [
        "5, _ _ _ _ _ _ _ _ _ _ _ _ _ _ _",
        "5, _ _ _ _ _ _ _ _ _ _ _ 5, _ 6, _",
        "3 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _",
        "3 _ _ _ _ _ _ _ _ _ _ _ 3 _ 2 _",
        "0 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _",
        "0 _ _ _ _ _ _ _ _ _ _ _ 0 _ 4 _",
        "6, _ _ _ _ _ _ _ _ _ _ _ _ _ _ _",
        "6, _ _ _ _ _ _ _ 6, _ _ _ 4, _ _ _",
      ].join(" | "),
      octave: 2,
      cutoff: 420,
      resonance: 3,
      envelope: 0.3,
      decay: 0.4,
      volume: 0.5,
      shape: 0.45,
      sweep: [0.34, 0.5],
    },
    lead: {
      sound: 2,
      pattern: [
        "2' . . 0' . . 5 . . 0' . . 2' . 4' .",
        "2' . . 0' . . 5 . . 0' . . 4 . 5 .",
        "3' . . 0' . . 5 . . 0' . . 3' . 4' .",
        "3' . . 0' . . 5 . . 0' . . 5 . 3 .",
        "2' . . 0' . . 4 . . 0' . . 2' . 4' .",
        "2' . . 0' . . 4 . . 0' . . 1' . 2' .",
        "3' . . 1' . . 6 . . 1' . . 3' . 4' .",
        "3' . . 1' . . 6 . . 1' . . 3' . 1' .",
      ].join(" | "),
      tone: 0.5,
      decay: 0.5,
      space: 0.5,
      volume: 0.4,
      width: 0.4,
    },
    arp: {
      sound: 0,
      pattern: SIXTEENTHS,
      accents: "x..x..x..x..x.x.",
      rate: "1/16",
      direction: "updown",
      octaves: 2,
      gate: 0.5,
      decay: 0.2,
      tone: 0.4,
      space: 0.35,
      volume: 0.2,
      sweep: [0.28, 0.6],
    },
    pad: { sound: 0, volume: 0.3, tone: 0.44, space: 0.5, attack: 0.3 },
  },
  {
    id: "fluff-skylark",
    name: "Skylark",
    genre: "Uplifting trance",
    scale: { root: 9, mode: "minor" },
    bpm: 138,
    swing: 0,
    pump: 0.75,
    chords: {
      bars: 8,
      steps: [
        [0, 0],
        [5, 1],
        [2, 0],
        [6, 1],
      ],
    },
    drums: {
      kick: { sound: 0, pattern: FOUR, decay: 0.26, volume: 0.88 },
      clap: {
        sound: 0,
        pattern: BACKBEAT,
        decay: 0.18,
        volume: 0.42,
        space: 0.3,
      },
      hat: { sound: 5, pattern: OFFBEAT, decay: 0.1, volume: 0.36 },
      snare: {
        sound: 4,
        pattern: `${repeat("................", 3)} | ........x.x.xxxx`,
        levels: `${repeat("0000000000000000", 3)} | 0000000040506789`,
        decay: 0.12,
        volume: 0.36,
      },
      rim: {
        sound: 3,
        pattern: "..xx..xx..xx..xx",
        levels: "0053005300530053",
        decay: 0.05,
        volume: 0.18,
        pan: -0.2,
      },
    },
    bass: {
      sound: 2,
      pattern: [
        ". 0 0 0 . 0 0 0 . 0 0 0 . 0 0 0",
        ". 0 0 0 . 0 0 0 . 0 0 0 . 0 0 0",
        ". 5, 5, 5, . 5, 5, 5, . 5, 5, 5, . 5, 5, 5,",
        ". 5, 5, 5, . 5, 5, 5, . 5, 5, 5, . 5, 5, 5,",
        ". 2 2 2 . 2 2 2 . 2 2 2 . 2 2 2",
        ". 2 2 2 . 2 2 2 . 2 2 2 . 2 2 2",
        ". 6, 6, 6, . 6, 6, 6, . 6, 6, 6, . 6, 6, 6,",
        ". 6, 6, 6, . 6, 6, 6, . 6, 6, 6, . 6, 4, 4,",
      ].join(" | "),
      octave: 2,
      cutoff: 520,
      resonance: 5,
      envelope: 0.45,
      decay: 0.16,
      volume: 0.5,
      shape: 0.4,
    },
    lead: {
      sound: 0,
      pattern: [
        "4 _ _ _ _ _ 2 _ _ _ 4 _ _ _ 6 _",
        "4 _ _ _ _ _ _ _ 2 _ 1 _ 2 _ 4 _",
        "5 _ _ _ _ _ 4 _ _ _ 2 _ _ _ 0' _",
        "0' _ _ _ _ _ _ _ 6 _ 5 _ 4 _ 2 _",
        "4 _ _ _ _ _ 2 _ _ _ 4 _ _ _ 6 _",
        "1' _ _ _ _ _ _ _ 0' _ 6 _ 4 _ 6 _",
        "6 _ _ _ _ _ 1' _ _ _ 6 _ _ _ 3 _",
        "1' _ _ _ _ _ _ _ 0' _ 1' _ 2' _ 1' _",
      ].join(" | "),
      tone: 0.6,
      decay: 0.4,
      space: 0.5,
      volume: 0.4,
      width: 0.7,
      sweep: [0.5, 0.72],
    },
    arp: {
      sound: 1,
      pattern: "x.xxx.xxx.xxx.xx",
      accents: "x...x...x...x...",
      rate: "1/16",
      direction: "up",
      octaves: 2,
      gate: 0.45,
      decay: 0.16,
      tone: 0.46,
      space: 0.3,
      volume: 0.18,
      shape: 0.3,
    },
    pad: {
      sound: 5,
      volume: 0.3,
      tone: 0.5,
      space: 0.55,
      attack: 0.4,
      release: 0.6,
    },
    vocal: {
      sound: 32,
      pattern: [
        "4 _ _ _ _ _ _ _ . . . . . . . .",
        ". . . . . . . . . . . . . . . .",
        "5 _ _ _ _ _ _ _ . . . . . . . .",
        ". . . . . . . . . . . . . . . .",
        "4 _ _ _ _ _ _ _ . . . . . . . .",
        ". . . . . . . . . . . . . . . .",
        "6 _ _ _ _ _ _ _ 4 _ _ _ _ _ _ _",
        ". . . . . . . . . . . . . . . .",
      ].join(" | "),
      octave: 4,
      volume: 0.3,
      loop: true,
      attack: 0.3,
      release: 0.6,
      space: 0.4,
    },
  },
  {
    id: "fluff-opaline",
    name: "Opaline",
    genre: "Melodic house",
    scale: { root: 2, mode: "minor" },
    bpm: 122,
    swing: 0.04,
    pump: 0.55,
    chords: {
      bars: 8,
      steps: [
        [0, 1],
        [2, 0],
        [6, 0],
        [3, 0],
      ],
    },
    drums: {
      kick: { sound: 2, pattern: FOUR, decay: 0.3, volume: 0.84 },
      clap: {
        sound: 6,
        pattern: BACKBEAT,
        decay: 0.22,
        volume: 0.42,
        space: 0.3,
      },
      hat: {
        sound: 2,
        pattern: SIXTEENTHS,
        levels: "3293329332933295",
        decay: 0.09,
        volume: 0.3,
      },
      snare: {
        sound: 5,
        pattern: `.......x........ | .......x.....x..`,
        decay: 0.1,
        volume: 0.24,
      },
      rim: {
        sound: 2,
        pattern: `...x..x......x.. | ...x..x...x..x..`,
        decay: 0.16,
        volume: 0.26,
        pan: 0.3,
        space: 0.2,
      },
    },
    bass: {
      sound: 9,
      pattern: [
        "0 . . 0 . . 0 . . . 0 . . 0 . .",
        "0 . . 0 . . 0 . . . 0 . 0' . 4 .",
        "2 . . 2 . . 2 . . . 2 . . 2 . .",
        "2 . . 2 . . 2 . . . 2 . 4 . 2 .",
        "6, . . 6, . . 6, . . . 6, . . 6, . .",
        "6, . . 6, . . 6, . . . 6, . 4, . 6, .",
        "3 . . 3 . . 3 . . . 3 . . 3 . .",
        "3 . . 3 . . 3 . . . 3 . 2 . 1 .",
      ].join(" | "),
      octave: 2,
      cutoff: 360,
      resonance: 2,
      envelope: 0.3,
      decay: 0.3,
      volume: 0.52,
      shape: 0.4,
    },
    lead: {
      sound: 1,
      pattern: [
        "4 . . 2 . . 4 . . . 0' . . . . .",
        "4 . . 2 . . 4 . . . 1' . 0' . . .",
        "4 . . 2 . . 4 . . . 6 . . . . .",
        "4 . . 2 . . 4 . . . 0' . 6 . . .",
        "3 . . 1 . . 3 . . . 6 . . . . .",
        "3 . . 1 . . 3 . . . 1' . 6 . . .",
        "3 . . 0 . . 3 . . . 5 . . . . .",
        "3 . . 0 . . 3 . . 5 . . 4 . 2 .",
      ].join(" | "),
      tone: 0.44,
      decay: 0.34,
      space: 0.62,
      volume: 0.4,
      width: 0.4,
    },
    arp: {
      sound: 5,
      pattern: "x.x.x.x.x.x.x.x.",
      rate: "1/8",
      direction: "up",
      octaves: 1,
      gate: 0.8,
      decay: 0.5,
      tone: 0.5,
      space: 0.5,
      volume: 0.2,
    },
    pad: {
      sound: 5,
      volume: 0.32,
      tone: 0.42,
      space: 0.5,
      attack: 0.5,
      release: 0.6,
    },
    vocal: {
      sound: 33,
      pattern: [
        ". . . . . . . . 4 _ _ _ _ _ . .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . 2 _ _ _ _ _ . .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . 3 _ _ _ _ _ . .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . 3 _ _ _ 2 _ _ _",
        ". . . . . . . . . . . . . . . .",
      ].join(" | "),
      octave: 4,
      volume: 0.3,
      loop: true,
      attack: 0.25,
      release: 0.5,
      space: 0.5,
    },
  },
  {
    id: "fluff-tidepool",
    name: "Tidepool",
    genre: "Melodic breaks",
    scale: { root: 4, mode: "minor" },
    bpm: 130,
    swing: 0.03,
    pump: 0.5,
    chords: {
      bars: 8,
      steps: [
        [5, 0],
        [6, 0],
        [0, 1],
        [0, 2],
      ],
    },
    drums: {
      kick: {
        sound: 4,
        pattern: `x.........x..... | x......x..x.....`,
        decay: 0.24,
        volume: 0.86,
      },
      snare: {
        sound: 1,
        pattern: `....x.......x... | ....x..x....x..x`,
        levels: `0000900000009000 | 0000900400009005`,
        decay: 0.2,
        volume: 0.56,
        space: 0.2,
      },
      hat: {
        sound: 0,
        pattern: `x.x.x.x.x.xxx.x. | x.x.x.xxx.x.x.xx`,
        levels: `9060906090649060 | 9060906490609064`,
        decay: 0.07,
        volume: 0.3,
      },
      clap: {
        sound: 2,
        pattern: `................ | ............x...`,
        decay: 0.3,
        volume: 0.34,
      },
      rim: {
        sound: 3,
        pattern: "..x...x...x...x.",
        decay: 0.07,
        volume: 0.18,
        pan: -0.3,
      },
    },
    bass: {
      sound: 5,
      pattern: [
        "5, _ _ _ _ _ . . 5, _ _ . 5, _ . .",
        "5, _ _ _ _ _ . . 5, _ _ . 0 _ . .",
        "6, _ _ _ _ _ . . 6, _ _ . 6, _ . .",
        "6, _ _ _ _ _ . . 6, _ _ . 1 _ . .",
        "0 _ _ _ _ _ . . 0 _ _ . 0 _ . .",
        "0 _ _ _ _ _ . . 0 _ _ . 4, _ . .",
        "0 _ _ _ _ _ . . 0 _ _ . 0 _ . .",
        "0 _ _ _ _ _ . . 2 _ _ . 4, _ 6, _",
      ].join(" | "),
      octave: 2,
      cutoff: 300,
      resonance: 2,
      envelope: 0.2,
      decay: 0.4,
      volume: 0.5,
      shape: 0.35,
    },
    lead: {
      sound: 4,
      pattern: [
        ". . . 5, . . 5, . . . . . 5, . 5, .",
        ". . . 5, . . 5, . . . . . 5, . . .",
        ". . . 6, . . 6, . . . . . 6, . 6, .",
        ". . . 6, . . 6, . . . . . 6, . . .",
        ". . . 0 . . 0 . . . . . 0 . 0 .",
        ". . . 0 . . 0 . . . . . 0 . . .",
        ". . . 0 . . 0 . . . . . 0 . 0 .",
        ". . . 0 . . 0 . . 0 . . 2 . 4 .",
      ].join(" | "),
      tone: 0.5,
      decay: 0.28,
      space: 0.45,
      volume: 0.36,
      width: 0.6,
      sweep: [0.4, 0.62],
    },
    arp: {
      sound: 2,
      pattern: SIXTEENTHS,
      accents: "x..x..x.x..x..x.",
      rate: "1/16",
      direction: "updown",
      octaves: 2,
      gate: 0.5,
      decay: 0.3,
      tone: 0.5,
      space: 0.45,
      volume: 0.22,
    },
    pad: {
      sound: 2,
      volume: 0.28,
      tone: 0.5,
      space: 0.7,
      attack: 0.5,
      release: 0.7,
    },
    vocal: {
      sound: 32,
      pattern: [
        ". . . . . . 4 _ _ . 6 _ _ _ . .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . 4 _ _ . 1' _ _ _ . .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . 4 _ _ . 6 _ _ _ 4 _",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . 2 _ _ . 4 _ _ _ . .",
        ". . . . . . . . . . . . . . . .",
      ].join(" | "),
      octave: 4,
      volume: 0.34,
      loop: true,
      attack: 0.12,
      release: 0.45,
      space: 0.5,
    },
  },
  {
    id: "fluff-hush",
    name: "Hush",
    genre: "Lo-fi house",
    scale: { root: 7, mode: "minor" },
    bpm: 120,
    swing: 0.12,
    pump: 0.5,
    chords: {
      bars: 8,
      steps: [
        [3, 0],
        [6, 0],
        [2, 1],
        [5, 0],
      ],
    },
    drums: {
      kick: {
        sound: 6,
        pattern: FOUR,
        decay: 0.26,
        volume: 0.86,
      },
      clap: {
        sound: 4,
        pattern: BACKBEAT,
        decay: 0.2,
        volume: 0.46,
        space: 0.2,
      },
      hat: {
        sound: 6,
        pattern: `..x...xx..x...x. | ..x...x...xx..x.`,
        levels: `0090009500900090 | 0090009000950090`,
        decay: 0.12,
        volume: 0.36,
      },
      snare: {
        sound: 3,
        pattern: `...............x | .........x.....x`,
        decay: 0.1,
        volume: 0.22,
      },
      rim: {
        sound: 2,
        pattern: `......x......x.. | ...x..x......x..`,
        decay: 0.14,
        volume: 0.24,
        pan: -0.25,
      },
    },
    bass: {
      sound: 6,
      pattern: [
        "3 . . 3 . . . 3 . . 3 . . . 3' .",
        "3 . . 3 . . . 3 . . 3 . 5 . 4 .",
        "6, . . 6, . . . 6, . . 6, . . . 6 .",
        "6, . . 6, . . . 6, . . 6, . 1 . 0 .",
        "2 . . 2 . . . 2 . . 2 . . . 2' .",
        "2 . . 2 . . . 2 . . 2 . 4 . 2 .",
        "5, . . 5, . . . 5, . . 5, . . . 5 .",
        "5, . . 5, . . . 5, . . 5, . 6, . 0 .",
      ].join(" | "),
      octave: 2,
      cutoff: 520,
      resonance: 2,
      envelope: 0.3,
      decay: 0.24,
      volume: 0.52,
      shape: 0.4,
      drive: 0.2,
    },
    lead: {
      sound: 3,
      pattern: [
        ". . 0' . . 5 . . 0' . . 3 . . 5 .",
        ". . 0' . . 5 . . 0' . . 3' . 0' 5 .",
        ". . 1' . . 6 . . 1' . . 3 . . 6 .",
        ". . 1' . . 6 . . 1' . . 3' . 1' 6 .",
        ". . 6 . . 4 . . 6 . . 2 . . 4 .",
        ". . 6 . . 4 . . 6 . . 2' . 6 4 .",
        ". . 0' . . 5 . . 0' . . 2 . . 5 .",
        ". . 0' . . 5 . . 0' . . 2' . 0' 5 .",
      ].join(" | "),
      tone: 0.42,
      decay: 0.5,
      space: 0.4,
      volume: 0.44,
      width: 0.4,
      grit: 0.35,
    },
    pad: {
      sound: 4,
      volume: 0.3,
      tone: 0.4,
      space: 0.45,
      attack: 0.35,
      motion: 0.3,
    },
    vocal: {
      sound: 34,
      pattern: [
        ". . . . . . . . . . 0 _ . 0 _ .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . 1 _ . 1 _ .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . 2 _ . 1 _ .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . 0 _ . 2 _ 0",
        ". . . . . . . . . . . . . . . .",
      ].join(" | "),
      octave: 4,
      volume: 0.34,
      release: 0.3,
      space: 0.5,
      tone: 0.5,
    },
  },
  {
    id: "fluff-kite-string",
    name: "Kite String",
    genre: "Kawaii future bass",
    scale: { root: 0, mode: "major" },
    bpm: 150,
    swing: 0,
    pump: 0.8,
    chords: {
      bars: 8,
      steps: [
        [3, 0],
        [4, 0],
        [2, 1],
        [5, 0],
      ],
    },
    drums: {
      kick: {
        sound: 3,
        pattern: `x.........x..... | x.....x.......x.`,
        decay: 0.26,
        volume: 0.88,
      },
      snare: {
        sound: 6,
        pattern: "........x.......",
        decay: 0.24,
        volume: 0.56,
      },
      clap: {
        sound: 5,
        pattern: "........x.......",
        decay: 0.2,
        volume: 0.3,
      },
      hat: {
        sound: 3,
        pattern: `x.x.x.x.x.x.x.xx | x.x.x.xxx.x.xxxx`,
        levels: `9050905090509056 | 9050905690507689`,
        decay: 0.1,
        volume: 0.3,
      },
      rim: {
        sound: 4,
        pattern: `....x.....x..x.. | ..x...x.....x...`,
        decay: 0.2,
        volume: 0.22,
        pan: 0.3,
      },
    },
    bass: {
      sound: 0,
      pattern: [
        "3 _ _ _ _ _ . . 3 _ _ _ . . 3 _",
        "3 _ _ _ _ _ . . 3 _ _ _ . . 3 _",
        "4 _ _ _ _ _ . . 4 _ _ _ . . 4 _",
        "4 _ _ _ _ _ . . 4 _ _ _ . . 4 _",
        "2 _ _ _ _ _ . . 2 _ _ _ . . 2 _",
        "2 _ _ _ _ _ . . 2 _ _ _ . . 2 _",
        "5 _ _ _ _ _ . . 5 _ _ _ . . 5 _",
        "5 _ _ _ _ _ . . 5 _ _ _ 4 _ 2 _",
      ].join(" | "),
      octave: 2,
      cutoff: 400,
      resonance: 1,
      envelope: 0.2,
      decay: 0.5,
      volume: 0.56,
    },
    lead: {
      sound: 5,
      pattern: [
        "5' _ . 5' . 4' . 5' _ _ . 0'' . . 5' .",
        "4' _ . 2' . . 0' . 2' _ _ _ . . . .",
        "4' _ . 4' . 2' . 4' _ _ . 6' . . 4' .",
        "6' . . 4' . . 1' . 4' _ _ _ . . 1' 2'",
        "4' _ . 4' . 2' . 4' _ _ . 6' . . 4' .",
        "2' _ . 6 . . 2' . 4' _ _ _ . . . .",
        "5' _ . 5' . 4' . 2' _ _ . 0' . . 2' .",
        "5' _ _ _ 4' _ 2' _ 1' _ _ _ 0' . 1' 2'",
      ].join(" | "),
      tone: 0.56,
      decay: 0.3,
      space: 0.4,
      volume: 0.34,
      motion: 0.3,
    },
    arp: {
      sound: 2,
      pattern: "x.xxx.xxx.xxx.xx",
      rate: "1/16",
      direction: "up",
      octaves: 2,
      gate: 0.5,
      decay: 0.3,
      tone: 0.6,
      space: 0.4,
      volume: 0.16,
    },
    pad: {
      sound: 0,
      volume: 0.36,
      tone: 0.56,
      space: 0.4,
      attack: 0.08,
      release: 0.4,
      shape: 0.6,
      sweep: [0.4, 0.66],
    },
    vocal: {
      sound: 35,
      pattern: [
        ". . . . . . . . . . . . 4 . 4 .",
        ". . . . . . . . . . . . 2 . 4 5",
        ". . . . . . . . . . . . 4 . 4 .",
        ". . . . . . . . . . . . 6 . 4 .",
        ". . . . . . . . . . . . 4 . 4 .",
        ". . . . . . . . . . . . 2 . 4 6",
        ". . . . . . . . . . . . 5 . 5 .",
        ". . . . . . . . . . . . 4 . 2 .",
      ].join(" | "),
      octave: 4,
      volume: 0.3,
      release: 0.2,
      space: 0.45,
    },
  },
  {
    id: "fluff-hoshi",
    name: "Hoshi",
    genre: "Vocaloid trance pop",
    scale: { root: 2, mode: "major" },
    bpm: 160,
    swing: 0,
    pump: 0.65,
    chords: {
      bars: 8,
      steps: [
        [5, 0],
        [3, 0],
        [4, 0],
        [0, 1],
      ],
    },
    drums: {
      kick: { sound: 0, pattern: FOUR, decay: 0.22, volume: 0.88 },
      snare: {
        sound: 0,
        pattern: `${repeat(BACKBEAT, 3)} | ....x.......x.xx`,
        decay: 0.16,
        volume: 0.46,
        space: 0.2,
      },
      clap: {
        sound: 1,
        pattern: BACKBEAT,
        decay: 0.14,
        volume: 0.3,
      },
      hat: { sound: 5, pattern: OFFBEAT, decay: 0.09, volume: 0.34 },
      rim: {
        sound: 3,
        pattern: "x.xxx.xxx.xxx.xx",
        levels: "4024402440244024",
        decay: 0.05,
        volume: 0.18,
        pan: 0.2,
      },
    },
    bass: {
      sound: 1,
      pattern: [
        "5, . 5 . 5, . 5 . 5, . 5 . 5, . 5 .",
        "5, . 5 . 5, . 5 . 5, . 5 . 5, . 5 .",
        "3 . 3' . 3 . 3' . 3 . 3' . 3 . 3' .",
        "3 . 3' . 3 . 3' . 3 . 3' . 3 . 3' .",
        "4 . 4' . 4 . 4' . 4 . 4' . 4 . 4' .",
        "4 . 4' . 4 . 4' . 4 . 4' . 4 . 4' .",
        "0 . 0' . 0 . 0' . 0 . 0' . 0 . 0' .",
        "0 . 0' . 0 . 0' . 0 . 0' . 2 . 4 .",
      ].join(" | "),
      octave: 2,
      cutoff: 620,
      resonance: 4,
      envelope: 0.4,
      decay: 0.16,
      volume: 0.46,
      shape: 0.4,
    },
    lead: {
      sound: 7,
      pattern: [
        "2' _ _ . 2' _ 1' _ 2' _ _ . 4' _ _ .",
        "2' _ 1' _ 0' _ 5 _ 0' _ _ _ . . . .",
        "0' _ _ . 0' _ 6 _ 0' _ _ . 2' _ _ .",
        "1' _ 0' _ 6 _ 5 _ 3 _ _ _ . . 4 _",
        "1' _ _ . 1' _ 0' _ 1' _ _ . 4' _ _ .",
        "2' _ 1' _ 0' _ 6 _ 1' _ _ _ . . . .",
        "2' _ _ . 4' _ _ . 5' _ _ . 4' _ 2' _",
        "1' _ _ _ 2' _ _ _ 0' _ _ _ _ _ . .",
      ].join(" | "),
      octave: 4,
      tone: 0.6,
      decay: 0.2,
      space: 0.4,
      volume: 0.5,
      width: 0.6,
      motion: 0.35,
    },
    arp: {
      sound: 4,
      pattern: SIXTEENTHS,
      rate: "1/16",
      direction: "up",
      octaves: 2,
      gate: 0.4,
      decay: 0.12,
      tone: 0.5,
      space: 0.3,
      volume: 0.13,
    },
    pad: {
      sound: 0,
      volume: 0.26,
      tone: 0.5,
      space: 0.4,
      attack: 0.2,
    },
  },
  {
    id: "fluff-glasshouse",
    name: "Glasshouse",
    genre: "Progressive trance",
    scale: { root: 11, mode: "minor" },
    bpm: 126,
    swing: 0,
    pump: 0.7,
    chords: {
      bars: 8,
      steps: [
        [0, 0],
        [5, 1],
        [6, 0],
        [4, 0],
      ],
    },
    drums: {
      kick: { sound: 1, pattern: FOUR, decay: 0.3, volume: 0.88 },
      clap: {
        sound: 1,
        pattern: BACKBEAT,
        decay: 0.16,
        volume: 0.42,
        space: 0.3,
      },
      hat: { sound: 5, pattern: OFFBEAT, decay: 0.11, volume: 0.34 },
      snare: {
        sound: 5,
        pattern: `..........x..... | .......x..x...x.`,
        decay: 0.1,
        volume: 0.22,
      },
      rim: {
        sound: 3,
        pattern: SIXTEENTHS,
        levels: "2142214221422142",
        decay: 0.05,
        volume: 0.2,
        pan: -0.25,
      },
    },
    bass: {
      sound: 2,
      pattern: [
        ". 0 0 0 . 0 0 0 . 0 0 0 . 0 0' 0",
        ". 0 0 0 . 0 0 0 . 0 0 0 . 0 0' 0",
        ". 5, 5, 5, . 5, 5, 5, . 5, 5, 5, . 5, 5 5,",
        ". 5, 5, 5, . 5, 5, 5, . 5, 5, 5, . 5, 5 5,",
        ". 6, 6, 6, . 6, 6, 6, . 6, 6, 6, . 6, 6 6,",
        ". 6, 6, 6, . 6, 6, 6, . 6, 6, 6, . 6, 6 6,",
        ". 4, 4, 4, . 4, 4, 4, . 4, 4, 4, . 4, 4 4,",
        ". 4, 4, 4, . 4, 4, 4, . 4, 4, 4, . 6, 6, 6,",
      ].join(" | "),
      octave: 2,
      cutoff: 480,
      resonance: 6,
      envelope: 0.5,
      decay: 0.14,
      volume: 0.5,
      shape: 0.45,
    },
    lead: {
      sound: 4,
      pattern: [
        "0 . . 0 . . 0 . . 0 . . 0 . 0 .",
        "0 . . 0 . . 0 . . 0 . . 0 . 2 .",
        "5, . . 5, . . 5, . . 5, . . 5, . 5, .",
        "5, . . 5, . . 5, . . 5, . . 5, . 0 .",
        "6, . . 6, . . 6, . . 6, . . 6, . 6, .",
        "6, . . 6, . . 6, . . 6, . . 6, . 1 .",
        "4, . . 4, . . 4, . . 4, . . 4, . 4, .",
        "4, . . 4, . . 4, . . 4, . . 6, . 6, .",
      ].join(" | "),
      tone: 0.4,
      decay: 0.4,
      space: 0.45,
      volume: 0.4,
      width: 0.7,
      sweep: [0.26, 0.7],
    },
    arp: {
      sound: 1,
      pattern: SIXTEENTHS,
      accents: "x..x..x..x..x.x.",
      rate: "1/16",
      direction: "up",
      octaves: 2,
      gate: 0.4,
      decay: 0.14,
      tone: 0.4,
      space: 0.4,
      volume: 0.16,
      sweep: [0.3, 0.6],
    },
    pad: { sound: 6, volume: 0.24, tone: 0.46, space: 0.5, attack: 0.4 },
  },
  {
    id: "fluff-night-swim",
    name: "Night Swim",
    genre: "Melodic garage",
    scale: { root: 3, mode: "major" },
    bpm: 132,
    swing: 0.16,
    pump: 0.45,
    chords: {
      bars: 8,
      steps: [
        [3, 0],
        [0, 1],
        [4, 0],
        [5, 0],
      ],
    },
    drums: {
      kick: {
        sound: 2,
        pattern: `x.........x..... | x......x..x.....`,
        decay: 0.24,
        volume: 0.86,
      },
      snare: {
        sound: 2,
        pattern: BACKBEAT,
        decay: 0.16,
        volume: 0.5,
        space: 0.2,
      },
      clap: {
        sound: 1,
        pattern: `............x... | ....x.......x..x`,
        levels: `0000000000009000 | 0000900000009004`,
        decay: 0.14,
        volume: 0.3,
      },
      hat: {
        sound: 0,
        pattern: `x.xx.xx.x.xx.x.x | x.xx.xx.x.xx.xxx`,
        levels: `9046059090460509 | 9046059090460567`,
        decay: 0.06,
        volume: 0.3,
      },
      rim: {
        sound: 0,
        pattern: `.......x.....x.. | ...x...x.....x..`,
        decay: 0.06,
        volume: 0.24,
        pan: 0.3,
      },
    },
    bass: {
      sound: 10,
      pattern: [
        "3 . . . . . 3 . . 3 . . . . 3' .",
        "3 . . . . . 3 . . 3 . . 5 . 4 .",
        "0' . . . . . 0' . . 0' . . . . 0'' .",
        "0' . . . . . 0' . . 0' . . 2 . 4 .",
        "4 . . . . . 4 . . 4 . . . . 4' .",
        "4 . . . . . 4 . . 4 . . 6 . 4 .",
        "5 . . . . . 5 . . 5 . . . . 5' .",
        "5 . . . . . 5 . . 5 . . 4 . 2 .",
      ].join(" | "),
      octave: 1,
      cutoff: 520,
      resonance: 3,
      envelope: 0.4,
      decay: 0.3,
      volume: 0.54,
      shape: 0.4,
    },
    lead: {
      sound: 3,
      pattern: [
        "5 . . 0' . . 3' . . 0' . . 5 . . .",
        "5 . . 0' . . 2' . 3' . . . 0' . . .",
        "4 . . 0' . . 2' . . 0' . . 4 . . .",
        "4 . . 0' . . 2' . 4' . . . 2' . . .",
        "4 . . 6 . . 1' . . 6 . . 4 . . .",
        "4 . . 6 . . 1' . 3' . . . 1' . . .",
        "5 . . 0' . . 2' . . 0' . . 5 . . .",
        "5 . . 0' . . 2' . 4' . 2' . 1' . 0' .",
      ].join(" | "),
      tone: 0.5,
      decay: 0.6,
      space: 0.5,
      volume: 0.42,
      width: 0.4,
    },
    arp: {
      sound: 7,
      pattern: "..x..x....x..x..",
      rate: "1/8",
      direction: "down",
      octaves: 1,
      gate: 0.7,
      decay: 0.3,
      tone: 0.5,
      space: 0.5,
      volume: 0.2,
    },
    pad: {
      sound: 1,
      volume: 0.3,
      tone: 0.46,
      space: 0.55,
      attack: 0.45,
      release: 0.6,
    },
    vocal: {
      sound: 34,
      pattern: [
        ". . 0 _ . 2 . . . . . . . . . .",
        ". . . . . . . . . . 4 . 2 _ . .",
        ". . 0 _ . 2 . . . . . . . . . .",
        ". . . . . . . . . . 4 . 5 _ . .",
        ". . 1 _ . 2 . . . . . . . . . .",
        ". . . . . . . . . . 4 . 2 _ . .",
        ". . 0 _ . 2 . . . . 4 _ . 2 . .",
        ". . . . . . . . . . . . . . . .",
      ].join(" | "),
      octave: 4,
      volume: 0.34,
      release: 0.3,
      space: 0.5,
    },
  },
  {
    id: "fluff-overpass",
    name: "Overpass",
    genre: "Fast trance",
    scale: { root: 6, mode: "minor" },
    bpm: 145,
    swing: 0,
    pump: 0.7,
    chords: {
      bars: 4,
      steps: [
        [0, 0],
        [6, 0],
        [5, 0],
        [6, 0],
      ],
    },
    drums: {
      kick: {
        sound: 0,
        pattern: `${repeat(FOUR, 3)} | x...x...x...x.x.`,
        decay: 0.22,
        volume: 0.9,
      },
      clap: {
        sound: 2,
        pattern: BACKBEAT,
        decay: 0.18,
        volume: 0.4,
      },
      hat: {
        sound: 5,
        pattern: `${repeat(OFFBEAT, 3)} | ..x...x...x.xxxx`,
        levels: `${repeat("0090009000900090", 3)} | 0090009000904567`,
        decay: 0.09,
        volume: 0.36,
      },
      snare: {
        sound: 1,
        pattern: `.......x.....x.. | .......x..x..x.x`,
        decay: 0.1,
        volume: 0.26,
      },
      rim: {
        sound: 5,
        pattern: `x............... | ................ | ................ | ................`,
        decay: 0.5,
        volume: 0.3,
      },
    },
    bass: {
      sound: 7,
      pattern: [
        ". . 0 . . . 0 . . . 0 . . 0 0 .",
        ". . 6, . . . 6, . . . 6, . . 6, 6, .",
        ". . 5, . . . 5, . . . 5, . . 5, 5, .",
        ". . 6, . . . 6, . . . 6, . . 6, 4, .",
      ].join(" | "),
      octave: 2,
      cutoff: 560,
      resonance: 4,
      envelope: 0.5,
      decay: 0.18,
      volume: 0.5,
      shape: 0.5,
      drive: 0.15,
    },
    lead: {
      sound: 0,
      pattern: [
        "0' . 0' 4 . 0' . 2' . 0' . 4 0' . 2' .",
        "6 . 6 3 . 6 . 1' . 6 . 3 6 . 1' .",
        "5 . 5 2 . 5 . 0' . 5 . 2 5 . 0' .",
        "6 . 6 3 . 6 . 1' . 3' . 1' 6 . 4 .",
      ].join(" | "),
      tone: 0.6,
      decay: 0.16,
      space: 0.35,
      volume: 0.38,
      width: 0.6,
    },
    arp: {
      sound: 6,
      pattern: "x.xxx.xxx.xxx.xx",
      rate: "1/16",
      direction: "updown",
      octaves: 2,
      gate: 0.35,
      decay: 0.12,
      tone: 0.42,
      space: 0.3,
      volume: 0.14,
    },
    pad: { sound: 0, volume: 0.22, tone: 0.48, space: 0.45, attack: 0.2 },
    vocal: {
      sound: 45,
      pattern: [
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . . . 0 _ _ .",
      ].join(" | "),
      octave: 4,
      volume: 0.3,
      space: 0.5,
    },
  },
  {
    id: "fluff-low-sun",
    name: "Low Sun",
    genre: "Deep house",
    scale: { root: 0, mode: "minor" },
    bpm: 124,
    swing: 0.08,
    pump: 0.55,
    chords: {
      bars: 8,
      steps: [
        [0, 1],
        [5, 0],
        [3, 0],
        [4, 0],
      ],
    },
    drums: {
      kick: { sound: 3, pattern: FOUR, decay: 0.3, volume: 0.86 },
      clap: {
        sound: 3,
        pattern: BACKBEAT,
        decay: 0.2,
        volume: 0.42,
        space: 0.35,
      },
      hat: {
        sound: 2,
        pattern: SIXTEENTHS,
        levels: "2193219321932195",
        decay: 0.08,
        volume: 0.32,
      },
      snare: {
        sound: 5,
        pattern: `.........x...... | .........x....x.`,
        decay: 0.1,
        volume: 0.22,
      },
      rim: {
        sound: 1,
        pattern: `......x......... | ......x......x.x`,
        decay: 0.22,
        volume: 0.3,
        pan: -0.3,
        space: 0.2,
      },
    },
    bass: {
      sound: 6,
      pattern: [
        "0 . . 0 . 0' . . 0 . . 2 . 0 . .",
        "0 . . 0 . 0' . . 0 . . 2 . 4 . .",
        "5, . . 5, . 5 . . 5, . . 0 . 5, . .",
        "5, . . 5, . 5 . . 5, . . 0 . 6, . .",
        "3 . . 3 . 3' . . 3 . . 5 . 3 . .",
        "3 . . 3 . 3' . . 3 . . 5 . 4 . .",
        "4 . . 4 . 4' . . 4 . . 6 . 4 . .",
        "4 . . 4 . 4' . . 4 . . 6 . 1 . .",
      ].join(" | "),
      octave: 2,
      cutoff: 560,
      resonance: 2,
      envelope: 0.3,
      decay: 0.22,
      volume: 0.54,
      shape: 0.45,
    },
    lead: {
      sound: 4,
      pattern: [
        ". . 0 . . . . 0 . . 0 . . . . .",
        ". . 0 . . . . 0 . . 0 . . 0 . .",
        ". . 5, . . . . 5, . . 5, . . . . .",
        ". . 5, . . . . 5, . . 5, . . 5, . .",
        ". . 3 . . . . 3 . . 3 . . . . .",
        ". . 3 . . . . 3 . . 3 . . 3 . .",
        ". . 4 . . . . 4 . . 4 . . . . .",
        ". . 4 . . . . 4 . . 4 . . 4 . 6",
      ].join(" | "),
      tone: 0.36,
      decay: 0.3,
      space: 0.4,
      volume: 0.38,
      width: 0.5,
    },
    arp: {
      sound: 3,
      pattern: "x..x..x.x..x.x..",
      rate: "1/16",
      direction: "random",
      octaves: 2,
      gate: 0.5,
      decay: 0.2,
      tone: 0.5,
      space: 0.5,
      volume: 0.16,
    },
    pad: {
      sound: 3,
      volume: 0.28,
      tone: 0.4,
      space: 0.55,
      attack: 0.4,
      release: 0.6,
    },
    vocal: {
      sound: 36,
      pattern: [
        ". . . . . . . . . . . . 0 _ _ .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . . . 0 _ 2 _",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . . . 3 _ _ .",
        ". . . . . . . . . . . . . . . .",
        ". . . . . . . . . . . . 4 _ 2 _",
        ". . . . . . . . . . . . . . . .",
      ].join(" | "),
      octave: 4,
      volume: 0.3,
      release: 0.4,
      space: 0.55,
    },
  },
  {
    id: "fluff-undertone",
    name: "Undertone",
    genre: "Dark melodic house",
    scale: { root: 1, mode: "minor" },
    bpm: 123,
    swing: 0.02,
    pump: 0.6,
    chords: {
      bars: 8,
      steps: [
        [0, 0],
        [2, 0],
        [5, 0],
        [4, 0],
      ],
    },
    drums: {
      kick: { sound: 5, pattern: FOUR, decay: 0.26, volume: 0.88 },
      clap: {
        sound: 0,
        pattern: BACKBEAT,
        decay: 0.2,
        volume: 0.42,
        space: 0.3,
      },
      hat: {
        sound: 0,
        pattern: SIXTEENTHS,
        levels: "3192319231923194",
        decay: 0.06,
        volume: 0.3,
      },
      snare: {
        sound: 5,
        pattern: `................ | ..........x....x`,
        decay: 0.1,
        volume: 0.22,
      },
      rim: {
        sound: 1,
        pattern: `...x......x..... | ...x......x..x..`,
        decay: 0.26,
        volume: 0.3,
        pan: 0.3,
        space: 0.25,
      },
    },
    bass: {
      sound: 5,
      pattern: [
        "0 . . 0 . . 0 . 0 . . 0 . . 0 .",
        "0 . . 0 . . 0 . 0 . . 0 . 0' . 6,",
        "2 . . 2 . . 2 . 2 . . 2 . . 2 .",
        "2 . . 2 . . 2 . 2 . . 2 . 4 . 2",
        "5, . . 5, . . 5, . 5, . . 5, . . 5, .",
        "5, . . 5, . . 5, . 5, . . 5, . 5 . 6,",
        "4, . . 4, . . 4, . 4, . . 4, . . 4, .",
        "4, . . 4, . . 4, . 4, . . 4, . 6, . 4,",
      ].join(" | "),
      octave: 2,
      cutoff: 340,
      resonance: 3,
      envelope: 0.4,
      decay: 0.2,
      volume: 0.5,
      shape: 0.4,
      drive: 0.2,
    },
    lead: {
      sound: 1,
      pattern: [
        "0 . 2 . 4 . 0' . 6 . 4 . 2 . 4 .",
        "0 . 2 . 4 . 0' . 1' . 0' . 6 . 4 .",
        "2 . 4 . 6 . 2' . 1' . 6 . 4 . 6 .",
        "2 . 4 . 6 . 2' . 4' . 2' . 1' . 6 .",
        "5 . 0' . 2' . 5 . 4 . 2' . 0' . 5 .",
        "5 . 0' . 2' . 4' . 2' . 0' . 5 . 4 .",
        "4 . 6 . 1' . 4 . 3 . 1' . 6 . 4 .",
        "4 . 6 . 1' . 3' . 1' . 6 . 4 . 3 .",
      ].join(" | "),
      tone: 0.36,
      decay: 0.3,
      space: 0.55,
      volume: 0.4,
      width: 0.5,
      sweep: [0.3, 0.52],
    },
    arp: {
      sound: 2,
      pattern: "..x...x...x...x.",
      rate: "1/8",
      direction: "down",
      octaves: 2,
      gate: 0.6,
      decay: 0.5,
      tone: 0.5,
      space: 0.6,
      volume: 0.16,
    },
    pad: {
      sound: 2,
      volume: 0.26,
      tone: 0.4,
      space: 0.6,
      attack: 0.5,
      release: 0.7,
    },
    vocal: {
      sound: 33,
      pattern: [
        "4 _ _ _ _ _ _ _ _ _ _ _ . . . .",
        ". . . . . . . . . . . . . . . .",
        "4 _ _ _ _ _ _ _ 6 _ _ _ . . . .",
        ". . . . . . . . . . . . . . . .",
        "2 _ _ _ _ _ _ _ _ _ _ _ . . . .",
        ". . . . . . . . . . . . . . . .",
        "1 _ _ _ _ _ _ _ 3 _ _ _ . . . .",
        ". . . . . . . . . . . . . . . .",
      ].join(" | "),
      octave: 4,
      volume: 0.3,
      loop: true,
      attack: 0.3,
      release: 0.6,
      space: 0.6,
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
function ramp(count: number, [from, to]: readonly [number, number]): number[] {
  return Array.from(
    { length: count },
    (_, index) => from + ((to - from) * index) / Math.max(1, count - 1),
  );
}
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
  project.volume = 0.85;
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
    if (spec.levels) {
      const levels = drumCells(spec.levels, `${label} levels`);
      if (levels.length !== cells.length)
        throw new Error(`${label} levels must match its pattern.`);
      track.automation.volume = levels.map(
        (level) => (spec.volume * Number(level)) / 9,
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
  if (bass.sweep)
    project.bass.automation.cutoff = ramp(bassSteps.length, bass.sweep);

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
    if (lead.sweep)
      project.keys.automation.tone = ramp(steps.length, lead.sweep);
  } else project.keys.muted = true;

  const chordTiming: Timing & { bars: PadTiming["bars"] } = {
    bars: preset.chords.bars,
    meter: "4/4",
    grid: "straight",
  };
  const chords = preset.chords.steps.map(([degree, inversion]) => ({
    degree,
    inversion,
  }));
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
  if (pad?.sweep)
    project.pad.automation.tone = ramp(chordTiming.bars * 16, pad.sweep);

  const arp = preset.arp;
  if (arp) {
    const label = `${preset.name} arp`;
    const cells = drumCells(arp.pattern, label);
    const accents = arp.accents ? drumCells(arp.accents, label) : null;
    const root = 60 + scale.root - (scale.root > 6 ? 12 : 0);
    const triad = scaleNotes(scale, root, root + 11).filter(
      (_, index) => index === 0 || index === 2 || index === 4,
    );
    project.arp = {
      ...project.arp,
      timing: timing(cells.length / 16, label),
      automationBars: arp.sweep ? 8 : null,
      followChords: true,
      muted: false,
      sound: arp.sound,
      notes: triad,
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
    if (arp.sweep) project.arp.automation.tone = ramp(8 * 16, arp.sweep);
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
  } else project.vocal.muted = true;

  project.cloud.muted = true;
  project.tension.muted = true;
  const valid = readProject(project);
  if (!valid) throw new Error(`The ${preset.name} example is invalid.`);
  return valid;
}
