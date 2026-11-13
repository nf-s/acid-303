import type {
  FilterSpec,
  FormantSpec,
  RackSettings,
  VoiceSpec,
} from "./fluff-synth";

/**
 * Fluff's melodic patches. Each patch turns the instrument's controls into a
 * voice description and rack settings for one note. Controls are normalised
 * so every patch stays musical across its whole range.
 */
export interface MelodicControls {
  /** 0–1 brightness. */
  tone: number;
  /** Seconds; the length of the sound's decay or release. */
  decay: number;
  /** Seconds of amp attack requested by the player. */
  attack: number;
  /** 0–1 filter resonance. */
  resonance: number;
  /** 0–1 patch-specific colour (detune, FM depth, layer balance). */
  shape: number;
  /** 0–1 stereo width. */
  width: number;
  /** 0–1 vibrato and slow movement. */
  motion: number;
  /** 0–1 drive. */
  grit: number;
}

export interface Patch {
  voice(controls: MelodicControls): VoiceSpec;
  rack(controls: MelodicControls): RackSettings;
  /** Scale steps stacked above the note (house stabs). */
  chord?: readonly number[];
}

const clamp = (value: number, low = 0, high = 1): number =>
  Math.max(low, Math.min(high, value));
/** Exponential map from 0–1 onto a frequency range. */
const sweep = (value: number, low: number, high: number): number =>
  low * (high / low) ** clamp(value);

function lowpass(
  cutoff: number,
  options: Partial<FilterSpec> = {},
): FilterSpec {
  return {
    type: "lowpass",
    poles: 4,
    cutoff,
    keyTrack: 0.5,
    resonance: 0,
    envelope: 0,
    envAttack: 0,
    envDecay: 0.3,
    envSustain: 0,
    ...options,
  };
}

function rack(options: Partial<RackSettings> = {}): RackSettings {
  return {
    drive: 0,
    chorus: 0.2,
    vibrato: 0,
    vibratoDelay: 0.25,
    filterLfo: 0,
    wander: 3,
    phaser: 0,
    ...options,
  };
}

/** Vowel formants (F1–F3) from "oo" through "oh", "ah", "eh" to "ee". */
const VOWELS: ReadonlyArray<readonly [number, number, number]> = [
  [320, 800, 2500],
  [480, 900, 2600],
  [760, 1200, 2700],
  [560, 1700, 2600],
  [330, 2100, 2900],
];
function vowel(position: number): [number, number, number] {
  const scaled = clamp(position) * (VOWELS.length - 1);
  const lower = Math.min(VOWELS.length - 2, Math.floor(scaled));
  const fraction = scaled - lower;
  const first = VOWELS[lower] ?? [760, 1200, 2700];
  const second = VOWELS[lower + 1] ?? first;
  return [
    first[0] + (second[0] - first[0]) * fraction,
    first[1] + (second[1] - first[1]) * fraction,
    first[2] + (second[2] - first[2]) * fraction,
  ];
}
function formant(
  position: number,
  from: number,
  q: number,
  glide = 0.09,
): FormantSpec {
  return {
    frequencies: vowel(position),
    from: vowel(from),
    gains: [1, 0.7, 0.32],
    q,
    glide,
  };
}

// ---------------------------------------------------------------- Leads

/** Wide, bright trance and Porter Robinson lead: seven detuned saws an octave over three more. */
const supersawLead: Patch = {
  voice: (c) => ({
    layers: [
      {
        kind: "osc",
        wave: "saw",
        ratio: 1,
        voices: 7,
        detune: 12 + c.width * 26,
        center: 0.8,
        spread: true,
        level: 1,
      },
      {
        kind: "osc",
        wave: "saw",
        ratio: 2,
        voices: 3,
        detune: 9 + c.width * 8,
        spread: true,
        level: 0.22,
      },
    ],
    filter: lowpass(sweep(c.tone, 900, 11000), {
      keyTrack: 0.4,
      resonance: 1,
      envelope: 1.1,
      envAttack: 0.004,
      envDecay: 0.18 + c.decay * 0.3,
      envSustain: 0.35,
      lfo: 1,
    }),
    amp: {
      attack: Math.max(0.006, c.attack),
      decay: 0.35,
      sustain: 0.85,
      release: 0.08 + c.decay * 0.55,
    },
    drift: 3,
    wander: true,
    level: 0.5,
  }),
  rack: (c) =>
    rack({
      drive: 0.12 + c.grit * 0.88,
      chorus: 0.18,
      vibrato: c.motion * 16,
      vibratoDelay: 0.28,
      filterLfo: c.motion * 700,
    }),
};

