import { test, expect } from "@playwright/test";
import type { Locator, Page, WebSocketRoute } from "@playwright/test";
import { createProject, projectSchema, scaleNotes } from "../src/model";
import {
  resizeVocalTrack,
  VOCAL_BANKS,
  VOCAL_SOUNDS,
} from "../src/vocal-model";

async function load(page: Page, long = false) {
  const project = createProject();
  if (long)
    project.vocal = resizeVocalTrack(project.vocal, {
      bars: 16,
      meter: "5/4",
      grid: "triplet",
    });
  await page.addInitScript((saved) => {
    if (sessionStorage.getItem("vocal-test-seeded")) return;
    localStorage.setItem("acid-303-project-v1", JSON.stringify(saved));
    sessionStorage.setItem("vocal-test-seeded", "true");
  }, project);
  await page.goto("/");
  await expect(page.locator("#vocal-waveform-path")).toHaveAttribute(
    "data-sound",
    String(project.vocal.sound),
  );
  return project;
}
async function saved(page: Page) {
  await page.waitForFunction(
    () => localStorage.getItem("acid-303-project-v1") !== null,
  );
  return projectSchema.parse(
    JSON.parse(
      (await page.evaluate(() =>
        localStorage.getItem("acid-303-project-v1"),
      )) ?? "null",
    ),
  );
}
async function rollPoint(page: Page, step: number, note: number) {
  const canvas = page.locator("#vocal-roll-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Vocal roll is missing.");
  const project = await saved(page),
    pitches = scaleNotes(project.scale, 48, 72);
  const row = pitches.indexOf(note);
  if (row < 0) throw new Error("Pitch is outside the visible scale.");
  const count = await page.locator("#vocal-roll-access [role=slider]").count();
  return {
    x: box.x + 36 + (step * (box.width - 44)) / count,
    y:
      box.y +
      24 +
      ((pitches.length - row - 0.5) * (box.height - 32)) / pitches.length,
  };
}
async function drawNotes(page: Page, from: number, to: number, note: number) {
  const first = await rollPoint(page, from + 0.5, note),
    last = await rollPoint(page, to + 0.5, note);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(last.x, last.y, { steps: 5 });
  await page.mouse.up();
}
async function studioPanel(page: Page, panel: string) {
  const button = page.locator(`[data-studio-panel="${panel}"]`);
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
}
async function openVocalSounds(page: Page) {
  const knob = page.locator("#vocal-tone");
  if (await knob.isVisible()) return;
  const disclosure = page.locator("#vocal-panel summary").first();
  await disclosure.click();
}
async function curvePoint(canvas: Locator, position: number, value: number) {
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Vocal automation is missing.");
  return {
    x: box.x + 34 + (box.width - 42) * position,
    y: box.y + 24 + (box.height - 52) * (1 - value),
  };
}

test("voice banks offer eight samples each, display their waveform and preview without changing notes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const project = await load(page);
  for (const bank of VOCAL_BANKS) {
    await page.locator(`[data-vocal-bank="${bank.id}"]`).click();
    const sounds = page.locator("[data-vocal-sound]");
    await expect(sounds).toHaveCount(8);
    await expect(sounds.first()).toHaveText(VOCAL_SOUNDS[bank.start] ?? "");
    await page.locator(`[data-vocal-sound="${bank.start + 1}"]`).click();
    await expect(page.locator("#vocal-waveform-path")).toHaveAttribute(
      "data-sound",
      String(bank.start + 1),
    );
    await expect
      .poll(async () => (await saved(page)).vocal.sound)
      .toBe(bank.start + 1);
  }
  expect((await saved(page)).vocal.notes).toEqual(project.vocal.notes);
  await page.locator("#vocal-preview").click();
  await expect(page.locator("#vocal-sample-status")).toHaveText("");
  await page.reload();
  await expect(page.locator('[data-vocal-bank="fighter"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('[data-vocal-sound="17"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(errors).toEqual([]);
});

test("drawing and resizing vocal rectangles preserves one undo entry per gesture", async ({
  page,
}) => {
  await load(page);
  await drawNotes(page, 3, 7, 60);
  await expect
    .poll(
      async () =>
        (await saved(page)).vocal.notes.find((note) => note.start === 3)
          ?.length,
    )
    .toBe(5);
  const before = (await saved(page)).vocal.notes;
  const edge = await rollPoint(page, 7.9, 60),
    end = await rollPoint(page, 10.5, 60);
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await saved(page)).vocal.notes.find((note) => note.start === 3)
          ?.length,
    )
    .toBe(8);
  const after = (await saved(page)).vocal.notes;
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => (await saved(page)).vocal.notes)
    .toEqual(before);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await saved(page)).vocal.notes).toEqual(after);
  const start = await rollPoint(page, 3.5, 60),
    moved = await rollPoint(page, 4.5, 62);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(moved.x, moved.y, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await saved(page)).vocal.notes.find((note) => note.start === 4)?.note,
    )
    .toBe(62);
  expect(
    (await saved(page)).vocal.notes.find((note) => note.start === 4)?.length,
  ).toBe(8);
});

