import { createProject, STEP_COUNT, withScale } from "./model";
import type { BassStep, DrumId, MusicalScale, Project } from "./model";

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
];

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
    sound: preset.texture.sound,
    tone: preset.texture.tone,
    decay: preset.texture.decay,
    space: preset.texture.space,
    volume: preset.texture.volume,
    muted: false,
    steps: noteSteps(preset.texture),
  };
  return withScale(project, preset.scale);
}
