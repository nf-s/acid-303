import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { createProject, readProject, resizeDrumAutomation } from "../src/model";
import type { DrumTrack, Project } from "../src/model";

async function savedProject(page: Page): Promise<Project> {
  const value = await page.evaluate(() =>
    localStorage.getItem("acid-303-project-v1"),
  );
  const parsed: unknown = value === null ? null : JSON.parse(value);
  const project = readProject(parsed);
  if (!project) throw new Error("The saved project is invalid.");
  return project;
}
async function savedKick(page: Page): Promise<DrumTrack> {
  const track = (await savedProject(page)).drums.find(
    (drum) => drum.id === "kick",
  );
  if (!track) throw new Error("Kick is missing.");
  return track;
}
async function start(
  page: Page,
  bars: 1 | 8 | null = null,
): Promise<boolean[]> {
  const project = createProject();
  project.drums = project.drums.map((track) =>
    track.id === "kick" ? resizeDrumAutomation(track, bars) : track,
  );
  await page.addInitScript(
    (initial) =>
      localStorage.setItem("acid-303-project-v1", JSON.stringify(initial)),
    project,
  );
  await page.goto("/");
  await expect(page.locator("#kick-pitch")).toBeVisible();
  const kick = project.drums.find((track) => track.id === "kick");
  if (!kick) throw new Error("Kick is missing.");
  return [...kick.steps];
}
async function draw(
  page: Page,
  canvas: Locator,
  from: number,
  to: number,
  level: number,
): Promise<void> {
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Matrix is not visible.");
  const x = (step: number) =>
    box.x + 34 + ((step + 0.5) * (box.width - 42)) / 16;
  const y = box.y + 24 + (1 - level) * (box.height - 52);
  await page.mouse.move(x(from), y);
  await page.mouse.down();
  await page.mouse.move(x(to), y, { steps: 5 });
  await page.mouse.up();
}

