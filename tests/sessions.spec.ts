import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { projectSchema, createProject, resizeBassTrack } from "../src/model";
import { clientMessageSchema } from "../src/session-protocol";

async function saved(page: Page) {
  await page.waitForFunction(
    () => localStorage.getItem("acid-303-project-v1") !== null,
  );
  return projectSchema.parse(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("acid-303-project-v1") ?? "null"),
    ),
  );
}
async function countAudioContexts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    let count = 0;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        document.documentElement.dataset.audioContexts = String(++count);
      }
    };
  });
}
async function hostSession(page: Page): Promise<string> {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Track controls", exact: true })
    .click();
  await page.getByRole("button", { name: "Session", exact: true }).click();
  await page
    .getByRole("button", { name: "Create session", exact: true })
    .click();
  await expect(page.locator("#session-status")).toHaveText("Hosting", {
    timeout: 20000,
  });
  const link = await page.locator("#session-invite-link").inputValue();
  expect(link).toContain("#session=");
  return link;
}

test("a failed session request keeps the local instrument usable", async ({
  page,
}) => {
  await page.route("**/sessions", (route) =>
    route.fulfill({ status: 500, body: "Unavailable" }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Track controls", exact: true })
    .click();
  await page.getByRole("button", { name: "Session", exact: true }).click();
  await page
    .getByRole("button", { name: "Create session", exact: true })
    .click();
  await expect(page.locator("#session-status")).toHaveText("Connection error");
  await expect(page.locator(".workspace")).not.toHaveAttribute("inert");
  await page.locator("#bpm").press("End");
  await expect.poll(async () => (await saved(page)).bpm).toBe(180);
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop pattern", exact: true }),
  ).toBeVisible();
});

test("friends edit together while transport and all audio remain on the host", async ({
  page,
  browser,
}) => {
  await countAudioContexts(page);
  const invite = await hostSession(page);
  const context = await browser.newContext({
    viewport: { width: 375, height: 900 },
    hasTouch: true,
    isMobile: true,
  });
  const guest = await context.newPage();
  await countAudioContexts(guest);
  await guest.goto(invite);
  await expect(guest.locator("#session-status")).toHaveText("Connected");
  await expect(page.locator("#session-participants")).toHaveText(
    "2 participants",
  );
  await expect(guest.locator("#audio-status")).toHaveText("AUDIO ON HOST");
  await Promise.all([
    page.locator("#cutoff").press("End"),
    guest.locator("#arp-shape").press("End"),
  ]);
  await expect
    .poll(async () => ({
      bass: (await saved(page)).bass.cutoff,
      arp: (await saved(page)).arp.shape,
    }))
    .toEqual({ bass: 8000, arp: 1 });
  await expect.poll(async () => (await saved(guest)).bass.cutoff).toBe(8000);
  await guest
    .getByRole("button", { name: "Play pattern", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop pattern", exact: true }),
  ).toBeVisible();
  await expect(
    guest.getByRole("button", { name: "Stop pattern", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => guest.locator("[data-arp-step].current").count())
    .toBe(1);
  await expect(guest.locator("html")).not.toHaveAttribute(
    "data-audio-contexts",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-audio-contexts",
    "1",
  );
  await guest
    .getByRole("button", { name: "Stop pattern", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Play pattern", exact: true }),
  ).toBeVisible();
  await guest.locator('[data-drum="snare"]').click();
  await guest.locator('[data-arp-sound="3"]').click();
  await guest.locator("#pad-tone").press("ArrowUp");
  await expect(guest.locator("html")).not.toHaveAttribute(
    "data-audio-contexts",
  );
  await expect.poll(async () => (await saved(page)).arp.sound).toBe(3);
  await expect
    .poll(() =>
      guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.getByRole("button", { name: "End session", exact: true }).click();
  await expect(guest.locator("#session-status")).toHaveText("Session ended");
  await expect(guest.locator("#session-host-status")).toBeHidden();
  await guest.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(guest.locator(".workspace")).not.toHaveAttribute("inert");
  await expect(guest.locator("html")).not.toHaveAttribute(
    "data-audio-contexts",
  );
  await context.close();
});

test("reload resumes the room and an extra host tab cannot play alongside the host", async ({
  page,
  browser,
}) => {
  const invite = await hostSession(page);
  const context = await browser.newContext();
  const guest = await context.newPage();
  await countAudioContexts(guest);
  await guest.goto(invite);
  await expect(guest.locator("#session-status")).toHaveText("Connected");
  await guest.locator("#keys-tone").press("End");
  await expect.poll(async () => (await saved(page)).keys.tone).toBe(1);
  await guest.reload();
  await expect(guest.locator("#session-status")).toHaveText("Connected");
  await expect(guest.locator("#keys-tone")).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  await expect(guest.locator("html")).not.toHaveAttribute(
    "data-audio-contexts",
  );
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  await page.context().setOffline(true);
  await expect(page.locator("#session-status")).toHaveText("Reconnecting");
  await expect(
    page.getByRole("button", { name: "Play pattern", exact: true }),
  ).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.locator("#session-status")).toHaveText("Hosting");
  await expect(
    page.getByRole("button", { name: "Play pattern", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  const credentials = await page.evaluate(() =>
    sessionStorage.getItem("grain-session-v1"),
  );
  if (!credentials) throw new Error("Missing host credentials");
  const replacement = await page.context().newPage();
  await replacement.addInitScript(
    (stored) => sessionStorage.setItem("grain-session-v1", stored),
    credentials,
  );
  await replacement.goto("/");
  await expect(replacement.locator("#session-status")).toHaveText("Hosting");
  await expect(page.locator("#session-status")).toHaveText("Connection error");
  await expect(
    page.getByRole("button", { name: "Play pattern", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#session-message")).toContainText(
    "another tab or device",
  );
  await replacement
    .getByRole("button", { name: "Play pattern", exact: true })
    .click();
  await expect(
    guest.getByRole("button", { name: "Stop pattern", exact: true }),
  ).toBeVisible();
  await expect(guest.locator("html")).not.toHaveAttribute(
    "data-audio-contexts",
  );
  await replacement
    .getByRole("button", { name: "End session", exact: true })
    .click();
  await expect(guest.locator("#session-status")).toHaveText("Session ended");
  await replacement.close();
  await context.close();
});

test("drawing a line preserves a friend's edit outside the stroke", async ({
  page,
  browser,
}) => {
  const invite = await hostSession(page);
  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto(invite);
  await expect(guest.locator("#session-status")).toHaveText("Connected");
  await page
    .locator('[data-matrix-track="bass"][data-matrix-tool="line"]')
    .click();
  const canvas = page.locator("#bass-matrix-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Missing Bass matrix");
  const x = (step: number) =>
    box.x + 34 + ((step + 0.5) * (box.width - 42)) / 16;
  const y = box.y + 24 + (box.height - 52) * 0.45;
  await page.mouse.move(x(0), y);
  await page.mouse.down();
  await page.mouse.move(x(2), y - 10);
  await guest
    .locator('[data-matrix-track="bass"][data-matrix-parameter="accent"]')
    .click();
  await guest
    .getByRole("slider", { name: "Bass accent step 16", exact: true })
    .press("End");
  await expect
    .poll(async () => (await saved(page)).bass.steps[15]?.accent)
    .toBe(true);
  await page.mouse.move(x(3), y + 10);
  await page.mouse.up();
  await expect
    .poll(async () => (await saved(page)).bass.steps[15]?.accent)
    .toBe(true);
  await expect
    .poll(async () => (await saved(guest)).bass.steps[15]?.accent)
    .toBe(true);
  await page.getByRole("button", { name: "End session", exact: true }).click();
  await context.close();
});

test("long triplet patterns, mixer edits and automation clocks stay shared without guest audio", async ({
  page,
  browser,
}) => {
  const initial = createProject();
  initial.bass = resizeBassTrack(initial.bass, {
    bars: 2,
    meter: "5/4",
    grid: "triplet",
  });
  initial.bass.automation.cutoff = Array.from(
    { length: 60 },
    (_, index) => index / 59,
  );
  await page.addInitScript(
    (project) =>
      localStorage.setItem("acid-303-project-v1", JSON.stringify(project)),
    initial,
  );
  const clocks: Array<{ time: number; playing: boolean; tick: number }> = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      if (typeof frame.payload !== "string" || frame.payload === "ping") return;
      const message = clientMessageSchema.safeParse(JSON.parse(frame.payload));
      if (message.success && message.data.type === "clock")
        clocks.push({
          time: Date.now(),
          playing: message.data.playing,
          tick: message.data.absoluteTick,
        });
    }),
  );
  const invite = await hostSession(page);
  const context = await browser.newContext({
    viewport: { width: 375, height: 950 },
    hasTouch: true,
    isMobile: true,
  });
  const guest = await context.newPage();
  await countAudioContexts(guest);
  await guest.goto(invite);
  await expect(guest.locator("#session-status")).toHaveText("Connected");
  await expect
    .poll(async () => (await saved(guest)).bass.steps.length)
    .toBe(60);
  await guest.locator('#bass-pattern [data-pattern-page="5"]').click();
  const lastCell = guest.getByRole("slider", {
    name: "Bass note step 60",
    exact: true,
  });
  await lastCell.press("End");
  await expect
    .poll(async () => (await saved(page)).bass.steps[59]?.note)
    .toBe(60);
  await guest.getByText("Mixer", { exact: true }).click();
  await guest.locator("#mixer-hat").press("Home");
  await guest.locator('[data-mixer-mute="keys"]').click();
  await expect
    .poll(
      async () =>
        (await saved(page)).drums.find((drum) => drum.id === "hat")?.volume,
    )
    .toBe(0);
  await expect.poll(async () => (await saved(page)).keys.muted).toBe(true);
  await guest.locator("#fx-echo").press("End");
  await expect.poll(async () => (await saved(page)).fx.echo).toBe(1);
  await guest
    .getByRole("button", { name: "Play pattern", exact: true })
    .click();
  await expect(guest.locator("#cutoff")).toHaveClass(/automation-playing/);
  const first = await guest.locator("#cutoff").getAttribute("data-live-value");
  await expect
    .poll(() => guest.locator("#cutoff").getAttribute("data-live-value"))
    .not.toBe(first);
  await expect
    .poll(() => clocks.filter((clock) => clock.playing).length)
    .toBeGreaterThan(25);
  const playing = clocks.filter((clock) => clock.playing);
  for (let index = 1; index < playing.length; index++) {
    const previous = playing[index - 1],
      current = playing[index];
    if (previous && current)
      expect(current.tick).toBeGreaterThan(previous.tick);
  }
  const start = playing[0];
  if (!start) throw new Error("No host clock was sent");
  expect(
    playing.filter(
      (clock) => clock.time >= start.time && clock.time < start.time + 1000,
    ).length,
  ).toBeLessThanOrEqual(21);
  await guest
    .getByRole("button", { name: "Stop pattern", exact: true })
    .click();
  await expect(guest.locator("#cutoff")).not.toHaveClass(/automation-playing/);
  await expect(guest.locator("html")).not.toHaveAttribute(
    "data-audio-contexts",
  );
  await page.getByRole("button", { name: "End session", exact: true }).click();
  await context.close();
});
