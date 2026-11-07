import { test, expect } from "@playwright/test";
import type { Page, Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createProject } from "../src/model";

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

test("plays and edits notes with vertical gestures and keyboard", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  await expect
    .poll(() => page.locator("#position").textContent())
    .not.toBe("01");
  const note = page.getByRole("slider", {
    name: "Bass note step 1",
    exact: true,
  });
  await dragUp(page, note, 80);
  await expect(note).toHaveAttribute("aria-valuenow", "45");
  await expect(note).toHaveAttribute("aria-valuetext", "A2");
  await page
    .getByRole("slider", { name: "Bass cutoff", exact: true })
    .press("PageUp");
  await page
    .getByRole("slider", { name: "Tempo in BPM", exact: true })
    .press("ArrowUp");
  await expect(
    page.getByRole("slider", { name: "Tempo in BPM", exact: true }),
  ).toHaveAttribute("aria-valuenow", "127");
  await expect(page.getByRole("button", { name: /Bass slide/ })).toHaveCount(
    16,
  );
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
  await expect(page.locator("#audio-status")).toHaveText("AUDIO IDLE");
  await expect(page.locator(".current")).toHaveCount(0);
  expect(errors).toEqual([]);
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
  ).toHaveAttribute("aria-valuenow", "10");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(
    await page
      .locator("[data-drum-step]")
      .evaluateAll((steps) =>
        steps.map((step) => step.getAttribute("aria-pressed")),
      ),
  ).toEqual(original);
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
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

