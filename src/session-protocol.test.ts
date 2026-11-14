import { describe, expect, it } from "vitest";
import {
  createProject,
  scaleNotes,
  resizeBassTrack,
  resizeKeysTrack,
} from "./model";
import { resizeBassAutomation, resizeDrumAutomation } from "./model";
import { resizeCloudTrack } from "./cloud-model";
import { resizeTensionTrack } from "./tension-model";
import { resizeVocalAutomation } from "./vocal-model";
import { progressionChordSchema } from "./progression-model";
import {
  applyProjectChanges,
  clientMessageSchema,
  sessionMessageForProtocol,
  diffProject,
  MAX_SESSION_BYTES,
  serverMessageSchema,
  sessionCanChange,
  versionThreeProject,
  versionFourProject,
  versionFiveProject,
  versionSixProject,
  MAX_PROJECT_CHANGES,
  applySessionProjectChanges,
} from "./session-protocol";

describe("collaborative project patches", () => {
  it("masks new vocal banks for v4 and preserves their hidden sample during old whole-track edits", () => {
    const project = createProject();
    project.vocal.sound = 47;
    project.vocal.muted = false;
    const projected = versionFourProject(project);
    expect(projected.vocal).toMatchObject({ sound: 0, muted: true });
    const previous = { ...projected.vocal, tone: 0.82 };
    const merged = applySessionProjectChanges(
      project,
      [{ path: ["vocal"], value: previous }],
      4,
    );
    expect(merged?.vocal).toMatchObject({
      sound: 47,
      muted: false,
      tone: 0.82,
    });
    expect(
      applySessionProjectChanges(
        project,
        [{ path: ["vocal", "muted"], value: false }],
        4,
      ),
    ).toBeNull();
    expect(
      applySessionProjectChanges(
        project,
        [
          { path: ["vocal", "sound"], value: 23 },
          { path: ["vocal", "muted"], value: false },
        ],
        4,
      )?.vocal,
    ).toMatchObject({ sound: 23, muted: false });
    expect(
      applySessionProjectChanges(
        project,
        [{ path: ["vocal", "sound"], value: 24 }],
        4,
      ),
    ).toBeNull();
    const patch = serverMessageSchema.parse({
      type: "patch",
      revision: 5,
      sequence: 3,
      clientId: "test-client-0000001",
      changes: [{ path: ["vocal", "sound"], value: 47 }],
    });
    expect(sessionMessageForProtocol(patch, 4, project)).toEqual({
      ...patch,
      changes: [{ path: ["vocal"], value: projected.vocal }],
    });
    expect(sessionMessageForProtocol(patch, 3, project)).toEqual({
      ...patch,
      changes: [],
    });
    expect(project.vocal.sound).toBe(47);
  });
  it("keeps v3/v4 hidden instruments out of projections and preserves their ordered acknowledgements", () => {
    const project = createProject();
    project.vocal.sound = 0;
    project.cloud.muted = false;
    project.tension.seed = 123;
    expect(versionThreeProject(project)).not.toHaveProperty("vocal");
    for (const previous of [
      versionThreeProject(project),
      versionFourProject(project),
    ]) {
      expect(previous).not.toHaveProperty("cloud");
      expect(previous).not.toHaveProperty("tension");
    }
    const {
      automationBars: _bars,
      followChords: _follow,
      recording: _recording,
      ...legacyVocal
    } = versionSixProject(project).vocal;
    expect(versionFourProject(project).vocal).toEqual(legacyVocal);
    const patch = serverMessageSchema.parse({
      type: "patch",
      revision: 42,
      sequence: 9,
      clientId: "test-client-0000001",
      changes: [
        { path: ["cloud", "scan"], value: 0.8 },
        { path: ["tension", "pick"], value: 0.4 },
      ],
    });
    for (const protocol of [3, 4])
      expect(sessionMessageForProtocol(patch, protocol)).toEqual({
        ...patch,
        changes: [],
      });
    expect(sessionMessageForProtocol(patch, 5)).toEqual(patch);
    expect(sessionCanChange(4, { path: ["vocal", "volume"], value: 0.7 })).toBe(
      true,
    );
    expect(sessionCanChange(3, { path: ["vocal", "volume"], value: 0.7 })).toBe(
      false,
    );
    expect(sessionCanChange(4, { path: ["cloud"], value: {} })).toBe(false);
    expect(sessionCanChange(5, { path: ["version"], value: 3 })).toBe(false);
  });
  it("compacts very large note edits into bounded instrument replacements", () => {
    const base = createProject();
    base.cloud = resizeCloudTrack(base.cloud, {
      bars: 16,
      meter: "5/4",
      grid: "triplet",
    });
    base.tension = resizeTensionTrack(base.tension, {
      bars: 16,
      meter: "5/4",
      grid: "triplet",
    });
    base.bass = resizeBassTrack(base.bass, {
      bars: 8,
      meter: "5/4",
      grid: "triplet",
    });
    base.keys = resizeKeysTrack(base.keys, {
      bars: 8,
      meter: "5/4",
      grid: "triplet",
    });
    const next = structuredClone(base);
    for (const track of [next.cloud, next.tension])
      track.steps = track.steps.map((step) => ({
        on: !step.on,
        note: step.note === 60 ? 64 : 60,
        velocity: step.velocity === 0.9 ? 0.8 : 0.9,
      }));
    for (const track of [next.bass, next.keys])
      track.steps = track.steps.map((step) => ({
        on: !step.on,
        note: step.note === 48 ? 57 : 48,
        accent: !step.accent,
        slide: !step.slide,
      }));
    const changes = diffProject(base, next);
    expect(changes.length).toBeLessThan(MAX_PROJECT_CHANGES);
    expect(changes.every((change) => change.path.length === 1)).toBe(true);
    expect(
      clientMessageSchema.safeParse({
        type: "patch",
        clientId: "test-client-0000001",
        sequence: 1,
        changes,
      }).success,
    ).toBe(true);
    expect(applyProjectChanges(base, changes)).toEqual(next);
  });
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
        supportsVocal: false,
        supportsVocalMusic: false,
        supportsCloud: false,
        supportsTension: false,
        participants: 8,
        playing: false,
        absoluteTick: 0,
      }).success,
    ).toBe(true);
  });
  it("projects v4 vocal edits to revision-preserving empty v3 patches", () => {
    const message = {
      type: "patch",
      revision: 9,
      sequence: 2,
      clientId: "test-client-0000001",
      changes: [{ path: ["vocal", "volume"], value: 0.8 }],
    };
    const parsed = serverMessageSchema.parse(message);
    expect(sessionMessageForProtocol(parsed, 3)).toEqual({
      ...message,
      changes: [],
    });
    expect(sessionMessageForProtocol(parsed, 4)).toEqual(message);
    const presence = serverMessageSchema.parse({
      type: "presence",
      supportsVocal: true,
      supportsVocalMusic: true,
      supportsCloud: true,
      supportsTension: true,
      hostConnected: true,
      playing: false,
      absoluteTick: 0,
      participants: 2,
    });
    expect(sessionMessageForProtocol(presence, 3)).not.toHaveProperty(
      "supportsVocal",
    );
    expect(sessionMessageForProtocol(presence, 4)).toHaveProperty(
      "supportsVocal",
      true,
    );
  });
});

