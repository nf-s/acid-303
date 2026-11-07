import { test, expect } from "@playwright/test";

test("tapping the title on a phone keeps the document and playback running", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Play pattern", exact: true }).tap();
    const origin = await page.evaluate(() => performance.timeOrigin);
    const documents: string[] = [];
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame())
        documents.push(request.url());
    });
    await page.locator(".brand").tap();
    await expect(page.locator("#play")).toHaveAttribute(
      "aria-label",
      "Stop pattern",
    );
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
    expect(documents).toEqual([]);
    await page.getByRole("button", { name: "Stop pattern", exact: true }).tap();
  } finally {
    await context.close();
  }
});