test("adjacent vocal stabs stay separate until Join and keyboard edits pitch and duration", async ({
  page,
}) => {
  await load(page);
  await drawNotes(page, 2, 3, 60);
  const selected = await rollPoint(page, 0.5, 60);
  await page.mouse.click(selected.x, selected.y);
  await expect(page.locator('[data-vocal-note-action="join"]')).toBeEnabled();
  await expect
    .poll(
      async () =>
        (await saved(page)).vocal.notes.filter((note) => note.start < 4).length,
    )
    .toBe(2);
  await page.locator('[data-vocal-note-action="join"]').click();
  await expect
    .poll(
      async () =>
        (await saved(page)).vocal.notes.find((note) => note.start === 0)
          ?.length,
    )
    .toBe(4);
  await page.locator('[data-vocal-note-action="accent"]').click();
  await expect
    .poll(async () => (await saved(page)).vocal.notes[0]?.accent)
    .toBe(true);
  await page.locator('[data-vocal-note-action="delete"]').click();
  await expect
    .poll(async () =>
      (await saved(page)).vocal.notes.some((note) => note.start === 0),
    )
    .toBe(false);
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => (await saved(page)).vocal.notes[0]?.length)
    .toBe(4);
  const cell = page.locator('#vocal-roll-access [data-vocal-step="6"]');
  await cell.press("Enter");
  await cell.press("Shift+ArrowRight");
  await cell.press("ArrowUp");
  await expect
    .poll(async () =>
      (await saved(page)).vocal.notes.find((note) => note.start === 6),
    )
    .toEqual({ start: 6, length: 2, note: 62, accent: false });
  await cell.press("Delete");
  await expect
    .poll(async () =>
      (await saved(page)).vocal.notes.some((note) => note.start === 6),
    )
    .toBe(false);
});

test("waveform trim handles clamp safely, match their knobs and persist with Sustain", async ({
  page,
}) => {
  await load(page);
  await openVocalSounds(page);
  const start = page.locator("#vocal-trim-start"),
    end = page.locator("#vocal-trim-end");
  await start.press("End");
  await expect.poll(async () => (await saved(page)).vocal.start).toBe(0.995);
  await expect(page.locator("#vocal-start")).toHaveAttribute(
    "aria-valuenow",
    "99.5",
  );
  await expect(start).toHaveValue("99.5");
  await start.press("Home");
  await end.press("Home");
  await expect.poll(async () => (await saved(page)).vocal.end).toBe(0.005);
  await expect(end).toHaveValue("0.5");
  await end.press("End");
  await start.press("ArrowRight");
  await page.locator("#vocal-loop").click();
  await expect.poll(async () => (await saved(page)).vocal.loop).toBe(true);
  const vocal = (await saved(page)).vocal;
  await page.reload();
  await expect(page.locator("#vocal-loop")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#vocal-trim-start")).toHaveValue(
    String(vocal.start * 100),
  );
  expect((await saved(page)).vocal).toEqual(vocal);
});

test("all nine vocal automation lanes draw across a sixteen-bar loop", async ({
  page,
}) => {
  const project = await load(page, true);
  await openVocalSounds(page);
  await page.locator("#vocal-tone").press("Enter");
  await page
    .getByRole("group", { name: "Vocal automation view", exact: true })
    .getByRole("button", { name: "Whole loop", exact: true })
    .click();
  for (const parameter of [
    "gain",
    "start",
    "end",
    "attack",
    "release",
    "tone",
    "drive",
    "space",
    "volume",
  ]) {
    await page.locator(`#vocal-${parameter}`).press("Enter");
    const canvas = page.locator("#vocal-matrix-canvas"),
      first = await curvePoint(canvas, 0, 0.15),
      last = await curvePoint(canvas, 1, 0.85);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    await page.mouse.move(last.x, last.y, { steps: 4 });
    await page.mouse.up();
  }
  await expect
    .poll(
      async () =>
        Object.values((await saved(page)).vocal.automation).filter(
          (lane) => lane !== null,
        ).length,
    )
    .toBe(9);
  const vocal = (await saved(page)).vocal;
  for (const lane of Object.values(vocal.automation)) {
    expect(lane).toHaveLength(480);
    expect(lane?.[0]).toBeCloseTo(0.15, 1);
    expect(lane?.[479]).toBeCloseTo(0.85, 1);
  }
  expect(vocal.notes).toEqual(project.vocal.notes);
  await page.reload();
  expect((await saved(page)).vocal).toEqual(vocal);
});

