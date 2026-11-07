import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("edits and persists individual drum sounds, pitches, decay and pattern", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".step-pad")).toHaveCount(80);
  await page
    .getByRole("button", { name: "Select and preview Cowbell", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Cowbell sound", exact: true })
    .selectOption("2");
  await page.getByRole("slider", { name: "Drum pitch", exact: true }).fill("7");
  await page
    .getByRole("slider", { name: "Drum decay", exact: true })
    .fill("440");
  await page
    .getByRole("button", { name: "Cowbell step 1", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cowbell step 1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () =>
      page.evaluate(() => localStorage.getItem("acid-303-project-v1")),
    )
    .toContain('"decay":0.44');
  await page.reload();
  await page
    .getByRole("button", { name: "Select and preview Cowbell", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Cowbell sound", exact: true }),
  ).toHaveValue("2");
  await expect(
    page.getByRole("slider", { name: "Drum pitch", exact: true }),
  ).toHaveValue("7");
  await expect(
    page.getByRole("slider", { name: "Drum decay", exact: true }),
  ).toHaveValue("440");
  await expect(
    page.getByRole("button", { name: "Cowbell step 1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("plays, edits acid sequence and filter, and stops without stale indicators", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  await expect(page.locator("#audio-status")).toHaveText("AUDIO LIVE");
  await expect
    .poll(async () => page.locator("#position").textContent())
    .not.toBe("01");
  await expect(
    page.getByRole("button", { name: "Bass gate step 2", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("button", { name: "Bass gate step 2", exact: true }),
  ).not.toHaveClass(/\bon\b/);
  await page
    .getByRole("button", { name: "Bass gate step 2", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Bass gate step 2", exact: true }),
  ).toHaveClass(/\bon\b/);
  await page
    .getByRole("combobox", { name: "Bass note step 1", exact: true })
    .selectOption("45");
  await page
    .getByRole("slider", { name: "Bass cutoff", exact: true })
    .fill("80");
  await page
    .getByRole("slider", { name: "Bass resonance", exact: true })
    .fill("21");
  await page
    .getByRole("button", { name: "Bass slide step 1", exact: true })
    .click();
  await page.getByRole("spinbutton", { name: "Tempo in BPM" }).fill("143");
  await page.getByRole("slider", { name: "Swing", exact: true }).fill("30");
  await expect(
    page.getByRole("button", { name: "Bass slide step 1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Restart pattern", exact: true })
    .click();
  await expect(page.locator("#audio-status")).toHaveText("AUDIO LIVE");
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
  await expect(page.locator("#audio-status")).toHaveText("AUDIO IDLE");
  await expect(page.locator(".current")).toHaveCount(0);
  await expect(page.locator("#position")).toHaveText("01");
  expect(errors).toEqual([]);
});

test("exports a valid audible stereo WAV", async ({ page }) => {
  await page.goto("/");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export WAV", exact: true }).click();
  const download = await downloaded;
  const path = await download.path();
  if (!path) throw new Error("No WAV download file was produced.");
  const wav = await readFile(path);
  expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
  expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
  expect(wav.readUInt16LE(22)).toBe(2);
  expect(wav.readUInt32LE(24)).toBe(44100);
  expect(wav.length).toBeGreaterThan(900000);
  let peak = 0;
  for (let index = 44; index < wav.length; index += 2)
    peak = Math.max(peak, Math.abs(wav.readInt16LE(index)));
  expect(peak).toBeGreaterThan(1000);
  expect(peak).toBeLessThan(32767);
  await expect(
    page.getByRole("button", { name: "Export WAV", exact: true }),
  ).toBeEnabled();
});

test("renders desktop and mobile, respects reduced motion, and pauses visualizer", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  await page
    .getByRole("button", { name: "Pause visualizer motion", exact: true })
    .click();
  const getFrame = () =>
    page
      .locator("canvas")
      .evaluate((canvas) =>
        canvas instanceof HTMLCanvasElement ? canvas.toDataURL() : "",
      );
  const frame = await getFrame();
  await page.waitForTimeout(500);
  expect(await getFrame()).toBe(frame);
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  const reducedFrame = await getFrame();
  await page.waitForTimeout(500);
  expect(await getFrame()).toBe(reducedFrame);
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await expect(
    page.getByRole("button", { name: "Play pattern", exact: true }),
  ).toBeInViewport();
});

test("recovers from corrupted saved data", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("acid-303-project-v1", '{"version":1,"bpm":0}'),
  );
  await page.goto("/");
  await expect(
    page.getByRole("spinbutton", { name: "Tempo in BPM" }),
  ).toHaveValue("126");
  await expect(page.locator(".step-pad")).toHaveCount(80);
});

test("phone touch controls can reach the last steps and sound settings", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Play pattern", exact: true }).tap();
  await expect(page.locator("#audio-status")).toHaveText("AUDIO LIVE");
  const drumScroll = page.locator(".drums-panel .sequence-scroll");
  await drumScroll.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await page.getByRole("button", { name: "Kick step 16", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: "Kick step 16", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Select and preview Hi-hat", exact: true })
    .tap();
  await page
    .getByRole("combobox", { name: "Hi-hat sound", exact: true })
    .selectOption("1");
  await page.getByRole("slider", { name: "Drum pitch", exact: true }).fill("5");
  await page
    .getByRole("slider", { name: "Drum decay", exact: true })
    .fill("250");
  await expect(
    page.getByRole("slider", { name: "Drum pitch", exact: true }),
  ).toHaveValue("5");
  const bassScroll = page.locator(".bass-panel .sequence-scroll");
  await bassScroll.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await page
    .getByRole("combobox", { name: "Bass note step 16", exact: true })
    .selectOption("45");
  await page
    .getByRole("button", { name: "Bass slide step 16", exact: true })
    .tap();
  await expect(
    page.getByRole("button", { name: "Bass slide step 16", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
  await page.getByRole("button", { name: "Stop pattern", exact: true }).tap();
  await context.close();
});
