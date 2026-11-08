import { expect, test } from "@playwright/test";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { createProject, readProject } from "../src/model";
import type { Project } from "../src/model";

async function productionPolicy(context: BrowserContext, baseURL: string) {
  const document = await context.request.get(new URL("/", baseURL).href);
  if (document.headers()["content-security-policy"]) return;
  const response = await context.request.get(
    new URL("/_headers", baseURL).href,
  );
  if (!response.ok())
    throw new Error("The production headers could not be loaded.");
  const headers = await response.text();
  const line = headers
    .split("\n")
    .find((value) => value.trim().startsWith("Content-Security-Policy:"));
  if (!line)
    throw new Error("The production content security policy is missing.");
  const policy = line.slice(line.indexOf(":") + 1).trim();
  await context.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": policy },
    });
  });
}

test.beforeEach(async ({ context, baseURL }) => {
  if (!baseURL) throw new Error("The test server URL is missing.");
  await productionPolicy(context, baseURL);
});

async function saved(page: Page): Promise<Project> {
  await page.waitForFunction(
    () => localStorage.getItem("acid-303-project-v1") !== null,
  );
  const raw = await page.evaluate(() =>
    localStorage.getItem("acid-303-project-v1"),
  );
  const value: unknown = raw === null ? null : JSON.parse(raw);
  const project = readProject(value);
  if (!project) throw new Error("The saved project is invalid.");
  return project;
}

async function load(
  page: Page,
  gain = 0.5,
  automated = false,
): Promise<Project> {
  const project = createProject();
  project.volume = 0;
  project.bpm = 180;
  project.vocal.gain = gain;
  project.vocal.muted = false;
  if (automated)
    project.vocal.automation.gain = project.vocal.automation.volume =
      Array.from({ length: 16 }, (_, index) => (index % 2 ? 0.75 : 0.25));
  await page.addInitScript((initial) => {
    if (localStorage.getItem("acid-303-project-v1") === null)
      localStorage.setItem("acid-303-project-v1", JSON.stringify(initial));
  }, project);
  await page.goto("/");
  await expect(page.locator("#vocal-waveform-path")).toHaveAttribute(
    "data-sound",
    String(project.vocal.sound),
  );
  await expect(page.locator("#vocal-gain")).toBeVisible();
  return project;
}

async function tools(page: Page) {
  const button = page.locator("#studio-tools");
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
}

async function history(page: Page, direction: "undo" | "redo") {
  await tools(page);
  await page.locator(`#global-${direction}`).click();
  await page.locator("#studio-tools").click();
}

async function dragUp(page: Page, knob: Locator, distance: number) {
  await knob.scrollIntoViewIfNeeded();
  const box = await knob.boundingBox();
  if (!box) throw new Error("Gain is not visible.");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - distance, { steps: 5 });
  await page.mouse.up();
}

