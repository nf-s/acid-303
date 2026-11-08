import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { createProject, noteName, readProject } from "../src/model";
import type { Project } from "../src/model";
import {
  progressionChordLabel,
  progressionChordNotes,
} from "../src/progression-model";

const storageKey = "acid-303-project-v1";

async function savedProject(page: Page): Promise<Project> {
  const value = await page.evaluate(
    (key) => localStorage.getItem(key),
    storageKey,
  );
  const parsed: unknown = value === null ? null : JSON.parse(value);
  const project = readProject(parsed);
  if (!project) throw new Error("The saved project is invalid.");
  return project;
}

async function start(page: Page): Promise<Project> {
  const project = createProject();
  project.volume = 0;
  project.pad.chords = [
    { degree: 2, inversion: 1 },
    { degree: 4, inversion: 0 },
    { degree: 0, inversion: 2 },
    { degree: 5, inversion: 0 },
  ];
  project.arp.notes = [57, 64, 60];
  project.vocal.notes = [
    { start: 0, length: 2, note: 60, accent: false },
    { start: 8, length: 3, note: 64, accent: true },
  ];
  await page.addInitScript(
    ({ initial, key }) => {
      if (localStorage.getItem(key) === null)
        localStorage.setItem(key, JSON.stringify(initial));
    },
    { initial: project, key: storageKey },
  );
  await page.goto("/");
  await expect(page.locator("#bass-matrix-canvas")).toBeVisible();
  return project;
}

async function globalHistory(page: Page, direction: "undo" | "redo") {
  const tools = page.locator("#studio-tools");
  if ((await tools.getAttribute("aria-expanded")) !== "true")
    await tools.click();
  await page.locator(`#global-${direction}`).click();
  await tools.click();
}

async function openChords(page: Page): Promise<Locator> {
  const chords = page.locator("#chords-disclosure");
  if ((await chords.getAttribute("open")) === null)
    await chords.locator(":scope > summary").click();
  return page.locator("#progression-controls");
}

async function expectFollowerContexts(page: Page, project: Project) {
  const label = progressionChordLabel(project.progression, project.scale, 0);
  await expect(page.locator("#pad-chord-context")).toHaveText(
    `${label} · ${project.progression.timing.bars} bars`,
  );
  await expect(page.locator("#arp-chord-context")).toHaveText(label);
  await expect(page.locator("#vocal-chord-context")).toHaveText(label);
}

function expectLocalNotes(project: Project, original: Project) {
  expect(project.pad.chords).toEqual(original.pad.chords);
  expect(project.pad.timing).toEqual(original.pad.timing);
  expect(project.arp.notes).toEqual(original.arp.notes);
  expect(project.arp.steps).toEqual(original.arp.steps);
  expect(project.vocal.notes).toEqual(original.vocal.notes);
}

