import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Project } from "../src/model";
import { createProject } from "../src/model";

declare global {
  interface Window {
    vocalAudioProbe: {
      starts: number;
      durations: number[];
      holdDecode: boolean;
      decodePending: boolean;
      releaseDecode?: () => void;
      wav?: Promise<ArrayBuffer>;
    };
  }
}
async function prepare(
  page: Page,
  holdDecode = false,
  project: Project = createProject(),
): Promise<void> {
  for (const track of [
    ...project.drums,
    project.bass,
    project.keys,
    project.arp,
    project.pad,
  ])
    track.muted = true;
  project.vocal.muted = false;
  project.vocal.sound = 0;
  await page.addInitScript(
    ({ project, holdDecode }) => {
      localStorage.setItem("acid-303-project-v1", JSON.stringify(project));
      window.vocalAudioProbe = {
        starts: 0,
        durations: [],
        holdDecode,
        decodePending: false,
      };
      const objectUrl = URL.createObjectURL;
      URL.createObjectURL = (value) => {
        if (value instanceof Blob && value.type === "audio/wav")
          window.vocalAudioProbe.wav = value.arrayBuffer();
        return objectUrl.call(URL, value);
      };
      const decoded = new WeakSet<AudioBuffer>();
      const decode = BaseAudioContext.prototype.decodeAudioData;
      BaseAudioContext.prototype.decodeAudioData = async function (
        data,
        success,
        failure,
      ) {
        const buffer = await decode.call(this, data, success, failure);
        decoded.add(buffer);
        if (window.vocalAudioProbe.holdDecode) {
          window.vocalAudioProbe.decodePending = true;
          await new Promise<void>((resolve) => {
            window.vocalAudioProbe.releaseDecode = resolve;
          });
        }
        return buffer;
      };
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (
        when,
        offset,
        duration,
      ) {
        if (this.buffer && decoded.has(this.buffer)) {
          window.vocalAudioProbe.starts++;
          window.vocalAudioProbe.durations.push(this.buffer.duration);
        }
        start.call(this, when, offset, duration);
      };
    },
    { project, holdDecode },
  );
  await page.goto("/");
  await expect(page.locator("#vocal-preview")).toBeVisible();
}
async function holdSample(page: Page) {
  let release = () => {};
  let requested = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const request = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route("**/vocals/audio/female-go.wav", async (route) => {
    requested();
    await waiting;
    await route.continue().catch(() => undefined);
  });
  return { request, release };
}

test("Stop cancels a vocal-backed Play while its sample is downloading", async ({
  page,
}) => {
  const held = await holdSample(page);
  await prepare(page);
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  await held.request;
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
  held.release();
  await expect(
    page.getByRole("button", { name: "Play pattern", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.vocalAudioProbe.starts)).toBe(0);
});

test("muting a downloading preview prevents it from sounding later", async ({
  page,
}) => {
  const held = await holdSample(page);
  await prepare(page);
  await page.locator("#vocal-preview").click();
  await held.request;
  await page.locator("#vocal-mute").click();
  held.release();
  await expect(page.locator("#vocal-mute")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.vocalAudioProbe.starts)).toBe(0);
});

test("Stop also cancels a decoded sample before an async decode promise resolves", async ({
  page,
}) => {
  await prepare(page, true);
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  await page.waitForFunction(() => window.vocalAudioProbe.decodePending);
  await page.getByRole("button", { name: "Stop pattern", exact: true }).click();
  await page.evaluate(() => window.vocalAudioProbe.releaseDecode?.());
  await expect(
    page.getByRole("button", { name: "Play pattern", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.vocalAudioProbe.starts)).toBe(0);
});

test("a newly selected vocal supersedes an older pending preview", async ({
  page,
}) => {
  const held = await holdSample(page);
  await prepare(page);
  await page.locator("#vocal-preview").click();
  await held.request;
  await page.locator('[data-vocal-sound="1"]').click();
  await expect
    .poll(() => page.evaluate(() => window.vocalAudioProbe.starts))
    .toBe(1);
  held.release();
  await page.waitForTimeout(150);
  const probe = await page.evaluate(() => window.vocalAudioProbe);
  expect(probe.starts).toBe(1);
  expect(probe.durations[0]).toBeCloseTo(0.457528, 3);
});

test("a failed sample download reports a retryable error without starting audio", async ({
  page,
}) => {
  let failed = false;
  await page.route("**/vocals/audio/female-go.wav", (route) => {
    if (!failed) {
      failed = true;
      return route.fulfill({ status: 503, body: "Unavailable" });
    }
    return route.continue();
  });
  await prepare(page);
  await page.locator("#vocal-preview").click();
  await expect(page.locator("#vocal-retry")).toBeVisible();
  expect(await page.evaluate(() => window.vocalAudioProbe.starts)).toBe(0);
  await page.locator("#vocal-retry").click();
  await expect
    .poll(() => page.evaluate(() => window.vocalAudioProbe.starts))
    .toBe(1);
  await expect(page.locator("#vocal-retry")).toBeHidden();
});

test("WAV trim automation changes a held loop at its scheduled step, not earlier", async ({
  browser,
}) => {
  const segments: number[][] = [];
  for (const automated of [false, true]) {
    const page = await browser.newPage();
    try {
      const project = createProject();
      project.vocal.loop = true;
      project.vocal.notes = [{ start: 0, length: 12, note: 60, accent: false }];
      if (automated)
        project.vocal.automation.start = Array.from(
          { length: 16 },
          (_, index) => (index < 8 ? 0 : 0.4),
        );
      await prepare(page, false, project);
      await page
        .getByRole("button", { name: "Track controls", exact: true })
        .click();
      await page.locator("#export").click();
      await page.waitForFunction(
        () => window.vocalAudioProbe.wav !== undefined,
      );
      segments.push(
        await page.evaluate(async () => {
          const bytes = await window.vocalAudioProbe.wav;
          if (!bytes) throw new Error("WAV export missing");
          const view = new DataView(bytes),
            rate = view.getUint32(24, true);
          const values: number[] = [];
          for (let frame = 0; frame < rate * 1.4; frame++)
            values.push(view.getInt16(44 + frame * 4, true) / 32768);
          return values;
        }),
      );
    } finally {
      await page.close();
    }
  }
  const original = segments[0],
    changed = segments[1];
  if (!original || !changed) throw new Error("Missing comparison renders");
  const difference = (start: number, end: number): number => {
    let sum = 0,
      count = 0;
    for (let frame = Math.floor(start * 44100); frame < end * 44100; frame++) {
      sum += ((original[frame] ?? 0) - (changed[frame] ?? 0)) ** 2;
      count++;
    }
    return Math.sqrt(sum / count);
  };
  expect(difference(0, 0.6)).toBeLessThan(0.00001);
  expect(difference(1.1, 1.4)).toBeGreaterThan(0.001);
});
