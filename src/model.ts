import { z } from "zod";

export const STEP_COUNT = 16;
const automationLaneSchema = z
  .array(z.number().min(0).max(1))
  .length(STEP_COUNT)
  .nullable()
  .default(null);
const drumAutomationSchema = z.object({
  pitch: automationLaneSchema,
  decay: automationLaneSchema,
  volume: automationLaneSchema,
  tone: automationLaneSchema,
  drive: automationLaneSchema,
  pan: automationLaneSchema,
  attack: automationLaneSchema,
  space: automationLaneSchema,
});
export type DrumAutomation = z.infer<typeof drumAutomationSchema>;
export type DrumAutomationParameter = keyof DrumAutomation;
export function emptyDrumAutomation(): DrumAutomation {
  return {
    pitch: null,
    decay: null,
    volume: null,
    tone: null,
    drive: null,
    pan: null,
    attack: null,
    space: null,
  };
}
export const drumIdSchema = z.enum(["kick", "snare", "hat", "clap", "rim"]);
export type DrumId = z.infer<typeof drumIdSchema>;
export const drumSchema = z.object({
  pan: z.number().min(-1).max(1).default(0),
  attack: z.number().min(0).max(1).default(0),
  space: z.number().min(0).max(1).default(0),
  automation: drumAutomationSchema.default(emptyDrumAutomation),
  tone: z.number().min(0).max(1).default(0.5),
  drive: z.number().min(0).max(1).default(0),
  id: drumIdSchema,
  sound: z.number().int().min(0).max(4),
  pitch: z.number().min(-24).max(24),
  decay: z.number().min(0.03).max(1.5),
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
  steps: z.array(z.boolean()).length(STEP_COUNT),
});
export type DrumTrack = z.infer<typeof drumSchema>;
export const bassStepSchema = z.object({
  note: z.number().int().min(24).max(60),
  on: z.boolean(),
  accent: z.boolean(),
  slide: z.boolean().default(false),
});
export type BassStep = z.infer<typeof bassStepSchema>;
const bassAutomationSchema = z.object({
  pulse: automationLaneSchema,
  shape: automationLaneSchema,
  drive: automationLaneSchema,
  cutoff: automationLaneSchema,
  resonance: automationLaneSchema,
  envelope: automationLaneSchema,
  decay: automationLaneSchema,
  volume: automationLaneSchema,
});
export type BassAutomation = z.infer<typeof bassAutomationSchema>;
export type BassAutomationParameter = keyof BassAutomation;
export function emptyBassAutomation(): BassAutomation {
  return {
    pulse: null,
    shape: null,
    drive: null,
    cutoff: null,
    resonance: null,
    envelope: null,
    decay: null,
    volume: null,
  };
}
const keysAutomationSchema = z.object({
  width: automationLaneSchema,
  attack: automationLaneSchema,
  grit: automationLaneSchema,
  motion: automationLaneSchema,
  tone: automationLaneSchema,
  decay: automationLaneSchema,
  space: automationLaneSchema,
  volume: automationLaneSchema,
});
export type KeysAutomation = z.infer<typeof keysAutomationSchema>;
export type KeysAutomationParameter = keyof KeysAutomation;
export function emptyKeysAutomation(): KeysAutomation {
  return {
    width: null,
    attack: null,
    grit: null,
    motion: null,
    tone: null,
    decay: null,
    space: null,
    volume: null,
  };
}
export const bassSchema = z.object({
  pulse: z.number().min(0).max(1).default(0.5),
  shape: z.number().min(0).max(1).default(0.5),
  drive: z.number().min(0).max(1).default(0),
  sound: z.number().int().min(0).max(8).default(2),
  automation: bassAutomationSchema.default(emptyBassAutomation),
  waveform: z.enum(["sawtooth", "square"]),
  cutoff: z.number().min(80).max(8000),
  resonance: z.number().min(0).max(22),
  envelope: z.number().min(0).max(1),
  decay: z.number().min(0.05).max(1.5),
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
  steps: z.array(bassStepSchema).length(STEP_COUNT),
});
export type BassTrack = z.infer<typeof bassSchema>;
export const BASS_SOUNDS = [
  "Round",
  "Knock",
  "Acid",
  "Drive",
  "Bloom",
  "Fog",
  "Rubber",
  "Reese",
  "Pressure",
];
export const keysStepSchema = z.object({
  note: z.number().int().min(48).max(84),
  on: z.boolean(),
  accent: z.boolean().default(false),
  slide: z.boolean().default(false),
});
export const keysSchema = z.object({
  width: z.number().min(0).max(1).default(0.5),
  attack: z.number().min(0).max(1).default(0),
  grit: z.number().min(0).max(1).default(0),
  motion: z.number().min(0).max(1).default(0),
  automation: keysAutomationSchema.default(emptyKeysAutomation),
  sound: z.number().int().min(0).max(5),
  tone: z.number().min(0).max(1),
  decay: z.number().min(0.08).max(2),
  space: z.number().min(0).max(1),
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
  steps: z.array(keysStepSchema).length(STEP_COUNT),
});
export type KeysTrack = z.infer<typeof keysSchema>;
export function normalizedDrumValue(
  track: DrumTrack,
  parameter: DrumAutomationParameter,
): number {
  if (parameter === "pitch") return (track.pitch + 24) / 48;
  if (parameter === "decay") return (track.decay - 0.03) / 1.47;
  if (parameter === "pan") return (track.pan + 1) / 2;
  return track[parameter];
}
export function drumValueFromNormalized(
  parameter: DrumAutomationParameter,
  value: number,
  scale: MusicalScale,
): number {
  const bounded = Math.max(0, Math.min(1, value));
  if (parameter === "pitch")
    return snapNote(bounded * 48 - 24, { root: 0, mode: scale.mode }, -24, 24);
  if (parameter === "decay") return 0.03 + bounded * 1.47;
  if (parameter === "pan") return bounded * 2 - 1;
  return bounded;
}
export function automatedDrum(
  track: DrumTrack,
  index: number,
  scale: MusicalScale,
): DrumTrack {
  const resolved = { ...track };
  for (const parameter of drumAutomationSchema.keyof().options) {
    const value = track.automation[parameter]?.[index];
    if (value !== undefined)
      resolved[parameter] = drumValueFromNormalized(parameter, value, scale);
  }
  return resolved;
}
export function automatedBass(track: BassTrack, index: number): BassTrack {
  const { cutoff, resonance, envelope, decay, volume, shape, drive } =
    track.automation;
  const cutoffValue = cutoff?.[index],
    resonanceValue = resonance?.[index],
    envelopeValue = envelope?.[index],
    decayValue = decay?.[index],
    volumeValue = volume?.[index];
  return {
    ...track,
    pulse: track.automation.pulse?.[index] ?? track.pulse,
    shape: shape?.[index] ?? track.shape,
    drive: drive?.[index] ?? track.drive,
    cutoff: cutoffValue === undefined ? track.cutoff : 80 * 100 ** cutoffValue,
    resonance:
      resonanceValue === undefined ? track.resonance : 22 * resonanceValue,
    envelope: envelopeValue ?? track.envelope,
    decay: decayValue === undefined ? track.decay : 0.05 + 1.45 * decayValue,
    volume: volumeValue ?? track.volume,
  };
}
export function automatedKeys(track: KeysTrack, index: number): KeysTrack {
  const { tone, decay, space, volume, grit, motion } = track.automation;
  const decayValue = decay?.[index];
  return {
    ...track,
    width: track.automation.width?.[index] ?? track.width,
    attack: track.automation.attack?.[index] ?? track.attack,
    grit: grit?.[index] ?? track.grit,
    motion: motion?.[index] ?? track.motion,
    tone: tone?.[index] ?? track.tone,
    decay: decayValue === undefined ? track.decay : 0.08 + 1.92 * decayValue,
    space: space?.[index] ?? track.space,
    volume: volume?.[index] ?? track.volume,
  };
}
export function normalizedBassValue(
  track: BassTrack,
  parameter: BassAutomationParameter,
): number {
  switch (parameter) {
    case "pulse":
      return track.pulse;
    case "shape":
      return track.shape;
    case "drive":
      return track.drive;
    case "cutoff":
      return Math.log(track.cutoff / 80) / Math.log(100);
    case "resonance":
      return track.resonance / 22;
    case "envelope":
      return track.envelope;
    case "decay":
      return (track.decay - 0.05) / 1.45;
    case "volume":
      return track.volume;
  }
}
export function normalizedKeysValue(
  track: KeysTrack,
  parameter: KeysAutomationParameter,
): number {
  return parameter === "decay" ? (track.decay - 0.08) / 1.92 : track[parameter];
}
export const KEYS_SOUNDS = [
  "Impact",
  "Haze",
  "Stab",
  "Scatter",
  "Dub",
  "Frost",
];
export function createKeys(preset = 0): KeysTrack {
  const root = preset === 2 ? 60 : 57;
  const intervals = [0, 0, 7, 0, 0, 12, 0, 3, 0, 7, 0, 0, 12, 0, 3, 7];
  return {
    sound: 0,
    width: 0.5,
    attack: 0,
    grit: 0,
    motion: 0,
    automation: emptyKeysAutomation(),
    tone: 0.38,
    decay: 0.28,
    space: 0.35,
    volume: 0.35,
    muted: false,
    steps: intervals.map((interval, index) => ({
      note: root + interval,
      on: [2, 5, 8, 11, 14].includes(index),
      accent: false,
      slide: false,
    })),
  };
}
export const musicalScaleSchema = z.object({
  root: z.number().int().min(0).max(11),
  mode: z.enum(["minor", "major", "dorian", "phrygian", "pentatonic"]),
});
export type MusicalScale = z.infer<typeof musicalScaleSchema>;
export const SCALE_MODES: ReadonlyArray<{
  id: MusicalScale["mode"];
  name: string;
}> = [
  { id: "minor", name: "Minor" },
  { id: "major", name: "Major" },
  { id: "dorian", name: "Dorian" },
  { id: "phrygian", name: "Phrygian" },
  { id: "pentatonic", name: "Minor pentatonic" },
];
const SCALE_INTERVALS: Record<MusicalScale["mode"], readonly number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  pentatonic: [0, 3, 5, 7, 10],
};
export function scaleNotes(
  scale: MusicalScale,
  min: number,
  max: number,
): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return [];
  const notes: number[] = [];
  for (let note = Math.ceil(min); note <= Math.floor(max); note += 1) {
    const interval = (((note - scale.root) % 12) + 12) % 12;
    if (SCALE_INTERVALS[scale.mode].includes(interval)) notes.push(note);
  }
  return notes;
}
export function snapNote(
  note: number,
  scale: MusicalScale,
  min: number,
  max: number,
): number {
  const notes = scaleNotes(scale, min, max);
  let nearest = notes[0];
  if (nearest === undefined)
    throw new RangeError("No scale notes in this range.");
  for (const candidate of notes)
    if (Math.abs(candidate - note) < Math.abs(nearest - note))
      nearest = candidate;
  return nearest;
}
export const projectSchema = z.object({
  version: z.literal(2),
  name: z.string().max(80),
  scale: musicalScaleSchema.default((): MusicalScale => ({
    root: 9,
    mode: "minor",
  })),
  bpm: z.number().min(60).max(180),
  swing: z.number().min(0).max(0.5),
  drive: z.number().min(0).max(1),
  volume: z.number().min(0).max(1),
  drums: z
    .array(drumSchema)
    .length(5)
    .refine((drums) => new Set(drums.map((drum) => drum.id)).size === 5),
  bass: bassSchema,
  keys: keysSchema,
});
export type Project = z.infer<typeof projectSchema>;
export function withScale(project: Project, scale: MusicalScale): Project {
  const next = structuredClone(project);
  next.scale = { ...scale };
  next.bass.steps.forEach((step) => {
    step.note = snapNote(step.note, scale, 24, 60);
  });
  next.keys.steps.forEach((step) => {
    step.note = snapNote(step.note, scale, 48, 84);
  });
  next.drums.forEach((drum) => {
    drum.pitch = snapNote(drum.pitch, { root: 0, mode: scale.mode }, -24, 24);
  });
  return next;
}
export const DRUM_META: Record<
  DrumId,
  { name: string; short: string; sounds: string[]; icon: string }
