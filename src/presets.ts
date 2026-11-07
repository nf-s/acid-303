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
    name: "Sunday Socks",
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
    name: "Pocket Disco",
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
    name: "Little Machine",
    genre: "Techno",
    scale: { root: 5, mode: "minor" },
    bpm: 132,
    swing: 0.02,
    drive: 0.2,
    drums: {
      kick: { hits: [0, 4, 8, 12], sound: 2, decay: 0.24, volume: 0.76 },
      snare: { hits: [4, 12], sound: 1, decay: 0.13, volume: 0.35 },
      hat: {
        hits: [0, 2, 4, 6, 8, 10, 12, 14],
        sound: 4,
        decay: 0.11,
        volume: 0.25,
      },
      clap: { hits: [12], sound: 2, decay: 0.13, volume: 0.27 },
      rim: { hits: [2, 5, 8, 11, 14], sound: 2, decay: 0.04, volume: 0.34 },
    },
    bass: {
      shape: 0.55,
      drive: 0.2,
      sound: 2,
      root: 29,
      notes: [0, 0, 0, 7, 0, 0, 12, 0, 0, 0, 0, 7, 0, 3, 0, 0],
      hits: [0, 2, 3, 5, 6, 8, 10, 11, 13, 14],
      accents: [0, 6, 11],
      slides: [2, 10],
      waveform: "sawtooth",
      cutoff: 540,
      resonance: 10,
      envelope: 0.4,
      decay: 0.14,
      volume: 0.37,
    },
    texture: {
      root: 53,
      notes: [0, 0, 0, 7, 0, 0, 0, 3, 0, 0, 0, 7, 0, 0, 0, 3],
      hits: [1, 4, 7, 10, 13],
      accents: [7, 13],
      slides: [],
      sound: 3,
      tone: 0.46,
      decay: 0.2,
      space: 0.3,
      volume: 0.28,
    },
  },
  {
    id: "driving-techno",
    name: "Night Train",
    genre: "Driving techno",
    scale: { root: 2, mode: "phrygian" },
    bpm: 142,
    swing: 0,
    drive: 0.24,
    drums: {
      kick: { hits: [0, 4, 8, 12], sound: 1, decay: 0.25, volume: 0.88 },
      snare: { hits: [4, 12, 15], sound: 3, decay: 0.12, volume: 0.4 },
      hat: {
        hits: [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15],
        sound: 4,
        decay: 0.085,
        volume: 0.3,
      },
      clap: { hits: [4, 12], sound: 4, decay: 0.07, volume: 0.28 },
      rim: { hits: [1, 5, 9, 13], sound: 4, decay: 0.045, volume: 0.3 },
    },
    bass: {
      shape: 0.8,
      drive: 0.4,
      sound: 3,
      root: 38,
      notes: [0, 0, 1, 0, 0, 7, 0, 0, 0, 0, 1, 0, 0, 7, 3, 0],
      hits: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      accents: [0, 3, 6, 10, 13],
      slides: [1, 5, 9, 13],
      waveform: "sawtooth",
      cutoff: 840,
      resonance: 12,
      envelope: 0.5,
      decay: 0.1,
      volume: 0.34,
    },
    texture: {
      root: 62,
      notes: [0, 0, 0, 0, 7, 7, 7, 7, 0, 0, 0, 0, 3, 3, 3, 3],
      hits: [2, 6, 10, 14],
      accents: [6, 14],
      slides: [],
      sound: 0,
      tone: 0.55,
      decay: 0.1,
      space: 0.24,
      volume: 0.27,
    },
  },
  {
    id: "melodic-techno",
    name: "Moon Jelly",
    genre: "Melodic techno",
    scale: { root: 9, mode: "minor" },
    bpm: 122,
    swing: 0.03,
    drive: 0.08,
    drums: {
      kick: { hits: [0, 4, 8, 12], sound: 3, decay: 0.3, volume: 0.84 },
      snare: { hits: [12], sound: 4, decay: 0.19, volume: 0.2 },
      hat: { hits: [2, 6, 10, 14], sound: 1, decay: 0.07, volume: 0.25 },
      clap: { hits: [4, 12], sound: 3, decay: 0.2, volume: 0.36 },
      rim: { hits: [7, 15], sound: 3, decay: 0.075, volume: 0.19 },
    },
    bass: {
      shape: 0.3,
      drive: 0.08,
      sound: 4,
      root: 33,
      notes: [0, 0, 7, 0, 0, 0, 7, 0, 8, 8, 3, 8, 5, 5, 7, 5],
      hits: [0, 3, 6, 8, 11, 12, 14],
      accents: [0, 8],
      slides: [],
      waveform: "square",
      cutoff: 390,
      resonance: 3,
      envelope: 0.22,
      decay: 0.25,
      volume: 0.39,
    },
    texture: {
      root: 57,
      notes: [0, 7, 12, 15, 12, 7, 3, 7, 8, 15, 12, 8, 5, 12, 7, 3],
      hits: [0, 2, 3, 5, 6, 8, 10, 11, 13, 14],
      accents: [0, 8],
      slides: [2, 10],
      sound: 2,
      tone: 0.31,
      decay: 0.47,
      space: 0.48,
      volume: 0.23,
    },
  },
  {
    id: "atmospheric-techno",
    name: "Cloud Goblin",
    genre: "Experimental atmospheric techno",
    scale: { root: 2, mode: "pentatonic" },
    bpm: 114,
    swing: 0.12,
    drive: 0.13,
    drums: {
      kick: { hits: [0, 6, 10], sound: 3, decay: 0.37, volume: 0.73 },
      snare: { hits: [7, 14], sound: 4, decay: 0.33, volume: 0.26 },
      hat: { hits: [2, 5, 8, 11, 15], sound: 3, decay: 0.11, volume: 0.24 },
      clap: { hits: [12], sound: 3, decay: 0.35, volume: 0.24 },
      rim: { hits: [3, 9, 13], sound: 4, decay: 0.14, volume: 0.27 },
    },
    bass: {
      shape: 0.2,
      drive: 0,
      sound: 5,
      root: 38,
      notes: [0, 0, 0, 7, 7, 7, 0, 0, 10, 10, 10, 7, 3, 3, 0, 0],
      hits: [0, 3, 6, 10, 13],
      accents: [0, 10],
      slides: [],
      waveform: "square",
      cutoff: 300,
      resonance: 4,
      envelope: 0.18,
      decay: 0.35,
      volume: 0.32,
    },
    texture: {
      root: 62,
      notes: [0, 0, 7, 7, 12, 12, 10, 10, 7, 7, 3, 3, 0, 0, 10, 7],
      hits: [1, 4, 8, 11, 14, 15],
      accents: [4],
      slides: [14],
      sound: 5,
      tone: 0.3,
      decay: 1.35,
      space: 0.7,
      volume: 0.24,
    },
  },
  {
    id: "garage",
    name: "Velvet Steps",
    genre: "Garage",
    scale: { root: 7, mode: "minor" },
    bpm: 132,
    swing: 0.25,
    drive: 0.09,
    drums: {
      kick: { hits: [0, 6, 9, 14], sound: 3, decay: 0.23, volume: 0.86 },
      snare: { hits: [4, 12], sound: 1, decay: 0.16, volume: 0.48 },
      hat: {
        hits: [0, 2, 3, 6, 8, 10, 11, 14, 15],
        sound: 0,
        decay: 0.05,
        volume: 0.32,
      },
      clap: { hits: [4, 12], sound: 4, decay: 0.1, volume: 0.31 },
      rim: { hits: [3, 7, 10, 15], sound: 3, decay: 0.05, volume: 0.25 },
    },
    bass: {
      shape: 0.68,
      drive: 0.18,
      sound: 6,
      root: 31,
      notes: [0, 0, 7, 0, 0, 3, 7, 0, 0, 0, 10, 7, 0, 0, 3, 7],
      hits: [0, 2, 5, 7, 9, 10, 14, 15],
      accents: [0, 9, 14],
      slides: [9, 14],
      waveform: "square",
      cutoff: 390,
      resonance: 4,
      envelope: 0.32,
      decay: 0.22,
      volume: 0.43,
    },
    texture: {
      root: 55,
      notes: [0, 0, 0, 3, 3, 3, 7, 7, 0, 0, 0, 3, 3, 3, 7, 7],
      hits: [2, 7, 10, 15],
      accents: [7],
      slides: [],
      sound: 4,
      tone: 0.4,
      decay: 0.25,
      space: 0.3,
      volume: 0.27,
    },
  },
  {
    id: "speed-garage",
    name: "Turbo Biscuit",
    genre: "Speed garage",
    scale: { root: 5, mode: "minor" },
    bpm: 138,
    swing: 0.21,
    drive: 0.2,
    drums: {
      kick: { hits: [0, 4, 8, 12, 15], sound: 3, decay: 0.24, volume: 0.87 },
      snare: { hits: [4, 12], sound: 3, decay: 0.14, volume: 0.46 },
      hat: {
        hits: [2, 3, 6, 7, 10, 11, 14, 15],
        sound: 1,
        decay: 0.045,
        volume: 0.29,
      },
      clap: { hits: [4, 12], sound: 1, decay: 0.12, volume: 0.3 },
      rim: { hits: [1, 6, 9, 14], sound: 4, decay: 0.045, volume: 0.25 },
    },
    bass: {
      shape: 0.75,
      drive: 0.28,
      sound: 7,
      root: 29,
      notes: [0, 0, 12, 7, 0, 0, 3, 7, 0, 0, 12, 10, 0, 0, 7, 3],
      hits: [0, 1, 2, 5, 6, 7, 8, 9, 10, 13, 14, 15],
      accents: [0, 6, 8, 14],
      slides: [1, 6, 9, 14],
      waveform: "square",
      cutoff: 680,
      resonance: 7,
      envelope: 0.55,
      decay: 0.19,
      volume: 0.42,
    },
    texture: {
      root: 53,
      notes: [0, 0, 0, 7, 7, 7, 0, 0, 0, 0, 0, 3, 3, 3, 0, 0],
      hits: [3, 7, 11, 15],
      accents: [7, 15],
      slides: [],
      sound: 2,
      tone: 0.43,
      decay: 0.13,
      space: 0.36,
      volume: 0.25,
    },
  },
  {
    id: "jungle",
    name: "Jungle Gym",
    genre: "Jungle",
    scale: { root: 2, mode: "minor" },
    bpm: 168,
    swing: 0.05,
    drive: 0.17,
    drums: {
      kick: { hits: [0, 6, 8, 11], sound: 1, decay: 0.14, volume: 0.78 },
      snare: { hits: [4, 7, 10, 12, 15], sound: 3, decay: 0.13, volume: 0.47 },
      hat: {
        hits: [0, 2, 3, 4, 6, 8, 9, 10, 11, 12, 14, 15],
        sound: 3,
        decay: 0.045,
        volume: 0.29,
      },
      clap: { hits: [12], sound: 4, decay: 0.06, volume: 0.2 },
      rim: { hits: [1, 5, 9, 13], sound: 0, decay: 0.035, volume: 0.18 },
    },
    bass: {
      shape: 0.7,
      drive: 0.22,
      sound: 8,
      root: 26,
      notes: [0, 0, 0, 7, 0, 0, 3, 3, 0, 0, 0, 10, 7, 7, 3, 0],
      hits: [0, 1, 6, 8, 9, 12, 14],
      accents: [0, 8],
      slides: [0, 8],
      waveform: "square",
      cutoff: 250,
      resonance: 1.8,
      envelope: 0.2,
      decay: 0.27,
      volume: 0.46,
    },
    texture: {
      root: 62,
      notes: [0, 0, 0, 7, 7, 7, 0, 0, 10, 10, 10, 7, 7, 7, 3, 3],
      hits: [0, 7, 10, 15],
      accents: [10],
      slides: [],
      sound: 1,
      tone: 0.3,
      decay: 0.68,
      space: 0.5,
      volume: 0.23,
    },
  },
  {
    id: "bass-house",
    name: "Switchback",
    genre: "Bass house",
    scale: { root: 5, mode: "minor" },
    bpm: 128,
    swing: 0.03,
    drive: 0.16,
    drums: {
      kick: { hits: [0, 4, 8, 12], sound: 1, decay: 0.19, volume: 0.88 },
      snare: { hits: [4, 12], sound: 2, decay: 0.09, volume: 0.25 },
      hat: {
        hits: [2, 3, 6, 7, 10, 11, 14, 15],
        sound: 0,
        decay: 0.055,
        volume: 0.4,
      },
      clap: { hits: [4, 12], sound: 4, decay: 0.12, volume: 0.52 },
      rim: { hits: [5, 13, 15], sound: 2, decay: 0.04, volume: 0.2 },
    },
    bass: {
      shape: 0.91,
      drive: 0.42,
      sound: 6,
      root: 29,
      notes: [0, 0, 12, 0, 0, 7, 0, 3, 0, 0, 12, 7, 0, 0, 3, 0],
      hits: [0, 2, 3, 6, 7, 8, 10, 11, 14, 15],
      accents: [0, 6, 8, 14],
      slides: [2, 10],
      waveform: "square",
      cutoff: 980,
      resonance: 5,
      envelope: 0.8,
      decay: 0.16,
      volume: 0.45,
    },
    texture: {
      root: 65,
      notes: [0, 0, 0, 0, 7, 7, 7, 7, 0, 0, 0, 0, 3, 3, 3, 3],
      hits: [1, 9],
      accents: [9],
      slides: [],
      sound: 2,
      tone: 0.46,
      decay: 0.14,
      space: 0.14,
      volume: 0.24,
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
    arp: {
      muted: false,
      sound: 3,
      notes: [57, 64, 69],
      direction: "up",
      rate: "1/16",
      steps: pattern([2, 5, 8, 11, 14]),
      shape: 0.52,
      resonance: 0.62,
      gate: 0.35,
      decay: 0.17,
      tone: 0.29,
      space: 0.25,
      volume: 0.14,
    },
    pad: {
      muted: false,
      sound: 5,
      bars: 4,
      attack: 0.55,
      release: 0.42,
      tone: 0.23,
      motion: 0.35,
      volume: 0.12,
    },
    progression: "suspended",
    bassSweep: [-0.18, -0.08, 0.04, 0.16, -0.12, 0, 0.2, 0.06],
    bassPulse: [0.58, 0.44, 0.55, 0.4],
    hatLevels: [0.65, 0.7, 1, 0.8],
    hatPan: [0.46, 0.53, 0.48, 0.55],
    textureMotion: [0.3, 0.1, 0.45, 0.16],
  },
  "driving-techno": {
    arp: {
      muted: false,
      sound: 1,
      notes: [62, 65, 69],
      direction: "updown",
      rate: "1/16",
      gate: 0.28,
      decay: 0.11,
      tone: 0.5,
      shape: 0.7,
      width: 0.35,
      space: 0.1,
      volume: 0.13,
    },
    pad: {
      muted: true,
      sound: 5,
      bars: 4,
      attack: 0.4,
      release: 0.3,
      tone: 0.2,
      volume: 0.12,
    },
    progression: "descent",
    bassSweep: [-0.03, 0.1, -0.04, 0.18],
    bassPulse: [0.56, 0.65, 0.48, 0.72],
    hatLevels: [0.72, 0.62, 1, 0.78],
    hatPan: [0.35, 0.6, 0.4, 0.65],
    textureMotion: [0.38, 0.6, 0.22, 0.5],
  },
  "melodic-techno": {
    arp: {
      muted: false,
      sound: 0,
      notes: [60, 63, 67, 70],
      direction: "updown",
      rate: "1/16",
      octaves: 2,
      gate: 0.55,
      decay: 0.28,
      tone: 0.46,
      shape: 0.3,
      width: 0.6,
      space: 0.5,
      volume: 0.2,
    },
    pad: {
      muted: false,
      sound: 2,
      bars: 8,
      attack: 0.38,
      release: 0.48,
      tone: 0.46,
      motion: 0.25,
      spread: 0.76,
      space: 0.4,
      volume: 0.21,
    },
    progression: "rise",
    bassSweep: [-0.08, -0.04, 0, 0.05, 0.08, 0.04, -0.02, -0.04],
    bassPulse: [0.52, 0.58, 0.62, 0.56],
    hatLevels: [0.5, 0.7, 1, 0.65],
    hatPan: [0.36, 0.43, 0.64, 0.57],
    textureMotion: [0.12, 0.2, 0.3, 0.18],
  },
  "atmospheric-techno": {
    arp: {
      muted: false,
      sound: 2,
      notes: [59, 62, 66, 69],
      direction: "random",
      rate: "1/8",
      octaves: 2,
      steps: pattern([0, 6, 10, 14]),
      seed: 4117,
      gate: 0.82,
      decay: 0.6,
      tone: 0.35,
      shape: 0.18,
      width: 0.85,
      space: 0.7,
      volume: 0.12,
    },
    pad: {
      muted: false,
      sound: 1,
      bars: 16,
      attack: 0.72,
      release: 0.66,
      tone: 0.32,
      motion: 0.46,
      spread: 0.88,
      space: 0.65,
      volume: 0.25,
    },
    progression: "drift",
    bassSweep: [-0.12, -0.1, -0.06, -0.02, 0.03, 0.06, 0, -0.08],
    bassPulse: [0.65, 0.7, 0.8, 0.72],
    hatLevels: [0.45, 0.7, 0.85, 0.5],
    hatPan: [0.2, 0.4, 0.8, 0.6],
    textureMotion: [0.18, 0.34, 0.48, 0.26],
  },
  garage: {
    arp: {
      muted: false,
      sound: 4,
      notes: [65, 72, 68, 75],
      direction: "played",
      rate: "1/16",
      steps: pattern([1, 3, 6, 9, 11, 14]),
      gate: 0.25,
      decay: 0.13,
      tone: 0.38,
      shape: 0.3,
      width: 0.45,
      space: 0.18,
      volume: 0.16,
    },
    pad: {
      muted: false,
      sound: 0,
      bars: 4,
      attack: 0.12,
      release: 0.3,
      tone: 0.4,
      space: 0.28,
      volume: 0.14,
    },
    progression: "return",
    bassSweep: [0.12, -0.1, 0.2, -0.04, 0.04, -0.12, 0.16, -0.02],
    bassPulse: [0.3, 0.65, 0.4, 0.72],
    hatLevels: [0.65, 0.4, 1, 0.58],
    hatPan: [0.3, 0.57, 0.7, 0.43],
    textureMotion: [0.08, 0.24, 0.04, 0.3],
  },
  "speed-garage": {
    arp: {
      muted: false,
      sound: 1,
      notes: [55, 62, 67],
      direction: "down",
      rate: "1/8",
      steps: pattern([2, 6, 10, 14]),
      gate: 0.2,
      decay: 0.08,
      tone: 0.34,
      shape: 0.72,
      width: 0.4,
      space: 0.12,
      volume: 0.13,
    },
    pad: {
      muted: false,
      sound: 3,
      bars: 4,
      attack: 0.24,
      release: 0.23,
      tone: 0.28,
      space: 0.35,
      volume: 0.1,
    },
    progression: "descent",
    bassSweep: [0.18, 0.04, -0.1, 0.12, 0.24, 0.06, -0.08, 0.16],
    bassPulse: [0.72, 0.4, 0.65, 0.35],
    hatLevels: [0.65, 0.55, 1, 0.75],
    hatPan: [0.33, 0.62, 0.67, 0.38],
    textureMotion: [0.22, 0.45, 0.12, 0.4],
  },
  jungle: {
    arp: {
      muted: false,
      sound: 5,
      notes: [62, 65, 69],
      direction: "random",
      rate: "1/16T",
      octaves: 2,
      steps: pattern([3, 7, 10, 15]),
      seed: 821,
      gate: 0.35,
      decay: 0.13,
      tone: 0.45,
      shape: 0.5,
      width: 0.65,
      space: 0.36,
      volume: 0.14,
    },
    pad: {
      muted: false,
      sound: 4,
      bars: 8,
      attack: 0.5,
      release: 0.5,
      tone: 0.36,
      motion: 0.3,
      spread: 0.8,
      space: 0.6,
      volume: 0.15,
    },
    progression: "orbit",
    bassSweep: [-0.08, 0.08, -0.12, 0.16],
    bassPulse: [0.72, 0.6, 0.68, 0.45],
    hatLevels: [0.85, 0.35, 0.68, 0.5, 1, 0.45, 0.7, 0.3],
    hatPan: [0.28, 0.65, 0.44, 0.72],
    textureMotion: [0.28, 0.08, 0.4, 0.18],
  },
  "bass-house": {
    arp: {
      muted: false,
      sound: 1,
      notes: [65, 68, 72],
      direction: "up",
      rate: "1/16",
      steps: pattern([3, 7, 11, 15]),
      gate: 0.32,
      decay: 0.09,
      tone: 0.5,
      shape: 0.8,
      width: 0.25,
      space: 0.12,
      volume: 0.13,
    },
    pad: {
      muted: true,
      sound: 5,
      bars: 2,
      attack: 0.08,
      release: 0.16,
      tone: 0.3,
      volume: 0.1,
    },
    progression: "suspended",
    bassSweep: [-0.18, 0.12, 0.25, -0.08, -0.12, 0.2, 0.3, -0.04],
    bassPulse: [0.32, 0.58, 0.7, 0.38],
    hatLevels: [0.6, 0.5, 1, 0.65],
    hatPan: [0.42, 0.56, 0.58, 0.44],
    textureMotion: [0.08, 0.32, 0.12, 0.4],
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
    muted: false,
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
    muted: false,
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
