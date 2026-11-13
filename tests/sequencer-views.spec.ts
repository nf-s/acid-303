import { test, expect } from "@playwright/test";
import type { CDPSession, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createProject, projectSchema, scaleNotes } from "../src/model";
import type { Project } from "../src/model";
import { trackStepCount } from "../src/timing";
import type { SequenceTiming } from "../src/timing";

const STORAGE_KEY = "acid-303-project-v1";
const BASS_NOTES = scaleNotes({ root: 9, mode: "minor" }, 24, 60);

/** A quiet bass line and four-bar bass/kick loops make positions predictable. */
function seededProject(): Project {
  const project = createProject();
  const timing: SequenceTiming = { bars: 4, meter: "4/4", grid: "straight" };
  project.bass.timing = { ...timing };
  project.bass.automation = {
    pulse: null,
    shape: null,
    drive: null,
    cutoff: null,
    resonance: null,
    envelope: null,
    decay: null,
    volume: null,
  };
  project.bass.steps = Array.from({ length: trackStepCount(timing) }, () => ({
    note: BASS_NOTES[0] ?? 33,
    on: false,
    accent: false,
    slide: false,
  }));
  return projectSchema.parse(project);
}
async function seed(page: Page, project: Project = seededProject()) {
  await page.addInitScript(
    ({ key, value }) => {
      if (localStorage.getItem(key) === null)
        localStorage.setItem(key, JSON.stringify(value));
    },
    { key: STORAGE_KEY, value: project },
  );
}
async function savedProject(page: Page): Promise<Project> {
  const saved = await page.evaluate(
    (key) => localStorage.getItem(key),
    STORAGE_KEY,
  );
  if (!saved) throw new Error("Project has not saved.");
  const data: unknown = JSON.parse(saved);
  return projectSchema.parse(data);
}
/** Height that lands on the centre of a bass scale row. */
function rowHeight(row: number): number {
  return 1 - row / (BASS_NOTES.length - 1);
}
async function bassPoint(page: Page, step: number, row: number, count = 16) {
  const canvas = page.locator("#bass-matrix-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Bass matrix is missing.");
  return {
    x: box.x + 34 + ((step + 0.5) * (box.width - 42)) / count,
    y: box.y + 24 + (box.height - 52) * rowHeight(row),
  };
}
async function click(page: Page, step: number, row: number) {
  const point = await bassPoint(page, step, row);
  await page.mouse.click(point.x, point.y);
}
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const start = await bassPoint(page, from[0], from[1]);
  const end = await bassPoint(page, to[0], to[1]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
}
function bassSlider(page: Page, step: number) {
  return page.locator(`#bass-matrix-access [data-matrix-step="${step}"]`);
}