> = {
  kick: {
    name: "Kick",
    short: "BD",
    sounds: ["Deep 808", "Punch 909", "Distorted", "Sub", "Knock"],
    icon: "circle-dot",
  },
  snare: {
    name: "Snare",
    short: "SD",
    sounds: ["Dusty", "Tight 909", "Metallic", "Break", "Brush"],
    icon: "drum",
  },
  hat: {
    name: "Hi-hat",
    short: "HH",
    sounds: ["Closed", "Open", "Metallic", "Shaker", "Ride"],
    icon: "disc-3",
  },
  clap: {
    name: "Clap",
    short: "CP",
    sounds: ["Classic", "Wide", "Crunchy", "Room", "Snap"],
    icon: "audio-lines",
  },
  rim: {
    name: "Rimshot",
    short: "RM",
    sounds: ["Dry", "Wood", "Click", "Clave", "Block"],
    icon: "circle-dot",
  },
};
const pattern = (hits: number[]) =>
  Array.from({ length: STEP_COUNT }, (_, index) => hits.includes(index));
export function createProject(preset = 0): Project {
  const drumHits =
    preset === 1
      ? [
          [0, 6, 8, 14],
          [4, 12],
          [0, 2, 4, 6, 8, 10, 11, 14],
          [4, 12, 15],
          [3, 7, 10, 14],
        ]
      : preset === 2
        ? [
            [0, 3, 7, 10],
            [4, 12, 14],
            [0, 2, 3, 6, 8, 10, 14, 15],
            [4, 11, 12],
            [2, 6, 13],
          ]
        : [
            [0, 3, 6, 8, 10, 14],
            [4, 12],
            [0, 2, 4, 6, 7, 8, 10, 12, 14, 15],
            [4, 11, 12],
            [3, 6, 10, 15],
          ];
  const ids: DrumId[] = ["kick", "snare", "hat", "clap", "rim"];
  const decays = [0.23, 0.2, 0.08, 0.18, 0.12];
  const notes =
    preset === 1
      ? [33, 33, 40, 45, 33, 36, 33, 40, 33, 45, 43, 40, 36, 33, 40, 32]
      : preset === 2
        ? [36, 48, 39, 36, 42, 39, 48, 36, 36, 43, 42, 39, 36, 48, 39, 35]
        : [33, 33, 45, 36, 33, 40, 33, 43, 33, 45, 40, 36, 33, 40, 36, 32];
  const scale: MusicalScale = { root: preset === 2 ? 0 : 9, mode: "minor" };
  return withScale(
    {
      version: 2,
      scale,
      name:
        ["Acid funk", "After hours", "Broken circuit"][preset] ?? "Acid funk",
      bpm: preset === 1 ? 118 : preset === 2 ? 132 : 126,
      swing: 0.16,
      drive: 0.12,
      volume: 0.65,
      drums: ids.map((id, index) => ({
        id,
        pan: 0,
        attack: 0,
        space: 0,
        automation: emptyDrumAutomation(),
        tone: 0.5,
        drive: 0,
        sound: 0,
        pitch: 0,
        decay: decays[index] ?? 0.2,
        volume: id === "kick" ? 0.85 : id === "hat" ? 0.38 : 0.55,
        muted: false,
        steps: pattern(drumHits[index] ?? []),
      })),
      keys: createKeys(preset),
      bass: {
        pulse: 0.5,
        shape: 0.5,
        drive: 0,
        sound: 2,
        automation: emptyBassAutomation(),
        waveform: "sawtooth",
        cutoff: 680,
        resonance: 11,
        envelope: 0.5,
        decay: 0.18,
        volume: 0.4,
        muted: false,
        steps: notes.map((note, index) => ({
          note,
          on: ![1, 6, 10].includes(index),
          accent: [0, 7, 12, 15].includes(index),
          slide: false,
        })),
      },
    },
    scale,
  );
}
const legacyProjectSchema = projectSchema.omit({ keys: true }).extend({
  version: z.literal(1),
  drums: z
    .array(
      drumSchema.extend({
        id: z.enum(["kick", "snare", "hat", "clap", "cowbell"]),
      }),
    )
    .length(5)
    .refine((drums) => new Set(drums.map((drum) => drum.id)).size === 5),
  bass: bassSchema.extend({
    steps: z
      .array(bassStepSchema.extend({ slide: z.boolean() }))
      .length(STEP_COUNT),
  }),
});
export function readProject(value: unknown): Project | null {
  const current = projectSchema.safeParse(value);
  if (current.success) return withScale(current.data, current.data.scale);
  const legacy = legacyProjectSchema.safeParse(value);
  if (!legacy.success) return null;
  const original = legacy.data;
  const upgraded = projectSchema.parse({
    ...original,
    version: 2,
    drive: Math.min(original.drive, 0.18),
    drums: original.drums.map((track) =>
      track.id === "cowbell"
        ? { ...track, id: "rim", sound: 0, decay: 0.12 }
        : track,
    ),
    bass: {
      ...original.bass,
      steps: original.bass.steps.map(({ note, on, accent, slide }) => ({
        note,
        on,
        accent,
        slide,
      })),
    },
    keys: createKeys(original.name === "Broken circuit" ? 2 : 0),
  });
  return withScale(upgraded, upgraded.scale);
}
export function noteName(note: number): string {
  const names = [
    "C",
    "C♯",
    "D",
    "D♯",
    "E",
    "F",
    "F♯",
    "G",
    "G♯",
    "A",
    "A♯",
    "B",
  ];
  return `${names[note % 12] ?? "C"}${Math.floor(note / 12) - 1}`;
}
export function stepDuration(bpm: number, swing: number, step: number): number {
  return (60 / bpm / 4) * (step % 2 === 0 ? 1 + swing : 1 - swing);
}

