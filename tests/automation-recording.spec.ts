import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createProject, projectSchema } from "../src/model";

async function saved(page: Page) {
  return projectSchema.parse(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("acid-303-project-v1") ?? "null"),
    ),
  );
}
async function seed(page: Page) {
  const project = createProject();
  project.volume = 0;
  await page.addInitScript(
    (value) =>
      localStorage.setItem("acid-303-project-v1", JSON.stringify(value)),
    project,
  );
}
async function tools(page: Page) {
  const button = page.locator("#studio-tools");
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
}
async function hold(page: Page, id: string) {
  const knob = page.locator(`#${id}`);
  await knob.scrollIntoViewIfNeeded();
  const box = await knob.boundingBox();
  if (!box) throw new Error("Knob is missing");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 70, {
    steps: 6,
  });
}

test("recording writes touched cells, preserves base values, and undoes as one gesture", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/");
  const before = await saved(page);
  await page.locator("#record-automation").click();
  await expect(page.locator("#play")).toHaveAttribute(
    "aria-label",
    "Play pattern",
  );
  await page.locator("#play").click();
  await hold(page, "cutoff");
  await expect
    .poll(
      async () =>
        (await saved(page)).bass.automation.cutoff?.filter(
          (value) => value > 0.7,
        ).length ?? 0,
    )
    .toBeGreaterThan(2);
  await page.mouse.up();
  await page.locator("#play").click();
  const recorded = await saved(page);
  expect(recorded.bass.cutoff).toBe(before.bass.cutoff);
  expect(recorded.bass.automation.cutoff).not.toEqual(
    before.bass.automation.cutoff,
  );
  expect(recorded.keys.automation).toEqual(before.keys.automation);
  await tools(page);
  await page.locator("#global-undo").click();
  await expect
    .poll(async () => (await saved(page)).bass.automation.cutoff)
    .toEqual(before.bass.automation.cutoff);
  await page.locator("#global-redo").click();
  await expect
    .poll(async () => (await saved(page)).bass.automation.cutoff)
    .toEqual(recorded.bass.automation.cutoff);
  expect(
    await page.evaluate(() =>
      JSON.stringify(localStorage.getItem("acid-303-project-v1")),
    ),
  ).not.toContain("armed");
});

test("instrument and mixer controls record independently while global effects remain live", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/");
  const before = await saved(page);
  await page.locator("#record-automation").click();
  await page.locator("#play").click();
  await page.locator("#kick-tone").press("End");
  await page.locator("#keys-width").press("End");
  await page.locator("#arp-gate").press("End");
  await page.locator("#pad-motion").press("End");
  await page.locator("#track-mixer summary").click();
  await page.locator("#mixer-bass").press("Home");
  await expect
    .poll(async () => (await saved(page)).bass.automation.volume)
    .toContain(0);
  await hold(page, "mixer-bass");
  await page.mouse.up();
  await page.locator("#fx-space").press("End");
  await page.locator("#play").click();
  await expect.poll(async () => (await saved(page)).fx.space).toBe(1);
  const after = await saved(page);
  expect(after.drums[0]?.automation.tone).toContain(1);
  expect(after.keys.automation.width).toContain(1);
  expect(after.arp.automation.gate).toContain(1);
  expect(after.pad.automation.motion).toContain(1);
  expect(after.bass.automation.volume).toContain(0);
  expect(Math.max(...(after.bass.automation.volume ?? []))).toBeGreaterThan(
    Math.min(0.99, before.bass.volume + 0.2),
  );
  expect(after.arp.gate).toBe(before.arp.gate);
  expect(after.pad.motion).toBe(before.pad.motion);
  expect(after.bass.volume).toBe(before.bass.volume);
});

test("each session participant arms locally and records into the shared host clock", async ({
  page,
  browser,
}) => {
  await seed(page);
  await page.goto("/");
  await tools(page);
  await page.locator("#session-toggle").click();
  await page
    .getByRole("button", { name: "Create session", exact: true })
    .click();
  await expect(page.locator("#session-status")).toHaveText("Hosting");
  const context = await browser.newContext();
  const guest = await context.newPage();
  const invite = await page.locator("#session-invite-link").inputValue();
  try {
    await guest.goto(invite);
    await expect(guest.locator("#session-status")).toHaveText("Connected");
    await guest.locator("#record-automation").click();
    await expect(page.locator("#record-automation")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await page.locator("#play").click();
    await expect(guest.locator("#play")).toHaveAttribute(
      "aria-label",
      "Stop pattern",
    );
    await guest.locator("#cutoff").press("End");
    await expect
      .poll(async () => (await saved(page)).bass.automation.cutoff)
      .toContain(1);
    await page.locator("#record-automation").click();
    await page.locator("#keys-tone").press("End");
    await expect
      .poll(async () => (await saved(guest)).keys.automation.tone)
      .toContain(1);
    await guest.locator("#record-automation").click();
    await expect(page.locator("#record-automation")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(guest.locator("#audio-status")).toHaveText("AUDIO ON HOST");
    await tools(page);
    await page
      .getByRole("button", { name: "End session", exact: true })
      .click();
    await expect(guest.locator("#record-automation")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  } finally {
    await context.close();
  }
});

test("Record fits beside Stop on a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");
  const play = await page.locator("#play").boundingBox();
  const record = await page.locator("#record-automation").boundingBox();
  if (!play || !record) throw new Error("Transport is missing");
  expect(Math.abs(play.y - record.y)).toBeLessThan(1);
  expect(record.x).toBeGreaterThan(play.x);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
});
