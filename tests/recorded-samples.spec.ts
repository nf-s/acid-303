import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createProject, projectSchema } from "../src/model";
import { encodeWav } from "../src/wav";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((project) => {
    if (!localStorage.getItem("acid-303-project-v1"))
      localStorage.setItem("acid-303-project-v1", JSON.stringify(project));
  }, createProject());
});

/** A generated MediaStream exercises the real AudioWorklet without opening a physical microphone. */
async function syntheticMicrophone(page: Page, delayed = false): Promise<void> {
  await page.addInitScript((delay) => {
    Object.defineProperty(
      Object.getPrototypeOf(navigator.mediaDevices),
      "getUserMedia",
      {
        configurable: true,
        value: async () => {
          const audio = new AudioContext(),
            destination = audio.createMediaStreamDestination(),
            source = audio.createOscillator(),
            gain = audio.createGain();
          gain.gain.value = 0.15;
          source.frequency.value = 220;
          source.connect(gain);
          gain.connect(destination);
          source.start();
          void audio.resume().catch(() => undefined);
          const track = destination.stream.getAudioTracks()[0];
          if (!track) throw new Error("Synthetic microphone is missing.");
          const stopped = setInterval(() => {
            if (track.readyState !== "ended") return;
            clearInterval(stopped);
            source.stop();
            void audio.close();
            document.documentElement.dataset.micStopped = "true";
          }, 20);
          if (delay) await new Promise((resolve) => setTimeout(resolve, 500));
          return destination.stream;
        },
      },
    );
  }, delayed);
}
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
async function openRecordings(page: Page): Promise<void> {
  const details = page.locator(".vocal-recordings");
  if (
    !(await details.evaluate(
      (element) => element instanceof HTMLDetailsElement && element.open,
    ))
  )
    await details.locator(":scope > summary").click();
}
async function capture(page: Page): Promise<void> {
  await openRecordings(page);
  await page.locator("#vocal-record-mic").click();
  await expect
    .poll(async () =>
      Number.parseFloat(await page.locator("#vocal-record-time").innerText()),
    )
    .toBeGreaterThan(0.2);
  await page.locator("#vocal-record-stop").click();
  await expect(page.locator(".vocal-recording-row")).toHaveCount(1);
  await expect(page.locator("#vocal-record-mic")).toBeVisible();
}
async function tools(page: Page): Promise<void> {
  if (
    (await page.locator("#studio-tools").getAttribute("aria-expanded")) !==
    "true"
  )
    await page.locator("#studio-tools").click();
}

