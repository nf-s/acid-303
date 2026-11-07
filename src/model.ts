import { z } from "zod";

export const STEP_COUNT = 16;
export const drumIdSchema = z.enum(["kick", "snare", "hat", "clap", "rim"]);
export type DrumId = z.infer<typeof drumIdSchema>;
export const drumSchema = z.object({
  id: drumIdSchema,
  sound: z.number().int().min(0).max(2),
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
export const bassSchema = z.object({
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
export const keysStepSchema = z.object({
  note: z.number().int().min(48).max(84),
  on: z.boolean(),
  accent: z.boolean().default(false),
  slide: z.boolean().default(false),
});
export const keysSchema = z.object({
  sound: z.number().int().min(0).max(2),
  tone: z.number().min(0).max(1),
  decay: z.number().min(0.08).max(2),
  space: z.number().min(0).max(1),
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
  steps: z.array(keysStepSchema).length(STEP_COUNT),
});
export type KeysTrack = z.infer<typeof keysSchema>;
export const KEYS_SOUNDS = ["Impact", "Haze", "Stab"];
export function createKeys(preset = 0): KeysTrack {
  const root = preset === 2 ? 60 : 57;
  const intervals = [0, 0, 7, 0, 0, 12, 0, 3, 0, 7, 0, 0, 12, 0, 3, 7];
  return {
    sound: 0,
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
export const projectSchema = z.object({
  version: z.literal(2),
  name: z.string().max(80),
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
export const DRUM_META: Record<
  DrumId,
  { name: string; short: string; sounds: string[]; icon: string }
> = {
  kick: {
    name: "Kick",
    short: "BD",
    sounds: ["Deep 808", "Punch 909", "Distorted"],
    icon: "circle-dot",
  },
  snare: {
    name: "Snare",
    short: "SD",
    sounds: ["Dusty", "Tight 909", "Metallic"],
    icon: "drum",
  },
  hat: {
    name: "Hi-hat",
    short: "HH",
    sounds: ["Closed", "Open", "Metallic"],
    icon: "disc-3",
  },
  clap: {
    name: "Clap",
    short: "CP",
    sounds: ["Classic", "Wide", "Crunchy"],
    icon: "audio-lines",
  },
  rim: {
    name: "Rimshot",
    short: "RM",
    sounds: ["Dry", "Wood", "Click"],
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
  return {
    version: 2,
    name: ["Acid funk", "After hours", "Broken circuit"][preset] ?? "Acid funk",
    bpm: preset === 1 ? 118 : preset === 2 ? 132 : 126,
    swing: 0.16,
    drive: 0.12,
    volume: 0.65,
    drums: ids.map((id, index) => ({
      id,
      sound: 0,
      pitch: 0,
      decay: decays[index] ?? 0.2,
      volume: id === "kick" ? 0.85 : id === "hat" ? 0.38 : 0.55,
      muted: false,
      steps: pattern(drumHits[index] ?? []),
    })),
    keys: createKeys(preset),
    bass: {
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
  };
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
  if (current.success) return current.data;
  const legacy = legacyProjectSchema.safeParse(value);
  if (!legacy.success) return null;
  const original = legacy.data;
  return projectSchema.parse({
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
  const root = project.name === "Broken circuit" ? 36 : 33;
  const scale = [0, 0, 3, 5, 7, 8, 11, 12];
  remix.bass.steps = remix.bass.steps.map((_, index) => ({
    note: root + (scale[Math.floor(random() * scale.length)] ?? 0),
    on: index % 4 === 0 || random() > 0.2,
    accent: index % 4 === 0 || random() > 0.8,
    slide: false,
  }));
  const keyRoot = project.name === "Broken circuit" ? 60 : 57;
  const keyIntervals = [0, 0, 0, 7, 12];
  remix.keys.steps = remix.keys.steps.map((_, index) => ({
    note:
      keyRoot + (keyIntervals[Math.floor(random() * keyIntervals.length)] ?? 0),
    on: index === 0 || (index % 2 === 0 ? random() > 0.45 : random() > 0.85),
    accent: false,
    slide: false,
  }));
  return remix;
}
