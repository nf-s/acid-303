import { customSampleSchema } from "./custom-sample-schema";
import {
  progressionChordAtTick,
  progressionScaleDegrees,
} from "./progression-model";
import type { Progression } from "./progression-model";
import { z } from "zod";
import type { AutomationBars } from "./timing";
import { automationLaneSchema, snapNote, scaleNotes } from "./model";
import type { BassStep, MusicalScale } from "./model";
import {
  createTiming,
  automationBarsSchema,
  automationTiming,
  automationStepCount,
  automationStepPosition,
  timingSchema,
  trackStepCount,
  stepsPerBar,
  ticksPerStep,
  resizeAutomationLane,
} from "./timing";
import type { Timing } from "./timing";

export const VOCAL_SOUNDS = [
  "Go",
  "Ready",
  "Set",
  "One",
  "Two",
  "Go vowel",
  "Three vowel",
  "Set attack",
  "Go",
  "Ready",
  "Hold",
  "One",
  "Two",
  "Go vowel",
  "Three vowel",
  "Set attack",
  "Begin",
  "Fight",
  "Time",
  "Combo",
  "One",
  "Two",
  "Fight vowel",
  "Fight attack",
  "Feel it",
  "Groovin",
  "My love",
  "I can feel it",
  "Your love",
  "Baby",
  "Feels so right",
  "Body",
  "Ooh",
  "Mm",
  "Love vowel",
  "Baby vowel",
  "Ad-lib 01",
  "Ad-lib 30",
  "Ad-lib 54",
  "Ad-lib 82",
  "Scat A",
  "Scat F",
  "Get down",
  "Yeah",
  "Ha",
  "Hey",
  "Oh",
  "Come on",
];
export const VOCAL_BANKS: ReadonlyArray<{
  id: "female" | "male" | "fighter" | "soul" | "air" | "dance";
  label: string;
  start: number;
  count: number;
}> = [
  { id: "soul", label: "Soul", start: 24, count: 8 },
  { id: "air", label: "Chops", start: 32, count: 8 },
  { id: "dance", label: "Dance", start: 40, count: 8 },
  { id: "female", label: "Female", start: 0, count: 8 },
  { id: "male", label: "Male", start: 8, count: 8 },
  { id: "fighter", label: "Fighter", start: 16, count: 8 },
];
const vocalAutomationSchema = z.object({
  gain: z.lazy(() => automationLaneSchema).default(null),
  start: z.lazy(() => automationLaneSchema),
  end: z.lazy(() => automationLaneSchema),
  attack: z.lazy(() => automationLaneSchema),
  release: z.lazy(() => automationLaneSchema),
  tone: z.lazy(() => automationLaneSchema),
  drive: z.lazy(() => automationLaneSchema),
  space: z.lazy(() => automationLaneSchema),
  volume: z.lazy(() => automationLaneSchema),
});
export type VocalAutomation = z.infer<typeof vocalAutomationSchema>;
export type VocalParameter = keyof VocalAutomation;
export function emptyVocalAutomation(): VocalAutomation {
  return {
    gain: null,
    start: null,
    end: null,
    attack: null,
    release: null,
    tone: null,
    drive: null,
    space: null,
    volume: null,
  };
}
export const vocalNoteSchema = z.object({
  start: z.number().int().min(0).max(479),
  length: z.number().int().min(1).max(480),
  note: z.number().int().min(36).max(84),
  accent: z.boolean().default(false),
});
export type VocalNote = z.infer<typeof vocalNoteSchema>;
export const vocalBaseSchema = z.object({
  timing: timingSchema.default(createTiming),
  automationBars: automationBarsSchema,
  followChords: z.boolean().default(false),
  recording: customSampleSchema.nullable().default(null),
  sound: z
    .number()
    .int()
    .min(0)
    .max(VOCAL_SOUNDS.length - 1)
    .default(0),
  muted: z.boolean().default(true),
  loop: z.boolean().default(false),
  notes: z
    .array(vocalNoteSchema)
    .max(480)
    .default(() => [
      { start: 0, length: 2, note: 60, accent: false },
      { start: 8, length: 2, note: 60, accent: false },
    ]),
  automation: vocalAutomationSchema.default(emptyVocalAutomation),
  start: z.number().min(0).max(1).default(0),
  end: z.number().min(0).max(1).default(1),
  attack: z.number().min(0).max(1).default(0.02),
  release: z.number().min(0).max(1).default(0.12),
  tone: z.number().min(0).max(1).default(0.62),
  drive: z.number().min(0).max(1).default(0),
  space: z.number().min(0).max(1).default(0.08),
  gain: z.number().min(0).max(1).default(0.5),
  volume: z.number().min(0).max(1).default(0.45),
});
export function vocalGainDecibels(value: number): number {
  return (
    (Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5)) - 0.5) * 48
  );
}
export const vocalSchema = vocalBaseSchema.superRefine((track, context) => {
  const count = trackStepCount(track.timing);
  if (track.end <= track.start)
    context.addIssue({
      code: "custom",
      message: "Vocal trim end must follow its start",
      path: ["end"],
    });
  let end = 0;
  for (const note of track.notes) {
    if (note.start < end || note.start + note.length > count)
      context.addIssue({
        code: "custom",
        message:
          "Vocal notes must be sorted, nonoverlapping and inside the loop",
        path: ["notes"],
      });
    end = note.start + note.length;
  }
  if (
    Object.values(track.automation).some(
      (lane) => lane !== null && lane.length !== automationStepCount(track),
    )
  )
    context.addIssue({
      code: "custom",
      message: "Vocal automation must match its timing",
      path: ["automation"],
    });
});
export type VocalTrack = z.infer<typeof vocalSchema>;
export function createVocal(): VocalTrack {
  return vocalSchema.parse({
    sound: 34,
    release: 0.18,
    space: 0.16,
  });
}
export const VOCAL_PATTERNS = [
  { id: "offbeat", label: "Offbeat" },
  { id: "chops", label: "Chops" },
  { id: "reply", label: "Call / reply" },
  { id: "hold", label: "Hold" },
];

