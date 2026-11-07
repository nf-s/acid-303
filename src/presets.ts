import {
  createProject,
  emptyBassAutomation,
  emptyKeysAutomation,
  normalizedBassValue,
  STEP_COUNT,
  withScale,
} from "./model";
import type { BassStep, DrumId, MusicalScale, Project } from "./model";
import type { ArpTrack } from "./arp-model";
import { applyPadProgression } from "./pad-model";
import type { PadTrack } from "./pad-model";

interface DrumPreset {
  hits: number[];
  sound: number;
  decay: number;
  volume: number;
  pitch?: number;
  tone?: number;
  space?: number;
  levels?: number[];
}
interface NotePattern {
  root: number;
  notes: number[];
  hits: number[];
  accents: number[];
  slides: number[];
}
interface GenrePreset {
  id: string;
  name: string;
  genre: string;
  scale: MusicalScale;
  bpm: number;
  swing: number;
  drive: number;
  drums: Record<DrumId, DrumPreset>;
  bass: NotePattern & {
    shape: number;
    drive: number;
    sound: number;
    waveform: "sawtooth" | "square";
    cutoff: number;
    resonance: number;
    envelope: number;
    decay: number;
    volume: number;
  };
  texture: NotePattern & {
    sound: number;
    tone: number;
    decay: number;
    space: number;
    volume: number;
  };
}