describe("composition compatibility", () => {
  it("projects independent loops to valid legacy tracks without exposing v6 fields", () => {
    const project = createProject();
    project.bass = resizeBassAutomation(project.bass, 8);
    project.bass.automation.cutoff = Array.from(
      { length: 128 },
      (_, index) => index / 128,
    );
    const old = versionFiveProject(project);
    expect(old.version).toBe(5);
    expect(old).not.toHaveProperty("progression");
    expect(old.bass).not.toHaveProperty("automationBars");
    expect(old.bass.automation.cutoff).toHaveLength(16);
    const edited = applySessionProjectChanges(
      project,
      [{ path: ["bass"], value: { ...old.bass, volume: 0.27 } }],
      5,
    );
    expect(edited?.bass.automationBars).toBe(8);
    expect(edited?.bass.automation).toEqual(project.bass.automation);
    expect(edited?.bass.volume).toBe(0.27);
    expect(
      applySessionProjectChanges(
        project,
        [{ path: ["bass", "automation", "cutoff", 0], value: 0.5 }],
        5,
      ),
    ).toBeNull();
    expect(
      applySessionProjectChanges(
        project,
        [{ path: ["bass", "automationBars"], value: 1 }],
        5,
      ),
    ).toBeNull();
  });
  it("preserves hidden drum automation in sparse legacy track replacements", () => {
    const project = createProject();
    project.drums = project.drums.map((track) =>
      resizeDrumAutomation(track, 8),
    );
    const kick = project.drums[0];
    if (!kick) throw new Error("Kick missing");
    kick.automation.tone = Array.from(
      { length: 128 },
      (_, index) => index / 128,
    );
    const old = versionFiveProject(project).drums[0];
    if (!old) throw new Error("Projected kick missing");
    const edited = applySessionProjectChanges(
      project,
      [{ path: ["drums"], entries: [[0, { ...old, volume: 0.3 }]] }],
      5,
    );
    expect(edited?.drums[0]?.volume).toBe(0.3);
    expect(edited?.drums[0]?.automationBars).toBe(8);
    expect(edited?.drums[0]?.automation).toEqual(kick.automation);
    const extended = {
      path: ["drums"],
      entries: [[0, { ...old, automationBars: 1 }]],
    };
    const parsed = clientMessageSchema.parse({
      type: "patch",
      clientId: "legacy-client-0001",
      sequence: 1,
      changes: [extended],
    });
    if (parsed.type !== "patch") throw new Error("Patch missing");
    expect(applySessionProjectChanges(project, parsed.changes, 5)).toBeNull();
  });
  it("maps old Pad chord edits into the shared progression without erasing local voicings", () => {
    const project = createProject();
    project.progression.chords[0] = { degree: 3, inversion: 1 };
    const old = versionFiveProject(project);
    expect(old.pad.chords).toEqual(project.progression.chords);
    const edited = applySessionProjectChanges(
      project,
      [{ path: ["pad", "chords", 0, "degree"], value: 4 }],
      5,
    );
    expect(edited?.progression.chords[0]?.degree).toBe(4);
    expect(edited?.pad.chords).toEqual(project.pad.chords);
    const replaced = applySessionProjectChanges(
      project,
      [{ path: ["pad"], value: { ...old.pad, tone: 0.7 } }],
      5,
    );
    expect(replaced?.pad.chords).toEqual(project.pad.chords);
    expect(replaced?.pad.tone).toBe(0.7);
  });
  it("keeps private sample references out of legacy clients and blocks local-only sources in sessions", () => {
    const project = createProject();
    const recording = {
      kind: "shared",
      id: "a".repeat(32),
      sha256: "b".repeat(64),
      name: "Recording",
      duration: 1,
      rootNote: 60,
      peaks: Array(128).fill(0.1),
      readToken: "c".repeat(43),
    };
    const shared = applyProjectChanges(project, [
      { path: ["vocal", "recording"], value: recording },
      { path: ["vocal", "muted"], value: false },
    ]);
    if (!shared) throw new Error("Recording fixture invalid");
    const old = versionFiveProject(shared);
    expect(old.vocal).not.toHaveProperty("recording");
    expect(old.vocal).toMatchObject({ sound: 0, muted: true });
    const edited = applySessionProjectChanges(
      shared,
      [{ path: ["vocal"], value: { ...old.vocal, tone: 0.3 } }],
      5,
    );
    expect(edited?.vocal.recording).toEqual(recording);
    expect(edited?.vocal.muted).toBe(false);
    const { readToken: _token, ...local } = recording;
    expect(
      applySessionProjectChanges(
        project,
        [{ path: ["vocal", "recording"], value: { ...local, kind: "local" } }],
        6,
      ),
    ).toBeNull();
  });
});

