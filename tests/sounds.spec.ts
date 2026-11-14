import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  BASS_SOUNDS,
  DRUM_META,
  KEYS_SOUNDS,
  projectSchema,
} from "../src/model";
import { ARP_SOUNDS } from "../src/arp-model";
import { PAD_SOUNDS } from "../src/pad-model";

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

test("the expanded sound library is reachable on mobile and survives reload and sharing", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 950 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  for (const [id, meta] of Object.entries(DRUM_META)) {
    await page.locator(`[data-drum="${id}"]`).click();
    const sounds = page.getByRole("group", {
      name: `${meta.name} sounds`,
      exact: true,
    });
    // The project's own sounds come first; the other studio's sit in a nested group.
    const own = sounds.locator(":scope > button");
    await expect(own).toHaveCount(meta.sounds.length);
    for (const index of [meta.sounds.length - 2, meta.sounds.length - 1]) {
      await own.nth(index).click();
      await expect(own.nth(index)).toHaveAttribute("aria-pressed", "true");
    }
  }
  const melodic = [
    { selector: "data-bass-sound", sounds: BASS_SOUNDS },
    { selector: "data-key-sound", sounds: KEYS_SOUNDS },
    { selector: "data-arp-sound", sounds: ARP_SOUNDS },
    { selector: "data-pad-sound", sounds: PAD_SOUNDS },
  ];
  for (const { selector, sounds } of melodic) {
    for (const index of [sounds.length - 2, sounds.length - 1]) {
      const button = page.locator(
        `[${selector}="${index}"][data-sound-family="grain"]`,
      );
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
    }
  }
  const fluffBass = page.locator(
    `[data-bass-sound="${BASS_SOUNDS.length - 1}"][data-sound-family="fluff"]`,
  );
  await fluffBass.click();
  await expect(fluffBass).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => (await saved(page)).pad.sound)
    .toBe(PAD_SOUNDS.length - 1);
  await expect.poll(async () => (await saved(page)).bass.family).toBe("fluff");
  const before = await saved(page);
  for (const drum of before.drums)
    expect(drum.sound).toBe(DRUM_META[drum.id].sounds.length - 1);
  expect(before.bass.sound).toBe(BASS_SOUNDS.length - 1);
  expect(before.keys.sound).toBe(KEYS_SOUNDS.length - 1);
  expect(before.arp.sound).toBe(ARP_SOUNDS.length - 1);
  await page.reload();
  expect(await saved(page)).toEqual(before);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator("#share-track").click();
  await expect(page.locator(".transport #share-panel")).toBeVisible();
  await expect(page.locator("#share-url")).toHaveValue(/#track=v1\./);
  const link = await page.locator("#share-url").inputValue();
  const recipientContext = await browser.newContext();
  const recipient = await recipientContext.newPage();
  await recipient.goto(link);
  await expect
    .poll(async () => (await saved(recipient)).pad.sound)
    .toBe(PAD_SOUNDS.length - 1);
  expect(await saved(recipient)).toEqual(before);
  expect(errors).toEqual([]);
  await recipientContext.close();
  await context.close();
});