/** Progressive house pluck: five saws over an octave-down square, a fast 24 dB filter fall. */
const pluckLead: Patch = {
  voice: (c) => ({
    layers: [
      {
        kind: "osc",
        wave: "saw",
        ratio: 1,
        voices: 5,
        detune: 6 + c.width * 11,
        spread: true,
        level: 1,
      },
      {
        kind: "osc",
        wave: "square",
        ratio: 0.5,
        voices: 1,
        detune: 0,
        spread: false,
        level: 0.32,
      },
    ],
    filter: lowpass(sweep(c.tone, 260, 3200), {
      keyTrack: 0.6,
      resonance: 3,
      envelope: 3.2,
      envDecay: 0.06 + c.decay * 0.45,
      envSustain: 0,
      lfo: 1,
    }),
    amp: {
      attack: Math.max(0.003, c.attack),
      decay: 0.12 + c.decay * 1.5,
      sustain: 0,
      release: 0.12,
    },
    drift: 2.5,
    wander: true,
    level: 0.62,
  }),
  rack: (c) =>
    rack({
      drive: 0.1 + c.grit * 0.9,
      chorus: 0.12,
      vibrato: c.motion * 10,
      filterLfo: c.motion * 400,
    }),
};

/** Soft FM bell: a mellow tine body, an inharmonic shimmer and a faster high partial. */
const bellLead: Patch = {
  voice: (c) => ({
    layers: [
      {
        kind: "fm",
        ratio: 1,
        modRatio: 1,
        index: 0.6 + c.tone * 1.1,
        indexFall: 0.6,
        indexHold: 0.2,
        level: 0.75,
        pan: -0.25 * c.width,
      },
      {
        kind: "fm",
        ratio: 1,
        modRatio: 3.5,
        index: 0.3 + c.tone * 0.9,
        indexFall: 0.25,
        indexHold: 0.08,
        level: 0.4,
        pan: 0.25 * c.width,
        cents: 4,
      },
      {
        kind: "osc",
        wave: "sine",
        ratio: 4,
        voices: 1,
        detune: 0,
        spread: false,
        level: 0.12,
        fall: 0.15 + c.decay * 0.3,
        hold: 0,
      },
    ],
    filter: lowpass(sweep(c.tone, 1400, 12000), {
      poles: 2,
      keyTrack: 1,
    }),
    amp: {
      attack: Math.max(0.0015, c.attack),
      decay: 0.4 + c.decay * 2.6,
      sustain: 0,
      release: 0.45,
    },
    drift: 1.5,
    wander: false,
    level: 0.5,
  }),
  rack: (c) =>
    rack({
      drive: c.grit * 0.7,
      chorus: 0.3,
      vibrato: c.motion * 8,
      vibratoDelay: 0.4,
    }),
};

/**
 * House piano: a hollow two-oscillator body, an FM hammer that brightens the
 * first moment and a felt thump; the filter closes as the note decays.
 */
const pianoLead: Patch = {
  voice: (c) => ({
    layers: [
      {
        kind: "osc",
        wave: "hollow",
        ratio: 1,
        voices: 2,
        detune: 3 + c.width * 3,
        spread: true,
        level: 0.55,
      },
      {
        kind: "fm",
        ratio: 1,
        modRatio: 1,
        index: 2.4,
        indexFall: 0.18,
        indexHold: 0.15,
        level: 0.7,
        pan: 0,
      },
      {
        kind: "osc",
        wave: "sine",
        ratio: 2,
        voices: 1,
        detune: 0,
        spread: false,
        level: 0.25,
        cents: 2,
        fall: 0.5,
        hold: 0.3,
      },
      {
        kind: "noise",
        filter: "bandpass",
        frequency: 2600,
        fixed: true,
        q: 0.9,
        level: 0.6,
        fall: 0.025,
        hold: 0,
      },
    ],
    filter: lowpass(sweep(c.tone, 700, 6500), {
      poles: 2,
      keyTrack: 0.8,
      envelope: 2,
      envDecay: 0.35,
      envSustain: 0.15,
    }),
    amp: {
      attack: Math.max(0.0015, c.attack),
      decay: 0.5 + c.decay * 2.6,
      sustain: 0,
      release: 0.16,
    },
    drift: 1,
    wander: false,
    level: 0.62,
  }),
  rack: (c) =>
    rack({
      drive: 0.15 + c.grit * 0.85,
      chorus: 0.28,
      vibrato: c.motion * 6,
      vibratoDelay: 0.3,
    }),
};

