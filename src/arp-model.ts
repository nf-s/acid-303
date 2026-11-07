import { z } from "zod";
import { automationLaneSchema, scaleNotes, snapNote } from "./model";
import type { MusicalScale } from "./model";

export const ARP_SOUNDS = ["Pluck", "Pulse", "Glass", "Acid", "Reed", "Dust"];
export const ARP_DIRECTIONS: ReadonlyArray<{
  id: ArpTrack["direction"];
  label: string;
}> = [
  { id: "up", label: "Up" },
  { id: "down", label: "Down" },
  { id: "updown", label: "Up / down" },
  { id: "played", label: "Played" },
  { id: "random", label: "Random" },
];
export const ARP_RATES: ReadonlyArray<ArpTrack["rate"]> = [
  "1/8",
  "1/16",
  "1/16T",
  "1/32",
];
const arpAutomationSchema = z.object({
  gate: z.lazy(() => automationLaneSchema),
  decay: z.lazy(() => automationLaneSchema),
  tone: z.lazy(() => automationLaneSchema),
  resonance: z.lazy(() => automationLaneSchema),
  shape: z.lazy(() => automationLaneSchema),
  space: z.lazy(() => automationLaneSchema),
  width: z.lazy(() => automationLaneSchema),
  volume: z.lazy(() => automationLaneSchema),
});
export type ArpAutomation = z.infer<typeof arpAutomationSchema>;
export type ArpParameter = keyof ArpAutomation;
export function emptyArpAutomation(): ArpAutomation {
  return {
    gate: null,
    decay: null,
    tone: null,
    resonance: null,
    shape: null,
    space: null,
    width: null,
    volume: null,
  };
}
export const arpSchema = z.object({
  automation: arpAutomationSchema.default(emptyArpAutomation),
  sound: z.number().int().min(0).max(5).default(0),
  muted: z.boolean().default(true),
  notes: z
    .array(z.number().int().min(48).max(84))
    .max(16)
    .refine((notes) => new Set(notes).size === notes.length)
    .default(() => [57, 60, 64]),
  direction: z.enum(["up", "down", "updown", "played", "random"]).default("up"),
  rate: z.enum(["1/8", "1/16", "1/16T", "1/32"]).default("1/16"),
  octaves: z.number().int().min(1).max(3).default(1),
  seed: z.number().int().min(0).max(2147483647).default(92731),
  steps: z
    .array(z.boolean())
    .length(16)
    .default(() => Array.from({ length: 16 }, () => true)),
  accents: z
    .array(z.boolean())
    .length(16)
    .default(() => Array.from({ length: 16 }, (_, index) => index % 4 === 0)),
  gate: z.number().min(0.05).max(1).default(0.65),
  decay: z.number().min(0.03).max(1.5).default(0.24),
  tone: z.number().min(0).max(1).default(0.5),
  resonance: z.number().min(0).max(1).default(0.25),
  shape: z.number().min(0).max(1).default(0.35),
  space: z.number().min(0).max(1).default(0.2),
  width: z.number().min(0).max(1).default(0.45),
  volume: z.number().min(0).max(1).default(0.28),
});
export type ArpTrack = z.infer<typeof arpSchema>;
export interface ArpEvent {
  note: number;
  /** Position within this sixteenth note, in sixteenth-note units. */
  offset: number;
  /** Gate duration in sixteenth-note units. */
  duration: number;
  eventIndex: number;
  accent: boolean;
}

export function createArp(): ArpTrack {
  return arpSchema.parse({});
}

export function normalizedArpValue(
  track: ArpTrack,
  parameter: ArpParameter,
): number {
  if (parameter === "gate") return (track.gate - 0.05) / 0.95;
  if (parameter === "decay") return (track.decay - 0.03) / 1.47;
  return track[parameter];
}

export function arpValueFromNormalized(
  parameter: ArpParameter,
  value: number,
): number {
  const bounded = Math.max(0, Math.min(1, value));
  if (parameter === "gate") return 0.05 + bounded * 0.95;
  if (parameter === "decay") return 0.03 + bounded * 1.47;
  return bounded;
}

export function automatedArp(track: ArpTrack, absoluteStep: number): ArpTrack {
  const resolved = { ...track };
  if (!Number.isFinite(absoluteStep) || absoluteStep < 0) return resolved;
  const index = Math.floor(absoluteStep) % 16;
  for (const parameter of arpAutomationSchema.keyof().options) {
    const value = track.automation[parameter]?.[index];
    if (value !== undefined)
      resolved[parameter] = arpValueFromNormalized(parameter, value);
  }
  return resolved;
}

export function retuneArp(track: ArpTrack, scale: MusicalScale): ArpTrack {
  return {
    ...track,
    notes: [
      ...new Set(track.notes.map((note) => snapNote(note, scale, 48, 84))),
    ],
  };
}

export function arpNoteChoices(scale: MusicalScale): number[] {
  return scaleNotes(scale, 48, 84);
}

export function arpNotePool(track: ArpTrack, scale: MusicalScale): number[] {
  const selected = retuneArp(track, scale).notes;
  const notes: number[] = [];
  for (let octave = 0; octave < track.octaves; octave++)
    for (const note of selected) {
      const pitch = note + octave * 12;
      if (!notes.includes(pitch)) notes.push(pitch);
    }
  if (track.direction !== "played") notes.sort((a, b) => a - b);
  if (track.direction === "down") notes.reverse();
  if (track.direction === "updown" && notes.length > 2)
    notes.push(...notes.slice(1, -1).reverse());
  return notes;
}

export function arpInterval(rate: ArpTrack["rate"]): number {
  if (rate === "1/8") return 2;
  if (rate === "1/16T") return 2 / 3;
  if (rate === "1/32") return 0.5;
  return 1;
}

function randomIndex(seed: number, event: number, count: number): number {
  let value = Math.imul(event + 1, 0x45d9f3b) ^ seed;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) % count;
}

/** Absolute event indexing keeps rests, triplets and random playback deterministic. */
export function arpEvents(
  track: ArpTrack,
  scale: MusicalScale,
  absoluteStep: number,
): ArpEvent[] {
  if (
    !Number.isInteger(absoluteStep) ||
    absoluteStep < 0 ||
    track.muted ||
    !track.steps[absoluteStep % 16]
  )
    return [];
  const pool = arpNotePool(track, scale);
  if (!pool.length) return [];
  const interval = arpInterval(track.rate);
  const events: ArpEvent[] = [];
  const first = Math.ceil(absoluteStep / interval - 1e-8);
  const end = Math.ceil((absoluteStep + 1) / interval - 1e-8);
  for (let eventIndex = first; eventIndex < end; eventIndex++) {
    const index =
      track.direction === "random"
        ? randomIndex(track.seed, eventIndex, pool.length)
        : eventIndex % pool.length;
    const note = pool[index];
    if (note === undefined) continue;
    events.push({
      note,
      offset: Math.max(0, eventIndex * interval - absoluteStep),
      duration: interval * track.gate,
      eventIndex,
      accent: track.accents[absoluteStep % 16] ?? false,
    });
  }
  return events;
}
