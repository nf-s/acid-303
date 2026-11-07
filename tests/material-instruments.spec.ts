import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createProject, projectSchema, scaleNotes } from "../src/model";
import { resizeCloudTrack } from "../src/cloud-model";
import { resizeTensionTrack } from "../src/tension-model";

type Instrument = "cloud" | "tension";
async function load(page: Page, long = false, empty = false) {
  const project = createProject();
  if (long) {
    project.cloud = resizeCloudTrack(project.cloud, {
      bars: 16,
      meter: "5/4",
      grid: "triplet",
    });
    project.tension = resizeTensionTrack(project.tension, {
      bars: 16,
      meter: "5/4",
      grid: "triplet",
    });
  }
  if (empty) {
    for (const step of project.cloud.steps) step.on = false;
    for (const step of project.tension.steps) step.on = false;
  }
  await page.addInitScript((saved) => {
    if (sessionStorage.getItem("material-test-seeded")) return;
    localStorage.setItem("acid-303-project-v1", JSON.stringify(saved));
    sessionStorage.setItem("material-test-seeded", "true");
  }, project);
  await page.goto("/");
  await expect(page.locator("#cloud-surface")).toBeAttached();
  await expect(page.locator("#tension-surface")).toBeAttached();
  return project;
}
async function saved(page: Page) {
  return projectSchema.parse(
    JSON.parse(
      (await page.evaluate(() =>
        localStorage.getItem("acid-303-project-v1"),
      )) ?? "null",
    ),
  );
}
async function openSound(page: Page, instrument: Instrument) {
  const details = page.locator(`#${instrument}-panel .material-sound-controls`);
  if ((await details.getAttribute("open")) === null)
    await details.locator("summary").click();
}
async function draw(page: Page, selector: string, first: number, last: number) {
  const canvas = page.locator(selector);
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Material matrix is missing.");
  const width = box.width - 42,
    height = box.height - 52;
  await page.mouse.move(box.x + 34.1, box.y + 24 + height * (1 - first));
  await page.mouse.down();
  await page.mouse.move(
    box.x + 34 + width - 0.1,
    box.y + 24 + height * (1 - last),
    { steps: 12 },
  );
  await page.mouse.up();
}

test("Cloud and Tension retain six sounds and eight adjacent automated controls", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const original = await load(page);
  for (const instrument of ["cloud", "tension"] satisfies Instrument[]) {
    await openSound(page, instrument);
    await expect(
      page.locator(`#${instrument}-panel .material-controls .gesture-control`),
    ).toHaveCount(8);
    await expect(page.locator(`[data-${instrument}-sound]`)).toHaveCount(6);
    for (let sound = 0; sound < 6; sound++) {
      await page.locator(`[data-${instrument}-sound="${sound}"]`).click();
      await expect
        .poll(async () => (await saved(page))[instrument].sound)
        .toBe(sound);
    }
    expect((await saved(page))[instrument].steps).toEqual(
      original[instrument].steps,
    );
    expect((await saved(page))[instrument].muted).toBe(false);
    await page.locator(`#${instrument}-preview`).click();
  }
  expect(errors).toEqual([]);
});

test("material pitch, gate and velocity sequence edits stay in scale and undo as one drawing gesture", async ({
  page,
}) => {
  await load(page);
  for (const instrument of ["cloud", "tension"] satisfies Instrument[]) {
    await draw(page, `#${instrument}-notes-canvas`, 0.15, 0.8);
    await expect
      .poll(async () =>
        (await saved(page))[instrument].steps.every((step) => step.on),
      )
      .toBe(true);
    const project = await saved(page),
      allowed = scaleNotes(project.scale, 36, 84);
    expect(
      project[instrument].steps.every((step) => allowed.includes(step.note)),
    ).toBe(true);
    expect(project[instrument].steps.every((step) => step.on)).toBe(true);
    await page.locator(`[data-${instrument}-attribute="velocity"]`).click();
    const before = (await saved(page))[instrument].steps;
    await page.locator(`[data-${instrument}-tool="line"]`).click();
    await draw(page, `#${instrument}-notes-canvas`, 0.15, 0.9);
    await expect
      .poll(async () => (await saved(page))[instrument].steps[0]?.velocity ?? 1)
      .toBeLessThan(0.25);
    const after = (await saved(page))[instrument].steps;
    expect(after.at(-1)?.velocity ?? 0).toBeGreaterThan(0.8);
    expect(after.map((step) => step.note)).toEqual(
      before.map((step) => step.note),
    );
    await page.keyboard.press("Control+z");
    await expect
      .poll(async () => (await saved(page))[instrument].steps)
      .toEqual(before);
    await page.keyboard.press("Control+Shift+z");
    await expect
      .poll(async () => (await saved(page))[instrument].steps)
      .toEqual(after);
    await page.locator(`[data-${instrument}-attribute="gate"]`).click();
    const first = page.locator(
      `#${instrument}-notes-access [data-matrix-step="0"]`,
    );
    await first.focus();
    await page.keyboard.press("ArrowDown");
    await expect
      .poll(async () => (await saved(page))[instrument].steps[0]?.on)
      .toBe(false);
  }
});

