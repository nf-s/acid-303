import {
  progressionSchema,
  createProgression,
  retuneProgression,
} from "./progression-model";
import { z } from "zod";
import { projectModeSchema } from "./mode";
import {
  cloudSchema,
  createCloud,
  retuneCloud,
  automatedCloud,
  normalizedCloudValue,
} from "./cloud-model";
import type { CloudParameter } from "./cloud-model";
import {
  tensionSchema,
  createTension,
  retuneTension,
  automatedTension,
  normalizedTensionValue,
} from "./tension-model";
import type { TensionParameter } from "./tension-model";
import {
  vocalSchema,
  createVocal,
  retuneVocal,
  automatedVocal,
  normalizedVocalValue,
} from "./vocal-model";
import type { VocalParameter } from "./vocal-model";
import {
  arpSchema,
  arpBaseSchema,
  createArp,
  retuneArp,
  automatedArp,
  normalizedArpValue,
  arpNotePool,
  arpInterval,
} from "./arp-model";
import {
  padSchema,
  padBaseSchema,
  createPad,
  retunePad,
  automatedPad,
  normalizedPadValue,
} from "./pad-model";
import {
  createTiming,
  automationBarsSchema,
  automationTiming,
  automationStepCount,
  automationStepPosition,
  automationPosition,
  sequenceTimingSchema,
  trackStepCount,
  trackCycleTicks,
  trackPosition,
  resizePattern,
  resizeAutomationLane,
  resampleCycleLane,
  tickSeconds,
  MAX_TRACK_STEPS,
} from "./timing";
import type { AutomationBars, SequenceTiming, TrackPosition } from "./timing";
import type { ArpParameter } from "./arp-model";
import type { PadParameter } from "./pad-model";