/** House organ stab: drawbar organ chords with key click and third-harmonic percussion. */
const organLead: Patch = {
  chord: [2, 4],
  voice: (c) => ({
    layers: [
      {
        kind: "osc",
        wave: "organ",
        ratio: 1,
        voices: 2,
        detune: 3,
        spread: true,
        level: 1,
      },
      {
        kind: "osc",
        wave: "sine",
        ratio: 3,
        voices: 1,
        detune: 0,
        spread: false,
        level: 0.45,
        fall: 0.18,
        hold: 0,
      },
      {
        kind: "noise",
        filter: "bandpass",
        frequency: 3200,
        fixed: true,
        q: 1.2,
        level: 0.5,
        fall: 0.008,
        hold: 0,
      },
    ],
    filter: lowpass(sweep(c.tone, 1300, 9000), {
      poles: 2,
      keyTrack: 0.4,
      envelope: 0.4,
      envDecay: 0.12,
    }),
    amp: {
      attack: Math.max(0.003, c.attack),
      decay: 0.08 + c.decay * 0.35,
      sustain: 0.55,
      release: 0.05 + c.decay * 0.18,
    },
    drift: 0.5,
    wander: false,
    level: 0.42,
  }),
  rack: (c) =>
    rack({
      drive: 0.25 + c.grit * 0.75,
      chorus: 0.4,
      vibrato: c.motion * 12,
      vibratoDelay: 0.05,
      wander: 0,
    }),
};

/** Analog square lead: two pulses and a square through a resonant 24 dB filter, delayed vibrato. */
const squareLead: Patch = {
  voice: (c) => ({
    layers: [
      {
        kind: "osc",
        wave: "pulse",
        ratio: 1,
        voices: 2,
        detune: 4 + c.width * 9,
        spread: true,
        level: 1,
      },
      {
        kind: "osc",
        wave: "square",
        ratio: 1,
        voices: 1,
        detune: 0,
        spread: false,
        level: 0.55,
        cents: -4,
      },
    ],
    filter: lowpass(sweep(c.tone, 550, 7000), {
      keyTrack: 0.7,
      resonance: 3,
      envelope: 1.6,
      envDecay: 0.12 + c.decay * 0.3,
      envSustain: 0.3,
      lfo: 1,
    }),
    amp: {
      attack: Math.max(0.004, c.attack),
      decay: 0.25,
      sustain: 0.8,
      release: 0.06 + c.decay * 0.4,
    },
    drift: 3,
    wander: true,
    level: 0.5,
  }),
  rack: (c) =>
    rack({
      drive: 0.15 + c.grit * 0.85,
      chorus: 0.15,
      vibrato: 4 + c.motion * 22,
      vibratoDelay: 0.32,
      filterLfo: c.motion * 300,
    }),
};

/** Mellow lead: triangles with a little saw edge through a gentle 12 dB filter. */
const softLead: Patch = {
  voice: (c) => ({
    layers: [
      {
        kind: "osc",
        wave: "triangle",
        ratio: 1,
        voices: 3,
        detune: 5 + c.width * 9,
        spread: true,
        level: 1,
      },
      {
        kind: "osc",
        wave: "saw",
        ratio: 1,
        voices: 2,
        detune: 8 + c.width * 6,
        spread: true,
        level: 0.12 + c.tone * 0.4,
      },
      {
        kind: "osc",
        wave: "sine",
        ratio: 2,
        voices: 1,
        detune: 0,
        spread: false,
        level: 0.12,
      },
    ],
    filter: lowpass(sweep(c.tone, 600, 6000), {
      poles: 2,
      keyTrack: 0.7,
      envelope: 0.9,
      envAttack: 0.01,
      envDecay: 0.3 + c.decay * 0.3,
      envSustain: 0.3,
      lfo: 1,
    }),
    amp: {
      attack: Math.max(0.012, c.attack),
      decay: 0.3,
      sustain: 0.82,
      release: 0.12 + c.decay * 0.5,
    },
    drift: 3,
    wander: true,
    level: 0.58,
  }),
  rack: (c) =>
    rack({
      drive: 0.1 + c.grit * 0.9,
      chorus: 0.35,
      vibrato: 3 + c.motion * 18,
      vibratoDelay: 0.35,
      filterLfo: c.motion * 350,
    }),
};

