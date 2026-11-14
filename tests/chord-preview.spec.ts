import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createProject, readProject } from "../src/model";
import type { Project } from "../src/model";
import { createPreset } from "../src/presets";
import {
  CHORD_PROGRESSIONS,
  chordLabel,
  chordPreview,
  progressionEntryChords,
  progressionFitsScale,
} from "../src/progression-model";

declare global {
  interface Window {
    chordProbe: {
      starts: number;
      offlineStarts: number;
      frequencies: number[];
      analysers: AnalyserNode[];
    };
  }
}

const storageKeys = { grain: "acid-303-project-v1", fluff: "fluff-project-v1" };
type Mode = keyof typeof storageKeys;

function startingProject(mode: Mode): Project {
  const project =
    mode === "fluff" ? createPreset("fluff-cotton") : createProject();
  project.volume = 0.8;
  return project;
}

async function prepare(page: Page, mode: Mode): Promise<Project> {
  const project = startingProject(mode);
  await page.addInitScript(
    ({ initial, key, mode }) => {
      if (localStorage.getItem(key) === null) {
        localStorage.setItem(key, JSON.stringify(initial));
        localStorage.setItem("grain-mode-v1", mode);
      }
      window.chordProbe = {
        starts: 0,
        offlineStarts: 0,
        frequencies: [],
        analysers: [],
      };
      const start = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function (when) {
        if (this.context instanceof OfflineAudioContext)
          window.chordProbe.offlineStarts++;
        else {
          window.chordProbe.starts++;
          window.chordProbe.frequencies.push(this.frequency.value);
        }
        start.call(this, when);
      };
      const createAnalyser = BaseAudioContext.prototype.createAnalyser;
      BaseAudioContext.prototype.createAnalyser = function () {
        const analyser = createAnalyser.call(this);
        if (this instanceof AudioContext)
          window.chordProbe.analysers.push(analyser);
        return analyser;
      };
    },
    { initial: project, key: storageKeys[mode], mode },
  );
  await page.goto("/");
  await expect(page.locator("#bass-matrix-canvas")).toBeVisible();
  return project;
}

async function openChords(page: Page): Promise<Locator> {
  const chords = page.locator("#chords-disclosure");
  if ((await chords.getAttribute("open")) === null)
    await chords.locator(":scope > summary").click();
  return page.locator("#progression-controls");
}

async function openLibrary(chords: Locator): Promise<Locator> {
  const library = chords.locator(".progression-presets");
  if ((await library.getAttribute("open")) === null)
    await library.locator(":scope > summary").click();
  return library;
}

function stored(page: Page, mode: Mode): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), storageKeys[mode]);
}

async function savedProject(page: Page, mode: Mode): Promise<Project> {
  const value = await stored(page, mode);
  const project = readProject(value === null ? null : JSON.parse(value));
  if (!project) throw new Error("The saved project is invalid.");
  return project;
}

function frequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

/** Resolves once oscillators at every frequency have started after `from`. */
async function expectStarted(page: Page, from: number, notes: number[]) {
  await expect
    .poll(() =>
      page.evaluate(
        ({ from, targets }) =>
          targets.every((target) =>
            window.chordProbe.frequencies
              .slice(from)
              .some((value) => Math.abs(value - target) < 0.01),
          ),
        { from, targets: notes.map(frequency) },
      ),
    )
    .toBe(true);
}