test("visualizer pauses, respects reduced motion, and fills phone viewport", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  await page
    .getByRole("button", { name: "Pause visualizer motion", exact: true })
    .click();
  const frame = () =>
    page
      .locator("#fluid-canvas")
      .evaluate((canvas) =>
        canvas instanceof HTMLCanvasElement ? canvas.toDataURL() : "",
      );
  const paused = await frame();
  await page.waitForTimeout(350);
  expect(await frame()).toBe(paused);
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  const reduced = await frame();
  await page.waitForTimeout(350);
  expect(await frame()).toBe(reduced);
  await page
    .getByRole("button", { name: "Enable visualizer motion", exact: true })
    .click();
  await expect.poll(frame).not.toBe(reduced);
  await page
    .getByRole("button", { name: "Pause visualizer motion", exact: true })
    .click();
  const explicitlyPaused = await frame();
  await page.waitForTimeout(350);
  expect(await frame()).toBe(explicitlyPaused);
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: "test-results/mobile.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  expect((await page.locator("#fluid-canvas").boundingBox())?.height).toBe(812);
  await page
    .getByRole("slider", { name: "Bass decay", exact: true })
    .scrollIntoViewIfNeeded();
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
  await page
    .getByRole("button", { name: "Exit fullscreen visualizer", exact: true })
    .click();
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
  const knob = await page
    .getByRole("slider", { name: "Kick pitch", exact: true })
    .boundingBox();
  const first = await point(page, 1, 0);
  const last = await point(page, 1, 15);
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

test("Texture has expressive notes and sound controls below the bass", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Cowbell/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Bass slide/ })).toHaveCount(
    16,
  );
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  const keys = page.getByRole("region", { name: "Texture", exact: true });
  await keys.getByRole("button", { name: "Haze", exact: true }).click();
  await expect(
    keys.getByRole("button", { name: "Haze", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const note = keys.getByRole("slider", {
    name: "Texture note step 1",
    exact: true,
  });
  await dragUp(page, note, 80);
  await expect(note).toHaveAttribute("aria-valuenow", "69");
  await expect(note).toHaveAttribute("aria-valuetext", "A4");
  await keys
    .getByRole("slider", { name: "Texture space", exact: true })
    .press("PageUp");
  await expect(
    keys.getByRole("slider", { name: "Texture space", exact: true }),
  ).toHaveAttribute("aria-valuenow", "45");
  await keys
    .getByRole("button", { name: "Texture gate step 2", exact: true })
    .click();
  await expect(
    keys.getByRole("button", { name: "Texture gate step 2", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Stop pattern", exact: true }),
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("acid-303-project-v1")),
    )
    .toContain('"space":0.45');
  await page.reload();
  await expect(
    page.getByRole("slider", { name: "Texture note step 1", exact: true }),
  ).toHaveAttribute("aria-valuenow", "69");
  expect(errors).toEqual([]);
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
  await expect(page.getByRole("button", { name: /Bass slide/ })).toHaveCount(
    16,
  );
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

test("note pads separate pitch, slide, accent and gate gestures", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  for (const track of ["Bass", "Texture"]) {
    const pad = page.getByRole("slider", {
      name: `${track} note step 2`,
      exact: true,
    });
    const gate = page.getByRole("button", {
      name: `${track} gate step 2`,
      exact: true,
    });
    await pad.scrollIntoViewIfNeeded();
    const originalPitch = Number(await pad.getAttribute("aria-valuenow"));
    await pad.click();
    await expect(gate).toHaveAttribute("aria-pressed", "true");
    const box = await pad.boundingBox();
    if (!box) throw new Error("Note pad is missing.");
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(500);
    await expect(pad).toHaveAttribute("data-accent", "true");
    await page.mouse.up();
    await expect(gate).toHaveAttribute("aria-pressed", "true");
    const slide = page.getByRole("button", {
      name: `${track} slide step 2`,
      exact: true,
    });
    await slide.click();
    await expect(pad).toHaveAttribute("data-slide", "true");
    await expect(pad).toHaveClass(/joined/);
    await expect(pad).toHaveAttribute("aria-valuenow", String(originalPitch));
    await expect(
      page.getByRole("button", { name: `${track} gate step 3`, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 34, y - 2, { steps: 4 });
    await page.mouse.up();
    await expect(pad).toHaveAttribute("data-slide", "true");
    await slide.click();
    await expect(pad).toHaveAttribute("data-slide", "false");
    await dragUp(page, pad, 80);
    await expect(pad).toHaveAttribute(
      "aria-valuenow",
      String(originalPitch + 12),
    );
    await expect(pad).toHaveAttribute("data-accent", "true");
    await pad.press("a");
    await expect(pad).toHaveAttribute("data-accent", "false");
    await pad.press("ArrowRight");
    await expect(pad).toHaveAttribute("data-slide", "true");
    await pad.press("ArrowLeft");
    await expect(pad).toHaveAttribute("data-slide", "false");
  }
  const first = page.getByRole("slider", {
    name: "Texture note step 1",
    exact: true,
  });
  const firstGate = page.getByRole("button", {
    name: "Texture gate step 1",
    exact: true,
  });
  if ((await firstGate.getAttribute("aria-pressed")) === "true")
    await first.press("Enter");
  const last = page.getByRole("slider", {
    name: "Texture note step 16",
    exact: true,
  });
  await last.press("ArrowRight");
  await expect(
    page.getByRole("button", { name: "Texture gate step 1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(last).toHaveAttribute("data-slide", "true");
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("acid-303-project-v1")),
    )
    .toContain('"slide":true');
  await page.reload();
  await expect(last).toHaveAttribute("data-slide", "true");
  expect(errors).toEqual([]);
});

test("two fingers hold one Texture accent while bending another note and cancel safely", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Play pattern", exact: true }).tap();
  const first = page.getByRole("slider", {
    name: "Texture note step 1",
    exact: true,
  });
  const second = page.getByRole("slider", {
    name: "Texture note step 2",
    exact: true,
  });
  await first.scrollIntoViewIfNeeded();
  await first.tap();
  const a = await first.boundingBox(),
    b = await second.boundingBox();
  if (!a || !b) throw new Error("Texture pads are missing.");
  const fingerA = { id: 1, x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const fingerB = { id: 2, x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const session = await context.newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [fingerA],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [fingerA, fingerB],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [fingerA, { ...fingerB, y: fingerB.y - 40 }],
  });
  await page.waitForTimeout(470);
  await expect(first).toHaveAttribute("data-accent", "true");
  await expect(second).toHaveAttribute("aria-valuenow", "63");
  await expect(second).toHaveAttribute("data-accent", "false");
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { ...fingerA, y: fingerA.y - 20 },
      { ...fingerB, y: fingerB.y - 40 },
    ],
  });
  await expect(first).toHaveAttribute("aria-valuenow", "60");
  await expect(first).toHaveAttribute("data-accent", "true");
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(
    page.getByRole("button", { name: "Texture gate step 1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [fingerB],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await page.waitForTimeout(470);
  await expect(second).toHaveAttribute("data-accent", "false");
  await expect(page.locator(".holding, .held, .dragging")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  await context.close();
});

test("visualizer intensity controls opacity while drum-driven motion works with silent audio", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const stage = page.locator("#visualizer-panel");
  const intensity = page.getByRole("slider", {
    name: "Visualizer intensity",
    exact: true,
  });
  const frame = () =>
    page
      .locator("#fluid-canvas")
      .evaluate((canvas) =>
        canvas instanceof HTMLCanvasElement ? canvas.toDataURL() : "",
      );
  await page
    .getByRole("button", { name: "Pause visualizer motion", exact: true })
    .click();
  const paused = await frame();
  await intensity.press("Home");
  await expect(stage).toHaveCSS("opacity", "0");
  await expect(stage).toHaveCSS("visibility", "hidden");
  await intensity.press("End");
  await expect(stage).toHaveCSS("opacity", "1");
  await expect(stage).toHaveCSS("visibility", "visible");
  expect(await frame()).toBe(paused);
  await page
    .getByRole("slider", { name: "Master volume", exact: true })
    .press("Home");
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  await intensity.press("Home");
  await intensity.press("PageUp");
  await expect(stage).toHaveCSS("opacity", "0.1");
  await page
    .getByRole("button", { name: "Enable visualizer motion", exact: true })
    .click();
  await expect.poll(frame).not.toBe(paused);
  const moving = await frame();
  await page.waitForTimeout(250);
  expect(await frame()).not.toBe(moving);
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
  const stopped = await frame();
  await page.waitForTimeout(250);
  expect(await frame()).toBe(stopped);
});

test("horizontal touch scrolling never edits note expression", async ({
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
  for (const track of ["Bass", "Texture"]) {
    const pad = page.getByRole("slider", {
      name: `${track} note step 4`,
      exact: true,
    });
    await pad.scrollIntoViewIfNeeded();
    await page
      .getByRole("button", { name: `${track} slide step 4`, exact: true })
      .tap();
    const note = await pad.getAttribute("aria-valuenow");
    const accent = await pad.getAttribute("data-accent");
    const scrollPosition = () =>
      pad.evaluate(
        (element) => element.closest(".sequence-scroll")?.scrollLeft ?? 0,
      );
    const before = await scrollPosition();
    const box = await pad.boundingBox();
    if (!box) throw new Error("Note pad is missing.");
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, x, y }],
    });
    for (let step = 1; step <= 6; step++)
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ id: 1, x: x - step * 20, y }],
      });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect.poll(scrollPosition).toBeGreaterThan(before + 50);
    await page.waitForTimeout(350);
    await expect(pad).toHaveAttribute("data-slide", "true");
    await expect(pad).toHaveAttribute("aria-valuenow", note ?? "");
    await expect(pad).toHaveAttribute("data-accent", accent ?? "");
  }
  await context.close();
});