const GENRE_PRESETS: GenrePreset[] = [
  {
    id: "house",
    name: "Disco Moth",
    genre: "House",
    scale: { root: 0, mode: "major" },
    bpm: 124,
    swing: 0.1,
    drive: 0.08,
    drums: {
      kick: { hits: [0, 4, 8, 12], sound: 1, decay: 0.22, volume: 0.82 },
      snare: { hits: [15], sound: 4, decay: 0.12, volume: 0.2 },
      hat: { hits: [2, 6, 10, 14], sound: 1, decay: 0.075, volume: 0.3 },
      clap: { hits: [4, 12], sound: 0, decay: 0.17, volume: 0.47 },
      rim: { hits: [3, 7, 11, 15], sound: 3, decay: 0.065, volume: 0.25 },
    },
    bass: {
      shape: 0.32,
      drive: 0,
      sound: 0,
      root: 36,
      notes: [0, 0, 7, 0, 0, 4, 7, 4, 5, 5, 7, 5, 7, 7, 4, 7],
      hits: [0, 3, 6, 7, 8, 11, 14],
      accents: [0, 8],
      slides: [6],
      waveform: "square",
      cutoff: 440,
      resonance: 3,
      envelope: 0.2,
      decay: 0.18,
      volume: 0.36,
    },
    texture: {
      root: 60,
      notes: [0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 7, 7, 7, 7],
      hits: [2, 6, 10, 14],
      accents: [6, 14],
      slides: [],
      sound: 4,
      tone: 0.34,
      decay: 0.34,
      space: 0.24,
      volume: 0.28,
    },
  },
  {
    id: "tech-house",
    name: "Kick Gremlin",
    genre: "Tech house",
    scale: { root: 9, mode: "dorian" },
    bpm: 128,
    swing: 0.17,
    drive: 0.15,
    drums: {
      kick: { hits: [0, 4, 8, 12, 15], sound: 4, decay: 0.17, volume: 0.82 },
      snare: { hits: [3, 11], sound: 1, decay: 0.08, volume: 0.2 },
      hat: {
        hits: [2, 3, 6, 10, 11, 14, 15],
        sound: 3,
        decay: 0.09,
        volume: 0.38,
      },
      clap: { hits: [4, 12], sound: 4, decay: 0.11, volume: 0.48 },
      rim: { hits: [1, 6, 9, 14], sound: 4, decay: 0.055, volume: 0.3 },
    },
    bass: {
      shape: 0.45,
      drive: 0.12,
      sound: 1,
      root: 33,
      notes: [0, 0, 0, 12, 0, 0, 7, 0, 0, 0, 3, 0, 0, 7, 0, 12],
      hits: [0, 2, 3, 6, 8, 10, 13, 15],
      accents: [0, 6, 10],
      slides: [2],
      waveform: "square",
      cutoff: 580,
      resonance: 5,
      envelope: 0.35,
      decay: 0.13,
      volume: 0.4,
    },
    texture: {
      root: 57,
      notes: [0, 0, 7, 0, 0, 0, 7, 0, 0, 0, 7, 0, 3, 0, 7, 0],
      hits: [1, 5, 7, 10, 13],
      accents: [7],
      slides: [],
      sound: 0,
      tone: 0.4,
      decay: 0.14,
      space: 0.25,
      volume: 0.32,
    },
  },
  {
    id: "techno",
    name: "Wire Wraith",
    genre: "Techno",
    scale: { root: 5, mode: "minor" },
    bpm: 134,
    swing: 0.025,
    drive: 0.12,
    drums: {
      kick: { hits: [0, 4, 8, 12], sound: 1, decay: 0.18, volume: 0.86 },
      snare: { hits: [], sound: 1, decay: 0.09, volume: 0.3 },
      hat: {
        hits: [2, 4, 6, 7, 10, 12, 14, 15],
        sound: 0,
        decay: 0.045,
        volume: 0.26,
        tone: 0.62,
      },
      clap: { hits: [], sound: 4, decay: 0.08, volume: 0.24 },
      rim: {
        hits: [3, 6, 10, 14],
        sound: 2,
        decay: 0.04,
        volume: 0.22,
        tone: 0.38,
        space: 0.08,
      },
    },
    bass: {
      shape: 0.24,
      drive: 0.13,
      sound: 1,
      root: 41,
      notes: [0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0],
      hits: [2, 5, 7, 10, 13],
      accents: [5, 13],
      slides: [],
      waveform: "square",
      cutoff: 550,
      resonance: 1.2,
      envelope: 0.08,
      decay: 0.1,
      volume: 0.34,
    },
    texture: {
      root: 65,
      notes: [0],
      hits: [],
      accents: [],
      slides: [],
      sound: 3,
      tone: 0.34,
      decay: 0.12,
      space: 0.2,
      volume: 0.16,
    },
  },
  {
    id: "driving-techno",
    name: "Tunnel Imp",
    genre: "Driving techno",
    scale: { root: 2, mode: "phrygian" },
    bpm: 142,
    swing: 0,
    drive: 0.14,
    drums: {
      kick: { hits: [0, 4, 8, 12], sound: 2, decay: 0.2, volume: 0.84 },
      snare: { hits: [4, 12], sound: 1, decay: 0.1, volume: 0.32 },
      hat: {
        hits: [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15],
        sound: 0,
        decay: 0.04,
        volume: 0.28,
        tone: 0.58,
      },
      clap: { hits: [], sound: 4, decay: 0.07, volume: 0.24 },
      rim: { hits: [], sound: 2, decay: 0.04, volume: 0.2 },
    },
    bass: {
      shape: 0.34,
      drive: 0.18,
      sound: 3,
      root: 38,
      notes: [0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 1],
      hits: [2, 3, 6, 7, 10, 11, 14, 15],
      accents: [2, 10],
      slides: [6, 14],
      waveform: "sawtooth",
      cutoff: 700,
      resonance: 2,
      envelope: 0.14,
      decay: 0.12,
      volume: 0.34,
    },
    texture: {
      root: 62,
      notes: [0],
      hits: [3, 11],
      accents: [],
      slides: [],
      sound: 3,
      tone: 0.46,
      decay: 0.12,
      space: 0.2,
      volume: 0.16,
    },
  },
  {
    id: "melodic-techno",
    name: "Moon Sprite",
    genre: "Melodic techno",
    scale: { root: 9, mode: "minor" },
    bpm: 124,
    swing: 0,
    drive: 0.05,
    drums: {
      kick: { hits: [0, 4, 8, 12], sound: 1, decay: 0.22, volume: 0.83 },
      snare: { hits: [], sound: 4, decay: 0.12, volume: 0.2 },
      hat: { hits: [2, 6, 10, 14], sound: 1, decay: 0.045, volume: 0.24 },
      clap: { hits: [4, 12], sound: 3, decay: 0.13, volume: 0.34 },
      rim: { hits: [], sound: 0, decay: 0.05, volume: 0.18 },
    },
    bass: {
      shape: 0.16,
      drive: 0,
      sound: 0,
      root: 33,
      notes: [0],
      hits: [2, 6, 10, 14],
      accents: [],
      slides: [],
      waveform: "square",
      cutoff: 220,
      resonance: 0.8,
      envelope: 0.04,
      decay: 0.22,
      volume: 0.38,
    },
    texture: {
      root: 57,
      notes: [0],
      hits: [],
      accents: [],
      slides: [],
      sound: 1,
      tone: 0.22,
      decay: 0.6,
      space: 0.35,
      volume: 0.16,
    },
  },
  {
    id: "atmospheric-techno",
    name: "Cloud Goblin",
    genre: "Experimental atmospheric techno",
    scale: { root: 2, mode: "pentatonic" },
    bpm: 116,
    swing: 0.08,
    drive: 0.07,
    drums: {
      kick: { hits: [0, 10], sound: 3, decay: 0.29, volume: 0.72 },
      snare: {
        hits: [7],
        sound: 4,
        decay: 0.22,
        volume: 0.19,
        tone: 0.3,
        space: 0.28,
      },
      hat: {
        hits: [3, 6, 11, 14],
        sound: 3,
        decay: 0.075,
        volume: 0.18,
        tone: 0.38,
      },
      clap: { hits: [], sound: 3, decay: 0.25, volume: 0.22 },
      rim: { hits: [], sound: 4, decay: 0.08, volume: 0.2 },
    },
    bass: {
      shape: 0.16,
      drive: 0,
      sound: 5,
      root: 38,
      notes: [0],
      hits: [],
      accents: [],
      slides: [],
      waveform: "square",
      cutoff: 220,
      resonance: 1,
      envelope: 0.06,
      decay: 0.3,
      volume: 0.28,
    },
    texture: {
      root: 62,
      notes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0],
      hits: [1, 11],
      accents: [],
      slides: [],
      sound: 5,
      tone: 0.24,
      decay: 0.95,
      space: 0.64,
      volume: 0.19,
    },
  },
  {
    id: "garage",
    name: "Velvet Imp",
    genre: "Garage",
    scale: { root: 7, mode: "minor" },
    bpm: 132,
    swing: 0.27,
    drive: 0.07,
    drums: {
      kick: { hits: [0, 6, 10], sound: 1, decay: 0.18, volume: 0.84 },
      snare: { hits: [4, 12], sound: 1, decay: 0.12, volume: 0.48 },
      hat: {
        hits: [0, 2, 3, 6, 8, 10, 11, 14, 15],
        sound: 0,
        decay: 0.04,
        volume: 0.3,
      },
      clap: { hits: [], sound: 4, decay: 0.08, volume: 0.25 },
      rim: { hits: [], sound: 1, decay: 0.05, volume: 0.16 },
    },
    bass: {
      shape: 0.14,
      drive: 0.04,
      sound: 6,
      root: 31,
      notes: [0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 12, 0, 0, 3, 0],
      hits: [1, 3, 6, 9, 11, 14],
      accents: [3, 9],
      slides: [],
      waveform: "square",
      cutoff: 420,
      resonance: 1.2,
      envelope: 0.08,
      decay: 0.2,
      volume: 0.42,
    },
    texture: {
      root: 67,
      notes: [0],
      hits: [2, 10],
      accents: [],
      slides: [],
      sound: 4,
      tone: 0.24,
      decay: 0.2,
      space: 0.22,
      volume: 0.19,
    },
  },
  {
    id: "speed-garage",
    name: "Turbo Rat",
    genre: "Speed garage",
    scale: { root: 5, mode: "minor" },
    bpm: 138,
    swing: 0.18,
    drive: 0.12,
    drums: {
      kick: { hits: [0, 4, 8, 12, 15], sound: 1, decay: 0.17, volume: 0.85 },
      snare: { hits: [], sound: 3, decay: 0.12, volume: 0.4 },
      hat: {
        hits: [2, 3, 6, 10, 11, 14],
        sound: 1,
        decay: 0.035,
        volume: 0.27,
      },
      clap: { hits: [4, 12], sound: 3, decay: 0.14, volume: 0.45 },
      rim: { hits: [], sound: 4, decay: 0.04, volume: 0.2 },
    },
    bass: {
      shape: 0.46,
      drive: 0.12,
      sound: 7,
      root: 29,
      notes: [0, 0, 0, 7, 0, 0, 3, 3, 0, 0, 0, 10, 0, 0, 7, 7],
      hits: [0, 1, 2, 3, 6, 7, 8, 9, 10, 11, 14, 15],
      accents: [0, 8],
      slides: [0, 1, 2, 6, 8, 9, 10, 14],
      waveform: "sawtooth",
      cutoff: 650,
      resonance: 2,
      envelope: 0.1,
      decay: 0.3,
      volume: 0.38,
    },
    texture: {
      root: 65,
      notes: [0],
      hits: [15],
      accents: [],
      slides: [],
      sound: 2,
      tone: 0.3,
      decay: 0.11,
      space: 0.16,
      volume: 0.14,
    },
  },
  {
    id: "jungle",
    name: "Moss Raver",
    genre: "Jungle",
    scale: { root: 2, mode: "minor" },
    bpm: 170,
    swing: 0.06,
    drive: 0.1,
    drums: {
      kick: { hits: [0, 6, 10], sound: 1, decay: 0.13, volume: 0.8 },
      snare: {
        hits: [4, 7, 9, 12, 15],
        sound: 3,
        decay: 0.12,
        volume: 0.5,
        levels: [
          0.3, 0.3, 0.3, 0.3, 1, 0.3, 0.3, 0.26, 0.3, 0.33, 0.3, 0.3, 0.94, 0.3,
          0.3, 0.45,
        ],
      },
      hat: {
        hits: [0, 2, 3, 6, 8, 10, 11, 14, 15],
        sound: 3,
        decay: 0.035,
        volume: 0.29,
        tone: 0.56,
      },
      clap: { hits: [], sound: 4, decay: 0.06, volume: 0.18 },
      rim: { hits: [], sound: 0, decay: 0.035, volume: 0.16 },
    },
    bass: {
      shape: 0.1,
      drive: 0.04,
      sound: 0,
      root: 26,
      notes: [0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 7, 0, 0, 0, 0, 0],
      hits: [0, 1, 2, 8, 9, 10],
      accents: [0, 8],
      slides: [0, 1, 8, 9],
      waveform: "square",
      cutoff: 180,
      resonance: 0.7,
      envelope: 0.02,
      decay: 0.3,
      volume: 0.45,
    },
    texture: {
      root: 62,
      notes: [0],
      hits: [],
      accents: [],
      slides: [],
      sound: 1,
      tone: 0.24,
      decay: 0.65,
      space: 0.45,
      volume: 0.17,
    },
  },
  {
    id: "bass-house",
    name: "Sub Gremlin",
    genre: "Bass house",
    scale: { root: 5, mode: "minor" },
    bpm: 128,
    swing: 0.04,
    drive: 0.12,
    drums: {
      kick: { hits: [0, 4, 8, 12], sound: 1, decay: 0.18, volume: 0.88 },
      snare: { hits: [], sound: 1, decay: 0.09, volume: 0.24 },
      hat: {
        hits: [2, 3, 6, 7, 10, 14, 15],
        sound: 0,
        decay: 0.045,
        volume: 0.32,
      },
      clap: { hits: [4, 12], sound: 4, decay: 0.11, volume: 0.48 },
      rim: { hits: [], sound: 2, decay: 0.04, volume: 0.18 },
    },
    bass: {
      shape: 0.24,
      drive: 0.14,
      sound: 8,
      root: 29,
      notes: [0, 0, 0, 12, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 3, 0],
      hits: [2, 3, 6, 7, 10, 14, 15],
      accents: [2, 10],
      slides: [2, 14],
      waveform: "square",
      cutoff: 650,
      resonance: 1.5,
      envelope: 0.14,
      decay: 0.16,
      volume: 0.44,
    },
    texture: {
      root: 65,
      notes: [0],
      hits: [],
      accents: [],
      slides: [],
      sound: 2,
      tone: 0.3,
      decay: 0.12,
      space: 0.14,
      volume: 0.17,
    },
  },
];

