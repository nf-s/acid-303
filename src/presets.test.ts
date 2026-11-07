import { describe, expect, it } from "vitest";
import { PRESETS, createPreset, findPresetByName } from "./presets";
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
  const bytes = new TextEncoder().encode(JSON.stringify(project));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

describe("genre examples", () => {
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

  it("preserves all twenty complete musical arrangements while changing only their names", async () => {
    // Captured before renaming; only project.name is excluded from each complete-project hash.
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
          "fd6f256a9cc877b96c8a63c14a8d9ce401eec90acd6835642bd8203acf387d91",
      },
      {
        id: "driving-techno",
        sha256:
          "309e173a87bcb7b1355648d6f17b048e3c0a6b93626a8aaba23b337aed952f29",
      },
      {
        id: "melodic-techno",
        sha256:
          "502e66036e9da692e8800a9c2faf69905a277f053eb6a01e918fdfd37edbd504",
      },
      {
        id: "atmospheric-techno",
        sha256:
          "2fbd775051e6eee3bc28076f3fa7da791509b71d0313bbb14893684eb642d883",
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
    for (const { id, sha256 } of frozen)
      expect(await presetHash(id)).toBe(sha256);
  });

  it("provides twenty distinct valid arrangements with notes locked to their scales", () => {
    expect(PRESETS.map((preset) => preset.id)).toEqual([
      "house",
      "tech-house",
      "techno",
      "driving-techno",
      "melodic-techno",
      "atmospheric-techno",
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
    ]);
    expect(PRESETS.map((preset) => preset.name)).toEqual([
      "Afterhours",
      "Lowline",
      "Contact",
      "Transit",
      "Halflight",
      "Drift",
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
    ]);
    expect(new Set(PRESETS.map((preset) => preset.name)).size).toBe(20);
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
        projects.map((project) =>
          JSON.stringify(project.drums.map((drum) => drum.steps)),
        ),
      ).size,
    ).toBe(20);
    expect(
      new Set(
        projects.map((project) =>
          JSON.stringify([project.bass.sound, project.bass.steps]),
        ),
      ).size,
    ).toBe(20);
  });

  it("limits authored additions and revisions to three to five audible roles", () => {
    for (const preset of PRESETS.slice(2)) {
      const project = createPreset(preset.id);
      const melodic = [
        project.bass,
        project.keys,
        project.arp,
        project.pad,
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
    const additions = PRESETS.slice(10).map((preset) =>
      createPreset(preset.id),
    );
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
      expect(lane).toHaveLength(16);
      if (!lane) throw new Error("Authored automation lane is missing.");
      expect(new Set(lane).size).toBeGreaterThan(1);
    }
    const deep = createPreset("deep-techno");
    const tone = deep.pad.automation.tone;
    if (!tone) throw new Error("Deep techno pad tone curve is missing.");
    tone[0] = 1;
    expect(createPreset("deep-techno").pad.automation.tone?.[0]).not.toBe(1);
  });

  it("gives techno a short low-resonance rhythm and melodic techno one restrained minor arp", () => {
    const techno = createPreset("techno");
    expect(BASS_SOUNDS[techno.bass.sound]).toBe("Knock");
    expect(techno.bass.resonance).toBeLessThanOrEqual(2);
    expect(techno.bass.envelope).toBeLessThanOrEqual(0.15);
    expect(techno.bass.decay).toBeLessThanOrEqual(0.12);
    expect(techno.bass.steps.some((step) => step.slide)).toBe(false);
    expect(techno.arp.muted && techno.pad.muted && techno.keys.muted).toBe(
      true,
    );
    const melodic = createPreset("melodic-techno");
    expect(melodic.scale.mode).toBe("minor");
    expect(melodic.arp.muted).toBe(false);
    expect(melodic.arp.octaves).toBe(1);
    expect(melodic.arp.notes).toEqual([57, 60, 64]);
    expect(melodic.arp.steps.filter(Boolean).length).toBeLessThanOrEqual(8);
    expect(melodic.keys.muted && melodic.pad.muted).toBe(true);
    expect(
      new Set(
        melodic.bass.steps.filter((step) => step.on).map((step) => step.note),
      ).size,
    ).toBe(1);
  });

  it("preserves genre-specific pulse, breaks and space without filling every instrument", () => {
    const atmospheric = createPreset("atmospheric-techno");
    expect(atmospheric.name).toBe("Drift");
    expect(atmospheric.bass.muted && atmospheric.arp.muted).toBe(true);
    expect(atmospheric.pad.muted).toBe(false);
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
    expect(createPreset("missing").name).toBe("Afterhours");
  });
});
