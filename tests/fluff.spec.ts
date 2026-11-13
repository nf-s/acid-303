import { test, expect } from "@playwright/test";
import { FLUFF_SOUNDS } from "../src/mode";
import { presetsForMode } from "../src/presets";

test("the mode switch swaps examples, sound names and saved tracks", async ({
  page,
}) => {
  await page.goto("/");
  const grain = presetsForMode("grain");
  const fluff = presetsForMode("fluff");
  await expect(page.locator("[data-preset]")).toHaveCount(grain.length);

  await page.locator('[data-project-mode="fluff"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "fluff");
  await expect(page).toHaveTitle(/Fluff/);
  await expect(page.locator("[data-preset]")).toHaveCount(fluff.length);
  await expect(page.locator("[data-bass-sound]")).toHaveText([
    ...FLUFF_SOUNDS.bass,
  ]);
  await expect(page.locator("[data-key-sound]")).toHaveText([
    ...FLUFF_SOUNDS.keys,
  ]);

  await page.locator('[data-preset="fluff-skylark"]').click();
  await expect(page.locator('[data-preset="fluff-skylark"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.locator('[data-project-mode="grain"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "grain");
  await expect(page.locator("[data-preset]")).toHaveCount(grain.length);

  await page.locator('[data-project-mode="fluff"]').click();
  await expect(page.locator('[data-preset="fluff-skylark"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "fluff");
});

test("switching from a long vocal to a track without one keeps the page responsive", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-project-mode="fluff"]').click();
  await page.locator("#play").click();
  await page.locator('[data-preset="fluff-kite-string"]').click();
  await page.waitForTimeout(6000);
  await page.locator('[data-preset="fluff-hoshi"]').click();
  await expect(page.locator('[data-preset="fluff-hoshi"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
