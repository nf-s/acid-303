import { test, expect } from "@playwright/test";
import { createProject, projectSchema } from "../src/model";
import type { Page } from "@playwright/test";

async function saved(page: Page) {
  await page.waitForFunction(
    () => localStorage.getItem("acid-303-project-v1") !== null,
  );
  return projectSchema.parse(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("acid-303-project-v1") ?? "null"),
    ),
  );
}

test("mixer levels and mutes share instrument controls, automation and undo", async ({
  page,
}) => {
  const project = createProject();
  project.bass.volume = 0.5;
  project.bass.automation.volume = Array.from(
    { length: 16 },
    (_, index) => index / 15,
  );
  await page.addInitScript(
    (value) =>
      localStorage.setItem("acid-303-project-v1", JSON.stringify(value)),
    project,
  );
  await page.goto("/");
  await page.locator('[data-studio-panel="mixer"]').click();
  await expect(page.locator(".mixer-fader")).toHaveCount(12);
  await page.locator("#mixer-bass").press("ArrowUp");
  await expect(page.locator("#bass-volume")).toHaveAttribute(
    "aria-valuenow",
    "51",
  );
  await expect
    .poll(async () => (await saved(page)).bass.automation.volume?.[0])
    .toBeCloseTo(0.01);
  await page.locator("#mixer-bass").press("ArrowDown");
  await expect.poll(async () => (await saved(page)).bass.volume).toBe(0.5);
  await page.locator('[data-mixer-mute="bass"]').click();
  await expect(page.locator("#bass-mute")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator("#bass-mute").click();
  await expect(page.locator('[data-mixer-mute="bass"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.locator("#mixer-arp").press("End");
  await expect(page.locator("#arp-volume")).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  await page.locator("#global-undo").click();
  await expect
    .poll(async () => (await saved(page)).arp.volume)
    .toBe(project.arp.volume);
  await expect(page.locator("#mixer-arp")).toHaveAttribute(
    "aria-valuenow",
    String(Math.round(project.arp.volume * 100)),
  );
});

test("mobile mixer scrolls to every channel without widening the page", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 900 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.locator('[data-studio-panel="mixer"]').click();
  await page.locator("#mixer-vocal").scrollIntoViewIfNeeded();
  await page.locator("#mixer-vocal").press("Home");
  await expect.poll(async () => (await saved(page)).vocal.volume).toBe(0);
  await page.locator('[data-mixer-mute="vocal"]').click();
  await expect.poll(async () => (await saved(page)).vocal.muted).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".mixer-channels")
      .evaluate((element) => element.scrollLeft),
  ).toBeGreaterThan(0);
  await context.close();
});
