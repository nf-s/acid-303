import { test, expect } from "@playwright/test";
import type { Page, Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  BASS_SOUNDS,
  KEYS_SOUNDS,
  DRUM_META,
  createProject,
  projectSchema,
  scaleNotes,
} from "../src/model";
import { createPreset, presetsForMode } from "../src/presets";
import { ARP_SOUNDS } from "../src/arp-model";
import { PAD_SOUNDS } from "../src/pad-model";
import { trackStepCount } from "../src/timing";

const PRESETS = presetsForMode("grain");

async function seedFactoryProject(page: Page): Promise<void> {
  await page.addInitScript((project) => {
    if (localStorage.getItem("acid-303-project-v1") === null)
      localStorage.setItem("acid-303-project-v1", JSON.stringify(project));
  }, createProject());
}

async function openTrackControls(page: Page): Promise<void> {
  const button = page.locator("#studio-tools");
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
}

async function openVisualizerControls(page: Page): Promise<void> {
  const controls = page.locator("#visualizer-toolbar");
  if (!(await controls.isVisible())) await page.locator("#studio-view").click();
}

async function dragUp(
  page: Page,
  control: Locator,
  pixels: number,
): Promise<void> {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  if (!box) throw new Error("Control is not visible.");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - pixels, { steps: 6 });
  await page.mouse.up();
}
async function point(page: Page, row: number, step: number, scroll = true) {
  const canvas = page.locator("#beat-canvas");
  if (scroll) await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Beat canvas is missing.");
  return {
    x: box.x + 54 + ((step + 0.5) * (box.width - 62)) / 16,
    y: box.y + 27 + ((row + 0.5) * (box.height - 35)) / 5,
  };
}
async function stroke(page: Page, row: number): Promise<void> {
  const first = await point(page, row, 0);
  const last = await point(page, row, 15);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(last.x, last.y);
  await page.mouse.up();
}

test("direct sound buttons and pitch gestures persist without dropdowns", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seedFactoryProject(page);
  await page.goto("/");
  await expect(page.locator("select")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Select and preview Rimshot", exact: true })
    .click();
  await page.getByRole("button", { name: "Click", exact: true }).click();
  await dragUp(
    page,
    page.getByRole("slider", { name: "Rimshot pitch", exact: true }),
    60,
  );
  await expect(
    page.getByRole("slider", { name: "Rimshot pitch", exact: true }),
  ).toHaveAttribute("aria-valuenow", "12");
  await page
    .getByRole("slider", { name: "Rimshot decay", exact: true })
    .press("ArrowUp");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("acid-303-project-v1")),
    )
    .toContain('"pitch":12');
  await page.reload();
  await page
    .getByRole("button", { name: "Select and preview Rimshot", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Click", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("slider", { name: "Rimshot pitch", exact: true }),
  ).toHaveAttribute("aria-valuenow", "12");
  await expect(
    page.getByRole("slider", { name: "Rimshot decay", exact: true }),
  ).toHaveAttribute("aria-valuenow", "130");
  expect(errors).toEqual([]);
});

test("fast painting and erasing fills every crossed step, with keyboard access", async ({
  page,
}) => {
  await page.goto("/");
  await stroke(page, 0);
  await expect(
    page.locator('[data-drum-step="kick"][aria-pressed="true"]'),
  ).toHaveCount(0);
  await stroke(page, 0);
  await expect(
    page.locator('[data-drum-step="kick"][aria-pressed="true"]'),
  ).toHaveCount(16);
  const first = page.getByRole("gridcell", {
    name: "Kick step 1",
    exact: true,
  });
  await first.focus();
  await first.press("Enter");
  await expect(first).toHaveAttribute("aria-pressed", "false");
  await first.press("ArrowRight");
  await expect(
    page.getByRole("gridcell", { name: "Kick step 2", exact: true }),
  ).toBeFocused();
});

test("one-tap remix preserves sound settings and Undo restores the beat", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("slider", { name: "Kick pitch", exact: true })
    .press("PageUp");
  const original = await page
    .locator("[data-drum-step]")
    .evaluateAll((steps) =>
      steps.map((step) => step.getAttribute("aria-pressed")),
    );
  await page.getByRole("button", { name: "Remix", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop pattern", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "Kick pitch", exact: true }),
  ).toHaveAttribute("aria-valuenow", "8");
  await page.locator("#undo-remix").click();
  expect(
    await page
      .locator("[data-drum-step]")
      .evaluateAll((steps) =>
        steps.map((step) => step.getAttribute("aria-pressed")),
      ),
  ).toEqual(original);
  await expect(page.locator("#undo-remix")).toBeDisabled();
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
});

test("exports valid audible stereo audio", async ({ page }) => {
  await page.goto("/");
  await openTrackControls(page);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export WAV", exact: true }).click();
  const path = await (await downloaded).path();
  if (!path) throw new Error("No WAV file was downloaded.");
  const wav = await readFile(path);
  expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
  expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
  expect(wav.readUInt16LE(22)).toBe(2);
  expect(wav.readUInt32LE(24)).toBe(44100);
  let peak = 0;
  for (let index = 44; index < wav.length; index += 2)
    peak = Math.max(peak, Math.abs(wav.readInt16LE(index)));
  expect(peak).toBeGreaterThan(1000);
  expect(peak).toBeLessThan(32767);
});

test("two fingers paint one lane while changing another instrument pitch", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  const session = await context.newCDPSession(page);
  await page.locator("#kick-pitch").scrollIntoViewIfNeeded();
  // The sticky transport only reaches its pinned position after the first scroll.
  for (let pass = 0; pass < 2; pass++)
    await page.locator("#kick-pitch").evaluate((knob) => {
      const transport = document.querySelector(".transport");
      if (!transport) throw new Error("Transport is missing.");
      window.scrollBy({
        top:
          knob.getBoundingClientRect().top -
          transport.getBoundingClientRect().bottom -
          85,
        behavior: "instant",
      });
    });
  const first = await point(page, 1, 0, false);
  const last = await point(page, 1, 15, false);
  const knob = await page
    .getByRole("slider", { name: "Kick pitch", exact: true })
    .boundingBox();
  if (!knob) throw new Error("Pitch dial missing.");
  const x = knob.x + knob.width / 2;
  const y = knob.y + knob.height / 2;
  expect(
    await page.evaluate(
      ({ x, y }) =>
        Boolean(document.elementFromPoint(x, y)?.closest("#kick-pitch")),
      { x, y },
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.id,
      first,
    ),
  ).toBe("beat-canvas");
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 1, x, y }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 1, x, y },
      { id: 2, x: first.x, y: first.y },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { id: 1, x, y: y - 60 },
      { id: 2, x: last.x, y: last.y },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(
    page.locator('[data-drum-step="snare"][aria-pressed="true"]'),
  ).toHaveCount(16);
  await page
    .getByRole("button", { name: "Select and preview Kick", exact: true })
    .tap();
  await expect(
    page.getByRole("slider", { name: "Kick pitch", exact: true }),
  ).toHaveAttribute("aria-valuenow", "12");
  await context.close();
});

test("recovers from corrupted saved data", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("acid-303-project-v1", '{"version":1,"bpm":0}'),
  );
  await page.goto("/");
  await openTrackControls(page);
  await expect(
    page.getByRole("slider", { name: "Tempo in BPM", exact: true }),
  ).toHaveAttribute("aria-valuenow", String(createPreset("techno").bpm));
  await expect(page.locator("[data-drum-step]")).toHaveCount(80);
});

test("upgrades saved cowbell and slide patterns without losing user steps", async ({
  page,
}) => {
  const current = createProject();
  const legacy = {
    version: 1,
    name: current.name,
    bpm: 137,
    swing: current.swing,
    drive: 0.28,
    volume: current.volume,
    drums: current.drums.map((track) => ({
      ...track,
      id: track.id === "rim" ? "cowbell" : track.id,
      pitch: track.id === "rim" ? 7 : track.pitch,
    })),
    bass: {
      ...current.bass,
      steps: current.bass.steps.map((step) => ({ ...step, slide: true })),
    },
  };
  await page.addInitScript(
    (saved) => localStorage.setItem("acid-303-project-v1", saved),
    JSON.stringify(legacy),
  );
  await page.goto("/");
  await openTrackControls(page);
  await expect(
    page.getByRole("slider", { name: "Tempo in BPM", exact: true }),
  ).toHaveAttribute("aria-valuenow", "137");
  await page
    .getByRole("button", { name: "Select and preview Rimshot", exact: true })
    .click();
  await expect(
    page.getByRole("slider", { name: "Rimshot pitch", exact: true }),
  ).toHaveAttribute("aria-valuenow", "7");
  await expect(
    page.getByRole("gridcell", { name: "Rimshot step 4", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("slider", { name: "Texture note step 1", exact: true }),
  ).toHaveAttribute("aria-valuenow", "57");
  await page
    .getByRole("slider", { name: "Rimshot pitch", exact: true })
    .press("ArrowUp");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("acid-303-project-v1")),
    )
    .toContain(`"version":${createProject().version}`);
});