test("sequencers switch between pages, bars per page and the whole loop", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/");
  const controls = page.locator("#bass-pattern");
  const sliders = page.locator("#bass-matrix-access [role=slider]");
  await expect(sliders).toHaveCount(16);
  await expect(controls.locator('[data-pattern-action="pages"]')).toHaveText(
    "Page 1/4",
  );
  await page
    .getByRole("button", { name: "Bass 2 bars per page", exact: true })
    .click();
  await expect(sliders).toHaveCount(32);
  await expect(controls.locator('[data-pattern-action="pages"]')).toHaveText(
    "Page 1/2",
  );
  await page
    .getByRole("button", { name: "Bass next page", exact: true })
    .click();
  await expect(sliders.first()).toHaveAttribute("data-matrix-step", "32");
  await expect(sliders.last()).toHaveAttribute("data-matrix-step", "63");
  await page
    .getByRole("button", { name: "Bass whole loop", exact: true })
    .click();
  await expect(sliders).toHaveCount(64);
  await expect(
    page.getByRole("button", { name: "Bass whole loop", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(controls.locator(".pattern-inline-navigation")).toBeHidden();
  await expect(
    page.getByRole("group", { name: "Bass bars per page", exact: true }),
  ).toBeHidden();
  // Cells in the whole loop remain drawable.
  const canvas = await page.locator("#bass-matrix-canvas").boundingBox();
  if (!canvas) throw new Error("Bass matrix is missing.");
  await page.mouse.click(
    canvas.x + 34 + (60.5 * (canvas.width - 42)) / 64,
    canvas.y + 24 + (canvas.height - 52) * rowHeight(4),
  );
  await expect(bassSlider(page, 60)).toHaveAttribute("data-on", "true");
  await page
    .getByRole("button", { name: "Bass page view", exact: true })
    .click();
  await expect(sliders).toHaveCount(32);
  await page
    .getByRole("button", { name: "Bass 1 bar per page", exact: true })
    .click();
  await expect(sliders).toHaveCount(16);

  // The drum grid uses the selected drum's pager.
  const drumPager = page.locator("#drum-simple-pattern");
  await drumPager.locator('[data-pattern-action="open"]').click();
  await drumPager
    .locator('[data-pattern-setting="bars"][data-pattern-value="2"]')
    .click();
  await drumPager.locator('[data-pattern-action="done"]').click();
  await expect(page.locator('[data-drum-step="kick"]')).toHaveCount(16);
  await page
    .getByRole("button", { name: "Kick whole loop", exact: true })
    .click();
  await expect(page.locator('[data-drum-step="kick"]')).toHaveCount(32);
  await expect(
    page.locator('[data-drum-step="kick"][data-step="31"]'),
  ).toHaveCount(1);

  // Automation pages also accept bars per page.
  await page.locator("#bass-volume").press("Enter");
  const automation = page.locator("#bass-automation-pattern");
  await automation.locator('[data-pattern-action="open"]').click();
  await automation
    .locator('[data-pattern-setting="bars"][data-pattern-value="4"]')
    .click();
  await automation.locator('[data-pattern-action="done"]').click();
  await page
    .getByRole("button", {
      name: "Bass automation 4 bars per page",
      exact: true,
    })
    .click();
  await expect(
    page.locator("#bass-automation-access [role=slider]"),
  ).toHaveCount(64);
});

test("bars per page is limited to usable cells at phone width", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await seed(page);
  await page.goto("/");
  await page.locator("#bass-pattern").scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("group", { name: "Bass bars per page", exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Bass whole loop", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#bass-matrix-access [role=slider]")).toHaveCount(
    16,
  );
  await context.close();
});

test("pitch mode places, moves and removes notes by clicking", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/");
  await click(page, 3, 6);
  await expect(bassSlider(page, 3)).toHaveAttribute("data-on", "true");
  await expect(bassSlider(page, 3)).toHaveAttribute(
    "aria-valuenow",
    String(BASS_NOTES[6]),
  );
  await click(page, 3, 9);
  await expect(bassSlider(page, 3)).toHaveAttribute("data-on", "true");
  await expect(bassSlider(page, 3)).toHaveAttribute(
    "aria-valuenow",
    String(BASS_NOTES[9]),
  );
  await click(page, 3, 9);
  await expect(bassSlider(page, 3)).toHaveAttribute("data-on", "false");
  await expect
    .poll(async () => (await savedProject(page)).bass.steps[3]?.on)
    .toBe(false);
  await page
    .getByRole("button", { name: "Undo Bass drawing", exact: true })
    .click();
  await expect(bassSlider(page, 3)).toHaveAttribute("data-on", "true");
  // Accent remains a separate mode.
  await page
    .getByRole("group", { name: "Bass matrix parameter", exact: true })
    .getByRole("button", { name: "Accent", exact: true })
    .click();
  await click(page, 3, BASS_NOTES.length - 2);
  await expect(bassSlider(page, 3)).toHaveAttribute("data-accent", "true");
});

test("dragging from a note ties or glides into the following steps", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/");
  await click(page, 2, 5);
  await drag(page, [2, 5], [5, 5]);
  await expect
    .poll(async () =>
      (await savedProject(page)).bass.steps
        .slice(2, 7)
        .map(({ on, slide, note }) => [on, slide, note]),
    )
    .toEqual([
      [true, true, BASS_NOTES[5]],
      [true, true, BASS_NOTES[5]],
      [true, true, BASS_NOTES[5]],
      [true, false, BASS_NOTES[5]],
      [false, false, BASS_NOTES[0]],
    ]);
  await expect(bassSlider(page, 2)).toHaveAttribute("aria-valuetext", /, tie$/);
  // Dragging back shortens the tie; a new pitch glides.
  await click(page, 9, 3);
  await drag(page, [9, 3], [10, 8]);
  await expect(bassSlider(page, 9)).toHaveAttribute("data-slide", "true");
  await expect(bassSlider(page, 10)).toHaveAttribute("data-on", "true");
  await expect(bassSlider(page, 10)).toHaveAttribute(
    "aria-valuenow",
    String(BASS_NOTES[8]),
  );
  await expect(bassSlider(page, 9)).toHaveAttribute(
    "aria-valuetext",
    /, glide$/,
  );
  const start = await bassPoint(page, 12, 2);
  const far = await bassPoint(page, 15, 2);
  await click(page, 12, 2);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(far.x, far.y, { steps: 8 });
  await page.mouse.move(start.x + 4, start.y, { steps: 8 });
  await page.mouse.up();
  await expect(bassSlider(page, 12)).toHaveAttribute("data-on", "true");
  await expect(bassSlider(page, 12)).toHaveAttribute("data-slide", "false");
  await expect(bassSlider(page, 13)).toHaveAttribute("data-on", "false");
  // Removing a tied note also clears the glide that led into it.
  await click(page, 10, 8);
  await expect(bassSlider(page, 10)).toHaveAttribute("data-on", "false");
  await expect(bassSlider(page, 9)).toHaveAttribute("data-slide", "false");
  // Keyboard: Shift+Right joins or separates the next step.
  const note = bassSlider(page, 5);
  await note.focus();
  await note.press("Shift+ArrowRight");
  await expect(bassSlider(page, 5)).toHaveAttribute("data-slide", "true");
  await expect(bassSlider(page, 6)).toHaveAttribute("data-on", "true");
  await expect(bassSlider(page, 6)).toHaveAttribute(
    "aria-valuenow",
    String(BASS_NOTES[5]),
  );
  await expect(note).toHaveAttribute("aria-valuetext", /, tie$/);
  await note.press("Shift+ArrowRight");
  await expect(bassSlider(page, 5)).toHaveAttribute("data-slide", "false");
});