/** Vocal lead: saws and a pulse through moving vowel formants with breath. Tone opens the vowel. */
const voiceLead: Patch = {
  voice: (c) => ({
    layers: [
      {
        kind: "osc",
        wave: "saw",
        ratio: 1,
        voices: 3,
        detune: 5 + c.width * 8,
        spread: true,
        level: 1,
      },
      {
        kind: "osc",
        wave: "pulse",
        ratio: 1,
        voices: 1,
        detune: 0,
        spread: false,
        level: 0.5,
      },
      {
        kind: "noise",
        filter: "bandpass",
        frequency: 2800,
        fixed: true,
        q: 0.8,
        level: 0.12 + c.grit * 0.15,
      },
    ],
    filter: lowpass(6500, { poles: 2, keyTrack: 0 }),
    formant: formant(0.15 + c.tone * 0.75, c.tone * 0.4, 5),
    amp: {
      attack: Math.max(0.025, c.attack),
      decay: 0.2,
      sustain: 0.9,
      release: 0.12 + c.decay * 0.5,
    },
    drift: 3,
    wander: true,
    level: 1.15,
  }),
  rack: (c) =>
    rack({
      drive: 0.1 + c.grit * 0.6,
      chorus: 0.35,
      vibrato: 7 + c.motion * 26,
      vibratoDelay: 0.22,
    }),
};

/** Lead slots: Supersaw, Pluck, Bell, Piano, Organ, Square, Soft, Voice. */
export const FLUFF_LEAD_PATCHES: readonly Patch[] = [
  supersawLead,
  pluckLead,
  bellLead,
  pianoLead,
  organLead,
  squareLead,
  softLead,
  voiceLead,
];
/** Per-slot trims measured so lead patches play at matching loudness. */
export const FLUFF_LEAD_LEVELS: readonly number[] = [
  0.239, 0.247, 0.211, 0.151, 0.276, 0.16, 0.161, 0.197,
];

// ---------------------------------------------------------------- Arps

const pluckArp: Patch = {
  voice: (c) => ({
    layers: [
      {
        kind: "osc",
        wave: "saw",
        ratio: 1,
        voices: 3,
        detune: 4 + c.shape * 12,
        spread: true,
        level: 1,
      },
      {
        kind: "osc",
        wave: "square",
        ratio: 0.5,
        voices: 1,
        detune: 0,
        spread: false,
        level: 0.1 + c.shape * 0.3,
      },
    ],
    filter: lowpass(sweep(c.tone, 300, 3800), {
      keyTrack: 0.6,
      resonance: c.resonance * 9,
      envelope: 2.6 + c.shape * 1.2,
      envDecay: 0.03 + c.decay * 0.5,
    }),
    amp: {
      attack: 0.0025,
      decay: 0.06 + c.decay * 1.5,
      sustain: 0,
      release: 0.08,
    },
    drift: 2,
    wander: false,
    level: 0.6,
  }),
  rack: () => rack({ drive: 0.12, chorus: 0.15, wander: 0 }),
};

const superArp: Patch = {
  voice: (c) => ({
    layers: [
      {
        kind: "osc",
        wave: "saw",
        ratio: 1,
        voices: 7,
        detune: 10 + c.shape * 30,
        center: 0.8,
        spread: true,
        level: 1,
      },
    ],
    filter: lowpass(sweep(c.tone, 800, 10000), {
      keyTrack: 0.4,
      resonance: c.resonance * 7,
      envelope: 1.4,
      envDecay: 0.03 + c.decay * 0.4,
      envSustain: 0.25,
    }),
    amp: {
      attack: 0.002,
      decay: 0.05 + c.decay * 0.8,
      sustain: 0.5,
      release: 0.04 + c.decay * 0.15,
    },
    drift: 2,
    wander: false,
    level: 0.5,
  }),
  rack: () => rack({ drive: 0.15, chorus: 0.15, wander: 0 }),
};