describe("vocal gain compatibility", () => {
  it("projects gain out of v6 without dropping composition or recordings", () => {
    const project = createProject();
    project.vocal.gain = 0.8;
    project.vocal.automation.gain = Array(16).fill(0.7);
    project.vocal.followChords = true;
    const previous = versionSixProject(project);
    expect(previous.version).toBe(6);
    expect(previous.progression).toEqual(project.progression);
    expect(previous.vocal.followChords).toBe(true);
    expect(previous.vocal.recording).toBeNull();
    for (const vocal of [
      previous.vocal,
      versionFiveProject(project).vocal,
      versionFourProject(project).vocal,
    ]) {
      expect(vocal).not.toHaveProperty("gain");
      expect(vocal.automation).not.toHaveProperty("gain");
    }
    const presence = serverMessageSchema.parse({
      type: "presence",
      hostConnected: true,
      supportsVocal: true,
      supportsVocalMusic: true,
      supportsCloud: true,
      supportsTension: true,
      supportsComposition: true,
      supportsVocalGain: true,
      participants: 2,
      playing: false,
      absoluteTick: 0,
    });
    expect(sessionMessageForProtocol(presence, 6)).toMatchObject({
      supportsComposition: true,
    });
    expect(sessionMessageForProtocol(presence, 6)).not.toHaveProperty(
      "supportsVocalGain",
    );
    expect(sessionMessageForProtocol(presence, 7)).toHaveProperty(
      "supportsVocalGain",
      true,
    );
  });
  it.each([4, 5, 6])(
    "preserves gain through protocol %i whole track, automation and sparse lane edits",
    (protocol) => {
      const project = createProject();
      project.vocal.sound = 0;
      project.vocal.gain = 0.8;
      project.vocal.automation.gain = Array.from(
        { length: 16 },
        (_, index) => index / 16,
      );
      project.vocal.automation.tone = Array(16).fill(0.4);
      const previous =
        protocol === 6
          ? versionSixProject(project).vocal
          : versionFiveProject(project).vocal;
      for (const changes of [
        [{ path: ["vocal"], value: { ...previous, tone: 0.7 } }],
        [
          {
            path: ["vocal", "automation"],
            value: { ...previous.automation, tone: Array(16).fill(0.7) },
          },
        ],
        [
          {
            path: ["vocal", "automation", "tone"],
            entries: [
              [0, 0.8],
              [15, 0.9],
            ],
          },
        ],
      ]) {
        const packet = clientMessageSchema.parse({
          type: "patch",
          clientId: "legacy-client-0001",
          sequence: 1,
          changes,
        });
        if (packet.type !== "patch") throw new Error("Expected patch");
        const merged = applySessionProjectChanges(
          project,
          packet.changes,
          protocol,
        );
        expect(merged?.vocal.gain).toBe(0.8);
        expect(merged?.vocal.automation.gain).toEqual(
          project.vocal.automation.gain,
        );
      }
    },
  );
  it("resizes the hidden gain curve when v6 changes automation length", () => {
    const project = createProject();
    project.vocal.gain = 0.8;
    project.vocal.automation.gain = Array.from(
      { length: 16 },
      (_, index) => index / 16,
    );
    const changed = {
      ...project,
      vocal: resizeVocalAutomation(project.vocal, 4),
    };
    const merged = applySessionProjectChanges(
      project,
      [{ path: ["vocal"], value: versionSixProject(changed).vocal }],
      6,
    );
    expect(merged?.vocal.automationBars).toBe(4);
    expect(merged?.vocal.gain).toBe(0.8);
    expect(merged?.vocal.automation.gain).toEqual(
      changed.vocal.automation.gain,
    );
  });
  it("rejects hidden gain writes from old peers while accepting v7 edits", () => {
    const project = createProject();
    for (const protocol of [3, 4, 5, 6]) {
      expect(
        sessionCanChange(protocol, { path: ["vocal", "gain"], value: 0.9 }),
      ).toBe(false);
      expect(
        sessionCanChange(protocol, {
          path: ["vocal", "automation"],
          value: { gain: null },
        }),
      ).toBe(false);
      expect(
        sessionCanChange(protocol, { path: ["vocal"], value: project.vocal }),
      ).toBe(false);
    }
    expect(
      applySessionProjectChanges(
        project,
        [{ path: ["vocal", "gain"], value: 0.9 }],
        7,
      )?.vocal.gain,
    ).toBe(0.9);
  });
});

