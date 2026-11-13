import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { FLUFF_SOUNDS } from "../src/mode";
import type { ProjectMode } from "../src/mode";
import { ARP_SOUNDS } from "../src/arp-model";
import { PAD_SOUNDS } from "../src/pad-model";
import { BASS_SOUNDS, DRUM_META, KEYS_SOUNDS, readProject } from "../src/model";
import type { Project } from "../src/model";

const storageKeys: Record<ProjectMode, string> = {
  grain: "acid-303-project-v1",
  fluff: "fluff-project-v1",
};

async function saved(page: Page, mode: ProjectMode): Promise<Project> {
  await expect
    .poll(() =>
      page.evaluate((key) => localStorage.getItem(key), storageKeys[mode]),
    )
    .not.toBeNull();
  const stored = await page.evaluate(
    (key) => localStorage.getItem(key),
    storageKeys[mode],
  );
  const project = readProject(JSON.parse(stored ?? "null"));
  if (!project) throw new Error("The saved project did not load.");
  return project;
}

const pickers = [
  {
    group: "Bass sound",
    grain: BASS_SOUNDS,
    fluff: FLUFF_SOUNDS.bass,
  },
  { group: "Texture sound", grain: KEYS_SOUNDS, fluff: FLUFF_SOUNDS.keys },
  { group: "Arpeggiator sound", grain: ARP_SOUNDS, fluff: FLUFF_SOUNDS.arp },
  { group: "Pad sound", grain: PAD_SOUNDS, fluff: FLUFF_SOUNDS.pad },
  {
    group: "Kick sounds",
    grain: DRUM_META.kick.sounds,
    fluff: FLUFF_SOUNDS.kick,
  },
];

test("every picker lists its own sounds, then the other studio's in a labelled group", async ({
  page,
}) => {
  await page.goto("/");
  for (const mode of ["grain", "fluff"] as const) {
    if (mode === "fluff")
      await page.locator('[data-project-mode="fluff"]').click();
    const other = mode === "grain" ? "fluff" : "grain";
    const label = other === "fluff" ? "Fluff" : "Grain";
    for (const picker of pickers) {
      const group = page.getByRole("group", {
        name: picker.group,
        exact: true,
      });
      await expect(group.locator(":scope > button")).toHaveText([
        ...picker[mode],
      ]);
      const foreign = group.getByRole("group", {
        name: `${label} sounds`,
        exact: true,
      });
      await expect(foreign.locator(".sound-family-label")).toHaveText(label);
      await expect(foreign.getByRole("button")).toHaveText([...picker[other]]);
      await expect(foreign.getByRole("button").first()).toHaveAttribute(
        "aria-label",
        `${picker[other][0]}, ${label}`,
      );
    }
  }
});

test("a sound from the other studio is chosen per track and survives reload", async ({
  page,
}) => {
  await page.goto("/");
  const bass = page.getByRole("group", { name: "Bass sound", exact: true });
  const reese = bass.getByRole("button", { name: "Reese, Fluff", exact: true });
  await reese.click();
  await expect(reese).toHaveAttribute("aria-pressed", "true");
  await expect(
    bass.getByRole("button", { name: "Reese", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#bass-title")).toHaveText("Bass");
  await expect
    .poll(async () => {
      const project = await saved(page, "grain");
      return { sound: project.bass.sound, family: project.bass.family };
    })
    .toEqual({ sound: 5, family: "fluff" });

  const kick = page.getByRole("group", { name: "Kick sounds", exact: true });
  await kick.getByRole("button", { name: "Boom, Fluff", exact: true }).click();
  await expect
    .poll(async () => {
      const project = await saved(page, "grain");
      const track = project.drums.find((drum) => drum.id === "kick");
      return { sound: track?.sound, family: track?.family };
    })
    .toEqual({ sound: 5, family: "fluff" });

  await page.reload();
  await expect(reese).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#bass-title")).toHaveText("Bass");

  // Picking one of the project's own sounds clears the override.
  await bass.getByRole("button", { name: "Acid", exact: true }).click();
  await expect(page.locator("#bass-title")).toHaveText("Acid bass");
  await expect
    .poll(async () => "family" in (await saved(page, "grain")).bass)
    .toBe(false);

  // Fluff keeps its own project; a Grain Texture there is named Texture.
  await page.locator('[data-project-mode="fluff"]').click();
  const keys = page.getByRole("group", { name: "Texture sound", exact: true });
  await keys.getByRole("button", { name: "Frost, Grain", exact: true }).click();
  await expect(page.locator("#keys-title")).toHaveText("Texture");
  await expect
    .poll(async () => {
      const project = await saved(page, "fluff");
      return { sound: project.keys.sound, family: project.keys.family };
    })
    .toEqual({ sound: 5, family: "grain" });
  await page.reload();
  await expect(
    keys.getByRole("button", { name: "Frost, Grain", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-project-mode="grain"]').click();
  await expect(
    page
      .getByRole("group", { name: "Kick sounds", exact: true })
      .getByRole("button", { name: "Boom, Fluff", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("exports play another studio's voice, audibly different and not silent", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { AudioEngine } = await import("/src/audio.ts");
    const { createPreset } = await import("/src/presets.ts");
    const samples = async (project: Project) => {
      const wav = await new AudioEngine(() => {}).exportWav(project);
      return new Int16Array((await wav.arrayBuffer()).slice(44));
    };
    const solo = (project: Project, keep: string) => {
      for (const drum of project.drums) drum.muted = drum.id !== keep;
      for (const key of [
        "bass",
        "keys",
        "arp",
        "pad",
        "vocal",
        "cloud",
        "tension",
      ] as const)
        project[key].muted = key !== keep;
      return project;
    };
    const compare = async (native: Project, foreign: Project) => {
      const a = await samples(native);
      const b = await samples(foreign);
      let peak = 0;
      let energy = 0;
      let difference = 0;
      for (let index = 0; index < b.length; index++) {
        const value = b[index] ?? 0;
        peak = Math.max(peak, Math.abs(value));
        energy += value * value;
        difference += (value - (a[index] ?? 0)) ** 2;
      }
      return { peak, change: difference / Math.max(1, energy) };
    };
    const grain = solo(createPreset("melodic-techno"), "bass");
    const grainWithFluffBass = structuredClone(grain);
    grainWithFluffBass.bass.family = "fluff";
    const fluff = solo(createPreset("fluff-cotton"), "pad");
    const fluffWithGrainPad = structuredClone(fluff);
    fluffWithGrainPad.pad.family = "grain";
    const kick = solo(createPreset("melodic-techno"), "kick");
    const sampledKick = structuredClone(kick);
    for (const drum of sampledKick.drums)
      if (drum.id === "kick") drum.family = "fluff";
    return [
      await compare(grain, grainWithFluffBass),
      await compare(fluff, fluffWithGrainPad),
      await compare(kick, sampledKick),
    ];
  });
  for (const result of results) {
    expect(result.peak).toBeGreaterThan(1000);
    expect(result.peak).toBeLessThan(32767);
    expect(result.change).toBeGreaterThan(0.2);
  }
});

for (const width of [320, 375]) {
  test(`both studios' sound groups fit a ${width} px phone`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto("/");
    for (const mode of ["grain", "fluff"] as const) {
      await page.locator(`[data-project-mode="${mode}"]`).click();
      for (const picker of pickers) {
        const group = page.getByRole("group", {
          name: picker.group,
          exact: true,
        });
        await group.scrollIntoViewIfNeeded();
        const box = await group.locator(".sound-family").boundingBox();
        expect(box?.width ?? 0).toBeGreaterThan(0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      }
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBe(0);
    }
  });
}
