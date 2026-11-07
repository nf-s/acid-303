import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { build } from "vite";

let recoveryModule: Promise<string> | undefined;
async function buildRecoveryModule(): Promise<string> {
  const root = decodeURIComponent(new URL("../", import.meta.url).pathname);
  const result = await build({
    root,
    configFile: false,
    publicDir: false,
    logLevel: "silent",
    build: {
      lib: {
        entry: `${root}src/playback-recovery.ts`,
        formats: ["es"],
        fileName: () => "playback-recovery.js",
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
    throw new Error("Recovery harness module was not built.");
  return entry.code;
}
async function harness(page: Page, mode = "allowed", role = "solo") {
  recoveryModule ??= buildRecoveryModule();
  const module = await recoveryModule;
  await page.route("**/recovery-module.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: module }),
  );
  await page.route("**/recovery-bootstrap.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `import { createPlaybackRecovery } from '/recovery-module.js';
      const query = new URLSearchParams(location.search);
      const role = query.get('role') === 'guest' ? 'guest' : 'solo';
      const state = {playing:false,role,room:role === 'guest' ? 'room-one' : null,ready:true};
      let attempts=0, edits=0;
      const status=document.getElementById('status'), prompt=document.getElementById('prompt');
      const render=()=>{status.textContent=state.playing?'Playing':'Stopped';status.dataset.attempts=String(attempts);};
      const play=async()=>{
        attempts++;render();
        if(query.get('mode')==='blocked'&&!navigator.userActivation.isActive) await new Promise(()=>{});
        state.playing=true;render();
      };
      const recovery=createPlaybackRecovery({
        getState:()=>state,onPlay:play,
        onCancelStart:()=>{state.playing=false;render();},
        onBlocked:()=>{prompt.hidden=false;},clearBlocked:()=>{prompt.hidden=true;},
      });
      document.getElementById('play').addEventListener('click',async()=>{
        recovery.userAction();
        if(state.playing){state.playing=false;render();}else await play();
        recovery.frame();
      });
      document.getElementById('edit').addEventListener('click',()=>{document.getElementById('edits').textContent=String(++edits);});
      window.addEventListener('pagehide',()=>{recovery.suspend();state.playing=false;recovery.frame();});
      render();recovery.frame();recovery.check();`,
    }),
  );
  await page.route("**/recovery-harness.html?*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body><button id="play">Play / Stop</button><button id="edit">Edit</button><output id="status"></output><output id="edits">0</output><p id="prompt" role="status" hidden>Tap to resume audio</p><script type="module" src="/recovery-bootstrap.js"></script></body></html>',
    }),
  );
  await page.goto(`/recovery-harness.html?mode=${mode}&role=${role}`);
  await expect(page.locator("#status")).toHaveText("Stopped");
}

test("a real reload restores recent playing intent when playback is allowed", async ({
  page,
}) => {
  await harness(page);
  await page.locator("#play").click();
  await expect(page.locator("#status")).toHaveText("Playing");
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.reload();
  await expect(page.locator("#status")).toHaveText("Playing");
  await expect(page.locator("#status")).toHaveAttribute("data-attempts", "1");
  await expect(page.locator("#prompt")).toBeHidden();
  expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(origin);
});

test("blocked reload playback waits for one gesture and direct Play does not double toggle", async ({
  page,
}) => {
  await harness(page, "blocked");
  await page.locator("#play").click();
  await page.reload();
  await expect(page.locator("#prompt")).toBeVisible();
  await expect(page.locator("#status")).toHaveText("Stopped");
  await page.locator("#edit").click();
  await expect(page.locator("#status")).toHaveText("Playing");
  await expect(page.locator("#status")).toHaveAttribute("data-attempts", "2");
  await expect(page.locator("#edits")).toHaveText("1");
  await expect(page.locator("#prompt")).toBeHidden();
  await page.reload();
  await expect(page.locator("#prompt")).toBeVisible();
  await page.locator("#play").click();
  await expect(page.locator("#status")).toHaveText("Playing");
  await expect(page.locator("#status")).toHaveAttribute("data-attempts", "2");
  await expect(page.locator("#prompt")).toBeHidden();
});

test("no intent, explicit Stop, and guest reloads never start playback", async ({
  page,
}) => {
  await harness(page);
  await page.reload();
  await expect(page.locator("#status")).toHaveAttribute("data-attempts", "0");
  await page.locator("#play").click();
  await page.locator("#play").click();
  await page.reload();
  await expect(page.locator("#status")).toHaveText("Stopped");
  await expect(page.locator("#status")).toHaveAttribute("data-attempts", "0");
  await page.goto("/recovery-harness.html?mode=allowed&role=guest");
  await page.evaluate(() =>
    sessionStorage.setItem(
      "grain-playback-intent-v1",
      JSON.stringify({
        version: 1,
        at: Date.now(),
        role: "host",
        room: "room-one",
      }),
    ),
  );
  await page.reload();
  await expect(page.locator("#status")).toHaveText("Stopped");
  await expect(page.locator("#status")).toHaveAttribute("data-attempts", "0");
  await expect(page.locator("#prompt")).toBeHidden();
});

async function observeAppAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const OriginalAudioContext = window.AudioContext;
    let contexts = 0,
      resumes = 0;
    window.AudioContext = class extends OriginalAudioContext {
      private readonly blocked =
        sessionStorage.getItem("recovery-test-block") === "true";
      private unlocked = false;
      constructor(options?: AudioContextOptions) {
        super(options);
        document.documentElement.dataset.recoveryContexts = String(++contexts);
      }
      get state(): AudioContextState {
        return this.blocked && !this.unlocked ? "suspended" : super.state;
      }
      async resume(): Promise<void> {
        document.documentElement.dataset.recoveryResumes = String(++resumes);
        if (this.blocked && !navigator.userActivation.isActive)
          await new Promise<void>(() => {});
        this.unlocked = true;
        await super.resume();
      }
    };
  });
}

async function appPlaying(page: Page): Promise<void> {
  await expect(page.locator("#audio-status")).toHaveText("AUDIO LIVE");
  await expect(page.locator("#play")).toHaveAttribute(
    "aria-label",
    "Stop pattern",
  );
}

async function appStopped(page: Page): Promise<void> {
  await expect(page.locator("#audio-status")).toHaveText("AUDIO IDLE");
  await expect(page.locator("#play")).toHaveAttribute(
    "aria-label",
    "Play pattern",
  );
}

test("actual app stays quiet when fresh, recovers a playing reload, and preserves an explicit Stop", async ({
  page,
}) => {
  await observeAppAudio(page);
  await page.goto("/");
  await appStopped(page);
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-recovery-contexts",
  );
  await page.locator("#play").click();
  await appPlaying(page);
  await page.reload();
  await expect
    .poll(
      async () =>
        (await page.locator("#audio-status").textContent()) === "AUDIO LIVE" ||
        (await page.locator("#playback-recovery-status").isVisible()),
    )
    .toBe(true);
  if (await page.locator("#playback-recovery-status").isVisible())
    await page.locator("#studio-tools").click();
  await appPlaying(page);
  await expect(page.locator("#playback-recovery-status")).toBeHidden();
  await page.locator("#play").click();
  await appStopped(page);
  await page.reload();
  await appStopped(page);
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-recovery-contexts",
  );
  await expect(page.locator("#playback-recovery-status")).toBeHidden();
});

test("actual app blocked recovery resumes on one editing gesture or one direct Play", async ({
  page,
}) => {
  await observeAppAudio(page);
  await page.goto("/");
  await page.locator("#play").click();
  await appPlaying(page);
  await page.evaluate(() =>
    sessionStorage.setItem("recovery-test-block", "true"),
  );
  await page.reload();
  await expect(page.locator("#playback-recovery-status")).toBeVisible();
  await appStopped(page);
  await expect(page.locator("html")).toHaveAttribute(
    "data-recovery-resumes",
    "1",
  );
  await page.locator("#studio-tools").click();
  await appPlaying(page);
  await expect(page.locator("#studio-tools")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-recovery-resumes",
    "2",
  );
  await expect(page.locator("#playback-recovery-status")).toBeHidden();
  await page.reload();
  await expect(page.locator("#playback-recovery-status")).toBeVisible();
  await page.locator("#play").click();
  await appPlaying(page);
  await expect(page.locator("html")).toHaveAttribute(
    "data-recovery-resumes",
    "2",
  );
  await expect(page.locator("#playback-recovery-status")).toBeHidden();
  await page.reload();
  await expect(page.locator("#playback-recovery-status")).toBeVisible();
  const sweep = page.locator("#fx-sweep"),
    box = await sweep.boundingBox();
  if (!box) throw new Error("Sweep control is missing.");
  const before = Number(await sweep.getAttribute("aria-valuenow"));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 35, {
    steps: 4,
  });
  await page.mouse.up();
  await appPlaying(page);
  expect(Number(await sweep.getAttribute("aria-valuenow"))).toBeGreaterThan(
    before,
  );
  await expect(page.locator("#playback-recovery-status")).toBeHidden();
  await page.locator("#play").click();
  await appStopped(page);
});

test("actual app ignores playing intent when an incoming shared track is opened", async ({
  page,
}) => {
  await observeAppAudio(page);
  await page.goto("/");
  await page.locator("#studio-tools").click();
  await page.locator("#share-track").click();
  await expect(page.locator("#share-url")).toHaveValue(/#track=/);
  const link = await page.locator("#share-url").inputValue();
  await page.locator("#close-share").click();
  await page.locator("#play").click();
  await appPlaying(page);
  await page.evaluate((url) => history.replaceState(null, "", url), link);
  await page.reload();
  await expect(page.locator("#toast")).toContainText("Shared track loaded.");
  await appStopped(page);
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-recovery-contexts",
  );
  await expect(page.locator("#playback-recovery-status")).toBeHidden();
});