interface GenrePalette {
  arp: Partial<ArpTrack>;
  pad: Partial<PadTrack>;
  progression: string;
  bassSweep: number[];
  bassPulse: number[];
  hatLevels: number[];
  hatPan: number[];
  textureMotion: number[];
}
const pattern = (hits: number[]) =>
  Array.from({ length: STEP_COUNT }, (_, index) => hits.includes(index));
const GENRE_PALETTES: Record<string, GenrePalette> = {
  house: {
    arp: {
      muted: false,
      sound: 4,
      notes: [60, 64, 67, 71],
      direction: "played",
      rate: "1/8",
      steps: pattern([2, 6, 10, 14]),
      tone: 0.36,
      gate: 0.35,
      decay: 0.12,
      space: 0.22,
      volume: 0.16,
    },
    pad: {
      muted: false,
      sound: 0,
      bars: 4,
      attack: 0.22,
      release: 0.28,
      tone: 0.38,
      space: 0.23,
      volume: 0.15,
    },
    progression: "resolve",
    bassSweep: [-0.07, -0.02, 0.04, 0],
    bassPulse: [0.46, 0.5, 0.52, 0.42],
    hatLevels: [0.65, 0.65, 1, 0.7],
    hatPan: [0.42, 0.48, 0.58, 0.52],
    textureMotion: [0.03, 0.08, 0.03, 0.12],
  },
  "tech-house": {
    arp: {
      muted: false,
      sound: 5,
      notes: [69, 64, 72],
      direction: "played",
      rate: "1/16",
      steps: pattern([3, 7, 11, 15]),
      shape: 0.58,
      gate: 0.18,
      decay: 0.08,
      tone: 0.42,
      space: 0.08,
      volume: 0.15,
    },
    pad: {
      muted: true,
      sound: 3,
      bars: 2,
      attack: 0.08,
      release: 0.18,
      tone: 0.3,
      volume: 0.12,
    },
    progression: "suspended",
    bassSweep: [-0.12, 0.12, -0.04, 0.04, -0.1, 0.16, 0, 0.08],
    bassPulse: [0.35, 0.58, 0.38, 0.68],
    hatLevels: [0.6, 0.65, 1, 0.72],
    hatPan: [0.37, 0.58, 0.43, 0.64],
    textureMotion: [0, 0.1, 0.25, 0.04],
  },
  techno: {
    arp: { muted: true },
    pad: { muted: true },
    progression: "suspended",
    bassSweep: [-0.025, 0, 0.025, -0.01, 0, 0.04, -0.015, 0.02],
    bassPulse: [0.24, 0.27, 0.22, 0.3],
    hatLevels: [0.52, 0.45, 1, 0.4, 0.58, 0.45, 0.86, 0.32],
    hatPan: [0.46, 0.49, 0.54, 0.51],
    textureMotion: [0],
  },
  "driving-techno": {
    arp: { muted: true },
    pad: { muted: true },
    progression: "descent",
    bassSweep: [-0.03, 0, 0.04, 0.02, -0.025, 0, 0.065, 0.035],
    bassPulse: [0.3, 0.32, 0.4, 0.34],
    hatLevels: [0.45, 0.5, 1, 0.38, 0.45, 0.58, 0.88, 0.4],
    hatPan: [0.45, 0.48, 0.55, 0.52],
    textureMotion: [0.12, 0.18, 0.1, 0.24],
  },
  "melodic-techno": {
    arp: {
      muted: false,
      sound: 1,
      notes: [57, 60, 64],
      direction: "up",
      rate: "1/16",
      octaves: 1,
      steps: pattern([0, 2, 3, 6, 8, 10, 11, 14]),
      accents: pattern([0, 8]),
      gate: 0.44,
      decay: 0.22,
      tone: 0.28,
      resonance: 0.14,
      shape: 0.16,
      width: 0.32,
      space: 0.38,
      volume: 0.26,
    },
    pad: { muted: true, sound: 0, bars: 8, tone: 0.26, volume: 0.12 },
    progression: "suspended",
    bassSweep: [0, -0.01, 0.015, 0],
    bassPulse: [0.58, 0.58, 0.62, 0.58],
    hatLevels: [0.5, 0.5, 1, 0.5, 0.5, 0.5, 0.88, 0.5],
    hatPan: [0.45, 0.48, 0.55, 0.52],
    textureMotion: [0],
  },
  "atmospheric-techno": {
    arp: { muted: true, sound: 5, notes: [62, 69], octaves: 1 },
    pad: {
      muted: false,
      sound: 4,
      bars: 8,
      attack: 0.68,
      release: 0.6,
      tone: 0.26,
      motion: 0.3,
      spread: 0.76,
      space: 0.58,
      shape: 0.26,
      volume: 0.19,
    },
    progression: "drift",
    bassSweep: [0],
    bassPulse: [0.65],
    hatLevels: [0.5, 0.65, 0.8, 0.55, 0.5, 0.6, 1, 0.4],
    hatPan: [0.3, 0.44, 0.7, 0.56],
    textureMotion: [0.18, 0.22, 0.28, 0.32, 0.36, 0.32, 0.26, 0.2],
  },
  garage: {
    arp: { muted: true },
    pad: { muted: true },
    progression: "return",
    bassSweep: [0, 0.02, -0.025, 0.035, -0.01, 0.01, -0.02, 0.025],
    bassPulse: [0.4, 0.58, 0.46, 0.52],
    hatLevels: [0.5, 0.4, 1, 0.36, 0.55, 0.4, 0.86, 0.46],
    hatPan: [0.36, 0.54, 0.62, 0.46],
    textureMotion: [0.04, 0.08, 0.12, 0.06],
  },
  "speed-garage": {
    arp: { muted: true },
    pad: { muted: true },
    progression: "descent",
    bassSweep: [
      0.02, 0.05, 0.07, 0, 0, 0, -0.035, -0.02, 0.025, 0.055, 0.08, 0.015, 0, 0,
      0.04, -0.015,
    ],
    bassPulse: [0.78, 0.82, 0.8, 0.68, 0.7, 0.7, 0.76, 0.72],
    hatLevels: [0.6, 0.55, 1, 0.32, 0.6, 0.55, 0.86, 0.4],
    hatPan: [0.38, 0.46, 0.62, 0.54],
    textureMotion: [0.06, 0.08, 0.12, 0.04],
  },
  jungle: {
    arp: { muted: true },
    pad: {
      muted: false,
      sound: 1,
      bars: 8,
      attack: 0.6,
      release: 0.4,
      tone: 0.26,
      motion: 0.16,
      spread: 0.7,
      space: 0.4,
      shape: 0.2,
      volume: 0.13,
    },
    progression: "suspended",
    bassSweep: [0, 0.01, -0.01, 0],
    bassPulse: [0.78, 0.8, 0.76, 0.65],
    hatLevels: [
      0.7, 0.35, 0.85, 0.3, 0.5, 0.4, 1, 0.4, 0.62, 0.35, 0.9, 0.28, 0.5, 0.4,
      0.8, 0.38,
    ],
    hatPan: [0.38, 0.56, 0.45, 0.62],
    textureMotion: [0],
  },
  "bass-house": {
    arp: { muted: true },
    pad: { muted: true },
    progression: "suspended",
    bassSweep: [-0.025, 0, 0.04, 0.015, -0.02, 0, 0.06, -0.01],
    bassPulse: [0.34, 0.38, 0.46, 0.4],
    hatLevels: [0.5, 0.45, 1, 0.36, 0.5, 0.45, 0.88, 0.42],
    hatPan: [0.44, 0.5, 0.56, 0.5],
    textureMotion: [0],
  },
};
const curve = (values: number[], base = 0, multiply = false) =>
  Array.from({ length: STEP_COUNT }, (_, index) =>
    Math.max(
      0,
      Math.min(
        1,
        multiply
          ? base * (values[index % values.length] ?? 1)
          : base + (values[index % values.length] ?? 0),
      ),
    ),
  );