test("saved vocal gain resets to zero dB and supports keyboard, drag and global history", async ({
  page,
}) => {
  const original = await load(page, 0.75);
  const knob = page.locator("#vocal-gain");
  await expect(knob).toHaveAttribute("aria-valuenow", "12");
  await expect(knob).toHaveAttribute("aria-valuetext", "+12.0 dB");
  await expect(page.locator(".vocal-controls .gesture-control")).toHaveCount(8);
  await knob.dblclick();
  await expect(knob).toHaveAttribute("aria-valuenow", "0");
  await expect.poll(async () => (await saved(page)).vocal.gain).toBe(0.5);
  await history(page, "undo");
  await expect.poll(async () => (await saved(page)).vocal.gain).toBe(0.75);
  await history(page, "redo");
  await expect.poll(async () => (await saved(page)).vocal.gain).toBe(0.5);

  await knob.press("Home");
  await expect(knob).toHaveAttribute("aria-valuetext", "-24.0 dB");
  await expect.poll(async () => (await saved(page)).vocal.gain).toBe(0);
  await knob.press("End");
  await expect(knob).toHaveAttribute("aria-valuetext", "+24.0 dB");
  await expect.poll(async () => (await saved(page)).vocal.gain).toBe(1);
  await knob.press("Home");
  await knob.press("PageUp");
  await knob.press("ArrowUp");
  await expect(knob).toHaveAttribute("aria-valuetext", "-22.9 dB");
  await expect
    .poll(async () => (await saved(page)).vocal.gain)
    .toBeCloseTo(1.1 / 48);
  const beforeDrag = (await saved(page)).vocal.gain;
  await dragUp(page, knob, 45);
  await expect
    .poll(async () => (await saved(page)).vocal.gain)
    .toBeGreaterThan(beforeDrag);
  const afterDrag = (await saved(page)).vocal.gain;
  await history(page, "undo");
  await expect
    .poll(async () => (await saved(page)).vocal.gain)
    .toBe(beforeDrag);
  await history(page, "redo");
  await expect.poll(async () => (await saved(page)).vocal.gain).toBe(afterDrag);
  const current = (await saved(page)).vocal;
  expect({ ...current, gain: original.vocal.gain }).toEqual(original.vocal);
});

async function drawGain(page: Page) {
  await page.locator("#vocal-gain").press("Enter");
  await expect(page.locator("#vocal-lane-label")).toHaveText("Gain automation");
  await page.locator('#vocal-automation [data-automation-tool="line"]').click();
  const canvas = page.locator("#vocal-matrix-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Gain automation is not visible.");
  await page.mouse.move(
    box.x + 34 + (box.width - 42) / 32,
    box.y + 24 + (box.height - 52) * 0.75,
  );
  await page.mouse.down();
  await page.mouse.move(
    box.x + 34 + ((box.width - 42) * 31) / 32,
    box.y + 24 + (box.height - 52) * 0.25,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await saved(page)).vocal.automation.gain?.length)
    .toBe(16);
}

test("gain automation uses dB values, shifts correctly and moves only the live marker", async ({
  page,
}) => {
  const original = await load(page);
  const knob = page.locator("#vocal-gain");
  await drawGain(page);
  const curve = (await saved(page)).vocal.automation.gain;
  if (!curve) throw new Error("Gain curve is missing.");
  expect(curve[0]).toBeCloseTo(0.25, 1);
  expect(curve[15]).toBeCloseTo(0.75, 1);
  await expect(
    page.locator('#vocal-matrix-access [data-matrix-step="0"]'),
  ).toHaveAttribute("aria-valuetext", /-1[12]\.\d dB/);
  await knob.press("ArrowUp");
  await expect(knob).toHaveAttribute("aria-valuetext", "+0.1 dB");
  await expect
    .poll(async () => (await saved(page)).vocal.automation.gain?.[0])
    .toBeCloseTo((curve[0] ?? 0) + 0.1 / 48, 8);
  const shifted = (await saved(page)).vocal.automation.gain;
  await page.locator("#vocal-automation-clear").click();
  await expect
    .poll(async () => (await saved(page)).vocal.automation.gain)
    .toBeNull();
  await page.locator("#vocal-automation-undo").click();
  await expect
    .poll(async () => (await saved(page)).vocal.automation.gain)
    .toEqual(shifted);
  expect((await saved(page)).vocal.notes).toEqual(original.vocal.notes);
  expect((await saved(page)).vocal.volume).toBe(original.vocal.volume);
  expect((await saved(page)).vocal.automation.volume).toBeNull();

  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  await expect(knob).toHaveClass(/automation-playing/);
  await expect(knob.locator(".automation-live")).toHaveCSS("display", "block");
  expect(Number(await knob.getAttribute("aria-valuenow"))).toBeCloseTo(0.1, 8);
  const initial = await knob.getAttribute("data-live-value");
  await expect
    .poll(() => knob.getAttribute("data-live-value"))
    .not.toBe(initial);
  expect(Number(await knob.getAttribute("aria-valuenow"))).toBeCloseTo(0.1, 8);
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
  await expect(knob).not.toHaveClass(/automation-playing/);
  await expect(knob).not.toHaveAttribute("data-live-value");
  expect((await saved(page)).vocal.automation.gain).toEqual(shifted);
});