test("shared chords update all followers, undo independently and preserve local notes across reload", async ({
  page,
}) => {
  const original = await start(page);
  await expect(page.locator("#pad-follow-chords")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator("#arp-follow-chords").click();
  await page.locator("#vocal-follow-chords").click();
  await expect(page.locator("#pad-local-chords")).toBeHidden();
  await expect(page.locator(".arp-manual-notes")).toBeHidden();

  await page.locator("#vocal-edit-chords").click();
  const chords = await openChords(page);
  await expect(chords.locator('[data-chord-slot="0"]')).toBeFocused();
  await chords.locator('[data-chord-degree="3"]').click();
  await expect
    .poll(async () => (await savedProject(page)).progression.chords[0]?.degree)
    .toBe(3);
  const changed = await savedProject(page);
  await expectFollowerContexts(page, changed);
  expectLocalNotes(changed, original);

  await globalHistory(page, "undo");
  await expect
    .poll(async () => (await savedProject(page)).progression)
    .toEqual(original.progression);
  await expectFollowerContexts(page, original);
  await globalHistory(page, "redo");
  await expect
    .poll(async () => (await savedProject(page)).progression)
    .toEqual(changed.progression);
  await expectFollowerContexts(page, changed);

  await page.reload();
  for (const instrument of ["pad", "arp", "vocal"])
    await expect(page.locator(`#${instrument}-follow-chords`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  await expectFollowerContexts(page, changed);
  expectLocalNotes(await savedProject(page), original);

  for (const instrument of ["pad", "arp", "vocal"])
    await page.locator(`#${instrument}-follow-chords`).click();
  await expect(page.locator("#pad-local-chords")).toBeVisible();
  await expect(page.locator(".arp-manual-notes")).toBeVisible();
  for (const instrument of ["pad", "arp", "vocal"])
    await expect(page.locator(`#${instrument}-chord-context`)).toBeHidden();
  await expect(
    page.locator('#pad-local-chords [data-chord-slot="0"] small'),
  ).toHaveText(
    progressionChordNotes(original.pad, original.scale, 0)
      .map(noteName)
      .join(" "),
  );
  const selectedNotes = await page
    .locator('[data-arp-note][aria-pressed="true"]')
    .evaluateAll((buttons) =>
      buttons.map((button) => Number(button.getAttribute("data-arp-note"))),
    );
  expect(selectedNotes.sort((a, b) => a - b)).toEqual(
    [...original.arp.notes].sort((a, b) => a - b),
  );
  await expect(
    page.locator('#vocal-roll-access [data-vocal-step="0"]'),
  ).toHaveAttribute("aria-valuenow", "60");
  await expect(
    page.locator('#vocal-roll-access [data-vocal-step="8"]'),
  ).toHaveAttribute("aria-valuenow", "64");
  await expect
    .poll(async () => {
      const saved = await savedProject(page);
      return [
        saved.pad.followChords,
        saved.arp.followChords,
        saved.vocal.followChords,
      ];
    })
    .toEqual([false, false, false]);
  expectLocalNotes(await savedProject(page), original);
  await page.reload();
  for (const instrument of ["pad", "arp", "vocal"])
    await expect(page.locator(`#${instrument}-follow-chords`)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  expectLocalNotes(await savedProject(page), original);
});

async function drawPage(page: Page, canvas: Locator, value: number) {
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("The matrix is not visible.");
  const y = box.y + 24 + (box.height - 52) * (1 - value);
  await page.mouse.move(box.x + 34 + (box.width - 42) / 32, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 34 + ((box.width - 42) * 31) / 32, y, {
    steps: 5,
  });
  await page.mouse.up();
}

async function changeAutomationBars(page: Page, label: string) {
  await page
    .getByRole("button", { name: `${label} automation timing`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: `${label} automation timing`,
    exact: true,
  });
  await dialog
    .locator('[data-pattern-setting="bars"][data-pattern-value="8"]')
    .click();
  await dialog
    .getByRole("button", {
      name: `Done editing ${label} automation timing`,
      exact: true,
    })
    .click();
}

for (const track of ["bass", "keys"]) {
  const label = track === "bass" ? "Bass" : "Texture";
  test(`${label} repeats one-bar context under eight-bar automation and sequence Undo preserves the curve`, async ({
    page,
  }) => {
    const original = await start(page);
    const originalTrack = track === "bass" ? original.bass : original.keys;
    const savedTrack = async () => {
      const project = await savedProject(page);
      return track === "bass" ? project.bass : project.keys;
    };
    const savedCurve = async () => {
      const project = await savedProject(page);
      return track === "bass"
        ? project.bass.automation.cutoff
        : project.keys.automation.tone;
    };
    await page
      .locator(`#${track}-matrix-access [data-matrix-step="0"]`)
      .press("Enter");
    await expect
      .poll(async () => (await savedTrack()).steps[0]?.on)
      .toBe(!originalTrack.steps[0]?.on);
    const editedSteps = (await savedTrack()).steps;
    await page
      .locator(track === "bass" ? "#cutoff" : "#keys-tone")
      .press("Enter");
    await changeAutomationBars(page, label);
    await page
      .getByRole("button", {
        name: `${label} automation choose page`,
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: `${label} automation bar 8, steps 113 to 128`,
        exact: true,
      })
      .click();
    const context = await page
      .locator(`#${track}-automation-access [role="slider"]`)
      .evaluateAll((controls) =>
        controls.map((control) => ({
          step: Number(control.getAttribute("data-matrix-step")),
          on: control.getAttribute("data-on") === "true",
          accent: control.getAttribute("data-accent") === "true",
          slide: control.getAttribute("data-slide") === "true",
        })),
      );
    expect(context).toEqual(
      editedSteps.map((step, index) => ({
        step: 112 + index,
        on: step.on,
        accent: step.accent,
        slide: step.slide,
      })),
    );
    await drawPage(page, page.locator(`#${track}-automation-canvas`), 0.85);
    await expect.poll(async () => (await savedCurve())?.length).toBe(128);
    const curve = await savedCurve();
    expect(curve?.[127]).toBeGreaterThan(0.8);
    expect(curve?.[0]).not.toBeCloseTo(curve?.[127] ?? 0);
    expect((await savedTrack()).steps).toEqual(editedSteps);
    await page.locator(`[data-matrix-undo="${track}"]`).click();
    await expect
      .poll(async () => (await savedTrack()).steps)
      .toEqual(originalTrack.steps);
    expect(await savedCurve()).toEqual(curve);
    expect((await savedTrack()).timing.bars).toBe(1);
    expect((await savedTrack()).automationBars).toBe(8);
    await page.reload();
    expect((await savedTrack()).steps).toEqual(originalTrack.steps);
    expect(await savedCurve()).toEqual(curve);
    await page
      .locator(track === "bass" ? "#cutoff" : "#keys-tone")
      .press("Enter");
    await page.locator(`[data-automation-clear="${track}"]`).click();
    await expect.poll(savedCurve).toBeNull();
    await page.locator(`[data-note-automation-undo="${track}"]`).click();
    await expect.poll(savedCurve).toEqual(curve);
    expect((await savedTrack()).steps).toEqual(originalTrack.steps);
  });
}

test.describe("phone composition", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("disclosures reopen without losing chord edits or overflowing the viewport", async ({
    page,
  }) => {
    const original = await start(page);
    const chords = await openChords(page);
    expect(
      await chords.evaluate(
        (element) => element.closest(".transport") === null,
      ),
    ).toBe(true);
    await chords.locator('[data-chord-bars="8"]').click();
    await chords.locator('[data-chord-slot="2"]').click();
    await chords.locator('[data-chord-degree="4"]').click();
    await chords.locator('[data-chord-inversion="2"]').click();
    await expect
      .poll(async () => (await savedProject(page)).progression.chords[2])
      .toEqual({ degree: 4, inversion: 2 });
    const changed = await savedProject(page);
    expect(changed.progression.timing.bars).toBe(8);
    expectLocalNotes(changed, original);
    const noOverflow = async () =>
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    await noOverflow();
    await page.locator("#chords-disclosure > summary").tap();
    await page.locator("#pad-edit-chords").tap();
    await expect(page.locator("#chords-disclosure")).toHaveAttribute(
      "open",
      "",
    );
    await expect(chords.locator('[data-chord-slot="2"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await noOverflow();

    await page.locator("#cutoff").tap();
    await changeAutomationBars(page, "Bass");
    await page.locator("#bass-panel .instrument-sequence > summary").click();
    await page.locator("#bass-automation-section > summary").click();
    await page.locator('[data-instrument-collapse="bass-panel"]').click();
    await expect(page.locator("#bass-panel-content")).toBeHidden();
    await page.locator('[data-instrument-jump="bass-panel"]').tap();
    await expect(page.locator("#bass-panel-content")).toBeVisible();
    await expect(
      page.locator("#bass-panel .instrument-sequence"),
    ).not.toHaveAttribute("open", "");
    await expect(page.locator("#bass-automation-section")).not.toHaveAttribute(
      "open",
      "",
    );
    await page.locator("#bass-automation-section > summary").click();
    await page.locator("#bass-panel .instrument-sequence > summary").click();
    await expect(page.locator("#bass-matrix-canvas")).toBeVisible();
    await expect(page.locator("#bass-automation-canvas")).toBeVisible();
    await noOverflow();
    await expect
      .poll(async () => (await savedProject(page)).bass.automationBars)
      .toBe(8);
    await page.reload();
    expect((await savedProject(page)).progression).toEqual(changed.progression);
    expect((await savedProject(page)).bass.steps).toEqual(original.bass.steps);
    expect((await savedProject(page)).bass.automationBars).toBe(8);
    await noOverflow();
  });
});