describe("chord colour compatibility", () => {
  /** The chord shape the deployed Worker validates: unknown keys are stripped. */
  const previousChord = progressionChordSchema.pick({
    degree: true,
    inversion: true,
  });
  it("sends a new colour as a whole-chord replacement that the previous Worker strips", () => {
    const before = createProject();
    const after = structuredClone(before);
    const edited = after.progression.chords[1];
    if (!edited) throw new Error("Missing chord.");
    edited.quality = "ninth";
    edited.borrow = "major";
    const changes = diffProject(before, after);
    expect(changes).toEqual([
      { path: ["progression", "chords", 1], value: edited },
    ]);
    // The current schema keeps the colour.
    expect(
      applySessionProjectChanges(before, changes, 7)?.progression.chords[1],
    ).toEqual(edited);
    // The previous Worker accepts the path and stores the plain chord, which
    // every peer then receives, so the edit reverts without an error or desync.
    const stored = applyProjectChanges(before, changes);
    expect(previousChord.parse(stored?.progression.chords[1])).toEqual(
      before.progression.chords[1],
    );
    // A field-level path to a key the stored chord lacks would be rejected.
    expect(
      applyProjectChanges(before, [
        { path: ["progression", "chords", 1, "quality"], value: "ninth" },
      ]),
    ).toBeNull();
  });
  it("returns a coloured chord to the plain seventh by replacing it", () => {
    const before = createProject();
    const chord = before.progression.chords[0];
    if (!chord) throw new Error("Missing chord.");
    chord.quality = "sus2";
    const after = structuredClone(before);
    const edited = after.progression.chords[0];
    if (!edited) throw new Error("Missing chord.");
    delete edited.quality;
    const changes = diffProject(before, after);
    expect(changes).toEqual([
      { path: ["progression", "chords", 0], value: edited },
    ]);
    expect(
      applySessionProjectChanges(before, changes, 7)?.progression.chords[0],
    ).toEqual(edited);
  });
});