test("microphone capture stays local, survives reload and releases the stream on a320px phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 812 });
  await syntheticMicrophone(page);
  const uploads: string[] = [],
    errors: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/samples/"))
      uploads.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await capture(page);
  await expect
    .poll(async () => (await saved(page)).vocal.recording?.kind)
    .toBe("local");
  const sample = (await saved(page)).vocal.recording;
  expect(sample?.duration).toBeGreaterThan(0.2);
  expect(sample?.peaks.some((value) => value > 0.05)).toBe(true);
  await expect(page.locator("html")).toHaveAttribute(
    "data-mic-stopped",
    "true",
  );
  expect(uploads).toEqual([]);
  await page.reload();
  await openRecordings(page);
  await expect(page.locator(".vocal-recording-row")).toHaveCount(1);
  expect((await saved(page)).vocal.recording?.id).toBe(sample?.id);
  await page.locator("#vocal-preview").click();
  await expect(page.locator("#vocal-sample-status")).toHaveText("");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("cancelled permission requests dispose a late microphone and save no recording", async ({
  page,
}) => {
  await syntheticMicrophone(page, true);
  await page.goto("/");
  await openRecordings(page);
  await page.locator("#vocal-record-mic").click();
  await expect(page.locator("#vocal-record-time")).toHaveText(
    "Allow microphone access",
  );
  await page.locator("#vocal-record-cancel").click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-mic-stopped",
    "true",
  );
  await expect(page.locator(".vocal-recording-row")).toHaveCount(0);
  expect((await saved(page)).vocal.recording).toBeNull();
});
test("sharing uploads once and a fresh browser loads the private recording", async ({
  page,
  browser,
}) => {
  await syntheticMicrophone(page);
  await page.goto("/");
  await capture(page);
  await tools(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const field = page.locator("#share-url");
  await expect(field).toHaveValue(/#track=/, { timeout: 20000 });
  const link = await field.inputValue();
  const other = await browser.newContext();
  const listener = await other.newPage();
  try {
    await listener.goto(link);
    await expect
      .poll(async () => (await saved(listener)).vocal.recording?.kind)
      .toBe("shared");
    await listener.locator("#vocal-preview").click();
    await expect(listener.locator("#vocal-sample-status")).toHaveText("", {
      timeout: 20000,
    });
    const shared = (await saved(listener)).vocal.recording;
    expect(shared?.sha256).toBe((await saved(page)).vocal.recording?.sha256);
    await page.locator("#close-share").click();
    await openRecordings(page);
    await page.locator("[data-recording-action=unshare]").click();
    await expect(page.locator("#vocal-record-message")).toContainText(
      "Shared copy deleted",
    );
  } finally {
    await other.close();
  }
});
test("guests keep a capture local until Use in session and only the host plays it", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await tools(page);
  await page.getByRole("button", { name: "Session", exact: true }).click();
  await page.locator("#session-create").click();
  await expect(page.locator("#session-status")).toHaveText("Hosting", {
    timeout: 20000,
  });
  const invite = await page.locator("#session-invite-link").inputValue();
  const context = await browser.newContext(),
    guest = await context.newPage();
  try {
    await syntheticMicrophone(guest);
    await guest.goto(invite);
    await expect(guest.locator("#session-status")).toHaveText("Connected", {
      timeout: 20000,
    });
    await capture(guest);
    expect((await saved(guest)).vocal.recording).toBeNull();
    expect((await saved(page)).vocal.recording).toBeNull();
    let releaseUpload = () => {};
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    await guest.route("**/samples/*", async (route) => {
      if (route.request().method() === "PUT") await uploadGate;
      await route.continue();
    });
    await guest
      .getByRole("button", { name: "Use in session", exact: true })
      .click();
    await expect(guest.locator("#vocal-record-message")).toHaveText(
      "Uploading recording…",
    );
    await page.locator("#bpm").press("ArrowUp");
    await expect
      .poll(async () => (await saved(guest)).bpm)
      .toBe((await saved(page)).bpm);
    releaseUpload();
    await expect
      .poll(async () => (await saved(page)).vocal.recording?.kind)
      .toBe("shared");
    await expect(guest.locator("#audio-status")).toHaveText("AUDIO ON HOST");
    if (
      (await page.locator("#studio-tools").getAttribute("aria-expanded")) ===
      "true"
    )
      await page.locator("#studio-tools").click();
    await page.locator("#vocal-preview").click();
    await expect(page.locator("#vocal-sample-status")).toHaveText("");
    await guest.locator("[data-recording-action=unshare]").click();
  } finally {
    await tools(page);
    if (!(await page.locator("#session-end").isVisible()))
      await page.getByRole("button", { name: "Session", exact: true }).click();
    await page.locator("#session-end").click();
    await expect(page.locator("#session-status")).toHaveText("Session ended");
    await context.close();
  }
});
test("short stereo WAV imports normalize locally and incompatible files leave the selected recording intact", async ({
  page,
}) => {
  await page.goto("/");
  await openRecordings(page);
  const samples = Float32Array.from(
    { length: 9600 },
    (_, index) => Math.sin(index / 20) * 0.2,
  );
  const blob = encodeWav([samples, samples], 48000);
  await page.locator("#vocal-import-file").setInputFiles({
    name: "My voice.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from(await blob.arrayBuffer()),
  });
  await expect
    .poll(async () => (await saved(page)).vocal.recording?.name)
    .toBe("My voice");
  const before = (await saved(page)).vocal.recording;
  const invalid = encodeWav([new Float32Array(3200)], 32000);
  await page.locator("#vocal-import-file").setInputFiles({
    name: "Other rate.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from(await invalid.arrayBuffer()),
  });
  await expect(page.locator("#vocal-record-message")).toContainText(
    "24, 44.1 or 48 kHz",
  );
  expect((await saved(page)).vocal.recording).toEqual(before);
  await page.locator("[data-recording-action=delete]").click();
  await expect.poll(async () => (await saved(page)).vocal.recording).toBeNull();
  expect((await saved(page)).vocal.muted).toBe(true);
});
test("microphone permission denial leaves the original vocal unchanged", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(
      Object.getPrototypeOf(navigator.mediaDevices),
      "getUserMedia",
      {
        configurable: true,
        value: async () => {
          throw new DOMException("Denied", "NotAllowedError");
        },
      },
    );
  });
  await page.goto("/");
  const before = (await saved(page)).vocal;
  await openRecordings(page);
  await page.locator("#vocal-record-mic").click();
  await expect(page.locator("#vocal-record-message")).toContainText(
    "Microphone access was denied",
  );
  expect((await saved(page)).vocal).toEqual(before);
  await expect(page.locator("#vocal-record-mic")).toBeVisible();
});

