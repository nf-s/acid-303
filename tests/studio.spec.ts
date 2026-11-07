import { test, expect } from "@playwright/test";
import type { Page, Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";

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
    .getByRole("button", { name: "Select and preview Cowbell", exact: true })
    .click();
  await page.getByRole("button", { name: "Dark bell", exact: true }).click();
  await dragUp(
    page,
    page.getByRole("slider", { name: "Cowbell pitch", exact: true }),
    60,
  );
  await expect(
    page.getByRole("slider", { name: "Cowbell pitch", exact: true }),
  ).toHaveAttribute("aria-valuenow", "12");
  await page
    .getByRole("slider", { name: "Cowbell decay", exact: true })
    .press("ArrowUp");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("acid-303-project-v1")),
    )
    .toContain('"pitch":12');
  await page.reload();
  await page
    .getByRole("button", { name: "Select and preview Cowbell", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Dark bell", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("slider", { name: "Cowbell pitch", exact: true }),
  ).toHaveAttribute("aria-valuenow", "12");
  await expect(
    page.getByRole("slider", { name: "Cowbell decay", exact: true }),
  ).toHaveAttribute("aria-valuenow", "250");
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
  await page
    .getByRole("button", { name: "Bass slide step 1", exact: true })
    .click();
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