test("drums keep separate sequence and automation disclosures across redraws", async ({
  page,
}) => {
  await start(page);
  await page.locator("#kick-pitch").press("Enter");
  await expect(page.locator('[data-drum-mode="advanced"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("[data-drum-sequence]")).toHaveCount(5);
  await expect(page.locator("[data-drum-automation]")).toHaveCount(5);
  await expect(page.locator('[data-drum-automation="kick"]')).toHaveAttribute(
    "open",
    "",
  );
  await expect(
    page.locator('[data-drum-automation="snare"]'),
  ).not.toHaveAttribute("open", "");
  await page.locator('[data-drum-sequence="kick"] > summary').click();
  await page.locator('[data-drum-mode="simple"]').click();
  await expect(page.locator("#beat-canvas")).toBeVisible();
  await expect(page.locator("#drum-simple-sequence")).toBeVisible();
  await expect(
    page.locator(
      "#drum-simple-pattern .pattern-controls, #drum-simple-pattern.pattern-controls",
    ),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Select and preview Snare", exact: true })
    .click();
  await expect(
    page.locator("#drum-simple-pattern .pattern-controls"),
  ).toHaveCount(1);
  await expect(
    page
      .locator("#drum-simple-pattern")
      .getByRole("button", { name: "Snare timing", exact: true }),
  ).toBeVisible();
  await page.locator('[data-drum-mode="advanced"]').click();
  await expect(page.locator('[data-drum-sequence="kick"]')).not.toHaveAttribute(
    "open",
    "",
  );
  await expect(page.locator('[data-drum-automation="kick"]')).toHaveAttribute(
    "open",
    "",
  );
  await expect(page.locator("#kick-pitch")).toHaveCount(1);
  await page.locator("#snare-tone").press("Enter");
  await expect(page.locator('[data-drum-automation="snare"]')).toHaveAttribute(
    "open",
    "",
  );
  await expect(page.locator("#snare-lane-label")).toHaveText("Tone automation");
});

test("an eight-bar drum curve paints its final page without extending the rhythm", async ({
  page,
}) => {
  const gates = await start(page, 8);
  await page.locator("#kick-tone").press("Enter");
  const automation = page.locator('[data-drum-automation="kick"]');
  await automation
    .getByRole("button", { name: "Kick automation choose page", exact: true })
    .click();
  await automation
    .getByRole("button", {
      name: "Kick automation bar 8, steps 113 to 128",
      exact: true,
    })
    .click();
  await draw(page, page.locator("#kick-matrix-canvas"), 0, 15, 0.8);
  await expect
    .poll(async () => (await savedKick(page)).automation.tone?.length)
    .toBe(128);
  const edited = await savedKick(page);
  expect(edited.steps).toEqual(gates);
  expect(edited.automation.tone?.[127]).toBeGreaterThan(0.7);
  expect(edited.automation.tone?.[0]).toBeCloseTo(0.5);
  await page.locator('[data-drum-clear="kick"]').click();
  await expect
    .poll(async () => (await savedKick(page)).automation.tone)
    .toBeNull();
  await page.locator('[data-drum-undo="kick"]').click();
  await expect
    .poll(async () => (await savedKick(page)).automation.tone)
    .toEqual(edited.automation.tone);
  expect((await savedKick(page)).steps).toEqual(gates);
});

test("automation line retraction and keyboard editing never overwrite repeated gate context", async ({
  page,
}) => {
  const gates = await start(page, 8);
  await page.locator("#kick-pitch").press("Enter");
  await page
    .locator('[data-drum-view="loop"][data-drum-target="kick"]')
    .click();
  await expect(page.locator("#kick-matrix-access [role=slider]")).toHaveCount(
    1,
  );
  await page
    .locator(
      '[data-drum-tool="line"][data-drum-target="kick"][data-drum-surface="automation"]',
    )
    .click();
  const canvas = page.locator("#kick-matrix-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Matrix is missing.");
  const x = (phase: number) => box.x + 34 + phase * (box.width - 42);
  const y = box.y + 30;
  await page.mouse.move(x(0.01), y);
  await page.mouse.down();
  await page.mouse.move(x(0.99), y, { steps: 4 });
  await page.mouse.move(x(0.1), y, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => (await savedKick(page)).automation.pitch?.length)
    .toBe(128);
  const track = await savedKick(page);
  expect(track.steps).toEqual(gates);
  expect(track.automation.pitch?.[127]).toBeCloseTo(0.5);
  await page.locator("#kick-matrix-access [role=slider]").press("Enter");
  await expect
    .poll(async () => (await savedKick(page)).automation.pitch)
    .not.toEqual(track.automation.pitch);
  expect((await savedKick(page)).steps).toEqual(gates);
  await page
    .locator("#kick-sequence-access [role=slider]")
    .first()
    .press("Enter");
  await expect
    .poll(async () => (await savedKick(page)).steps[0])
    .toBe(!gates[0]);
  expect((await savedKick(page)).steps).toHaveLength(16);
});

test("phone drum timing changes the automation loop independently and can relink it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const gates = await start(page);
  await page.locator("#kick-decay").press("Enter");
  const automation = page.locator('[data-drum-automation="kick"]');
  await automation
    .getByRole("button", { name: "Kick automation timing", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Kick automation timing",
    exact: true,
  });
  await dialog
    .locator('[data-pattern-setting="bars"][data-pattern-value="8"]')
    .click();
  await dialog
    .getByRole("button", {
      name: "Done editing Kick automation timing",
      exact: true,
    })
    .click();
  await expect.poll(async () => (await savedKick(page)).automationBars).toBe(8);
  expect((await savedKick(page)).steps).toEqual(gates);
  await automation
    .getByRole("button", { name: "Kick automation choose page", exact: true })
    .click();
  await automation
    .getByRole("button", {
      name: "Kick automation bar 8, steps 113 to 128",
      exact: true,
    })
    .click();
  await draw(page, page.locator("#kick-matrix-canvas"), 0, 15, 0.6);
  await expect
    .poll(async () => (await savedKick(page)).automation.decay?.length)
    .toBe(128);
  await automation
    .getByRole("button", { name: "Kick automation timing", exact: true })
    .click();
  await dialog
    .getByRole("button", {
      name: "Kick automation follow sequence length",
      exact: true,
    })
    .click();
  await dialog
    .getByRole("button", {
      name: "Done editing Kick automation timing",
      exact: true,
    })
    .click();
  await expect
    .poll(async () => (await savedKick(page)).automationBars)
    .toBeNull();
  expect((await savedKick(page)).automation.decay).toHaveLength(16);
  expect((await savedKick(page)).steps).toEqual(gates);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("pinning the current automation length keeps it independent when sequence length changes", async ({
  page,
}) => {
  await start(page);
  await page.locator("#kick-tone").press("Enter");
  const automation = page.locator('[data-drum-automation="kick"]');
  await automation
    .getByRole("button", { name: "Kick automation timing", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Kick automation timing",
    exact: true,
  });
  await dialog
    .locator('[data-pattern-setting="bars"][data-pattern-value="1"]')
    .click();
  await dialog
    .getByRole("button", {
      name: "Done editing Kick automation timing",
      exact: true,
    })
    .click();
  await expect.poll(async () => (await savedKick(page)).automationBars).toBe(1);
  await page.locator("#kick-matrix-access [role=slider]").first().press("End");
  await expect
    .poll(async () => (await savedKick(page)).automation.tone?.length)
    .toBe(16);
  await page.getByRole("button", { name: "Kick timing", exact: true }).click();
  const sequenceDialog = page.getByRole("dialog", {
    name: "Kick timing",
    exact: true,
  });
  await sequenceDialog
    .locator('[data-pattern-setting="bars"][data-pattern-value="4"]')
    .click();
  await sequenceDialog
    .getByRole("button", { name: "Done editing Kick timing", exact: true })
    .click();
  await expect.poll(async () => (await savedKick(page)).timing.bars).toBe(4);
  const track = await savedKick(page);
  expect(track.steps).toHaveLength(64);
  expect(track.automationBars).toBe(1);
  expect(track.automation.tone).toHaveLength(16);
  expect(track.automation.tone?.[0]).toBe(1);
});