test("horizontal wheel and mouse drag scroll across note pads without editing them", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  for (const track of ["Bass", "Texture"]) {
    const pad = page.getByRole("slider", {
      name: `${track} note step 4`,
      exact: true,
    });
    await pad.scrollIntoViewIfNeeded();
    await page
      .getByRole("button", { name: `${track} slide step 4`, exact: true })
      .click();
    const pitch = await pad.getAttribute("aria-valuenow");
    const scrollPosition = () =>
      pad.evaluate(
        (element) => element.closest(".sequence-scroll")?.scrollLeft ?? 0,
      );
    let box = await pad.boundingBox();
    if (!box) throw new Error("Note pad is missing.");
    const beforeWheel = await scrollPosition();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(150, 0);
    await expect.poll(scrollPosition).toBeGreaterThan(beforeWheel + 50);
    await pad.scrollIntoViewIfNeeded();
    box = await pad.boundingBox();
    if (!box) throw new Error("Note pad is missing after scrolling.");
    const beforeMouse = await scrollPosition();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2, {
      steps: 5,
    });
    await page.mouse.up();
    await expect.poll(scrollPosition).toBeGreaterThan(beforeMouse + 20);
    await expect(pad).toHaveAttribute("data-slide", "true");
    await expect(pad).toHaveAttribute("aria-valuenow", pitch ?? "");
  }
});