/** Replace only the note rhythm; trims, sound and automation remain editable. */
export function withVocalPattern(
  track: VocalTrack,
  pattern: string,
  scale: MusicalScale,
  rootNote: number,
): VocalTrack {
  if (!VOCAL_PATTERNS.some((item) => item.id === pattern)) return track;
  const count = stepsPerBar(track.timing);
  const template: ReadonlyArray<readonly [number, number, number]> =
    pattern === "offbeat"
      ? [
          [2, 2, 0],
          [6, 2, 0],
          [10, 2, 0],
          [14, 2, 0],
        ]
      : pattern === "chops"
        ? [
            [0, 1, 0],
            [3, 1, 0],
            [6, 1, 7],
            [7, 1, 0],
            [10, 2, 0],
            [14, 1, 7],
            [15, 1, 0],
          ]
        : pattern === "reply"
          ? [
              [0, 6, 0],
              [8, 2, 0],
              [11, 1, 7],
              [14, 2, 0],
            ]
          : [[0, 16, 0]];
  const notes: VocalNote[] = [];
  for (let bar = 0; bar < track.timing.bars; bar++) {
    let end = 0;
    for (const [position, duration, interval] of template) {
      const start = Math.max(end, Math.round((position / 16) * count));
      if (start >= count) continue;
      const length = Math.min(
        count - start,
        Math.max(1, Math.round((duration / 16) * count)),
      );
      notes.push({
        start: bar * count + start,
        length,
        note: snapNote(rootNote + interval, scale, 36, 84),
        accent: interval !== 0 || position === 6 || position === 14,
      });
      end = start + length;
    }
  }
  return { ...track, muted: false, notes };
}
export function normalizedVocalValue(
  track: VocalTrack,
  parameter: VocalParameter,
): number {
  return track[parameter];
}
export function vocalValueFromNormalized(
  _parameter: VocalParameter,
  value: number,
): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
export function setVocalValue(
  track: VocalTrack,
  parameter: VocalParameter,
  value: number,
): VocalTrack {
  const next = {
    ...track,
    [parameter]: vocalValueFromNormalized(parameter, value),
  };
  if (parameter === "start")
    next.start = Math.min(next.start, next.end - 0.005);
  if (parameter === "end") next.end = Math.max(next.end, next.start + 0.005);
  return next;
}
export function automatedVocal(
  track: VocalTrack,
  absoluteStep: number,
): VocalTrack {
  const resolved = { ...track };
  if (!Number.isFinite(absoluteStep) || absoluteStep < 0) return resolved;
  const index = Math.floor(automationStepPosition(track, absoluteStep));
  for (const parameter of vocalAutomationSchema.keyof().options) {
    const value = track.automation[parameter]?.[index];
    if (value !== undefined) resolved[parameter] = value;
  }
  return resolved;
}
/** Trim values are normalized; audio offsets are seconds with a bounded click-safe window. */
export function resolveVocalTrim(
  track: Pick<VocalTrack, "start" | "end">,
  duration: number,
): { start: number; end: number } {
  const length = Math.max(0, Number.isFinite(duration) ? duration : 0);
  const minimum = Math.min(length, 0.008);
  const start = Math.min(
    Math.max(0, track.start * length),
    Math.max(0, length - minimum),
  );
  const end = Math.min(length, Math.max(start + minimum, track.end * length));
  return { start, end };
}
export function retuneVocal(
  track: VocalTrack,
  scale: MusicalScale,
): VocalTrack {
  return {
    ...track,
    notes: track.notes.map((note) => ({
      ...note,
      note: snapNote(note.note, scale, 36, 84),
    })),
  };
}
export function setVocalNote(
  track: VocalTrack,
  incoming: VocalNote,
  scale: MusicalScale,
  replaceStart?: number,
): VocalTrack {
  if (![incoming.start, incoming.length, incoming.note].every(Number.isFinite))
    return track;
  const count = trackStepCount(track.timing);
  const start = Math.max(0, Math.min(count - 1, Math.round(incoming.start)));
  const note: VocalNote = {
    start,
    length: Math.max(1, Math.min(count - start, Math.round(incoming.length))),
    note: snapNote(incoming.note, scale, 36, 84),
    accent: incoming.accent,
  };
  const end = start + note.length;
  const notes: VocalNote[] = [];
  for (const old of track.notes) {
    if (old.start === replaceStart) continue;
    const oldEnd = old.start + old.length;
    if (oldEnd <= start || old.start >= end) notes.push({ ...old });
    else {
      if (old.start < start) notes.push({ ...old, length: start - old.start });
      if (oldEnd > end)
        notes.push({ ...old, start: end, length: oldEnd - end });
    }
  }
  notes.push(note);
  notes.sort((a, b) => a.start - b.start);
  return { ...track, notes };
}
export function removeVocalNote(track: VocalTrack, start: number): VocalTrack {
  return {
    ...track,
    notes: track.notes
      .filter((note) => note.start !== start)
      .map((note) => ({ ...note })),
  };
}
export function joinVocalNote(track: VocalTrack, start: number): VocalTrack {
  const index = track.notes.findIndex((note) => note.start === start);
  const note = track.notes[index],
    next = track.notes[index + 1];
  if (
    !note ||
    !next ||
    note.start + note.length !== next.start ||
    note.note !== next.note
  )
    return track;
  return {
    ...track,
    notes: track.notes.flatMap((value, position) =>
      position === index
        ? [{ ...note, length: note.length + next.length }]
        : position === index + 1
          ? []
          : [{ ...value }],
    ),
  };
}
export function vocalStepNotes(track: VocalTrack): BassStep[] {
  return Array.from({ length: trackStepCount(track.timing) }, (_, index) => {
    const note = track.notes.find(
      (value) => index >= value.start && index < value.start + value.length,
    );
    return {
      note: note?.note ?? 60,
      on: note !== undefined,
      accent: note?.accent ?? false,
      slide: note !== undefined && index + 1 < note.start + note.length,
    };
  });
}
export function resizeVocalTrack(
  track: VocalTrack,
  timing: Timing,
): VocalTrack {
  const previousBar = stepsPerBar(track.timing),
    nextBar = stepsPerBar(timing);
  const factor = ticksPerStep(track.timing) / ticksPerStep(timing);
  const count = trackStepCount(timing);
  const notes: VocalNote[] = [];
  for (let bar = 0; bar < timing.bars; bar++) {
    const sourceBar = bar % track.timing.bars;
    for (const note of track.notes) {
      if (Math.floor(note.start / previousBar) !== sourceBar) continue;
      const offset = Math.round((note.start % previousBar) * factor);
      if (offset >= nextBar) continue;
      const start = bar * nextBar + offset;
      const length = Math.max(
        1,
        Math.min(count - start, Math.round(note.length * factor)),
      );
      notes.push({ ...note, start, length });
    }
  }
  notes.sort((a, b) => a.start - b.start);
  const clipped = notes
    .map((note, index) => ({
      ...note,
      length: Math.min(
        note.length,
        (notes[index + 1]?.start ?? count) - note.start,
      ),
    }))
    .filter((note) => note.length > 0);
  const automation = { ...track.automation };
  for (const parameter of vocalAutomationSchema.keyof().options)
    automation[parameter] = resizeAutomationLane(
      track.automation[parameter],
      automationTiming(track),
      automationTiming({ ...track, timing }),
      track[parameter],
    );
  return { ...track, timing: { ...timing }, notes: clipped, automation };
}

export function resizeVocalAutomation(
  track: VocalTrack,
  automationBars: AutomationBars,
): VocalTrack {
  const automation = { ...track.automation };
  for (const parameter of vocalAutomationSchema.keyof().options)
    automation[parameter] = resizeAutomationLane(
      track.automation[parameter],
      automationTiming(track),
      automationTiming({ ...track, automationBars }),
      track[parameter],
    );
  return { ...track, automationBars, automation };
}

/** Transpose only the note onset; held notes retain this pitch through chord changes. */
export function vocalProgressionNote(
  note: number,
  scale: MusicalScale,
  progression: Progression,
  absoluteTick: number,
  swing = 0,
): number {
  const count = progressionScaleDegrees(scale).length;
  const first = progression.chords[0]?.degree ?? 0;
  const active =
    progression.chords[progressionChordAtTick(progression, absoluteTick, swing)]
      ?.degree ?? first;
  const shift = (active % count) - (first % count);
  const notes = scaleNotes(scale, 0, 127);
  const original = snapNote(note, scale, 36, 84);
  const index = notes.indexOf(original);
  return snapNote(
    notes[Math.max(0, Math.min(notes.length - 1, index + shift))] ?? original,
    scale,
    36,
    84,
  );
}