async function savedProject(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("acid-303-project-v1")),
    )
    .not.toBeNull();
  const saved = await page.evaluate(() =>
    localStorage.getItem("acid-303-project-v1"),
  );
  if (!saved) throw new Error("Project has not saved.");
  const data: unknown = JSON.parse(saved);
  return projectSchema.parse(data);
}
async function matrixPoint(
  page: Page,
  track: string,
  step: number,
  height: number,
  automation = false,
) {
  const canvas = page.locator(
    automation && (track === "bass" || track === "keys")
      ? `#${track}-automation-canvas`
      : `#${track}-matrix-canvas`,
  );
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Matrix missing.");
  return {
    x: box.x + 34 + ((step + 0.5) * (box.width - 42)) / 16,
    y: box.y + 24 + (box.height - 52) * height,
  };
}
async function matrixStroke(
  page: Page,
  track: string,
  first: number,
  last: number,
  y1: number,
  y2 = y1,
  automation = false,
) {
  const start = await matrixPoint(page, track, first, y1, automation);
  const end = await matrixPoint(page, track, last, y2, automation);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

async function automationPoint(
  page: Page,
  track: string,
  step: number,
  height: number,
) {
  return matrixPoint(page, track, step, height, true);
}
async function automationStroke(
  page: Page,
  track: string,
  first: number,
  last: number,
  y1: number,
  y2 = y1,
) {
  await matrixStroke(page, track, first, last, y1, y2, true);
}
async function openChords(page: Page): Promise<Locator> {
  await page.locator("#pad-edit-chords").click();
  return page.locator("#progression-controls .project-chord-editor");
}
async function setPadBars(page: Page, bars: number): Promise<void> {
  await changeTiming(
    page.locator("#pad-pattern-controls"),
    bars,
    "4/4",
    "straight",
  );
}

test("draws a scale-locked pitch line across all steps and undoes the complete stroke", async ({
  page,
}) => {
  await seedFactoryProject(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  for (const [track, label] of [
    ["bass", "Bass"],
    ["keys", "Texture"],
  ]) {
    if (!track || !label) throw new Error("Missing track.");
    const original = await page
      .locator(`#${track}-matrix-access [role=slider]`)
      .evaluateAll((controls) =>
        controls.map((control) => [
          control.getAttribute("aria-valuenow"),
          control.getAttribute("data-on"),
        ]),
      );
    await page
      .getByRole("group", { name: `${label} drawing tool`, exact: true })
      .getByRole("button", { name: "Line", exact: true })
      .click();
    await matrixStroke(page, track, 0, 15, 0.9, 0.1);
    const values = await page
      .locator(`#${track}-matrix-access [role=slider]`)
      .evaluateAll((controls) =>
        controls.map((control) =>
          Number(control.getAttribute("aria-valuenow")),
        ),
      );
    expect(values).not.toEqual(original.map(([note]) => Number(note)));
    expect(
      values.every(
        (note, index) => index === 0 || note >= (values[index - 1] ?? 0),
      ),
    ).toBe(true);
    expect(
      values.every((note) => [0, 2, 4, 5, 7, 9, 11].includes(note % 12)),
    ).toBe(true);
    await expect(
      page.locator(`#${track}-matrix-access [data-on=true]`),
    ).toHaveCount(16);
    await page
      .getByRole("button", { name: `Undo ${label} drawing`, exact: true })
      .click();
    expect(
      await page
        .locator(`#${track}-matrix-access [role=slider]`)
        .evaluateAll((controls) =>
          controls.map((control) => [
            control.getAttribute("aria-valuenow"),
            control.getAttribute("data-on"),
          ]),
        ),
    ).toEqual(original);
  }
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
});

test("matrix parameter tabs paint gates, accents and glide without arrow buttons", async ({
  page,
}) => {
  await seedFactoryProject(page);
  await page.goto("/");
  const modes = page.getByRole("group", {
    name: "Bass matrix parameter",
    exact: true,
  });
  await modes.getByRole("button", { name: "Gate", exact: true }).click();
  await matrixStroke(page, "bass", 0, 15, 0.8);
  await expect(page.locator("#bass-matrix-access [data-on=true]")).toHaveCount(
    0,
  );
  await modes.getByRole("button", { name: "Glide", exact: true }).click();
  await matrixStroke(page, "bass", 2, 5, 0.2);
  await expect(
    page.locator("#bass-matrix-access [data-slide=true]"),
  ).toHaveCount(4);
  await expect(page.locator("#bass-matrix-access [data-on=true]")).toHaveCount(
    5,
  );
  await modes.getByRole("button", { name: "Accent", exact: true }).click();
  await matrixStroke(page, "bass", 0, 15, 0.8);
  await matrixStroke(page, "bass", 2, 3, 0.2);
  await expect(
    page.locator("#bass-matrix-access [data-accent=true]"),
  ).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: /Bass slide step/ }),
  ).toHaveCount(0);
  await modes.getByRole("button", { name: "Pitch", exact: true }).click();
  const note = page.getByRole("slider", {
    name: "Bass note step 3",
    exact: true,
  });
  const before = Number(await note.getAttribute("aria-valuenow"));
  await note.press("ArrowUp");
  expect(Number(await note.getAttribute("aria-valuenow"))).toBeGreaterThan(
    before,
  );
  await note.press("ArrowRight");
  await expect(
    page.getByRole("slider", { name: "Bass note step 4", exact: true }),
  ).toBeFocused();
  await expect
    .poll(
      async () =>
        (await savedProject(page)).bass.steps.filter((step) => step.slide)
          .length,
    )
    .toBe(4);
  await page.reload();
  await expect(
    page.locator("#bass-matrix-access [data-slide=true]"),
  ).toHaveCount(4);
});

