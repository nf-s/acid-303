import { test, expect } from "@playwright/test";
import type { Page, Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  BASS_SOUNDS,
  createProject,
  projectSchema,
  scaleNotes,
} from "../src/model";
import { PRESETS } from "../src/presets";

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
async function point(page: Page, row: number, step: number) {
  const canvas = page.locator("#beat-canvas");
  await canvas.scrollIntoViewIfNeeded();
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
  const first = await point(page, 1, 0);
  const last = await point(page, 1, 15);
  const knob = await page
    .getByRole("slider", { name: "Kick pitch", exact: true })
    .boundingBox();
  if (!knob) throw new Error("Pitch dial missing.");
  const x = knob.x + knob.width / 2;
  const y = knob.y + knob.height / 2;
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
  await expect(
    page.getByRole("slider", { name: "Tempo in BPM", exact: true }),
  ).toHaveAttribute("aria-valuenow", "126");
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
    .toContain('"version":2');
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
) {
  const canvas = page.locator(`#${track}-matrix-canvas`);
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
) {
  const start = await matrixPoint(page, track, first, y1);
  const end = await matrixPoint(page, track, last, y2);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

test("draws a scale-locked pitch line across all steps and undoes the complete stroke", async ({
  page,
}) => {
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
  await expect(sounds.getByRole("button")).toHaveCount(6);
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
  ).toHaveCount(5);
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await savedProject(page)).drums.find((drum) => drum.id === "hat")
          ?.sound,
    )
    .toBe(4);
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

