import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { build } from "vite";
import { z } from "zod";

import {
  createProject,
  projectSchema,
  resizeBassTrack,
  resizeDrumTrack,
  resizeKeysTrack,
} from "../src/model";
import { resizeArpTrack } from "../src/arp-model";
import { resizePadTrack } from "../src/pad-model";

const overviewResultSchema = z.object({
  values: z.array(z.number()),
  steps: z.array(z.boolean()),
  strokes: z.number(),
  busy: z.boolean(),
});

let matrixHarnessModule: Promise<string> | undefined;

async function buildMatrixHarness(): Promise<string> {
  const root = decodeURIComponent(new URL("../", import.meta.url).pathname);
  const result = await build({
    root,
    configFile: false,
    publicDir: false,
    logLevel: "silent",
    build: {
      lib: {
        entry: `${root}src/note-matrix.ts`,
        formats: ["es"],
        fileName: () => "note-matrix.js",
      },
      write: false,
    },
  });
  const outputs = Array.isArray(result)
    ? result
    : "output" in result
      ? [result]
      : [];
  const entry = outputs
    .flatMap((output) => output.output)
    .find((output) => output.type === "chunk" && output.isEntry);
  if (!entry || entry.type !== "chunk")
    throw new Error("Matrix harness module was not built");
  return entry.code;
}

function longProject() {
  const project = createProject();
  project.arp = resizeArpTrack(project.arp, {
    bars: 8,
    meter: "5/4",
    grid: "triplet",
  });
  project.pad = resizePadTrack(project.pad, {
    bars: 16,
    meter: "5/4",
    grid: "triplet",
  });
  project.bass = resizeBassTrack(project.bass, project.arp.timing);
  project.keys = resizeKeysTrack(project.keys, project.arp.timing);
  project.drums = project.drums.map((track) =>
    resizeDrumTrack(track, project.arp.timing),
  );
  return project;
}
async function loadProject(page: Page) {
  const project = longProject();
  await page.addInitScript((value) => {
    localStorage.setItem("acid-303-project-v1", JSON.stringify(value));
  }, project);
  await page.goto("/");
  return project;
}
async function savedProject(page: Page) {
  const raw = await page.evaluate(() =>
    localStorage.getItem("acid-303-project-v1"),
  );
  return projectSchema.parse(JSON.parse(raw ?? "null"));
}
async function coordinates(canvas: Locator, fraction: number, value: number) {
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Automation matrix is not visible.");
  return {
    x: box.x + 34 + (box.width - 42) * fraction,
    y: box.y + 24 + (box.height - 52) * (1 - value),
  };
}
async function drawLoop(page: Page, track: string) {
  const canvas = page.locator(`#${track}-matrix-canvas`);
  const start = await coordinates(canvas, 0, 0.1);
  const end = await coordinates(canvas, 0.99999, 0.9);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
}
async function wholeLoop(page: Page, label: string) {
  await page
    .getByRole("group", { name: `${label} automation view`, exact: true })
    .getByRole("button", { name: "Whole loop", exact: true })
    .click();
}
function expectRamp(lane: ReadonlyArray<number> | null, length: number) {
  expect(lane).toHaveLength(length);
  if (!lane) throw new Error("Automation curve was not saved.");
  expect(lane[0]).toBeCloseTo(0.1, 1);
  expect(lane[length - 1]).toBeCloseTo(0.9, 1);
  for (let index = 1; index < lane.length; index++) {
    const previous = lane[index - 1],
      current = lane[index];
    if (previous === undefined || current === undefined)
      throw new Error("Automation contains a missing point.");
    expect(current).toBeGreaterThanOrEqual(previous);
    expect(current - previous).toBeLessThan(0.02);
  }
}

test("one line draws the complete 16-bar pad curve and global undo restores it", async ({
  page,
}) => {
  const original = await loadProject(page);
  await page.locator("#pad-tone").press("Enter");
  await wholeLoop(page, "Pad");
  await page.locator('#pad-panel [data-automation-tool="line"]').click();
  await drawLoop(page, "pad");
  await expect
    .poll(async () => (await savedProject(page)).pad.automation.tone?.[479])
    .toBeGreaterThan(0.85);
  const curve = (await savedProject(page)).pad.automation.tone;
  expectRamp(curve, 480);
  expect((await savedProject(page)).pad.chords).toEqual(original.pad.chords);
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => (await savedProject(page)).pad.automation.tone)
    .toBeNull();
  await page.keyboard.press("Control+Shift+z");
  await expect
    .poll(async () => (await savedProject(page)).pad.automation.tone)
    .toEqual(curve);
  await expect(page.locator("#pad-matrix-canvas")).toHaveAttribute(
    "data-automation-view",
    "loop",
  );
});