const glassArp: Patch = {
  voice: (c) => ({
    layers: [
      {
        kind: "fm",
        ratio: 1,
        modRatio: 3,
        index: 0.5 + c.shape * 1.6,
        indexFall: 0.12,
        indexHold: 0.12,
        level: 0.8,
        pan: -0.2 * c.width,
      },
      {
        kind: "fm",
        ratio: 2,
        modRatio: 1,
        index: 0.3,
        indexFall: 0.3,
        indexHold: 0.2,
        level: 0.22,
        pan: 0.3 * c.width,
        cents: 3,
        fall: 0.1 + c.decay * 0.6,
        hold: 0.2,
      },
    ],
    filter: lowpass(sweep(c.tone, 1800, 14000), {
      poles: 2,
      keyTrack: 1,
      resonance: c.resonance * 4,
    }),
    amp: {
      attack: 0.0015,
      decay: 0.15 + c.decay * 2.6,
      sustain: 0,
      release: 0.3,
    },
    drift: 1,
    wander: false,
    level: 0.48,
  }),
  rack: () => rack({ drive: 0.05, chorus: 0.3, wander: 0 }),
};

/** Electric piano: an FM tine strike over a sine body, with chorus. */
const keysArp: Patch = {
  voice: (c) => ({
    layers: [
      {
        kind: "fm",
        ratio: 1,
        modRatio: 1,
        index: 1 + c.shape * 1.8,
        indexFall: 0.35,
        indexHold: 0.22,
        level: 0.7,
        pan: -0.15 * c.width,
      },
      {
        kind: "fm",
        ratio: 1,
        modRatio: 14,
        index: 0.25 + c.shape * 0.35,
        indexFall: 0.03,
        indexHold: 0,
        level: 0.35,
        pan: 0.15 * c.width,
        fall: 0.06,
        hold: 0.1,
      },
      {
        kind: "osc",
        wave: "sine",
        ratio: 1,
        voices: 1,
        detune: 0,
        spread: false,
        level: 0.45,
        cents: -2,
      },
    ],
    filter: lowpass(sweep(c.tone, 1000, 9000), {
      poles: 2,
      keyTrack: 0.8,
      resonance: c.resonance * 3,
      envelope: 1,
      envDecay: 0.2,
    }),
    amp: {
      attack: 0.0015,
      decay: 0.3 + c.decay * 2.4,
      sustain: 0,
      release: 0.22,
    },
    drift: 1.5,
    wander: false,
    level: 0.52,
  }),
  rack: () => rack({ drive: 0.2, chorus: 0.5, wander: 0 }),
};

/** Eighties pulse pluck: two narrow pulses through a resonant 24 dB filter. */
const pulseArp: Patch = {
  voice: (c) => ({
    layers: [
      {
        kind: "osc",
        wave: "pulse",
        ratio: 1,
        voices: 2,
        detune: 3 + c.shape * 12,
        spread: true,
        level: 1,
      },
      {
        kind: "osc",
        wave: "square",
        ratio: 1,
        voices: 1,
        detune: 0,
        spread: false,
        level: 0.2 + c.shape * 0.3,
        cents: 5,
      },
    ],
    filter: lowpass(sweep(c.tone, 380, 5000), {
      keyTrack: 0.6,
      resonance: c.resonance * 10,
      envelope: 2.4,
      envDecay: 0.04 + c.decay * 0.6,
      envSustain: 0.05,
    }),
    amp: {
      attack: 0.0025,
      decay: 0.06 + c.decay * 1.2,
      sustain: 0.12,
      release: 0.08 + c.decay * 0.3,
    },
    drift: 2,
    wander: false,
    level: 0.55,
  }),
  rack: () => rack({ drive: 0.18, chorus: 0.25, wander: 0 }),
};

