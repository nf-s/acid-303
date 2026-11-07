import { test, expect } from "@playwright/test";

test("instrument headers collapse locally without muting or changing the song", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#fx-sweep").press("ArrowUp");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("acid-303-project-v1")),
    )
    .not.toBeNull();
  const before = await page.evaluate(() =>
    localStorage.getItem("acid-303-project-v1"),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("#play").click();
  const panels = ["drums", "bass", "keys", "arp", "pad", "vocal"];
  for (const id of panels) {
    const panel = page.locator(`#${id}-panel`);
    await panel.locator(".section-title").click();
    await expect(panel.locator(".instrument-content")).toBeHidden();
    await expect(panel.locator(".instrument-collapse-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  }
  expect(
    await page.evaluate(() => localStorage.getItem("acid-303-project-v1")),
  ).toBe(before);
  await expect(page.locator("#play")).toHaveAttribute(
    "aria-label",
    "Stop pattern",
  );
  await page.locator("#play").click();
  expect(errors).toEqual([]);
  await page.reload();
  for (const id of panels)
    await expect(page.locator(`#${id}-panel-content`)).toBeHidden();
  await page.locator('[data-instrument-jump="bass-panel"]').click();
  await expect(page.locator("#bass-panel-content")).toBeVisible();
  await page.locator("#bass-mute").click();
  await expect(page.locator("#bass-panel-content")).toBeVisible();
  await page.locator("#bass-panel .instrument-collapse-toggle").press("Enter");
  await expect(page.locator("#bass-panel-content")).toBeHidden();
  await expect(page.locator(".brand-icon, .bass-key")).toHaveCount(0);
});

test("opening fluid/title reveal ends cleanly and a first interaction remains usable", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".opening-wordmark")).toHaveCount(1);
  expect(
    await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[id]")].map(
        (element) => element.id,
      );
      return ids.length === new Set(ids).size;
    }),
  ).toBe(true);
  await expect(page.locator(".opening-wordmark")).toHaveCount(0, {
    timeout: 3000,
  });
  await expect(page.locator(".brand-wordmark")).toBeVisible();
  await expect(page.locator("#visualizer-panel")).toHaveCSS("opacity", "0.3");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#record-automation").click();
  await expect(page.locator(".opening-wordmark")).toHaveCount(0);
  await expect(page.locator("#record-automation")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#play")).toHaveAttribute(
    "aria-label",
    "Play pattern",
  );
});

test("reduced-motion opening skips the transition and mobile collapse does not widen the page", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 900 },
    reducedMotion: "reduce",
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator(".opening-wordmark")).toHaveCount(0);
  await page.locator("#drums-panel .section-title").tap();
  await expect(page.locator("#drums-panel-content")).toBeHidden();
  await page.locator('[data-instrument-jump="drums-panel"]').tap();
  await expect(page.locator("#drums-panel-content")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  await context.close();
});