async function touch(
  session: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  points: Array<{ x: number; y: number }>,
) {
  await session.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((point, index) => ({ id: index + 1, ...point })),
  });
}

test("touch taps and drags edit notes without breaking two-finger drawing", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await seed(page);
  await page.goto("/");
  const session = await context.newCDPSession(page);
  await page.locator("#bass-matrix-canvas").scrollIntoViewIfNeeded();
  const place = await bassPoint(page, 1, 4);
  await touch(session, "touchStart", [place]);
  await touch(session, "touchEnd", []);
  await expect(bassSlider(page, 1)).toHaveAttribute("data-on", "true");
  const end = await bassPoint(page, 3, 4);
  await touch(session, "touchStart", [place]);
  await touch(session, "touchMove", [{ x: (place.x + end.x) / 2, y: place.y }]);
  await touch(session, "touchMove", [end]);
  await touch(session, "touchEnd", []);
  await expect(bassSlider(page, 1)).toHaveAttribute("data-slide", "true");
  await expect(bassSlider(page, 2)).toHaveAttribute("data-slide", "true");
  await expect(bassSlider(page, 3)).toHaveAttribute("data-on", "true");
  await touch(session, "touchStart", [end]);
  await touch(session, "touchEnd", []);
  await expect(bassSlider(page, 3)).toHaveAttribute("data-on", "false");
  // Two fingers still draw independent pitch strokes.
  const a = await bassPoint(page, 6, 2),
    b = await bassPoint(page, 11, 10),
    a2 = await bassPoint(page, 8, 2),
    b2 = await bassPoint(page, 13, 10);
  await touch(session, "touchStart", [a]);
  await touch(session, "touchStart", [a, b]);
  await touch(session, "touchMove", [a2, b2]);
  await touch(session, "touchEnd", []);
  for (const step of [6, 7, 8, 11, 12, 13])
    await expect(bassSlider(page, step)).toHaveAttribute("data-on", "true");
  await context.close();
});

test("solo is additive, local and respected by export", async ({ page }) => {
  const project = createProject();
  project.cloud.muted = true;
  await seed(page, projectSchema.parse(project));
  await page.goto("/");
  const bassSolo = page.getByRole("button", {
    name: "Solo acid bass",
    exact: true,
  });
  await bassSolo.click();
  await page.getByRole("button", { name: "Solo Kick", exact: true }).click();
  await page.getByText("Mixer", { exact: true }).click();
  await expect(bassSolo).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Mixer solo Bass", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Mixer solo Kick", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Mute acid bass", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  for (const name of [
    "Solo Texture",
    "Solo Arpeggiator",
    "Solo chord pads",
    "Solo Vocals",
    "Solo Cloud",
    "Solo Tension",
    "Mixer solo Snare",
  ])
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
  await bassSolo.click();
  await page.getByRole("button", { name: "Solo Kick", exact: true }).click();

  // Soloing the muted Cloud leaves nothing audible in the export.
  await page
    .getByRole("button", { name: "Mixer solo Cloud", exact: true })
    .click();
  await page.locator("#studio-tools").click();
  await expect(
    page.getByRole("button", { name: "Export WAV", exact: true }),
  ).toBeVisible();
  const silent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export WAV", exact: true }).click();
  const silentPath = await (await silent).path();
  if (!silentPath) throw new Error("No WAV file was downloaded.");
  const silentPeak = peak(await readFile(silentPath));
  expect(silentPeak).toBeLessThan(10);
  await page
    .getByRole("button", { name: "Mixer solo Cloud", exact: true })
    .click();
  const audible = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export WAV", exact: true }).click();
  const audiblePath = await (await audible).path();
  if (!audiblePath) throw new Error("No WAV file was downloaded.");
  expect(peak(await readFile(audiblePath))).toBeGreaterThan(1000);

  // Solo is not saved; mutes are unchanged.
  await page
    .getByRole("button", { name: "Mixer solo Snare", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mixer solo Snare", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const saved = await savedProject(page);
  expect(saved.cloud.muted).toBe(true);
  expect(saved.drums.every((drum) => !drum.muted)).toBe(true);
  expect(JSON.stringify(saved)).not.toContain("solo");
  await page.reload();
  await page.getByText("Mixer", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Mixer solo Snare", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
});

function peak(wav: Buffer): number {
  let value = 0;
  for (let index = 44; index < wav.length; index += 2)
    value = Math.max(value, Math.abs(wav.readInt16LE(index)));
  return value;
}