export const STEP_COUNT = 16;
export const automationLaneSchema = z
  .array(z.number().min(0).max(1))
  .min(1)
  .max(MAX_TRACK_STEPS)
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
const drumBaseSchema = z.object({
  timing: sequenceTimingSchema.default(createTiming),
  automationBars: automationBarsSchema,
  pan: z.number().min(-1).max(1).default(0),
  attack: z.number().min(0).max(1).default(0),
  space: z.number().min(0).max(1).default(0),
  automation: drumAutomationSchema.default(emptyDrumAutomation),
  tone: z.number().min(0).max(1).default(0.5),
  drive: z.number().min(0).max(1).default(0),
  id: drumIdSchema,
  sound: z.number().int().min(0).max(7),
  pitch: z.number().min(-24).max(24),
  decay: z.number().min(0.03).max(1.5),
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
  steps: z.array(z.boolean()).min(1).max(240),
});
export const drumSchema = drumBaseSchema.refine(
  (track) => track.sound <= (track.id === "hat" ? 7 : 6),
  { message: "Choose an available drum sound", path: ["sound"] },
);
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
  timing: sequenceTimingSchema.default(createTiming),
  automationBars: automationBarsSchema,
  pulse: z.number().min(0).max(1).default(0.5),
  shape: z.number().min(0).max(1).default(0.5),
  drive: z.number().min(0).max(1).default(0),
  sound: z.number().int().min(0).max(10).default(2),
  automation: bassAutomationSchema.default(emptyBassAutomation),
  waveform: z.enum(["sawtooth", "square"]),
  cutoff: z.number().min(80).max(8000),
  resonance: z.number().min(0).max(22),
  envelope: z.number().min(0).max(1),
  decay: z.number().min(0.05).max(1.5),
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
  steps: z.array(bassStepSchema).min(1).max(240),
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
  "Hollow",
  "Bite",
];
export const keysStepSchema = z.object({
  note: z.number().int().min(48).max(84),
  on: z.boolean(),
  accent: z.boolean().default(false),
  slide: z.boolean().default(false),
});
export const keysSchema = z.object({
  timing: sequenceTimingSchema.default(createTiming),
  automationBars: automationBarsSchema,
  width: z.number().min(0).max(1).default(0.5),
  attack: z.number().min(0).max(1).default(0),
  grit: z.number().min(0).max(1).default(0),
  motion: z.number().min(0).max(1).default(0),
  automation: keysAutomationSchema.default(emptyKeysAutomation),
  sound: z.number().int().min(0).max(7),
  tone: z.number().min(0).max(1),
  decay: z.number().min(0.08).max(2),
  space: z.number().min(0).max(1),
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
  steps: z.array(keysStepSchema).min(1).max(240),
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
  index = Math.floor(automationStepPosition(track, index));
  const resolved = { ...track };
  for (const parameter of drumAutomationSchema.keyof().options) {
    const value = track.automation[parameter]?.[index];
    if (value !== undefined)
      resolved[parameter] = drumValueFromNormalized(parameter, value, scale);
  }
  return resolved;
}
export function automatedBass(track: BassTrack, index: number): BassTrack {
  index = Math.floor(automationStepPosition(track, index));
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
  index = Math.floor(automationStepPosition(track, index));
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
  "Membrane",
  "Vapor",
];
export function createKeys(preset = 0): KeysTrack {
  const root = preset === 2 ? 60 : 57;
  const intervals = [0, 0, 7, 0, 0, 12, 0, 3, 0, 7, 0, 0, 12, 0, 3, 7];
  return {
    timing: createTiming(),
    automationBars: null,
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
const baseProjectSchema = z.object({
  version: z.literal(6),
  mode: projectModeSchema.default("grain"),
  progression: z.lazy(() => progressionSchema).default(createProgression),
  fx: z
    .object({
      sweep: z.number().min(-1).max(1),
      space: z.number().min(-1).max(1),
      echo: z.number().min(-1).max(1),
    })
    .default(() => ({ sweep: 0, space: 0, echo: 0 })),
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
  arp: z.lazy(() => arpSchema).default(createArp),
  pad: z.lazy(() => padSchema).default(createPad),
  vocal: z.lazy(() => vocalSchema).default(createVocal),
  cloud: z.lazy(() => cloudSchema).default(createCloud),
  tension: z.lazy(() => tensionSchema).default(createTension),
});
export const projectSchema = baseProjectSchema.superRefine(
  (project, context) => {
    const tracks = [
      ...project.drums,
      project.bass,
      project.keys,
      project.arp,
      project.pad,
      project.vocal,
      project.cloud,
      project.tension,
    ];
    tracks.forEach((track, index) => {
      const count = trackStepCount(track.timing);
      if (
        ("steps" in track && track.steps.length !== count) ||
        ("accents" in track && track.accents.length !== count) ||
        Object.values(track.automation).some(
          (lane) => lane !== null && lane.length !== automationStepCount(track),
        )
      )
        context.addIssue({
          code: "custom",
          message: `Track ${index + 1} does not match its timing`,
        });
    });
  },
);
export type Project = z.infer<typeof projectSchema>;
export function projectBars(project: Project): number {
  return Math.ceil(exportPlan(project).ticks / 96);
}
export function withScale(project: Project, scale: MusicalScale): Project {
  const next = structuredClone(project);
  next.scale = { ...scale };
  next.arp = retuneArp(next.arp, scale);
  next.pad = retunePad(next.pad, scale);
  next.progression = retuneProgression(next.progression, scale);
  next.vocal = retuneVocal(next.vocal, scale);
  next.cloud = retuneCloud(next.cloud, scale);
  next.tension = retuneTension(next.tension, scale);
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
    sounds: [
      "Deep 808",
      "Punch 909",
      "Distorted",
      "Sub",
      "Knock",
      "Thump",
      "Zap",
    ],
    icon: "circle-dot",
  },
  snare: {
    name: "Snare",
    short: "SD",
    sounds: [
      "Dusty",
      "Tight 909",
      "Metallic",
      "Break",
      "Brush",
      "Gated",
      "Clatter",
    ],
    icon: "drum",
  },
  hat: {
    name: "Hi-hat",
    short: "HH",
    sounds: [
      "Tight",
      "Air",
      "Tick",
      "Brush",
      "Loose",
      "Skitter",
      "Voltage",
      "Orbit",
    ],
    icon: "disc-3",
  },
  clap: {
    name: "Clap",
    short: "CP",
    sounds: ["Classic", "Wide", "Crunchy", "Room", "Snap", "Hands", "Smear"],
    icon: "audio-lines",
  },
  rim: {
    name: "Rimshot",
    short: "RM",
    sounds: ["Dry", "Wood", "Click", "Clave", "Block", "Stick", "Scrape"],
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
      version: 6,
      mode: "grain",
      progression: createProgression(),
      fx: { sweep: 0, space: 0, echo: 0 },
      scale,
      name:
        ["Acid funk", "After hours", "Broken circuit"][preset] ?? "Acid funk",
      bpm: preset === 1 ? 118 : preset === 2 ? 132 : 126,
      swing: 0.16,
      drive: 0.12,
      volume: 0.65,
      drums: ids.map((id, index) => ({
        timing: createTiming(),
        automationBars: null,
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
      arp: createArp(),
      pad: createPad(),
      vocal: createVocal(),
      cloud: createCloud(),
      tension: createTension(),
      bass: {
        timing: createTiming(),
        automationBars: null,
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
const legacyPadSchema = padBaseSchema.extend({
  bars: z
    .union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)])
    .default(8),
});
const legacyBase = baseProjectSchema.extend({
  version: z.literal(2),
  drums: z
    .array(drumBaseSchema.extend({ steps: z.array(z.boolean()).length(16) }))
    .length(5)
    .refine((drums) => new Set(drums.map((drum) => drum.id)).size === 5),
  bass: bassSchema.extend({ steps: z.array(bassStepSchema).length(16) }),
  keys: keysSchema.extend({ steps: z.array(keysStepSchema).length(16) }),
  arp: z
    .lazy(() =>
      arpBaseSchema.extend({
        steps: z
          .array(z.boolean())
          .length(16)
          .default(() => Array(16).fill(true)),
        accents: z
          .array(z.boolean())
          .length(16)
          .default(() =>
            Array.from({ length: 16 }, (_, index) => index % 4 === 0),
          ),
      }),
    )
    .default(createArp),
  pad: z
    .lazy(() => legacyPadSchema)
    .default(() => legacyPadSchema.parse({ bars: 8 })),
});
const legacyProjectSchema = legacyBase.omit({ keys: true }).extend({
  version: z.literal(1),
  drums: z
    .array(
      drumBaseSchema.extend({
        id: z.enum(["kick", "snare", "hat", "clap", "cowbell"]),
        steps: z.array(z.boolean()).length(16),
      }),
    )
    .length(5)
    .refine((drums) => new Set(drums.map((drum) => drum.id)).size === 5),
});
const versionThreeSchema = baseProjectSchema
  .omit({ vocal: true, cloud: true, tension: true, progression: true })
  .extend({ version: z.literal(3) });
const versionFourSchema = baseProjectSchema
  .omit({ cloud: true, tension: true, progression: true })
  .extend({ version: z.literal(4) });
const versionFiveSchema = baseProjectSchema
  .omit({ progression: true })
  .extend({ version: z.literal(5) });
export function readProject(value: unknown): Project | null {
  const current = projectSchema.safeParse(value);
  if (current.success) return withScale(current.data, current.data.scale);
  const modern = versionFiveSchema.safeParse(value);
  if (modern.success)
    return readProject({
      ...modern.data,
      version: 6,
      progression: {
        timing: modern.data.pad.timing,
        chords: modern.data.pad.chords,
      },
    });
  const recent = versionFourSchema.safeParse(value);
  if (recent.success)
    return readProject({
      ...recent.data,
      version: 6,
      progression: {
        timing: recent.data.pad.timing,
        chords: recent.data.pad.chords,
      },
      cloud: createCloud(),
      tension: createTension(),
    });
  const previous = versionThreeSchema.safeParse(value);
  if (previous.success)
    return readProject({
      ...previous.data,
      version: 6,
      progression: {
        timing: previous.data.pad.timing,
        chords: previous.data.pad.chords,
      },
      vocal: createVocal(),
      cloud: createCloud(),
      tension: createTension(),
    });
  const legacy = legacyBase.safeParse(value);
  if (legacy.success) {
    const original = legacy.data;
    const tracks = [
      ...original.drums,
      original.bass,
      original.keys,
      original.arp,
      original.pad,
    ];
    if (
      tracks.some((track) =>
        Object.values(track.automation).some(
          (lane) => lane !== null && lane.length !== 16,
        ),
      )
    )
      return null;
    const { bars, ...pad } = original.pad;
    const timing = { ...pad.timing, bars, meter: "4/4", grid: "straight" };
    const parsedTiming = padSchema.shape.timing.safeParse(timing);
    if (!parsedTiming.success) return null;
    const automation = { ...pad.automation };
    for (const parameter of Object.keys(automation)) {
      const key = z
        .enum([
          "attack",
          "release",
          "tone",
          "motion",
          "spread",
          "space",
          "shape",
          "volume",
        ])
        .parse(parameter);
      automation[key] = resampleCycleLane(
        automation[key],
        trackStepCount(parsedTiming.data),
      );
    }
    const upgraded = projectSchema.safeParse({
      ...original,
      version: 6,
      fx: { sweep: 0, space: 0, echo: 0 },
      drums: original.drums.map((track) => ({
        ...track,
        timing: createTiming(),
        automationBars: null,
      })),
      bass: { ...original.bass, timing: createTiming() },
      keys: { ...original.keys, timing: createTiming() },
      arp: { ...original.arp, timing: createTiming() },
      pad: { ...pad, timing: parsedTiming.data, automation },
      progression: { timing: parsedTiming.data, chords: pad.chords },
    });
    return upgraded.success
      ? withScale(upgraded.data, upgraded.data.scale)
      : null;
  }
  const ancient = legacyProjectSchema.safeParse(value);
  if (!ancient.success) return null;
  const original = ancient.data;
  return readProject({
    ...original,
    version: 2,
    drive: Math.min(original.drive, 0.18),
    drums: original.drums.map((track) =>
      track.id === "cowbell"
        ? { ...track, id: "rim", sound: 0, decay: 0.12 }
        : track,
    ),
    keys: createKeys(original.name === "Broken circuit" ? 2 : 0),
  });
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
    track.steps = Array.from(
      { length: trackStepCount(track.timing) },
      (_, index) => {
        const step = index % 16;
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
      },
    );
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

export function resizeDrumTrack(
  track: DrumTrack,
  timing: SequenceTiming,
): DrumTrack {
  const automation = { ...track.automation };
  for (const parameter of drumAutomationSchema.keyof().options)
    automation[parameter] = resizeAutomationLane(
      track.automation[parameter],
      automationTiming(track),
      automationTiming({ ...track, timing }),
      normalizedDrumValue(track, parameter),
    );
  return {
    ...track,
    timing: { ...timing },
    automation,
    steps: resizePattern(
      track.steps,
      track.timing,
      timing,
      () => false,
      (value) => value,
    ),
  };
}
export function resizeBassTrack(
  track: BassTrack,
  timing: SequenceTiming,
): BassTrack {
  const automation = { ...track.automation };
  for (const parameter of bassAutomationSchema.keyof().options)
    automation[parameter] = resizeAutomationLane(
      track.automation[parameter],
      automationTiming(track),
      automationTiming({ ...track, timing }),
      normalizedBassValue(track, parameter),
    );
  return {
    ...track,
    timing: { ...timing },
    automation,
    steps: resizePattern(
      track.steps,
      track.timing,
      timing,
      (source) => ({
        note: source?.note ?? 33,
        on: false,
        accent: false,
        slide: false,
      }),
      (value) => value.on,
    ),
  };
}
export function resizeKeysTrack(
  track: KeysTrack,
  timing: SequenceTiming,
): KeysTrack {
  const automation = { ...track.automation };
  for (const parameter of keysAutomationSchema.keyof().options)
    automation[parameter] = resizeAutomationLane(
      track.automation[parameter],
      automationTiming(track),
      automationTiming({ ...track, timing }),
      normalizedKeysValue(track, parameter),
    );
  return {
    ...track,
    timing: { ...timing },
    automation,
    steps: resizePattern(
      track.steps,
      track.timing,
      timing,
      (source) => ({
        note: source?.note ?? 57,
        on: false,
        accent: false,
        slide: false,
      }),
      (value) => value.on,
    ),
  };
}
export const instrumentIdSchema = z.enum([
  ...drumIdSchema.options,
  "bass",
  "keys",
  "arp",
  "pad",
  "vocal",
  "cloud",
  "tension",
]);
export type InstrumentId = z.infer<typeof instrumentIdSchema>;
export interface PlaybackFrame {
  playing: boolean;
  absoluteTick: number;
  positions: Record<InstrumentId, TrackPosition | null>;
}
export function playbackFrame(
  project: Project,
  absoluteTick: number,
  playing = true,
): PlaybackFrame {
  const position = (
    timing: Project["bass"]["timing"] | Project["pad"]["timing"],
  ): TrackPosition | null =>
    playing && absoluteTick >= 0
      ? trackPosition(timing, absoluteTick, project.swing)
      : null;
  const positions: PlaybackFrame["positions"] = {
    kick: null,
    snare: null,
    hat: null,
    clap: null,
    rim: null,
    bass: position(project.bass.timing),
    keys: position(project.keys.timing),
    arp: position(project.arp.timing),
    pad: position(project.pad.timing),
    vocal: position(project.vocal.timing),
    cloud: position(project.cloud.timing),
    tension: position(project.tension.timing),
  };
  for (const drum of project.drums) positions[drum.id] = position(drum.timing);
  return { playing, absoluteTick: playing ? absoluteTick : -1, positions };
}
export type AutomationTarget =
  | { instrument: "drum"; drum: DrumId; parameter: DrumAutomationParameter }
  | { instrument: "bass"; parameter: BassAutomationParameter }
  | { instrument: "keys"; parameter: KeysAutomationParameter }
  | { instrument: "arp"; parameter: ArpParameter }
  | { instrument: "pad"; parameter: PadParameter }
  | { instrument: "vocal"; parameter: VocalParameter }
  | { instrument: "cloud"; parameter: CloudParameter }
  | { instrument: "tension"; parameter: TensionParameter };
export function resolvedAutomationValue(
  project: Project,
  target: AutomationTarget,
  absoluteTick: number,
): { base: number; value: number; automated: boolean } {
  if (target.instrument === "drum") {
    const track = project.drums.find((drum) => drum.id === target.drum);
    if (!track) return { base: 0, value: 0, automated: false };
    const index = automationPosition(track, absoluteTick, project.swing).index;
    return {
      base: normalizedDrumValue(track, target.parameter),
      value: normalizedDrumValue(
        automatedDrum(track, index, project.scale),
        target.parameter,
      ),
      automated: track.automation[target.parameter] !== null,
    };
  }
  const track = project[target.instrument];
  const position = automationPosition(track, absoluteTick, project.swing);
  const index = position.index;
  if (target.instrument === "bass")
    return {
      base: normalizedBassValue(project.bass, target.parameter),
      value: normalizedBassValue(
        automatedBass(project.bass, index),
        target.parameter,
      ),
      automated: project.bass.automation[target.parameter] !== null,
    };
  if (target.instrument === "keys")
    return {
      base: normalizedKeysValue(project.keys, target.parameter),
      value: normalizedKeysValue(
        automatedKeys(project.keys, index),
        target.parameter,
      ),
      automated: project.keys.automation[target.parameter] !== null,
    };
  if (target.instrument === "arp")
    return {
      base: normalizedArpValue(project.arp, target.parameter),
      value: normalizedArpValue(
        automatedArp(project.arp, index),
        target.parameter,
      ),
      automated: project.arp.automation[target.parameter] !== null,
    };
  if (target.instrument === "cloud")
    return {
      base: normalizedCloudValue(project.cloud, target.parameter),
      value: normalizedCloudValue(
        automatedCloud(project.cloud, index),
        target.parameter,
      ),
      automated: project.cloud.automation[target.parameter] !== null,
    };
  if (target.instrument === "tension")
    return {
      base: normalizedTensionValue(project.tension, target.parameter),
      value: normalizedTensionValue(
        automatedTension(project.tension, index),
        target.parameter,
      ),
      automated: project.tension.automation[target.parameter] !== null,
    };
  if (target.instrument === "vocal")
    return {
      base: normalizedVocalValue(project.vocal, target.parameter),
      value: normalizedVocalValue(
        automatedVocal(project.vocal, index),
        target.parameter,
      ),
      automated: project.vocal.automation[target.parameter] !== null,
    };
  return {
    base: normalizedPadValue(project.pad, target.parameter),
    value: normalizedPadValue(
      automatedPad(project.pad, index + position.phase),
      target.parameter,
    ),
    automated: project.pad.automation[target.parameter] !== null,
  };
}
export interface ExportPlan {
  ticks: number;
  seconds: number;
  completeCycle: boolean;
}
export function exportPlan(project: Project): ExportPlan {
  const cycles = [
    ...project.drums,
    project.bass,
    project.keys,
    project.arp,
    project.pad,
    project.vocal,
    project.cloud,
    project.tension,
  ]
    .filter((track) => !track.muted)
    .flatMap((track) => [
      ...(track === project.pad && project.pad.followChords
        ? []
        : [trackCycleTicks(track.timing)]),
      ...(Object.values(track.automation).some((lane) => lane !== null)
        ? [trackCycleTicks(automationTiming(track))]
        : []),
    ]);
  if (
    (!project.pad.muted && project.pad.followChords) ||
    (!project.arp.muted && project.arp.followChords) ||
    (!project.vocal.muted && project.vocal.followChords)
  )
    cycles.push(trackCycleTicks(project.progression.timing));
  if (!project.arp.muted && project.arp.direction !== "random") {
    const count = arpNotePool(
      project.arp,
      project.scale,
      project.progression,
    ).length;
    if (count > 0)
      cycles.push(Math.round(count * arpInterval(project.arp.rate) * 6));
  }
  const gcd = (a: number, b: number): number => {
    while (b) {
      const remainder = a % b;
      a = b;
      b = remainder;
    }
    return a;
  };
  let common = 1;
  for (const cycle of cycles) {
    common = (common / gcd(common, cycle)) * cycle;
    if (common > 3072) break;
  }
  const complete = Math.max(common, Math.ceil(192 / common) * common);
  const ticks = complete <= 3072 ? complete : Math.max(192, ...cycles);
  return {
    ticks,
    seconds: tickSeconds(ticks, project.bpm),
    completeCycle:
      complete <= 3072 &&
      (project.arp.muted || project.arp.direction !== "random"),
  };
}

export function resizeDrumAutomation(
  track: DrumTrack,
  automationBars: AutomationBars,
): DrumTrack {
  const automation = { ...track.automation };
  for (const parameter of drumAutomationSchema.keyof().options)
    automation[parameter] = resizeAutomationLane(
      track.automation[parameter],
      automationTiming(track),
      automationTiming({ ...track, automationBars }),
      normalizedDrumValue(track, parameter),
    );
  return { ...track, automationBars, automation };
}

export function resizeBassAutomation(
  track: BassTrack,
  automationBars: AutomationBars,
): BassTrack {
  const automation = { ...track.automation };
  for (const parameter of bassAutomationSchema.keyof().options)
    automation[parameter] = resizeAutomationLane(
      track.automation[parameter],
      automationTiming(track),
      automationTiming({ ...track, automationBars }),
      normalizedBassValue(track, parameter),
    );
  return { ...track, automationBars, automation };
}

export function resizeKeysAutomation(
  track: KeysTrack,
  automationBars: AutomationBars,
): KeysTrack {
  const automation = { ...track.automation };
  for (const parameter of keysAutomationSchema.keyof().options)
    automation[parameter] = resizeAutomationLane(
      track.automation[parameter],
      automationTiming(track),
      automationTiming({ ...track, automationBars }),
      normalizedKeysValue(track, parameter),
    );
  return { ...track, automationBars, automation };
}