test("every Arp and Pad lane draws across the entire loop without changing notes", async ({
  page,
}) => {
  const original = await loadProject(page);
  const targets: Array<"arp" | "pad"> = ["arp", "pad"];
  for (const track of targets) {
    const knobs = page.locator(`#${track}-panel .gesture-control`);
    await wholeLoop(page, track === "arp" ? "Arpeggiator" : "Pad");
    for (let index = 0; index < 8; index++) {
      await knobs.nth(index).press("Enter");
      await drawLoop(page, track);
      await expect(knobs.nth(index)).toHaveAttribute("data-automated", "true");
    }
    await expect
      .poll(
        async () =>
          Object.values((await savedProject(page))[track].automation).filter(
            (lane) => lane !== null,
          ).length,
      )
      .toBe(8);
    for (const lane of Object.values(
      (await savedProject(page))[track].automation,
    ))
      expectRamp(lane, track === "pad" ? 480 : 240);
  }
  const project = await savedProject(page);
  expect(project.arp.notes).toEqual(original.arp.notes);
  expect(project.arp.steps).toEqual(original.arp.steps);
  expect(project.arp.accents).toEqual(original.arp.accents);
  expect(project.pad.chords).toEqual(original.pad.chords);
});

test("whole-loop keyboard navigation preserves the chosen page and Arp gate editing", async ({
  page,
}) => {
  await loadProject(page);
  const controls = page.locator("#arp-pattern-controls");
  await controls.locator('[data-pattern-action="pages"]').click();
  await controls.locator('[data-pattern-page="23"]').click();
  await page.locator("#arp-tone").press("Enter");
  await wholeLoop(page, "Arpeggiator");
  const access = page.locator("#arp-matrix-access [role=slider]");
  await expect(access).toHaveCount(1);
  await expect(access).toHaveAttribute("data-matrix-step", "234");
  await access.press("ArrowRight");
  await access.press("PageUp");
  await expect(access).toHaveAttribute("data-matrix-step", "205");
  await access.press("End");
  await expect
    .poll(async () => (await savedProject(page)).arp.automation.tone?.[205])
    .toBe(1);
  await page
    .getByRole("group", { name: "Arpeggiator automation view", exact: true })
    .getByRole("button", { name: "Page", exact: true })
    .click();
  await expect(page.locator("#arp-matrix-access [role=slider]")).toHaveCount(6);
  await expect(
    page.locator('#arp-matrix-access [data-matrix-step="239"]'),
  ).toBeAttached();
  const gate = page.locator('[data-arp-step="239"]');
  const before = await gate.getAttribute("aria-pressed");
  await gate.click();
  await expect(gate).toHaveAttribute(
    "aria-pressed",
    before === "true" ? "false" : "true",
  );
});

test("all drum curves use Whole loop while Gates returns to the selected page", async ({
  page,
}) => {
  const original = await loadProject(page);
  await page.locator('[data-drum-mode="advanced"]').click();
  const controls = page.getByRole("button", {
    name: "Kick choose page",
    exact: true,
  });
  await controls.click();
  await page
    .locator(
      '.drum-detail[aria-label="Kick automation"] [data-pattern-page="23"]',
    )
    .click();
  await wholeLoop(page, "Kick");
  const knobs = page.locator(
    '.drum-detail[aria-label="Kick automation"] .gesture-control',
  );
  for (let index = 0; index < 8; index++) {
    await knobs.nth(index).press("Enter");
    await drawLoop(page, "kick");
  }
  await expect
    .poll(
      async () =>
        Object.values(
          (await savedProject(page)).drums.find((track) => track.id === "kick")
            ?.automation ?? {},
        ).filter((lane) => lane !== null).length,
    )
    .toBe(8);
  const kick = (await savedProject(page)).drums.find(
    (track) => track.id === "kick",
  );
  if (!kick) throw new Error("Kick track is missing.");
  for (const lane of Object.values(kick.automation)) expectRamp(lane, 240);
  expect(kick.steps).toEqual(
    original.drums.find((track) => track.id === "kick")?.steps,
  );
  await page.locator('[data-drum-gates="kick"]').click();
  await expect(
    page.getByRole("group", { name: "Kick automation view", exact: true }),
  ).toBeHidden();
  await expect(page.locator("#kick-matrix-canvas")).toHaveAttribute(
    "data-automation-view",
    "page",
  );
  await expect(
    page.locator('#kick-matrix-access [data-matrix-step="239"]'),
  ).toBeAttached();
  await page.locator("#kick-tone").press("Enter");
  await expect(page.locator("#kick-matrix-canvas")).toHaveAttribute(
    "data-automation-view",
    "loop",
  );
  const access = page.locator("#kick-matrix-access [role=slider]");
  await access.press("Enter");
  expect(
    (await savedProject(page)).drums.find((track) => track.id === "kick")
      ?.steps,
  ).toEqual(kick.steps);
});

