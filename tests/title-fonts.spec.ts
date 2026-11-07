import { test, expect } from "@playwright/test";

test("the supplied vector title stays centred and ignores previous font choices", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("grain-title-font-v1", "30"),
  );
  for (const width of [320, 375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?titleFont=21");
    const title = page.locator(".brand-wordmark svg");
    await expect(title).toHaveCount(1);
    await expect(page.locator(".title-font-text")).toHaveCount(0);
    await expect(title.locator("image")).toHaveCount(0);
    const box = await title.boundingBox();
    if (!box) throw new Error("Vector title is missing");
    expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator("body")
        .evaluate((element) => getComputedStyle(element).fontFamily),
    ).toContain("IBM Plex Mono");
    await expect(page.locator("#visualizer-toolbar")).toBeVisible();
    await expect(page.locator("#record-automation")).toBeVisible();
    const nav = await page.locator(".instrument-nav").boundingBox();
    if (!nav) throw new Error("Navigation is missing");
    expect(Math.abs(nav.y + nav.height - 900)).toBeLessThan(1);
  }
});