export function remixProject(
  project: Project,
  random: () => number = Math.random,
): Project {
  const remix = structuredClone(project);
  for (const track of remix.drums) {
    track.steps = Array.from({ length: STEP_COUNT }, (_, step) => {
      if (track.id === "kick")
        return (
          step === 0 ||
          step === 8 ||
          (step % 2 === 0 ? random() > 0.55 : random() > 0.83)
        );
      if (track.id === "snare")
        return (
          step === 4 ||
          step === 12 ||
          ([3, 11, 15].includes(step) && random() > 0.8)
        );
      if (track.id === "hat") return step % 2 === 0 || random() > 0.65;
      if (track.id === "clap")
        return (
          step === 4 ||
          step === 12 ||
          ([7, 11, 15].includes(step) && random() > 0.65)
        );
      return [3, 6, 7, 10, 11, 15].includes(step) && random() > 0.4;
    });
  }
  const root = 24 + project.scale.root;
  const scale = [0, 0, 3, 5, 7, 8, 10, 12];
  remix.bass.steps = remix.bass.steps.map((_, index) => ({
    note: root + (scale[Math.floor(random() * scale.length)] ?? 0),
    on: index % 4 === 0 || random() > 0.2,
    accent: index % 4 === 0 || random() > 0.8,
    slide: false,
  }));
  const keyRoot = 48 + project.scale.root;
  const keyIntervals = [0, 0, 0, 7, 12];
  remix.keys.steps = remix.keys.steps.map((_, index) => ({
    note:
      keyRoot + (keyIntervals[Math.floor(random() * keyIntervals.length)] ?? 0),
    on: index === 0 || (index % 2 === 0 ? random() > 0.45 : random() > 0.85),
    accent: false,
    slide: false,
  }));
  return withScale(remix, remix.scale);
}
