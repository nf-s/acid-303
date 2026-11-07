import { describe, expect, it } from "vitest";
import { PRESETS, createPreset, findPresetByName } from "./presets";
import { nightshiftSnapshot } from "./preset-data/nightshift";
import { arpEvents } from "./arp-model";
import {
  DRUM_META,
  automatedDrum,
  BASS_SOUNDS,
  KEYS_SOUNDS,
  projectSchema,
  readProject,
  scaleNotes,
  withScale,
} from "./model";

async function presetHash(id: string): Promise<string> {
  const project = createPreset(id);
  project.name = "";
  // Compare the musical v2 projection against the frozen pre-timing fingerprints.
  const { timing, automation, sound, muted, ...padRest } = project.pad;
  const oldCurves = Object.fromEntries(
    Object.entries(automation).map(([key, lane]) => [
      key,
      lane === null
        ? null
        : Array.from(
            { length: 16 },
            (_, index) => lane[index * timing.bars] ?? 0,
          ),
    ]),
  );
  const oldPad = {
    automation: oldCurves,
    sound,
    muted,
    bars: timing.bars,
    ...padRest,
  };
  const bytes = new TextEncoder().encode(
    JSON.stringify({ ...project, version: 2, pad: oldPad }, (key, value) =>
      ["timing", "fx", "vocal", "cloud", "tension"].includes(key)
        ? undefined
        : value,
    ),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

describe("genre examples", () => {
  it("preserves the supplied Nightshift arrangement through migration and saving", async () => {
    const expected = readProject(nightshiftSnapshot);
    if (!expected)
      throw new Error("Supplied Nightshift snapshot did not load.");
    expected.name = "Nightshift";
    const project = createPreset("nightshift");
    expect(project).toEqual(expected);
    expect(project.scale).toEqual({ root: 5, mode: "phrygian" });
    expect(project.bpm).toBe(124);
    expect(project.vocal.muted).toBe(true);
    expect(project.cloud.muted).toBe(true);
    expect(project.tension.muted).toBe(true);
    expect(findPresetByName("Nightshift")).toEqual({
      id: "nightshift",
      name: "Nightshift",
      genre: "House",
    });
    const saved: unknown = JSON.parse(JSON.stringify(project));
    expect(readProject(saved)).toEqual(project);
    const arrangement = JSON.stringify(project, (key, value: unknown) => {
      if (["version", "name", "vocal", "cloud", "tension"].includes(key))
        return undefined;
      if (value !== null && typeof value === "object" && !Array.isArray(value))
        return Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        );
      return value;
    });
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(arrangement),
    );
    const fingerprint = Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    // Captured from the user's decoded snapshot, excluding migration metadata.
    expect(fingerprint).toBe(
      "d96a2acdaa066891b422583060424b18cd9aa97022033d6ad66915638f9d4d7b",
    );
    project.bass.cutoff = 80;
    project.pad.chords[0] = { degree: 6, inversion: 3 };
    expect(createPreset("nightshift")).toEqual(expected);
  });

  it("resolves current and saved legacy names without changing the saved arrangement", () => {
    const legacyNames = [
      { name: "Disco Moth", id: "house" },
      { name: "Kick Gremlin", id: "tech-house" },
      { name: "Wire Wraith", id: "techno" },
      { name: "Tunnel Imp", id: "driving-techno" },
      { name: "Moon Sprite", id: "melodic-techno" },
      { name: "Velvet Fox", id: "garage" },
      { name: "Turbo Rat", id: "speed-garage" },
      { name: "Moss Raver", id: "jungle" },
      { name: "Sub Gremlin", id: "bass-house" },
      { name: "Echo Fern", id: "dub-techno" },
      { name: "Circuit Eel", id: "electro" },
      { name: "Static Flea", id: "microhouse" },
      { name: "Amber Coil", id: "deep-techno" },
      { name: "Chrome Newt", id: "acid-techno" },
      { name: "Glass Orbit", id: "detroit-techno" },
      { name: "Iron Wren", id: "industrial-techno" },
      { name: "Tidal Ghost", id: "ambient-breaks" },
      { name: "Pocket Meteor", id: "broken-beat" },
      { name: "Low Lantern", id: "uk-bass" },
      { name: "Sunday Socks", id: "house" },
      { name: "Pocket Disco", id: "tech-house" },
      { name: "Little Machine", id: "techno" },
      { name: "Night Train", id: "driving-techno" },
      { name: "Moon Jelly", id: "melodic-techno" },
      { name: "Cloud Goblin", id: "atmospheric-techno" },
      { name: "Velvet Steps", id: "garage" },
      { name: "Velvet Imp", id: "garage" },
      { name: "Turbo Biscuit", id: "speed-garage" },
      { name: "Jungle Gym", id: "jungle" },
      { name: "Switchback", id: "bass-house" },
    ];
    for (const { name, id } of legacyNames) {
      const original = createPreset(id);
      original.name = name;
      original.bpm += 1;
      original.bass.cutoff = 1234;
      const saved = readProject(JSON.parse(JSON.stringify(original)));
      if (!saved) throw new Error(`Saved ${name} did not load.`);
      const before = structuredClone(saved);
      const resolved = findPresetByName(saved.name);
      if (!resolved) throw new Error(`Saved ${name} did not resolve.`);
      expect(resolved).toEqual(PRESETS.find((preset) => preset.id === id));
      expect(createPreset(resolved.id)).toEqual(createPreset(id));
      expect(saved).toEqual(before);
      expect(findPresetByName(resolved.name)).toBe(resolved);
    }
    expect(findPresetByName("Custom track")).toBeUndefined();
    expect(findPresetByName("")).toBeUndefined();
    expect(findPresetByName("__proto__")).toBeUndefined();
  });

  it("locks the twenty authored arrangements to their reviewed musical fingerprints", async () => {
    // The legacy musical projection retains its original fingerprints except the four revised techno examples.
    const frozen = [
      {
        id: "house",
        sha256:
          "e19a6d1d8e5db8f0342306d3f721431cd7fbc3903c482bf8c28f8254e69bd8fa",
      },
      {
        id: "tech-house",
        sha256:
          "72e7007fc7b3a0db11f8bae69b475c4f3404fc097acb66766f5ff16629ed1a02",
      },
      {
        id: "techno",
        sha256:
          "a69d55013b6bbd5d1e2589bdabed0fb7b41563408755d3a81a54c623e936da05",
      },
      {
        id: "driving-techno",
        sha256:
          "e9d62cc7c8b8c46b12f6dcd24983f2c6937530d27c7392d33fc7ba50bef64ae6",
      },
      {
        id: "melodic-techno",
        sha256:
          "46d8cb0d181dea94be81e021dab6ae17f9120184ded2394c148a83170543a7e0",
      },
      {
        id: "atmospheric-techno",
        sha256:
          "280987a466a8907e73fd220ab805b8ef3a037799de9c9f8d8dd534e4f42a77d0",
      },
      {
        id: "garage",
        sha256:
          "ae315724b562b3be0cef8574efdadb51de5fe828129e45c064af0d5c79a9e097",
      },
      {
        id: "speed-garage",
        sha256:
          "b43384c5941ef747a4422009cb2cf06515719ae3533fc1e5131fd6d75f62164f",
      },
      {
        id: "jungle",
        sha256:
          "89ff4d7587e9c586af1334c27ce1a342a9558b64e9c4acdee7b3c7efb978e143",
      },
      {
        id: "bass-house",
        sha256:
          "a743593fdd90c39e953450636f0fa8005e87d31286ed1d2b10c32d18814d30cc",
      },
      {
        id: "dub-techno",
        sha256:
          "084c2b28f1a389033b6c485f7b4956d94a3a47eba7507d612c580b8f19fec546",
      },
      {
        id: "electro",
        sha256:
          "c94eea2a9d9ff103cbfc0934f7704a71ac97ffd4df941b9a7783ec1b42c712c4",
      },
      {
        id: "microhouse",
        sha256:
          "eb3ff357c57b6720ff352f5734117e993dd7aebb1f4f51ca4eceeb554414abfd",
      },
      {
        id: "deep-techno",
        sha256:
          "d845433405d763daf6a50eb86ff9bf5db653103b360da3d58fdf59277afb75b2",
      },
      {
        id: "acid-techno",
        sha256:
          "02d79b903ef1072a2c9f29c9cf4bfe9087a722fb525175b60809b188c33b99a3",
      },
      {
        id: "detroit-techno",
        sha256:
          "3e88234d7669ecb74828075c9e792c3531126b4d47920d6e1bb254d81704a9f9",
      },
      {
        id: "industrial-techno",
        sha256:
          "7a51439812cd20a252f38e96a1958770d72947addea64539c510ec4513390239",
      },
      {
        id: "ambient-breaks",
        sha256:
          "638f1620f1cce15636e7dcac224aaea4ae7203e976c0c6936b98feb19c56e545",
      },
      {
        id: "broken-beat",
        sha256:
          "b84200d04805f3bec06399ef5a9663b5ef2f7fae85a4fd2c376fba19dfedfa50",
      },
      {
        id: "uk-bass",
        sha256:
          "0b498f25977f12059246cdba111eb07bac69a0718447e359c4be22f3a1d81288",
      },
    ];
    for (const { id, sha256 } of frozen) {
      expect(createPreset(id).vocal.muted).toBe(true);
      expect(await presetHash(id)).toBe(sha256);
    }
  });

  it("preserves all seventeen untouched examples including timing, effects and vocals", async () => {
    const frozen = [
      {
        id: "house",
        sha256:
          "425adf9e5c0c59ce28857d2381c8c0788f7ee607bae4a655e539908e255bbf5c",
      },
      {
        id: "tech-house",
        sha256:
          "bb37d99880adeb29032f9d6b7ac2b866c61b268c5dd36e3c941097dc53c68b6a",
      },
      {
        id: "garage",
        sha256:
          "3865a6f0fba67812a1ecd6927baa99f51a2714cb11d39f696870f0a108ce73c1",
      },
      {
        id: "speed-garage",
        sha256:
          "0baeb4c4dc96a523ec3f62264051118dbde51fc9f5c4ddb69b1ee4e989f99ddf",
      },
      {
        id: "jungle",
        sha256:
          "8357f99650db8a10acb05afa21c75e52ec595d1f687d1eeb93d370033d2ed9cb",
      },
      {
        id: "bass-house",
        sha256:
          "fec37a29284b6ac1b62a4a55e8f223015f37a8d94385d876bef8038ec21211b0",
      },
      {
        id: "dub-techno",
        sha256:
          "89421110437ba2b625a8666ca0e27d4fcff70a1e86babd66f5dcc669cd67d366",
      },
      {
        id: "electro",
        sha256:
          "62c0cc903c981b88ea5a0c60f001c1d63f5fefcf1d71f4b6a7edb2ceec660693",
      },
      {
        id: "microhouse",
        sha256:
          "98333855c2f5dfc3376d478a8f2f8ed1d31c1589b348465f538b0ced5a4048cd",
      },
      {
        id: "deep-techno",
        sha256:
          "6f163a426586ddca200d418db618ad274cb9bb2addc4d72e385d2c7b4882687b",
      },
      {
        id: "acid-techno",
        sha256:
          "19c946effb15b598501b1c61d8fc7858a9d2475adc4ae6dbb50686f4b88135f2",
      },
      {
        id: "detroit-techno",
        sha256:
          "fb1fecb847ae68711fc027ba037aae5a33eda1891f4f5e0cc8aba5ee3881ee8d",
      },
      {
        id: "industrial-techno",
        sha256:
          "00877be87fb3bcd63d04d01b89cd2c365fe793478aa52c10d44904643fbf29b8",
      },
      {
        id: "ambient-breaks",
        sha256:
          "49887f705191a7371ed1b2fd6ed495c65ef4ceb6f3d873d78615fdd8622394a1",
      },
      {
        id: "broken-beat",
        sha256:
          "6ad3a08943ac6ca5e83baec2b695100d562d5dd48216de94fafd97188993c6f1",
      },
      {
        id: "uk-bass",
        sha256:
          "4e5e374dfd30acaccfff302753544d3f7eefabeaffd2b4b30ed52b5623dc7013",
      },
      {
        id: "nightshift",
        sha256:
          "a70a9142a2c7f8c52400f43d0a649f3ac0037ad0c330227a3843f59d2d465a77",
      },
    ];
    for (const { id, sha256 } of frozen) {
      const { cloud, tension, ...project } = createPreset(id);
      expect(cloud.muted && tension.muted).toBe(true);
      // Only newly revised muted factory tracks are omitted; all pre-existing state is frozen.
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(project)),
      );
      const fingerprint = Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, "0"),
      ).join("");
      expect(fingerprint).toBe(sha256);
    }
  });

  it("provides twenty-one valid arrangements with notes locked to their scales", () => {
    expect(PRESETS.map((preset) => preset.id)).toEqual([
      "techno",
      "driving-techno",
      "atmospheric-techno",
      "melodic-techno",
      "house",
      "tech-house",
      "garage",
      "speed-garage",
      "jungle",
      "bass-house",
      "dub-techno",
      "electro",
      "microhouse",
      "deep-techno",
      "acid-techno",
      "detroit-techno",
      "industrial-techno",
      "ambient-breaks",
      "broken-beat",
      "uk-bass",
      "nightshift",
    ]);
    expect(PRESETS.map((preset) => preset.name)).toEqual([
      "Contact",
      "Transit",
      "Drift",
      "Halflight",
      "Afterhours",
      "Lowline",
      "Side Street",
      "Undertow",
      "Crosscut",
      "Offset",
      "Vapour",
      "Relay",
      "Pinpoint",
      "Stillwater",
      "Etch",
      "Meridian",
      "Ferrite",
      "Blue Hour",
      "Stagger",
      "Sublevel",
      "Nightshift",
    ]);
    expect(new Set(PRESETS.map((preset) => preset.name)).size).toBe(21);
    const projects = PRESETS.map((preset) => createPreset(preset.id));
    for (const project of projects) {
      expect(projectSchema.safeParse(project).success).toBe(true);
      expect(
        project.drums.some((drum) => !drum.muted && drum.steps.some(Boolean)),
      ).toBe(true);
      expect(
        project.bass.steps.every((step) =>
          scaleNotes(project.scale, 24, 60).includes(step.note),
        ),
      ).toBe(true);
      expect(
        project.keys.steps.every((step) =>
          scaleNotes(project.scale, 48, 84).includes(step.note),
        ),
      ).toBe(true);
      expect(
        project.arp.notes.every((note) =>
          scaleNotes(project.scale, 48, 84).includes(note),
        ),
      ).toBe(true);
      for (const track of [project.cloud, project.tension])
        expect(
          track.steps.every((step) =>
            scaleNotes(project.scale, 36, 84).includes(step.note),
          ),
        ).toBe(true);
      for (const track of [project.bass, project.keys]) {
        if (!track.muted)
          expect(track.steps.some((step) => step.on)).toBe(true);
        track.steps.forEach((step, index) => {
          if (step.slide) {
            expect(step.on).toBe(true);
            expect(track.steps[(index + 1) % 16]?.on).toBe(true);
          }
        });
      }
      project.drums.forEach((drum) =>
        expect(DRUM_META[drum.id].sounds[drum.sound]).toBeDefined(),
      );
      expect(KEYS_SOUNDS[project.keys.sound]).toBeDefined();
      expect(BASS_SOUNDS[project.bass.sound]).toBeDefined();
    }
    expect(
      new Set(
        projects
          .slice(0, 20)
          .map((project) =>
            JSON.stringify(project.drums.map((drum) => drum.steps)),
          ),
      ).size,
    ).toBe(20);
    expect(
      new Set(
        projects
          .slice(0, 20)
          .map((project) =>
            JSON.stringify([project.bass.sound, project.bass.steps]),
          ),
      ).size,
    ).toBe(20);
  });

  it("limits authored additions and revisions to three to five audible roles", () => {
    for (const preset of PRESETS.filter(
      (preset) => !["house", "tech-house", "nightshift"].includes(preset.id),
    )) {
      const project = createPreset(preset.id);
      const melodic = [
        project.bass,
        project.keys,
        project.arp,
        project.pad,
        project.vocal,
        project.cloud,
        project.tension,
      ].filter((track) => !track.muted);
      const drums = project.drums.filter(
        (drum) => !drum.muted && drum.steps.some(Boolean),
      );
      expect(drums.length + melodic.length).toBeGreaterThanOrEqual(3);
      expect(drums.length + melodic.length).toBeLessThanOrEqual(5);
      expect(melodic.length).toBeLessThanOrEqual(2);
      for (const drum of project.drums)
        expect(drum.muted).toBe(!drum.steps.some(Boolean));
      expect(project.keys.muted).toBe(
        !project.keys.steps.some((step) => step.on),
      );
      expect(project.bass.muted).toBe(
        !project.bass.steps.some((step) => step.on),
      );
    }
  });

  it("gives the ten additions varied roles and purposeful automation", () => {
    const additions = [
      "dub-techno",
      "electro",
      "microhouse",
      "deep-techno",
      "acid-techno",
      "detroit-techno",
      "industrial-techno",
      "ambient-breaks",
      "broken-beat",
      "uk-bass",
    ].map(createPreset);
    expect(additions).toHaveLength(10);
    expect(new Set(PRESETS.map((preset) => preset.genre)).size).toBe(20);
    const combinations = additions.map((project) =>
      [
        project.bass.muted ? "" : "bass",
        project.keys.muted ? "" : "texture",
        project.arp.muted ? "" : "arp",
        project.pad.muted ? "" : "pad",
      ]
        .filter(Boolean)
        .join("+"),
    );
    expect(new Set(combinations).size).toBeGreaterThanOrEqual(6);
    expect(createPreset("dub-techno").bass.muted).toBe(true);
    expect(
      createPreset("industrial-techno").drums.find((drum) => drum.id === "hat")
        ?.muted,
    ).toBe(true);
    expect(createPreset("ambient-breaks").bpm).toBeLessThan(115);
    expect(
      createPreset("uk-bass")
        .drums.find((drum) => drum.id === "snare")
        ?.steps.filter(Boolean),
    ).toHaveLength(1);
    expect(createPreset("acid-techno").bass.sound).toBe(2);
    expect(createPreset("acid-techno").bass.resonance).toBeLessThan(8);
    for (const lane of [
      createPreset("dub-techno").keys.automation.space,
      createPreset("electro").arp.automation.tone,
      createPreset("deep-techno").pad.automation.tone,
      createPreset("detroit-techno").pad.automation.volume,
    ]) {
      expect(lane?.length).toBeGreaterThanOrEqual(16);
      if (!lane) throw new Error("Authored automation lane is missing.");
      expect(new Set(lane).size).toBeGreaterThan(1);
    }
    const deep = createPreset("deep-techno");
    const tone = deep.pad.automation.tone;
    if (!tone) throw new Error("Deep techno pad tone curve is missing.");
    tone[0] = 1;
    expect(createPreset("deep-techno").pad.automation.tone?.[0]).not.toBe(1);
  });

  it("makes Contact a four-role kick, short sub, hat and metallic syncopation", () => {
    const project = createPreset("techno");
    expect(PRESETS[0]?.id).toBe("techno");
    const kick = project.drums.find((drum) => drum.id === "kick");
    expect(kick?.steps.flatMap((on, index) => (on ? [index] : []))).toEqual([
      0, 4, 8, 12,
    ]);
    expect(BASS_SOUNDS[project.bass.sound]).toBe("Round");
    expect(project.bass.resonance).toBeLessThan(1);
    expect(project.bass.envelope).toBeLessThan(0.1);
    expect(project.bass.steps.some((step) => step.slide)).toBe(false);
    expect(
      project.bass.steps
        .filter((step) => step.on)
        .every((step) => step.note <= 36),
    ).toBe(true);
    expect(project.tension.muted).toBe(false);
    expect(project.tension.sound).toBe(1);
    expect(project.tension.decay).toBeLessThan(0.2);
    expect(
      project.tension.steps.flatMap((step, index) => (step.on ? [index] : [])),
    ).toEqual([3, 7, 10, 15]);
    expect(
      new Set(
        project.tension.steps
          .filter((step) => step.on)
          .map((step) => step.velocity),
      ).size,
    ).toBeGreaterThan(2);
    expect(project.tension.automation.damping).not.toBeNull();
    expect(
      project.arp.muted &&
        project.pad.muted &&
        project.keys.muted &&
        project.cloud.muted &&
        project.vocal.muted,
    ).toBe(true);
    expect(project.drums.filter((drum) => !drum.muted)).toHaveLength(2);
  });

  it("interlocks Transit noise offbeats with its rolling hats and limits bass to two notes", () => {
    const project = createPreset("driving-techno");
    expect(project.cloud.muted).toBe(false);
    expect(project.cloud.sound).toBe(1);
    const hat = project.drums.find((drum) => drum.id === "hat");
    const cloudHits = project.cloud.steps.flatMap((step, index) =>
      step.on ? [index] : [],
    );
    expect(cloudHits).toEqual([2, 6, 10, 14]);
    expect(cloudHits.every((index) => !hat?.steps[index])).toBe(true);
    expect(project.cloud.size).toBeLessThan(0.3);
    expect(project.cloud.density).toBeLessThan(0.2);
    expect(
      new Set(
        project.bass.steps.filter((step) => step.on).map((step) => step.note),
      ).size,
    ).toBeLessThanOrEqual(2);
    expect(
      project.keys.muted &&
        project.arp.muted &&
        project.pad.muted &&
        project.tension.muted,
    ).toBe(true);
  });

  it("gives Drift three sparse roles and Halflight a repeating root/minor-third motif", () => {
    const drift = createPreset("atmospheric-techno");
    expect(drift.drums.filter((drum) => !drum.muted)).toHaveLength(1);
    expect(drift.drums.find((drum) => drum.id === "kick")?.space).toBe(0);
    expect(drift.keys.sound).toBe(4);
    expect(drift.keys.steps.filter((step) => step.on)).toHaveLength(2);
    expect(drift.cloud.muted).toBe(false);
    expect(drift.cloud.sound).toBe(3);
    expect(
      drift.bass.muted &&
        drift.arp.muted &&
        drift.pad.muted &&
        drift.tension.muted,
    ).toBe(true);
    const melodic = createPreset("melodic-techno");
    const phrase = Array.from({ length: 16 }, (_, index) =>
      arpEvents(melodic.arp, melodic.scale, index),
    ).flat();
    expect(phrase.map((event) => event.note)).toEqual([57, 57, 60, 57]);
    expect(melodic.arp.direction).toBe("played");
    expect(melodic.arp.octaves).toBe(1);
    expect(
      new Set(
        melodic.bass.steps.filter((step) => step.on).map((step) => step.note),
      ).size,
    ).toBe(1);
    expect(
      melodic.keys.muted &&
        melodic.pad.muted &&
        melodic.cloud.muted &&
        melodic.tension.muted,
    ).toBe(true);
  });

  it("preserves genre-specific pulse, breaks and space without filling every instrument", () => {
    const atmospheric = createPreset("atmospheric-techno");
    expect(atmospheric.name).toBe("Drift");
    expect(atmospheric.bass.muted && atmospheric.arp.muted).toBe(true);
    expect(atmospheric.pad.muted).toBe(true);
    expect(atmospheric.keys.steps.filter((step) => step.on)).toHaveLength(2);
    const speed = createPreset("speed-garage");
    expect(BASS_SOUNDS[speed.bass.sound]).toBe("Reese");
    expect(
      speed.bass.steps.filter((step) => step.slide).length,
    ).toBeGreaterThan(4);
    expect(createPreset("garage").swing).toBeGreaterThan(0.2);
    const jungle = createPreset("jungle");
    const snare = jungle.drums.find((drum) => drum.id === "snare");
    if (!snare) throw new Error("Jungle snare is missing.");
    const backbeat = automatedDrum(snare, 4, jungle.scale).volume;
    expect(automatedDrum(snare, 7, jungle.scale).volume).toBeLessThan(
      backbeat * 0.4,
    );
    expect(automatedDrum(snare, 9, jungle.scale).volume).toBeLessThan(
      backbeat * 0.4,
    );
    expect(jungle.bpm).toBeGreaterThan(speed.bpm);
    const bassHouse = createPreset("bass-house");
    expect(
      bassHouse.drums.find((drum) => drum.id === "kick")?.steps.filter(Boolean),
    ).toHaveLength(4);
    expect(BASS_SOUNDS[bassHouse.bass.sound]).toBe("Pressure");
    expect(
      bassHouse.keys.muted && bassHouse.arp.muted && bassHouse.pad.muted,
    ).toBe(true);
    expect(createPreset("driving-techno").bpm).toBeGreaterThan(
      createPreset("melodic-techno").bpm,
    );
  });

  it("isolates edits and supports loading any genre into the user's selected scale", () => {
    const house = createPreset("house");
    const firstKick = house.drums.find((drum) => drum.id === "kick");
    if (!firstKick) throw new Error("House kick is missing.");
    firstKick.steps[0] = false;
    house.arp.notes[0] = 84;
    house.pad.chords[0] = { degree: 6, inversion: 3 };
    const cutoff = house.bass.automation.cutoff;
    if (cutoff) cutoff[0] = 1;
    const fresh = createPreset("house");
    expect(fresh.arp.notes[0]).not.toBe(84);
    expect(fresh.pad.chords[0]).not.toEqual({ degree: 6, inversion: 3 });
    expect(fresh.bass.automation.cutoff?.[0]).not.toBe(1);
    expect(
      createPreset("house").drums.find((drum) => drum.id === "kick")?.steps[0],
    ).toBe(true);
    for (const preset of PRESETS) {
      const original = createPreset(preset.id);
      const result = withScale(original, { root: 11, mode: "dorian" });
      expect(result.name).toBe(preset.name);
      expect(result.scale).toEqual({ root: 11, mode: "dorian" });
      expect(result.drums.map((drum) => drum.steps)).toEqual(
        original.drums.map((drum) => drum.steps),
      );
      expect(
        result.bass.steps.every((step) =>
          scaleNotes(result.scale, 24, 60).includes(step.note),
        ),
      ).toBe(true);
      expect(
        result.keys.steps.every((step) =>
          scaleNotes(result.scale, 48, 84).includes(step.note),
        ),
      ).toBe(true);
    }
    const contact = createPreset("techno");
    const firstHit = contact.tension.steps.find((step) => step.on);
    if (!firstHit) throw new Error("Contact tension hit is missing.");
    firstHit.velocity = 0;
    const damping = contact.tension.automation.damping;
    if (damping) damping[3] = 1;
    expect(
      createPreset("techno").tension.steps.find((step) => step.on)?.velocity,
    ).toBeGreaterThan(0);
    expect(createPreset("techno").tension.automation.damping?.[3]).not.toBe(1);
    expect(createPreset("missing").name).toBe("Afterhours");
  });
});
