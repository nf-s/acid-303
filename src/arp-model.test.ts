import { describe, expect, it } from "vitest";
import {
  arpEvents,
  arpNotePool,
  arpSchema,
  createArp,
  retuneArp,
} from "./arp-model";
import type { ArpTrack } from "./arp-model";
import { SCALE_MODES, scaleNotes } from "./model";
import { arpTailDuration } from "./arp-audio";

const scale = { root: 9, mode: "minor" } satisfies Parameters<
  typeof arpEvents
>[1];
function activeTrack(): ArpTrack {
  return { ...createArp(), muted: false };
}
function notesInBar(track: ArpTrack): number[] {
  return Array.from({ length: 16 }, (_, step) => arpEvents(track, scale, step))
    .flat()
    .map((event) => event.note);
}

describe("arpeggiator model", () => {
  it("upgrades missing settings with independent, silent defaults", () => {
    const first = createArp(),
      second = createArp();
    expect(first.muted).toBe(true);
    expect(arpEvents(first, scale, 0)).toEqual([]);
    first.notes.push(69);
    first.steps[0] = false;
    expect(second.notes).toEqual([57, 60, 64]);
    expect(second.steps[0]).toBe(true);
    expect(arpSchema.parse({ sound: 4 }).sound).toBe(4);
  });

  it("rejects invalid persisted sounds, notes, curves and controls", () => {
    for (const invalid of [
      { sound: 6 },
      { notes: [57, 57] },
      { notes: [20] },
      { direction: "backwards" },
      { rate: "1/0" },
      { octaves: 4 },
      { decay: Infinity },
      { volume: -0.1 },
      { gate: 0 },
      { steps: [] },
    ])
      expect(arpSchema.safeParse(invalid).success).toBe(false);
  });

  it("keeps play order separate from ascending and descending order", () => {
    const track = activeTrack();
    track.notes = [64, 57, 60];
    expect(arpNotePool(track, scale)).toEqual([57, 60, 64]);
    track.direction = "down";
    expect(arpNotePool(track, scale)).toEqual([64, 60, 57]);
    track.direction = "played";
    expect(arpNotePool(track, scale)).toEqual([64, 57, 60]);
    track.direction = "updown";
    expect(arpNotePool(track, scale)).toEqual([57, 60, 64, 60]);
  });

  it("expands octave range while preserving single-note and two-note pendulums", () => {
    const track = activeTrack();
    track.notes = [57];
    track.direction = "updown";
    expect(arpNotePool(track, scale)).toEqual([57]);
    track.notes.push(60);
    expect(arpNotePool(track, scale)).toEqual([57, 60]);
    track.octaves = 2;
    expect(arpNotePool(track, scale)).toEqual([57, 60, 69, 72, 69, 60]);
  });

  it("snaps ordered selections into every root and scale without invalid duplicate keys", () => {
    const track = activeTrack();
    track.notes = [57, 60, 64, 65, 67, 69, 71, 72];
    track.octaves = 3;
    for (let root = 0; root < 12; root++)
      for (const mode of SCALE_MODES) {
        const nextScale = { root, mode: mode.id };
        const tuned = retuneArp(track, nextScale);
        expect(new Set(tuned.notes).size).toBe(tuned.notes.length);
        expect(
          arpNotePool(tuned, nextScale).every((note) =>
            scaleNotes(nextScale, 48, 108).includes(note),
          ),
        ).toBe(true);
      }
    expect(track.notes).toEqual([57, 60, 64, 65, 67, 69, 71, 72]);
  });

  it("schedules all rates including triplets without duplicates at step boundaries", () => {
    const track = activeTrack();
    const rates: Array<{ rate: ArpTrack["rate"]; count: number }> = [
      { rate: "1/8", count: 8 },
      { rate: "1/16", count: 16 },
      { rate: "1/16T", count: 24 },
      { rate: "1/32", count: 32 },
    ];
    for (const { rate, count } of rates) {
      track.rate = rate;
      const events = Array.from({ length: 64 }, (_, step) =>
        arpEvents(track, scale, step),
      ).flat();
      expect(events).toHaveLength(count * 4);
      expect(new Set(events.map((event) => event.eventIndex)).size).toBe(
        count * 4,
      );
      expect(
        events.every((event) => event.offset >= 0 && event.offset < 1),
      ).toBe(true);
    }
  });

  it("keeps random order repeatable for playback, export and shared tracks", () => {
    const track = activeTrack();
    track.direction = "random";
    track.octaves = 3;
    const notes = notesInBar(track);
    expect(
      notesInBar(arpSchema.parse(JSON.parse(JSON.stringify(track)))),
    ).toEqual(notes);
    expect(new Set(notes).size).toBeGreaterThan(3);
    track.seed++;
    expect(notesInBar(track)).not.toEqual(notes);
  });

  it("lets rests and accents shape rhythm without resetting the pitch order", () => {
    const track = activeTrack();
    const original = arpEvents(track, scale, 2);
    track.steps[1] = false;
    track.accents[2] = true;
    expect(arpEvents(track, scale, 1)).toEqual([]);
    expect(arpEvents(track, scale, 2)[0]?.note).toBe(original[0]?.note);
    expect(arpEvents(track, scale, 2)[0]?.accent).toBe(true);
    track.gate = 0.2;
    expect(arpEvents(track, scale, 2)[0]?.duration).toBe(0.2);
  });

  it("handles empty selections, silence and invalid scheduling positions", () => {
    const track = activeTrack();
    for (const step of [-1, 0.5, NaN, Infinity])
      expect(arpEvents(track, scale, step)).toEqual([]);
    track.notes = [];
    expect(arpEvents(track, scale, 0)).toEqual([]);
    expect(arpTailDuration(track, 120)).toBe(0);
    track.notes = [57];
    track.muted = true;
    expect(arpTailDuration(track, 120)).toBe(0);
  });

  it("reserves the complete long gate, release and echo tail at slow tempos", () => {
    const track = activeTrack();
    track.sound = 2;
    track.rate = "1/8";
    track.gate = 1;
    track.decay = 1.5;
    track.space = 1;
    expect(arpTailDuration(track, 60)).toBeGreaterThan(3.3);
    track.space = 0;
    expect(arpTailDuration(track, 60)).toBeLessThan(2);
  });
});