test("a recorded waveform gesture writes automation while preserving the base trim", async ({
  page,
}) => {
  const project = await load(page);
  await page.locator("#record-automation").click();
  await page.locator("#play").click();
  const handle = page.locator("#vocal-trim-start");
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  if (!box) throw new Error("Trim handle is missing.");
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, {
    steps: 5,
  });
  await page.waitForTimeout(450);
  await page.mouse.up();
  await page.locator("#play").click();
  await expect
    .poll(async () =>
      (await saved(page)).vocal.automation.start?.some((value) => value > 0.2),
    )
    .toBe(true);
  expect((await saved(page)).vocal.start).toBe(project.vocal.start);
  await expect(page.locator("#vocal-start")).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
});

for (const width of [320, 375]) {
  test(`vocal notes and trim fit a ${width}px phone with scrolling outside the roll`, async ({
    browser,
    browserName,
  }) => {
    const context = await browser.newContext({
      viewport: { width, height: 820 },
      hasTouch: true,
    });
    const page = await context.newPage();
    await load(page);
    const first = await rollPoint(page, 3.5, 60),
      last = await rollPoint(page, 7.5, 60);
    if (browserName === "chromium") {
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
      const before = await page.evaluate(() => scrollY);
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
      await expect.poll(() => page.evaluate(() => scrollY)).not.toBe(before);
    } else await drawNotes(page, 3, 7, 60);
    await expect
      .poll(
        async () =>
          (await saved(page)).vocal.notes.find((note) => note.start === 3)
            ?.length,
      )
      .toBe(5);
    await page.locator("#vocal-trim-start").press("ArrowRight");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    await context.close();
  });
}

test("vocal final-page keyboard notes stay bounded and follow a changed scale", async ({
  page,
}) => {
  await load(page, true);
  const controls = page.locator("#vocal-pattern-controls");
  await controls.locator('[data-pattern-action="pages"]').click();
  await controls.locator('[data-pattern-page="47"]').click();
  await expect(page.locator("#vocal-roll-access [role=slider]")).toHaveCount(6);
  const cell = page.locator('#vocal-roll-access [data-vocal-step="479"]');
  await cell.press("End");
  await cell.press("Enter");
  await expect
    .poll(async () =>
      (await saved(page)).vocal.notes.find((note) => note.start === 479),
    )
    .toEqual({ start: 479, length: 1, note: 84, accent: false });
  await expect(
    page.locator('[data-vocal-note-action="longer"]'),
  ).toBeDisabled();
  await cell.press("Shift+ArrowRight");
  expect(
    (await saved(page)).vocal.notes.find((note) => note.start === 479)?.length,
  ).toBe(1);
  await studioPanel(page, "scale");
  await page.getByRole("button", { name: "Root F♯", exact: true }).click();
  await page.getByRole("button", { name: "Dorian", exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).scale)
    .toEqual({ root: 6, mode: "dorian" });
  const project = await saved(page),
    allowed = scaleNotes(project.scale, 36, 84);
  expect(project.vocal.notes.every((note) => allowed.includes(note.note))).toBe(
    true,
  );
  await page.reload();
  expect((await saved(page)).vocal.notes).toEqual(project.vocal.notes);
});

async function vocalSession(page: Page): Promise<string> {
  await load(page);
  await studioPanel(page, "session");
  await page
    .getByRole("button", { name: "Create session", exact: true })
    .click();
  await expect(page.locator("#session-status")).toHaveText("Hosting", {
    timeout: 20000,
  });
  const invite = await page.locator("#session-invite-link").inputValue();
  await page.locator('[data-studio-panel="session"]').click();
  return invite;
}

async function countGuestContexts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    let count = 0;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        document.documentElement.dataset.vocalAudioContexts = String(++count);
      }
    };
  });
}