export const PRESETS: ReadonlyArray<{
  id: string;
  name: string;
  genre: string;
}> = GENRE_PRESETS.map(({ id, name, genre }) => ({ id, name, genre }));

const legacyPresetIds = new Map([
  ["Sunday Socks", "house"],
  ["Pocket Disco", "tech-house"],
  ["Little Machine", "techno"],
  ["Night Train", "driving-techno"],
  ["Moon Jelly", "melodic-techno"],
  ["Velvet Steps", "garage"],
  ["Turbo Biscuit", "speed-garage"],
  ["Jungle Gym", "jungle"],
  ["Switchback", "bass-house"],
]);

export function findPresetByName(name: string) {
  const legacyId = legacyPresetIds.get(name);
  return PRESETS.find(
    (preset) => preset.name === name || preset.id === legacyId,
  );
}

function noteSteps(pattern: NotePattern): BassStep[] {
  return Array.from({ length: STEP_COUNT }, (_, index) => ({
    note: pattern.root + (pattern.notes[index] ?? 0),
    on: pattern.hits.includes(index),
    accent: pattern.accents.includes(index),
    slide: pattern.slides.includes(index),
  }));
}

export function createPreset(id: string): Project {
  const preset =
    GENRE_PRESETS.find((candidate) => candidate.id === id) ?? GENRE_PRESETS[0];
  if (!preset) return createProject();
  const project = createProject();
  project.name = preset.name;
  project.scale = { ...preset.scale };
  project.bpm = preset.bpm;
  project.swing = preset.swing;
  project.drive = preset.drive;
  project.drums.forEach((track) => {
    const sound = preset.drums[track.id];
    track.sound = sound.sound;
    track.pitch = sound.pitch ?? 0;
    track.decay = sound.decay;
    track.volume = sound.volume;
    track.tone = sound.tone ?? track.tone;
    track.space = sound.space ?? track.space;
    track.muted = sound.hits.length === 0;
    if (sound.levels)
      track.automation.volume = curve(sound.levels, sound.volume, true);
    track.steps = Array.from({ length: STEP_COUNT }, (_, step) =>
      sound.hits.includes(step),
    );
  });
  project.bass = {
    pulse: 0.5,
    shape: preset.bass.shape,
    drive: preset.bass.drive,
    sound: preset.bass.sound,
    automation: emptyBassAutomation(),
    waveform: preset.bass.waveform,
    cutoff: preset.bass.cutoff,
    resonance: preset.bass.resonance,
    envelope: preset.bass.envelope,
    decay: preset.bass.decay,
    volume: preset.bass.volume,
    muted: preset.bass.hits.length === 0,
    steps: noteSteps(preset.bass),
  };
  project.keys = {
    width: 0.5,
    attack: 0,
    grit: 0,
    motion: 0,
    automation: emptyKeysAutomation(),
    sound: preset.texture.sound,
    tone: preset.texture.tone,
    decay: preset.texture.decay,
    space: preset.texture.space,
    volume: preset.texture.volume,
    muted: preset.texture.hits.length === 0,
    steps: noteSteps(preset.texture),
  };
  const palette = GENRE_PALETTES[preset.id];
  if (palette) {
    project.arp = { ...project.arp, ...palette.arp };
    project.pad = { ...project.pad, ...palette.pad };
    applyPadProgression(project.pad, palette.progression, project.scale);
    project.bass.automation.cutoff = curve(
      palette.bassSweep,
      normalizedBassValue(project.bass, "cutoff"),
    );
    project.bass.automation.pulse = curve(palette.bassPulse);
    project.keys.automation.motion = curve(palette.textureMotion);
    const hat = project.drums.find((drum) => drum.id === "hat");
    if (hat) {
      hat.automation.volume = curve(palette.hatLevels, hat.volume, true);
      hat.automation.pan = curve(palette.hatPan);
    }
  }
  return withScale(project, preset.scale);
}