test("each material instrument edits all 480 automation points without replacing its notes", async ({
  page,
}) => {
  const original = await load(page, true);
  for (const instrument of ["cloud", "tension"] satisfies Instrument[]) {
    await openSound(page, instrument);
    const controls = page.locator(
      `#${instrument}-panel .material-controls .gesture-control`,
    );
    for (let index = 0; index < 8; index++) {
      const control = controls.nth(index);
      await control.focus();
      await page.keyboard.press("Enter");
      const automation = page.locator(`#${instrument}-automation`);
      await automation.locator('button[data-automation-view="loop"]').click();
      await draw(page, `#${instrument}-matrix-canvas`, 0.2, 0.85);
      await expect(control).toHaveAttribute("data-automated", "true");
    }
    await expect
      .poll(async () =>
        Object.values((await saved(page))[instrument].automation).every(
          (lane) => lane?.length === 480,
        ),
      )
      .toBe(true);
    const track = (await saved(page))[instrument];
    expect(track.steps).toEqual(original[instrument].steps);
    for (const lane of Object.values(track.automation)) {
      expect(lane).toHaveLength(480);
      expect(lane?.[0] ?? 1).toBeLessThan(0.3);
      expect(lane?.at(-1) ?? 0).toBeGreaterThan(0.75);
    }
  }
});

test("Cloud performance changes scan without overwriting the sequence and releases keyboard notes", async ({
  page,
}) => {
  const original = await load(page),
    surface = page.locator("#cloud-surface");
  await surface.scrollIntoViewIfNeeded();
  const box = await surface.boundingBox();
  if (!box) throw new Error("Cloud field is missing.");
  await page.mouse.move(box.x + 42, box.y + box.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 16, box.y + 35, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => (await saved(page)).cloud.scan)
    .toBeGreaterThan(0.9);
  expect((await saved(page)).cloud.steps).toEqual(original.cloud.steps);
  expect((await saved(page)).cloud.automation).toEqual(
    original.cloud.automation,
  );
  await surface.focus();
  await page.keyboard.down("Space");
  await expect(surface).toHaveAttribute("data-active", "true");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.up("Space");
  await expect(surface).toHaveAttribute("data-active", "false");
  await expect(page.locator("#play")).toHaveAttribute(
    "aria-label",
    "Play pattern",
  );
});

test("320px material surfaces keep performance local and scrolling available outside", async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 320, height: 820 });
  await load(page);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  const surface = page.locator("#tension-surface");
  await surface.scrollIntoViewIfNeeded();
  const box = await surface.boundingBox();
  if (!box) throw new Error("Tension strings are missing.");
  if (browserName === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    const first = { id: 71, x: box.x + 42, y: box.y + 80 },
      second = { id: 72, x: box.x + box.width - 55, y: box.y + 145 };
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [first, second],
    });
    await expect(surface).toHaveAttribute("data-contacts", "2");
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { ...first, x: first.x + 35 },
        { ...second, x: second.x - 30 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [{ ...first, x: first.x + 35 }],
    });
    await expect(surface).toHaveAttribute("data-contacts", "1");
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await expect(surface).toHaveAttribute("data-contacts", "0");
  } else {
    await page.mouse.move(box.x + 42, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + 100);
    await expect(surface).toHaveAttribute("data-contacts", "1");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(surface).toHaveAttribute("data-contacts", "0");
    await page.mouse.up();
  }
  const scroll = await page.evaluate(() => scrollY);
  await page.mouse.move(3, 400);
  await page.mouse.wheel(0, -450);
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeLessThan(scroll - 100);
});

test("local Record captures Cloud motion and Tension notes only on release", async ({
  page,
}) => {
  await load(page, false, true);
  await page.locator("#record-automation").click();
  await page.locator("#play").click();
  const cloud = page.locator("#cloud-surface");
  await cloud.scrollIntoViewIfNeeded();
  const cloudBox = await cloud.boundingBox();
  if (!cloudBox) throw new Error("Cloud field is missing.");
  await page.mouse.move(cloudBox.x + 50, cloudBox.y + cloudBox.height * 0.7);
  await page.mouse.down();
  await expect
    .poll(async () => (await saved(page)).cloud.steps.some((step) => step.on))
    .toBe(true);
  await page.mouse.move(cloudBox.x + cloudBox.width - 30, cloudBox.y + 40, {
    steps: 8,
  });
  await expect
    .poll(
      async () =>
        (await saved(page)).cloud.automation.scan?.some(
          (value) => value > 0.8,
        ) ?? false,
    )
    .toBe(true);
  await page.mouse.up();
  const tension = page.locator("#tension-surface");
  await tension.scrollIntoViewIfNeeded();
  const tensionBox = await tension.boundingBox();
  if (!tensionBox) throw new Error("Tension strings are missing.");
  const before = (await saved(page)).tension.steps;
  await page.mouse.move(
    tensionBox.x + tensionBox.width * 0.4,
    tensionBox.y + 70,
  );
  await page.mouse.down();
  await page.mouse.move(
    tensionBox.x + tensionBox.width * 0.4 + 58,
    tensionBox.y + 125,
    { steps: 8 },
  );
  await expect
    .poll(async () => (await saved(page)).tension.automation.pick)
    .not.toBeNull();
  expect((await saved(page)).tension.steps).toEqual(before);
  await page.mouse.up();
  await expect
    .poll(async () =>
      (await saved(page)).tension.steps.some(
        (step) => step.on && step.velocity > 0.9,
      ),
    )
    .toBe(true);
  await page.locator("#play").click();
  await expect(cloud).toHaveAttribute("data-active", "false");
  await expect(tension).toHaveAttribute("data-active", "false");
});