/** Soft sine bell with a long ring: the quiet layer under future bass and J-pop leads. */
const dreamArp: Patch = {
  voice: (c) => ({
    layers: [
      {
        kind: "fm",
        ratio: 1,
        modRatio: 2,
        index: 0.4 + c.shape * 1.1,
        indexFall: 0.2,
        indexHold: 0.2,
        level: 0.8,
        pan: -0.2 * c.width,
      },
      {
        kind: "osc",
        wave: "triangle",
        ratio: 2,
        voices: 1,
        detune: 0,
        spread: false,
        level: 0.1 + c.shape * 0.25,
        cents: 4,
      },
      {
        kind: "osc",
        wave: "sine",
        ratio: 1,
        voices: 2,
        detune: 5,
        spread: true,
        level: 0.4,
      },
    ],
    filter: lowpass(sweep(c.tone, 1400, 11000), {
      poles: 2,
      keyTrack: 1,
      resonance: c.resonance * 3,
    }),
    amp: {
      attack: 0.003,
      decay: 0.25 + c.decay * 3,
      sustain: 0,
      release: 0.5,
    },
    drift: 2,
    wander: false,
    level: 0.5,
  }),
  rack: () => rack({ drive: 0, chorus: 0.4, wander: 0 }),
};

/** Detuned eighties poly: two saws and a square through a 24 dB filter and wide chorus. */
const polyArp: Patch = {
  voice: (c) => ({
    layers: [
      {
        kind: "osc",
        wave: "saw",
        ratio: 1,
        voices: 2,
        detune: 7 + c.shape * 14,
        spread: true,
        level: 1,
      },
      {
        kind: "osc",
        wave: "square",
        ratio: 1,
        voices: 1,
        detune: 0,
        spread: false,
        level: 0.45,
        cents: -6,
      },
    ],
    filter: lowpass(sweep(c.tone, 450, 6000), {
      keyTrack: 0.5,
      resonance: c.resonance * 8,
      envelope: 1.8,
      envDecay: 0.05 + c.decay * 0.6,
      envSustain: 0.2,
    }),
    amp: {
      attack: 0.002,
      decay: 0.08 + c.decay * 1.2,
      sustain: 0.3,
      release: 0.1 + c.decay * 0.4,
    },
    drift: 3,
    wander: false,
    level: 0.5,
  }),
  rack: () => rack({ drive: 0.2, chorus: 0.6, wander: 0 }),
};

/** Mallet: an FM strike over a sine with a marimba-like fourth partial. */
const malletArp: Patch = {
  voice: (c) => ({
    layers: [
      {
        kind: "osc",
        wave: "sine",
        ratio: 1,
        voices: 1,
        detune: 0,
        spread: false,
        level: 1,
      },
      {
        kind: "fm",
        ratio: 1,
        modRatio: 4,
        index: 0.8 + c.shape * 1.8,
        indexFall: 0.025,
        indexHold: 0,
        level: 0.5,
        pan: 0.2 * c.width,
      },
      {
        kind: "osc",
        wave: "sine",
        ratio: 4,
        voices: 1,
        detune: 0,
        spread: false,
        level: 0.3 + c.shape * 0.2,
        fall: 0.07,
        hold: 0,
      },
    ],
    filter: lowpass(sweep(c.tone, 2200, 15000), {
      poles: 2,
      keyTrack: 1,
      resonance: c.resonance * 3,
    }),
    amp: {
      attack: 0.0015,
      decay: 0.12 + c.decay * 1.2,
      sustain: 0,
      release: 0.06,
    },
    drift: 1,
    wander: false,
    level: 0.5,
  }),
  rack: () => rack({ drive: 0.08, chorus: 0.2, wander: 0 }),
};

/** Arp slots: Pluck, Super, Glass, Keys, Pulse, Dream, Poly, Mallet. */
export const FLUFF_ARP_PATCHES: readonly Patch[] = [
  pluckArp,
  superArp,
  glassArp,
  keysArp,
  pulseArp,
  dreamArp,
  polyArp,
  malletArp,
];
export const FLUFF_ARP_LEVELS: readonly number[] = [
  0.266, 0.348, 0.195, 0.147, 0.324, 0.161, 0.166, 0.178,
];

// ---------------------------------------------------------------- Pads

/** Pad controls: tone, shape, motion and spread; attack and release are the pad's own. */
export interface PadPatch {
  voice(controls: MelodicControls): VoiceSpec;
  rack(controls: MelodicControls): RackSettings;
}

const padAmp = { attack: 0, decay: 0, sustain: 1, release: 0 };