test("phone fullscreen visualizer and sticky playback remain accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
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
  await page
    .getByRole("slider", { name: "Master volume", exact: true })
    .press("Home");
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
  await colour.click();
  await expect(
    page.getByRole("button", { name: "Mono", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("retracting a glide line restores gates outside the final stroke", async ({
  page,
}) => {
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
    .getByRole("group", { name: "Bass drawing tool", exact: true })
    .getByRole("button", { name: "Line", exact: true })
    .click();
  const start = await matrixPoint(page, "bass", 2, 0.8);
  const far = await matrixPoint(page, "bass", 10, 0.1);
  const end = await matrixPoint(page, "bass", 3, 0.2);
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
    .getByRole("button", { name: "Undo Bass drawing", exact: true })
    .click();
  await expect
    .poll(async () => (await savedProject(page)).bass.automation.cutoff)
    .toBeNull();
  await matrixStroke(page, "bass", 0, 15, 0.9, 0.1);
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
    .getByRole("button", { name: "Undo Bass drawing", exact: true })
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
      .locator(`#${control.track}-matrix-access [role=slider]`)
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
  await matrixStroke(page, "keys", 0, 15, 0.8, 0.4);
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
    .poll(() => page.locator("#position").textContent())
    .not.toBe("01");
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
  await page.goto("/");
  const sounds = page.getByRole("group", { name: "Bass sound", exact: true });
  await expect(sounds.getByRole("button")).toHaveCount(9);
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
  await page.locator("#bass-matrix-access [role=slider]").first().press("End");
  await page.locator("#kick-tone").press("End");
  await page.locator("#kick-drive").press("PageUp");
  await expect
    .poll(async () => (await savedProject(page)).drums[0]?.drive)
    .toBe(0.1);
  await page.reload();
  await expect(
    sounds.getByRole("button", { name: "Pressure", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
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
  await matrixStroke(page, "bass", 0, 15, 0.8, 0.2);
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
  const motion = page.locator("#phone-motion");
  await motion.tap();
  await expect(motion).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Twist", exact: true }).tap();
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
  await matrixStroke(page, "bass", 0, 15, 0.8, 0.2);
  await page
    .getByRole("group", { name: "Bass drawing tool", exact: true })
    .getByRole("button", { name: "Line", exact: true })
    .click();
  const point = await matrixPoint(page, "bass", 4, 0.1);
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
  await page.goto("/");
  await dragUp(page, page.locator("#cutoff"), 48);
  await expect
    .poll(async () => (await savedProject(page)).bass.cutoff)
    .toBeGreaterThan(createProject().bass.cutoff);
  const edited = await savedProject(page);
  await page.locator("[data-preset]").first().click();
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
  await matrixStroke(page, "bass", 0, 15, 0.8, 0.2);
  await expect
    .poll(async () => (await savedProject(page)).bass.automation.cutoff?.[15])
    .toBeCloseTo(0.8, 1);
  await page.locator('[data-arp-sound="2"]').click();
  await page.locator('[data-pad-bars="16"]').click();
  await page
    .getByRole("button", { name: "Enable chord pads", exact: true })
    .click();
  await expect
    .poll(async () => (await savedProject(page)).pad.muted)
    .toBe(false);
  await page.locator("#arp-tone").press("Enter");
  await matrixStroke(page, "arp", 0, 15, 0.7, 0.3);
  await page.locator("#pad-tone").press("Enter");
  await matrixStroke(page, "pad", 0, 15, 0.8, 0.2);
  await expect
    .poll(async () => (await savedProject(page)).pad.automation.tone?.[15])
    .toBeCloseTo(0.8, 1);
  const original = await savedProject(page);
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
  await page.goto("/");
  await expect(page.locator("#arp-panel .gesture-control")).toHaveCount(8);
  await expect(
    page
      .getByRole("group", { name: "Arpeggiator sound", exact: true })
      .getByRole("button"),
  ).toHaveCount(6);
  await page.locator("[data-arp-clear=notes]").click();
  for (const note of ["E4", "A3", "C4"])
    await page
      .getByRole("button", { name: `Arpeggiator note ${note}`, exact: true })
      .click();
  await page.getByRole("button", { name: "Played", exact: true }).click();
  await page.getByRole("button", { name: "1/32", exact: true }).click();
  await page
    .getByRole("button", { name: "Arpeggiator step 2", exact: true })
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

test("pad progression length, chord edits and play position work across bars", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#pad-panel .gesture-control")).toHaveCount(8);
  await expect(
    page
      .getByRole("group", { name: "Pad sound", exact: true })
      .getByRole("button"),
  ).toHaveCount(6);
  await page
    .getByRole("button", { name: "Enable chord pads", exact: true })
    .click();
  await page.getByRole("button", { name: "2 bars", exact: true }).click();
  await page.locator("[data-pad-presets]").click();
  await page.locator("[data-pad-progression=descent]").click();
  await page.locator('[data-pad-slot="1"]').click();
  await page.locator('[data-pad-degree="3"]').click();
  await page.locator('[data-pad-inversion="2"]').click();
  await page.locator("#pad-tone").press("End");
  await expect.poll(async () => (await savedProject(page)).pad.tone).toBe(1);
  const pad = (await savedProject(page)).pad;
  expect(pad.chords[1]).toEqual({ degree: 3, inversion: 2 });
  expect(pad.bars).toBe(2);
  expect(pad.muted).toBe(false);
  await page.locator("#bpm").press("End");
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  await expect
    .poll(() => page.locator(".pad-position").textContent())
    .toBe("Bar 2 / 2");
  const barPosition = await page.evaluate(() => {
    const before = document.querySelector("#bar-position")?.textContent;
    document
      .querySelector("#pad-tone")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true }),
      );
    return {
      before,
      after: document.querySelector("#bar-position")?.textContent,
    };
  });
  expect(barPosition).toEqual({ before: "Bar 2 / 2", after: "Bar 2 / 2" });
  await expect(page.locator("[data-pad-slot].current")).toHaveCount(1);
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "2 bars", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#pad-tone")).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
});

test("WAV export includes all eight progression bars and release tails", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#bpm").press("End");
  await page
    .getByRole("button", { name: "Enable chord pads", exact: true })
    .click();
  await page.getByRole("button", { name: "8 bars", exact: true }).click();
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
  await page.getByRole("button", { name: "16 bars", exact: true }).click();
  await expect(page.locator("#pad-lane-duration")).toHaveText(
    "16 bars · 16 points",
  );
  await page.reload();
  await expect(page.locator("#arp-tone")).toHaveAttribute(
    "data-automated",
    "true",
  );
  await expect(page.locator("#pad-tone")).toHaveAttribute(
    "data-automated",
    "true",
  );
  await expect(page.locator("#pad-lane-duration")).toHaveText(
    "16 bars · 16 points",
  );
});