test("renewing an unavailable shared recording retries a lost response with the same private credentials", async ({
  page,
}) => {
  const uploads: { url: string; owner: string; read: string }[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/samples/")) {
      const headers = request.headers();
      uploads.push({
        url: request.url(),
        owner: headers.authorization ?? "",
        read: headers["x-sample-read-token"] ?? "",
      });
    }
  });
  await syntheticMicrophone(page);
  await page.goto("/");
  await capture(page);
  await tools(page);
  const origin = new URL(page.url()).origin;
  try {
    await page.locator("#share-track").click();
    await expect(page.locator("#share-url")).toHaveValue(/#track=/);
    const original = uploads[0];
    if (!original) throw new Error("No initial recording upload.");
    const link = await page.locator("#share-url").inputValue();
    await page.goto(link);
    await expect
      .poll(async () => (await saved(page)).vocal.recording?.kind)
      .toBe("shared");
    if (await page.locator("#close-share").isVisible())
      await page.locator("#close-share").click();
    expect(
      (
        await page.request.delete(original.url, {
          headers: { Origin: origin, Authorization: original.owner },
        })
      ).status(),
    ).toBe(204);
    let loseResponse = true;
    await page.route("**/samples/*", async (route) => {
      if (route.request().method() === "PUT" && loseResponse) {
        loseResponse = false;
        const accepted = await route.fetch();
        expect(accepted.status()).toBe(201);
        await route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ error: "Upload response lost" }),
        });
        return;
      }
      await route.continue();
    });
    await tools(page);
    await page.locator("#share-track").click();
    await expect.poll(() => uploads.length).toBe(2);
    await expect(page.locator("#share-track")).toBeEnabled();
    await expect(page.locator("#share-url")).not.toBeVisible();
    await page.locator("#share-track").click();
    await expect(page.locator("#share-url")).toBeVisible();
    await expect(page.locator("#share-url")).toHaveValue(/#track=/);
    await expect.poll(() => uploads.length).toBe(3);
    const first = uploads[1],
      retry = uploads[2];
    if (!first || !retry) throw new Error("Missing renewal attempts.");
    expect(
      first.url === retry.url &&
        first.owner === retry.owner &&
        first.read === retry.read,
    ).toBe(true);
    expect(first.url === original.url).toBe(false);
    await page.locator("#close-share").click();
    await openRecordings(page);
    await page.locator("[data-recording-action=unshare]").click();
    await expect(page.locator("#vocal-record-message")).toContainText(
      "Shared copy deleted",
    );
  } finally {
    for (const upload of new Map(
      uploads.map((item) => [item.url, item]),
    ).values())
      await page.request.delete(upload.url, {
        headers: { Origin: origin, Authorization: upload.owner },
      });
  }
});
