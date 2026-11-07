import { describe, expect, it } from "vitest";
import { createProject, scaleNotes, resizeBassTrack } from "./model";
import {
  applyProjectChanges,
  clientMessageSchema,
  diffProject,
  MAX_SESSION_BYTES,
  serverMessageSchema,
} from "./session-protocol";

describe("collaborative project patches", () => {
  it("merges concurrent independent note, knob and automation edits", () => {
    const base = createProject(),
      first = structuredClone(base),
      second = structuredClone(base);
    first.bass.cutoff = 1800;
    first.drums[0]?.steps.fill(true);
    second.keys.tone = 0.8;
    second.bass.automation.cutoff = Array(16).fill(0.4);
    const a = applyProjectChanges(base, diffProject(base, first));
    if (!a) throw new Error("Expected valid first edit.");
    const merged = applyProjectChanges(a, diffProject(base, second));
    expect(merged?.bass.cutoff).toBe(1800);
    expect(merged?.drums[0]?.steps.every(Boolean)).toBe(true);
    expect(merged?.keys.tone).toBe(0.8);
    expect(merged?.bass.automation.cutoff).toEqual(Array(16).fill(0.4));
    expect(base.keys.tone).not.toBe(0.8);
  });
  it("merges fixed-array cells and replaces variable-length selections atomically", () => {
    const base = createProject(),
      next = structuredClone(base);
    const step = next.bass.steps[3];
    if (step) step.note = 45;
    next.arp.notes.push(72);
    const changes = diffProject(base, next);
    expect(changes).toContainEqual({
      path: ["bass", "steps", 3, "note"],
      value: 45,
    });
    expect(changes).toContainEqual({
      path: ["arp", "notes"],
      value: next.arp.notes,
    });
    expect(applyProjectChanges(base, changes)).toEqual(next);
  });
  it("rejects prototype pollution, unknown paths and invalid combined values", () => {
    const base = createProject();
    for (const path of [
      ["__proto__", "polluted"],
      ["constructor", "prototype"],
      ["bass", "unknown"],
      ["drums", 5, "volume"],
      ["drums", "length"],
      [],
    ])
      expect(applyProjectChanges(base, [{ path, value: 1 }])).toBeNull();
    expect(
      applyProjectChanges(base, [{ path: ["bpm"], value: 900 }]),
    ).toBeNull();
    expect(
      applyProjectChanges(base, [{ path: ["arp", "notes"], value: [60, 60] }]),
    ).toBeNull();
    expect(
      applyProjectChanges(base, [
        { path: ["bass", "volume"], value: Infinity },
      ]),
    ).toBeNull();
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });
  it("normalizes remote scale changes and preserves granular edits", () => {
    const base = createProject();
    const updated = applyProjectChanges(base, [
      { path: ["scale", "mode"], value: "pentatonic" },
    ]);
    if (!updated) throw new Error("Expected scale edit.");
    expect(
      updated.bass.steps.every((step) =>
        scaleNotes(updated.scale, 24, 60).includes(step.note),
      ),
    ).toBe(true);
    expect(applyProjectChanges(base, diffProject(base, updated))).toEqual(
      updated,
    );
  });
  it("packs long curves into sparse entries while preserving concurrent untouched cells", () => {
    const base = createProject();
    base.bass = resizeBassTrack(base.bass, {
      bars: 8,
      meter: "5/4",
      grid: "triplet",
    });
    base.bass.automation.cutoff = Array(240).fill(0.5);
    const first = structuredClone(base),
      second = structuredClone(base);
    first.bass.automation.cutoff?.splice(210, 3, 0.2, 0.3, 0.4);
    second.bass.automation.cutoff?.splice(225, 2, 0.8, 0.9);
    const changes = diffProject(base, first);
    expect(changes).toEqual([
      {
        path: ["bass", "automation", "cutoff"],
        entries: [
          [210, 0.2],
          [211, 0.3],
          [212, 0.4],
        ],
      },
    ]);
    const a = applyProjectChanges(base, changes);
    if (!a) throw new Error("Expected sparse edit");
    const merged = applyProjectChanges(a, diffProject(base, second));
    expect(merged?.bass.automation.cutoff?.slice(210, 213)).toEqual([
      0.2, 0.3, 0.4,
    ]);
    expect(merged?.bass.automation.cutoff?.slice(225, 227)).toEqual([0.8, 0.9]);
    expect(
      applyProjectChanges(base, [
        { path: ["bass", "automation", "cutoff"], entries: [[240, 0.8]] },
      ]),
    ).toBeNull();
    expect(
      applyProjectChanges(base, [
        {
          path: ["bass", "automation", "cutoff"],
          entries: [
            [2, 0.8],
            [2, 0.2],
          ],
        },
      ]),
    ).toBeNull();
    expect(
      new TextEncoder().encode(JSON.stringify({ project: base })).length,
    ).toBeLessThan(MAX_SESSION_BYTES);
  });
  it("validates bounded message contracts without accepting a claimed role", () => {
    expect(
      clientMessageSchema.safeParse({
        type: "clock",
        playing: true,
        absoluteTick: 0,
        role: "host",
      }).success,
    ).toBe(false);
    expect(
      clientMessageSchema.safeParse({ type: "transport", action: "restart" })
        .success,
    ).toBe(true);
    expect(
      clientMessageSchema.safeParse({
        type: "patch",
        clientId: "test-client-0000001",
        sequence: 1,
        changes: [],
      }).success,
    ).toBe(false);
    expect(
      serverMessageSchema.safeParse({
        type: "presence",
        hostConnected: false,
        participants: 8,
        playing: false,
        absoluteTick: 0,
      }).success,
    ).toBe(true);
  });
});