const superPad: PadPatch = {
  voice: (c) => ({
    layers: [
      {
        kind: "osc",
        wave: "saw",
        ratio: 1,
        voices: 5,
        detune: 12 + c.shape * 26,
        center: 0.8,
        spread: true,
        level: 1,
      },
    ],
    filter: lowpass(sweep(c.tone, 500, 9000), {
      poles: 2,
      keyTrack: 0.3,
      lfo: 1,
    }),
    amp: padAmp,
    drift: 3,
    wander: true,
    level: 0.42,
  }),
  rack: (c) =>
    rack({
      drive: 0.1,
      chorus: 0.3,
      filterLfo: 150 + c.motion * 900,
      wander: 2 + c.motion * 5,
    }),
};

const airPad: PadPatch = {
  voice: (c) => ({
    layers: [
      {
        kind: "osc",
        wave: "triangle",
        ratio: 1,
        voices: 3,
        detune: 7,
        spread: true,
        level: 1,
      },
      {
        kind: "osc",
        wave: "saw",
        ratio: 2,
        voices: 2,
        detune: 10,
        spread: true,
        level: 0.1 + c.shape * 0.3,
      },
      {
        kind: "noise",
        filter: "bandpass",
        frequency: 5500,
        fixed: true,
        q: 0.5,
        level: 0.12 + c.shape * 0.25,
      },
    ],
    filter: lowpass(sweep(c.tone, 350, 9000), {
      poles: 2,
      keyTrack: 0.3,
      lfo: 1,
    }),
    amp: padAmp,
    drift: 3,
    wander: true,
    level: 0.62,
  }),
  rack: (c) =>
    rack({
      chorus: 0.5,
      filterLfo: 200 + c.motion * 1000,
      wander: 2 + c.motion * 4,
    }),
};

const choirPad: PadPatch = {
  voice: (c) => ({
    layers: [
      {
        kind: "osc",
        wave: "saw",
        ratio: 1,
        voices: 3,
        detune: 9,
        spread: true,
        level: 1,
      },
      {
        kind: "osc",
        wave: "pulse",
        ratio: 1,
        voices: 1,
        detune: 0,
        spread: false,
        level: 0.4,
      },
      {
        kind: "noise",
        filter: "bandpass",
        frequency: 3000,
        fixed: true,
        q: 0.7,
        level: 0.06,
      },
    ],
    filter: lowpass(sweep(c.tone, 500, 8000), { poles: 2, keyTrack: 0 }),
    formant: formant(0.05 + c.shape * 0.5, 0.05 + c.shape * 0.5, 4.5, 0.2),
    amp: padAmp,
    drift: 4,
    wander: true,
    level: 1.4,
  }),
  rack: (c) =>
    rack({
      chorus: 0.6,
      vibrato: 5 + c.motion * 8,
      vibratoDelay: 0.4,
      wander: 3 + c.motion * 4,
    }),
};

const glassPad: PadPatch = {
  voice: (c) => ({
    layers: [
      {
        kind: "fm",
        ratio: 1,
        modRatio: 2,
        index: (0.6 + c.shape * 1.4) * (0.4 + c.tone),
        indexFall: 2.5,
        indexHold: 0.45,
        level: 0.8,
        pan: -0.3,
      },
      {
        kind: "fm",
        ratio: 1,
        modRatio: 3,
        index: (0.3 + c.shape * 0.6) * (0.4 + c.tone),
        indexFall: 1.5,
        indexHold: 0.4,
        level: 0.5,
        pan: 0.3,
        cents: 5,
      },
      {
        kind: "osc",
        wave: "sine",
        ratio: 2,
        voices: 1,
        detune: 0,
        spread: false,
        level: 0.2,
      },
    ],
    filter: lowpass(sweep(c.tone, 600, 12000), {
      poles: 2,
      keyTrack: 0.6,
      lfo: 1,
    }),
    amp: padAmp,
    drift: 2,
    wander: true,
    level: 0.48,
  }),
  rack: (c) =>
    rack({
      chorus: 0.4,
      filterLfo: 100 + c.motion * 800,
      wander: 2 + c.motion * 4,
    }),
};