test("two friends share vocals and a held note gesture preserves unrelated remote edits", async ({
  page,
  browser,
}) => {
  const invite = await vocalSession(page);
  const context = await browser.newContext({
    viewport: { width: 1200, height: 1000 },
  });
  const guest = await context.newPage();
  await countGuestContexts(guest);
  try {
    await guest.goto(invite);
    await expect(guest.locator("#session-status")).toHaveText("Connected");
    await expect(guest.locator("#vocal-host-capability")).toBeHidden();
    await guest.locator('[data-vocal-bank="fighter"]').click();
    await guest.locator('[data-vocal-sound="17"]').click();
    await guest.locator("#vocal-loop").click();
    await guest.locator("#vocal-trim-start").press("ArrowRight");
    await drawNotes(guest, 2, 3, 60);
    await expect
      .poll(async () => ({
        sound: (await saved(page)).vocal.sound,
        loop: (await saved(page)).vocal.loop,
        start: (await saved(page)).vocal.start,
        length: (await saved(page)).vocal.notes.find((note) => note.start === 2)
          ?.length,
      }))
      .toEqual({ sound: 17, loop: true, start: 0.001, length: 2 });
    const first = await rollPoint(page, 4.5, 62),
      middle = await rollPoint(page, 5.5, 62),
      last = await rollPoint(page, 6.5, 62);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    await page.mouse.move(middle.x, middle.y);
    await expect
      .poll(
        async () =>
          (await saved(guest)).vocal.notes.find((note) => note.start === 4)
            ?.length,
      )
      .toBe(2);
    await guest.locator('#vocal-roll-access [data-vocal-step="8"]').focus();
    await guest.locator('[data-vocal-note-action="accent"]').click();
    await openVocalSounds(guest);
    await guest.locator("#vocal-tone").press("End");
    await expect
      .poll(async () => ({
        accent: (await saved(page)).vocal.notes.find((note) => note.start === 8)
          ?.accent,
        tone: (await saved(page)).vocal.tone,
      }))
      .toEqual({ accent: true, tone: 1 });
    await page.mouse.move(last.x, last.y);
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await saved(page)).vocal.notes.find((note) => note.start === 4)
            ?.length,
      )
      .toBe(3);
    await expect
      .poll(async () => (await saved(guest)).vocal)
      .toEqual((await saved(page)).vocal);
    expect(
      (await saved(page)).vocal.notes.find((note) => note.start === 8)?.accent,
    ).toBe(true);
    expect((await saved(page)).vocal.tone).toBe(1);
    await expect(guest.locator("html")).not.toHaveAttribute(
      "data-vocal-audio-contexts",
    );
    await studioPanel(page, "session");
    await page
      .getByRole("button", { name: "End session", exact: true })
      .click();
    await expect(guest.locator("#session-status")).toHaveText("Session ended");
  } finally {
    await context.close();
  }
});

test("a missing modern host shows reconnect status without a legacy vocal warning", async ({
  page,
  browser,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "WebKit routing does not reliably close the local server WebSocket in this fixture.",
  );
  test.setTimeout(45000);
  const hostSockets: WebSocketRoute[] = [];
  let allowHostConnection = true;
  await page.routeWebSocket(/\/sessions\//, async (socket) => {
    if (!allowHostConnection) {
      await socket.close();
      return;
    }
    const server = socket.connectToServer();
    hostSockets.push(server);
  });
  const invite = await vocalSession(page),
    context = await browser.newContext(),
    guest = await context.newPage();
  try {
    await guest.goto(invite);
    await expect(guest.locator("#session-status")).toHaveText("Connected");
    await expect(guest.locator("#vocal-host-capability")).toBeHidden();
    const hostSocket = hostSockets[0];
    if (!hostSocket) throw new Error("Host session connection is missing.");
    allowHostConnection = false;
    await page.context().setOffline(true);
    await hostSocket.close({ code: 1000, reason: "Test disconnect" });
    await expect(guest.locator("#session-overlay-title")).toHaveText(
      "Waiting for the host",
      { timeout: 20000 },
    );
    await expect(guest.locator("#vocal-host-capability")).toBeHidden();
    allowHostConnection = true;
    await page.context().setOffline(false);
    await page.reload();
    await expect(page.locator("#session-status")).toHaveText("Hosting", {
      timeout: 20000,
    });
    await expect(guest.locator("#session-overlay")).toBeHidden();
    await expect(guest.locator("#session-host-status")).toBeHidden();
    await expect(guest.locator("#vocal-host-capability")).toBeHidden();
    await studioPanel(page, "session");
    await page
      .getByRole("button", { name: "End session", exact: true })
      .click();
  } finally {
    await page.context().setOffline(false);
    await context.close();
  }
});