test("gain and its independent curve survive reload and a shared track link", async ({
  page,
  browser,
}) => {
  await load(page, 0.625, true);
  await page.locator("#vocal-gain").press("PageUp");
  await expect
    .poll(async () => (await saved(page)).vocal.gain)
    .toBeCloseTo(31 / 48);
  const before = (await saved(page)).vocal;
  await page.reload();
  await expect(page.locator("#vocal-gain")).toHaveAttribute(
    "aria-valuetext",
    "+7.0 dB",
  );
  expect((await saved(page)).vocal).toEqual(before);
  await tools(page);
  await page.locator("#share-track").click();
  await expect(page.locator("#share-url")).toHaveValue(/#track=v1\./);
  const link = await page.locator("#share-url").inputValue();
  const recipientContext = await browser.newContext();
  try {
    await productionPolicy(recipientContext, link);
    const recipient = await recipientContext.newPage();
    await recipient.goto(link);
    await expect(recipient.locator("#vocal-gain")).toHaveAttribute(
      "aria-valuetext",
      "+7.0 dB",
    );
    await expect
      .poll(async () => (await saved(recipient)).vocal)
      .toEqual(before);
    await recipient.reload();
    expect((await saved(recipient)).vocal).toEqual(before);
  } finally {
    await recipientContext.close();
  }
});

async function dragTrim(
  page: Page,
  browserName: string,
  id: string,
  from: number,
  to: number,
) {
  await page.locator(".vocal-waveform").scrollIntoViewIfNeeded();
  const box = await page.locator(id).boundingBox();
  if (!box) throw new Error("The waveform trim is not visible.");
  expect(box.width).toBeGreaterThan(140);
  const x = (value: number) => box.x + 10 + (box.width - 20) * value;
  const y = box.y + box.height / 2;
  if (browserName === "chromium") {
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ id: 1, x: x(from), y }],
      });
      for (let step = 1; step <= 5; step++)
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ id: 1, x: x(from + ((to - from) * step) / 5), y }],
        });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    } finally {
      await session.detach();
    }
  } else {
    await page.mouse.move(x(from), y);
    await page.mouse.down();
    await page.mouse.move(x(to), y, { steps: 5 });
    await page.mouse.up();
  }
}

for (const width of [320, 390]) {
  test.describe(`${width}px vocal gain`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true });
    test("gain and waveform trims remain usable without horizontal overflow", async ({
      page,
      browserName,
    }) => {
      const original = await load(page, 0.75);
      const knob = page.locator("#vocal-gain");
      await knob.tap();
      await knob.tap();
      await expect(knob).toHaveAttribute("aria-valuetext", "0.0 dB");
      await expect.poll(async () => (await saved(page)).vocal.gain).toBe(0.5);
      await dragTrim(page, browserName, "#vocal-trim-start", 0, 0.25);
      await expect
        .poll(async () => (await saved(page)).vocal.start)
        .toBeGreaterThan(0.1);
      await dragTrim(page, browserName, "#vocal-trim-end", 1, 0.75);
      await expect
        .poll(async () => (await saved(page)).vocal.end)
        .toBeLessThan(0.9);
      const after = (await saved(page)).vocal;
      expect(after.end - after.start).toBeGreaterThan(0.3);
      expect(after.gain).toBe(0.5);
      expect(after.notes).toEqual(original.vocal.notes);
      await expect(
        page.locator(".vocal-controls .gesture-control"),
      ).toHaveCount(8);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
      await page.reload();
      await expect(page.locator("#vocal-gain")).toHaveAttribute(
        "aria-valuetext",
        "0.0 dB",
      );
      expect((await saved(page)).vocal).toEqual(after);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
    });
  });
}