/** Lo-fi tape keys: a soft electric piano chord with slow wow, hiss and a dark filter. */
const tapePad: PadPatch = {
  voice: (c) => ({
    layers: [
      {
        kind: "fm",
        ratio: 1,
        modRatio: 1,
        index: (0.8 + c.shape * 1.2) * (0.4 + c.tone),
        indexFall: 0.9,
        indexHold: 0.3,
        level: 0.8,
        pan: 0,
      },
      {
        kind: "osc",
        wave: "triangle",
        ratio: 1,
        voices: 2,
        detune: 6,
        spread: true,
        level: 0.5,
      },
      {
        kind: "noise",
        filter: "highpass",
        frequency: 4500,
        fixed: true,
        q: 0.5,
        level: 0.035 + c.shape * 0.04,
      },
    ],
    filter: lowpass(sweep(c.tone, 300, 4000), {
      poles: 2,
      keyTrack: 0.4,
      envelope: 0.8,
      envDecay: 1.2,
    }),
    amp: padAmp,
    drift: 4,
    wander: true,
    level: 0.6,
  }),
  rack: (c) =>
    rack({
      drive: 0.35,
      chorus: 0.25,
      wander: 9 + c.motion * 22,
    }),
};

/** Warm analog strings: three saws and an octave, a 24 dB filter and deep ensemble chorus. */
const warmPad: PadPatch = {
  voice: (c) => ({
    layers: [
      {
        kind: "osc",
        wave: "saw",
        ratio: 1,
        voices: 3,
        detune: 6 + c.shape * 12,
        spread: true,
        level: 1,
      },
      {
        kind: "osc",
        wave: "saw",
        ratio: 2,
        voices: 1,
        detune: 0,
        spread: false,
        level: 0.15 + c.shape * 0.2,
        cents: 3,
      },
    ],
    filter: lowpass(sweep(c.tone, 450, 7000), {
      keyTrack: 0.3,
      lfo: 1,
    }),
    amp: padAmp,
    drift: 3,
    wander: true,
    level: 0.5,
  }),
  rack: (c) =>
    rack({
      drive: 0.1,
      chorus: 0.75,
      filterLfo: 100 + c.motion * 700,
      wander: 2 + c.motion * 4,
    }),
};

/** String ensemble through a slow four-stage phaser. */
const phasePad: PadPatch = {
  voice: (c) => ({
    layers: [
      {
        kind: "osc",
        wave: "saw",
        ratio: 1,
        voices: 4,
        detune: 8 + c.shape * 10,
        spread: true,
        level: 1,
      },
    ],
    filter: lowpass(sweep(c.tone, 600, 9000), { poles: 2, keyTrack: 0.3 }),
    amp: padAmp,
    drift: 3,
    wander: true,
    phaser: 0.5 + c.shape * 0.5,
    level: 0.48,
  }),
  rack: (c) =>
    rack({
      chorus: 0.4,
      phaser: 1500 + c.motion * 1500,
      wander: 2 + c.motion * 4,
    }),
};

/** House organ chord with ensemble vibrato. */
const organPad: PadPatch = {
  voice: (c) => ({
    layers: [
      {
        kind: "osc",
        wave: "organ",
        ratio: 1,
        voices: 2,
        detune: 4,
        spread: true,
        level: 1,
      },
      {
        kind: "osc",
        wave: "sine",
        ratio: 0.5,
        voices: 1,
        detune: 0,
        spread: false,
        level: 0.1 + c.shape * 0.4,
      },
    ],
    filter: lowpass(sweep(c.tone, 500, 8000), { poles: 2, keyTrack: 0.4 }),
    amp: padAmp,
    drift: 0.5,
    wander: false,
    level: 0.4,
  }),
  rack: (c) =>
    rack({
      drive: 0.2,
      chorus: 0.6,
      vibrato: 3 + c.motion * 12,
      vibratoDelay: 0.1,
      wander: 0,
    }),
};

/** Pad slots: Super, Air, Choir, Glass, Tape, Warm, Phase, Organ. */
export const FLUFF_PAD_PATCHES: readonly PadPatch[] = [
  superPad,
  airPad,
  choirPad,
  glassPad,
  tapePad,
  warmPad,
  phasePad,
  organPad,
];
export const FLUFF_PAD_LEVELS: readonly number[] = [
  0.151, 0.075, 0.082, 0.075, 0.038, 0.085, 0.244, 0.106,
];