/** Highest output sample seen at the master analyser over the next half second. */
function outputPeak(page: Page): Promise<number> {
  return page.evaluate(async () => {
    let peak = 0;
    const end = performance.now() + 500;
    while (performance.now() < end) {
      for (const analyser of window.chordProbe.analysers) {
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return peak;
  });
}

function startCount(page: Page): Promise<number> {
  return page.evaluate(() => window.chordProbe.frequencies.length);
}

async function undoButton(page: Page): Promise<Locator> {
  return page.locator("#global-undo");
}

for (const mode of ["grain", "fluff"] as const) {
  test(`${mode}: clicking or pressing a chord card previews it without editing the project`, async ({
    page,
  }) => {
    const project = await prepare(page, mode);
    const chords = await openChords(page);
    await page.waitForTimeout(300);
    const before = await stored(page, mode);
    await expect(await undoButton(page)).toBeDisabled();
    const silent = await outputPeak(page);
    expect(silent).toBeLessThan(0.002);

    let from = await startCount(page);
    await chords.locator('[data-chord-slot="2"]').click();
    const third = project.progression.chords[2];
    if (!third) throw new Error("Missing chord.");
    const preview = chordPreview(third, project.scale);
    await expectStarted(page, from, [preview.bass, ...preview.notes]);
    expect(await outputPeak(page)).toBeGreaterThan(0.01);
    await expect(chords.locator('[data-chord-slot="2"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    from = await startCount(page);
    await chords.locator('[data-chord-slot="3"]').focus();
    await page.keyboard.press("Enter");
    const fourth = project.progression.chords[3];
    if (!fourth) throw new Error("Missing chord.");
    const next = chordPreview(fourth, project.scale);
    await expectStarted(page, from, [next.bass, ...next.notes]);
    from = await startCount(page);
    await page.keyboard.press("Space");
    await expectStarted(page, from, [next.bass]);

    await page.waitForTimeout(300);
    expect(await stored(page, mode)).toBe(before);
    await expect(await undoButton(page)).toBeDisabled();
  });

  test(`${mode}: a chord preview layers over playback without stopping it`, async ({
    page,
  }) => {
    const project = await prepare(page, mode);
    const chords = await openChords(page);
    await page.waitForTimeout(300);
    const before = await stored(page, mode);
    await page
      .getByRole("button", { name: "Play pattern", exact: true })
      .click();
    const stop = page.getByRole("button", {
      name: "Stop pattern",
      exact: true,
    });
    await expect(stop).toBeVisible();
    const position = page.locator("#bar-position");
    const from = await startCount(page);
    await chords.locator('[data-chord-slot="1"]').click();
    const second = project.progression.chords[1];
    if (!second) throw new Error("Missing chord.");
    const preview = chordPreview(second, project.scale);
    await expectStarted(page, from, [preview.bass, ...preview.notes]);
    const beat = await position.textContent();
    await page.waitForTimeout(1200);
    await expect(stop).toBeVisible();
    expect(await position.textContent()).not.toBe(beat);
    expect(await outputPeak(page)).toBeGreaterThan(0.01);
    await stop.click();
    expect(await stored(page, mode)).toBe(before);
  });
}

test("chord edits are previewed, and a new colour survives undo, reload and a share link", async ({
  page,
  browser,
}) => {
  const project = await prepare(page, "grain");
  const chords = await openChords(page);
  await chords.locator('[data-chord-slot="1"]').click();
  let from = await startCount(page);
  await chords.locator('[data-chord-quality="ninth"]').click();
  const second = project.progression.chords[1];
  if (!second) throw new Error("Missing chord.");
  const ninth = chordPreview({ ...second, quality: "ninth" }, project.scale);
  await expectStarted(page, from, [ninth.bass, ...ninth.notes]);
  await expect
    .poll(async () => (await savedProject(page, "grain")).progression.chords[1])
    .toEqual({ ...second, quality: "ninth" });
  await expect(chords.locator('[data-chord-slot="1"] strong')).toHaveText(
    "Fmaj9",
  );

  from = await startCount(page);
  await chords.locator('[data-chord-borrow="dorian"]').click();
  await expectStarted(page, from, [
    chordPreview(
      { ...second, quality: "ninth", borrow: "dorian" },
      project.scale,
    ).bass,
  ]);
  await expect(chords.locator('[data-chord-slot="1"] strong')).toHaveText(
    chordLabel(
      { ...second, quality: "ninth", borrow: "dorian" },
      project.scale,
    ),
  );
  from = await startCount(page);
  await chords.locator('[data-chord-inversion="2"]').click();
  await expect.poll(() => startCount(page)).toBeGreaterThan(from);
  from = await startCount(page);
  await chords.locator('[data-chord-degree="4"]').click();
  await expect.poll(() => startCount(page)).toBeGreaterThan(from);
  await chords.locator('[data-chord-borrow=""]').click();
  await chords.locator('[data-chord-degree="5"]').click();
  await chords.locator('[data-chord-inversion="1"]').click();
  const edited = { ...second, quality: "ninth" };
  await expect
    .poll(async () => (await savedProject(page, "grain")).progression.chords[1])
    .toEqual(edited);

  await page.locator("#studio-tools").click();
  await page.locator("#global-undo").click();
  await expect
    .poll(async () => (await savedProject(page, "grain")).progression.chords[1])
    .not.toEqual(edited);
  await page.locator("#global-redo").click();
  await expect
    .poll(async () => (await savedProject(page, "grain")).progression.chords[1])
    .toEqual(edited);

  await page.reload();
  expect((await savedProject(page, "grain")).progression.chords[1]).toEqual(
    edited,
  );
  await expect(
    (await openChords(page)).locator('[data-chord-slot="1"] strong'),
  ).toHaveText("Fmaj9");

  await page.locator("#studio-tools").click();
  await page.locator("#share-track").click();
  await expect(page.locator("#share-url")).toHaveValue(/#track=v1\./);
  const link = await page.locator("#share-url").inputValue();
  const context = await browser.newContext();
  const recipient = await context.newPage();
  await recipient.goto(link);
  await expect
    .poll(async () => {
      const value = await recipient.evaluate(() =>
        localStorage.getItem("acid-303-project-v1"),
      );
      return readProject(value === null ? null : JSON.parse(value))?.progression
        .chords[1];
    })
    .toEqual(edited);
  await context.close();
});

test("progression library auditions without editing, applies with undo and picks at random", async ({
  page,
}) => {
  const project = await prepare(page, "grain");
  const chords = await openChords(page);
  const library = await openLibrary(chords);
  await library.locator('[data-progression-group="Dreamy"]').click();
  await expect(
    library.locator('[data-progression-group="Dreamy"]'),
  ).toHaveAttribute("aria-pressed", "true");
  const entries = CHORD_PROGRESSIONS.filter(
    (entry) =>
      entry.group === "Dreamy" &&
      progressionFitsScale(entry, project.scale.mode),
  );
  await expect(library.locator("[data-chord-progression]")).toHaveCount(
    entries.length,
  );
  const entry = entries[0];
  if (!entry) throw new Error("No Dreamy entries.");
  const expected = progressionEntryChords(entry, project.scale);
  await page.waitForTimeout(300);
  const before = await stored(page, "grain");

  const from = await startCount(page);
  await library.locator(`[data-progression-audition="${entry.id}"]`).click();
  const previews = expected.map((chord) => chordPreview(chord, project.scale));
  await expectStarted(
    page,
    from,
    previews.map((preview) => preview.bass),
  );
  expect(await stored(page, "grain")).toBe(before);
  await expect(page.locator("#global-undo")).toBeDisabled();

  const apply = library.locator(`[data-chord-progression="${entry.id}"]`);
  await expect(apply).toHaveAttribute("aria-pressed", "false");
  await apply.click();
  await expect
    .poll(async () => (await savedProject(page, "grain")).progression.chords)
    .toEqual(expected);
  await expect(apply).toHaveAttribute("aria-pressed", "true");
  await expect(library).toHaveAttribute("open", "");
  await expect(apply).toBeFocused();

  await page.locator("#studio-tools").click();
  await page.locator("#global-undo").click();
  await expect
    .poll(async () => (await savedProject(page, "grain")).progression.chords)
    .toEqual(project.progression.chords);
  await page.locator("#studio-tools").click();

  await library.locator('[data-progression-group="Deep"]').click();
  await library.locator("[data-progression-random]").click();
  await expect
    .poll(async () => {
      const current = await savedProject(page, "grain");
      return CHORD_PROGRESSIONS.some(
        (item) =>
          item.group === "Deep" &&
          JSON.stringify(progressionEntryChords(item, current.scale)) ===
            JSON.stringify(current.progression.chords),
      );
    })
    .toBe(true);
  await expect(
    library.locator('[data-chord-progression][aria-pressed="true"]'),
  ).toHaveCount(1);
});

for (const width of [320, 390])
  test(`the Chords panel and library fit ${width}px without horizontal scrolling`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 812 });
    await prepare(page, "fluff");
    const chords = await openChords(page);
    const library = await openLibrary(chords);
    for (const group of await library
      .locator("[data-progression-group]")
      .all()) {
      await group.click();
      for (const box of await library
        .locator(
          ".progression-option, [data-progression-group], [data-progression-random]",
        )
        .evaluateAll((elements) =>
          elements
            .filter((element) => element.getClientRects().length > 0)
            .map((element) => element.getBoundingClientRect()),
        )) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
    }
    await chords.locator('[data-chord-slot="3"]').click();
    for (const box of await chords
      .locator("[data-chord-quality], [data-chord-borrow], [data-chord-slot]")
      .evaluateAll((elements) =>
        elements
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => element.getBoundingClientRect()),
      )) {
      expect(box.right).toBeLessThanOrEqual(width);
    }
  });

test("previews never reach the WAV export, and colours change the exported audio", async ({
  page,
}) => {
  test.setTimeout(240000);
  await prepare(page, "fluff");
  const chords = await openChords(page);
  const exportWav = async () => {
    await page.locator("#studio-tools").click();
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export WAV", exact: true }).click();
    const path = await (await downloaded).path();
    await page.locator("#studio-tools").click();
    if (!path) throw new Error("Missing export.");
    return readFile(path);
  };
  const offline = () => page.evaluate(() => window.chordProbe.offlineStarts);
  const first = await exportWav();
  const firstStarts = await offline();
  await chords.locator('[data-chord-slot="1"]').click();
  const library = await openLibrary(chords);
  await library.locator("[data-progression-audition]").first().click();
  await page.waitForTimeout(500);
  const second = await exportWav();
  expect(second.length).toBe(first.length);
  expect((await offline()) - firstStarts).toBe(firstStarts);
  const energy = (wav: Buffer) => {
    let sum = 0;
    for (let index = 44; index + 1 < wav.length; index += 2)
      sum += wav.readInt16LE(index) ** 2;
    return sum;
  };
  expect(
    Math.abs(10 * Math.log10(energy(second) / energy(first))),
  ).toBeLessThan(0.05);

  const difference = await page.evaluate(async () => {
    const audio = await import("/src/audio.ts");
    const presets = await import("/src/presets.ts");
    const render = async (colour: boolean) => {
      const project = presets.createPreset("fluff-cotton");
      if (colour)
        project.progression.chords = project.progression.chords.map(
          (chord, index) => ({
            ...chord,
            quality: index % 2 ? "sus2" : "ninth",
          }),
        );
      const blob = await new audio.AudioEngine(() => {}).exportWav(project);
      return new Int16Array((await blob.arrayBuffer()).slice(44));
    };
    const plain = await render(false),
      coloured = await render(true),
      again = await render(false);
    const distance = (a: Int16Array, b: Int16Array) => {
      let sum = 0,
        total = 0;
      for (let index = 0; index < a.length; index++) {
        sum += ((a[index] ?? 0) - (b[index] ?? 0)) ** 2;
        total += (a[index] ?? 0) ** 2;
      }
      return sum / Math.max(1, total);
    };
    return {
      coloured: distance(plain, coloured),
      repeat: distance(plain, again),
      length: plain.length === coloured.length,
    };
  });
  expect(difference.length).toBe(true);
  expect(difference.coloured).toBeGreaterThan(0.05);
  expect(difference.coloured).toBeGreaterThan(difference.repeat * 5);
});