test("scale picker locks drawing, keyboard tuning, presets and remix to the selected key", async ({
  page,
}) => {
  await page.goto("/");
  await openTrackControls(page);
  await openTrackControls(page);
  await page.getByRole("button", { name: "Root F♯", exact: true }).click();
  await page.getByRole("button", { name: "Dorian", exact: true }).click();
  await page
    .getByRole("slider", { name: "Kick pitch", exact: true })
    .press("ArrowUp");
  await expect(
    page.getByRole("slider", { name: "Kick pitch", exact: true }),
  ).toHaveAttribute("aria-valuenow", "2");
  await matrixStroke(page, "bass", 0, 15, 0.95, 0.05);
  await matrixStroke(page, "keys", 0, 15, 0.8, 0.2);
  await expect
    .poll(async () => (await savedProject(page)).scale)
    .toEqual({ root: 6, mode: "dorian" });
  for (const preset of PRESETS) {
    await page
      .getByRole("button", {
        name: `${preset.name} — ${preset.genre}`,
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await savedProject(page)).name)
      .toBe(preset.name);
    const project = await savedProject(page);
    expect(project.scale).toEqual({ root: 6, mode: "dorian" });
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
      project.drums.every((drum) =>
        scaleNotes({ root: 0, mode: "dorian" }, -24, 24).includes(drum.pitch),
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Remix", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Root F♯", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () =>
      (await savedProject(page)).bass.steps.every((step) =>
        scaleNotes({ root: 6, mode: "dorian" }, 24, 60).includes(step.note),
      ),
    )
    .toBe(true);
  await page.reload();
  await openTrackControls(page);
  await expect(
    page.getByRole("button", { name: "Dorian", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("all new Texture and drum sounds are directly selectable and persist", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const sounds = page.getByRole("group", {
    name: "Texture sound",
    exact: true,
  });
  await expect(sounds.getByRole("button")).toHaveCount(KEYS_SOUNDS.length);
  for (const sound of ["Scatter", "Dub", "Frost"]) {
    await sounds.getByRole("button", { name: sound, exact: true }).click();
    await expect(
      sounds.getByRole("button", { name: sound, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await page
    .getByRole("button", { name: "Select and preview Hi-hat", exact: true })
    .click();
  await expect(
    page
      .getByRole("group", { name: "Hi-hat sounds", exact: true })
      .getByRole("button"),
  ).toHaveCount(DRUM_META.hat.sounds.length);
  await page
    .getByRole("group", { name: "Hi-hat sounds", exact: true })
    .getByRole("button")
    .last()
    .click();
  await expect
    .poll(
      async () =>
        (await savedProject(page)).drums.find((drum) => drum.id === "hat")
          ?.sound,
    )
    .toBe(DRUM_META.hat.sounds.length - 1);
  await page.reload();
  await expect(
    sounds.getByRole("button", { name: "Frost", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("mobile matrix fits every step and two fingers can draw separate pitches", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  const session = await context.newCDPSession(page);
  const a = await matrixPoint(page, "keys", 1, 0.8),
    b = await matrixPoint(page, "keys", 12, 0.2);
  const first = { id: 1, ...a },
    second = { id: 2, ...b };
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [first],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [first, second],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { ...first, y: a.y - 70 },
      { ...second, y: b.y + 70 },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(
    page.getByRole("slider", { name: "Texture note step 2", exact: true }),
  ).toHaveAttribute("data-on", "true");
  await expect(
    page.getByRole("slider", { name: "Texture note step 13", exact: true }),
  ).toHaveAttribute("data-on", "true");
  const last = await page
    .getByRole("slider", { name: "Texture note step 16", exact: true })
    .boundingBox();
  expect(last && last.x + last.width).toBeLessThan(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  const before = await page.evaluate(() => scrollY);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 1, x: 8, y: 400 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ id: 1, x: 8, y: 650 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(before);
  await context.close();
});

test("visualizer defaults on at 30%, responds silently, and pauses all grain and flow", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await openTrackControls(page);
  await page.evaluate(() => document.fonts.ready);
  const stage = page.locator("#visualizer-panel");
  await expect(stage).toHaveCSS("opacity", "0.3");
  await expect(
    page.getByRole("slider", { name: "Visualizer intensity", exact: true }),
  ).toHaveAttribute("aria-valuenow", "30");
  await expect(
    page.getByRole("button", { name: "Pause visualizer motion", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("slider", { name: "Master volume", exact: true })
    .press("Home");
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  const frame = () =>
    page
      .locator("#fluid-canvas")
      .evaluate((canvas) =>
        canvas instanceof HTMLCanvasElement ? canvas.toDataURL() : "",
      );
  const start = await frame();
  await page.waitForTimeout(350);
  expect(await frame()).not.toBe(start);
  await page
    .getByRole("button", { name: "Pause visualizer motion", exact: true })
    .click();
  const paused = await frame();
  await page.waitForTimeout(350);
  expect(await frame()).toBe(paused);
  const intensity = page.getByRole("slider", {
    name: "Visualizer intensity",
    exact: true,
  });
  await intensity.press("End");
  await expect(stage).toHaveCSS("opacity", "1");
  expect(await frame()).toBe(paused);
  await intensity.press("Home");
  await expect(stage).toHaveCSS("visibility", "hidden");
  await intensity.dblclick();
  await expect(stage).toHaveCSS("opacity", "0.3");
  await expect(stage).toHaveCSS("visibility", "visible");
  await page
    .getByRole("button", { name: "Enable visualizer motion", exact: true })
    .click();
  await expect.poll(frame).not.toBe(paused);
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
  const stopped = await frame();
  await page.waitForTimeout(250);
  expect(await frame()).toBe(stopped);
});

test("examples swipe horizontally and swirl changes visuals without changing the track", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  const strip = page.locator(".preset-options");
  const box = await strip.boundingBox();
  if (!box) throw new Error("Example strip is missing");
  const session = await context.newCDPSession(page);
  const y = box.y + box.height / 2;
  const scrollBefore = await page.evaluate(() => scrollY);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 1, x: box.x + box.width - 10, y }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ id: 1, x: box.x + 10, y: y + 40 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() => strip.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(30);
  expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);
  expect(await strip.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(strip).toHaveCSS("overflow-y", "hidden");
  const heading = await page.locator("#drums-title").boundingBox();
  if (!heading) throw new Error("Drum heading is missing.");
  const outsideX = heading.x + heading.width / 2;
  const outsideY = heading.y + heading.height / 2;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 2, x: outsideX, y: outsideY }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ id: 2, x: outsideX, y: outsideY - 160 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeGreaterThan(scrollBefore);
  await expect(page.locator(".preset-section")).toHaveCSS(
    "overflow-x",
    "visible",
  );
  expect(
    await page
      .locator(".preset-section")
      .evaluate((element) => element.clientHeight),
  ).toBeLessThan(125);
  await expect(page.locator("[data-preset]")).toHaveCount(PRESETS.length);
  await openTrackControls(page);
  await page
    .getByRole("slider", { name: "Master volume", exact: true })
    .press("Home");
  await page.locator("#studio-tools").click();
  await openVisualizerControls(page);
  const before = await page.evaluate(() =>
    localStorage.getItem("acid-303-project-v1"),
  );
  const swirl = page.getByRole("slider", {
    name: "Visualizer swirl",
    exact: true,
  });
  await expect(swirl).toHaveAttribute("aria-valuenow", "0");
  const frame = () =>
    page
      .locator("#fluid-canvas")
      .evaluate((canvas) =>
        canvas instanceof HTMLCanvasElement ? canvas.toDataURL() : "",
      );
  const original = await frame();
  await swirl.press("End");
  expect(await frame()).not.toBe(original);
  expect(
    await page.evaluate(() => localStorage.getItem("acid-303-project-v1")),
  ).toBe(before);
  await page.reload();
  await openVisualizerControls(page);
  await expect(swirl).toHaveAttribute("aria-valuenow", "100");
  await swirl.dblclick();
  await expect(swirl).toHaveAttribute("aria-valuenow", "0");
  await expect(page.locator("#visualizer-panel")).toHaveCSS("opacity", "0.3");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  await context.close();
});

test("phone fullscreen visualizer and sticky playback remain accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await openVisualizerControls(page);
  await expect(page.locator("#fullscreen svg")).toBeVisible();
  await page.locator("#keys-matrix-canvas").scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "Play pattern", exact: true }),
  ).toBeInViewport();
  await page
    .getByRole("button", { name: "Fullscreen visualizer", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Exit fullscreen visualizer",
      exact: true,
    }),
  ).toBeVisible();
  await page.mouse.click(180, 300);
  await expect(page.locator("body")).not.toHaveClass(/visualizer-expanded/);
  await expect(page.locator(".preset-section")).toBeVisible();
  await page
    .getByRole("button", { name: "Fullscreen visualizer", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Exit fullscreen visualizer", exact: true })
    .click();
  expect((await page.locator("#fluid-canvas").boundingBox())?.height).toBe(812);
  await page.evaluate(() => {
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      value: undefined,
      configurable: true,
    });
  });
  await page.locator("#fullscreen").click();
  await expect(page.locator("#visualizer-panel")).toHaveClass(/expanded/);
  await page.mouse.click(20, 20);
  await expect(page.locator("body")).not.toHaveClass(/visualizer-expanded/);
});

test("visualizer palettes colour the fluid, persist locally and freeze with motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await openVisualizerControls(page);
  const colour = page.getByRole("button", { name: "Colour", exact: true });
  await colour.click();
  await expect(
    page.getByRole("button", { name: "Mono", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const frame = () =>
    page
      .locator("#fluid-canvas")
      .evaluate((canvas) =>
        canvas instanceof HTMLCanvasElement ? canvas.toDataURL() : "",
      );
  const mono = await frame();
  for (const name of ["Cobalt", "Violet", "Ember", "Rainbow"]) {
    const option = page.getByRole("button", { name, exact: true });
    await option.click();
    await expect(option).toHaveAttribute("aria-pressed", "true");
    expect(await frame()).not.toBe(mono);
  }
  const colouredPixels = await page
    .locator("#fluid-canvas")
    .evaluate((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) return 0;
      const sample = document.createElement("canvas");
      sample.width = sample.height = 32;
      const context = sample.getContext("2d");
      if (!context) return 0;
      context.drawImage(canvas, 0, 0, 32, 32);
      const data = context.getImageData(0, 0, 32, 32).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const channels = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
        if (Math.max(...channels) - Math.min(...channels) > 30) count++;
      }
      return count;
    });
  expect(colouredPixels).toBeGreaterThan(100);
  await page.reload();
  await openVisualizerControls(page);
  await colour.click();
  await expect(
    page.getByRole("button", { name: "Rainbow", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.locator("#fullscreen").click();
  await colour.click();
  await expect(
    page.getByRole("button", { name: "Rainbow", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await openTrackControls(page);
  await page
    .getByRole("slider", { name: "Master volume", exact: true })
    .press("Home");
  await page.locator("#studio-tools").click();
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  const moving = await frame();
  await expect.poll(frame).not.toBe(moving);
  await page
    .getByRole("button", { name: "Pause visualizer motion", exact: true })
    .click();
  const paused = await frame();
  await page.waitForTimeout(250);
  expect(await frame()).toBe(paused);
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
  await colour.click();
  await page.getByRole("button", { name: "Mono", exact: true }).click();
  await expect(page.locator("#visualizer-panel")).toHaveCSS("opacity", "0.3");
  await page.reload();
  await openVisualizerControls(page);
  await colour.click();
  await expect(
    page.getByRole("button", { name: "Mono", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("retracting a glide line restores gates outside the final stroke", async ({
  page,
}) => {
  await seedFactoryProject(page);
  await page.goto("/");
  await expect(page.locator("#bass-matrix-access [role=slider]")).toHaveCount(
    16,
  );
  const gates = () =>
    page
      .locator("#bass-matrix-access [role=slider]")
      .evaluateAll((controls) =>
        controls.map((control) => control.getAttribute("data-on")),
      );
  const original = await gates();
  await page
    .getByRole("group", { name: "Bass matrix parameter", exact: true })
    .getByRole("button", { name: "Glide", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Bass drawing tool", exact: true })
    .getByRole("button", { name: "Line", exact: true })
    .click();
  const start = await matrixPoint(page, "bass", 2, 0.2),
    far = await matrixPoint(page, "bass", 10, 0.2),
    end = await matrixPoint(page, "bass", 3, 0.2);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(far.x, far.y, { steps: 6 });
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  expect(await gates()).toEqual(original);
  await expect(
    page.locator("#bass-matrix-access [data-slide=true]"),
  ).toHaveCount(2);
});

test("generating a new sequence clears stale drawing undo", async ({
  page,
}) => {
  await page.goto("/");
  for (const [label, region, button] of [
    ["Bass", "Acid bass", "Generate"],
    ["Texture", "Texture", "New pattern"],
  ]) {
    if (!label || !region || !button) throw new Error("Missing track.");
    await page
      .getByRole("slider", { name: `${label} note step 1`, exact: true })
      .press("ArrowUp");
    const undo = page.getByRole("button", {
      name: `Undo ${label} drawing`,
      exact: true,
    });
    await expect(undo).toBeEnabled();
    await page
      .getByRole("region", { name: region, exact: true })
      .getByRole("button", { name: button, exact: true })
      .click();
    await expect(undo).toBeDisabled();
  }
});

test("automation lines retract, undo and clear without changing notes", async ({
  page,
}) => {
  await seedFactoryProject(page);
  await page.goto("/");
  await page.locator("#cutoff").click();
  await expect(page.locator("#bass-automation-label")).toHaveText(
    "Cutoff automation",
  );
  await expect(
    page.getByRole("button", { name: "Clear Bass automation", exact: true }),
  ).toBeDisabled();
  const original = createProject();
  await page
    .getByRole("group", { name: "Bass automation drawing tool", exact: true })
    .getByRole("button", { name: "Line", exact: true })
    .click();
  const start = await automationPoint(page, "bass", 2, 0.8);
  const far = await automationPoint(page, "bass", 10, 0.1);
  const end = await automationPoint(page, "bass", 3, 0.2);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(far.x, far.y, { steps: 4 });
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => (await savedProject(page)).bass.automation.cutoff?.[3])
    .toBeCloseTo(0.8, 1);
  const drawn = await savedProject(page);
  expect(drawn.bass.steps).toEqual(original.bass.steps);
  const base = Math.log(original.bass.cutoff / 80) / Math.log(100);
  expect(drawn.bass.automation.cutoff?.slice(4)).toEqual(Array(12).fill(base));
  await page
    .getByRole("button", { name: "Undo Bass automation", exact: true })
    .click();
  await expect
    .poll(async () => (await savedProject(page)).bass.automation.cutoff)
    .toBeNull();
  await automationStroke(page, "bass", 0, 15, 0.9, 0.1);
  await expect
    .poll(async () => (await savedProject(page)).bass.automation.cutoff?.[15])
    .toBeCloseTo(0.9, 1);
  const curve = (await savedProject(page)).bass.automation.cutoff;
  await page
    .getByRole("button", { name: "Clear Bass automation", exact: true })
    .click();
  await expect
    .poll(async () => (await savedProject(page)).bass.automation.cutoff)
    .toBeNull();
  await page
    .getByRole("button", { name: "Undo Bass automation", exact: true })
    .click();
  await expect
    .poll(async () => (await savedProject(page)).bass.automation.cutoff)
    .toEqual(curve);
  await page.reload();
  await expect(page.locator("#cutoff")).toHaveAttribute(
    "data-automated",
    "true",
  );
  await page.locator("#cutoff").press("Enter");
  await expect(page.locator("#bass-automation-label")).toHaveText(
    "Cutoff automation",
  );
  expect((await savedProject(page)).bass.steps).toEqual(original.bass.steps);
});

test("every Bass and Texture knob opens editable automation and manual changes shift the curve", async ({
  page,
}) => {
  await seedFactoryProject(page);
  await page.goto("/");
  const controls = [
    { track: "bass", id: "cutoff" },
    { track: "bass", id: "resonance" },
    { track: "bass", id: "envelope" },
    { track: "bass", id: "bass-decay" },
    { track: "bass", id: "bass-volume" },
    { track: "bass", id: "bass-shape" },
    { track: "bass", id: "bass-drive" },
    { track: "bass", id: "bass-pulse" },
    { track: "keys", id: "keys-tone" },
    { track: "keys", id: "keys-decay" },
    { track: "keys", id: "keys-space" },
    { track: "keys", id: "keys-volume" },
    { track: "keys", id: "keys-grit" },
    { track: "keys", id: "keys-motion" },
    { track: "keys", id: "keys-width" },
    { track: "keys", id: "keys-attack" },
  ];
  for (const control of controls) {
    await page.locator(`#${control.id}`).press("Enter");
    const step = page
      .locator(`#${control.track}-automation-access [role=slider]`)
      .first();
    await step.press("End");
    await expect(step).toHaveAttribute("aria-valuenow", "100");
    await expect(page.locator(`#${control.id}`)).toHaveAttribute(
      "data-automated",
      "true",
    );
  }
  await expect
    .poll(async () =>
      Object.values((await savedProject(page)).keys.automation).every(
        (lane) => lane?.[0] === 1,
      ),
    )
    .toBe(true);
  const before = await savedProject(page);
  expect(
    Object.values(before.bass.automation).every((lane) => lane?.[0] === 1),
  ).toBe(true);
  expect(before.bass.steps).toEqual(createProject().bass.steps);
  expect(before.keys.steps).toEqual(createProject().keys.steps);
  await page.locator("#keys-motion").press("Enter");
  await automationStroke(page, "keys", 0, 15, 0.8, 0.4);
  await expect
    .poll(async () => (await savedProject(page)).keys.automation.motion?.[15])
    .toBeCloseTo(0.6, 1);
  const curve = (await savedProject(page)).keys.automation.motion;
  if (!curve) throw new Error("Motion curve was not saved.");
  await dragUp(page, page.locator("#keys-motion"), 24);
  await expect
    .poll(async () => (await savedProject(page)).keys.motion)
    .toBeCloseTo(0.1, 2);
  const shifted = (await savedProject(page)).keys.automation.motion;
  curve.forEach((value, index) =>
    expect(shifted?.[index]).toBeCloseTo(Math.min(1, value + 0.1), 8),
  );
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  await expect
    .poll(() => page.locator("#bar-position").textContent())
    .not.toBe("Beat 1");
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
  await page.reload();
  await expect(page.locator("[data-automated=true]")).toHaveCount(16);
});

test("phone sound selection, expression controls and tap automation persist without overflow", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seedFactoryProject(page);
  await page.goto("/");
  const sounds = page.getByRole("group", { name: "Bass sound", exact: true });
  await expect(sounds.getByRole("button")).toHaveCount(BASS_SOUNDS.length);
  for (const sound of BASS_SOUNDS) {
    await sounds.getByRole("button", { name: sound, exact: true }).tap();
    await expect(
      sounds.getByRole("button", { name: sound, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await page.locator("#bass-shape").tap();
  await expect(page.locator("#bass-automation-label")).toHaveText(
    "Shape automation",
  );
  await page
    .locator("#bass-automation-access [role=slider]")
    .first()
    .press("End");
  await page.locator("#kick-tone").press("End");
  await page.locator("#kick-drive").press("PageUp");
  await expect
    .poll(async () => (await savedProject(page)).drums[0]?.drive)
    .toBe(0.1);
  await page.reload();
  await expect(sounds.getByRole("button").last()).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#kick-tone")).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  await expect(page.locator("#bass-shape")).toHaveAttribute(
    "data-automated",
    "true",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  expect(errors).toEqual([]);
  await context.close();
});

test("reversing a knob sweep restores the curve after hitting its limits", async ({
  page,
}) => {
  await page.goto("/");
  const cutoff = page.locator("#cutoff");
  await cutoff.press("Home");
  await cutoff.press("Enter");
  await automationStroke(page, "bass", 0, 15, 0.8, 0.2);
  await expect
    .poll(async () => (await savedProject(page)).bass.automation.cutoff?.[15])
    .toBeCloseTo(0.8, 1);
  const original = (await savedProject(page)).bass.automation.cutoff;
  if (!original) throw new Error("Missing cutoff automation.");
  await cutoff.scrollIntoViewIfNeeded();
  const box = await cutoff.boundingBox();
  if (!box) throw new Error("Missing cutoff knob.");
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 120, { steps: 6 });
  await expect
    .poll(async () => (await savedProject(page)).bass.cutoff)
    .toBeGreaterThan(80);
  await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => (await savedProject(page)).bass.cutoff)
    .toBe(80);
  const restored = (await savedProject(page)).bass.automation.cutoff;
  original.forEach((value, index) =>
    expect(restored?.[index]).toBeCloseTo(value, 8),
  );
});

test("phone twist adjusts only held knobs and releases without opening automation", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.addInitScript(() =>
    Object.defineProperty(DeviceMotionEvent, "requestPermission", {
      value: async () => "granted",
      configurable: true,
    }),
  );
  await page.goto("/");
  await openTrackControls(page);
  const motion = page.locator("#phone-motion");
  await motion.tap();
  await expect(motion).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Twist", exact: true }).tap();
  await page.locator("#studio-tools").tap();
  let clock = 1000;
  const twist = async (rate: number) => {
    await page.evaluate(
      ({ rate, clock }) => {
        for (let index = 0; index < 20; index++) {
          const event = new DeviceMotionEvent("devicemotion", {
            rotationRate: { alpha: 0, beta: 0, gamma: rate },
            interval: 16,
          });
          Object.defineProperty(event, "timeStamp", {
            value: clock + index * 16,
          });
          window.dispatchEvent(event);
        }
      },
      { rate, clock },
    );
    clock += 320;
  };
  const knob = page.locator("#bass-shape");
  const original = await knob.getAttribute("aria-valuenow");
  await twist(90);
  await expect(knob).toHaveAttribute("aria-valuenow", original ?? "");
  await knob.scrollIntoViewIfNeeded();
  const box = await knob.boundingBox();
  if (!box) throw new Error("Shape knob missing.");
  const session = await context.newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 },
      { id: 2, x: box.x + box.width / 2 + 4, y: box.y + box.height / 2 },
    ],
  });
  await page.waitForTimeout(160);
  await twist(90);
  const raised = Number(await knob.getAttribute("aria-valuenow"));
  expect(raised).toBeGreaterThan(Number(original));
  await twist(-90);
  const returned = await knob.getAttribute("aria-valuenow");
  expect(Number(returned)).toBeLessThan(raised);
  expect(Math.abs(Number(returned) - Number(original))).toBeLessThanOrEqual(2);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator("#bass-automation")).toBeHidden();
  await twist(90);
  await expect(knob).toHaveAttribute("aria-valuenow", returned ?? "");
  await openTrackControls(page);
  await motion.tap();
  await expect(motion).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  await context.close();
});

test("clearing a curve cancels a held line before it can restore old values", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.locator("#cutoff").press("Enter");
  await automationStroke(page, "bass", 0, 15, 0.8, 0.2);
  await page
    .getByRole("group", { name: "Bass automation drawing tool", exact: true })
    .getByRole("button", { name: "Line", exact: true })
    .click();
  const point = await automationPoint(page, "bass", 4, 0.1);
  const session = await context.newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 1, ...point }],
  });
  await page
    .getByRole("button", { name: "Clear Bass automation", exact: true })
    .click();
  await expect
    .poll(async () => (await savedProject(page)).bass.automation.cutoff)
    .toBeNull();
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.waitForTimeout(300);
  expect((await savedProject(page)).bass.automation.cutoff).toBeNull();
  await context.close();
});

test("advanced drums expose eight automated controls on every track", async ({
  page,
}) => {
  await seedFactoryProject(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(page.locator(".drum-detail")).toHaveCount(5);
  const before = createProject().drums.map((track) => track.steps);
  for (const id of ["kick", "snare", "hat", "clap", "rim"]) {
    await expect(
      page.locator(`.drum-detail:has(#${id}-matrix-canvas) .gesture-control`),
    ).toHaveCount(8);
    for (const parameter of [
      "pitch",
      "decay",
      "volume",
      "tone",
      "drive",
      "pan",
      "attack",
      "space",
    ]) {
      await page.locator(`#${id}-${parameter}`).press("Enter");
      await page
        .locator(`#${id}-matrix-access [role=slider]`)
        .first()
        .press("End");
      await expect(page.locator(`#${id}-${parameter}`)).toHaveAttribute(
        "data-automated",
        "true",
      );
    }
  }
  await expect
    .poll(async () =>
      (await savedProject(page)).drums.every((track) =>
        Object.values(track.automation).every((lane) => lane?.[0] === 1),
      ),
    )
    .toBe(true);
  expect((await savedProject(page)).drums.map((track) => track.steps)).toEqual(
    before,
  );
  await page.getByRole("button", { name: "Simple", exact: true }).click();
  await expect(page.locator("#beat-canvas")).toBeVisible();
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(page.locator(".drum-detail [data-automated=true]")).toHaveCount(
    40,
  );
  await page.reload();
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(page.locator(".drum-detail [data-automated=true]")).toHaveCount(
    40,
  );
});

test("global undo and redo restore the whole track across examples and gestures", async ({
  page,
}) => {
  await seedFactoryProject(page);
  await page.goto("/");
  await openTrackControls(page);
  await dragUp(page, page.locator("#cutoff"), 48);
  await expect
    .poll(async () => (await savedProject(page)).bass.cutoff)
    .toBeGreaterThan(createProject().bass.cutoff);
  const edited = await savedProject(page);
  await page.locator('[data-preset="house"]').click();
  await expect
    .poll(async () => (await savedProject(page)).name)
    .not.toBe(edited.name);
  const example = await savedProject(page);
  await page
    .getByRole("button", { name: "Undo last edit", exact: true })
    .click();
  await expect.poll(() => savedProject(page)).toEqual(edited);
  await page
    .getByRole("button", { name: "Undo last edit", exact: true })
    .click();
  await expect.poll(() => savedProject(page)).toEqual(createProject());
  await page
    .getByRole("button", { name: "Redo last edit", exact: true })
    .click();
  await expect.poll(() => savedProject(page)).toEqual(edited);
  await page
    .getByRole("button", { name: "Redo last edit", exact: true })
    .click();
  await expect.poll(() => savedProject(page)).toEqual(example);
  await page.keyboard.press("Control+z");
  await expect.poll(() => savedProject(page)).toEqual(edited);
  await page.locator("#keys-tone").press("ArrowUp");
  await expect(
    page.getByRole("button", { name: "Redo last edit", exact: true }),
  ).toBeDisabled();
});

test("share link loads the full track into a fresh browser context", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.locator("#kick-tone").press("End");
  await page.locator("#cutoff").press("Enter");
  await automationStroke(page, "bass", 0, 15, 0.8, 0.2);
  await expect
    .poll(async () => (await savedProject(page)).bass.automation.cutoff?.[15])
    .toBeCloseTo(0.8, 1);
  await page.locator('[data-arp-sound="2"]').click();
  await setPadBars(page, 16);
  await page
    .getByRole("button", { name: "Enable chord pads", exact: true })
    .click();
  await expect
    .poll(async () => (await savedProject(page)).pad.muted)
    .toBe(false);
  await page.locator("#arp-tone").press("Enter");
  await automationStroke(page, "arp", 0, 15, 0.7, 0.3);
  await page.locator("#pad-tone").press("Enter");
  await automationStroke(page, "pad", 0, 15, 0.8, 0.2);
  await expect
    .poll(async () => (await savedProject(page)).pad.automation.tone?.[15])
    .toBeCloseTo(0.8, 1);
  const original = await savedProject(page);
  expect(original.pad.automation.tone).toHaveLength(
    trackStepCount(original.pad.timing),
  );
  await openTrackControls(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const field = page.locator("#share-url");
  await expect(field).toBeVisible();
  const link = await field.inputValue();
  expect(link).toContain("#track=v1.");
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto(link);
  await expect.poll(() => savedProject(other)).toEqual(original);
  await expect(other.locator("#cutoff")).toHaveAttribute(
    "data-automated",
    "true",
  );
  await expect.poll(() => new URL(other.url()).hash).toBe("");
  await openTrackControls(other);
  await other.locator("#bpm").press("End");
  await expect.poll(async () => (await savedProject(other)).bpm).toBe(180);
  const edited = await savedProject(other);
  await other.reload();
  await expect.poll(() => savedProject(other)).toEqual(edited);
  await expect(other.locator("#bpm")).toHaveAttribute("aria-valuenow", "180");
  await context.close();
});

test("fluid overlay reaches transport, scale, knobs and matrices", async ({
  page,
}) => {
  await page.goto("/");
  await openTrackControls(page);
  await page.evaluate(() => document.fonts.ready);
  const intensity = page.locator("#intensity");
  for (const selector of [
    "#play",
    ".scale-panel",
    "#cutoff",
    "#bass-matrix-canvas",
    ".app-header",
  ]) {
    const target = page.locator(selector);
    await target.scrollIntoViewIfNeeded();
    await intensity.press("Home");
    const clean = await target.screenshot();
    await intensity.press("End");
    const distorted = await target.screenshot();
    expect(clean.equals(distorted)).toBe(false);
  }
  expect(
    (await page.locator(".workspace").boundingBox())?.width,
  ).toBeLessThanOrEqual(1040);
});

test("arpeggiator notes, order, rhythm and all eight controls persist with global undo", async ({
  page,
}) => {
  await seedFactoryProject(page);
  await page.goto("/");
  await openTrackControls(page);
  await expect(page.locator("#arp-panel .gesture-control")).toHaveCount(8);
  await expect(
    page
      .getByRole("group", { name: "Arpeggiator sound", exact: true })
      .getByRole("button"),
  ).toHaveCount(ARP_SOUNDS.length);
  await page.locator("[data-arp-clear=notes]").click();
  for (const note of ["E4", "A3", "C4"])
    await page
      .getByRole("button", { name: `Arpeggiator note ${note}`, exact: true })
      .click();
  await page.getByRole("button", { name: "Played", exact: true }).click();
  await page.getByRole("button", { name: "1/32", exact: true }).click();
  await page
    .getByRole("button", { name: "Arpeggiator step 2, bar 1", exact: true })
    .click();
  await page.locator("#arp-shape").press("End");
  await expect.poll(async () => (await savedProject(page)).arp.shape).toBe(1);
  const arp = (await savedProject(page)).arp;
  expect(arp.notes).toEqual([64, 57, 60]);
  expect(arp.direction).toBe("played");
  expect(arp.rate).toBe("1/32");
  expect(arp.steps[1]).toBe(false);
  await page
    .getByRole("button", { name: "Undo last edit", exact: true })
    .click();
  await expect
    .poll(async () => (await savedProject(page)).arp.shape)
    .toBe(createProject().arp.shape);
  await page
    .getByRole("button", { name: "Redo last edit", exact: true })
    .click();
  await expect.poll(async () => (await savedProject(page)).arp.shape).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Played", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await openTrackControls(page);
  await page.getByRole("button", { name: "Root F♯", exact: true }).click();
  await expect
    .poll(async () =>
      (await savedProject(page)).arp.notes.every((note) =>
        scaleNotes({ root: 6, mode: "minor" }, 48, 84).includes(note),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  await expect
    .poll(() => page.locator("[data-arp-step].current").count())
    .toBe(1);
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
});

test("shared progression length, chord edits and Pad play position work across bars", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#pad-panel .gesture-control")).toHaveCount(8);
  await expect(
    page
      .getByRole("group", { name: "Pad sound", exact: true })
      .getByRole("button"),
  ).toHaveCount(PAD_SOUNDS.length);
  await page
    .getByRole("button", { name: "Enable chord pads", exact: true })
    .click();
  const chords = await openChords(page);
  await chords.locator('[data-chord-bars="2"]').click();
  await chords.locator(".progression-presets summary").click();
  await chords.locator('[data-chord-progression="descent"]').click();
  await chords.locator('[data-chord-slot="1"]').click();
  await chords.locator('[data-chord-degree="3"]').click();
  await chords.locator('[data-chord-inversion="2"]').click();
  await page.locator("#pad-tone").press("End");
  await expect.poll(async () => (await savedProject(page)).pad.tone).toBe(1);
  const before = await savedProject(page);
  expect(before.progression.chords[1]).toEqual({ degree: 3, inversion: 2 });
  expect(before.progression.timing.bars).toBe(2);
  expect(before.pad.muted).toBe(false);
  await openTrackControls(page);
  await page.locator("#bpm").press("End");
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  await expect
    .poll(() => page.locator(".pad-position").textContent())
    .toBe("Bar 2 / 2");
  await expect(chords.locator("[data-chord-slot].current")).toHaveCount(1);
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
  await page.reload();
  expect((await savedProject(page)).progression).toEqual(before.progression);
  await expect(page.locator("#pad-tone")).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
});

test("WAV export includes all eight progression bars and release tails", async ({
  page,
}) => {
  await page.goto("/");
  await openTrackControls(page);
  await openTrackControls(page);
  await page.locator("#bpm").press("End");
  await page
    .getByRole("button", { name: "Enable chord pads", exact: true })
    .click();
  await (await openChords(page)).locator('[data-chord-bars="8"]').click();
  await openTrackControls(page);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export WAV", exact: true }).click();
  const path = await (await downloaded).path();
  if (!path) throw new Error("Missing progression WAV.");
  const wav = await readFile(path);
  const duration = (wav.length - 44) / (44100 * 4);
  expect(duration).toBeGreaterThan((60 / 180) * 4 * 8);
  let tail = 0;
  for (let index = wav.length - 4410 * 4; index < wav.length; index += 2)
    tail = Math.max(tail, Math.abs(wav.readInt16LE(index)));
  expect(tail).toBeLessThan(10);
});

test("every Arp and Pad knob opens drawable automation with clear and undo", async ({
  page,
}) => {
  await seedFactoryProject(page);
  await page.goto("/");
  await expect(page.locator(".drums-panel .preset-bar")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Examples", exact: true }),
  ).toBeVisible();
  const targets: Array<"arp" | "pad"> = ["arp", "pad"];
  for (const track of targets) {
    const knobs = page.locator(`#${track}-panel .gesture-control`);
    await expect(knobs).toHaveCount(8);
    for (let index = 0; index < 8; index++) {
      const knob = knobs.nth(index);
      await knob.press("Enter");
      await matrixStroke(page, track, 0, 15, 0.7, 0.3);
      await expect(knob).toHaveAttribute("data-automated", "true");
      await expect
        .poll(
          async () =>
            Object.values((await savedProject(page))[track].automation).filter(
              (lane) => lane !== null,
            ).length,
        )
        .toBe(index + 1);
    }
    await page.locator(`#${track}-tone`).press("Enter");
    const curve = (await savedProject(page))[track].automation.tone;
    await page.locator(`#${track}-automation-clear`).click();
    await expect
      .poll(async () => (await savedProject(page))[track].automation.tone)
      .toBeNull();
    await page.locator(`#${track}-automation-undo`).click();
    await expect
      .poll(async () => (await savedProject(page))[track].automation.tone)
      .toEqual(curve);
  }
  await setPadBars(page, 16);
  await expect(page.locator("#pad-lane-duration")).toHaveText("256 points");
  await page.reload();
  await expect(page.locator("#arp-tone")).toHaveAttribute(
    "data-automated",
    "true",
  );
  await expect(page.locator("#pad-tone")).toHaveAttribute(
    "data-automated",
    "true",
  );
  await expect(page.locator("#pad-lane-duration")).toHaveText("256 points");
});

async function openTiming(controls: Locator): Promise<void> {
  if (!(await controls.locator(".pattern-dialog").isVisible()))
    await controls.locator('[data-pattern-action="open"]').click();
}

async function choosePatternPage(
  controls: Locator,
  page: number,
): Promise<void> {
  await controls.locator('[data-pattern-action="pages"]').click();
  await controls.locator(`[data-pattern-page="${page}"]`).click();
  await expect(controls.locator(".pattern-navigation")).toBeHidden();
}

async function changeTiming(
  controls: Locator,
  bars: number,
  meter: string,
  grid: string,
): Promise<void> {
  await openTiming(controls);
  for (const [setting, value] of [
    ["bars", String(bars)],
    ["meter", meter],
    ["grid", grid],
  ])
    await controls
      .locator(
        `[data-pattern-setting="${setting}"][data-pattern-value="${value}"]`,
      )
      .click();
  await controls.locator('[data-pattern-action="done"]').click();
}

test("long triplet Arp and Pad patterns edit the final partial page and survive reload", async ({
  page,
}) => {
  await seedFactoryProject(page);
  await page.goto("/");
  const arpPages = page.locator("#arp-pattern-controls");
  await changeTiming(arpPages, 8, "5/4", "triplet");
  await choosePatternPage(arpPages, 23);
  await expect(page.locator("[data-arp-step]")).toHaveCount(6);
  const finalArpGate = page.locator('[data-arp-step="239"]');
  const gateWasOn =
    (await finalArpGate.getAttribute("aria-pressed")) === "true";
  await finalArpGate.click();
  await page.locator("#arp-tone").press("Enter");
  await choosePatternPage(page.locator("#arp-automation-pattern-controls"), 23);
  await page
    .locator('#arp-matrix-access [data-matrix-step="239"]')
    .press("End");
  await expect
    .poll(async () => (await savedProject(page)).arp.automation.tone?.[239])
    .toBe(1);
  const arp = (await savedProject(page)).arp;
  expect(arp.steps).toHaveLength(240);
  expect(arp.steps[239]).toBe(!gateWasOn);
  expect(arp.steps[0]).toBe(true);
  expect(arp.automation.tone?.slice(0, 239)).toEqual(Array(239).fill(arp.tone));
  await expect(
    arpPages.locator('[data-pattern-action="follow"]'),
  ).toHaveAttribute("aria-pressed", "false");

  const padPages = page.locator("#pad-pattern-controls");
  await changeTiming(padPages, 16, "5/4", "triplet");
  await choosePatternPage(padPages, 47);
  await page.locator("#pad-tone").press("Enter");
  await choosePatternPage(page.locator("#pad-automation-pattern-controls"), 47);
  await expect(page.locator("#pad-matrix-access [role=slider]")).toHaveCount(6);
  await page
    .locator('#pad-matrix-access [data-matrix-step="479"]')
    .press("End");
  await expect
    .poll(async () => (await savedProject(page)).pad.automation.tone?.[479])
    .toBe(1);
  const pad = (await savedProject(page)).pad;
  expect(pad.automation.tone?.slice(0, 479)).toEqual(Array(479).fill(pad.tone));
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => (await savedProject(page)).pad.automation.tone)
    .toBeNull();
  await page.keyboard.press("Control+Shift+z");
  await expect
    .poll(async () => (await savedProject(page)).pad.automation.tone)
    .toEqual(pad.automation.tone);
  await page.reload();
  await expect.poll(async () => (await savedProject(page)).arp).toEqual(arp);
  await expect.poll(async () => (await savedProject(page)).pad).toEqual(pad);
  await choosePatternPage(padPages, 47);
  await page.locator("#pad-tone").press("Enter");
  await choosePatternPage(page.locator("#pad-automation-pattern-controls"), 47);
  await expect(
    page.locator('#pad-matrix-access [data-matrix-step="479"]'),
  ).toHaveAttribute("aria-valuenow", "100");
});

test("drum and bass timing stays independent while later bars remain editable", async ({
  page,
}) => {
  await page.goto("/");
  const kickPages = page
    .locator(
      "#drum-simple-pattern .pattern-controls, #drum-simple-pattern.pattern-controls",
    )
    .filter({ has: page.locator('button[aria-label="Kick timing"]') });
  await changeTiming(kickPages, 2, "3/4", "straight");
  await choosePatternPage(kickPages, 1);
  const laterKick = page.locator('[data-drum-step="kick"][data-step="23"]');
  await expect(laterKick).toHaveAttribute("aria-pressed", "false");
  await laterKick.press("Enter");
  await expect
    .poll(
      async () =>
        (await savedProject(page)).drums.find((drum) => drum.id === "kick")
          ?.steps[23],
    )
    .toBe(true);
  const bassPages = page.locator("#bass-pattern");
  await changeTiming(bassPages, 4, "7/8", "triplet");
  await choosePatternPage(bassPages, 7);
  const lastNote = page.locator('#bass-matrix-access [data-matrix-step="83"]');
  await lastNote.press("End");
  await expect
    .poll(async () => (await savedProject(page)).bass.steps[83]?.note)
    .toBe(60);
  const project = await savedProject(page);
  expect(project.bass.steps).toHaveLength(84);
  expect(project.drums.find((drum) => drum.id === "kick")?.steps).toHaveLength(
    24,
  );
  expect(project.drums.find((drum) => drum.id === "snare")?.steps).toHaveLength(
    16,
  );
  expect(project.keys.steps).toHaveLength(16);
  await page.reload();
  await expect.poll(() => savedProject(page)).toEqual(project);
});

test("automation rings move during playback while the knob base value stays fixed", async ({
  page,
}) => {
  const project = createProject();
  project.bpm = 180;
  project.arp.muted = false;
  project.pad.muted = false;
  project.bass.automation.cutoff = Array.from({ length: 16 }, (_, index) =>
    index % 2 ? 0.9 : 0.1,
  );
  project.arp.automation.tone = Array.from({ length: 16 }, (_, index) =>
    index % 2 ? 0.85 : 0.15,
  );
  project.pad.automation.tone = Array.from(
    { length: trackStepCount(project.pad.timing) },
    (_, index) => (index % 2 ? 0.8 : 0.2),
  );
  const kick = project.drums.find((drum) => drum.id === "kick");
  if (!kick) throw new Error("Kick is missing.");
  kick.automation.tone = Array.from({ length: 16 }, (_, index) =>
    index % 2 ? 0.95 : 0.05,
  );
  await page.addInitScript(
    (saved) => localStorage.setItem("acid-303-project-v1", saved),
    JSON.stringify(project),
  );
  await page.goto("/");
  const ids = ["kick-tone", "cutoff", "arp-tone", "pad-tone"];
  const bases = await Promise.all(
    ids.map((id) => page.locator(`#${id}`).getAttribute("aria-valuenow")),
  );
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  for (const [index, id] of ids.entries()) {
    const knob = page.locator(`#${id}`);
    await expect(knob).toHaveClass(/automation-playing/);
    await expect(knob.locator(".automation-live")).toHaveCSS(
      "display",
      "block",
    );
    await expect(knob).toHaveAttribute("aria-valuenow", bases[index] ?? "");
  }
  const movingValues = await page.evaluate(async (controlIds) => {
    const samples = controlIds.map(() => new Set<string>());
    const start = performance.now();
    await new Promise<void>((resolve) => {
      function sample(): void {
        controlIds.forEach((id, index) => {
          const value = document.getElementById(id)?.dataset.liveValue;
          if (value) samples[index]?.add(value);
        });
        if (performance.now() - start < 700) requestAnimationFrame(sample);
        else resolve();
      }
      requestAnimationFrame(sample);
    });
    return samples.map((values) => values.size);
  }, ids);
  for (const count of movingValues) expect(count).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
  await expect(page.locator(".automation-playing")).toHaveCount(0);
  await expect(
    page.locator("[data-arp-step].current, [data-pad-slot].current"),
  ).toHaveCount(0);
});

test("global performance effects support both drag axes, reset and track undo", async ({
  page,
}) => {
  await page.goto("/");
  const sweep = page.locator("#fx-sweep");
  const box = await sweep.boundingBox();
  if (!box) throw new Error("Global sweep control is missing.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 48, box.y + box.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await savedProject(page)).fx.sweep)
    .toBeGreaterThan(0);
  await dragUp(page, page.locator("#fx-space"), 36);
  await page.locator("#fx-echo").press("Home");
  await expect.poll(async () => (await savedProject(page)).fx.echo).toBe(-1);
  const effects = (await savedProject(page)).fx;
  expect(effects.space).toBeGreaterThan(0);
  await sweep.dblclick();
  await expect.poll(async () => (await savedProject(page)).fx.sweep).toBe(0);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await savedProject(page)).fx).toEqual(effects);
  await page.reload();
  await expect.poll(async () => (await savedProject(page)).fx).toEqual(effects);
  await expect(page.locator("#fx-echo")).toHaveAttribute(
    "aria-valuenow",
    "-100",
  );
});

for (const width of [320, 375]) {
  test(`phone navigation keeps performance controls accessible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.goto("/");
    await expect(page.locator("#studio-tools-panel")).toBeHidden();
    await expect(
      page.locator("#header-visuals #visualizer-toolbar"),
    ).toBeVisible();
    await page.locator('[data-instrument-jump="pad-panel"]').click();
    await expect(page.locator("#pad-title")).toBeInViewport();
    await expect(page.locator("#play")).toBeInViewport();
    await expect(page.locator("#fx-sweep")).toBeInViewport();
    await setPadBars(page, 16);
    const pages = page.locator("#pad-pattern-controls");
    await choosePatternPage(pages, 15);
    await expect(pages.locator('[data-pattern-page="15"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.locator("#pad-tone").press("Enter");
    await choosePatternPage(
      page.locator("#pad-automation-pattern-controls"),
      15,
    );
    await expect(
      page.locator('#pad-matrix-access [data-matrix-step="255"]'),
    ).toHaveCount(1);
    await page.locator("#studio-view").click();
    await expect(
      page.locator("#header-visuals #visualizer-toolbar"),
    ).toBeInViewport();
    await page.locator("#intensity").press("Home");
    await expect(page.locator("#visualizer-panel")).toHaveCSS(
      "visibility",
      "hidden",
    );
    await openTrackControls(page);
    await expect(page.locator("#share-track")).toBeVisible();
    await page.locator('[data-instrument-jump="drums-panel"]').click();
    await expect(page.locator("#studio-tools-panel")).toBeHidden();
    await expect(page.locator("#drums-title")).toBeInViewport();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  });
}

test("phone shared progression choices stay inline with descriptions and close on selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const chords = await openChords(page);
  const picker = chords.locator(".progression-presets");
  await picker.locator("summary").click();
  const choice = picker.locator('[data-chord-progression="descent"]');
  await expect(choice).toHaveAttribute("title", /.+/);
  const bounds = await picker.boundingBox();
  if (!bounds) throw new Error("Progression choices missing.");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
  await choice.click();
  await expect(picker).not.toHaveAttribute("open");
  expect(
    (await savedProject(page)).progression.chords.map((chord) => chord.degree),
  ).toHaveLength(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
});

for (const width of [320, 375]) {
  test(`inline pages and timing settings stay accessible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.goto("/");
    const controls = page.locator("#arp-pattern-controls");
    const trigger = controls.getByRole("button", {
      name: "Arpeggiator timing",
      exact: true,
    });
    const dialog = controls.getByRole("dialog", {
      name: "Arpeggiator timing",
      exact: true,
    });
    // Timing, previous, page, next, Follow, Page and Whole loop.
    await expect(controls.getByRole("button")).toHaveCount(7);
    const compact = await controls.boundingBox();
    expect(compact?.height).toBeLessThanOrEqual(80);
    await trigger.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-pattern-page]")).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const close = dialog.getByRole("button", {
      name: "Close Arpeggiator timing",
      exact: true,
    });
    const done = dialog.getByRole("button", {
      name: "Done editing Arpeggiator timing",
      exact: true,
    });
    await expect(close).toBeFocused();
    await close.press("Shift+Tab");
    await expect(done).toBeFocused();
    await done.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await changeTiming(controls, 8, "5/4", "triplet");
    const pageTrigger = controls.locator('[data-pattern-action="pages"]');
    await pageTrigger.click();
    const picker = controls.locator(".pattern-navigation");
    await expect(picker).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(picker.locator("[data-pattern-page]")).toHaveCount(24);
    const bounds = await picker.boundingBox();
    if (!bounds) throw new Error("Page picker is missing.");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await picker.locator('[data-pattern-page="23"]').click();
    await expect(picker).toBeHidden();
    await expect(pageTrigger).toBeFocused();
    await expect(pageTrigger).toContainText("Page 24/24");
    await controls.locator('[data-pattern-action="previous"]').click();
    await expect(pageTrigger).toContainText("Page 23/24");
    await controls.locator('[data-pattern-action="next"]').click();
    await expect(pageTrigger).toContainText("Page 24/24");
    await expect(dialog).toBeHidden();
    await pageTrigger.click();
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(pageTrigger).toBeFocused();
    await expect(page.locator("[data-arp-step]")).toHaveCount(6);
    await page.locator("#arp-tone").press("Enter");
    await choosePatternPage(
      page.locator("#arp-automation-pattern-controls"),
      23,
    );
    await page
      .locator('#arp-matrix-access [data-matrix-step="239"]')
      .press("End");
    await expect
      .poll(async () => (await savedProject(page)).arp.automation.tone?.[239])
      .toBe(1);
    await openTiming(controls);
    await page.mouse.click(5, 5);
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  });
}

test("timing modal pauses page following while open and preserves manual page selection", async ({
  page,
}) => {
  const project = createProject();
  project.bpm = 180;
  await page.addInitScript(
    (saved) => localStorage.setItem("acid-303-project-v1", saved),
    JSON.stringify(project),
  );
  await page.goto("/");
  const controls = page.locator("#bass-pattern");
  await changeTiming(controls, 4, "4/4", "straight");
  await controls.locator('[data-pattern-action="follow"]').click();
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  await openTiming(controls);
  const selected = controls.locator('[data-pattern-page][aria-pressed="true"]');
  const before = await selected.getAttribute("data-pattern-page");
  await expect
    .poll(() =>
      controls
        .locator('[data-pattern-page][data-playing="true"]')
        .getAttribute("data-pattern-page"),
    )
    .not.toBe(before);
  await expect(selected).toHaveAttribute("data-pattern-page", before ?? "");
  await controls.locator('[data-pattern-action="done"]').click();
  await expect
    .poll(() => selected.getAttribute("data-pattern-page"))
    .not.toBe(before);
  await choosePatternPage(controls, 3);
  await expect(
    page.locator('#bass-matrix-access [role="slider"]').first(),
  ).toHaveAttribute("data-matrix-step", "48");
  await page.waitForTimeout(1450);
  await expect(
    page.locator('#bass-matrix-access [role="slider"]').first(),
  ).toHaveAttribute("data-matrix-step", "48");
  await expect(
    controls.locator('[data-pattern-action="follow"]'),
  ).toHaveAttribute("aria-pressed", "false");
  await controls.locator('[data-pattern-action="follow"]').click();
  await expect(controls.locator(".pattern-dialog")).toBeHidden();
  await expect
    .poll(() =>
      page
        .locator('#bass-matrix-access [role="slider"]')
        .first()
        .getAttribute("data-matrix-step"),
    )
    .not.toBe("48");
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
});

test("touch page selection returns to the selected automation bar", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await seedFactoryProject(page);
  await page.goto("/");
  const controls = page.locator("#arp-pattern-controls");
  await controls.locator(".pattern-trigger").tap();
  await controls
    .locator('[data-pattern-setting="bars"][data-pattern-value="4"]')
    .tap();
  await expect(controls.locator(".pattern-dialog")).toBeVisible();
  await controls.locator('[data-pattern-action="done"]').tap();

  await expect(controls.locator(".pattern-dialog")).toBeHidden();
  await page.locator("#arp-tone").tap();
  const automationControls = page.locator("#arp-automation-pattern-controls");
  await automationControls.locator('[data-pattern-action="pages"]').tap();
  await automationControls.locator('[data-pattern-page="3"]').tap();
  await expect(controls.locator(".pattern-dialog")).toBeHidden();
  await expect(page.locator(".track-mixer")).not.toHaveAttribute("open", "");
  const cell = await matrixPoint(page, "arp", 0, 0.1);
  await page.touchscreen.tap(cell.x, cell.y);
  await expect
    .poll(async () => (await savedProject(page)).arp.automation.tone?.[48])
    .toBeGreaterThan(0.85);
  const track = (await savedProject(page)).arp;
  expect(track.automation.tone?.[0]).toBe(track.tone);
  expect(track.automation.tone).toHaveLength(64);
  await context.close();
});

test("undo and redo keep a drum timing dialog modal and preserve keyboard focus", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", {
    name: "Kick timing",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "Kick timing",
    exact: true,
  });
  const twoBars = dialog.locator(
    '[data-pattern-setting="bars"][data-pattern-value="2"]',
  );
  await twoBars.focus();
  await twoBars.press("Enter");
  await expect(twoBars).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Control+z");
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.evaluate((element) => element.matches(":modal")))
    .toBe(true);
  await expect(twoBars).toBeFocused();
  await expect(twoBars).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Control+Shift+z");
  await expect
    .poll(() => dialog.evaluate((element) => element.matches(":modal")))
    .toBe(true);
  await expect(twoBars).toBeFocused();
  await expect(twoBars).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("live fluid crosses timing controls and follows intensity and pause", async ({
  page,
}) => {
  await page.goto("/");
  await openTrackControls(page);
  await page.locator("#volume").press("Home");
  await page.locator("#studio-tools").click();
  await openVisualizerControls(page);
  await page.locator("#visualizer-colour").click();
  await page.locator('[data-visualizer-palette="rainbow"]').click();
  await page.locator("#visualizer-colour").click();
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  const controls = page.locator("#bass-pattern");
  await openTiming(controls);
  const mirror = controls.locator(".pattern-fluid-mirror");
  const frame = () =>
    mirror.evaluate((canvas) =>
      canvas instanceof HTMLCanvasElement ? canvas.toDataURL() : "",
    );
  await expect(mirror).toHaveCSS("opacity", "0.3");
  await expect(mirror).toHaveCSS("pointer-events", "none");
  const moving = await frame();
  await expect.poll(frame).not.toBe(moving);
  const meter = controls.locator(
    '[data-pattern-setting="meter"][data-pattern-value="4/4"]',
  );
  const first = await meter.screenshot();
  await page.waitForTimeout(160);
  expect(first.equals(await meter.screenshot())).toBe(false);
  await page.keyboard.press("Escape");
  const closed = await frame();
  await page.waitForTimeout(160);
  expect(await frame()).toBe(closed);
  await page.locator("#motion").click();
  await openTiming(controls);
  await expect(mirror).toHaveCSS("visibility", "visible");
  const paused = await frame();
  await page.waitForTimeout(200);
  expect(await frame()).toBe(paused);
  const distorted = await meter.screenshot();
  await page.keyboard.press("Escape");
  await page.locator("#intensity").press("Home");
  await openTiming(controls);
  await expect(mirror).toHaveCSS("opacity", "0");
  await expect(mirror).toHaveCSS("visibility", "hidden");
  expect(distorted.equals(await meter.screenshot())).toBe(false);
  await controls
    .locator('[data-pattern-setting="bars"][data-pattern-value="2"]')
    .click();
  await expect(
    controls.locator('[data-pattern-setting="bars"][data-pattern-value="2"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
});