test("Bass and Texture whole-loop automation leaves the paged pitch editor intact", async ({
  page,
}) => {
  const original = await loadProject(page);
  const targets: Array<{
    track: "bass" | "keys";
    label: string;
    knob: string;
    parameter: "cutoff" | "tone";
  }> = [
    { track: "bass", label: "Bass", knob: "cutoff", parameter: "cutoff" },
    { track: "keys", label: "Texture", knob: "keys-tone", parameter: "tone" },
  ];
  for (const target of targets) {
    await page.locator(`#${target.knob}`).press("Enter");
    await wholeLoop(page, target.label);
    await drawLoop(page, target.track);
    await expect
      .poll(async () =>
        target.parameter === "cutoff"
          ? (await savedProject(page)).bass.automation.cutoff?.[239]
          : (await savedProject(page)).keys.automation.tone?.[239],
      )
      .toBeGreaterThan(0.85);
    const track = (await savedProject(page))[target.track];
    const lane =
      target.parameter === "cutoff"
        ? (await savedProject(page)).bass.automation.cutoff
        : (await savedProject(page)).keys.automation.tone;
    expectRamp(lane, 240);
    expect(track.steps).toEqual(original[target.track].steps);
    await page
      .locator(
        `[data-matrix-parameter="pitch"][data-matrix-track="${target.track}"]`,
      )
      .click();
    await expect(
      page.locator(`#${target.track}-matrix-canvas`),
    ).toHaveAttribute("data-automation-view", "page");
    await expect(
      page.locator(`#${target.track}-matrix-access [role=slider]`),
    ).toHaveCount(12);
  }
});

for (const width of [320, 375]) {
  test(`a ${width}px phone can draw all 480 points without horizontal overflow`, async ({
    browser,
    browserName,
  }) => {
    const context = await browser.newContext({
      viewport: { width, height: 820 },
      hasTouch: true,
    });
    const page = await context.newPage();
    await loadProject(page);
    await page.locator("#pad-tone").press("Enter");
    await wholeLoop(page, "Pad");
    await expect(page.locator("#pad-matrix-canvas")).toHaveAttribute(
      "data-automation-view",
      "loop",
    );
    if (browserName === "chromium") {
      const canvas = page.locator("#pad-matrix-canvas");
      const first = await coordinates(canvas, 0, 0.1),
        last = await coordinates(canvas, 0.99999, 0.9);
      const session = await context.newCDPSession(page);
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ id: 1, ...first }],
      });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ id: 1, ...last }],
      });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      const before = await page.evaluate(() => window.scrollY);
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ id: 1, x: 3, y: 600 }],
      });
      for (const y of [550, 500, 450, 400])
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ id: 1, x: 3, y }],
        });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect
        .poll(() => page.evaluate(() => window.scrollY))
        .not.toBe(before);
    } else await drawLoop(page, "pad");
    await expect
      .poll(async () => (await savedProject(page)).pad.automation.tone?.[479])
      .toBeGreaterThan(0.85);
    expectRamp((await savedProject(page)).pad.automation.tone, 480);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    await context.close();
  });
}

async function matrixHarness(page: Page) {
  matrixHarnessModule ??= buildMatrixHarness();
  const module = await matrixHarnessModule;
  const response = await page.request.get("/");
  if (!response.ok()) throw new Error("Harness origin is unavailable");
  const policy =
    response.headers()["content-security-policy"] ??
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
  await page.route("**/automation-overview-module.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: module }),
  );
  await page.route("**/automation-overview-bootstrap.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `import { NoteMatrix } from '/automation-overview-module.js';
      const canvas = document.querySelector('#matrix'), access = document.querySelector('#access');
      const steps = Array.from({length:480}, () => ({note:48,on:true,accent:false,slide:false}));
      let values = Array(480).fill(.5), queued=false, strokes=0;
      const lane = () => ({id:'tone',label:'Tone',values,base:.5,format:value=>String(Math.round(value*100))});
      const refresh = () => {
        queued=false;
        matrix.setAutomation(lane());
        document.querySelector('#result').textContent=JSON.stringify({values,steps:steps.map(step=>step.on),strokes,busy:matrix.busy});
      };
      const matrix = new NoteMatrix(canvas,access,'Test',24,72,change=>{
        if(change.parameter==='automation')values[change.index]=change.value;
        else if(change.parameter==='restore'&&change.automation)values=change.automation.values?[...change.automation.values]:Array(480).fill(.5);
        if(!queued){queued=true;queueMicrotask(refresh);}
      },()=>{strokes++;});
      matrix.update(steps,{root:0,mode:'minor'});
      matrix.setAutomation(lane());
      matrix.setAutomationView('loop',16);
      matrix.setTool(new URL(location.href).searchParams.has('draw')?'draw':'line');
      document.querySelector('#remote').addEventListener('click',()=>{
        const next=[...values];next[400]=.93;
        matrix.rebaseIncoming(steps,next);
        values=next;
        matrix.setViewport({start:468,count:12});
        refresh();
      });
      refresh();
    `,
    }),
  );
  await page.route("**/automation-overview-harness*", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: { "Content-Security-Policy": policy },
      body: `<!doctype html><html><body><style>canvas{width:600px;height:250px;touch-action:none}#access{position:absolute;pointer-events:none}output{display:none}</style><button id="remote">Remote edit</button><div><canvas id="matrix"></canvas><div id="access"></div></div><output id="result"></output><script type="module" src="/automation-overview-bootstrap.js"></script></body></html>`,
    }),
  );
  await page.goto("/automation-overview-harness");
  await expect(page.locator("#matrix")).toHaveAttribute(
    "data-automation-view",
    "loop",
  );
}

test("retracting an overview line preserves concurrent remote edits outside its final span", async ({
  page,
}) => {
  await matrixHarness(page);
  const canvas = page.locator("#matrix");
  const first = await coordinates(canvas, 0, 0.1);
  const far = await coordinates(canvas, 300.5 / 480, 0.9);
  const close = await coordinates(canvas, 51.5 / 480, 0.3);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(far.x, far.y);
  await page.locator("#remote").evaluate((button) => {
    if (button instanceof HTMLButtonElement) button.click();
  });
  await expect(page.locator("#result")).toContainText('"busy":true');
  await page.mouse.move(close.x, close.y);
  await page.mouse.up();
  const state = await page.locator("#result").textContent();
  const parsed = overviewResultSchema.parse(JSON.parse(state ?? "null"));
  expect(parsed.values[0]).toBeCloseTo(0.1, 1);
  expect(parsed.values[49]).toBeCloseTo(0.3, 1);
  expect(parsed.values.slice(52, 400)).toEqual(Array(348).fill(0.5));
  expect(parsed.values[400]).toBe(0.93);
  expect(parsed.values.slice(401)).toEqual(Array(79).fill(0.5));
  expect(parsed.steps).toEqual(Array(480).fill(true));
  expect(parsed.strokes).toBe(1);
});

test("two fingers paint independent parts of a whole loop as one stroke", async ({
  browser,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Native multi-touch injection requires Chromium.",
  );
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 1000, height: 700 },
  });
  const page = await context.newPage();
  await matrixHarness(page);
  await page.evaluate(() => history.replaceState(null, "", "?draw"));
  await page.reload();
  await expect(page.locator("#matrix")).toHaveAttribute(
    "data-automation-view",
    "loop",
  );
  const canvas = page.locator("#matrix");
  const a = await coordinates(canvas, 0.1, 0.2),
    b = await coordinates(canvas, 0.9, 0.8),
    c = await coordinates(canvas, 0.25, 0.3),
    d = await coordinates(canvas, 0.75, 0.7);
  const session = await context.newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 1, ...a }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 1, ...a },
      { id: 2, ...b },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { id: 1, ...c },
      { id: 2, ...d },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  const state = await page.locator("#result").textContent();
  const parsed = overviewResultSchema.parse(JSON.parse(state ?? "null"));
  expect(parsed.values[60]).toBeLessThan(0.35);
  expect(parsed.values[400]).toBeGreaterThan(0.65);
  expect(parsed.values.slice(130, 350)).toEqual(Array(220).fill(0.5));
  expect(parsed.strokes).toBe(1);
  expect(parsed.steps).toEqual(Array(480).fill(true));
  await context.close();
});
